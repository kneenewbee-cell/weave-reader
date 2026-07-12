<script lang="ts">
	import { obsidianIcon } from '../../utils/obsidian-icon-action';
	import BookshelfPlaylistMosaic from './BookshelfPlaylistMosaic.svelte';
	import type { BookshelfPlaylistRowData } from './BookshelfPlaylistRow.svelte';

	export interface BookshelfPlaylistCoverTileProps {
		playlist: BookshelfPlaylistRowData;
		index: number;
		coverUrls?: Array<string | null | undefined>;
		badgeLabel: string;
		onOpen: (playlistId: string) => void;
		onKeydown: (event: KeyboardEvent, playlistId: string) => void;
		onContextMenu: (event: MouseEvent, playlistId: string) => void;
	}

	let {
		playlist,
		index,
		coverUrls = [],
		badgeLabel,
		onOpen,
		onKeydown,
		onContextMenu,
	}: BookshelfPlaylistCoverTileProps = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="epub-book-cover-tile epub-bookshelf-playlist-cover-tile"
	style="animation-delay: {index * 28}ms"
	onclick={() => onOpen(playlist.id)}
	oncontextmenu={(event) => onContextMenu(event, playlist.id)}
	onkeydown={(event) => onKeydown(event, playlist.id)}
	role="button"
	tabindex="0"
	aria-label={playlist.name}
	title={playlist.name}
>
	<span class="cover-tile-playlist-badge">
		<span class="cover-tile-playlist-badge__icon" use:obsidianIcon={'library'}></span>
		{badgeLabel}
	</span>
	<div class="cover-tile-media cover-tile-media--playlist">
		<BookshelfPlaylistMosaic {coverUrls} />
	</div>
</div>
