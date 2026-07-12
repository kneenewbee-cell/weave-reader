<script lang="ts">
	import { setIcon, type App } from 'obsidian';
	import { onMount } from 'svelte';
	import { tr } from '../../utils/i18n';
	import EpubLoadingState from './EpubLoadingState.svelte';
	import { logger } from '../../utils/logger';
	import { EpubBookmarkService, type EpubBookmarkRecord } from '../../services/epub/EpubBookmarkService';
	import type { EpubBook } from '../../services/epub';

	interface Props {
		app: App;
		book: EpubBook | null;
		bookmarkRevision?: number;
		onDeleteBookmark?: (bookmark: EpubBookmarkRecord) => Promise<boolean | void>;
		onNavigate?: (cfi: string, text?: string) => void;
	}

	let { app, book, bookmarkRevision = 0, onDeleteBookmark, onNavigate }: Props = $props();
	let t = $derived($tr);

	let bookmarks = $state<EpubBookmarkRecord[]>([]);
	let loading = $state(false);
	let deletingBookmarkId = $state('');
	let loadToken = 0;
	let panelDisposed = false;
	let lastContextKey = '';

	function getBookmarkService(): EpubBookmarkService {
		return new EpubBookmarkService(app);
	}

	function icon(node: HTMLElement, name: string) {
		setIcon(node, name);
		return {
			update(newName: string) {
				node.replaceChildren();
				setIcon(node, newName);
			}
		};
	}

	function formatTime(timestamp: number): string {
		if (!timestamp) return '';
		const date = new Date(timestamp);
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		const h = String(date.getHours()).padStart(2, '0');
		const min = String(date.getMinutes()).padStart(2, '0');
		return `${y}-${m}-${d} ${h}:${min}`;
	}

	function getChapterLabel(bookmark: EpubBookmarkRecord): string {
		return String(bookmark.chapterTitle || '').trim()
			|| t('epub.bookmarks.chapterFallback', { chapter: bookmark.chapterIndex + 1 });
	}

	function getPageLabel(bookmark: EpubBookmarkRecord): string {
		if (typeof bookmark.pageNumber === 'number' && bookmark.pageNumber > 0) {
			return `p.${bookmark.pageNumber}`;
		}
		return '';
	}

	function navigateToBookmark(bookmark: EpubBookmarkRecord) {
		if (!bookmark.cfi) {
			return;
		}
		onNavigate?.(bookmark.cfi, bookmark.chapterTitle || getPageLabel(bookmark));
	}

	async function handleDeleteBookmark(event: MouseEvent, bookmark: EpubBookmarkRecord) {
		event.preventDefault();
		event.stopPropagation();
		if (!onDeleteBookmark || deletingBookmarkId === bookmark.id) {
			return;
		}
		deletingBookmarkId = bookmark.id;
		try {
			const deleted = await onDeleteBookmark(bookmark);
			if (deleted === false) {
				return;
			}
			bookmarks = bookmarks.filter((item) => item.id !== bookmark.id);
		} catch (error) {
			logger.error('[EpubBookmarksPanel] Failed to delete bookmark:', error);
		} finally {
			if (deletingBookmarkId === bookmark.id) {
				deletingBookmarkId = '';
			}
		}
	}

	function isStaleLoad(currentToken: number, expectedBookId: string): boolean {
		return panelDisposed || currentToken !== loadToken || (book?.id ?? '') !== expectedBookId;
	}

	async function loadBookmarks() {
		const currentBook = book;
		if (!currentBook) {
			bookmarks = [];
			loading = false;
			return;
		}
		const currentToken = ++loadToken;
		loading = true;
		try {
			const loaded = await getBookmarkService().loadBookmarksForBook(currentBook);
			if (isStaleLoad(currentToken, currentBook.id)) {
				return;
			}
			bookmarks = loaded;
		} catch (error) {
			if (isStaleLoad(currentToken, currentBook.id)) {
				return;
			}
			logger.error('[EpubBookmarksPanel] Failed to load bookmarks:', error);
			bookmarks = [];
		} finally {
			if (!isStaleLoad(currentToken, currentBook.id)) {
				loading = false;
			}
		}
	}

	$effect(() => {
		const contextKey = [book?.id ?? '', String(bookmarkRevision)].join('::');
		if (book) {
			if (contextKey === lastContextKey) {
				return;
			}
			lastContextKey = contextKey;
			void loadBookmarks();
		} else {
			loadToken += 1;
			bookmarks = [];
			loading = false;
			lastContextKey = '';
		}
	});

	onMount(() => {
		return () => {
			panelDisposed = true;
			loadToken += 1;
		};
	});
</script>

<div class="epub-bookmarks-panel">
	{#if loading}
		<div class="bm-empty">
			<EpubLoadingState message={t('epub.bookmarks.loading')} />
		</div>
	{:else if bookmarks.length === 0}
		<div class="bm-empty">
			<div class="bm-empty-label">{t('epub.bookmarks.empty')}</div>
			<div class="bm-empty-hint">{t('epub.bookmarks.hint')}</div>
		</div>
	{:else}
		<div class="bm-list">
			{#each bookmarks as bookmark (bookmark.id)}
				{@const pageLabel = getPageLabel(bookmark)}
				{@const createdTime = formatTime(bookmark.createdAt)}
				<div class="bm-item">
					<button class="bm-item-main" type="button" onclick={() => navigateToBookmark(bookmark)} aria-label={t('epub.bookmarks.goto', { chapter: getChapterLabel(bookmark) })}>
						<span class="bm-item-meta-row bm-item-meta-row--top">
							<span class="bm-item-time" title={createdTime}>{createdTime}</span>
							{#if pageLabel}
								<span class="bm-item-page">{pageLabel}</span>
							{/if}
						</span>
						<span class="bm-item-content-row">
							<span class="bm-item-title">{getChapterLabel(bookmark)}</span>
						</span>
					</button>
					{#if onDeleteBookmark}
						<button
							class="bm-item-delete"
							type="button"
							onclick={(event) => void handleDeleteBookmark(event, bookmark)}
							aria-label={t('epub.bookmarks.deleteWithChapter', { chapter: getChapterLabel(bookmark) })}
							title={t('epub.bookmarks.delete')}
							disabled={deletingBookmarkId === bookmark.id}
						>
							<span class="bm-item-delete-icon" use:icon={'trash-2'}></span>
						</button>
					{/if}
				</div>
			{/each}
		</div>
	 {/if}
 </div>

 <style>
	.epub-bookmarks-panel {
 		display: flex;
 		flex-direction: column;
 		padding: 0;
 		height: 100%;
		font-family: var(--font-interface, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif);
 	}

 	.bm-empty {
 		display: flex;
 		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 40px 20px;
		text-align: center;
 	}

 	.bm-empty-label {
 		font-size: 13px;
 		font-weight: 500;
 		color: var(--text-muted);
 	}

 	.bm-empty-hint {
 		font-size: 12px;
 		color: var(--text-faint);
 		line-height: 1.5;
 		max-width: 220px;
 	}

 	.bm-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 8px 12px 12px;
	}

	.bm-item {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		width: 100%;
		border: 1px solid color-mix(in srgb, var(--background-modifier-border) 70%, transparent);
		border-radius: 12px;
		background: color-mix(in srgb, var(--background-primary) 88%, var(--background-secondary) 12%);
		transition: background 0.12s ease, border-color 0.12s ease;
	}

	.bm-item:hover,
	.bm-item:focus-within {
		background: color-mix(in srgb, var(--background-modifier-hover) 50%, var(--background-primary) 50%);
		border-color: color-mix(in srgb, var(--interactive-accent) 24%, var(--background-modifier-border) 76%);
	}

	.bm-item-main {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
		width: 100%;
		min-height: 82px;
		padding: 12px 16px 12px 16px;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		font: inherit;
		color: inherit;
	}

	.bm-item-main:focus-visible {
		outline: none;
	}

	.bm-item-meta-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		min-width: 0;
		font-size: 11px;
		line-height: 1.4;
		font-variant-numeric: tabular-nums;
	}

	.bm-item-title {
		min-width: 0;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-normal);
		line-height: 1.5;
		white-space: normal;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.bm-item-content-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		min-width: 0;
		padding-right: 40px;
	}

	.bm-item-page {
		font-size: 11px;
		color: var(--text-muted);
		line-height: 1.4;
		min-width: 0;
		white-space: nowrap;
		margin-left: auto;
	}

	.bm-item-time {
		font-size: 11px;
		color: var(--text-faint);
		line-height: 1.4;
		text-align: left;
		white-space: nowrap;
	}

	.bm-item-delete {
		position: absolute;
		bottom: 10px;
		right: 10px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		margin: 0;
		appearance: none;
		-webkit-appearance: none;
		border: none !important;
		border-radius: 6px;
		background: transparent !important;
		background-color: transparent !important;
		box-shadow: none !important;
		color: var(--text-faint);
		cursor: pointer;
		transition: background 0.12s ease, color 0.12s ease, opacity 0.12s ease;
	}

	.bm-item-delete:hover:not(:disabled) {
		border: none !important;
		box-shadow: none !important;
		background: color-mix(in srgb, var(--background-modifier-hover) 60%, transparent) !important;
		color: var(--text-error);
	}

	.bm-item-delete:focus-visible:not(:disabled) {
		outline: 2px solid color-mix(in srgb, var(--interactive-accent) 50%, transparent);
		outline-offset: 2px;
		border: none !important;
		box-shadow: none !important;
		background: color-mix(in srgb, var(--background-modifier-hover) 60%, transparent) !important;
		color: var(--text-error);
	}

	.bm-item-delete:disabled {
		opacity: 0.5;
		cursor: default;
		border: none !important;
		box-shadow: none !important;
		background: transparent !important;
	}

	.bm-item-delete-icon {
		width: 16px;
		height: 16px;
	}

	.bm-item-delete-icon :global(.svg-icon) {
		width: 16px;
		height: 16px;
	}
 </style>
