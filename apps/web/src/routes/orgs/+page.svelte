<script lang="ts">
  import {
    Globe,
    Briefcase,
    GraduationCap,
    Mail,
    AtSign,
    Link as LinkIcon,
    Send,
    Building2,
    ExternalLink,
    Asterisk,
    ArrowLeft,
  } from "@lucide/svelte";
  import * as Select from "$lib/components/ui/select/index.js";
  import SidebarShell from "$lib/components/sidebar-shell.svelte";
  import UserActions from "$lib/components/user-actions.svelte";

  let { data } = $props();

  const orgs = $derived(data.orgs);

  const categoryOptions = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const o of orgs) counts.set(o.category, (counts.get(o.category) ?? 0) + 1);
    return [
      { value: "all", label: `All categories (${orgs.length})` },
      ...[...counts.keys()].sort().map((c) => ({ value: c, label: `${c} (${counts.get(c)})` })),
    ];
  });

  let categoryValue = $state("all");
  let searchValue = $state("");
  // Server delivers best-first (actionability rank); A–Z is the lookup fallback.
  let sortValue = $state<"best" | "az">("best");

  const categoryLabel = $derived(
    categoryOptions.find((o) => o.value === categoryValue)?.label ??
      "All categories",
  );

  const filteredOrgs = $derived.by(() => {
    const filtered = orgs.filter((o) => {
      const catOk = categoryValue === "all" || o.category === categoryValue;
      const q = searchValue.trim().toLowerCase();
      const searchOk =
        q === "" ||
        o.name.toLowerCase().includes(q) ||
        o.category.toLowerCase().includes(q) ||
        o.region.toLowerCase().includes(q);
      return catOk && searchOk;
    });
    return sortValue === "az"
      ? [...filtered].sort((a, b) => a.name.localeCompare(b.name))
      : filtered;
  });

  // What can a student DO with this org — shown as row badges, best signal first.
  function badges(o: (typeof orgs)[number]): string[] {
    const out: string[] = [];
    if (o.activeCount > 0) out.push("hiring now");
    if (o.applicationEmail) out.push("email");
    if (o.internshipUrl) out.push("internships");
    if (o.addisOffice) out.push("addis");
    if (out.length === 0 && o.careersUrl) out.push("careers page");
    return out.slice(0, 3);
  }

  // Prefilled cold-outreach draft: shown in full on the page and opened in the
  // student's mail app; blanks (____) are theirs to personalize.
  function emailTemplate(o: { name: string }): { subject: string; body: string } {
    return {
      subject: "Internship inquiry — social-studies student",
      body:
        `Dear ${o.name} team,\n\n` +
        `My name is ____, a senior social-studies student at ____ University in Ethiopia. ` +
        `I am writing to ask whether ${o.name} accepts interns or volunteers in the coming months.\n\n` +
        `I am particularly interested in ____, and I have attached my CV. ` +
        `I would be glad to share anything else you need.\n\n` +
        `Thank you for your time,\n____`,
    };
  }
  function emailHref(o: { name: string; applicationEmail: string | null }): string {
    const t = emailTemplate(o);
    return `mailto:${o.applicationEmail}?subject=${encodeURIComponent(t.subject)}&body=${encodeURIComponent(t.body)}`;
  }

  let draftCopied = $state(false);
  async function copyDraft() {
    if (!selected) return;
    const t = emailTemplate(selected);
    try {
      await navigator.clipboard.writeText(`Subject: ${t.subject}\n\n${t.body}`);
      draftCopied = true;
      setTimeout(() => (draftCopied = false), 2000);
    } catch {
      /* clipboard blocked — the mailto button still works */
    }
  }

  // Category playbooks — the "how to apply" guidance the directory promises.
  // Written once, per approach pattern; ALIAS maps each category to one.
  type Playbook = { lead: string; steps: string[] };
  const PLAYBOOKS: Record<string, Playbook> = {
    institutional: {
      lead: "Large institutions only take interns through their online portals — an email won't start an application, though it can answer questions. Most internships are unpaid and require current enrollment or recent graduation. Addis duty stations (ECA, AU, agency country offices) are where Ethiopian candidates have the strongest footing.",
      steps: [
        "Check the active listings below first — portal postings close on fixed deadlines",
        "Create your candidate profile on the careers portal now, before a deadline forces it",
        "Search the portal for Addis Ababa or home-based duty stations specifically",
        "Expect 4–8 weeks of silence after applying; that's normal — keep applying elsewhere",
      ],
    },
    embassy: {
      lead: "Embassies rarely advertise internships — they take students informally through political, public-diplomacy, or cultural sections, and a short, well-aimed email is the accepted way in. Rules differ sharply by country: some only take their own citizens, others welcome host-country students.",
      steps: [
        "Email the section you want to work in, not the general inbox, if you can find it",
        "Keep it under 150 words: who you are, your university, one concrete thing you'd help with",
        "Attach a one-page CV and offer a faculty reference",
        "No reply in two weeks → one polite follow-up, then move on",
      ],
    },
    bilateral: {
      lead: "Bilateral development agencies hire through their country offices; internships surface on the agency careers page under the Ethiopia office, and program teams sometimes take interns on direct inquiry.",
      steps: [
        "Watch the careers page for Ethiopia-office postings",
        "Name the sector you'd serve (governance, peacebuilding, migration) in any inquiry",
        "German, French, and Nordic agencies value language ability — mention any you have",
      ],
    },
    thinktank: {
      lead: "Think tanks respond to specifics, not form letters. A note that names one of their programs or a recent publication — and offers a concrete skill like data work, literature review, translation, or field notes — opens doors job boards never show.",
      steps: [
        "Read one recent paper; reference it in your first two sentences",
        "Write to the program lead or research director, not info@",
        "Offer one specific thing you can do for them this term",
        "Attach a short writing sample if you have one",
      ],
    },
    academic: {
      lead: "Research centers and universities take interns as research assistants through individual professors and program coordinators, almost never through formal postings.",
      steps: [
        "Identify the researcher whose work matches your coursework",
        "Email them citing the specific project you'd assist",
        "Ask your department advisor for a one-line introduction — it doubles reply rates",
      ],
    },
    advocacy: {
      lead: "Advocacy and civil-society organizations run lean, and volunteering is often the doorway to an internship. Concrete skills — monitoring, documentation, report writing, translation, social media — are what they need most. For Ethiopian CSOs, check the notes for registration context and apply with eyes open.",
      steps: [
        "Offer to volunteer on something specific before asking about internships",
        "Lead with a skill they can use this month, not your career goals",
        "Smaller orgs reply faster — don't only aim at the famous names",
      ],
    },
    ingo: {
      lead: "INGOs recruit through country-office HR, and internships appear on their careers pages under the Ethiopia office. Program teams (governance, protection, MEAL) sometimes take interns on inquiry when nothing is posted.",
      steps: [
        "Check the careers page filtered to Ethiopia first",
        "For cold inquiries, write to the country office and name the program area",
        "MEAL and data skills are chronically short-staffed — lead with them if you have them",
      ],
    },
    foundation: {
      lead: "Foundations mostly fund rather than host, so internships are rare and informal — but program officers do take students for research and grants support when asked directly.",
      steps: [
        "Study what they fund in Ethiopia before writing",
        "Propose a small, bounded task — a landscape scan, grantee research",
        "Expect slower replies; follow up once after two weeks",
      ],
    },
    gov: {
      lead: "Ministries and public agencies take student attachés through formal channels: a letter from your university department, routed through the ministry's HR or training directorate. Bureaucratic but reliable — paperwork beats persistence here.",
      steps: [
        "Ask your department for an official attachment letter first",
        "Deliver it to the ministry's HR or training directorate, in person if you can",
        "State your required attachment period and faculty supervisor up front",
      ],
    },
    default: {
      lead: "General rule for cold outreach: find the person closest to the work you want, write short and specific, attach your CV.",
      steps: [
        "Use the links above to find the right contact",
        "Keep the first note under 150 words",
        "One follow-up after two weeks, then move on",
      ],
    },
  };
  const ALIAS: Record<string, string> = {
    un: "institutional", au: "institutional", multilateral: "institutional", regional: "institutional",
    embassy: "embassy", bilateral: "bilateral",
    "think-tank": "thinktank", academic: "academic",
    "human-rights": "advocacy", peace: "advocacy", election: "advocacy", democracy: "advocacy",
    governance: "advocacy", gender: "advocacy", migration: "advocacy", climate: "advocacy",
    media: "advocacy", "digital-rights": "advocacy",
    ingo: "ingo", foundation: "foundation", gov: "gov",
  };


  let selectedSlug = $state<string | null>(null);
  let showDetailMobile = $state(false);
  const selected = $derived(
    filteredOrgs.find((o) => o.slug === selectedSlug) ?? filteredOrgs[0],
  );

  const playbook = $derived(
    selected ? (PLAYBOOKS[ALIAS[selected.category] ?? "default"] ?? PLAYBOOKS.default) : null,
  );

  // Onward discovery: strongest same-category orgs (list is already reach-ranked).
  const similarOrgs = $derived(
    selected
      ? orgs.filter((o) => o.category === selected.category && o.slug !== selected.slug).slice(0, 3)
      : [],
  );

  // Most-direct way in, used for the detail pane's primary button.
  const reachAction = $derived.by(() => {
    if (!selected) return null;
    if (selected.applicationEmail)
      return { label: "Email introduction", href: emailHref(selected), external: false };
    if (selected.internshipUrl)
      return { label: "Open internship page", href: selected.internshipUrl, external: true };
    if (selected.careersUrl)
      return { label: "Open careers page", href: selected.careersUrl, external: true };
    if (selected.website)
      return { label: "Open website", href: selected.website, external: true };
    return null;
  });

  const summary = $derived.by(() => {
    const total = filteredOrgs.length;
    const withActive = filteredOrgs.filter((o) => o.activeCount > 0).length;
    const email = filteredOrgs.filter((o) => o.applicationEmail).length;
    const addis = filteredOrgs.filter((o) => o.addisOffice).length;
    return [
      { icon: Building2, label: "Orgs", value: String(total) },
      { icon: Briefcase, label: "Hiring", value: String(withActive) },
      { icon: Mail, label: "Email", value: String(email) },
      { icon: GraduationCap, label: "Addis", value: String(addis) },
    ];
  });

  function socialHref(kind: "twitter" | "linkedin" | "telegram", v: string) {
    if (v.startsWith("http")) return v;
    const handle = v.replace(/^@/, "");
    if (kind === "twitter") return `https://x.com/${handle}`;
    if (kind === "telegram") return `https://t.me/${handle}`;
    return `https://www.linkedin.com/${handle}`;
  }

  const links = $derived(
    selected
      ? [
          selected.website && {
            icon: Globe,
            label: "Website",
            href: selected.website,
          },
          selected.careersUrl && {
            icon: Briefcase,
            label: "Careers",
            href: selected.careersUrl,
          },
          selected.internshipUrl && {
            icon: GraduationCap,
            label: "Internships",
            href: selected.internshipUrl,
          },
          selected.applicationEmail && {
            icon: Mail,
            label: "Email",
            href: `mailto:${selected.applicationEmail}`,
          },
          selected.twitter && {
            icon: AtSign,
            label: "Twitter",
            href: socialHref("twitter", selected.twitter),
          },
          selected.linkedin && {
            icon: LinkIcon,
            label: "LinkedIn",
            href: socialHref("linkedin", selected.linkedin),
          },
          selected.telegram && {
            icon: Send,
            label: "Telegram",
            href: socialHref("telegram", selected.telegram),
          },
        ].filter(
          (l): l is { icon: typeof Globe; label: string; href: string } =>
            Boolean(l),
        )
      : [],
  );

  const metaCells = $derived(
    selected
      ? [
          { label: "CATEGORY", value: selected.category },
          { label: "REGION", value: selected.region },
          { label: "ACTIVE", value: String(selected.activeCount) },
          { label: "PAID", value: selected.hasPaid },
          { label: "REMOTE", value: selected.hasRemote },
        ]
      : [],
  );
</script>

<div
  class="flex h-dvh flex-col overflow-hidden bg-[#f0e6d2] font-sans text-neutral-900 antialiased"
>
  <div class="grid min-h-0 flex-1 grid-rows-1 lg:grid-cols-[420px_1fr]">
    <SidebarShell
      user={data.user}
      {summary}
      mobileSearch={searchBar}
      class={showDetailMobile ? "hidden lg:flex" : "flex"}
    >
      {#each filteredOrgs as org, i}
        {@const isActive = selected?.slug === org.slug}
        <button
          type="button"
          onclick={() => {
            selectedSlug = org.slug;
            showDetailMobile = true;
          }}
          class="group relative block w-full px-4 py-3 text-left transition-colors {i <
          filteredOrgs.length - 1
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
                <span class="uppercase">{org.category}</span>
                <span class="opacity-50">/</span>
                <span class="truncate font-medium normal-case tracking-normal">
                  {org.region}
                </span>
              </div>
              <h2
                class="mt-1.5 truncate font-serif text-[17px] leading-snug font-semibold tracking-tight"
              >
                {org.name}
              </h2>
              <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                {#each badges(org) as badge}
                  <span
                    class="rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-[0.05em] uppercase {badge ===
                    'hiring now'
                      ? 'border-[#5a4226]/60 bg-[#5a4226] text-[#f8efde]'
                      : 'border-[#b8956a]/50 text-neutral-600'}"
                  >
                    {badge}
                  </span>
                {:else}
                  <span class="text-[11px] text-neutral-400 italic">website only</span>
                {/each}
              </div>
            </div>
          </div>
        </button>
      {:else}
        <div class="flex h-full items-center justify-center p-8 text-center">
          <span class="font-serif text-[14px] text-neutral-500 italic">
            No organizations match your filters.
          </span>
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
            placeholder="name, category, or region"
            class="h-9 flex-1 border-0 bg-transparent text-[13px] placeholder:font-serif placeholder:text-neutral-400 placeholder:italic focus:ring-0 focus:outline-none"
          />
        </div>

        <span class="hidden h-4 w-px bg-[#b8956a]/40 lg:block"></span>

        <Select.Root type="single" bind:value={categoryValue}>
          <Select.Trigger
            class="h-auto! w-auto! gap-1! rounded-none! border-0! bg-transparent! p-0! text-[10.5px]! font-medium! tracking-[0.1em]! text-neutral-700! shadow-none! uppercase! ring-0! focus:ring-0! hover:text-neutral-900! [&_svg]:size-3 [&_svg]:text-[#8a6e47]"
          >
            {categoryLabel}
          </Select.Trigger>
          <Select.Content class="border-[#b8956a]/40 bg-[#f0e6d2]">
            {#each categoryOptions as opt}
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

        <div class="flex items-center gap-2.5 text-[10.5px] tracking-[0.1em] uppercase">
          <button
            onclick={() => (sortValue = "best")}
            type="button"
            class="flex items-center gap-1 {sortValue === 'best'
              ? 'font-semibold text-neutral-900'
              : 'font-medium text-neutral-500 hover:text-neutral-900'}"
          >
            {#if sortValue === "best"}
              <Asterisk class="size-2.5 text-[#5a4226]" strokeWidth={2.5} />
            {/if}
            best
          </button>
          <button
            onclick={() => (sortValue = "az")}
            type="button"
            class="flex items-center gap-1 {sortValue === 'az'
              ? 'font-semibold text-neutral-900'
              : 'font-medium text-neutral-500 hover:text-neutral-900'}"
          >
            {#if sortValue === "az"}
              <Asterisk class="size-2.5 text-[#5a4226]" strokeWidth={2.5} />
            {/if}
            a–z
          </button>
        </div>

        <span class="hidden h-4 w-px bg-[#b8956a]/40 lg:block"></span>

        <span
          class="ml-auto font-serif text-[12.5px] text-neutral-600 italic select-none lg:ml-0"
        >
          <span class="font-semibold text-[#5a4226] not-italic"
            >{filteredOrgs.length}</span
          ><span class="text-[#b8956a]/80"> / </span>{orgs.length} orgs
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
              >Organizations</span
            >
          </button>
          <UserActions user={data.user} class="ml-auto" />
        </div>
      </div>

      <div class="hidden shrink-0 pt-3 pr-3 pb-3 lg:block">
        {@render searchBar()}
      </div>

      <div
        class="relative min-h-0 flex-1 border-[#b8956a]/40 lg:rounded-tl-md lg:border-t lg:border-l"
      >
        <div
          class="absolute inset-0 overflow-y-auto overscroll-contain px-4 pt-5 pb-16 sm:px-6 lg:px-10 lg:pt-6"
        >
          {#if selected}
            <div
              class="flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-neutral-500"
            >
              <span class="shrink-0 uppercase">{selected.category}</span>
              <span class="shrink-0 opacity-50">/</span>
              <span class="min-w-0 truncate uppercase">{selected.region}</span>
            </div>

            <h1
              class="mt-2 font-serif text-[30px] leading-[1.1] font-semibold tracking-tight sm:text-[36px] lg:text-[44px]"
            >
              {selected.name}
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

            {#if reachAction}
              <div class="mt-5">
                <a
                  href={reachAction.href}
                  target={reachAction.external ? "_blank" : undefined}
                  rel={reachAction.external ? "noopener noreferrer" : undefined}
                  class="inline-flex h-9 items-center rounded-md bg-[#5a4226] px-4 text-[13px] font-semibold text-[#f8efde] hover:bg-[#7a5631]"
                >
                  {reachAction.label}
                </a>
                {#if selected.applicationEmail}
                  <p class="mt-2 text-[11.5px] text-neutral-500">
                    Opens a prefilled draft to {selected.applicationEmail} — fill the blanks
                    (name, university, interest) and attach your CV before sending.
                  </p>
                {/if}
              </div>
            {/if}

            {#if links.length}
              <div class="mt-4 flex flex-wrap gap-1.5">
                {#each links as link}
                  {@const Icon = link.icon}
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="flex items-center gap-1.5 rounded-md border border-[#b8956a]/40 px-2.5 py-1 text-[12.5px] text-neutral-700 hover:border-[#5a4226]/40 hover:bg-[#b8956a]/15 hover:text-[#5a4226]"
                  >
                    <Icon class="size-3" />
                    {link.label}
                  </a>
                {/each}
              </div>
            {/if}

            {#if selected.notes}
              <section class="mt-8 max-w-3xl">
                <h3
                  class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600"
                >
                  NOTES
                </h3>
                <p class="mt-3 text-[14px] leading-7 text-neutral-800">
                  {selected.notes}
                </p>
              </section>
            {/if}

            {#if playbook}
              <section class="mt-8 max-w-3xl">
                <h3 class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
                  HOW TO APPROACH
                  <span class="font-normal normal-case tracking-normal">
                    — {selected.category} orgs</span
                  >
                </h3>
                <p class="mt-3 font-serif text-[15.5px] leading-7 text-neutral-800">
                  {playbook.lead}
                </p>
                <ol class="mt-3 space-y-1.5 pl-5 text-[14px] leading-7 text-neutral-800">
                  {#each playbook.steps as step, i}
                    <li class="list-none">
                      <span class="mr-2 font-serif font-semibold text-[#5a4226] italic">{i + 1}.</span
                      >{step}
                    </li>
                  {/each}
                </ol>
              </section>
            {/if}

            {#if selected.applicationEmail}
              {@const draft = emailTemplate(selected)}
              <section class="mt-8 max-w-3xl">
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
                    EMAIL DRAFT
                    <span class="font-normal normal-case tracking-normal">
                      — to {selected.applicationEmail}</span
                    >
                  </h3>
                  <button
                    type="button"
                    onclick={copyDraft}
                    class="rounded-md border border-[#b8956a]/50 px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] uppercase {draftCopied
                      ? 'bg-[#5a4226] text-[#f8efde]'
                      : 'text-[#5a4226] hover:bg-[#b8956a]/20'}"
                  >
                    {draftCopied ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <div class="mt-3 rounded-md border border-[#b8956a]/40 bg-[#ece0c6] px-5 py-4">
                  <p class="text-[12px] text-neutral-500">Subject: {draft.subject}</p>
                  <p class="mt-2.5 text-[13.5px] leading-7 whitespace-pre-line text-neutral-800">
                    {draft.body}
                  </p>
                </div>
                <p class="mt-2 text-[11.5px] text-neutral-500">
                  Fill the ____ blanks (name, university, interest) and attach your CV — a personalized
                  note gets replies; a template sent as-is doesn't.
                </p>
              </section>
            {/if}

            <section class="mt-8 max-w-3xl">
              <h3
                class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600"
              >
                ACTIVE LISTINGS ({selected.activeCount})
              </h3>
              {#if selected.listings.length}
                <div
                  class="mt-3 overflow-hidden rounded-md border border-[#b8956a]/40"
                >
                  {#each selected.listings as listing, i}
                    <a
                      href={listing.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#b8956a]/10 {i <
                      selected.listings.length - 1
                        ? 'border-b border-[#b8956a]/25'
                        : ''}"
                    >
                      <div
                        class="flex size-8 shrink-0 items-center justify-center border border-[#8a6e47]/60 text-[13px] font-semibold text-neutral-800"
                      >
                        {listing.fit}
                      </div>
                      <div class="min-w-0 flex-1">
                        <div
                          class="truncate font-serif text-[15px] font-semibold tracking-tight"
                        >
                          {listing.title}
                        </div>
                        <div
                          class="mt-0.5 flex items-center gap-2 text-[12px] text-neutral-500"
                        >
                          <span>{listing.date}</span>
                          <span class="opacity-50">·</span>
                          <span class="uppercase">{listing.location}</span>
                          <span class="opacity-50">·</span>
                          <span>{listing.pay}</span>
                        </div>
                      </div>
                      <span class="shrink-0 text-[11px] text-neutral-500"
                        >{listing.status}</span
                      >
                      <ExternalLink
                        class="size-3.5 shrink-0 text-neutral-400 group-hover:text-[#5a4226]"
                      />
                    </a>
                  {/each}
                </div>
              {:else}
                <p class="mt-3 font-serif text-[14px] text-neutral-500 italic">
                  No active listings right now{selected.pastListings.length
                    ? " — but they have posted before, so cold outreach is worth it"
                    : ""}.
                </p>
              {/if}
            </section>

            {#if selected.pastListings.length}
              <section class="mt-8 max-w-3xl">
                <h3 class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
                  PREVIOUSLY SEEN
                  <span class="font-normal normal-case tracking-normal">
                    — proof they take interns</span
                  >
                </h3>
                <div class="mt-3">
                  {#each selected.pastListings as p}
                    <div
                      class="flex items-baseline gap-3 border-b border-[#b8956a]/25 py-2 text-[13.5px]"
                    >
                      <span class="min-w-0 flex-1 truncate text-neutral-700">{p.title}</span>
                      <span class="shrink-0 text-[11.5px] text-neutral-500">closed {p.when}</span>
                    </div>
                  {/each}
                </div>
              </section>
            {/if}

            {#if similarOrgs.length}
              <section class="mt-8 max-w-3xl pb-4">
                <h3 class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600">
                  MORE LIKE THIS
                </h3>
                <div class="mt-3 flex flex-wrap gap-1.5">
                  {#each similarOrgs as o}
                    <button
                      type="button"
                      onclick={() => (selectedSlug = o.slug)}
                      class="rounded-md border border-[#b8956a]/40 px-2.5 py-1 text-[12.5px] text-neutral-700 hover:border-[#5a4226]/40 hover:bg-[#b8956a]/15 hover:text-[#5a4226]"
                    >
                      {o.name}
                    </button>
                  {/each}
                </div>
              </section>
            {/if}
          {:else}
            <div class="flex h-full items-center justify-center">
              <span class="font-serif text-[15px] text-neutral-500 italic">
                No organizations to show.
              </span>
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
