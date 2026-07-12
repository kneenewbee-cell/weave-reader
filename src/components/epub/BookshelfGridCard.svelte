<script lang="ts">
	import { obsidianIcon } from '../../utils/obsidian-icon-action';
	import {
		clampBookshelfProgress,
		getBookshelfProgressToneClass,
	} from '../../services/epub/bookshelf-progress-display';

	export interface BookshelfGridCardBook {
		path: string;
		displayTitle: string;
		bylineText: string;
		statsLine: string;
		author: string;
		translator?: string;
		publisher?: string;
		progress: number;
	}

	export interface BookshelfGridCardProps {
		file: BookshelfGridCardBook;
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
	}: BookshelfGridCardProps = $props();

	const clampedProgress = $derived(clampBookshelfProgress(file.progress));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="epub-book-card"
	class:is-opening={isOpening}
	class:is-continue-reading={isContinueReading}
	style="animation-delay: {index * 36}ms"
	onclick={() => onOpen(file.path)}
	oncontextmenu={(event) => onContextMenu(event, file.path)}
	onkeydown={(event) => onKeydown(event, file.path)}
	role="button"
	tabindex="0"
>
	<div class="card-cover-frame">
		{#if coverUrl}
			<img src={coverUrl} alt="" class="card-cover-img" />
		{:else}
			<div class="card-cover-placeholder">
				<span use:obsidianIcon={'book-text'}></span>
			</div>
		{/if}
	</div>
	<div class="card-body">
		<div class="card-title">{file.displayTitle}</div>
		{#if isContinueReading}
			{#if file.bylineText}
				<div class="card-author">{file.bylineText}</div>
			{/if}
			<div class="card-continue-cta">{t('epub.bookshelf.continueReadingCta')}</div>
		{:else}
			{#if file.author}
				<div class="card-author">{file.author}</div>
			{/if}
			{#if file.translator}
				<div class="card-author card-translator">
					{t('epub.bookshelf.translator', { name: file.translator })}
				</div>
			{/if}
			{#if file.publisher}
				<div class="card-author card-publisher">{file.publisher}</div>
			{/if}
		{/if}
		{#if file.statsLine && !isContinueReading}
			<div class="book-meta-footer">{file.statsLine}</div>
		{/if}
		{#if showProgress}
			<div class="card-progress">
				<div class="card-progress-bar">
					<div
						class={`card-progress-fill ${getBookshelfProgressToneClass(file.progress)}`}
						style="width: {clampedProgress}%"
					></div>
				</div>
				<span class="card-progress-text">{clampedProgress}%</span>
			</div>
		{/if}
	</div>
</div>
