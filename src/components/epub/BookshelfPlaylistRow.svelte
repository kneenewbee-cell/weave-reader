<script lang="ts">
	import BookshelfPlaylistMosaic from './BookshelfPlaylistMosaic.svelte';

	export interface BookshelfPlaylistRowData {
		id: string;
		name: string;
		metaLine: string;
	}

	export interface BookshelfPlaylistRowProps {
		playlist: BookshelfPlaylistRowData;
		coverUrls?: Array<string | null | undefined>;
		onOpen: (playlistId: string) => void;
		onKeydown: (event: KeyboardEvent, playlistId: string) => void;
		onContextMenu: (event: MouseEvent, playlistId: string) => void;
	}

	let {
		playlist,
		coverUrls = [],
		onOpen,
		onKeydown,
		onContextMenu,
	}: BookshelfPlaylistRowProps = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="epub-bookshelf-playlist-row"
	onclick={() => onOpen(playlist.id)}
	onkeydown={(event) => onKeydown(event, playlist.id)}
	oncontextmenu={(event) => onContextMenu(event, playlist.id)}
	role="button"
	tabindex="0"
	aria-label={playlist.name}
>
	<div class="epub-bookshelf-playlist-row__mosaic">
		<BookshelfPlaylistMosaic {coverUrls} />
	</div>
	<div class="epub-bookshelf-playlist-row__info">
		<div class="epub-bookshelf-playlist-row__title">{playlist.name}</div>
	</div>
	<span class="epub-bookshelf-playlist-row__chevron" aria-hidden="true">›</span>
	<div class="epub-bookshelf-playlist-row__footer">{playlist.metaLine}</div>
</div>
