<script lang="ts">
  import {
    Globe,
    Briefcase,
    GraduationCap,
    Mail,
    AtSign,
    Link as LinkIcon,
    Send,
    MapPin,
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

  const categoryOptions = $derived([
    { value: "all", label: "All categories" },
    ...[...new Set(orgs.map((o) => o.category))]
      .sort()
      .map((c) => ({ value: c, label: c })),
  ]);

  let categoryValue = $state("all");
  let searchValue = $state("");

  const categoryLabel = $derived(
    categoryOptions.find((o) => o.value === categoryValue)?.label ??
      "All categories",
  );

  const filteredOrgs = $derived(
    orgs.filter((o) => {
      const catOk = categoryValue === "all" || o.category === categoryValue;
      const q = searchValue.trim().toLowerCase();
      const searchOk =
        q === "" ||
        o.name.toLowerCase().includes(q) ||
        o.category.toLowerCase().includes(q) ||
        o.region.toLowerCase().includes(q);
      return catOk && searchOk;
    }),
  );

  let selectedSlug = $state<string | null>(null);
  let showDetailMobile = $state(false);
  const selected = $derived(
    filteredOrgs.find((o) => o.slug === selectedSlug) ?? filteredOrgs[0],
  );

  const summary = $derived.by(() => {
    const total = filteredOrgs.length;
    const withActive = filteredOrgs.filter((o) => o.activeCount > 0).length;
    const paid = filteredOrgs.filter((o) => o.hasPaid === "yes").length;
    const remote = filteredOrgs.filter((o) => o.hasRemote === "yes").length;
    return [
      { icon: Building2, label: "Orgs", value: String(total) },
      { icon: Briefcase, label: "Hiring", value: String(withActive) },
      { icon: GraduationCap, label: "Paid", value: String(paid) },
      { icon: Globe, label: "Remote", value: String(remote) },
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
              <div
                class="mt-1 flex items-center gap-2.5 text-[12.5px] {isActive
                  ? 'text-neutral-600'
                  : 'text-neutral-500'}"
              >
                {#if org.addisOffice}
                  <span class="flex items-center gap-1">
                    <MapPin class="size-3" /> Addis office
                  </span>
                  <span class="opacity-50">·</span>
                {/if}
                <span>{org.activeCount} active</span>
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

            {#if links.length}
              <div class="mt-5 flex flex-wrap gap-1.5">
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
                  No active listings right now.
                </p>
              {/if}
            </section>
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
