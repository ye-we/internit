<script lang="ts">
  import { ArrowUpRight, LogOut } from "@lucide/svelte";
  import { client } from "$lib/auth-client";
  import { invalidateAll } from "$app/navigation";

  type User = { name: string } | null;
  let { user, class: className = "" }: { user: User; class?: string } =
    $props();

  const displayName = $derived.by(() => {
    if (!user) return "";
    const parts = user.name.trim().split(/\s+/);
    return parts.length > 1
      ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
      : parts[0];
  });
</script>

{#if user}
  <div class="flex items-center gap-2.5 {className}">
    <span
      class="max-w-[140px] truncate text-[12px] font-medium text-neutral-900"
    >
      {displayName}
    </span>
    <button
      type="button"
      onclick={async () => {
        await client.signOut();
        await invalidateAll();
      }}
      aria-label="Sign out"
      title="Sign out"
      class="-m-1 p-1 text-neutral-500 transition-colors hover:text-[#5a4226]"
    >
      <LogOut class="size-4" strokeWidth={2} />
    </button>
  </div>
{:else}
  <a
    href="/sign-in"
    class="flex items-center gap-0.5 text-[12px] font-medium text-neutral-900 hover:text-[#5a4226] {className}"
  >
    Sign in
    <ArrowUpRight class="size-3.5" strokeWidth={2} />
  </a>
{/if}
