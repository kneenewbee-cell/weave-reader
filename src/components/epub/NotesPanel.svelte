<script lang="ts">
	import { onMount } from 'svelte';
	import type { App } from 'obsidian';
	import { Menu, Notice, setIcon } from 'obsidian';
	import { tr } from '../../utils/i18n';
	import { showObsidianConfirm } from '../../utils/obsidian-confirm';
	import { logger } from '../../utils/logger';
	import { parseSearchQuery, type DateRange, type SearchQuery } from '../../utils/search-parser';
	import type { EpubBook, EpubHighlightViewSnapshotService, EpubReaderEngine } from '../../services/epub';
	import {
		buildEpubDisplayHighlightSelectionKey,
		type EpubDisplayHighlight,
		type EpubHighlightRenderSnapshot,
	} from '../../services/epub/EpubHighlightViewSnapshotService';
	import { getEpubAnnotationIndexService } from '../../services/epub';
	import type { EpubAnnotationService } from '../../services/epub';
	import type { EpubBacklinkHighlightService } from '../../services/epub/EpubBacklinkHighlightService';
	import EpubAnnotationCard from './EpubAnnotationCard.svelte';
	import EpubLoadingState from './EpubLoadingState.svelte';

	interface HighlightSearchMeta {
		availableTags: string[];
		availableSources: string[];
		availableCommentStates: string[];
		availableNoteTypes: string[];
		availableHighlightColors: string[];
		availableChapters: string[];
		matchCount: number;
		totalCount: number;
	}

	interface Props {
		app: App;
		book: EpubBook | null;
		readerService?: EpubReaderEngine | null;
		annotationService: EpubAnnotationService;
		snapshotService?: EpubHighlightViewSnapshotService | null;
		backlinkService?: EpubBacklinkHighlightService;
		filePath?: string;
		highlightRevision?: number;
		showStrikethroughHighlights?: boolean;
		currentChapterTitle?: string;
		currentChapterIndex?: number;
		onDeleteHighlight?: (highlight: EpubDisplayHighlight) => Promise<boolean>;
		onExportHighlights?: (selectionKeys: string[]) => Promise<void>;
		searchQuery?: string;
		searchMeta?: HighlightSearchMeta;
		onNavigate?: (
			cfi: string,
			text?: string,
			color?: string,
			metadata?: {
				sourceFile?: string;
				sourceRef?: string;
				createdTime?: number;
			}
		) => void;
	}

	let {
		app,
		book,
		readerService = null,
		annotationService,
		snapshotService = null,
		backlinkService,
		filePath,
		highlightRevision = 0,
		showStrikethroughHighlights = false,
		currentChapterTitle = '',
		currentChapterIndex = -1,
		onDeleteHighlight,
		onExportHighlights,
		searchQuery = $bindable(''),
		searchMeta = $bindable<HighlightSearchMeta>({
			availableTags: [],
			availableSources: [],
			availableCommentStates: [],
			availableNoteTypes: [],
			availableHighlightColors: [],
			availableChapters: [],
			matchCount: 0,
			totalCount: 0,
		}),
		onNavigate,
	}: Props = $props();
	let t = $derived($tr);

	function iconAction(node: HTMLElement, name: string) {
		setIcon(node, name);
		return {
			update(newName: string) {
				node.replaceChildren();
				setIcon(node, newName);
			},
		};
	}

	let highlights = $state<EpubDisplayHighlight[]>([]);
	let preparing = $state(false);
	let syncing = $state(false);
	let selectionMode = $state(false);
	let selectedKeys = $state<Set<string>>(new Set());
	let batchDeleting = $state(false);
	let annotationLoadToken = 0;
	let panelDisposed = false;
	let lastLoadContextKey = '';

	function normalizeSearchText(value: string | undefined): string {
		return typeof value === 'string' ? value.trim().toLowerCase() : '';
	}

	function buildUniqueSortedValues(values: Array<string | undefined>): string[] {
		return Array.from(new Set(values.map((value) => value?.trim() || '').filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
	}

	function matchesSearchTermList(values: string[], terms: string[]): boolean {
		if (terms.length === 0) {
			return true;
		}

		return terms.every((term) => {
			const normalizedTerm = normalizeSearchText(term);
			if (!normalizedTerm) {
				return true;
			}
			return values.some((value) => normalizeSearchText(value).includes(normalizedTerm));
		});
	}

	function matchesExcludedSearchTerms(values: string[], terms: string[]): boolean {
		if (terms.length === 0) {
			return true;
		}

		return terms.every((term) => {
			const normalizedTerm = normalizeSearchText(term);
			if (!normalizedTerm) {
				return true;
			}
			return values.every((value) => !normalizeSearchText(value).includes(normalizedTerm));
		});
	}

	function matchesFieldValues(target: string | undefined, values: string[]): boolean {
		if (values.length === 0) {
			return true;
		}

		const normalizedTarget = normalizeSearchText(target);
		if (!normalizedTarget) {
			return false;
		}

		return values.some((value) => {
			const normalizedValue = normalizeSearchText(value);
			return normalizedValue ? normalizedTarget.includes(normalizedValue) : false;
		});
	}

	function matchesArrayFieldValues(targets: string[], values: string[]): boolean {
		if (values.length === 0) {
			return true;
		}

		return values.some((value) => {
			const normalizedValue = normalizeSearchText(value);
			if (!normalizedValue) {
				return false;
			}

			return targets.some((target) => normalizeSearchText(target).includes(normalizedValue));
		});
	}

	function parseDateBoundary(value: string, boundary: 'start' | 'end'): number | null {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			return null;
		}

		const timestamp = new Date(boundary === 'start' ? `${value}T00:00:00.000` : `${value}T23:59:59.999`).getTime();
		return Number.isFinite(timestamp) ? timestamp : null;
	}

	function matchesDateRange(timestamp: number, range: DateRange): boolean {
		if (!Number.isFinite(timestamp) || timestamp <= 0) {
			return false;
		}

		const from = range.from ? parseDateBoundary(range.from, 'start') : null;
		if (range.from && from === null) {
			return false;
		}

		const to = range.to ? parseDateBoundary(range.to, 'end') : null;
		if (range.to && to === null) {
			return false;
		}

		if (from !== null && timestamp < from) {
			return false;
		}

		if (to !== null && timestamp > to) {
			return false;
		}

		return true;
	}

	function matchesDateRanges(timestamp: number, ranges: DateRange[]): boolean {
		if (ranges.length === 0) {
			return true;
		}

		return ranges.some((range) => matchesDateRange(timestamp, range));
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

	function getSourceLabel(sourceFile?: string): string {
		if (!sourceFile) {
			return '';
		}
		const normalized = sourceFile.replace(/\\/g, '/');
		const basename = normalized.split('/').pop() || normalized;
		const displayName = basename.replace(/\.[^.]+$/, '');
		return displayName ? `- 《${displayName}》` : '';
	}

	function getEmptyExcerptHint(text?: string): string {
		return String(text || '').trim() ? '' : t('epub.notes.emptyExcerpt');
	}

	function navigateToHighlight(hl: EpubDisplayHighlight) {
		if (hl.cfiRange) {
			onNavigate?.(hl.cfiRange, hl.text, hl.color, {
				sourceFile: hl.sourceFile,
				sourceRef: hl.sourceRef,
				createdTime: hl.createdTime,
			});
		}
	}

	function getHighlightSelectionKey(highlight: EpubDisplayHighlight): string {
		return buildEpubDisplayHighlightSelectionKey(highlight);
	}

	function getHighlightChapterLabel(highlight: EpubDisplayHighlight): string {
		const chapterTitle = String(highlight.chapterTitle || '').trim();
		if (chapterTitle) {
			return chapterTitle;
		}
		if (typeof highlight.chapterIndex === 'number' && highlight.chapterIndex >= 0) {
			return t('epub.bookmarks.chapterFallback', { chapter: highlight.chapterIndex + 1 });
		}
		return '';
	}

	function matchesChapterValues(
		highlight: EpubDisplayHighlight,
		values: string[],
		currentTitle: string,
		currentIndex: number
	): boolean {
		if (values.length === 0) {
			return true;
		}

		const chapterLabel = getHighlightChapterLabel(highlight);
		const normalizedChapterLabel = normalizeSearchText(chapterLabel);
		const normalizedPageLabel = normalizeSearchText(highlight.pageLabel);

		return values.some((value) => {
			const normalizedValue = normalizeSearchText(value);
			if (!normalizedValue) {
				return false;
			}

			if (['@current', 'current', '当前', '当前章节', '当前章'].includes(normalizedValue)) {
				if (currentIndex >= 0 && typeof highlight.chapterIndex === 'number') {
					return highlight.chapterIndex === currentIndex;
				}
				const normalizedCurrentTitle = normalizeSearchText(currentTitle);
				return Boolean(
					normalizedCurrentTitle &&
					(normalizedChapterLabel.includes(normalizedCurrentTitle) ||
						normalizedCurrentTitle.includes(normalizedChapterLabel))
				);
			}

			if (/^\d+$/.test(normalizedValue)) {
				const chapterNumber = Number.parseInt(normalizedValue, 10);
				if (Number.isFinite(chapterNumber) && typeof highlight.chapterIndex === 'number') {
					return highlight.chapterIndex + 1 === chapterNumber;
				}
			}

			return (
				normalizedChapterLabel.includes(normalizedValue) ||
				normalizedPageLabel.includes(normalizedValue)
			);
		});
	}

	function matchesCommentValues(highlight: EpubDisplayHighlight, values: string[]): boolean {
		if (values.length === 0) {
			return true;
		}

		return values.some((value) => {
			const normalizedValue = normalizeSearchText(value);
			if (!normalizedValue) {
				return false;
			}

			if ([
				t('epub.notes.commented').toLowerCase(),
				'有批注',
				'有想法',
				'有',
				'true',
				'yes',
				'1',
				'commented',
			].includes(normalizedValue)) {
				return highlight.hasCommentDivider;
			}

			if ([
				t('epub.notes.uncommented').toLowerCase(),
				'无批注',
				'无想法',
				'无',
				'false',
				'no',
				'0',
				'none',
			].includes(normalizedValue)) {
				return !highlight.hasCommentDivider;
			}

			return highlight.commentStateLabel.toLowerCase().includes(normalizedValue);
		});
	}

	function matchesHighlightQuery(highlight: EpubDisplayHighlight, query: SearchQuery): boolean {
		if (!query.raw.trim()) {
			return true;
		}

		const noteTypeSearchTarget = `${highlight.noteType} ${highlight.noteTypeKey}`;
		const colorSearchTarget = `${highlight.colorLabel} ${highlight.color}`;

		return matchesSearchTermList(highlight.searchableValues, query.text)
			&& matchesExcludedSearchTerms(highlight.searchableValues, query.excludeText)
			&& matchesArrayFieldValues(highlight.tags, query.tags)
			&& matchesFieldValues(highlight.sourceFile, query.sources)
			&& matchesCommentValues(highlight, query.comments)
			&& matchesFieldValues(noteTypeSearchTarget, query.types)
			&& matchesFieldValues(colorSearchTarget, query.colors)
			&& matchesChapterValues(highlight, query.chapters, currentChapterTitle, currentChapterIndex)
			&& matchesDateRanges(highlight.createdTime, query.dateRanges);
	}

	let parsedHighlightSearchQuery = $derived.by(() => parseSearchQuery(searchQuery));

	let annotationListView = $derived.by(() => {
		const parsed = parsedHighlightSearchQuery;
		const filtered = highlights.filter((highlight) => matchesHighlightQuery(highlight, parsed));
		return {
			filtered,
			availableTags: buildUniqueSortedValues(highlights.flatMap((highlight) => highlight.tags)),
			availableSources: buildUniqueSortedValues(highlights.map((highlight) => highlight.sourceFile)),
			availableCommentStates: buildUniqueSortedValues(
				highlights.map((highlight) => highlight.commentStateLabel)
			),
			availableNoteTypes: buildUniqueSortedValues(highlights.map((highlight) => highlight.noteType)),
			availableHighlightColors: buildUniqueSortedValues(
				highlights.map((highlight) => highlight.colorLabel)
			),
			availableChapters: buildUniqueSortedValues(
				highlights.map((highlight) => getHighlightChapterLabel(highlight))
			),
		};
	});

	let filteredHighlights = $derived(annotationListView.filtered);

	let availableTagOptions = $derived(annotationListView.availableTags);
	let availableSourceOptions = $derived(annotationListView.availableSources);
	let availableCommentStateOptions = $derived(annotationListView.availableCommentStates);
	let availableNoteTypeOptions = $derived(annotationListView.availableNoteTypes);
	let availableHighlightColorOptions = $derived(annotationListView.availableHighlightColors);
	let availableChapterOptions = $derived(annotationListView.availableChapters);

	let selectedHighlights = $derived.by(() =>
		filteredHighlights.filter((highlight) => selectedKeys.has(getHighlightSelectionKey(highlight)))
	);

	let selectionCountLabel = $derived(
		t('epub.notes.selectionCount', {
			selected: selectedHighlights.length,
			total: filteredHighlights.length,
		})
	);

	$effect(() => {
		searchMeta = {
			availableTags: availableTagOptions,
			availableSources: availableSourceOptions,
			availableCommentStates: availableCommentStateOptions,
			availableNoteTypes: availableNoteTypeOptions,
			availableHighlightColors: availableHighlightColorOptions,
			availableChapters: availableChapterOptions,
			matchCount: filteredHighlights.length,
			totalCount: highlights.length,
		};
	});

	function exitSelectionMode() {
		selectionMode = false;
		selectedKeys = new Set();
	}

	function enterSelectionMode(seedHighlight?: EpubDisplayHighlight) {
		selectionMode = true;
		if (seedHighlight) {
			const next = new Set(selectedKeys);
			next.add(getHighlightSelectionKey(seedHighlight));
			selectedKeys = next;
		}
	}

	function toggleHighlightSelection(highlight: EpubDisplayHighlight) {
		const key = getHighlightSelectionKey(highlight);
		const next = new Set(selectedKeys);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		selectedKeys = next;
	}

	function selectAllFilteredHighlights() {
		selectedKeys = new Set(filteredHighlights.map((highlight) => getHighlightSelectionKey(highlight)));
	}

	function clearSelectedHighlights() {
		selectedKeys = new Set();
	}

	function attachMenuApp(menu: Menu) {
		(menu as Menu & { app?: App }).app = app;
	}

	async function exportSelectedHighlights() {
		if (!onExportHighlights || selectedHighlights.length === 0) {
			new Notice(t('epub.notes.noExportableSelection'));
			return;
		}
		await onExportHighlights(selectedHighlights.map((highlight) => getHighlightSelectionKey(highlight)));
		exitSelectionMode();
	}

	async function deleteHighlightItem(highlight: EpubDisplayHighlight, quiet = false): Promise<boolean> {
		if (!onDeleteHighlight) {
			if (!quiet) {
				new Notice(t('epub.reader.highlightDeleteFailed'));
			}
			return false;
		}
		return onDeleteHighlight(highlight);
	}

	async function deleteSelectedHighlights() {
		if (!onDeleteHighlight || selectedHighlights.length === 0 || batchDeleting) {
			return;
		}
		const confirmed = await showObsidianConfirm(
			app,
			t('epub.notes.batchDeleteConfirm', { count: selectedHighlights.length }),
			{
				title: t('epub.reader.highlightDeleteChoiceTitle'),
				confirmText: t('epub.notes.menu.deleteSelected'),
				cancelText: t('epub.reader.highlightDeleteChoiceCancel'),
				confirmClass: 'mod-warning',
			}
		);
		if (!confirmed) {
			return;
		}

		batchDeleting = true;
		let deletedCount = 0;
		try {
			for (const highlight of selectedHighlights) {
				const deleted = await deleteHighlightItem(highlight, true);
				if (deleted) {
					deletedCount += 1;
				}
			}
			if (deletedCount > 0) {
				new Notice(t('epub.notes.batchDeleted', { count: deletedCount }));
			}
			if (deletedCount < selectedHighlights.length) {
				new Notice(t('epub.notes.batchDeleteFailed'));
			}
			exitSelectionMode();
		} finally {
			batchDeleting = false;
		}
	}

	function showPanelContextMenu(event: MouseEvent) {
		event.preventDefault();
		const menu = new Menu();
		attachMenuApp(menu);

		if (selectionMode) {
			menu.addItem((item) => {
				item.setTitle(t('epub.notes.menu.exportSelected'));
				item.setIcon('download');
				item.setDisabled(selectedHighlights.length === 0 || !onExportHighlights);
				item.onClick(() => {
					void exportSelectedHighlights();
				});
			});
			menu.addItem((item) => {
				item.setTitle(t('epub.notes.menu.deleteSelected'));
				item.setIcon('trash');
				item.setDisabled(selectedHighlights.length === 0 || !onDeleteHighlight || batchDeleting);
				item.onClick(() => {
					void deleteSelectedHighlights();
				});
			});
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle(t('epub.notes.menu.selectAll'));
				item.setIcon('check-check');
				item.setDisabled(filteredHighlights.length === 0);
				item.onClick(() => {
					selectAllFilteredHighlights();
				});
			});
			menu.addItem((item) => {
				item.setTitle(t('epub.notes.menu.deselectAll'));
				item.setIcon('ban');
				item.setDisabled(selectedHighlights.length === 0);
				item.onClick(() => {
					clearSelectedHighlights();
				});
			});
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle(t('epub.notes.menu.exitBatchSelect'));
				item.setIcon('x');
				item.onClick(() => {
					exitSelectionMode();
				});
			});
		} else {
			menu.addItem((item) => {
				item.setTitle(t('epub.notes.menu.batchSelect'));
				item.setIcon('check-square');
				item.onClick(() => {
					enterSelectionMode();
				});
			});
			if (onExportHighlights) {
				menu.addItem((item) => {
					item.setTitle(t('epub.notes.menu.exportFiltered'));
					item.setIcon('download');
					item.setDisabled(filteredHighlights.length === 0);
					item.onClick(() => {
						void onExportHighlights(
							filteredHighlights.map((highlight) => getHighlightSelectionKey(highlight))
						);
					});
				});
			}
		}

		menu.showAtMouseEvent(event);
	}

	function showHighlightContextMenu(event: MouseEvent, highlight: EpubDisplayHighlight) {
		event.preventDefault();
		event.stopPropagation();
		const menu = new Menu();
		attachMenuApp(menu);

		if (!selectionMode) {
			menu.addItem((item) => {
				item.setTitle(t('epub.notes.menu.batchSelect'));
				item.setIcon('check-square');
				item.onClick(() => {
					enterSelectionMode(highlight);
				});
			});
		}

		menu.addItem((item) => {
			item.setTitle(t('epub.notes.menu.delete'));
			item.setIcon('trash');
			item.setDisabled(!onDeleteHighlight || batchDeleting);
			item.onClick(() => {
				void deleteHighlightItem(highlight);
			});
		});

		menu.showAtMouseEvent(event);
	}

	function handleHighlightActivate(highlight: EpubDisplayHighlight) {
		if (selectionMode) {
			toggleHighlightSelection(highlight);
			return;
		}
		navigateToHighlight(highlight);
	}

	function isStaleAnnotationsLoad(loadToken: number, expectedBookId: string, expectedFilePath?: string): boolean {
		return panelDisposed
			|| loadToken !== annotationLoadToken
			|| book?.id !== expectedBookId
			|| (filePath ?? '') !== (expectedFilePath ?? '');
	}

	function applySnapshot(nextHighlights: EpubDisplayHighlight[]) {
		highlights = nextHighlights;
	}

	async function hydratePageLabelsInBackground(
		loadToken: number,
		expectedBook: NonNullable<typeof book>,
		expectedFilePath: string | undefined,
		showStrikethrough: boolean
	) {
		if (!snapshotService) {
			return;
		}
		try {
			const hydratedSnapshot = await snapshotService.hydratePageLabels({
				bookId: expectedBook.id,
				filePath: expectedFilePath ?? '',
				showStrikethroughHighlights: showStrikethrough,
				annotationService,
				backlinkService,
				readerService,
				highlightRevision,
			});
			if (!hydratedSnapshot || isStaleAnnotationsLoad(loadToken, expectedBook.id, expectedFilePath)) {
				return;
			}
			applySnapshot(hydratedSnapshot.highlights);
		} catch (error) {
			logger.error('[NotesPanel] Failed to hydrate page labels:', error);
		}
	}

	function shouldSkipBackgroundAnnotationRefresh(snapshot: EpubHighlightRenderSnapshot): boolean {
		return (
			snapshot.revision === highlightRevision &&
			snapshot.pageLabelsResolved
		);
	}

	async function refreshAnnotationsInBackground(
		loadToken: number,
		expectedBook: NonNullable<typeof book>,
		expectedFilePath: string | undefined,
		showStrikethrough: boolean
	) {
		if (!snapshotService) {
			return;
		}
		syncing = true;
		try {
			const freshSnapshot = await snapshotService.revalidateSnapshot({
				bookId: expectedBook.id,
				filePath: expectedFilePath ?? '',
				showStrikethroughHighlights: showStrikethrough,
				annotationService,
				backlinkService,
				readerService,
				highlightRevision,
			});
			if (!freshSnapshot || isStaleAnnotationsLoad(loadToken, expectedBook.id, expectedFilePath)) {
				return;
			}
			applySnapshot(freshSnapshot.highlights);
			if (!freshSnapshot.pageLabelsResolved) {
				void hydratePageLabelsInBackground(
					loadToken,
					expectedBook,
					expectedFilePath,
					showStrikethrough
				);
			}
		} catch (error) {
			logger.error('[NotesPanel] Failed to refresh annotations:', error);
		} finally {
			if (!isStaleAnnotationsLoad(loadToken, expectedBook.id, expectedFilePath)) {
				syncing = false;
			}
		}
	}

	function buildSnapshotContext(
		currentBook: NonNullable<typeof book>,
		expectedFilePath: string | undefined
	) {
		return {
			bookId: currentBook.id,
			filePath: expectedFilePath ?? '',
			showStrikethroughHighlights,
		};
	}

	async function resolveDisplaySnapshot(
		currentBook: NonNullable<typeof book>,
		expectedFilePath: string | undefined
	) {
		const context = buildSnapshotContext(currentBook, expectedFilePath);
		const memorySnapshot = snapshotService?.getCachedSnapshot(context) || null;
		if (memorySnapshot) {
			return memorySnapshot;
		}
		if (!snapshotService) {
			return null;
		}
		return (await snapshotService.hydrateFromDisk(context)) || null;
	}

	async function loadAnnotations() {
		const currentBook = book;
		if (!currentBook) {
			highlights = [];
			preparing = false;
			syncing = false;
			return;
		}
		const expectedFilePath = filePath;
		const loadToken = ++annotationLoadToken;
		const snapshotContext = buildSnapshotContext(currentBook, expectedFilePath);
		const cachedSnapshot = await resolveDisplaySnapshot(currentBook, expectedFilePath);
		if (cachedSnapshot) {
			applySnapshot(cachedSnapshot.highlights);
			preparing = false;
			if (shouldSkipBackgroundAnnotationRefresh(cachedSnapshot)) {
				return;
			}
			if (!cachedSnapshot.pageLabelsResolved) {
				void hydratePageLabelsInBackground(
					loadToken,
					currentBook,
					expectedFilePath,
					showStrikethroughHighlights
				);
			}
			void refreshAnnotationsInBackground(
				loadToken,
				currentBook,
				expectedFilePath,
				showStrikethroughHighlights
			);
			return;
		}

		const annotationIndex = getEpubAnnotationIndexService(app);
		const readiness = annotationIndex.getReadiness(snapshotContext);
		if (readiness === 'preparing') {
			preparing = true;
			syncing = false;
			await annotationIndex.waitForReady(snapshotContext);
			if (isStaleAnnotationsLoad(loadToken, currentBook.id, expectedFilePath)) {
				return;
			}
			const warmedSnapshot = await resolveDisplaySnapshot(currentBook, expectedFilePath);
			if (warmedSnapshot) {
				applySnapshot(warmedSnapshot.highlights);
				preparing = false;
				if (shouldSkipBackgroundAnnotationRefresh(warmedSnapshot)) {
					return;
				}
				if (!warmedSnapshot.pageLabelsResolved) {
					void hydratePageLabelsInBackground(
						loadToken,
						currentBook,
						expectedFilePath,
						showStrikethroughHighlights
					);
				}
				void refreshAnnotationsInBackground(
					loadToken,
					currentBook,
					expectedFilePath,
					showStrikethroughHighlights
				);
				return;
			}
		}

		preparing = true;
		syncing = false;
		try {
			await annotationIndex.prefetchBook({
				...snapshotContext,
				annotationService,
				backlinkService,
				readerService,
				highlightRevision,
				priority: 'immediate',
			});
			if (isStaleAnnotationsLoad(loadToken, currentBook.id, expectedFilePath)) {
				return;
			}
			const freshSnapshot = await resolveDisplaySnapshot(currentBook, expectedFilePath);
			if (freshSnapshot) {
				applySnapshot(freshSnapshot.highlights);
				if (!freshSnapshot.pageLabelsResolved && snapshotService) {
					void hydratePageLabelsInBackground(
						loadToken,
						currentBook,
						expectedFilePath,
						showStrikethroughHighlights
					);
				}
				return;
			}

			const revalidatedSnapshot = snapshotService
				? await snapshotService.revalidateSnapshot({
					...snapshotContext,
					annotationService,
					backlinkService,
					readerService,
					highlightRevision,
				})
				: null;
			if (isStaleAnnotationsLoad(loadToken, currentBook.id, expectedFilePath)) {
				return;
			}
			if (revalidatedSnapshot) {
				applySnapshot(revalidatedSnapshot.highlights);
				if (!revalidatedSnapshot.pageLabelsResolved && snapshotService) {
					void hydratePageLabelsInBackground(
						loadToken,
						currentBook,
						expectedFilePath,
						showStrikethroughHighlights
					);
				}
			}
		} catch (error) {
			if (isStaleAnnotationsLoad(loadToken, currentBook.id, expectedFilePath)) {
				return;
			}
			logger.error('[NotesPanel] Failed to load annotations:', error);
			highlights = [];
		} finally {
			if (!isStaleAnnotationsLoad(loadToken, currentBook.id, expectedFilePath)) {
				preparing = false;
			}
		}
	}

	$effect(() => {
		const contextKey = [book?.id ?? '', filePath ?? '', String(highlightRevision), showStrikethroughHighlights ? '1' : '0'].join('::');
		if (book && annotationService) {
			if (contextKey === lastLoadContextKey) {
				return;
			}
			lastLoadContextKey = contextKey;
			void loadAnnotations();
		} else {
			annotationLoadToken += 1;
			highlights = [];
			preparing = false;
			syncing = false;
			lastLoadContextKey = '';
		}
	});

	onMount(() => {
		return () => {
			panelDisposed = true;
			annotationLoadToken += 1;
		};
	});
</script>

<div
	class="epub-notes-panel"
	class:selection-mode={selectionMode}
	oncontextmenu={showPanelContextMenu}
>
	{#if preparing}
		<EpubLoadingState message={t('epub.notes.preparing')} surface />
	{:else if filteredHighlights.length === 0}
		<div class="epub-placeholder">
			{#if highlights.length === 0}
				{t('epub.notes.empty')}
			{:else}
				{t('epub.notes.noMatches')}
			{/if}
		</div>
	{:else}
		{#if selectionMode}
			<div
				class="epub-notes-selection-float"
				role="toolbar"
				aria-label={t('epub.notes.menu.batchSelect')}
				aria-live="polite"
			>
				<span class="epub-notes-selection-count" aria-label={selectionCountLabel}>
					<span class="epub-notes-selection-count-selected">{selectedHighlights.length}</span>
					<span class="epub-notes-selection-count-sep">/</span>
					<span class="epub-notes-selection-count-total">{filteredHighlights.length}</span>
				</span>
				<span class="epub-notes-selection-divider" aria-hidden="true"></span>
				<div class="epub-notes-selection-actions">
					<button
						type="button"
						class="clickable-icon epub-notes-selection-icon-btn"
						title={t('epub.notes.menu.exportSelected')}
						aria-label={t('epub.notes.menu.exportSelected')}
						disabled={selectedHighlights.length === 0 || !onExportHighlights}
						onclick={() => void exportSelectedHighlights()}
					>
						<span use:iconAction={'download'}></span>
					</button>
					<button
						type="button"
						class="clickable-icon epub-notes-selection-icon-btn epub-notes-selection-icon-btn--danger"
						title={t('epub.notes.menu.deleteSelected')}
						aria-label={t('epub.notes.menu.deleteSelected')}
						disabled={selectedHighlights.length === 0 || !onDeleteHighlight || batchDeleting}
						onclick={() => void deleteSelectedHighlights()}
					>
						<span use:iconAction={'trash-2'}></span>
					</button>
					<button
						type="button"
						class="clickable-icon epub-notes-selection-icon-btn"
						title={t('epub.notes.menu.exitBatchSelect')}
						aria-label={t('epub.notes.menu.exitBatchSelect')}
						onclick={exitSelectionMode}
					>
						<span use:iconAction={'x'}></span>
					</button>
				</div>
			</div>
		{/if}
		{#if syncing}
			<div class="epub-notes-sync-hint" aria-live="polite">{t('epub.notes.syncing')}</div>
		{/if}
		{#if filteredHighlights.length > 0}
			<section class="notes-section">
				<div class="notes-section-list">
					{#each filteredHighlights as hl (getHighlightSelectionKey(hl))}
						<EpubAnnotationCard
							clickable={true}
							selectionMode={selectionMode}
							selected={selectedKeys.has(getHighlightSelectionKey(hl))}
							onActivate={() => handleHighlightActivate(hl)}
							onContextMenu={(event) => showHighlightContextMenu(event, hl)}
							color={hl.color}
							quoteText={hl.text}
							commentText={hl.hasCommentDivider ? (hl.commentText || t('epub.notes.emptyComment')) : getEmptyExcerptHint(hl.text)}
							commentMuted={!hl.hasCommentDivider}
							metaLeft={getSourceLabel(hl.sourceFile)}
							metaRightPrefix={formatTime(hl.createdTime)}
							metaRight={hl.pageLabel || getHighlightChapterLabel(hl)}
						/>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>

<style>
	.epub-notes-sync-hint {
		flex: 0 0 auto;
		padding: 4px 12px 0;
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
	}

	.epub-notes-panel {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 14px 12px 22px;
		position: relative;
		min-height: 100%;
		box-sizing: border-box;
	}

	.epub-notes-panel.selection-mode {
		padding-top: 6px;
	}

	.epub-notes-selection-float {
		position: sticky;
		top: 6px;
		z-index: 6;
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 10px;
		padding: 6px 8px 6px 12px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--background-modifier-border) 72%, transparent);
		background: color-mix(in srgb, var(--background-primary) 88%, transparent);
		box-shadow:
			0 10px 28px rgba(0, 0, 0, 0.16),
			0 1px 0 color-mix(in srgb, white 8%, transparent) inset;
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		align-self: center;
		width: fit-content;
		max-width: calc(100% - 8px);
		margin-inline: auto;
	}

	.epub-notes-selection-count {
		display: inline-flex;
		align-items: baseline;
		gap: 1px;
		font-size: var(--font-ui-smaller);
		font-variant-numeric: tabular-nums;
		line-height: 1;
		color: var(--text-muted);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.epub-notes-selection-count-selected {
		font-weight: 700;
		color: var(--text-normal);
	}

	.epub-notes-selection-count-sep {
		opacity: 0.55;
		padding-inline: 1px;
	}

	.epub-notes-selection-divider {
		width: 1px;
		height: 18px;
		background: color-mix(in srgb, var(--background-modifier-border) 88%, transparent);
		flex-shrink: 0;
	}

	.epub-notes-selection-actions {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	:global(.epub-notes-panel .epub-notes-selection-icon-btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border: none;
		border-radius: var(--clickable-icon-radius);
		background: transparent;
		box-shadow: none;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	:global(.epub-notes-panel .epub-notes-selection-icon-btn .svg-icon) {
		width: var(--icon-s);
		height: var(--icon-s);
	}

	:global(.epub-notes-panel .epub-notes-selection-icon-btn:hover:not(:disabled)) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	:global(.epub-notes-panel .epub-notes-selection-icon-btn--danger:hover:not(:disabled)) {
		background: color-mix(in srgb, var(--text-error) 12%, transparent);
		color: var(--text-error);
	}

	:global(.epub-notes-panel .epub-notes-selection-icon-btn:disabled) {
		opacity: 0.38;
		cursor: not-allowed;
	}

	@media (prefers-reduced-motion: reduce) {
		.epub-notes-selection-float {
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
		}
	}

	.epub-placeholder {
		padding: 22px 14px;
		border-radius: 16px;
		background: color-mix(in srgb, var(--weave-elevated-background, var(--background-secondary)) 88%, transparent);
		color: var(--text-muted);
		font-size: 13px;
		line-height: 1.7;
	}

	.notes-section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.notes-section-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
</style>
