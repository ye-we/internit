<script lang="ts">
  import type { Component, Snippet } from "svelte";
  import * as Card from "$lib/components/ui/card/index.js";
  import AppHeader from "./app-header.svelte";

  type SummaryCell = { icon: Component; label: string; value: string };

  let {
    user,
    summary,
    children,
    mobileSearch,
    class: className = "flex",
  }: {
    user: { name: string } | null;
    summary: SummaryCell[];
    children: Snippet;
    mobileSearch?: Snippet;
    class?: string;
  } = $props();
</script>

<aside class="min-h-0 flex-col overflow-hidden pb-3 {className}">
  <AppHeader {user} />

  <div class="shrink-0 px-3 pt-3">
    <Card.Root
      class="h-12 gap-0 rounded-md bg-transparent py-0 shadow-none ring-[#b8956a]/40"
    >
      <Card.Content class="grid h-full grid-cols-4 px-0">
        {#each summary as cell, i}
          {@const Icon = cell.icon}
          <div
            class="flex flex-col justify-center gap-0.5 px-3 {i < 3
              ? 'border-r border-[#b8956a]/40'
              : ''}"
          >
            <div class="flex items-center justify-between gap-2">
              <span
                class="text-[9px] font-semibold tracking-[0.08em] text-neutral-500 uppercase"
              >
                {cell.label}
              </span>
              <Icon class="size-3 text-[#8a6e47]" />
            </div>
            <span
              class="font-serif text-[15px] leading-none font-semibold tracking-tight"
            >
              {cell.value}
            </span>
          </div>
        {/each}
      </Card.Content>
    </Card.Root>
  </div>

  {#if mobileSearch}
    <div class="shrink-0 px-3 pt-3 lg:hidden">
      {@render mobileSearch()}
    </div>
  {/if}

  <div class="flex min-h-0 flex-1 flex-col px-3 pt-3">
    <div
      class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[#b8956a]/40"
    >
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {@render children()}
      </div>
    </div>
  </div>
</aside>
