<script lang="ts">
  import { Asterisk } from "@lucide/svelte";
  import { page } from "$app/state";
  import UserActions from "./user-actions.svelte";

  type User = { name: string } | null;
  let { user }: { user: User } = $props();

  const navItems = [
    { label: "Discover", href: "/" },
    { label: "Saved", href: "/saved" },
    { label: "Orgs", href: "/orgs" },
  ];

  const isActive = (href: string) =>
    href === "/"
      ? page.url.pathname === "/"
      : page.url.pathname.startsWith(href);
</script>

<div class="shrink-0 px-3 pt-3">
  <div
    class="flex h-12 items-center gap-2.5 rounded-md border border-[#b8956a]/40 bg-[#f0e3c4]/40 px-3 shadow-[0_1px_0_rgba(0,0,0,0.03)] backdrop-blur-sm sm:gap-3 sm:px-3.5"
  >
    <a href="/" class="flex items-center">
      <span
        class="font-serif text-[17px] leading-none font-semibold tracking-tight italic"
      >
        InternIt
      </span>
    </a>

    <span class="h-4 w-px bg-[#b8956a]/40"></span>

    <nav
      class="flex items-center gap-2.5 text-[10.5px] tracking-[0.1em] uppercase sm:gap-3"
    >
      {#each navItems as item}
        {@const active = isActive(item.href)}
        <a
          href={item.href}
          class="group flex items-center gap-1 {active
            ? 'font-semibold text-neutral-900'
            : 'font-medium text-neutral-500 hover:text-neutral-900'}"
        >
          {#if active}
            <Asterisk
              class="size-2.5 text-[#5a4226] transition-transform group-hover:rotate-45"
              strokeWidth={2.5}
            />
          {/if}
          {item.label}
        </a>
      {/each}
    </nav>

    <UserActions {user} class="ml-auto" />
  </div>
</div>
