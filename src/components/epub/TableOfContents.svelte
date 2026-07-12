<script lang="ts">
	import { tick } from 'svelte';
	import { Menu, Platform, setIcon } from 'obsidian';
	import { tr } from '../../utils/i18n';
	import { domInstanceOf } from '../../utils/dom-instance-of';
	import { showWeaveMenuAtMouseEvent } from '../../utils/weave-owned-menu';
	import type { TocItem } from '../../services/epub';
	import type { EpubTocChapterMark, EpubTocChapterMarkMap } from '../../services/epub/epub-toc-chapter-mark';
	import type { EpubTocChapterMarkSettings } from '../../services/epub/epub-toc-chapter-mark-settings';
	import {
		EPUB_TOC_CHAPTER_MARK_ORDER,
		getExplicitTocChapterMark,
		resolveTocChapterMarkDisplay,
	} from '../../services/epub/epub-toc-chapter-mark';
	import {
		buildTocChapterMarkDefaultLabels,
		resolveTocChapterMarkDefinitionMap,
	} from '../../services/epub/epub-toc-chapter-mark-settings';
import { flattenTocItems, isTocHrefActive, type FlatTocItem } from '../../utils/epub-toc-reading-position';
	import EpubLoadingState from './EpubLoadingState.svelte';
	import EpubTocMarkSettingsPopover from './EpubTocMarkSettingsPopover.svelte';

	interface Props {
		items: TocItem[];
		loading?: boolean;
		loadFailed?: boolean;
		activeHref?: string | null;
		lastReadHref?: string | null;
		chapterMarks?: EpubTocChapterMarkMap;
		tocChapterMarkSettings?: EpubTocChapterMarkSettings;
		autoScrollToActive?: boolean;
		onNavigate: (href: string) => void;
		onSetChapterMark?: (item: TocItem, mark: EpubTocChapterMark | null) => void | Promise<void>;
		onSaveTocChapterMarkSettings?: (settings: EpubTocChapterMarkSettings) => void | Promise<void>;
		onAddToIncrementalReading?: (item: TocItem, event?: MouseEvent) => void | Promise<void>;
		onExportChapterMarked?: (
			item: FlatTocItem,
			itemIndex: number,
			flatItems: FlatTocItem[]
		) => void | Promise<void>;
	}

	let {
		items,
		loading = false,
		loadFailed = false,
		activeHref = null,
		lastReadHref = null,
		chapterMarks = {},
		tocChapterMarkSettings = {},
		autoScrollToActive = true,
		onNavigate,
		onSetChapterMark,
		onSaveTocChapterMarkSettings,
		onAddToIncrementalReading,
		onExportChapterMarked,
	}: Props = $props();
	let t = $derived($tr);

	let defaultMarkLabels = $derived(buildTocChapterMarkDefaultLabels(t));

	let markDefinitionMap = $derived.by(() => {
		void tocChapterMarkSettings;
		void defaultMarkLabels;
		return resolveTocChapterMarkDefinitionMap(tocChapterMarkSettings, defaultMarkLabels);
	});

	let tocListEl: HTMLDivElement | undefined = $state(undefined);
	let lastAutoScrolledActiveHref = '';
	let markSettingsOpen = $state(false);
	let markSettingsAnchor = $state<{ x: number; y: number } | null>(null);

	function resolvePopoverAnchor(event: MouseEvent | KeyboardEvent): { x: number; y: number } {
		if (Platform.isMobile) {
			const viewport = window.visualViewport;
			const width = viewport?.width ?? window.innerWidth;
			const height = viewport?.height ?? window.innerHeight;
			const offsetLeft = viewport?.offsetLeft ?? 0;
			const offsetTop = viewport?.offsetTop ?? 0;
			return {
				x: offsetLeft + width / 2,
				y: offsetTop + Math.min(height * 0.22, 120),
			};
		}

		const x = 'clientX' in event && Number.isFinite(event.clientX)
			? event.clientX
			: Math.round(window.innerWidth / 2);
		const y = 'clientY' in event && Number.isFinite(event.clientY)
			? event.clientY
			: Math.round(window.innerHeight / 2);
		return { x, y };
	}

	function openMarkSettingsPopover(event: MouseEvent | KeyboardEvent) {
		markSettingsAnchor = resolvePopoverAnchor(event);
		markSettingsOpen = true;
	}

	function closeMarkSettingsPopover() {
		markSettingsOpen = false;
		markSettingsAnchor = null;
	}

	function handleClick(item: TocItem) {
		onNavigate(item.href);
	}

	function handleKeydown(event: KeyboardEvent, item: TocItem) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleClick(item);
		}
	}

	function showContextMenu(event: MouseEvent, item: FlatTocItem, itemIndex: number) {
		if (!onSetChapterMark && !onAddToIncrementalReading && !onExportChapterMarked) {
			return;
		}

		event.preventDefault();
		const menu = new Menu();
		const explicitMark = getExplicitTocChapterMark(item.href, chapterMarks);
		const displayMark = resolveTocChapterMarkDisplay(flatItems, itemIndex, chapterMarks);

		if (onSetChapterMark) {
			menu.addItem((menuItem) => {
				menuItem.setTitle(t('epub.toc.markChapter'));
				menuItem.setIcon('tag');
				const markSubmenu = menuItem.setSubmenu();

				for (const mark of EPUB_TOC_CHAPTER_MARK_ORDER) {
					markSubmenu.addItem((subItem) => {
						subItem.setTitle(markDefinitionMap.get(mark)?.label ?? mark);
						subItem.setChecked(displayMark === mark);
						subItem.onClick(() => {
							void onSetChapterMark?.(item, mark);
						});
					});
				}

				markSubmenu.addItem((subItem) => {
					subItem.setTitle(t('epub.toc.clearChapterMark'));
					subItem.setIcon('x');
					subItem.setDisabled(!explicitMark);
					subItem.onClick(() => {
						void onSetChapterMark?.(item, null);
					});
				});

				markSubmenu.addSeparator();
				if (onSaveTocChapterMarkSettings) {
					markSubmenu.addItem((subItem) => {
						subItem.setTitle(t('epub.toc.markSettingsAction'));
						subItem.setIcon('settings-2');
						subItem.onClick((evt) => {
							openMarkSettingsPopover(evt);
						});
					});
				}
			});
		}

		if (onAddToIncrementalReading) {
			if (onSetChapterMark) {
				menu.addSeparator();
			}
			menu.addItem((menuItem) => {
				menuItem.setTitle(t('epub.toc.addToIncrementalReading'));
				menuItem.setIcon('book-plus');
				menuItem.onClick(() => {
					void onAddToIncrementalReading?.(item, event);
				});
			});
		}

		if (onExportChapterMarked) {
			if (onSetChapterMark || onAddToIncrementalReading) {
				menu.addSeparator();
			}
			menu.addItem((menuItem) => {
				menuItem.setTitle(t('views.epubView.menu.exportCurrentChapterMarked'));
				menuItem.setIcon('highlighter');
				menuItem.onClick(() => {
					void onExportChapterMarked?.(item, itemIndex, flatItems);
				});
			});
		}

		showWeaveMenuAtMouseEvent(menu, event);
	}

	function isLastReadItem(item: FlatTocItem): boolean {
		return isTocHrefActive(item.href, lastReadHref);
	}

	function isActiveItem(item: FlatTocItem): boolean {
		return isTocHrefActive(item.href, activeHref);
	}

	function lastReadIcon(node: HTMLElement) {
		setIcon(node, 'map-pin');
		return {
			destroy() {
				node.replaceChildren();
			}
		};
	}

	function currentLocationIcon(node: HTMLElement) {
		setIcon(node, 'locate-fixed');
		return {
			destroy() {
				node.replaceChildren();
			}
		};
	}

	function resolveItemAriaLabel(item: FlatTocItem, isActive: boolean, isLastRead: boolean): string | undefined {
		if (isActive) {
			return t('epub.toc.currentLocationItemAria', { title: item.label });
		}
		if (isLastRead) {
			return t('epub.toc.lastReadItemAria', { title: item.label });
		}
		return undefined;
	}

	function resolveMarkTitle(mark: EpubTocChapterMark | null): string | undefined {
		if (!mark) {
			return undefined;
		}
		return markDefinitionMap.get(mark)?.label;
	}

	function resolveMarkColor(mark: EpubTocChapterMark | null): string | undefined {
		if (!mark) {
			return undefined;
		}
		return markDefinitionMap.get(mark)?.color;
	}

	let flatItems = $derived(flattenTocItems(items));

	$effect(() => {
		void items;
		lastAutoScrolledActiveHref = '';
	});

	$effect(() => {
		const href = String(activeHref || '').trim();
		const itemCount = flatItems.length;
		if (!autoScrollToActive || !href || !tocListEl || itemCount === 0) {
			return;
		}
		if (href === lastAutoScrolledActiveHref) {
			return;
		}
		void tick().then(() => {
			const activeEl = tocListEl?.querySelector('.epub-toc-item.active');
			const found = domInstanceOf(activeEl, HTMLElement);
			if (found) {
				activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
				lastAutoScrolledActiveHref = href;
			}
		});
	});
</script>

<div class="epub-toc-panel">
	{#if loading}
		<EpubLoadingState message={t('epub.toc.loading')} surface />
	{:else if loadFailed}
		<div class="epub-placeholder">{t('epub.toc.loadFailed')}</div>
	{:else if flatItems.length === 0}
		<div class="epub-placeholder">{t('epub.toc.empty')}</div>
	{:else}
		<div
			class="epub-toc-list"
			bind:this={tocListEl}
			aria-label={t('epub.toc.ariaLabel')}
		>
			{#each flatItems as item, itemIndex (item.id)}
				{@const isActive = isActiveItem(item)}
				{@const isLastRead = isLastReadItem(item)}
				{@const chapterMark = resolveTocChapterMarkDisplay(flatItems, itemIndex, chapterMarks)}
				{@const markColor = resolveMarkColor(chapterMark)}
				<div
					class="epub-toc-item"
					class:active={isActive}
					class:is-last-read={isLastRead}
					class:toc-mark-important={chapterMark === 'important'}
					class:toc-mark-question={chapterMark === 'question'}
					class:toc-mark-mastered={chapterMark === 'mastered'}
					class:toc-mark-incremental={chapterMark === 'incremental'}
					style={`--toc-depth:${item.depth};`}
					onclick={() => handleClick(item)}
					oncontextmenu={(event) => showContextMenu(event, item, itemIndex)}
					onkeydown={(event) => handleKeydown(event, item)}
					role="button"
					tabindex="0"
					aria-current={isActive ? 'location' : undefined}
					aria-label={resolveItemAriaLabel(item, isActive, isLastRead)}
					data-last-read={isLastRead ? 'true' : undefined}
					data-item-id={item.id}
				>
					<span
						class="toc-bullet"
						class:toc-mark-custom={Boolean(chapterMark && markColor)}
						style={markColor ? `--toc-mark-color:${markColor};` : undefined}
						title={resolveMarkTitle(chapterMark)}
						aria-hidden="true"
					></span>
					<span class="toc-title">{item.label}</span>
					<span class="toc-trailing">
						{#if isActive}
							<span
								class="toc-current-location-marker"
								title={t('epub.toc.currentLocationTitle')}
								aria-label={t('epub.toc.currentLocationTitle')}
							>
								<span class="toc-current-location-icon" aria-hidden="true" use:currentLocationIcon></span>
							</span>
						{/if}
						{#if isLastRead}
							<span
								class="toc-last-read-marker"
								title={t('epub.toc.lastReadBadgeTitle')}
								aria-label={t('epub.toc.lastReadBadge')}
							>
								<span class="toc-last-read-icon" aria-hidden="true" use:lastReadIcon></span>
								<span class="toc-last-read-badge">{t('epub.toc.lastReadBadge')}</span>
							</span>
						{/if}
						{#if item.pageNumber}
							<span class="toc-page">{item.pageNumber}</span>
						{/if}
					</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<EpubTocMarkSettingsPopover
	open={markSettingsOpen}
	anchor={markSettingsAnchor}
	settings={tocChapterMarkSettings}
	onClose={closeMarkSettingsPopover}
	onSave={async (nextSettings) => {
		await onSaveTocChapterMarkSettings?.(nextSettings);
	}}
/>

<style>
	.epub-toc-panel {
		display: flex;
		flex-direction: column;
		padding: 10px 0 18px;
	}

	.epub-placeholder {
		margin: 4px 12px 0;
		padding: 22px 14px;
		border-radius: 16px;
		background: color-mix(in srgb, var(--weave-elevated-background, var(--background-secondary)) 88%, transparent);
		color: var(--text-muted);
		font-size: 13px;
		line-height: 1.7;
	}

	.epub-toc-list {
		display: flex;
		flex-direction: column;
	}

	.epub-toc-item {
		--indent: calc(var(--toc-depth, 0) * 18px);
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px 8px calc(16px + var(--indent));
		color: var(--text-muted);
		cursor: pointer;
		border-left: 2px solid transparent;
		transition: background-color 0.14s ease, color 0.14s ease, border-color 0.14s ease;
	}

	.epub-toc-item:hover,
	.epub-toc-item:focus-visible {
		background: color-mix(in srgb, var(--background-modifier-hover) 88%, transparent);
		color: var(--text-normal);
		outline: none;
	}

	.epub-toc-item.active {
		background: color-mix(in srgb, var(--interactive-accent) 10%, transparent);
		color: var(--text-normal);
		border-left-color: var(--interactive-accent);
	}

	.epub-toc-item.is-last-read.active {
		border-left-color: var(--interactive-accent);
	}

	.toc-bullet {
		flex: 0 0 auto;
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--text-faint) 72%, transparent);
	}

	.toc-bullet.toc-mark-custom {
		background: var(--toc-mark-color);
	}

	.epub-toc-item.active:not(.toc-mark-important):not(.toc-mark-question):not(.toc-mark-mastered):not(.toc-mark-incremental) .toc-bullet {
		background: var(--interactive-accent);
	}

	.epub-toc-item.is-last-read:not(.toc-mark-important):not(.toc-mark-question):not(.toc-mark-mastered):not(.toc-mark-incremental) .toc-bullet {
		background: var(--interactive-accent);
	}

	.toc-title {
		flex: 1 1 auto;
		min-width: 0;
		font-size: 13px;
		line-height: 1.55;
		word-break: break-word;
	}

	.toc-trailing {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 6px;
		margin-left: auto;
		padding-left: 10px;
		white-space: nowrap;
	}

	.toc-page {
		flex: 0 0 auto;
		min-width: 2ch;
		text-align: right;
		color: var(--text-faint);
		font-size: 12px;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.epub-toc-item.active .toc-page {
		color: color-mix(in srgb, var(--interactive-accent) 72%, var(--text-muted) 28%);
	}

	.toc-last-read-marker {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 2px 7px 2px 5px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--interactive-accent) 14%, var(--background-primary));
		border: 1px solid color-mix(in srgb, var(--interactive-accent) 28%, var(--background-modifier-border));
		color: var(--interactive-accent);
	}

	.toc-last-read-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		width: 12px;
		height: 12px;
		color: inherit;
	}

	.toc-last-read-icon :global(svg) {
		width: 11px;
		height: 11px;
	}

	.toc-last-read-badge {
		font-size: 10px;
		font-weight: var(--font-medium, 600);
		line-height: 1;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}

	.toc-current-location-marker {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--interactive-accent);
	}

	.toc-current-location-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		width: 14px;
		height: 14px;
		color: inherit;
	}

	.toc-current-location-icon :global(svg) {
		width: 13px;
		height: 13px;
	}
</style>
