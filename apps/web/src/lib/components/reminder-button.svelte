<script lang="ts">
	import { Bell } from '@lucide/svelte';
	import { env } from '$env/dynamic/public';

	// Reminders are delivered by the Telegram bot (the only channel that DMs
	// deadlines), so the bell is a deep link into the bot rather than a web
	// action — it works for signed-out visitors too. The bot's /start handler
	// parses the save_<id> payload and saves the listing for 24h/72h reminders.
	let { id, size = 'size-3' }: { id: string; size?: string } = $props();

	const username = env.PUBLIC_TELEGRAM_BOT_USERNAME;
	const href = $derived(username ? `https://t.me/${username}?start=save_${id}` : null);
</script>

{#if href}
	<a
		{href}
		target="_blank"
		rel="noopener noreferrer"
		aria-label="Remind me on Telegram before the deadline"
		title="Remind me on Telegram before the deadline"
		class="flex items-center justify-center text-current transition-colors hover:text-[#5a4226]"
	>
		<Bell class={size} />
	</a>
{:else}
	<span aria-label="Telegram reminders unavailable" class="flex items-center justify-center opacity-40">
		<Bell class={size} />
	</span>
{/if}
