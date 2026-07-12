<script lang="ts">
	import { obsidianIcon } from '../../utils/obsidian-icon-action';

	export interface BookshelfPlaylistMosaicProps {
		coverUrls?: Array<string | null | undefined>;
	}

	let { coverUrls = [] }: BookshelfPlaylistMosaicProps = $props();

	const mosaicSlots = $derived.by(() => {
		const slots: Array<string | null> = [];
		for (let index = 0; index < 4; index += 1) {
			const url = coverUrls[index];
			slots.push(typeof url === 'string' && url.trim() ? url : null);
		}
		return slots;
	});
</script>

<div class="epub-playlist-mosaic" aria-hidden="true">
	{#each mosaicSlots as coverUrl, index (index)}
		{#if coverUrl}
			<img src={coverUrl} alt="" class="epub-playlist-mosaic__cell" />
		{:else}
			<div class="epub-playlist-mosaic__cell epub-playlist-mosaic__placeholder">
				<span use:obsidianIcon={'book-text'}></span>
			</div>
		{/if}
	{/each}
</div>
