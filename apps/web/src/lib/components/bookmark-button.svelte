<script lang="ts">
	import { Bookmark } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import type { SvelteSet } from 'svelte/reactivity';

	// `class` styles the interactive element itself (the callers' bordered/padded
	// box) so the whole visible button is clickable, not just the icon.
	let {
		id,
		bookmarked,
		signedIn,
		size = 'size-3',
		class: className = ''
	}: {
		id: string;
		bookmarked: SvelteSet<string>;
		signedIn: boolean;
		size?: string;
		class?: string;
	} = $props();
</script>

{#if signedIn}
	<!-- display: contents — the button, not the form, is the laid-out box -->
	<form
		method="POST"
		action="?/toggleBookmark"
		class="contents"
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
			class="flex items-center justify-center transition-colors hover:text-[#5a4226] {className}"
		>
			<Bookmark class="{size} {bookmarked.has(id) ? 'fill-current text-[#5a4226]' : ''}" />
		</button>
	</form>
{:else}
	<a
		href="/sign-in"
		aria-label="Sign in to bookmark"
		class="flex items-center justify-center transition-colors hover:text-[#5a4226] {className}"
	>
		<Bookmark class={size} />
	</a>
{/if}
