<script lang="ts">
	import { obsidianIcon } from '../../utils/obsidian-icon-action';
	import {
		clampBookshelfProgress,
		getBookshelfProgressToneClass,
	} from '../../services/epub/bookshelf-progress-display';

	export interface BookshelfCoverTileBook {
		path: string;
		displayTitle: string;
		progress: number;
	}

	export interface BookshelfCoverTileProps {
		file: BookshelfCoverTileBook;
		index: number;
		coverUrl?: string | null;
		isOpening?: boolean;
		isContinueReading?: boolean;
		showProgress?: boolean;
		t: (key: string, params?: Record<string, unknown>) => string;
		onOpen: (path: string) => void;
		onContextMenu: (event: MouseEvent, path: string) => void;
		onKeydown: (event: KeyboardEvent, path: string) => void;
	}

	let {
		file,
		index,
		coverUrl = null,
		isOpening = false,
		isContinueReading = false,
		showProgress = false,
		t,
		onOpen,
		onContextMenu,
		onKeydown,
	}: BookshelfCoverTileProps = $props();

	const clampedProgress = $derived(clampBookshelfProgress(file.progress));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="epub-book-cover-tile"
	class:is-opening={isOpening}
	class:is-continue-reading={isContinueReading}
	style="animation-delay: {index * 28}ms"
	onclick={() => onOpen(file.path)}
	oncontextmenu={(event) => onContextMenu(event, file.path)}
	onkeydown={(event) => onKeydown(event, file.path)}
	role="button"
	tabindex="0"
	aria-label={showProgress
		? `${file.displayTitle}, ${t('epub.bookshelf.progress', { progress: clampedProgress })}`
		: file.displayTitle}
	title={showProgress
		? `${file.displayTitle} · ${clampedProgress}%`
		: file.displayTitle}
>
	{#if isContinueReading}
		<span class="cover-tile-continue-badge">{t('epub.bookshelf.continueReadingBadge')}</span>
	{/if}
	<div class="cover-tile-media">
		{#if coverUrl}
			<img src={coverUrl} alt="" class="cover-tile-img" />
		{:else}
			<div class="cover-tile-placeholder">
				<span class="cover-tile-placeholder-title">{file.displayTitle}</span>
				<span class="cover-tile-placeholder-icon" use:obsidianIcon={'book-text'}></span>
			</div>
		{/if}
	</div>
	{#if showProgress}
		<div class="cover-tile-footer">
			<div
				class={`cover-tile-progress ${getBookshelfProgressToneClass(file.progress)}`}
				style={`--cover-progress:${clampedProgress}%;`}
				aria-hidden="true"
			></div>
		</div>
	{/if}
</div>
