<script lang="ts">
	import { obsidianIcon } from '../../utils/obsidian-icon-action';
	import {
		clampBookshelfProgress,
		formatBookshelfLastReadTime,
	} from '../../services/epub/bookshelf-progress-display';
	import ProgressRingBadge from './ProgressRingBadge.svelte';

	export interface BookshelfListBookItemData {
		path: string;
		displayTitle: string;
		bylineText: string;
		statsLine: string;
		author: string;
		translator?: string;
		publisher?: string;
		progress: number;
		lastReadTime: number;
	}

	export interface BookshelfListBookItemProps {
		file: BookshelfListBookItemData;
		index: number;
		animateEntry?: boolean;
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
		animateEntry = true,
		coverUrl = null,
		isOpening = false,
		isContinueReading = false,
		showProgress = false,
		t,
		onOpen,
		onContextMenu,
		onKeydown,
	}: BookshelfListBookItemProps = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="epub-book-item"
	class:is-opening={isOpening}
	class:is-continue-reading={isContinueReading}
	style={animateEntry ? `animation-delay: ${Math.min(index, 8) * 36}ms` : undefined}
	onclick={() => onOpen(file.path)}
	oncontextmenu={(event) => onContextMenu(event, file.path)}
	onkeydown={(event) => onKeydown(event, file.path)}
	role="button"
	tabindex="0"
>
	{#if coverUrl}
		<img src={coverUrl} alt="" class="book-thumb" />
	{:else}
		<div class="book-thumb-placeholder">
			<span use:obsidianIcon={'book-text'}></span>
		</div>
	{/if}
	<div class="book-info">
		<div class="book-name">{file.displayTitle}</div>
		{#if isContinueReading}
			{#if file.bylineText}
				<div class="book-meta-text book-author">{file.bylineText}</div>
			{/if}
		{:else}
			{#if file.author}
				<div class="book-meta-text book-author">{file.author}</div>
			{/if}
			{#if file.translator}
				<div class="book-meta-text book-translator">
					{t('epub.bookshelf.translator', { name: file.translator })}
				</div>
			{/if}
			{#if file.publisher}
				<div class="book-meta-text book-publisher">{file.publisher}</div>
			{/if}
		{/if}
	</div>
	{#if isContinueReading}
		{#if file.lastReadTime > 0}
			<div class="book-meta-footer">
				{t('epub.bookshelf.continueReadingLastRead', {
					time: formatBookshelfLastReadTime(file.lastReadTime),
				})}
			</div>
		{:else if file.statsLine}
			<div class="book-meta-footer">{file.statsLine}</div>
		{/if}
		<div class="book-continue-action">{t('epub.bookshelf.continueReadingCta')}</div>
	{:else if file.statsLine}
		<div class="book-meta-footer">{file.statsLine}</div>
	{/if}
	{#if showProgress}
		{@const clampedProgress = clampBookshelfProgress(file.progress)}
		<ProgressRingBadge
			className="book-list-progress-badge"
			progress={file.progress}
			valueText={`${clampedProgress}%`}
			titleText={t('epub.bookshelf.progress', { progress: clampedProgress })}
		/>
	{/if}
</div>
