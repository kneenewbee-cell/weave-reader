<script lang="ts">
	import BookshelfPlaylistMosaic from './BookshelfPlaylistMosaic.svelte';
	import type { BookshelfPlaylistRowData } from './BookshelfPlaylistRow.svelte';

	export interface BookshelfPlaylistGridCardProps {
		playlist: BookshelfPlaylistRowData;
		index: number;
		coverUrls?: Array<string | null | undefined>;
		onOpen: (playlistId: string) => void;
		onKeydown: (event: KeyboardEvent, playlistId: string) => void;
		onContextMenu: (event: MouseEvent, playlistId: string) => void;
	}

	let {
		playlist,
		index,
		coverUrls = [],
		onOpen,
		onKeydown,
		onContextMenu,
	}: BookshelfPlaylistGridCardProps = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="epub-book-card epub-bookshelf-playlist-card"
	style="animation-delay: {index * 36}ms"
	onclick={() => onOpen(playlist.id)}
	oncontextmenu={(event) => onContextMenu(event, playlist.id)}
	onkeydown={(event) => onKeydown(event, playlist.id)}
	role="button"
	tabindex="0"
	aria-label={playlist.name}
>
	<div class="card-cover-frame card-cover-frame--playlist">
		<BookshelfPlaylistMosaic {coverUrls} />
	</div>
	<div class="card-body">
		<div class="card-title">{playlist.name}</div>
		<div class="book-meta-footer">{playlist.metaLine}</div>
	</div>
</div>
