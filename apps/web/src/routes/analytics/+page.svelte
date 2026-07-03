<script lang="ts">
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import InfoTip from "$lib/components/info-tip.svelte";
  import { buildSystemReport } from "$lib/analytics-report";
  import { COUNTRY_NAMES, MAP_H, MAP_W, WORLD_PATHS } from "$lib/world-map";

  let { data } = $props();

  type Tab = "traffic" | "telegram" | "system";
  const TABS: { id: Tab; label: string }[] = [
    { id: "traffic", label: "Traffic" },
    { id: "telegram", label: "Telegram" },
    { id: "system", label: "System" },
  ];
  const initial = page.url.searchParams.get("tab");
  let tab = $state<Tab>(initial === "telegram" || initial === "system" ? initial : "traffic");
  let logProc = $state("worker");

  function setTab(t: Tab) {
    tab = t;
    // Keep the tab in the URL so reloads land on the same view.
    const url = new URL(location.href);
    url.searchParams.set("tab", t);
    history.replaceState(history.state, "", url);
  }

  // Keep the live-now counter and log tails fresh without manual reloads.
  onMount(() => {
    const t = setInterval(() => invalidateAll(), 60_000);
    return () => clearInterval(t);
  });

  const maxViews = $derived(Math.max(1, ...data.days.map((d) => d.views)));
  const fmtDay = (day: string) =>
    new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const fmtTs = (ts: string) =>
    new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const fmtSecs = (s: number | null) =>
    s === null ? "…" : s < 90 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  const isErrLine = (l: string) => /error|failed|fatal|exception/i.test(l);

  const flag = (iso2: string) =>
    iso2.toUpperCase().replace(/./g, (c) => String.fromCodePoint(0x1f1a5 + c.charCodeAt(0)));

  // Choropleth intensity per ISO2 country.
  const countryCount = $derived(new Map(data.countries.map((c) => [c.country, c.visitors])));
  const maxCountry = $derived(Math.max(1, ...data.countries.map((c) => c.visitors)));
  const intensity = (iso2: string) => {
    const n = countryCount.get(iso2);
    if (!n) return 0;
    return 0.25 + 0.75 * (n / maxCountry);
  };

  // Hour × weekday heatmap grid.
  const heatGrid = $derived.by(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const c of data.heat) g[c.dow - 1]![c.hr] = c.n;
    return g;
  });
  const maxHeat = $derived(Math.max(1, ...data.heat.map((c) => c.n)));
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const funnelSteps = $derived([
    { label: "Visited", n: data.funnel.visited, of: data.funnel.visited },
    { label: "Opened a listing", n: data.funnel.opened, of: data.funnel.visited },
    { label: "Clicked apply", n: data.funnel.applied, of: data.funnel.opened },
  ]);
  const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "—");

  const maxSubs = $derived(Math.max(1, ...data.subscriberGrowth.map((d) => d.total)));
  const growthPoints = $derived(
    data.subscriberGrowth
      .map((d, i) => `${(i / (data.subscriberGrowth.length - 1)) * 600},${78 - (d.total / maxSubs) * 70}`)
      .join(" "),
  );

  const stats = $derived([
    { label: "VIEWS · 30D", value: data.totals.views30, sub: `${data.totals.views7} last 7d` },
    { label: "VISITORS · 30D", value: data.totals.visitors30, sub: `${data.totals.visitors7} last 7d` },
    { label: "FROM TELEGRAM", value: data.totals.tg30, sub: "visitors · 30d" },
    { label: "APPLY CLICKS", value: data.totals.applies30, sub: "30d" },
  ]);

  const tgCells = $derived([
    { label: "NEW SUBSCRIBERS", value: data.tg.subs30, sub: "30d" },
    { label: "SAVES", value: data.tg.saves30, sub: "30d" },
    { label: "VIA CHANNEL BUTTON", value: data.tg.savesDeeplink, sub: "of saves" },
    { label: "TOTAL SUBSCRIBERS", value: data.product.subscribers, sub: "all time" },
  ]);

  // Explainers for the System tab — accurate to the implementation, so the
  // popup is documentation, not marketing.
  const INFO = {
    structured: {
      title: "Structured coverage",
      body:
        "Share of active listings the Gemini structurer has processed. A structured listing has clean reader-mode sections on the site, a one-line summary in channel posts, and machine-repaired deadline / pay fields. Unstructured ones fall back to the raw scraped text. If this drops well below 100%, the structurer is off (STRUCTURER_ENABLED), out of quota, or the worker's structure step is failing.",
      source: "listings.raw → 'structured' (jsonb), written by packages/scraper structure step",
      computed: "count(status='active' AND raw has 'structured') ÷ count(status='active')",
      refresh: "Structuring runs in the nightly worker pipeline (12:00 EAT) and via backfill:structure; this page re-queries every 60s.",
    },
    applyLinks: {
      title: "Direct apply links",
      body:
        "Active listings with a direct application URL — the org's own ATS or form, not the aggregator page. Parsed deterministically from ethiongojobs bodies, lifted off Idealist listing pages (incl. resolving bit.ly-style shortlinks), or extracted from the prose by the LLM as a fallback. Listings without one aren't broken: their source page often is the application page (UN Careers, AU jobs) or they apply by email.",
      source: "listings.apply_url · filled by the scrapers + backfill:apply-url + the structurer's application_url",
      computed: "count(status='active' AND apply_url IS NOT NULL) ÷ count(status='active')",
      refresh: "Set at scrape/structure time; page re-queries every 60s.",
    },
    backlog: {
      title: "Channel backlog",
      body:
        "Active listings that qualify for the Telegram channel (fit score ≥ 70) but haven't been broadcast yet. The bot's auto-poster drains this queue every 15 minutes, so it should hover near zero. A number that keeps growing means the bot is down, erroring on sends, or card rendering is failing.",
      source: "listings.posted_to_channel + listings.fit_score",
      computed: "count(status='active' AND fit_score ≥ 70 AND NOT posted_to_channel)",
      refresh: "Bot drains every 15 min; page re-queries every 60s.",
    },
    lifecycle: {
      title: "Expired · Hidden",
      body:
        "Listings the board deliberately doesn't show. Expired: the deadline passed (flipped by the every-3-hours cleanup cron, the nightly prune, or the board's own deadline guard) or the listing vanished from its source feed for ~3 weeks. Hidden: pulled on purpose — classified as not realistically doable from Ethiopia, or removed for CSO-safety reasons. Expired rows older than ~90 days are purged entirely.",
      source: "listings.status ('expired' | 'hidden')",
      computed: "Plain counts by status.",
      refresh: "Cleanup cron every 3h · nightly prune · page re-queries every 60s.",
    },
    events: {
      title: "Event rows",
      body:
        "Total rows ever written to the analytics event table — every pageview, listing open, apply click, and Telegram subscribe/save. It's the raw material behind the Traffic and Telegram tabs. Grows unbounded but cheaply (a row is a few hundred bytes); at this product's scale that's years of headroom before pruning is worth thinking about.",
      source: "page_events (written by hooks.server.ts, /api/track, and the bot)",
      computed: "count(*) over the whole table",
      refresh: "Live inserts; page re-queries every 60s.",
    },
    runs: {
      title: "Scrape runs",
      body:
        "One row per scrape execution, written by the scraper when a run finishes. Source 'orgs' is the nightly sweep that walks the org directory and dispatches each careers URL to its matching adapter. NEW = listings inserted for the first time; UPDATED = re-seen and refreshed in place; ERRORS = org-level failures (fetch, parse, or a browser-challenge wall) — the run continues past them. DURATION is finished−started; '…' means the run died before finishing (or is still going).",
      source: "scrape_runs table · written by packages/scraper persist",
      computed: "Latest 15 rows, newest first.",
      refresh: "Worker pipeline daily at 12:00 EAT (WORKER_CRON) — scrape → dedup → prune → structure.",
    },
    orgsRun: {
      title: "Slowest / failing orgs",
      body:
        "Per-org breakdown of the most recent 'orgs' run, worst first: each org's adapter, how long its scrape took, and whether it errored or how many listings it kept. The same org erroring day after day usually means its careers URL moved, the site added bot protection, or the adapter's selectors went stale — that's your fix-me list.",
      source: "scrape_runs.log (jsonb) → orgs[] of the latest orgs run",
      computed: "Sorted by errors desc, then duration desc · top 10.",
      refresh: "Rewritten by each nightly orgs run.",
    },
    logs: {
      title: "Process logs",
      body:
        "Live tails of the PM2 logs for the three processes, read directly off this server's disk — no shipping, no agent. OUTPUT is stdout (normal operation), ERROR is stderr (crashes, stack traces). Lines matching error/failed/fatal are emphasized. Bounded to the last 24KB / 120 lines per file so a huge log can't bloat this page. In local dev PM2 isn't running, so the worker tail falls back to the repo's logs/ directory and the others show 'no log file'.",
      source: "~/.pm2/logs/internit-{worker,bot,web}-{out,error}.log (PM2_LOG_DIR to override)",
      computed: "Tail of each file, newest lines last.",
      refresh: "Re-read on every page load and the 60s auto-refresh.",
    },
    product: {
      title: "Product counts",
      body:
        "Raw table counts across the product. Active listings = currently shown on the board. Posted to channel = listings the bot has ever broadcast. Subscribers = Telegram bot users (anyone who ever /start-ed). Bookmarks and reminders = web-side saves by signed-in users. Active-by-source shows where the live catalog actually comes from — if one source dominates, that's your dependency risk.",
      source: "listings · subscribers · bookmarks · reminders tables",
      computed: "Plain counts (listings filtered to status='active' where noted).",
      refresh: "Live tables; page re-queries every 60s.",
    },
  } as const;

  const healthCells = $derived([
    {
      label: "STRUCTURED",
      value: `${data.health.structured}/${data.health.active}`,
      sub: pct(data.health.structured, data.health.active) + " of active",
      info: INFO.structured,
    },
    {
      label: "APPLY LINKS",
      value: `${data.health.withApply}/${data.health.active}`,
      sub: pct(data.health.withApply, data.health.active) + " of active",
      info: INFO.applyLinks,
    },
    { label: "CHANNEL BACKLOG", value: data.health.backlog, sub: "fit ≥ 70, unposted", info: INFO.backlog },
    {
      label: "EXPIRED · HIDDEN",
      value: `${data.health.expired} · ${data.health.hidden}`,
      sub: "listings",
      info: INFO.lifecycle,
    },
    { label: "EVENT ROWS", value: data.health.events, sub: "page_events", info: INFO.events },
  ]);

  const productCells = $derived([
    { label: "ACTIVE LISTINGS", value: data.product.active },
    { label: "POSTED TO CHANNEL", value: data.product.posted },
    { label: "SUBSCRIBERS", value: data.product.subscribers },
    { label: "BOOKMARKS", value: data.product.bookmarks },
    { label: "REMINDERS", value: data.product.reminders },
  ]);

  const currentLog = $derived(data.processLogs.find((p) => p.name === logProc));

  // Chart interactivity: hover (desktop) or tap (mobile) selects a bar/cell and
  // shows its numbers in a readout line — SVG <title> tooltips don't exist on touch.
  let daySel = $state<number | null>(null);
  const daySel$ = $derived(daySel === null ? null : data.days[daySel]);
  let heatSel = $state<{ d: number; h: number } | null>(null);

  // Export the System tab as a self-contained Markdown report — shaped for
  // pasting straight into Claude for analysis.
  let copied = $state(false);
  async function copyReport() {
    try {
      await navigator.clipboard.writeText(buildSystemReport(data));
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      downloadReport(); // clipboard blocked (permissions/http) — fall back
    }
  }
  function downloadReport() {
    const blob = new Blob([buildSystemReport(data)], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `internit-system-report-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
</script>

<svelte:head><title>Analytics — internit</title></svelte:head>

<!-- h-dvh + own scroll: the global layout sets body overflow-hidden (the board
     scrolls internally), so this page must own its scrolling too. -->
<div class="h-dvh overflow-y-auto overscroll-contain bg-[#f0e6d2] font-sans text-neutral-900 antialiased">
  <div class="mx-auto max-w-5xl px-5 py-8 sm:px-8">
    <div class="flex items-baseline justify-between">
      <div class="flex items-baseline gap-4">
        <h1 class="font-serif text-[32px] font-semibold tracking-tight">Analytics</h1>
        <span class="flex items-center gap-1.5 text-[12px] text-neutral-600">
          <span
            class="inline-block size-2 rounded-full {data.liveNow > 0
              ? 'bg-[#5a4226]'
              : 'bg-[#b8956a]/50'}"
          ></span>
          {data.liveNow} online now
        </span>
      </div>
      <a
        href="/"
        class="font-serif text-[13px] text-[#5a4226] italic underline decoration-[#b8956a]/60 underline-offset-2"
        >← board</a
      >
    </div>
    <p class="mt-1 text-[12px] text-neutral-500">
      Last 30 days · first-party, cookieless · you're the only one who can see this.
    </p>

    <!-- tabs -->
    <div class="mt-5 flex gap-0.5 overflow-x-auto border-b border-[#b8956a]/40 sm:gap-1">
      {#each TABS as t}
        <button
          type="button"
          onclick={() => setTab(t.id)}
          class="-mb-px shrink-0 px-3 py-2 text-[11.5px] font-medium tracking-[0.04em] whitespace-nowrap uppercase sm:px-4 sm:text-[12.5px] {tab ===
          t.id
            ? 'border-x border-t border-[#b8956a]/40 bg-[#f0e6d2] text-neutral-900 rounded-t-md border-b border-b-[#f0e6d2]'
            : 'text-neutral-500 hover:text-neutral-900'}"
        >
          {t.label}
        </button>
      {/each}
    </div>

    {#if tab === "traffic"}
      <!-- headline stats -->
      <div
        class="mt-6 grid grid-cols-2 overflow-hidden rounded-md border-t border-l border-[#b8956a]/40 lg:grid-cols-4"
      >
        {#each stats as cell}
          <div class="border-r border-b border-[#b8956a]/40 px-4 py-3">
            <div class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-500">
              {cell.label}
            </div>
            <div class="mt-0.5 text-[26px] font-semibold leading-tight">{cell.value}</div>
            <div class="text-[11px] text-neutral-500">{cell.sub}</div>
          </div>
        {/each}
      </div>

      <!-- daily chart -->
      <section class="mt-8">
        <div class="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
            DAILY VIEWS <span class="font-normal normal-case">(dark = unique visitors)</span>
          </h2>
          <!-- readout: hover or tap a bar -->
          <span class="text-[12px] text-neutral-600">
            {#if daySel$}
              <b class="text-neutral-900">{fmtDay(daySel$.day)}</b>
              — {daySel$.views} views · {daySel$.visitors} visitors
            {:else}
              <span class="font-serif italic text-neutral-500">hover or tap a bar</span>
            {/if}
          </span>
        </div>
        <svg
          viewBox="0 0 600 130"
          class="mt-2 w-full touch-manipulation"
          role="img"
          aria-label="Daily views chart"
          onmouseleave={() => (daySel = null)}
        >
          <!-- y-axis max marker -->
          <line x1="0" y1="10" x2="600" y2="10" stroke="#b8956a" stroke-opacity="0.25" stroke-dasharray="3 4" />
          <text x="0" y="7" font-size="9" fill="#8a8a8a">{maxViews}</text>
          {#each data.days as d, i}
            {@const x = i * 20}
            {@const vh = Math.round((d.views / maxViews) * 110)}
            {@const uh = Math.round((d.visitors / maxViews) * 110)}
            {@const active = daySel === i}
            <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
            <g
              onmouseenter={() => (daySel = i)}
              onclick={() => (daySel = daySel === i ? null : i)}
              style="cursor:pointer"
            >
              <title>{fmtDay(d.day)} — {d.views} views · {d.visitors} visitors</title>
              {#if active}
                <rect {x} y="10" width="16" height="110" fill="#5a4226" opacity="0.08" />
              {/if}
              <rect {x} y={120 - vh} width="16" height={vh} fill="#b8956a" opacity={active ? 0.7 : 0.45} />
              <rect {x} y={120 - uh} width="16" height={uh} fill="#5a4226" opacity={active ? 1 : 0.9} />
              {#if active && d.views > 0}
                <text
                  x={Math.min(584, Math.max(8, x + 8))}
                  y={Math.max(9, 116 - vh)}
                  font-size="10"
                  font-weight="600"
                  fill="#171717"
                  text-anchor="middle">{d.views}</text
                >
              {/if}
              <rect {x} y="0" width="20" height="130" fill="transparent" />
            </g>
          {/each}
          <line x1="0" y1="120.5" x2="600" y2="120.5" stroke="#b8956a" stroke-opacity="0.5" />
        </svg>
        <div class="flex justify-between text-[10.5px] text-neutral-500">
          <span>{fmtDay(data.days[0].day)}</span>
          <span>{fmtDay(data.days[data.days.length - 1].day)}</span>
        </div>
      </section>

      <!-- world map -->
      <section class="mt-9">
        <h2 class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
          VISITORS BY COUNTRY
        </h2>
        <div class="mt-3 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_220px]">
          <svg
            viewBox="0 0 {MAP_W} {MAP_H}"
            class="w-full rounded-md border border-[#b8956a]/30"
            role="img"
            aria-label="Visitor world map"
          >
            {#each Object.entries(WORLD_PATHS) as [iso2, d]}
              {@const heat = intensity(iso2)}
              <path
                {d}
                fill={heat > 0 ? "#5a4226" : "#e7dcc0"}
                fill-opacity={heat > 0 ? heat : 1}
                stroke="#8a6e47"
                stroke-opacity="0.35"
                stroke-width="0.5"
              >
                <title
                  >{COUNTRY_NAMES[iso2] ?? iso2}{countryCount.get(iso2)
                    ? ` — ${countryCount.get(iso2)} visitors`
                    : ""}</title
                >
              </path>
            {/each}
          </svg>
          <div>
            {#each data.countries.slice(0, 8) as c}
              <div class="flex items-baseline gap-2 border-b border-[#b8956a]/25 py-1.5">
                <span class="text-[14px]">{flag(c.country)}</span>
                <span class="flex-1 truncate text-[13px]">{COUNTRY_NAMES[c.country] ?? c.country}</span>
                <span class="text-[14px] font-semibold">{c.visitors}</span>
              </div>
            {:else}
              <p class="font-serif text-[13px] text-neutral-500 italic">No geo data yet.</p>
            {/each}
          </div>
        </div>
      </section>

      <!-- funnel + heatmap -->
      <div class="mt-9 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <h2 class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
            FUNNEL · UNIQUE VISITORS · 30D
          </h2>
          <div class="mt-3 space-y-2.5">
            {#each funnelSteps as step, i}
              {@const width = data.funnel.visited > 0 ? Math.max(2, (step.n / data.funnel.visited) * 100) : 2}
              <div>
                <div class="flex items-baseline justify-between text-[12px]">
                  <span>{step.label}</span>
                  <span class="text-neutral-600">
                    <b class="text-neutral-900">{step.n}</b>
                    {#if i > 0}&nbsp;· {pct(step.n, step.of)}{/if}
                  </span>
                </div>
                <div class="mt-1 h-4 rounded-sm bg-[#b8956a]/15">
                  <div class="h-full rounded-sm bg-[#5a4226]" style="width:{width}%"></div>
                </div>
              </div>
            {/each}
          </div>
        </section>

        <section>
          <div class="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
              WHEN PEOPLE BROWSE <span class="font-normal">(EAT · 30d)</span>
            </h2>
            <span class="text-[12px] text-neutral-600">
              {#if heatSel}
                <b class="text-neutral-900">{DOW[heatSel.d]} {heatSel.h}:00</b>
                — {heatGrid[heatSel.d][heatSel.h]} events
              {:else}
                <span class="font-serif italic text-neutral-500">hover or tap a cell</span>
              {/if}
            </span>
          </div>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="mt-3 space-y-[3px]" onmouseleave={() => (heatSel = null)}>
            {#each heatGrid as row, d}
              <div class="flex items-center gap-[3px]">
                <span class="w-8 text-[10px] text-neutral-500">{DOW[d]}</span>
                {#each row as n, h}
                  {@const active = heatSel?.d === d && heatSel?.h === h}
                  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
                  <div
                    class="h-[13px] flex-1 cursor-pointer rounded-[2px] {active
                      ? 'ring-1 ring-[#5a4226]'
                      : ''}"
                    style="background:rgba(90,66,38,{n > 0 ? 0.12 + 0.88 * (n / maxHeat) : 0.05})"
                    onmouseenter={() => (heatSel = { d, h })}
                    onclick={() => (heatSel = active ? null : { d, h })}
                  ></div>
                {/each}
              </div>
            {/each}
            <div class="flex gap-[3px] pl-8 text-[10px] text-neutral-500">
              {#each Array(24) as _, h}
                <span class="flex-1 text-center">{h % 6 === 0 ? h : ""}</span>
              {/each}
            </div>
          </div>
        </section>
      </div>

      <!-- listing tables -->
      <div class="mt-9 grid grid-cols-1 gap-8 pb-10 lg:grid-cols-2">
        <section>
          <h2 class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
            MOST VIEWED LISTINGS
          </h2>
          {#each data.topViewed as row}
            <div class="flex items-baseline gap-3 border-b border-[#b8956a]/25 py-2">
              <div class="min-w-0 flex-1">
                <div class="truncate text-[13px] font-medium">{row.title}</div>
                <div class="truncate text-[11px] text-neutral-500">{row.org}</div>
              </div>
              <div class="text-[14px] font-semibold">{row.views}</div>
            </div>
          {:else}
            <p class="mt-2 font-serif text-[13px] text-neutral-500 italic">Nothing yet.</p>
          {/each}
        </section>

        <section>
          <h2 class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
            MOST APPLY CLICKS
          </h2>
          {#each data.topApplied as row}
            <div class="flex items-baseline gap-3 border-b border-[#b8956a]/25 py-2">
              <div class="min-w-0 flex-1">
                <div class="truncate text-[13px] font-medium">{row.title}</div>
                <div class="truncate text-[11px] text-neutral-500">{row.org}</div>
              </div>
              <div class="text-[14px] font-semibold">{row.clicks}</div>
            </div>
          {:else}
            <p class="mt-2 font-serif text-[13px] text-neutral-500 italic">Nothing yet.</p>
          {/each}
        </section>

        <section>
          <h2 class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">REFERRERS</h2>
          {#each data.referrers as row}
            <div class="flex items-baseline gap-3 border-b border-[#b8956a]/25 py-2">
              <div class="flex-1 text-[13px]">
                {row.ref === "tg" ? "telegram channel" : row.ref}
              </div>
              <div class="text-[14px] font-semibold">{row.visitors}</div>
            </div>
          {:else}
            <p class="mt-2 font-serif text-[13px] text-neutral-500 italic">Nothing yet.</p>
          {/each}
        </section>

        <section>
          <h2 class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">DEVICES</h2>
          {#each data.devices as row}
            <div class="flex items-baseline gap-3 border-b border-[#b8956a]/25 py-2">
              <div class="flex-1 text-[13px]">{row.device}</div>
              <div class="text-[14px] font-semibold">{row.visitors}</div>
            </div>
          {:else}
            <p class="mt-2 font-serif text-[13px] text-neutral-500 italic">Nothing yet.</p>
          {/each}
        </section>
      </div>
    {:else if tab === "telegram"}
      <div
        class="mt-6 grid grid-cols-2 overflow-hidden rounded-md border-t border-l border-[#b8956a]/40 lg:grid-cols-4"
      >
        {#each tgCells as cell}
          <div class="border-r border-b border-[#b8956a]/40 px-3 py-2.5 sm:px-4 sm:py-3">
            <div class="text-[10px] font-semibold tracking-[0.06em] text-neutral-500 sm:text-[10.5px] sm:tracking-[0.08em]">
              {cell.label}
            </div>
            <div class="mt-0.5 text-[20px] font-semibold leading-tight sm:text-[22px]">{cell.value}</div>
            <div class="text-[11px] text-neutral-500">{cell.sub}</div>
          </div>
        {/each}
      </div>

      <div class="mt-8 grid grid-cols-1 gap-8 pb-10 lg:grid-cols-2">
        <section>
          <h2 class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
            TOP CHANNEL POSTS <span class="font-normal">(reads · saves)</span>
          </h2>
          {#each data.topChannel as row}
            <div class="flex items-baseline gap-3 border-b border-[#b8956a]/25 py-2">
              <div class="min-w-0 flex-1">
                <div class="truncate text-[13px] font-medium">{row.title}</div>
                <div class="truncate text-[11px] text-neutral-500">{row.org}</div>
              </div>
              <div class="text-[13px]"><b>{row.reads}</b> · {row.saves}</div>
            </div>
          {:else}
            <p class="mt-2 font-serif text-[13px] text-neutral-500 italic">Nothing yet.</p>
          {/each}
        </section>

        <section>
          <h2 class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
            SUBSCRIBER GROWTH · 30D
          </h2>
          <svg viewBox="0 0 600 80" class="mt-3 w-full" role="img" aria-label="Subscriber growth">
            <polyline
              points={growthPoints}
              fill="none"
              stroke="#5a4226"
              stroke-width="2"
              stroke-linejoin="round"
            />
            <line x1="0" y1="78.5" x2="600" y2="78.5" stroke="#b8956a" stroke-opacity="0.5" />
          </svg>
          <div class="flex justify-between text-[10.5px] text-neutral-500">
            <span>{fmtDay(data.subscriberGrowth[0].day)}</span>
            <span
              >now <b class="text-neutral-900"
                >{data.subscriberGrowth[data.subscriberGrowth.length - 1].total}</b
              ></span
            >
          </div>
        </section>
      </div>
    {:else}
      <!-- system: health, runs, per-org stats, process logs, product -->
      <div class="mt-5 flex flex-wrap items-center justify-between gap-2">
        <span class="text-[11px] text-neutral-500">
          Export everything below as Markdown — paste it into Claude to analyze.
        </span>
        <div class="flex gap-2">
          <button
            type="button"
            onclick={copyReport}
            class="rounded-md border border-[#b8956a]/50 px-3 py-1.5 text-[11.5px] font-semibold tracking-[0.04em] uppercase {copied
              ? 'bg-[#5a4226] text-[#f8efde]'
              : 'text-[#5a4226] hover:bg-[#b8956a]/20'}"
          >
            {copied ? "Copied ✓" : "Copy report"}
          </button>
          <button
            type="button"
            onclick={downloadReport}
            class="rounded-md border border-[#b8956a]/50 px-3 py-1.5 text-[11.5px] font-semibold tracking-[0.04em] text-[#5a4226] uppercase hover:bg-[#b8956a]/20"
          >
            Download .md
          </button>
        </div>
      </div>
      <div
        class="mt-4 grid grid-cols-2 overflow-hidden rounded-md border-t border-l border-[#b8956a]/40 sm:grid-cols-3 lg:grid-cols-5"
      >
        {#each healthCells as cell}
          <div class="border-r border-b border-[#b8956a]/40 px-4 py-3">
            <div class="flex items-center gap-1.5">
              <span class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-500">
                {cell.label}
              </span>
              <InfoTip {...cell.info} />
            </div>
            <div class="mt-0.5 text-[18px] font-semibold leading-tight">{cell.value}</div>
            <div class="text-[11px] text-neutral-500">{cell.sub}</div>
          </div>
        {/each}
      </div>

      <section class="mt-8">
        <h2 class="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
          SCRAPE RUNS <span class="font-normal">(latest 15)</span>
          <InfoTip {...INFO.runs} />
        </h2>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-[12.5px]">
            <thead>
              <tr class="border-b border-[#b8956a]/40 text-left text-[10.5px] tracking-[0.08em] text-neutral-500">
                <th class="py-1.5 pr-3 font-semibold">SOURCE</th>
                <th class="py-1.5 pr-3 font-semibold">STARTED</th>
                <th class="py-1.5 pr-3 font-semibold">DURATION</th>
                <th class="py-1.5 pr-3 text-right font-semibold">NEW</th>
                <th class="py-1.5 pr-3 text-right font-semibold">UPDATED</th>
                <th class="py-1.5 text-right font-semibold">ERRORS</th>
              </tr>
            </thead>
            <tbody>
              {#each data.runs as run}
                <tr class="border-b border-[#b8956a]/25">
                  <td class="py-1.5 pr-3 font-medium">{run.source}</td>
                  <td class="py-1.5 pr-3 text-neutral-600">{fmtTs(run.started)}</td>
                  <td class="py-1.5 pr-3 text-neutral-600">{fmtSecs(run.secs)}</td>
                  <td class="py-1.5 pr-3 text-right">{run.new_count}</td>
                  <td class="py-1.5 pr-3 text-right">{run.updated_count}</td>
                  <td class="py-1.5 text-right {run.error_count > 0 ? 'font-bold' : 'text-neutral-500'}">
                    {run.error_count}{run.error_count > 0 ? " ⚠" : ""}
                  </td>
                </tr>
              {:else}
                <tr><td colspan="6" class="py-3 font-serif text-[13px] text-neutral-500 italic">No runs recorded yet.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      {#if data.orgStats.length}
        <section class="mt-8">
          <h2 class="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
            LAST ORGS RUN — SLOWEST / FAILING
            <InfoTip {...INFO.orgsRun} />
          </h2>
          <div class="mt-1">
            {#each data.orgStats as o}
              <div class="flex items-baseline gap-3 border-b border-[#b8956a]/25 py-1.5 text-[12.5px]">
                <span class="w-40 truncate font-medium">{o.slug}</span>
                <span class="w-32 truncate text-neutral-500">{o.adapter}</span>
                <span class="flex-1 text-right text-neutral-600">{(o.ms / 1000).toFixed(1)}s</span>
                <span class="w-24 text-right {o.errors > 0 ? 'font-bold' : 'text-neutral-500'}">
                  {o.errors > 0 ? `${o.errors} errors ⚠` : `${o.kept} kept`}
                </span>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <section class="mt-8">
        <div class="flex items-baseline justify-between">
          <h2 class="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
            PROCESS LOGS <span class="font-normal">(PM2 tails · refresh every 60s)</span>
            <InfoTip {...INFO.logs} />
          </h2>
          <div class="flex gap-1">
            {#each data.processLogs as p}
              <button
                type="button"
                onclick={() => (logProc = p.name)}
                class="rounded px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.06em] {logProc ===
                p.name
                  ? 'bg-[#5a4226] text-[#f8efde]'
                  : 'text-neutral-500 hover:text-neutral-900'}"
              >
                {p.name}
              </button>
            {/each}
          </div>
        </div>

        {#if currentLog}
          <div class="mt-3 space-y-4">
            <div>
              <h3 class="text-[10px] font-semibold tracking-[0.08em] text-neutral-500">ERROR LOG</h3>
              <div
                class="mt-1 max-h-64 overflow-y-auto rounded-md border border-[#b8956a]/30 bg-[#e9dfc4] p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all"
              >
                {#if currentLog.err?.length}
                  {#each currentLog.err as line}<div
                      class={isErrLine(line) ? "font-semibold" : "text-neutral-700"}
                    >{line}</div>{/each}
                {:else}
                  <span class="font-serif text-[12px] text-neutral-500 italic"
                    >{currentLog.err === null ? "No log file found (PM2 not running here?)" : "Empty — no errors logged."}</span
                  >
                {/if}
              </div>
            </div>
            <div>
              <h3 class="text-[10px] font-semibold tracking-[0.08em] text-neutral-500">OUTPUT LOG</h3>
              <div
                class="mt-1 max-h-64 overflow-y-auto rounded-md border border-[#b8956a]/30 bg-[#e9dfc4] p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all"
              >
                {#if currentLog.out?.length}
                  {#each currentLog.out as line}<div
                      class={isErrLine(line) ? "font-semibold" : "text-neutral-700"}
                    >{line}</div>{/each}
                {:else}
                  <span class="font-serif text-[12px] text-neutral-500 italic"
                    >No log file found{currentLog.out === null ? " (PM2 not running here?)" : ""}.</span
                  >
                {/if}
              </div>
            </div>
          </div>
        {/if}
      </section>

      <!-- product -->
      <section class="mt-8 pb-10">
        <h2 class="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
          PRODUCT
          <InfoTip {...INFO.product} />
        </h2>
        <div
          class="mt-2 grid grid-cols-2 overflow-hidden rounded-md border-t border-l border-[#b8956a]/40 sm:grid-cols-3 lg:grid-cols-5"
        >
          {#each productCells as cell}
            <div class="border-r border-b border-[#b8956a]/40 px-4 py-2.5">
              <div class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-500">
                {cell.label}
              </div>
              <div class="mt-0.5 text-[18px] font-semibold leading-tight">{cell.value}</div>
            </div>
          {/each}
        </div>

        <div class="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-neutral-600">
          <span class="font-semibold tracking-[0.06em] text-neutral-500">ACTIVE BY SOURCE</span>
          {#each data.bySource as s}
            <span>{s.source} · <b>{s.active}</b></span>
          {/each}
        </div>
      </section>
    {/if}
  </div>
</div>
