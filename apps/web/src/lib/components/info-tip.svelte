<script lang="ts">
  // Small "ⓘ" affordance that opens an explainer popup for a metric: what it
  // means, where the data comes from, how it's computed, how often it refreshes.
  // A centered fixed card (not an anchored tooltip): tap-friendly on mobile and
  // immune to the grid-overflow/clipping problems anchored popovers invite.
  let {
    title,
    body,
    source,
    computed,
    refresh,
  }: {
    title: string;
    body: string;
    source?: string;
    computed?: string;
    refresh?: string;
  } = $props();

  let open = $state(false);
</script>

<svelte:window onkeydown={(e) => open && e.key === "Escape" && (open = false)} />

<button
  type="button"
  aria-label="About: {title}"
  onclick={(e) => {
    e.stopPropagation();
    open = true;
  }}
  class="inline-flex size-[15px] shrink-0 items-center justify-center rounded-full border border-[#8a6e47]/50 text-[9.5px] font-semibold text-[#8a6e47] hover:bg-[#b8956a]/20 hover:text-[#5a4226]"
>
  i
</button>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/25 p-5"
    onclick={() => (open = false)}
  >
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      class="w-full max-w-md rounded-md border border-[#b8956a]/50 bg-[#f0e6d2] p-5 shadow-[0_2px_16px_rgba(40,28,12,0.18)]"
    >
      <div class="flex items-start justify-between gap-4">
        <h3 class="font-serif text-[18px] leading-snug font-semibold tracking-tight text-neutral-900">
          {title}
        </h3>
        <button
          type="button"
          aria-label="Close"
          onclick={() => (open = false)}
          class="mt-0.5 text-[18px] leading-none text-neutral-500 hover:text-neutral-900"
        >
          ×
        </button>
      </div>

      <p class="mt-2.5 text-[13px] leading-6 text-neutral-800">{body}</p>

      <div class="mt-4 space-y-2 border-t border-[#b8956a]/30 pt-3">
        {#if source}
          <div class="grid grid-cols-[84px_1fr] gap-2">
            <span class="text-[10px] font-semibold tracking-[0.08em] text-neutral-500">SOURCE</span>
            <span class="font-mono text-[11.5px] leading-5 text-neutral-700">{source}</span>
          </div>
        {/if}
        {#if computed}
          <div class="grid grid-cols-[84px_1fr] gap-2">
            <span class="text-[10px] font-semibold tracking-[0.08em] text-neutral-500">COMPUTED</span>
            <span class="text-[12px] leading-5 text-neutral-700">{computed}</span>
          </div>
        {/if}
        {#if refresh}
          <div class="grid grid-cols-[84px_1fr] gap-2">
            <span class="text-[10px] font-semibold tracking-[0.08em] text-neutral-500">REFRESH</span>
            <span class="text-[12px] leading-5 text-neutral-700">{refresh}</span>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
