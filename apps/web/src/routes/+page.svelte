<script lang="ts">
	import ListingBoard from '$lib/components/listing-board.svelte';

	let { data } = $props();
</script>

<ListingBoard
	listings={data.listings}
	bookmarkedIds={data.bookmarkedIds}
	user={data.user}
	emptyMessage="No listings match your filters."
/>
