<script lang="ts">
	import { Bookmark } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import type { SvelteSet } from 'svelte/reactivity';

	let {
		id,
		bookmarked,
		signedIn,
		size = 'size-3'
	}: { id: string; bookmarked: SvelteSet<string>; signedIn: boolean; size?: string } = $props();
</script>

{#if signedIn}
	<form
		method="POST"
		action="?/toggleBookmark"
		use:enhance={() => {
			const was = bookmarked.has(id);
			was ? bookmarked.delete(id) : bookmarked.add(id);
			return async ({ result, update }) => {
				if (result.type === 'failure') {
					was ? bookmarked.add(id) : bookmarked.delete(id);
				} else {
					await update();
				}
			};
		}}
	>
		<input type="hidden" name="listingId" value={id} />
		<button
			type="submit"
			aria-label="Bookmark"
			class="flex items-center justify-center text-current transition-colors hover:text-[#5a4226]"
		>
			<Bookmark class="{size} {bookmarked.has(id) ? 'fill-current text-[#5a4226]' : ''}" />
		</button>
	</form>
{:else}
	<a
		href="/sign-in"
		aria-label="Sign in to bookmark"
		class="flex items-center justify-center text-current hover:text-[#5a4226]"
	>
		<Bookmark class={size} />
	</a>
{/if}
