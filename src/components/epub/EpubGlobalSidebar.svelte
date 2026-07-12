<script lang="ts">
	import { onMount } from 'svelte';
 	import { Notice, setIcon } from 'obsidian';
	import { tr } from '../../utils/i18n';
	import type { App } from 'obsidian';
 	import { logger } from '../../utils/logger';
	import { findOpenEpubLeaf } from '../../utils/epub-leaf-utils';
	import { EPUB_RUNTIME, type EpubBook, type TocItem } from '../../services/epub';
	import type { EpubTocChapterMark } from '../../services/epub/epub-toc-chapter-mark';
	import type { FlatTocExportItem } from '../../services/epub/epub-toc-export-scope';
	import { EpubBookmarkService, type EpubBookmarkRecord } from '../../services/epub/EpubBookmarkService';
  	import { epubActiveDocumentStore } from '../../stores/epub-active-document-store';
  	import type { EpubNavigationRequest, EpubSharedState } from '../../stores/epub-active-document-store';
	import EpubSearchInput from './EpubSearchInput.svelte';
  	import TableOfContents from './TableOfContents.svelte';
	import { resolveLastReadTocHref, resolveActiveTocHref } from '../../utils/epub-toc-reading-position';
	import EpubBookmarksPanel from './EpubBookmarksPanel.svelte';
  	import NotesPanel from './NotesPanel.svelte';
  	import BookshelfView from './BookshelfView.svelte';
	import EpubLoadingState from './EpubLoadingState.svelte';

	interface Props {
		app: App;
	}

 	let { app }: Props = $props();
	let t = $derived($tr);

	function getBookmarkService(): EpubBookmarkService {
		return new EpubBookmarkService(app);
	}

 	let sharedState = $state<EpubSharedState | null>(null);
	let activeTab = $state<'toc' | 'bookmarks' | 'highlights'>('toc');
  	let sidebarView = $state<'details' | 'bookshelf'>('details');
  	let tocItems = $state<TocItem[]>([]);
  	let bookshelfRefreshToken = $state(0);
  	let bookshelfMounted = $state(false);
  	let effectiveSidebarView = $derived(sharedState?.book ? sidebarView : 'bookshelf');

	$effect(() => {
		if (effectiveSidebarView === 'bookshelf') {
			bookshelfMounted = true;
		}
	});

	let searchQuery = $state('');
	let searchResults = $state<Array<{ cfi: string; excerpt: string; chapterTitle: string }>>([]);
	let searching = $state(false);
	let searched = $state(false);
	let searchTimer: ReturnType<typeof window.setTimeout> | null = null;
	let searchRequestToken = 0;
	let searchInputEl: HTMLInputElement | undefined = $state(undefined);
	let isSearchActive = $derived(searchQuery.trim().length > 0);
	let collapsedChapters = $state<Set<string>>(new Set());
	let lastSearchedQuery = $state('');
	let lastSearchContextKey = '';
	let highlightSearchMeta = $state({
		availableTags: [] as string[],
		availableSources: [] as string[],
		availableCommentStates: [] as string[],
		availableNoteTypes: [] as string[],
		availableHighlightColors: [] as string[],
		availableChapters: [] as string[],
		matchCount: 0,
		totalCount: 0,
	});
	let highlightCount = $state(0);
	let highlightCountLoadToken = 0;
	let lastHighlightCountContextKey = '';
	let bookmarkCount = $state(0);
	let bookmarkCountLoadToken = 0;
	let lastBookmarkCountContextKey = '';
  	let tocLoadToken = 0;
	let tocLoading = $state(false);
	let tocLoadFailed = $state(false);
  	let sidebarDisposed = false;
 	let lastExternalSearchNonce = 0;
 	const SIDEBAR_PROGRESS_SEGMENT_COUNT = 16;
	let sidebarProgressPercent = $derived(Math.max(0, Math.min(100, Math.round(sharedState?.progress ?? 0))));
	let lastReadTocHref = $derived.by(() => {
		const state = sharedState;
		if (!state?.canUseReadingProgress || !state.book) {
			return null;
		}
		void state.progress;
		void state.bookmarkRevision;
		return resolveLastReadTocHref(state.book, state.readerService, tocItems);
	});
	let activeTocHref = $derived.by(() => {
		const state = sharedState;
		if (!state?.chapterHref || tocItems.length === 0) {
			return null;
		}
		void state.chapterHref;
		void state.progress;
		return resolveActiveTocHref(tocItems, state.chapterHref);
	});
	let sidebarProgressSegments = $derived(
		Array.from({ length: SIDEBAR_PROGRESS_SEGMENT_COUNT }, (_, index) => ({
			index,
			filled: index < Math.round((sidebarProgressPercent / 100) * SIDEBAR_PROGRESS_SEGMENT_COUNT)
		}))
	);
	let hasAnyResults = $derived(searchResults.length > 0);
	let resultCount = $derived(searchResults.length);

	const SEARCH_SNIPPET_CONTEXT = 36;
	const SEARCH_SNIPPET_MAX_LENGTH = 120;

	type GroupedResults = Array<{ chapter: string; items: Array<{ cfi: string; excerpt: string }> }>;
	let groupedSearchResults = $derived.by(() => {
		if (searchResults.length === 0) return [] as GroupedResults;
		const map = new Map<string, Array<{ cfi: string; excerpt: string }>>();
		for (const r of searchResults) {
			const chapter = r.chapterTitle || t('epub.globalSidebar.untitledChapter');
			if (!map.has(chapter)) map.set(chapter, []);
			map.get(chapter)!.push({ cfi: r.cfi, excerpt: r.excerpt });
		}
		return Array.from(map.entries()).map(([chapter, items]) => ({ chapter, items }));
	});

	function icon(node: HTMLElement, name: string) {
		setIcon(node, name);
		return {
			update(newName: string) {
				// /skip innerHTML is used to clear the trusted icon container before setIcon rerenders it
				node.replaceChildren();
				setIcon(node, newName);
			}
		};
	}

	function switchTab(tab: 'toc' | 'bookmarks' | 'highlights') {
		if (tab === 'highlights' && !sharedState?.canUseExcerptNotes) {
			return;
		}
 		activeTab = tab;
 		if (isSearchActive) {
 			if (searchTimer) window.clearTimeout(searchTimer);
 			lastSearchContextKey = '';
 		}
	}

	function clearSearchResultsState() {
		searchResults = [];
	}

	function getSearchContextKey(tab = activeTab): string {
		return [
			tab,
			sharedState?.filePath ?? '',
			sharedState?.book?.id ?? '',
			tab === 'highlights'
				? `${String(sharedState?.annotationRevision ?? 0)}::${sharedState?.excerptSettings?.showStrikethroughInSidebar ? 'with-strikethrough' : 'without-strikethrough'}`
				: tab === 'bookmarks'
					? `${String(sharedState?.bookmarkRevision ?? 0)}`
					: '',
		].join('::');
	}

	function isStaleSearchRequest(
		requestToken: number,
		query: string,
		tab: 'toc' | 'bookmarks' | 'highlights',
		contextKey: string,
	): boolean {
		return sidebarDisposed
			|| requestToken !== searchRequestToken
			|| searchQuery.trim() !== query
			|| activeTab !== tab
			|| getSearchContextKey(tab) !== contextKey;
	}

	function handleSearchInput() {
		if (activeTab !== 'toc') {
			searched = false;
			searching = false;
			clearSearchResultsState();
			lastSearchedQuery = '';
			lastSearchContextKey = '';
			return;
		}
		if (searchTimer) window.clearTimeout(searchTimer);
		searched = false;
		if (!searchQuery.trim()) {
			searching = false;
			clearSearchResultsState();
			lastSearchedQuery = '';
			lastSearchContextKey = '';
			return;
		}
		searchTimer = window.setTimeout(() => doSearch(), 500);
	}

	async function doSearch() {
		const q = searchQuery.trim();
		const tab = activeTab;
		const contextKey = getSearchContextKey(tab);
		const requestToken = ++searchRequestToken;
		const readerService = sharedState?.readerService;
		if (!q || !readerService) {
			if (isStaleSearchRequest(requestToken, q, tab, contextKey)) {
				return;
			}
			searching = false;
			searched = false;
			clearSearchResultsState();
			lastSearchedQuery = '';
			lastSearchContextKey = '';
			return;
		}
		searching = true;
		try {
			if (tab === 'toc') {
				const raw = await readerService.searchText(q);
				if (isStaleSearchRequest(requestToken, q, tab, contextKey)) {
					return;
				}
				const seen = new Set<string>();
				searchResults = raw.filter((r) => {
					if (!r?.cfi) return false;
					if (seen.has(r.cfi)) return false;
					seen.add(r.cfi);
					return true;
				});
			} else {
				clearSearchResultsState();
			}
			if (isStaleSearchRequest(requestToken, q, tab, contextKey)) {
				return;
			}
			lastSearchedQuery = q;
			lastSearchContextKey = contextKey;
		} catch (_e) {
			if (isStaleSearchRequest(requestToken, q, tab, contextKey)) {
				return;
			}
			clearSearchResultsState();
			lastSearchedQuery = q;
			lastSearchContextKey = contextKey;
		} finally {
			if (!isStaleSearchRequest(requestToken, q, tab, contextKey)) {
				searching = false;
				searched = true;
			}
		}
	}

	function handleSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			if (searchTimer) window.clearTimeout(searchTimer);
			doSearch();
		}
		if (e.key === 'Escape') {
			clearSearch();
		}
	}

	function clearSearch() {
		searchRequestToken += 1;
		searchQuery = '';
		clearSearchResultsState();
		searched = false;
		searching = false;
		lastSearchedQuery = '';
		lastSearchContextKey = '';
		collapsedChapters = new Set();
		searchInputEl?.blur();
	}

	function getHighlightColorClass(color: string): string {
		return `hl-${color}`;
	}

	function formatAnnotationTime(timestamp: number): string {
		if (!timestamp) return '';
		const now = Date.now();
		const diff = now - timestamp;
		const minutes = Math.floor(diff / 60000);
		if (minutes < 1) return t('epub.globalSidebar.justNow');
		if (minutes < 60) return t('epub.globalSidebar.minutesAgo', { count: minutes });
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return t('epub.globalSidebar.hoursAgo', { count: hours });
		const days = Math.floor(hours / 24);
		return t('epub.globalSidebar.daysAgo', { count: days });
	}

	function escapeHtml(str: string): string {
		return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function normalizeExcerpt(excerpt: string): string {
		return excerpt.replace(/\s+/g, ' ').trim();
	}

	function getSearchTerms(q: string): string[] {
		return Array.from(new Set(
			q
				.trim()
				.toLowerCase()
				.split(/\s+/)
				.map((part) => part.trim())
				.filter(Boolean)
		));
	}

	function buildSearchSnippet(excerpt: string, q: string): string {
		const normalized = normalizeExcerpt(excerpt);
		if (!normalized) return '';

		const terms = getSearchTerms(q);
		if (terms.length === 0) {
			return normalized.length > SEARCH_SNIPPET_MAX_LENGTH
				? `${normalized.slice(0, SEARCH_SNIPPET_MAX_LENGTH).trimEnd()}...`
				: normalized;
		}

		const lower = normalized.toLowerCase();
		let matchIndex = -1;
		let matchedLength = 0;

		for (const term of terms) {
			const index = lower.indexOf(term);
			if (index !== -1 && (matchIndex === -1 || index < matchIndex)) {
				matchIndex = index;
				matchedLength = term.length;
			}
		}

		if (matchIndex === -1) {
			return normalized.length > SEARCH_SNIPPET_MAX_LENGTH
				? `${normalized.slice(0, SEARCH_SNIPPET_MAX_LENGTH).trimEnd()}...`
				: normalized;
		}

		const snippetStart = Math.max(0, matchIndex - SEARCH_SNIPPET_CONTEXT);
		const minimumEnd = matchIndex + Math.max(matchedLength, SEARCH_SNIPPET_CONTEXT);
		const snippetEnd = Math.min(
			normalized.length,
			Math.max(snippetStart + SEARCH_SNIPPET_MAX_LENGTH, minimumEnd)
		);

		let snippet = normalized.slice(snippetStart, snippetEnd).trim();
		if (snippetStart > 0) snippet = `...${snippet}`;
		if (snippetEnd < normalized.length) snippet = `${snippet}...`;
		return snippet;
	}

	function toggleChapter(chapter: string) {
		const next = new Set(collapsedChapters);
		if (next.has(chapter)) {
			next.delete(chapter);
		} else {
			next.add(chapter);
		}
		collapsedChapters = next;
	}

	function highlightExcerpt(excerpt: string, q: string): string {
		const text = escapeHtml(normalizeExcerpt(excerpt));
		const raw = q.trim();
		if (!raw) return text;
		const parts = raw.split(/\s+/).map((p) => p.trim()).filter(Boolean);
		if (parts.length === 0) return text;
		const escapedParts = parts.map((p) => escapeHtml(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
		const pattern = escapedParts.join('|');
		return text.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>');
	}

	function toggleAllChapters(collapsed: boolean) {
		if (!collapsed) {
			collapsedChapters = new Set();
			return;
		}
		const next = new Set<string>();
		for (const group of groupedSearchResults) {
			next.add(group.chapter);
		}
		collapsedChapters = next;
	}

	function toggleBookshelfView() {
		sidebarView = sidebarView === 'details' ? 'bookshelf' : 'details';
	}

	function refreshBookshelf() {
		bookshelfRefreshToken++;
	}

	function returnFromBookshelfToReaderSidebar() {
		if (sharedState?.book) {
			sidebarView = 'details';
		}
	}

	async function loadHighlightCount(
		book: EpubBook,
		annotationService: NonNullable<EpubSharedState['annotationService']>,
		highlightViewSnapshotService: EpubSharedState['highlightViewSnapshotService'] | undefined,
		filePath?: string | null,
		backlinkService?: EpubSharedState['backlinkService']
	) {
		const loadToken = ++highlightCountLoadToken;
		const snapshotContext = {
			bookId: book.id,
			filePath: filePath ?? '',
			showStrikethroughHighlights: Boolean(sharedState?.excerptSettings?.showStrikethroughInSidebar),
		};
		const cachedSnapshot =
			highlightViewSnapshotService?.getCachedSnapshot(snapshotContext)
			|| (await highlightViewSnapshotService?.hydrateFromDisk(snapshotContext))
			|| null;
		if (cachedSnapshot) {
			highlightCount = cachedSnapshot.highlights.length;
			return;
		}
		try {
			const snapshot = highlightViewSnapshotService
				? await highlightViewSnapshotService.revalidateSnapshot({
					bookId: book.id,
					filePath: filePath ?? '',
					showStrikethroughHighlights: Boolean(sharedState?.excerptSettings?.showStrikethroughInSidebar),
					annotationService,
					backlinkService: backlinkService ?? undefined,
					readerService: sharedState?.readerService ?? undefined,
					highlightRevision: sharedState?.annotationRevision ?? 0,
				})
				: null;
			if (loadToken !== highlightCountLoadToken) return;
			highlightCount = snapshot?.highlights.length ?? 0;
		} catch (error) {
			logger.error('[EpubGlobalSidebar] Failed to load highlight count:', error);
			if (loadToken === highlightCountLoadToken) {
				highlightCount = 0;
			}
		}
	}

	async function loadBookmarkCount(book: EpubBook) {
		const loadToken = ++bookmarkCountLoadToken;
		try {
			const count = await getBookmarkService().getBookmarkCountForBook(book);
			if (loadToken !== bookmarkCountLoadToken) return;
			bookmarkCount = count;
		} catch (error) {
			logger.error('[EpubGlobalSidebar] Failed to load bookmark count:', error);
			if (loadToken === bookmarkCountLoadToken) {
				bookmarkCount = 0;
			}
		}
	}

	async function loadToc() {
		const readerService = sharedState?.readerService;
		const bookId = sharedState?.book?.id ?? '';
		const filePath = sharedState?.filePath ?? '';
		if (!readerService || !bookId) {
			tocItems = [];
			tocLoading = false;
			tocLoadFailed = false;
			return;
		}
		const loadToken = ++tocLoadToken;
		tocLoading = true;
		tocLoadFailed = false;
		try {
			const items = await readerService.getTableOfContents();
			if (sidebarDisposed || loadToken !== tocLoadToken || sharedState?.book?.id !== bookId || (sharedState?.filePath ?? '') !== filePath) {
				return;
			}
			tocItems = items;
			tocLoadFailed = false;
		} catch (error) {
			logger.error('[EpubGlobalSidebar] Failed to load TOC:', error);
			if (!sidebarDisposed && loadToken === tocLoadToken) {
				tocItems = [];
				tocLoadFailed = true;
			}
		} finally {
			if (!sidebarDisposed && loadToken === tocLoadToken) {
				tocLoading = false;
			}
		}
	}

	function waitForAnimationFrame(): Promise<void> {
		return new Promise((resolve) => requestAnimationFrame(() => resolve()));
	}

	async function ensureEpubLeafActive(): Promise<boolean> {
		if (!sharedState?.filePath) return false;
		const targetLeaf = findOpenEpubLeaf(app, sharedState.filePath);
		if (!targetLeaf) {
			return false;
		}
		app.workspace.setActiveLeaf(targetLeaf, { focus: true });
		void app.workspace.revealLeaf(targetLeaf);
		await waitForAnimationFrame();
		await waitForAnimationFrame();
		return true;
	}

	async function requestReaderNavigation(request: EpubNavigationRequest): Promise<void> {
		if (!sharedState?.filePath) {
			return;
		}
		const activated = await ensureEpubLeafActive();
		if (!activated) {
			return;
		}
		if (sharedState.onNavigate) {
			sharedState.onNavigate(request);
			return;
		}
		window.dispatchEvent(new CustomEvent(EPUB_RUNTIME.events.navigate, {
			detail: {
				filePath: sharedState.filePath,
				...request,
			}
		}));
	}

	async function handleTocNavigate(href: string) {
		if (!sharedState?.readerService || !sharedState.filePath) return;
		try {
			await requestReaderNavigation({
				href,
				flashStyle: 'none',
				showLocateOverlay: true,
			});
		} catch (error) {
			logger.error('[EpubGlobalSidebar] Failed to navigate:', error);
		}
	}

	async function handleTocCreateReadingPoint(item: TocItem, event?: MouseEvent) {
		if (!sharedState?.onCreateChapterReadingPoint) {
			new Notice(t('epub.globalSidebar.irUnavailable'));
			return;
		}

		try {
			await ensureEpubLeafActive();
			await sharedState.onCreateChapterReadingPoint(item, event);
		} catch (error) {
			logger.error('[EpubGlobalSidebar] Failed to add toc item to incremental reading:', error);
			new Notice(t('epub.globalSidebar.irAddFailed'));
		}
	}

	async function handleTocExportChapterMarked(
		item: FlatTocExportItem,
		itemIndex: number,
		flatTocItems: FlatTocExportItem[]
	) {
		if (!sharedState?.onExportTocChapterMarked) {
			new Notice(t('epub.reader.exportMarkdownUnavailable'));
			return;
		}

		try {
			await ensureEpubLeafActive();
			await sharedState.onExportTocChapterMarked(item, itemIndex, flatTocItems);
		} catch (error) {
			logger.error('[EpubGlobalSidebar] Failed to export toc chapter marked markdown:', error);
			new Notice(t('epub.reader.exportMarkdownFailed'));
		}
	}

	async function handleTocSetChapterMark(item: TocItem, mark: EpubTocChapterMark | null) {
		if (!sharedState?.onSetTocChapterMark) {
			return;
		}

		try {
			await ensureEpubLeafActive();
			await sharedState.onSetTocChapterMark(item, mark);
		} catch (error) {
			logger.error('[EpubGlobalSidebar] Failed to update toc chapter mark:', error);
			new Notice(t('epub.globalSidebar.tocMarkUpdateFailed'));
		}
	}

	async function handleTocSaveChapterMarkSettings(settings: EpubTocChapterMarkSettings) {
		if (!sharedState?.onSaveTocChapterMarkSettings) {
			return;
		}

		try {
			await ensureEpubLeafActive();
			await sharedState.onSaveTocChapterMarkSettings(settings);
		} catch (error) {
			logger.error('[EpubGlobalSidebar] Failed to save toc chapter mark settings:', error);
			new Notice(t('epub.globalSidebar.tocMarkSettingsSaveFailed'));
		}
	}

	async function handleHighlightNavigate(
		cfi: string,
		text?: string,
		color?: string,
		metadata?: {
			sourceFile?: string;
			sourceRef?: string;
			createdTime?: number;
		}
	) {
		if (!sharedState?.readerService) return;
		try {
			await requestReaderNavigation({
				cfi,
				text,
				flashStyle: 'pulse',
				flashColor: color,
				showLocateOverlay: true,
			});
		} catch (error) {
			logger.error('[EpubGlobalSidebar] Failed to navigate to highlight:', error);
		}
	}

	async function handleSearchResultNavigate(cfi: string, text?: string) {
		if (!sharedState?.readerService) return;
		try {
			await requestReaderNavigation({
				cfi,
				text,
				flashStyle: 'highlight',
				showLocateOverlay: true,
			});
		} catch (error) {
			logger.error('[EpubGlobalSidebar] Failed to navigate to search result:', error);
		}
	}

	async function handleDeleteBookmark(bookmark: EpubBookmarkRecord) {
		if (!sharedState?.onDeleteBookmark) {
			return false;
		}
		return sharedState.onDeleteBookmark(bookmark.id);
	}

	$effect(() => {
		if (sharedState?.book) {
			void loadToc();
		} else {
			tocItems = [];
			tocLoading = false;
			tocLoadFailed = false;
		}
	});

	$effect(() => {
		const externalSearchNonce = sharedState?.searchRequestNonce ?? 0;
		const externalSearchQuery = String(sharedState?.searchQuerySeed || '').trim();
		if (!externalSearchNonce || externalSearchNonce === lastExternalSearchNonce) {
			return;
		}
		lastExternalSearchNonce = externalSearchNonce;
		if (!externalSearchQuery) {
			return;
		}
		sidebarView = 'details';
		activeTab = 'toc';
		searchQuery = externalSearchQuery;
		searched = false;
		if (searchTimer) {
			window.clearTimeout(searchTimer);
			searchTimer = null;
		}
		void doSearch();
	});

	$effect(() => {
		if (activeTab === 'highlights' && sharedState && !sharedState.canUseExcerptNotes) {
			activeTab = 'toc';
		}
	});

	$effect(() => {
		const book = sharedState?.book;
		const annotationService = sharedState?.annotationService;
		const highlightViewSnapshotService = sharedState?.highlightViewSnapshotService;
		const filePath = sharedState?.filePath;
		const backlinkService = sharedState?.backlinkService;
		const canUseExcerptNotes = sharedState?.canUseExcerptNotes ?? false;
		const highlightRevision = sharedState?.annotationRevision ?? 0;
		const showStrikethroughInSidebar = sharedState?.excerptSettings?.showStrikethroughInSidebar ? '1' : '0';
		const highlightContextKey = [book?.id ?? '', filePath ?? '', String(highlightRevision), showStrikethroughInSidebar].join('::');

		highlightRevision;

		if (!canUseExcerptNotes || !book || !annotationService) {
			highlightCountLoadToken += 1;
			highlightCount = 0;
			lastHighlightCountContextKey = '';
			return;
		}

		if (highlightContextKey !== lastHighlightCountContextKey) {
			lastHighlightCountContextKey = highlightContextKey;
			void loadHighlightCount(book, annotationService, highlightViewSnapshotService, filePath, backlinkService);
		}
	});

	$effect(() => {
		const book = sharedState?.book;
		const bookmarkRevision = sharedState?.bookmarkRevision ?? 0;
		const bookmarkContextKey = [book?.id ?? '', String(bookmarkRevision)].join('::');

		if (!book) {
			bookmarkCountLoadToken += 1;
			bookmarkCount = 0;
			lastBookmarkCountContextKey = '';
			return;
		}

		if (bookmarkContextKey !== lastBookmarkCountContextKey) {
			lastBookmarkCountContextKey = bookmarkContextKey;
			void loadBookmarkCount(book);
		}
	});

	$effect(() => {
		const q = searchQuery.trim();
		const contextKey = getSearchContextKey();
		if (activeTab === 'highlights' && !sharedState?.canUseExcerptNotes) {
			searchRequestToken += 1;
			clearSearchResultsState();
			searching = false;
			searched = false;
			lastSearchedQuery = '';
			lastSearchContextKey = '';
			return;
		}
		if (!q) {
			lastSearchContextKey = '';
			return;
		}
		if (!sharedState?.readerService) {
			searchRequestToken += 1;
			clearSearchResultsState();
			searching = false;
			searched = false;
			lastSearchedQuery = '';
			lastSearchContextKey = '';
			return;
		}
		if (lastSearchedQuery === q && lastSearchContextKey !== contextKey) {
			if (searchTimer) {
				window.clearTimeout(searchTimer);
				searchTimer = null;
			}
			void doSearch();
		}
	});

	onMount(() => {
		const unsubscribe = epubActiveDocumentStore.subscribeState((state) => {
			sharedState = { ...state };
		});
		return () => {
			sidebarDisposed = true;
			searchRequestToken += 1;
			tocLoadToken += 1;
			highlightCountLoadToken += 1;
			bookmarkCountLoadToken += 1;
			if (searchTimer) {
				window.clearTimeout(searchTimer);
				searchTimer = null;
			}
			unsubscribe();
		};
	});
</script>

<div class="epub-global-sidebar">
	{#if bookshelfMounted}
		<div
			class="epub-global-sidebar-bookshelf"
			class:is-hidden={effectiveSidebarView !== 'bookshelf'}
			aria-hidden={effectiveSidebarView !== 'bookshelf'}
		>
			<BookshelfView
				{app}
				onSwitchBook={sharedState?.onSwitchBook ?? undefined}
				onClose={returnFromBookshelfToReaderSidebar}
				onBack={returnFromBookshelfToReaderSidebar}
				backButtonLabel={t('epub.globalSidebar.backToDirectory')}
				refreshToken={bookshelfRefreshToken}
				onSettingsClick={sharedState?.onSettingsClick ?? undefined}
			/>
		</div>
	{/if}
	{#if effectiveSidebarView !== 'bookshelf' && !sharedState?.book}
		<div class="epub-global-sidebar-empty">
			<span class="empty-icon" use:icon={'book-open'}></span>
			<span class="empty-text">{t('epub.globalSidebar.noBookOpen')}</span>
		</div>
	{:else if effectiveSidebarView !== 'bookshelf'}
		{#if sidebarView === 'details'}
			<div class="epub-global-sidebar-header">
				<div class="header-flex">
					{#if sharedState.book.metadata.coverImage}
						<img src={sharedState.book.metadata.coverImage} alt={t('epub.globalSidebar.coverAlt')} class="sidebar-cover" />
					{:else}
						<div class="sidebar-cover-placeholder">
							<span use:icon={'book-open'}></span>
						</div>
					{/if}
					<div class="header-info">
						<div class="book-title">{sharedState.book.metadata.title || ''}</div>
						{#if sharedState.book.metadata.author}
							<div class="book-meta">
								<span class="book-author">{sharedState.book.metadata.author}</span>
							</div>
						{/if}
						{#if sharedState.canUseReadingProgress}
							<div
								class="book-progress-track"
								role="progressbar"
								aria-label={t('epub.globalSidebar.progress')}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={sidebarProgressPercent}
								aria-valuetext={`${sidebarProgressPercent}%`}
								title={t('epub.globalSidebar.progressTitle', { progress: sidebarProgressPercent })}
							>
								{#each sidebarProgressSegments as segment (segment.index)}
									<span class="book-progress-segment" class:filled={segment.filled}></span>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</div>

			<div class="epub-global-search-bar">
				<div class="epub-search-bar-row">
					{#if activeTab === 'highlights' && sharedState.canUseExcerptNotes}
						<div class="epub-search-input-card-shell">
							<EpubSearchInput
								app={app}
								bind:value={searchQuery}
								placeholder={t('epub.globalSidebar.searchStartPlaceholder')}
								dataSource="epub-highlights"
								availableTags={highlightSearchMeta.availableTags}
								availableSources={highlightSearchMeta.availableSources}
								availableCommentStates={highlightSearchMeta.availableCommentStates}
								availableNoteTypes={highlightSearchMeta.availableNoteTypes}
								availableHighlightColors={highlightSearchMeta.availableHighlightColors}
								availableChapters={highlightSearchMeta.availableChapters}
								matchCount={highlightSearchMeta.matchCount}
								totalCount={highlightSearchMeta.totalCount}
							/>
						</div>
					{:else}
						<div class="epub-search-input-container">
							<span class="epub-search-icon" use:icon={'search'}></span>
							<input
								bind:this={searchInputEl}
								bind:value={searchQuery}
								oninput={handleSearchInput}
								onkeydown={handleSearchKeydown}
								placeholder={t('epub.globalSidebar.searchPlaceholder')}
								class="epub-search-input"
							/>
							{#if searchQuery}
								<button class="epub-search-clear" onclick={clearSearch} title={t('epub.globalSidebar.clearSearch')}>
									<span use:icon={'x'}></span>
								</button>
							{/if}
						</div>
					{/if}
					<div class="epub-search-actions">
						<button
							class="epub-search-action-btn clickable-icon"
							onclick={toggleBookshelfView}
							title={t('epub.globalSidebar.bookshelf')}
							aria-label={t('epub.globalSidebar.bookshelf')}
						>
							<span use:icon={'library'}></span>
						</button>
					</div>
				</div>
			</div>

			<div class="epub-global-sidebar-tabs">
				<button
					class="clickable-icon epub-global-tab"
					class:active={activeTab === 'toc'}
					onclick={() => switchTab('toc')}
				>
					<span class="tab-icon" use:icon={'list'}></span>
					<span class="tab-label">{t('epub.globalSidebar.tabs.toc')}</span>
				</button>
				{#if sharedState.canUseExcerptNotes}
					<button
						class="clickable-icon epub-global-tab"
						class:active={activeTab === 'highlights'}
						onclick={() => switchTab('highlights')}
					>
						<span class="tab-icon" use:icon={'highlighter'}></span>
						<span class="tab-label">{t('epub.globalSidebar.tabs.highlights')}</span>
						<span class="tab-count">{highlightCount}</span>
					</button>
				{/if}
				<button
					class="clickable-icon epub-global-tab"
					class:active={activeTab === 'bookmarks'}
					onclick={() => switchTab('bookmarks')}
				>
					<span class="tab-icon" use:icon={'bookmark'}></span>
					<span class="tab-label">{t('epub.globalSidebar.tabs.bookmarks')}</span>
					<span class="tab-count">{bookmarkCount}</span>
				</button>
			</div>

			<div class="epub-sidebar-content">
				{#if isSearchActive && activeTab === 'toc'}
					<div class="epub-search-results">
						{#if searching}
							<div class="search-empty-state">
								<EpubLoadingState message={t('epub.globalSidebar.searching')} surface />
							</div>
						{:else if searched && !hasAnyResults}
							<div class="search-empty-state">{t('epub.globalSidebar.noResults')}</div>
						{:else if hasAnyResults}
							<div class="search-toolbar">
								<span class="search-toolbar-count">
									{t('epub.globalSidebar.resultsCount', { count: resultCount })}
									{#if lastSearchedQuery && lastSearchedQuery !== searchQuery.trim()}
										<span class="search-toolbar-stale">{t('epub.globalSidebar.queryChanged')}</span>
									{/if}
								</span>
								{#if activeTab === 'toc' && searchResults.length > 0}
									<div class="search-toolbar-actions">
										<button class="search-toolbar-btn" onclick={() => toggleAllChapters(false)} title={t('epub.globalSidebar.expandAll')}>
											<span use:icon={'chevrons-down'}></span>
										</button>
										<button class="search-toolbar-btn" onclick={() => toggleAllChapters(true)} title={t('epub.globalSidebar.collapseAll')}>
											<span use:icon={'chevrons-up'}></span>
										</button>
									</div>
								{/if}
							</div>

							{#if activeTab === 'toc'}
								{#each groupedSearchResults as group}
									<div class="search-group">
										<button class="search-group-header" onclick={() => toggleChapter(group.chapter)}>
											<span class="search-group-chevron" use:icon={collapsedChapters.has(group.chapter) ? 'chevron-right' : 'chevron-down'}></span>
											<span class="search-group-name">{group.chapter}</span>
											<span class="search-group-badge">{group.items.length}</span>
										</button>
										{#if !collapsedChapters.has(group.chapter)}
											<div class="search-group-items">
												{#each group.items as item}
													<button class="search-item" onclick={() => handleSearchResultNavigate(item.cfi, item.excerpt)}>
														<div class="search-item-accent"></div>
														<div class="search-item-content">
															<div class="search-item-text">
																{@html highlightExcerpt(buildSearchSnippet(item.excerpt, searchQuery), searchQuery)}
															</div>
														</div>
													</button>
												{/each}
											</div>
										{/if}
									</div>
								{/each}
							{/if}
						{/if}
					</div>
				{:else if activeTab === 'toc'}
					<TableOfContents
						items={tocItems}
						loading={tocLoading && tocItems.length === 0}
						loadFailed={tocLoadFailed && !tocLoading}
						activeHref={activeTocHref}
						lastReadHref={lastReadTocHref}
						chapterMarks={sharedState?.tocChapterMarks ?? {}}
						tocChapterMarkSettings={sharedState?.tocChapterMarkSettings ?? {}}
						autoScrollToActive={activeTab === 'toc' && !isSearchActive}
						onNavigate={handleTocNavigate}
						onSetChapterMark={sharedState?.onSetTocChapterMark ? handleTocSetChapterMark : undefined}
						onSaveTocChapterMarkSettings={sharedState?.onSaveTocChapterMarkSettings ? handleTocSaveChapterMarkSettings : undefined}
						onAddToIncrementalReading={sharedState?.onCreateChapterReadingPoint ? handleTocCreateReadingPoint : undefined}
						onExportChapterMarked={sharedState?.onExportTocChapterMarked ? handleTocExportChapterMarked : undefined}
					/>
				{:else if activeTab === 'bookmarks'}
					<EpubBookmarksPanel
						app={app}
						book={sharedState.book}
						bookmarkRevision={sharedState.bookmarkRevision}
						onDeleteBookmark={handleDeleteBookmark}
						onNavigate={handleHighlightNavigate}
					/>
				{:else if activeTab === 'highlights'}
					{#if sharedState.annotationService}
						<NotesPanel
							{app}
							book={sharedState.book}
							readerService={sharedState.readerService ?? undefined}
							annotationService={sharedState.annotationService}
							snapshotService={sharedState.highlightViewSnapshotService ?? undefined}
							backlinkService={sharedState.backlinkService ?? undefined}
							filePath={sharedState.filePath ?? undefined}
							highlightRevision={sharedState.annotationRevision}
							showStrikethroughHighlights={Boolean(sharedState.excerptSettings?.showStrikethroughInSidebar)}
							currentChapterTitle={sharedState.chapterTitle}
							currentChapterIndex={sharedState.readerService?.getCurrentChapterIndex?.() ?? -1}
							onDeleteHighlight={sharedState.onDeleteHighlight ?? undefined}
							onExportHighlights={sharedState.onExportHighlights ?? undefined}
							bind:searchQuery={searchQuery}
							bind:searchMeta={highlightSearchMeta}
							onNavigate={handleHighlightNavigate}
						/>
					{/if}
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	:global(.view-content.weave-epub-global-sidebar-view) {
		--weave-epub-sidebar-host-background: var(--weave-surface-background, var(--background-primary));
		background: var(--weave-epub-sidebar-host-background);
	}

	:global(.view-content.weave-epub-global-sidebar-view[data-weave-surface-context="sidebar"]) {
		--weave-epub-sidebar-host-background: transparent;
		background: transparent;
	}

	.epub-global-sidebar {
		/* Inherit host background in the sidebar to avoid an extra surface layer. */
		--weave-epub-sidebar-surface-background: var(
			--weave-epub-sidebar-host-background,
			var(--weave-surface-background, var(--background-primary))
		);
		--weave-epub-sidebar-elevated-background: var(--weave-elevated-background, var(--background-primary));
		--weave-epub-sidebar-cover-width: var(--size-4-12);
		--weave-epub-sidebar-cover-height: 68px;
		--weave-epub-sidebar-cover-radius: var(--radius-s);
		--weave-epub-sidebar-cover-icon-size: 20px;
		--weave-epub-sidebar-progress-height: 10px;
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		width: 100%;
		overflow: hidden;
		background: var(--weave-epub-sidebar-surface-background);
	}

	.epub-global-sidebar > * {
		min-height: 0;
	}

	.epub-global-sidebar-bookshelf {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-height: 0;
		width: 100%;
	}

	.epub-global-sidebar-bookshelf.is-hidden {
		display: none;
	}

	.epub-global-sidebar-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		flex: 1;
		min-height: 0;
		gap: var(--size-4-2);
		color: var(--text-faint);
		font-size: var(--font-ui-small);
	}

	.epub-global-sidebar-empty .empty-icon :global(.svg-icon) {
		width: 24px;
		height: 24px;
	}

	.epub-global-sidebar-header {
		padding: var(--size-4-3) var(--size-4-4);
		border-bottom: 1px solid var(--background-modifier-border);
		flex-shrink: 0;
		background: var(--weave-epub-sidebar-surface-background);
	}

	.epub-global-sidebar-header .book-title {
		font-size: var(--font-ui-small);
		font-weight: 600;
		color: var(--text-normal);
		line-height: 1.3;
		margin-bottom: var(--size-2-1);
	}

	.epub-global-sidebar-header .book-meta {
		font-size: var(--font-ui-small);
		line-height: 1.5;
		color: var(--text-muted);
		margin-bottom: var(--size-2-1);
	}

	.epub-global-sidebar-header .book-progress-track {
		display: grid;
		grid-template-columns: repeat(16, minmax(0, 1fr));
		gap: var(--size-2-2);
		align-items: center;
		margin-top: var(--size-2-1);
	}

	.epub-global-sidebar-header .book-progress-segment {
		flex: 1 1 0;
		min-width: 0;
		height: var(--weave-epub-sidebar-progress-height);
		border-radius: 999px;
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, var(--text-muted) 60%, transparent);
		background: transparent;
		opacity: 0.6;
		transition: background-color 0.16s ease, border-color 0.16s ease, opacity 0.16s ease;
	}

	.epub-global-sidebar-header .book-progress-segment.filled {
		background: var(--text-normal);
		border-color: var(--text-normal);
		opacity: 1;
	}

	.epub-global-sidebar-header .header-flex {
		display: flex;
		gap: var(--size-4-3);
		align-items: flex-start;
	}

	.epub-global-sidebar-header .sidebar-cover {
		width: var(--weave-epub-sidebar-cover-width);
		height: var(--weave-epub-sidebar-cover-height);
		object-fit: cover;
		border-radius: var(--weave-epub-sidebar-cover-radius);
		flex-shrink: 0;
		box-shadow: var(--shadow-s);
	}

	.epub-global-sidebar-header .sidebar-cover-placeholder {
		width: var(--weave-epub-sidebar-cover-width);
		height: var(--weave-epub-sidebar-cover-height);
		border-radius: var(--weave-epub-sidebar-cover-radius);
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--background-modifier-border);
		color: var(--text-faint);
	}

	.epub-global-sidebar-header .sidebar-cover-placeholder :global(.svg-icon) {
		width: var(--weave-epub-sidebar-cover-icon-size);
		height: var(--weave-epub-sidebar-cover-icon-size);
	}

	.epub-global-sidebar-header .header-info {
		flex: 1;
		min-width: 0;
	}

	.epub-global-sidebar-tabs {
		display: flex;
		align-items: stretch;
		gap: var(--size-2-1);
		padding: var(--size-2-2) var(--size-4-3) 0;
		flex-shrink: 0;
		background: var(--weave-epub-sidebar-surface-background);
		overflow: hidden;
		border-bottom: none;
	}

	.epub-global-tab {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--size-2-2);
		padding: var(--size-2-3) var(--size-4-2);
		background: transparent;
		border: none;
		border-radius: 0;
		box-shadow: none;
		outline: none;
		appearance: none;
		-webkit-appearance: none;
		font-size: var(--font-ui-smaller);
		font-weight: 500;
		color: var(--text-muted);
		cursor: pointer;
		transition: color 0.15s ease, background-color 0.15s ease;
		line-height: 1;
	}

	button.epub-global-tab .tab-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	button.epub-global-tab .tab-icon :global(.svg-icon) {
		width: var(--icon-xs);
		height: var(--icon-xs);
	}

	button.epub-global-tab .tab-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	button.epub-global-tab .tab-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		height: auto;
		padding: 0;
		flex-shrink: 0;
		border-radius: 0;
		background: transparent;
		border: none;
		color: var(--text-faint);
		font-size: var(--font-ui-smaller);
		font-weight: 600;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	button.epub-global-tab.active .tab-count {
		color: var(--text-muted);
	}

	button.epub-global-tab:hover {
		color: var(--text-normal);
		background: color-mix(in srgb, var(--background-modifier-hover) 80%, transparent);
	}

	button.epub-global-tab.active {
		color: var(--text-normal);
		font-weight: 600;
		background: var(--background-modifier-hover);
		border: none;
		box-shadow: none;
	}

	button.epub-global-tab:focus,
	button.epub-global-tab:focus-visible,
	button.epub-global-tab:hover,
	button.epub-global-tab.active {
		outline: none;
		box-shadow: none;
	}

	.epub-global-search-bar {
		padding: var(--size-2-3) var(--size-4-3) 0;
		flex-shrink: 0;
	}

	.epub-search-bar-row {
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
	}

	.epub-search-input-card-shell {
		flex: 1;
		min-width: 0;
	}

	.epub-search-input-card-shell :global(.search-input-wrapper) {
		background: var(--background-modifier-form-field);
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--input-radius);
		box-shadow: none;
	}

	.epub-search-input-card-shell :global(.search-input-wrapper:focus-within) {
		border-color: var(--interactive-accent);
		box-shadow: 0 0 0 2px rgba(var(--interactive-accent-rgb), 0.15);
	}

	.epub-search-input-card-shell :global(.search-input),
	.epub-search-input-card-shell :global(.search-input:focus),
	.epub-search-input-card-shell :global(.search-input:focus-visible) {
		appearance: none;
		-webkit-appearance: none;
		border: none;
		background: transparent;
		box-shadow: none;
		outline: none;
	}

	.epub-search-input-container {
		display: flex;
		align-items: center;
		gap: var(--size-2-2);
		padding: 0 var(--size-4-2);
		height: var(--input-height);
		background: var(--background-modifier-form-field);
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--input-radius);
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
		flex: 1;
		min-width: 0;
	}

	.epub-search-input-container:focus-within {
		border-color: var(--interactive-accent);
		box-shadow: 0 0 0 2px rgba(var(--interactive-accent-rgb), 0.15);
	}

	.epub-search-icon {
		flex-shrink: 0;
		color: var(--text-faint);
		display: flex;
		align-items: center;
	}

	.epub-search-icon :global(.svg-icon) {
		width: var(--icon-xs);
		height: var(--icon-xs);
	}

	.epub-search-input {
		flex: 1;
		border: none;
		background: transparent;
		color: var(--text-normal);
		font-size: var(--font-ui-small);
		padding: 0;
		outline: none;
		min-width: 0;
		height: 100%;
	}

	.epub-search-input::placeholder {
		color: var(--text-faint);
	}

	.epub-search-clear {
		flex-shrink: 0;
		background: none;
		border: none;
		color: var(--text-faint);
		cursor: pointer;
		padding: var(--size-2-1);
		display: flex;
		align-items: center;
		border-radius: var(--clickable-icon-radius);
		transition: color 0.1s ease;
	}

	.epub-search-clear:hover {
		color: var(--text-normal);
	}

	.epub-search-clear :global(.svg-icon) {
		width: var(--icon-xs);
		height: var(--icon-xs);
	}

	.epub-search-actions {
		display: flex;
		align-items: center;
		gap: var(--size-2-2);
		flex-shrink: 0;
	}

	.epub-search-action-btn {
		width: var(--input-height);
		height: var(--input-height);
		padding: 0;
		border: none;
		border-radius: var(--clickable-icon-radius);
		background: transparent;
		box-shadow: none;
		color: var(--text-muted);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background-color 0.14s ease, color 0.14s ease;
	}

	.epub-search-action-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.epub-search-action-btn:active {
		background: var(--background-modifier-active-hover);
	}

	.epub-search-action-btn :global(.svg-icon) {
		width: var(--icon-s);
		height: var(--icon-s);
	}

	:global(.epub-sidebar-content) {
		overflow-x: hidden;
	}

	.epub-sidebar-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	.search-toolbar-btn,
	.search-group-header,
	.search-item {
		appearance: none;
		-webkit-appearance: none;
		background: none;
		border: none;
		padding: 0;
		margin: 0;
		font: inherit;
		color: inherit;
		text-align: left;
		text-decoration: none;
		outline: none;
		box-shadow: none;
		box-sizing: border-box;
		cursor: pointer;
	}

	.epub-search-results {
		flex: 1 0 auto;
		width: 100%;
		max-height: none;
		overflow-y: visible;
	}

	.search-empty-state {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 40px 20px;
		color: var(--text-faint);
		font-size: var(--font-ui-small);
		line-height: 1.5;
	}

	.search-toolbar {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--size-4-2);
		padding: var(--size-4-2) var(--size-4-5);
		background: var(--weave-epub-sidebar-surface-background);
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.search-toolbar-count {
		flex: 1 1 140px;
		min-width: 0;
		font-size: var(--font-ui-smaller);
		color: var(--text-faint);
		font-weight: 500;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}

	.search-toolbar-stale {
		font-weight: 400;
		color: var(--text-muted);
	}

	.search-toolbar-actions {
		display: flex;
		align-items: center;
		gap: var(--size-2-1);
		margin-left: auto;
	}

	.search-toolbar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--input-height);
		height: var(--input-height);
		border-radius: var(--clickable-icon-radius);
		color: var(--text-faint);
		transition: background 0.12s, color 0.12s;
	}

	.search-toolbar-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-muted);
	}

	.search-toolbar-btn :global(.svg-icon) {
		width: var(--icon-xs);
		height: var(--icon-xs);
	}

	.search-group + .search-group {
		border-top: 1px solid var(--background-modifier-border);
	}

	.search-group-header {
		display: flex;
		align-items: center;
		gap: var(--size-2-3);
		width: 100%;
		padding: var(--size-4-2) var(--size-4-5);
		font-size: var(--font-ui-smaller);
		font-weight: 600;
		color: var(--text-muted);
		transition: color 0.12s;
	}

	.search-group-header:hover {
		color: var(--text-normal);
	}

	.search-group-chevron {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		color: var(--text-faint);
	}

	.search-group-chevron :global(.svg-icon) {
		width: var(--icon-xs);
		height: var(--icon-xs);
	}

	.search-group-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.search-group-badge {
		flex-shrink: 0;
		font-size: calc(var(--font-ui-smaller) * 0.9);
		font-weight: 500;
		color: var(--text-faint);
		background: var(--background-modifier-hover);
		padding: var(--size-2-1) var(--size-2-3);
		border-radius: var(--pill-radius);
		line-height: 1.4;
	}

	.search-group-items {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-2);
		padding: var(--size-2-2) var(--size-4-2) var(--size-4-2) calc(var(--size-4-4) + var(--size-2-3));
	}

	.search-item {
		display: flex;
		width: 100%;
		margin: 0;
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
		background: var(--weave-epub-sidebar-elevated-background);
		overflow: hidden;
		transition: background 0.12s, border-color 0.12s, box-shadow 0.12s;
	}

	.search-item:hover {
		background: var(--background-modifier-hover);
		border-color: rgba(var(--interactive-accent-rgb), 0.24);
		box-shadow: var(--shadow-s);
	}

	.search-item-accent {
		width: 3px;
		flex-shrink: 0;
		background: var(--interactive-accent);
		opacity: 0.22;
		transition: opacity 0.12s;
	}

	.search-item:hover .search-item-accent {
		opacity: 0.7;
	}

	.search-item-content {
		flex: 1;
		min-width: 0;
		padding: var(--size-2-3) var(--size-4-3);
		display: flex;
		flex-direction: column;
	}

	.search-item-text {
		font-size: var(--font-ui-small);
		line-height: 1.55;
		color: var(--text-normal);
		white-space: normal;
		word-break: break-word;
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-line-clamp: 1;
		line-clamp: 1;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.search-item-text :global(mark) {
		background: var(--text-highlight-bg);
		color: inherit;
		border-radius: var(--radius-s);
		padding: 0 var(--size-2-1);
	}

	@container (max-width: 360px) {
		.epub-global-sidebar-header {
			padding: 12px 12px 10px;
		}

		.epub-global-sidebar-header .header-flex {
			gap: 10px;
		}

		.epub-global-sidebar-header .book-meta {
			margin-bottom: 6px;
		}

		.epub-global-sidebar-header .book-progress-track {
			gap: 3px;
		}

		.epub-global-sidebar-header .book-progress-segment {
			height: 9px;
		}

		.epub-global-sidebar-tabs {
			padding: 6px 10px 0;
			gap: 4px;
		}

		button.epub-global-tab {
			gap: 4px;
			padding: 8px 8px;
		}

		button.epub-global-tab .tab-count {
			padding: 0;
		}

		.epub-global-search-bar {
			padding: 8px 10px 0;
		}

		.search-toolbar {
			padding-left: var(--size-4-2);
			padding-right: var(--size-4-2);
		}

		.search-group-header {
			padding-left: var(--size-4-2);
			padding-right: var(--size-4-2);
		}

		.search-group-items {
			padding: 4px 8px 10px 16px;
		}
	}

	@container (max-width: 300px) {
		.epub-global-sidebar-tabs {
			flex-wrap: nowrap;
			gap: 4px;
		}

		button.epub-global-tab {
			flex: 1 1 0;
			gap: 2px;
			padding: 8px 6px;
			font-size: 11px;
		}

		button.epub-global-tab .tab-icon :global(.svg-icon) {
			width: 12px;
			height: 12px;
		}

		button.epub-global-tab .tab-count {
			min-width: 0;
			height: auto;
			padding: 0;
			font-size: 10px;
		}

		.epub-search-bar-row {
			gap: 6px;
		}
	}

</style>
