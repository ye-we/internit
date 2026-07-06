<script lang="ts">
  import {
    Share,
    Check,
    LayoutList,
    Target,
    Coins,
    AlarmClock,
    Asterisk,
    ArrowLeft,
  } from "@lucide/svelte";
  import * as Select from "$lib/components/ui/select/index.js";
  import { SvelteSet } from "svelte/reactivity";
  import SidebarShell from "./sidebar-shell.svelte";
  import BookmarkButton from "./bookmark-button.svelte";
  import ReminderButton from "./reminder-button.svelte";
  import UserActions from "./user-actions.svelte";
  import { page } from "$app/state";
  import type { ListingView } from "$lib/server/listings";

  let {
    listings,
    bookmarkedIds,
    user,
    emptyMessage = "No listings.",
  }: {
    listings: ListingView[];
    bookmarkedIds: string[];
    user: { name: string } | null;
    emptyMessage?: string;
  } = $props();

  const signedIn = $derived(!!user);
  const backLabel = $derived(
    page.url.pathname.startsWith("/saved") ? "Saved" : "Discover",
  );

  // svelte-ignore state_referenced_locally
  const bookmarked = new SvelteSet<string>(bookmarkedIds);
  $effect(() => {
    bookmarked.clear();
    for (const id of bookmarkedIds) bookmarked.add(id);
  });

  const fieldOptions = [
    { value: "all", label: "All fields" },
    { value: "policy", label: "Policy" },
    { value: "human-rights", label: "Human rights" },
    { value: "peace-conflict", label: "Peace & conflict" },
    { value: "gender", label: "Gender" },
  ];

  const sourceOptions = [
    { value: "all", label: "All sources" },
    { value: "un-careers", label: "UN Careers" },
    { value: "undp", label: "UNDP" },
    { value: "unicef", label: "UNICEF" },
  ];

  let fieldValue = $state("all");
  let sourceValue = $state("all");
  let searchValue = $state("");
  let payFilter = $state("all");

  const fieldLabel = $derived(
    fieldOptions.find((o) => o.value === fieldValue)?.label,
  );
  const sourceLabel = $derived(
    sourceOptions.find((o) => o.value === sourceValue)?.label,
  );

  const filteredListings = $derived(
    listings.filter((l) => {
      const sourceOk =
        sourceValue === "all" || l.source.toLowerCase() === sourceValue;
      const fieldOk = fieldValue === "all" || l.tags.includes(fieldValue);
      const payOk = payFilter === "all" || l.pay !== "Unpaid";
      const q = searchValue.trim().toLowerCase();
      const searchOk =
        q === "" ||
        l.title.toLowerCase().includes(q) ||
        l.org.toLowerCase().includes(q) ||
        l.location.toLowerCase().includes(q);

      return sourceOk && fieldOk && payOk && searchOk;
    }),
  );

  // Channel "Read" links land on /?listing=<id> — focus that listing on load.
  const focusId = page.url.searchParams.get("listing");
  let selectedId = $state<string | null>(focusId);
  // On mobile the list and detail are separate views; this toggles between them.
  let showDetailMobile = $state(!!focusId);
  const selected = $derived(
    filteredListings.find((l) => l.id === selectedId) ?? filteredListings[0],
  );

  // The reader pane is one scroll container reused across listings — jump back
  // to the top when the selection changes, or the next listing opens mid-scroll.
  let readerEl = $state<HTMLDivElement | null>(null);
  $effect(() => {
    void selected?.id;
    readerEl?.scrollTo(0, 0);
  });

  // Share a listing: native share sheet where available (mobile), otherwise
  // copy the deep link and flash a check on the button that was clicked.
  // ref=share makes shared links attributable in analytics referrers.
  let sharedId = $state<string | null>(null);
  async function share(id: string, title: string) {
    const url = `${location.origin}/?listing=${id}&ref=share`;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        return; // user dismissed the sheet — not an error, don't fall through
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      sharedId = id;
      setTimeout(() => (sharedId = sharedId === id ? null : sharedId), 2000);
    } catch {
      /* clipboard blocked — nothing sensible to do */
    }
  }

  // Analytics beacon (fire-and-forget; keepalive survives the navigation away
  // on apply clicks). Server-side tracking can't see these — the board is one
  // page, so selecting a listing never navigates.
  function track(type: "listing_view" | "apply_click", listingId: string) {
    fetch("/api/track", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, listingId }),
    }).catch(() => {});
  }

  // Apply target: a direct link when we have one, else a mailto when the org
  // applies by email, else the source page.
  const applyHref = $derived(
    selected?.applyUrl ??
      (selected?.applyEmail
        ? `mailto:${selected.applyEmail}?subject=${encodeURIComponent(`Application — ${selected.title}`)}`
        : selected?.sourceUrl),
  );
  const applyLabel = $derived(
    selected?.applyUrl ? "Apply at source" : selected?.applyEmail ? "Apply by email" : "Open source",
  );

  const summary = $derived.by(() => {
    const total = filteredListings.length;
    const avgFit = total
      ? Math.round(filteredListings.reduce((s, l) => s + l.fit, 0) / total)
      : 0;
    const unpaid = filteredListings.filter((l) => l.pay === "Unpaid").length;
    const closingSoon = filteredListings.filter(
      (l) => /^\d+d$/.test(l.status) && parseInt(l.status) <= 7,
    ).length;
    return [
      { icon: LayoutList, label: "Listings", value: String(total) },
      { icon: Target, label: "Avg fit", value: String(avgFit) },
      { icon: Coins, label: "Unpaid", value: String(unpaid) },
      { icon: AlarmClock, label: "Closing", value: String(closingSoon) },
    ];
  });

  const metaCells = $derived(
    selected
      ? [
          { label: "DEADLINE", value: selected.date },
          { label: "DAYS", value: selected.status },
          { label: "PAY", value: selected.pay },
          { label: "FIT", value: String(selected.fit) },
          { label: "STATUS", value: "active" },
        ]
      : [],
  );
</script>

<div
  class="flex h-dvh flex-col overflow-hidden bg-[#f0e6d2] font-sans text-neutral-900 antialiased"
>
  <div class="grid min-h-0 flex-1 grid-rows-1 lg:grid-cols-[420px_1fr]">
    <SidebarShell
      {user}
      {summary}
      mobileSearch={searchBar}
      class={showDetailMobile ? "hidden lg:flex" : "flex"}
    >
      {#each filteredListings as listing, i}
        {@const isActive = selected?.id === listing.id}
        <button
          type="button"
          onclick={() => {
            selectedId = listing.id;
            showDetailMobile = true;
            track("listing_view", listing.id);
          }}
          class="group relative block w-full px-4 py-3 text-left transition-colors {i <
          filteredListings.length - 1
            ? 'border-b border-[#b8956a]/25'
            : ''} {isActive
            ? 'bg-[#b8956a]/20 font-semibold text-neutral-900'
            : 'hover:bg-[#b8956a]/10'}"
        >
          {#if isActive}
            <span class="absolute inset-y-0 left-0 w-1 bg-[#5a4226]"></span>
          {/if}
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div
                class="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.06em] {isActive
                  ? 'text-neutral-600'
                  : 'text-neutral-500'}"
              >
                <span class="uppercase">{listing.source}</span>
                <span class="opacity-50">/</span>
                <span class="truncate font-medium normal-case tracking-normal">
                  {listing.org}
                </span>
              </div>
              <h2
                class="mt-1.5 truncate font-serif text-[17px] leading-snug font-semibold tracking-tight"
              >
                {listing.title}
              </h2>
              <div
                class="mt-1 flex items-center gap-2.5 text-[12.5px] {isActive
                  ? 'text-neutral-600'
                  : 'text-neutral-500'}"
              >
                <span class="shrink-0">{listing.date}</span>
                <span class="shrink-0 opacity-50">·</span>
                <span class="min-w-0 truncate uppercase"
                  >{listing.location}</span
                >
                <span class="shrink-0 opacity-50">·</span>
                <span class="min-w-0 truncate">{listing.pay}</span>
              </div>
            </div>
            <div class="flex flex-col items-end gap-1">
              <div
                class="flex size-8 items-center justify-center border text-[13px] font-semibold {isActive
                  ? 'border-[#5a4226]/50 text-neutral-900'
                  : 'border-[#8a6e47]/60 text-neutral-800'}"
              >
                {listing.fit}
              </div>
              <span
                class="text-[11px] {isActive
                  ? 'text-neutral-600'
                  : 'text-neutral-500'}"
              >
                {listing.status}
              </span>
            </div>
          </div>
          <div
            class="mt-2.5 flex items-center gap-1.5 transition-opacity {isActive
              ? ''
              : 'opacity-0 group-hover:opacity-100'}"
          >
            <span
              class="flex size-6 items-center justify-center rounded border {isActive
                ? 'border-[#5a4226]/30 text-neutral-700'
                : 'border-[#b8956a]/40 text-neutral-600'}"
            >
              <BookmarkButton id={listing.id} {bookmarked} {signedIn} />
            </span>
            <span
              class="flex size-6 items-center justify-center rounded border {isActive
                ? 'border-[#5a4226]/30 text-neutral-700'
                : 'border-[#b8956a]/40 text-neutral-600'}"
            >
              <ReminderButton id={listing.id} />
            </span>
            <!-- span, not <button>: the whole row is already a button and nested
                 buttons are invalid HTML. Keyboard users share via the detail
                 toolbar's real button. -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_interactive_supports_focus -->
            <span
              role="button"
              aria-label="Copy share link"
              onclick={(e) => {
                e.stopPropagation();
                share(listing.id, listing.title);
              }}
              class="flex size-6 items-center justify-center rounded border transition-colors hover:text-[#5a4226] {isActive
                ? 'border-[#5a4226]/30 text-neutral-700'
                : 'border-[#b8956a]/40 text-neutral-600'}"
            >
              {#if sharedId === listing.id}
                <Check class="size-3 text-[#5a4226]" />
              {:else}
                <Share class="size-3" />
              {/if}
            </span>
          </div>
        </button>
      {:else}
        <div class="flex h-full items-center justify-center p-8 text-center">
          <span class="font-serif text-[14px] text-neutral-500 italic"
            >{emptyMessage}</span
          >
        </div>
      {/each}
    </SidebarShell>

    {#snippet searchBar()}
      <div
        class="flex h-auto flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-[#b8956a]/40 px-4 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] lg:h-12 lg:flex-nowrap lg:py-0"
      >
        <div
          class="flex min-w-0 basis-full items-center gap-2 lg:basis-auto lg:flex-1"
        >
          <span
            class="font-serif text-[12.5px] tracking-tight text-[#5a4226] italic select-none"
          >
            find
          </span>
          <span class="text-[#b8956a]/70 select-none">—</span>
          <input
            bind:value={searchValue}
            type="text"
            placeholder="title, org, or location"
            class="h-9 flex-1 border-0 bg-transparent text-[13px] placeholder:font-serif placeholder:text-neutral-400 placeholder:italic focus:ring-0 focus:outline-none"
          />
        </div>

        <span class="hidden h-4 w-px bg-[#b8956a]/40 lg:block"></span>

        <Select.Root type="single" bind:value={fieldValue}>
          <Select.Trigger
            class="h-auto! w-auto! gap-1! rounded-none! border-0! bg-transparent! p-0! text-[10.5px]! font-medium! tracking-[0.1em]! text-neutral-700! shadow-none! uppercase! ring-0! focus:ring-0! hover:text-neutral-900! [&_svg]:size-3 [&_svg]:text-[#8a6e47]"
          >
            {fieldLabel}
          </Select.Trigger>
          <Select.Content class="border-[#b8956a]/40 bg-[#f0e6d2]">
            {#each fieldOptions as opt}
              <Select.Item
                value={opt.value}
                label={opt.label}
                class="data-highlighted:bg-[#b8956a]/30! data-highlighted:text-neutral-900! focus:bg-[#b8956a]/30! focus:text-neutral-900!"
              >
                {opt.label}
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
        <Select.Root type="single" bind:value={sourceValue}>
          <Select.Trigger
            class="h-auto! w-auto! gap-1! rounded-none! border-0! bg-transparent! p-0! text-[10.5px]! font-medium! tracking-[0.1em]! text-neutral-700! shadow-none! uppercase! ring-0! focus:ring-0! hover:text-neutral-900! [&_svg]:size-3 [&_svg]:text-[#8a6e47]"
          >
            {sourceLabel}
          </Select.Trigger>
          <Select.Content class="border-[#b8956a]/40 bg-[#f0e6d2]">
            {#each sourceOptions as opt}
              <Select.Item
                value={opt.value}
                label={opt.label}
                class="data-highlighted:bg-[#b8956a]/30! data-highlighted:text-neutral-900! focus:bg-[#b8956a]/30! focus:text-neutral-900!"
              >
                {opt.label}
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>

        <span class="hidden h-4 w-px bg-[#b8956a]/40 lg:block"></span>

        <div
          class="flex items-center gap-2.5 text-[10.5px] tracking-[0.1em] uppercase"
        >
          <button
            onclick={() => (payFilter = "paid")}
            type="button"
            class="flex items-center gap-1 font-medium {payFilter == 'paid'
              ? 'text-neutral-900 font-semibold'
              : 'text-neutral-500 hover:text-neutral-900'}"
          >
            {#if payFilter === "paid"}
              <Asterisk class="size-2.5 text-[#5a4226]" strokeWidth={2.5} />
            {/if}
            paid
          </button>
          <button
            onclick={() => (payFilter = "all")}
            type="button"
            class="flex items-center gap-1 {payFilter == 'all'
              ? 'text-neutral-900 font-semibold'
              : 'font-medium text-neutral-500 hover:text-neutral-900'}"
          >
            {#if payFilter === "all"}
              <Asterisk class="size-2.5 text-[#5a4226]" strokeWidth={2.5} />
            {/if}
            all
          </button>
        </div>

        <span class="hidden h-4 w-px bg-[#b8956a]/40 lg:block"></span>

        <span
          class="ml-auto font-serif text-[12.5px] text-neutral-600 italic select-none lg:ml-0"
        >
          <span class="font-semibold text-[#5a4226] not-italic"
            >{filteredListings.length}</span
          ><span class="text-[#b8956a]/80"> / </span>{listings.length} active
        </span>
      </div>
    {/snippet}

    <main
      class="{showDetailMobile
        ? 'flex'
        : 'hidden lg:flex'} min-h-0 flex-col overflow-hidden"
    >
      <div class="shrink-0 px-3 pt-3 lg:hidden">
        <div
          class="flex h-12 items-center gap-2.5 rounded-md border border-[#b8956a]/40 bg-[#f0e3c4]/40 px-3 shadow-[0_1px_0_rgba(0,0,0,0.03)] backdrop-blur-sm sm:px-3.5"
        >
          <button
            type="button"
            onclick={() => (showDetailMobile = false)}
            class="group flex items-baseline gap-2 text-[#5a4226] transition-colors hover:text-[#7a5631]"
          >
            <ArrowLeft
              class="size-4 -translate-y-px self-center transition-transform group-hover:-translate-x-0.5"
              strokeWidth={2}
            />
            <span class="font-serif text-[15px] tracking-tight italic"
              >{backLabel}</span
            >
          </button>
          <UserActions {user} class="ml-auto" />
        </div>
      </div>

      <div class="hidden shrink-0 pt-3 pr-3 pb-3 lg:block">
        {@render searchBar()}
      </div>

      <div
        class="relative min-h-0 flex-1 border-[#b8956a]/40 lg:rounded-tl-md lg:border-t lg:border-l"
      >
        <div
          bind:this={readerEl}
          class="absolute inset-0 overflow-y-auto overscroll-contain px-4 pt-5 pb-16 sm:px-6 lg:px-10 lg:pt-6"
        >
          {#if selected}
            <div
              class="flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-neutral-500"
            >
              <span class="shrink-0 uppercase">{selected.source}</span>
              <span class="shrink-0 opacity-50">/</span>
              <span class="min-w-0 truncate uppercase">{selected.org}</span>
              <span class="shrink-0 opacity-40">·</span>
              <span
                class="shrink-0 font-normal whitespace-nowrap normal-case tracking-normal"
                >scraped {selected.scrapedAt}</span
              >
            </div>

            <h1
              class="mt-2 font-serif text-[30px] leading-[1.1] font-semibold tracking-tight sm:text-[36px] lg:text-[44px]"
            >
              {selected.title}
            </h1>

            <div
              class="mt-7 grid grid-cols-2 overflow-hidden rounded-md border-t border-l border-[#b8956a]/40 sm:grid-cols-3 lg:grid-cols-5"
            >
              {#each metaCells as cell, i}
                <div
                  class="border-r border-b border-[#b8956a]/40 px-4 py-2.5 {i ===
                  metaCells.length - 1
                    ? 'col-span-2 lg:col-span-1'
                    : ''}"
                >
                  <div
                    class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-500"
                  >
                    {cell.label}
                  </div>
                  <div class="mt-0.5 text-[15px] font-semibold leading-tight">
                    {cell.value}
                  </div>
                </div>
              {/each}
            </div>

            <div class="mt-5 flex flex-wrap gap-1.5">
              {#each selected.tags as tag}
                <span
                  class="rounded-md border border-[#b8956a]/40 px-2.5 py-1 text-[12.5px] text-neutral-700"
                >
                  {tag}
                </span>
              {/each}
            </div>

            <div
              class="mt-5 inline-flex h-9 overflow-hidden rounded-md border border-[#b8956a]/40"
            >
              <a
                href={applyHref}
                target="_blank"
                rel="noopener noreferrer"
                onclick={() => selected && track("apply_click", selected.id)}
                class="flex h-full items-center bg-[#5a4226] px-4 text-[13px] font-semibold text-[#f8efde] hover:bg-[#7a5631]"
              >
                {applyLabel}
              </a>
              <span
                class="flex h-full items-center justify-center border-l border-[#b8956a]/40 px-3 text-neutral-700 hover:bg-[#b8956a]/25"
              >
                <BookmarkButton
                  id={selected.id}
                  {bookmarked}
                  {signedIn}
                  size="size-3.5"
                />
              </span>
              <span
                class="flex h-full items-center justify-center border-l border-[#b8956a]/40 px-3 text-neutral-700 hover:bg-[#b8956a]/25"
              >
                <ReminderButton id={selected.id} size="size-3.5" />
              </span>
              <button
                type="button"
                aria-label="Copy share link"
                onclick={() => selected && share(selected.id, selected.title)}
                class="flex h-full items-center justify-center border-l border-[#b8956a]/40 px-3 hover:bg-[#b8956a]/25"
              >
                {#if selected && sharedId === selected.id}
                  <Check class="size-3.5 text-[#5a4226]" />
                {:else}
                  <Share class="size-3.5" />
                {/if}
              </button>
            </div>

            {#if selected.applyUrl || selected.applyEmail}
              <p class="mt-2 text-[11.5px] text-neutral-500">
                {selected.applyUrl ? "Applies directly at the source." : "Applies by email."} Listing via
                <a
                  href={selected.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="underline decoration-[#b8956a]/60 underline-offset-2 hover:text-neutral-800"
                  >{selected.source.toLowerCase()}</a
                >.
              </p>
            {/if}

            {#if selected.sections?.length}
              <!-- Cleaned reader mode: the structurer's sections, not the raw dump. -->
              <section class="mt-9 max-w-3xl">
                {#each selected.sections as section}
                  <h3
                    class="mt-7 font-serif text-[19px] leading-snug font-semibold tracking-tight text-neutral-900 first:mt-0"
                  >
                    {section.title}
                  </h3>
                  {#each section.paragraphs as para}
                    <p class="mt-2.5 text-[14px] leading-7 text-neutral-800">{para}</p>
                  {/each}
                  {#if section.bullets.length}
                    <ul
                      class="mt-2.5 list-disc space-y-1.5 pl-5 text-[14px] leading-7 text-neutral-800 marker:text-[#b8956a]"
                    >
                      {#each section.bullets as bullet}
                        <li>{bullet}</li>
                      {/each}
                    </ul>
                  {/if}
                {/each}
              </section>
            {:else}
              <section class="mt-10 max-w-3xl">
                <h3
                  class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600"
                >
                  SOURCE TEXT
                </h3>
                {#if selected.sourceHtml}
                  <!-- sanitized server-side in mapListing() -->
                  <div
                    class="prose prose-sm prose-neutral mt-3 max-w-none text-[14px] leading-7 text-neutral-800 prose-headings:text-[14px] prose-headings:font-semibold prose-a:text-neutral-900"
                  >
                    {@html selected.sourceHtml}
                  </div>
                {:else}
                  <p class="mt-3 text-[14px] leading-7 text-neutral-800">
                    {selected.sourceText}
                  </p>
                {/if}
              </section>
            {/if}
          {:else}
            <div class="flex h-full items-center justify-center">
              <span class="font-serif text-[15px] text-neutral-500 italic"
                >{emptyMessage}</span
              >
            </div>
          {/if}
        </div>
        <div
          class="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#f0e6d2] via-[#f0e6d2]/70 to-transparent"
        ></div>
      </div>
    </main>
  </div>
</div>
