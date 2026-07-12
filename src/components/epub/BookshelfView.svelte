<script lang="ts">
        import { onDestroy, onMount, untrack } from 'svelte';
        import { get } from 'svelte/store';
        import { TFile, TAbstractFile, Menu, Notice, normalizePath } from 'obsidian';
        import type { App } from 'obsidian';
        import { logger } from '../../utils/logger';
        import {
                getEpubBacklinkHighlightService,
                EPUB_RUNTIME,
                canUseEpubReadingProgress,
                getEpubStorageService,
                resolveEpubHost,
                warmEpubAnnotationIndexForPaths,
        } from '../../services/epub';
        import { PremiumFeatureGuard } from '../../services/premium/PremiumFeatureGuard';
        import { getBookFormatDisplayLabel, isSupportedBookFile, stripSupportedBookExtension } from '../../services/epub/book-format';
        import { FoliateVaultPublicationParser } from '../../services/epub/FoliateVaultPublicationParser';
        import type { BookMetadata, EpubBook } from '../../services/epub';
        import {
                clampBookshelfProgress,
                formatBookshelfLastReadTime,
        } from '../../services/epub/bookshelf-progress-display';
        import {
                resolveBookshelfReadingStatus,
                resolveDisplayProgress,
                type BookshelfReadingStatus,
        } from '../../services/epub/book-progress';
        import { epubActiveDocumentStore } from '../../stores/epub-active-document-store';
        import { getNavigationHub } from '../../services/navigation/navigation-hub-access';
        import { currentLanguage, tr } from '../../utils/i18n';
        import EpubSearchInput from './EpubSearchInput.svelte';
        import EpubLoadingState from './EpubLoadingState.svelte';
        import BookshelfToolbar from './BookshelfToolbar.svelte';
        import BookshelfListBookItem from './BookshelfListBookItem.svelte';
        import BookshelfCoverTile from './BookshelfCoverTile.svelte';
        import BookshelfGridCard from './BookshelfGridCard.svelte';
        import BookshelfPlaylistRow from './BookshelfPlaylistRow.svelte';
        import BookshelfPlaylistGridCard from './BookshelfPlaylistGridCard.svelte';
        import BookshelfPlaylistCoverTile from './BookshelfPlaylistCoverTile.svelte';
        import BookshelfPlaylistDetail from './BookshelfPlaylistDetail.svelte';
        import type { EpubBookshelfPlaylist } from '../../services/epub/epub-bookshelf-playlist-store';
        import {
                collectBookshelfPlaylistAssignedPaths,
                remapBookshelfPlaylists,
        } from '../../services/epub/epub-bookshelf-playlist-store';
        import { parseSearchQuery, type SearchQuery } from '../../utils/search-parser';
        import {
                matchesBookshelfSearchQuery,
                matchesBookshelfPlaylistSearchQuery,
                type BookshelfSearchBookFields,
        } from '../../services/epub/bookshelf-search-match';
        import {
                getBookshelfDisplayModeOptions,
                getBookshelfDisplayModeOption,
                normalizeBookshelfDisplayMode,
                resolveBookshelfViewMode,
                type BookshelfDisplayMode
        } from '../../services/epub/bookshelf-display-mode';
        import {
                BOOKSHELF_LIST_VIRTUAL_ITEM_HEIGHT,
                BOOKSHELF_LIST_VIRTUAL_OVERSCAN,
                shouldUseBookshelfGridPaintOptimization,
                shouldUseBookshelfListVirtualScroll,
        } from '../../services/epub/bookshelf-display-performance';
        import {
                dispatchEpubBookshelfDataChanged,
                dispatchEpubBookshelfRefreshRequest,
                readBookshelfDataChangedDetail,
                readBookshelfRefreshRequestDetail,
        } from '../../services/epub/bookshelf-data-events';
        import VirtualScroll from '../ui/VirtualScroll.svelte';
        import { isVaultImageFile, resolveVaultImageResourceUrl } from '../../utils/vault-image-cover';

        interface EpubFileInfo {
                path: string;
                name: string;
                folder: string;
                size: number;
                addedAt?: number;
                customCoverPath?: string;
        }

        interface BookshelfBookMeta {
                title: string;
                author: string;
                translator?: string;
                publisher?: string;
                coverImage?: string;
                wordCount?: number;
                chapterCount?: number;
                progress: number;
                lastReadTime: number;
                createdTime: number;
                readingStatus: BookshelfReadingStatus;
        }

        interface DisplayBookItem extends EpubFileInfo {
                displayTitle: string;
                bylineText: string;
                statsLine: string;
                metaText: string;
                author: string;
                translator?: string;
                publisher?: string;
                wordCount?: number;
                formatLabel: string;
                progress: number;
                lastReadTime: number;
                addedAt: number;
                readingStatus: BookshelfReadingStatus;
        }

        interface ResolvedBookContext {
                requestedPath: string;
                targetPath: string;
                file: TFile;
                storedBook: EpubBook | null;
                metadata: BookMetadata;
        }

        interface BookNoteStats {
                totalHighlights: number;
                commentCount: number;
                sourceFileCount: number;
                available: boolean;
        }

        interface Props {
                app: App;
                onSwitchBook?: (filePath: string) => void | Promise<void>;
                onClose?: () => void | Promise<void>;
                onBack?: () => void | Promise<void>;
                backButtonLabel?: string;
                refreshToken?: number;
                onSettingsClick?: (event: MouseEvent) => void;
                surfaceContext?: 'main' | 'sidebar';
        }

        let {
                app,
                onSwitchBook,
                onClose,
                onBack,
                backButtonLabel = '',
                refreshToken = 0,
                onSettingsClick,
                surfaceContext,
        }: Props = $props();
        let t = $derived($tr);
        let activePlaylistId = $state<string | null>(null);
        let bookshelfPlaylists = $state<EpubBookshelfPlaylist[]>([]);
        let effectiveBackButtonLabel = $derived(
                activePlaylistId
                        ? t('epub.bookshelf.playlist.backToShelf')
                        : (backButtonLabel || t('epub.bookshelf.back'))
        );

        let epubFiles = $state<EpubFileInfo[]>([]);
        let covers = $state<Map<string, string>>(new Map());
        let bookMetaByPath = $state<Map<string, BookshelfBookMeta>>(new Map());
        let searchQuery = $state('');
        let searching = $state(false);
        let bookshelfSearchReady = false;
        let bookshelfSearchPersistTimer: ReturnType<typeof window.setTimeout> | null = null;
        let bookshelfDisplayMode = $state<BookshelfDisplayMode>('adaptive');
        let bookshelfPremiumUiRevision = $state(0);
        let canShowBookshelfProgress = $derived.by(() => {
                bookshelfPremiumUiRevision;
                return canUseEpubReadingProgress(app);
        });
        let detectedSurfaceContext = $state<'main' | 'sidebar'>('main');
        let bookshelfRootEl = $state<HTMLDivElement | null>(null);
        let surfaceContextObserver: MutationObserver | null = null;
        let loadingBooks = $state(false);
        let openingBookPath = $state<string | null>(null);
        let refreshRunId = 0;
        let pendingBookshelfReload = false;
        let pendingBookshelfRefresh = false;
        let pendingBookshelfRefreshNotice = false;
        let suppressBookshelfDataChangedReload = false;
        let coverLoadTimer: ReturnType<typeof window.setTimeout> | null = null;
        let metadataRetryTimer: ReturnType<typeof window.setTimeout> | null = null;
        const storageService = untrack(() => getEpubStorageService(app));
        const coverCache = new Map<string, string | null>();
        let coverPersistTimer: ReturnType<typeof window.setTimeout> | null = null;
        const coverPersistPending = new Map<string, string | null>();
        const BOOKSHELF_DATA_CHANGED_EVENT = EPUB_RUNTIME.events.bookshelfDataChanged;
        const BOOKSHELF_REFRESH_REQUEST_EVENT = EPUB_RUNTIME.events.bookshelfRefreshRequest;
        const BOOKSHELF_DISPLAY_SETTINGS_CHANGED_EVENT = EPUB_RUNTIME.events.bookshelfDisplaySettingsChanged;
        const BOOK_DISPLAY_TITLE_CHANGED_EVENT = EPUB_RUNTIME.events.bookDisplayTitleChanged;
        const BOOKSHELF_READING_STATUS_OPTIONS: BookshelfReadingStatus[] = ['未开始', '阅读中', '已读完'];

        function getLocalizedReadingStatus(status: BookshelfReadingStatus): string {
                switch (status) {
                        case '阅读中':
                                return t('epub.bookshelf.status.reading');
                        case '已读完':
                                return t('epub.bookshelf.status.finished');
                        default:
                                return t('epub.bookshelf.status.unread');
                }
        }

        function normalizeSurfaceContext(value: unknown): 'main' | 'sidebar' {
                return value === 'sidebar' ? 'sidebar' : 'main';
        }

        function getBookshelfDisplayModeSetting(): BookshelfDisplayMode {
                return normalizeBookshelfDisplayMode(getEpubHost()?.settings?.bookshelfDisplayMode);
        }

        function readSurfaceContextFromDom(): 'main' | 'sidebar' {
                if (surfaceContext) {
                        return normalizeSurfaceContext(surfaceContext);
                }

                const contextHost = bookshelfRootEl?.closest('[data-weave-surface-context]') as HTMLElement | null;
                return normalizeSurfaceContext(contextHost?.dataset?.weaveSurfaceContext);
        }

        function syncSurfaceContext(): void {
                detectedSurfaceContext = readSurfaceContextFromDom();
        }

        function syncDisplayModePreferences(): void {
                bookshelfDisplayMode = getBookshelfDisplayModeSetting();
                syncSurfaceContext();
        }

        let effectiveViewMode = $derived.by(() =>
                resolveBookshelfViewMode(bookshelfDisplayMode, detectedSurfaceContext)
        );
        let listViewportEl = $state<HTMLDivElement | null>(null);
        let listViewportHeight = $state(320);

        function setBookshelfFiles(files: EpubFileInfo[]) {
                epubFiles = [...files].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        }

        function getEpubHost(): any {
                return resolveEpubHost(app) as any;
        }

        function buildBookMeta(book: EpubBook): BookshelfBookMeta {
                return {
                        title: book.metadata.title?.trim() || '',
                        author: book.metadata.author?.trim() || '',
                        translator: book.metadata.translator?.trim() || undefined,
                        publisher: book.metadata.publisher?.trim() || undefined,
                        coverImage: book.metadata.coverImage?.trim() || undefined,
                        wordCount:
                                typeof book.metadata.wordCount === 'number' && book.metadata.wordCount > 0
                                        ? book.metadata.wordCount
                                        : undefined,
                        chapterCount:
                                typeof book.metadata.chapterCount === 'number' && book.metadata.chapterCount > 0
                                        ? book.metadata.chapterCount
                                        : undefined,
                        progress: resolveDisplayProgress(book),
                        lastReadTime: Number.isFinite(book.readingStats?.lastReadTime) ? book.readingStats.lastReadTime : 0,
                        createdTime: Number.isFinite(book.readingStats?.createdTime) ? book.readingStats.createdTime : 0,
                        readingStatus: resolveBookshelfReadingStatus(book),
                };
        }

        function hasActiveSearchCriteria(): boolean {
                return Boolean(searchQuery.trim());
        }

        function clearSearchCriteria(): void {
                searchQuery = '';
                if (!bookshelfSearchReady) {
                        return;
                }
                void storageService.saveBookshelfSearchQuery('');
        }

        async function hydrateBookshelfSearch(): Promise<void> {
                const saved = await storageService.loadBookshelfSearchQuery();
                if (saved.trim()) {
                        searchQuery = saved;
                        searching = true;
                }
                bookshelfSearchReady = true;
        }

        function scheduleBookshelfSearchPersist(query: string): void {
                if (!bookshelfSearchReady) {
                        return;
                }
                if (bookshelfSearchPersistTimer) {
                        window.clearTimeout(bookshelfSearchPersistTimer);
                }
                bookshelfSearchPersistTimer = window.setTimeout(() => {
                        bookshelfSearchPersistTimer = null;
                        void storageService.saveBookshelfSearchQuery(query);
                }, 300);
        }

        function flushBookshelfSearchPersist(): void {
                if (!bookshelfSearchReady) {
                        return;
                }
                if (bookshelfSearchPersistTimer) {
                        window.clearTimeout(bookshelfSearchPersistTimer);
                        bookshelfSearchPersistTimer = null;
                }
                void storageService.saveBookshelfSearchQuery(searchQuery);
        }

        function openBookshelfSearch(): void {
                searching = true;
        }

        function closeBookshelfSearch(): void {
                searching = false;
        }

        function toggleBookshelfSearch(): void {
                if (searching) {
                        closeBookshelfSearch();
                        return;
                }
                openBookshelfSearch();
        }

        function buildUniqueSortedValues(values: Array<string | undefined>): string[] {
                return Array.from(
                        new Set(values.map((value) => value?.trim() || '').filter(Boolean))
                ).sort((a, b) => a.localeCompare(b, 'zh-CN'));
        }

        function matchesBookshelfQuery(file: DisplayBookItem, query: SearchQuery): boolean {
                return matchesBookshelfSearchQuery(
                        {
                                displayTitle: file.displayTitle,
                                metaText: file.metaText,
                                statsLine: file.statsLine,
                                name: file.name,
                                folder: file.folder,
                                author: file.author,
                                translator: file.translator,
                                publisher: file.publisher,
                                formatLabel: file.formatLabel,
                                readingStatus: file.readingStatus,
                                localizedReadingStatus: getLocalizedReadingStatus(file.readingStatus),
                                path: file.path,
                                addedAt: file.addedAt,
                        },
                        query
                );
        }

        function normalizeOptionalText(value: string | undefined): string | undefined {
                const normalized = typeof value === 'string' ? value.trim() : '';
                return normalized || undefined;
        }

        function pickFirstText(...values: Array<string | undefined>): string | undefined {
                for (const value of values) {
                        const normalized = normalizeOptionalText(value);
                        if (normalized) {
                                return normalized;
                        }
                }
                return undefined;
        }

        function mergeSubjects(...values: Array<string[] | undefined>): string[] | undefined {
                const next: string[] = [];
                const seen = new Set<string>();
                for (const entries of values) {
                        if (!Array.isArray(entries)) {
                                continue;
                        }
                        for (const entry of entries) {
                                const normalized = normalizeOptionalText(entry);
                                if (!normalized || seen.has(normalized)) {
                                        continue;
                                }
                                seen.add(normalized);
                                next.push(normalized);
                        }
                }
                return next.length > 0 ? next : undefined;
        }

        function mergeBookMetadata(
                storedMetadata: Partial<BookMetadata> | null | undefined,
                liveMetadata: Partial<BookMetadata> | null | undefined,
                coverImage?: string | undefined
        ): BookMetadata {
                return {
                        title: pickFirstText(liveMetadata?.title, storedMetadata?.title) || t('epub.bookshelf.untitled'),
                        author: pickFirstText(liveMetadata?.author, storedMetadata?.author) || t('epub.bookshelf.unknownAuthor'),
                        publisher: pickFirstText(liveMetadata?.publisher, storedMetadata?.publisher),
                        language: pickFirstText(liveMetadata?.language, storedMetadata?.language),
                        identifier: pickFirstText(liveMetadata?.identifier, storedMetadata?.identifier),
                        isbn: pickFirstText(liveMetadata?.isbn, storedMetadata?.isbn),
                        translator: pickFirstText(liveMetadata?.translator, storedMetadata?.translator),
                        description: pickFirstText(liveMetadata?.description, storedMetadata?.description),
                        publishDate: pickFirstText(liveMetadata?.publishDate, storedMetadata?.publishDate),
                        subjects: mergeSubjects(liveMetadata?.subjects, storedMetadata?.subjects),
                        series: pickFirstText(liveMetadata?.series, storedMetadata?.series),
                        rights: pickFirstText(liveMetadata?.rights, storedMetadata?.rights),
                        price: pickFirstText(liveMetadata?.price, storedMetadata?.price),
                        coverImage: pickFirstText(coverImage, liveMetadata?.coverImage, storedMetadata?.coverImage),
                        wordCount: liveMetadata?.wordCount ?? storedMetadata?.wordCount,
                        chapterCount: liveMetadata?.chapterCount ?? storedMetadata?.chapterCount ?? 0,
                };
        }

        function scheduleCoverPersist(filePath: string, coverUrl: string | null) {
                coverPersistPending.set(filePath, coverUrl);
                if (coverPersistTimer) {
                        window.clearTimeout(coverPersistTimer);
                }
                coverPersistTimer = window.setTimeout(() => {
                        coverPersistTimer = null;
                        const pending = Array.from(coverPersistPending.entries());
                        coverPersistPending.clear();
                        for (const [path, cover] of pending) {
                                void storageService.cacheBookshelfCoverImage(path, cover);
                        }
                }, 400);
        }

        function isPersistableCoverUrl(coverUrl: string | null | undefined): coverUrl is string {
                const normalizedCover = typeof coverUrl === 'string' ? coverUrl.trim() : '';
                return Boolean(
                        normalizedCover
                        && !normalizedCover.startsWith('blob:')
                );
        }

        function cacheResolvedCover(filePath: string, coverUrl: string | null | undefined) {
                const normalizedCover = isPersistableCoverUrl(coverUrl) ? coverUrl.trim() : null;
                coverCache.set(filePath, normalizedCover);

                if (normalizedCover) {
                        if (covers.get(filePath) !== normalizedCover) {
                                covers.set(filePath, normalizedCover);
                                covers = new Map(covers);
                        }
                        scheduleCoverPersist(filePath, normalizedCover);
                        return;
                }

                if (covers.delete(filePath)) {
                        covers = new Map(covers);
                }
        }

        function remapVaultPath(filePath: string, oldPath: string, newPath: string): string | null {
                const normalizedFilePath = normalizePath(filePath || '');
                const normalizedOldPath = normalizePath(oldPath || '');
                const normalizedNewPath = normalizePath(newPath || '');

                if (!normalizedFilePath || !normalizedOldPath || !normalizedNewPath) {
                        return null;
                }

                if (normalizedFilePath === normalizedOldPath) {
                        return normalizedNewPath;
                }

                if (normalizedFilePath.startsWith(`${normalizedOldPath}/`)) {
                        return `${normalizedNewPath}${normalizedFilePath.slice(normalizedOldPath.length)}`;
                }

                return null;
        }

        function remapMapKeys<T>(source: Map<string, T>, oldPath: string, newPath: string): Map<string, T> {
                const next = new Map<string, T>();

                for (const [path, value] of source.entries()) {
                        const remapped = remapVaultPath(path, oldPath, newPath) || path;
                        next.set(remapped, value);
                }

                return next;
        }

        function handleVaultRename(file: TAbstractFile, oldPath: string) {
                const newPath = normalizePath(file.path || '');
                const normalizedOldPath = normalizePath(oldPath || '');
                if (!normalizedOldPath || !newPath || normalizedOldPath === newPath) {
                        return;
                }

                const nextFiles = epubFiles
                        .map((entry) => {
                                const remappedPath = remapVaultPath(entry.path, normalizedOldPath, newPath);
                                if (!remappedPath) {
                                        return entry;
                                }

                                const newName = stripSupportedBookExtension(remappedPath.split('/').pop() || '') || entry.name;
                                const slashIndex = remappedPath.lastIndexOf('/');
                                const remappedCustomCoverPath = entry.customCoverPath
                                        ? remapVaultPath(entry.customCoverPath, normalizedOldPath, newPath) || entry.customCoverPath
                                        : undefined;

                                return {
                                        ...entry,
                                        path: remappedPath,
                                        name: newName,
                                        folder: slashIndex >= 0 ? remappedPath.slice(0, slashIndex) || '/' : '/',
                                        size: file instanceof TFile && remappedPath === newPath ? file.stat.size : entry.size,
                                        customCoverPath: remappedCustomCoverPath,
                                };
                        })
                        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

                const changed = nextFiles.length !== epubFiles.length
                        || nextFiles.some((entry, index) =>
                                entry.path !== epubFiles[index]?.path
                                || entry.name !== epubFiles[index]?.name
                                || entry.folder !== epubFiles[index]?.folder
                                || entry.size !== epubFiles[index]?.size
                        );

                if (!changed) {
                        void storageService.remapBookshelfMembershipPaths(normalizedOldPath, newPath);
                        const { playlists: remappedPlaylists, changed: playlistsChanged } = remapBookshelfPlaylists(
                                bookshelfPlaylists,
                                normalizedOldPath,
                                newPath
                        );
                        if (playlistsChanged) {
                                bookshelfPlaylists = remappedPlaylists;
                        }
                        return;
                }

                epubFiles = nextFiles;
                void storageService.remapBookshelfMembershipPaths(normalizedOldPath, newPath);
                const { playlists: remappedPlaylists, changed: playlistsChanged } = remapBookshelfPlaylists(
                        bookshelfPlaylists,
                        normalizedOldPath,
                        newPath
                );
                if (playlistsChanged) {
                        bookshelfPlaylists = remappedPlaylists;
                }
                covers = remapMapKeys(covers, normalizedOldPath, newPath);
                bookMetaByPath = remapMapKeys(bookMetaByPath, normalizedOldPath, newPath);

                const remappedCoverCache = new Map<string, string | null>();
                for (const [path, url] of coverCache.entries()) {
                        const remapped = remapVaultPath(path, normalizedOldPath, newPath) || path;
                        remappedCoverCache.set(remapped, url);
                }
                coverCache.clear();
                for (const [path, url] of remappedCoverCache.entries()) {
                        coverCache.set(path, url);
                }
        }

        async function loadBookMetadata(files: EpubFileInfo[], runId: number, allowRetry = true): Promise<void> {
                try {
                        const [books, scanEntries] = await Promise.all([
                                // Bookshelf progress/reading status depends on hydrated readingState.
                                storageService.loadBooks({ hydrateStates: true }),
                                storageService.loadScanIndex(),
                        ]);
                        if (runId !== refreshRunId) return;

                        const validPaths = new Set(files.map((file) => file.path));
                        const nextMeta = new Map<string, BookshelfBookMeta>();
                        const scanCoverByPath = new Map(
                                scanEntries.map((entry) => [entry.path, entry.coverImage] as const)
                        );

                        for (const file of files) {
                                const cachedScanCover = scanCoverByPath.get(file.path);
                                if (cachedScanCover) {
                                        cacheResolvedCover(file.path, cachedScanCover);
                                }
                        }

                        for (const book of Object.values(books)) {
                                if (!validPaths.has(book.filePath)) continue;
                                const meta = buildBookMeta(book);
                                nextMeta.set(book.filePath, meta);
                                if (meta.coverImage) {
                                        cacheResolvedCover(book.filePath, meta.coverImage);
                                }
                        }

                        for (const file of files) {
                                if (!file.customCoverPath) continue;
                                cacheResolvedCover(
                                        file.path,
                                        resolveVaultImageResourceUrl(app, file.customCoverPath)
                                );
                        }

                        bookMetaByPath = nextMeta;
                } catch {
                        if (runId === refreshRunId) {
                                bookMetaByPath = new Map();
                                if (allowRetry) {
                                        if (metadataRetryTimer) {
                                                window.clearTimeout(metadataRetryTimer);
                                        }
                                        metadataRetryTimer = window.setTimeout(() => {
                                                metadataRetryTimer = null;
                                                void loadBookMetadata(files, runId, false);
                                        }, 180);
                                }
                        }
                }
        }

        async function refreshBookshelfMetadataForPaths(bookPaths: string[]): Promise<void> {
                const normalizedPaths = new Set(
                        bookPaths.map((path) => normalizePath(path || '')).filter(Boolean)
                );
                if (normalizedPaths.size === 0) {
                        void loadBookshelfFromCache();
                        return;
                }

                const targetFiles = epubFiles.filter((file) => normalizedPaths.has(file.path));
                if (targetFiles.length === 0) {
                        void loadBookshelfFromCache();
                        return;
                }

                const currentRunId = refreshRunId;
                try {
                        const books = await storageService.loadBooks({ hydrateStates: true });
                        if (currentRunId !== refreshRunId) {
                                return;
                        }

                        const nextMeta = new Map(bookMetaByPath);
                        for (const file of targetFiles) {
                                const book = Object.values(books).find((entry) => entry.filePath === file.path);
                                if (!book) {
                                        continue;
                                }
                                const meta = buildBookMeta(book);
                                nextMeta.set(file.path, meta);
                                if (meta.coverImage) {
                                        cacheResolvedCover(file.path, meta.coverImage);
                                }
                        }
                        bookMetaByPath = nextMeta;
                } catch (error) {
                        logger.error('Failed to refresh EPUB bookshelf metadata for paths:', error);
                }
        }

        function syncCoverCacheWithFiles() {
                const validPaths = new Set(epubFiles.map((file) => file.path));
                const nextCovers = new Map<string, string>();

                for (const [path, url] of covers.entries()) {
                        if (validPaths.has(path)) {
                                nextCovers.set(path, url);
                        }
                }

                covers = nextCovers;

                for (const path of Array.from(coverCache.keys())) {
                        if (!validPaths.has(path)) {
                                coverCache.delete(path);
                        }
                }
        }

        function cancelScheduledCoverLoading() {
                if (coverLoadTimer) {
                        window.clearTimeout(coverLoadTimer);
                        coverLoadTimer = null;
                }
        }

        async function loadCoverForFile(file: EpubFileInfo, runId: number): Promise<void> {
                if (runId !== refreshRunId) return;
                if (file.customCoverPath) {
                        cacheResolvedCover(
                                file.path,
                                resolveVaultImageResourceUrl(app, file.customCoverPath)
                        );
                        return;
                }
                if (coverCache.has(file.path)) {
                        const cachedCover = coverCache.get(file.path);
                        if (cachedCover && !covers.has(file.path)) {
                                covers.set(file.path, cachedCover);
                                covers = new Map(covers);
                        }
                        return;
                }

                const publicationParser = new FoliateVaultPublicationParser(app);
                try {
                        const loaded = await publicationParser.load(file.path);
                        const coverUrl = loaded.coverImage || null;
                        if (runId !== refreshRunId) return;
                        mergeParsedBookshelfMetadata(file.path, loaded.metadata);
                        cacheResolvedCover(file.path, coverUrl);
                } catch {
                        if (runId === refreshRunId) {
                                cacheResolvedCover(file.path, null);
                        }
                } finally {
                        publicationParser.dispose();
                }
        }

        function updateListViewportHeight(): void {
                if (!listViewportEl) {
                        return;
                }
                listViewportHeight = Math.max(240, Math.floor(listViewportEl.clientHeight));
        }

        function handleVirtualItemsRendered(startIndex: number, endIndex: number): void {
                const visible = filteredFiles.slice(startIndex, Math.min(endIndex + 1, filteredFiles.length));
                scheduleVisibleCoverLoading(visible, refreshRunId);
        }

        function scheduleVisibleCoverLoading(files: EpubFileInfo[], runId: number) {
                cancelScheduledCoverLoading();
                const queue = files.slice();
                let index = 0;

                const step = () => {
                        if (runId !== refreshRunId || index >= queue.length) {
                                coverLoadTimer = null;
                                return;
                        }

                        const file = queue[index++];
                        void loadCoverForFile(file, runId).finally(() => {
                                if (runId !== refreshRunId) {
                                        coverLoadTimer = null;
                                        return;
                                }
                                coverLoadTimer = window.setTimeout(step, 0);
                        });
                };

                coverLoadTimer = window.setTimeout(step, 16);
        }

        function mergeParsedBookshelfMetadata(
                filePath: string,
                metadata: Partial<BookMetadata> | null | undefined
        ): void {
                const existing = bookMetaByPath.get(filePath);
                if (!existing || !metadata) {
                        return;
                }

                const next: BookshelfBookMeta = { ...existing };
                let changed = false;

                if (
                        typeof metadata.wordCount === 'number'
                        && metadata.wordCount > 0
                        && metadata.wordCount !== existing.wordCount
                ) {
                        next.wordCount = metadata.wordCount;
                        changed = true;
                }

                const publisher = metadata.publisher?.trim();
                if (publisher && publisher !== existing.publisher) {
                        next.publisher = publisher;
                        changed = true;
                }

                const translator = metadata.translator?.trim();
                if (translator && translator !== existing.translator) {
                        next.translator = translator;
                        changed = true;
                }

                if (
                        typeof metadata.chapterCount === 'number'
                        && metadata.chapterCount > 0
                        && metadata.chapterCount !== existing.chapterCount
                ) {
                        next.chapterCount = metadata.chapterCount;
                        changed = true;
                }

                if (!changed) {
                        return;
                }

                const nextMeta = new Map(bookMetaByPath);
                nextMeta.set(filePath, next);
                bookMetaByPath = nextMeta;
        }

        function formatCompactWordCountValue(value: number): string {
                return value >= 100
                        ? String(Math.round(value))
                        : value.toFixed(1).replace(/\.0$/, '');
        }

        function formatBookshelfChapterCount(chapterCount: number | undefined): string {
                if (!Number.isFinite(chapterCount) || !chapterCount || chapterCount <= 0) {
                        return '';
                }

                return t('epub.bookshelf.chapterCount', {
                        count: new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(chapterCount),
                });
        }

        function formatBookshelfWordCount(wordCount: number | undefined): string {
                if (!Number.isFinite(wordCount) || !wordCount || wordCount <= 0) {
                        return '';
                }

                const isChinese = get(currentLanguage) === 'zh-CN' || get(currentLanguage) === 'zh-TW';

                if (isChinese) {
                        if (wordCount >= 10000) {
                                return t('epub.bookshelf.wordCountWan', {
                                        value: formatCompactWordCountValue(wordCount / 10000),
                                });
                        }
                        if (wordCount >= 1000) {
                                return t('epub.bookshelf.wordCountKilo', {
                                        value: formatCompactWordCountValue(wordCount / 1000),
                                });
                        }
                        return t('epub.bookshelf.wordCountChars', {
                                value: new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(wordCount),
                        });
                }

                if (wordCount >= 1000) {
                        return t('epub.bookshelf.wordCountKilo', {
                                value: formatCompactWordCountValue(wordCount / 1000),
                        });
                }

                return t('epub.bookshelf.wordCountChars', {
                        value: new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(wordCount),
                });
        }

        function handleBookKeydown(event: KeyboardEvent, path: string) {
                if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        switchBook(path);
                }
        }

        function handlePlaylistKeydown(event: KeyboardEvent, playlistId: string) {
                if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openPlaylistDetail(playlistId);
                }
        }

        function handleToolbarBack() {
                if (activePlaylistId) {
                        activePlaylistId = null;
                        return;
                }
                void onBack?.();
        }

        function formatPlaylistUpdatedLabel(updatedAt: number): string {
                if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
                        return t('epub.bookshelf.playlist.updatedUnknown');
                }
                const formatted = formatBookshelfLastReadTime(updatedAt);
                return formatted
                        ? t('epub.bookshelf.playlist.updated', { time: formatted })
                        : t('epub.bookshelf.playlist.updatedUnknown');
        }

        function buildPlaylistMetaLine(playlist: EpubBookshelfPlaylist): string {
                const validPaths = new Set(epubFiles.map((file) => file.path));
                const resolvedCount = playlist.bookPaths.filter((path) => validPaths.has(path)).length;
                return t('epub.bookshelf.playlist.rowMeta', {
                        count: resolvedCount,
                        updated: formatPlaylistUpdatedLabel(playlist.updatedAt),
                });
        }

        function getPlaylistCoverUrls(playlist: EpubBookshelfPlaylist): Array<string | null> {
                return playlist.bookPaths.slice(0, 4).map((path) => covers.get(path) ?? null);
        }

        async function loadBookshelfPlaylistsFromStorage(): Promise<void> {
                try {
                        bookshelfPlaylists = await storageService.loadBookshelfPlaylists();
                } catch (error) {
                        logger.error('Failed to load bookshelf playlists:', error);
                        bookshelfPlaylists = [];
                }
        }

        function openPlaylistDetail(playlistId: string) {
                activePlaylistId = playlistId;
        }

        async function createBookshelfPlaylist(initialBookPath?: string) {
                const { EpubBookRenameModal } = await import('../modals/EpubBookRenameModal');
                const modal = new EpubBookRenameModal(app, {
                        title: t('epub.bookshelf.playlist.createTitle'),
                        label: t('epub.bookshelf.playlist.renameLabel'),
                        placeholder: t('epub.bookshelf.playlist.renamePlaceholder'),
                        confirmLabel: t('epub.bookshelf.playlist.createConfirm'),
                        cancelLabel: t('epub.bookshelf.playlist.createCancel'),
                        initialTitle: t('epub.bookshelf.playlist.defaultName'),
                });
                const name = await modal.openAndWait();
                if (!name?.trim()) {
                        return;
                }
                try {
                        const playlist = await storageService.createBookshelfPlaylist(
                                name.trim(),
                                initialBookPath ? [initialBookPath] : []
                        );
                        bookshelfPlaylists = await storageService.loadBookshelfPlaylists();
                        activePlaylistId = playlist.id;
                } catch (error) {
                        logger.error('Failed to create bookshelf playlist:', error);
                        new Notice(t('epub.bookshelf.playlist.createFailed'));
                }
        }

        async function addBookToPlaylist(playlistId: string, bookPath: string) {
                try {
                        await storageService.addBookToBookshelfPlaylist(playlistId, bookPath);
                        bookshelfPlaylists = await storageService.loadBookshelfPlaylists();
                        new Notice(t('epub.bookshelf.playlist.addedToPlaylist'));
                } catch (error) {
                        logger.error('Failed to add book to playlist:', error);
                        new Notice(t('epub.bookshelf.playlist.addFailed'));
                }
        }

        async function removeBookFromActivePlaylist(bookPath: string) {
                if (!activePlaylistId) {
                        return;
                }
                try {
                        await storageService.removeBookFromBookshelfPlaylist(activePlaylistId, bookPath);
                        bookshelfPlaylists = await storageService.loadBookshelfPlaylists();
                        new Notice(t('epub.bookshelf.playlist.removedFromPlaylist'));
                } catch (error) {
                        logger.error('Failed to remove book from playlist:', error);
                        new Notice(t('epub.bookshelf.playlist.removeFailed'));
                }
        }

        async function renameBookshelfPlaylistById(playlistId: string) {
                const playlist = bookshelfPlaylists.find((entry) => entry.id === playlistId);
                if (!playlist) {
                        return;
                }
                const { EpubBookRenameModal } = await import('../modals/EpubBookRenameModal');
                const modal = new EpubBookRenameModal(app, {
                        title: t('epub.bookshelf.playlist.rename'),
                        label: t('epub.bookshelf.playlist.renameLabel'),
                        placeholder: t('epub.bookshelf.playlist.renamePlaceholder'),
                        confirmLabel: t('epub.bookshelf.playlist.createConfirm'),
                        cancelLabel: t('epub.bookshelf.playlist.createCancel'),
                        initialTitle: playlist.name,
                });
                const name = await modal.openAndWait();
                if (!name?.trim() || name.trim() === playlist.name) {
                        return;
                }
                try {
                        await storageService.renameBookshelfPlaylist(playlistId, name.trim());
                        bookshelfPlaylists = await storageService.loadBookshelfPlaylists();
                } catch (error) {
                        logger.error('Failed to rename bookshelf playlist:', error);
                        new Notice(t('epub.bookshelf.playlist.renameFailed'));
                }
        }

        async function deleteBookshelfPlaylistById(playlistId: string) {
                try {
                        await storageService.deleteBookshelfPlaylist(playlistId);
                        bookshelfPlaylists = await storageService.loadBookshelfPlaylists();
                        if (activePlaylistId === playlistId) {
                                activePlaylistId = null;
                        }
                } catch (error) {
                        logger.error('Failed to delete bookshelf playlist:', error);
                        new Notice(t('epub.bookshelf.playlist.deleteFailed'));
                }
        }

        function handlePlaylistContextMenu(event: MouseEvent, playlistId: string) {
                event.preventDefault();
                const menu = new Menu();
                menu.addItem((item) => {
                        item.setTitle(t('epub.bookshelf.playlist.rename'))
                                .setIcon('pencil')
                                .onClick(() => {
                                        void renameBookshelfPlaylistById(playlistId);
                                });
                });
                menu.addSeparator();
                menu.addItem((item) => {
                        item.setTitle(t('epub.bookshelf.playlist.delete'))
                                .setIcon('trash')
                                .onClick(() => {
                                        void deleteBookshelfPlaylistById(playlistId);
                                });
                });
                menu.showAtMouseEvent(event);
        }

        function openAddToPlaylistMenu(event: MouseEvent, bookPath: string) {
                const playlists = bookshelfPlaylists;
                if (playlists.length === 0) {
                        void createBookshelfPlaylist(bookPath);
                        return;
                }
                const menu = new Menu();
                for (const playlist of playlists) {
                        const alreadyIncluded = playlist.bookPaths.includes(bookPath);
                        menu.addItem((item) => {
                                item.setTitle(playlist.name)
                                        .setIcon('library')
                                        .setDisabled(alreadyIncluded)
                                        .onClick(() => {
                                                void addBookToPlaylist(playlist.id, bookPath);
                                        });
                        });
                }
                menu.addSeparator();
                menu.addItem((item) => {
                        item.setTitle(t('epub.bookshelf.playlist.createNew'))
                                .setIcon('plus')
                                .onClick(() => {
                                        void createBookshelfPlaylist(bookPath);
                                });
                });
                menu.showAtMouseEvent(event);
        }

        function flushPendingBookshelfWork() {
                if (loadingBooks) return;

                if (pendingBookshelfRefresh) {
                        const showNotice = pendingBookshelfRefreshNotice;
                        pendingBookshelfRefresh = false;
                        pendingBookshelfRefreshNotice = false;
                        pendingBookshelfReload = false;
                        void refreshBookshelf(showNotice);
                        return;
                }

                if (pendingBookshelfReload) {
                        pendingBookshelfReload = false;
                        void loadBookshelfFromCache();
                }
        }

        async function loadBookshelfMetadataAndCovers(files: EpubFileInfo[], runId: number): Promise<void> {
                await loadBookMetadata(files, runId);
                if (runId !== refreshRunId) {
                        return;
                }
                scheduleVisibleCoverLoading(files, runId);
        }

        async function loadBookshelfFromCache() {
                if (loadingBooks) {
                        pendingBookshelfReload = true;
                        return;
                }
                loadingBooks = true;
                try {
                        const currentRunId = ++refreshRunId;
                        const cached = await storageService.listBookshelfEntries();
                        setBookshelfFiles(cached);
                        syncCoverCacheWithFiles();
                        void loadBookshelfMetadataAndCovers(cached, currentRunId);
                        void loadBookshelfPlaylistsFromStorage();
                } catch (error) {
                        logger.error('Failed to load EPUB bookshelf cache:', error);
                } finally {
                        loadingBooks = false;
                        flushPendingBookshelfWork();
                }
        }

        async function refreshBookshelf(showNotice = false) {
                if (loadingBooks) {
                        pendingBookshelfRefresh = true;
                        pendingBookshelfRefreshNotice = pendingBookshelfRefreshNotice || showNotice;
                        return;
                }
                loadingBooks = true;

                try {
                        const result = await storageService.pruneMissingBooks();
                        const currentRunId = ++refreshRunId;
                        cancelScheduledCoverLoading();
                        const rebuilt = await storageService.listBookshelfEntries({ pruneMissing: false });
                        setBookshelfFiles(rebuilt);
                        syncCoverCacheWithFiles();
                        await loadBookMetadata(rebuilt, currentRunId);
                        scheduleVisibleCoverLoading(rebuilt, currentRunId);

                        if (showNotice) {
                                const message = result.removedPaths.length > 0
                                        ? t('epub.bookshelf.refreshSuccessWithCleanup', { count: result.removedPaths.length })
                                        : t('epub.bookshelf.refreshSuccess');
                                new Notice(message);
                        }
                } catch (error) {
                        logger.error('Failed to refresh EPUB bookshelf:', error);
                        if (showNotice) {
                                new Notice(t('epub.bookshelf.refreshFailed'));
                        }
                } finally {
                        loadingBooks = false;
                        await loadBookshelfPlaylistsFromStorage();
                        dispatchBookshelfDataChanged();
                        flushPendingBookshelfWork();
                }
        }

        function removeInvalidFile(filePath: string) {
                epubFiles = epubFiles.filter((file) => file.path !== filePath);
                covers.delete(filePath);
                covers = new Map(covers);
                coverCache.delete(filePath);
                bookMetaByPath.delete(filePath);
                bookMetaByPath = new Map(bookMetaByPath);
        }

        async function removeMissingBookshelfEntry(filePath: string) {
                const normalizedPath = normalizePath(filePath || '');
                if (!normalizedPath) {
                        return;
                }

                removeInvalidFile(normalizedPath);
                try {
                        await storageService.removeMissingBookshelfEntry(normalizedPath);
                        dispatchBookshelfDataChanged();
                } catch (error) {
                        logger.error('Failed to remove missing bookshelf entry:', error);
                }
        }

        function resetBookStateInList(filePath: string) {
                bookMetaByPath.delete(filePath);
                bookMetaByPath = new Map(bookMetaByPath);
        }

        function getBookDisplayName(filePath: string): string {
                const file = app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                        return file.basename || t('epub.bookshelf.currentBook');
                }
                return stripSupportedBookExtension(filePath.split('/').pop() || '') || t('epub.bookshelf.currentBook');
        }

        async function resolveActiveBookPath(filePath: string): Promise<string | null> {
                const normalizedPath = normalizePath(filePath || '');
                if (!normalizedPath) {
                        return null;
                }

                const canonicalPath = storageService.resolveSupportedBookFilePath(normalizedPath);
                if (canonicalPath) {
                        if (canonicalPath !== normalizedPath) {
                                await storageService.updateBookFileReferences(normalizedPath, canonicalPath);
                                removeInvalidFile(normalizedPath);
                                await refreshBookshelf();
                        }
                        return canonicalPath;
                }

                const existingBook = await storageService.findBookByFilePath(normalizedPath);
                const resolvedPath = await storageService.resolveSourceFilePath(existingBook?.sourceId, normalizedPath);
                if (!resolvedPath) {
                        return null;
                }

                const registryCanonicalPath = storageService.resolveSupportedBookFilePath(resolvedPath) || resolvedPath;
                if (registryCanonicalPath !== normalizedPath) {
                        await storageService.updateBookFileReferences(normalizedPath, registryCanonicalPath);
                        await refreshBookshelf();
                }

                return registryCanonicalPath;
        }

        function closeOpenEpubLeaves(filePath: string) {
                const leaves = app.workspace.getLeavesOfType(EPUB_RUNTIME.viewTypes.reader);
                for (const leaf of leaves) {
                        const state = leaf.getViewState();
                        const leafFilePath = state?.state?.filePath || state?.state?.file || '';
                        if (leafFilePath === filePath) {
                                leaf.detach();
                        }
                }
        }

        async function switchBook(filePath: string) {
                if (openingBookPath) return;
                openingBookPath = filePath;
                refreshRunId++;
                cancelScheduledCoverLoading();
                const resolvedPath = await resolveActiveBookPath(filePath);
                if (!resolvedPath) {
                        if (await storageService.isBookshelfSourceMissing(filePath)) {
                                await removeMissingBookshelfEntry(filePath);
                                new Notice(t('epub.bookshelf.notFoundRemoved'));
                        }
                        openingBookPath = null;
                        return;
                }

                const file = app.vault.getAbstractFileByPath(resolvedPath);
                if (!(file instanceof TFile) || !isSupportedBookFile(file)) {
                        if (await storageService.isBookshelfSourceMissing(filePath)) {
                                await removeMissingBookshelfEntry(filePath);
                                new Notice(t('epub.bookshelf.notFoundRemoved'));
                        }
                        openingBookPath = null;
                        return;
                }

                if (onSwitchBook) {
                        const nextFilePath = file.path;
                        await Promise.resolve(onClose?.());
                        window.setTimeout(() => {
                                void Promise.resolve(onSwitchBook(nextFilePath)).finally(() => {
                                        openingBookPath = null;
                                });
                        }, 0);
                        return;
                }

                await Promise.resolve(onClose?.());
                window.setTimeout(() => {
                        void openBookInNewTab(file.path).finally(() => {
                                openingBookPath = null;
                        });
                }, 0);
        }

        async function openBookInNewTab(filePath: string) {
                try {
                        const plugin = getEpubHost();
                        if (plugin && typeof plugin.openEpubReader === 'function') {
                                await plugin.openEpubReader(filePath);
                                return;
                        }

                        await getNavigationHub(app).navigate({
                                kind: 'book',
                                resourcePath: filePath,
                                policy: { preferredLeaf: true, focus: true },
                        });
                } catch (error) {
                        logger.error('Failed to open EPUB:', error);
                }
        }

        async function removeBookFromShelf(filePath: string) {
                try {
                        const result = await storageService.removeFromBookshelfByFilePath(filePath, { purgeCache: true });
                        await refreshBookshelf();

                        if (result.removedBookId || result.removedMembership) {
                                new Notice(t('epub.bookshelf.removeSuccess'));
                                return;
                        }

                        new Notice(t('epub.bookshelf.removeMissing'));
                } catch (error) {
                        logger.error('Failed to remove book from bookshelf:', error);
                        new Notice(t('epub.bookshelf.removeFailed'));
                }
        }

        async function resolveBookContext(filePath: string): Promise<ResolvedBookContext | null> {
                const normalizedOriginalPath = normalizePath(filePath || '');
                if (!normalizedOriginalPath) {
                        return null;
                }

                const resolvedPath = await resolveActiveBookPath(filePath);
                const targetPath = normalizePath(resolvedPath || normalizedOriginalPath);
                const file = app.vault.getAbstractFileByPath(targetPath);

                if (!(file instanceof TFile) || !isSupportedBookFile(file)) {
                        if (await storageService.isBookshelfSourceMissing(filePath)) {
                                await removeMissingBookshelfEntry(filePath);
                                new Notice(t('epub.bookshelf.notFoundRemoved'));
                        }
                        return null;
                }

                const storedBook = await storageService.findBookByFilePath(targetPath)
                        || (targetPath !== normalizedOriginalPath
                                ? await storageService.findBookByFilePath(normalizedOriginalPath)
                                : null);
                const parser = new FoliateVaultPublicationParser(app);

                try {
                        const loaded = await parser.load(targetPath);
                        return {
                                requestedPath: normalizedOriginalPath,
                                targetPath,
                                file,
                                storedBook,
                                metadata: mergeBookMetadata(storedBook?.metadata, loaded.metadata, loaded.coverImage),
                        };
                } finally {
                        parser.dispose();
                }
        }

        async function collectBookNoteStats(filePath: string): Promise<BookNoteStats> {
                        const backlinkService = getEpubBacklinkHighlightService(app);
                try {
                        const highlights = await backlinkService.collectHighlights(filePath);
                        const sourceFiles = new Set<string>();
                        let commentCount = 0;

                        for (const highlight of highlights) {
                                if (highlight.hasCommentDivider) {
                                        commentCount += 1;
                                }
                                const primarySourceFile = normalizePath(highlight.sourceFile || '');
                                if (primarySourceFile) {
                                        sourceFiles.add(primarySourceFile);
                                }
                                for (const locator of highlight.sourceLocators || []) {
                                        const locatorPath = normalizePath(locator.sourceFile || '');
                                        if (locatorPath) {
                                                sourceFiles.add(locatorPath);
                                        }
                                }
                        }

                        return {
                                totalHighlights: highlights.length,
                                commentCount,
                                sourceFileCount: sourceFiles.size,
                                available: true,
                        };
                } catch (error) {
                        logger.error('Failed to collect book note stats:', error);
                        return {
                                totalHighlights: 0,
                                commentCount: 0,
                                sourceFileCount: 0,
                                available: false,
                        };
                } finally {
                        backlinkService.destroy();
                }
        }

        async function deleteBookFile(filePath: string) {
                try {
                        const context = await resolveBookContext(filePath);
                        if (!context) {
                                return;
                        }

                        const highlightStats = await collectBookNoteStats(context.targetPath);
                        const { EpubBookDeleteConfirmModal } = await import('../modals/EpubBookDeleteConfirmModal');
                        const modal = new EpubBookDeleteConfirmModal(app, {
                                filePath: context.targetPath,
                                fileName: context.file.name,
                                fileSize: context.file.stat.size,
                                metadata: context.metadata,
                                progress: context.storedBook
                                        ? resolveDisplayProgress(context.storedBook)
                                        : 0,
                                highlightStats,
                        });
                        const confirmed = await modal.openAndWait();
                        if (!confirmed) {
                                return;
                        }

                        closeOpenEpubLeaves(context.targetPath);
                        if (context.requestedPath !== context.targetPath) {
                                closeOpenEpubLeaves(context.requestedPath);
                        }

                        const result = await storageService.deleteTrackedBookFile(context.targetPath);
                        await refreshBookshelf();

                        if (result.fileDeleted) {
                                const retainedExcerptText = highlightStats.available
                                        ? t('epub.bookshelf.excerptsRetained', { count: highlightStats.totalHighlights })
                                        : t('epub.bookshelf.excerptsUntouched');
                                new Notice(t('epub.bookshelf.deleteSuccess', { extra: retainedExcerptText }));
                                return;
                        }

                        if (result.removedBookIds.length > 0 || result.removedMembershipEntries > 0 || result.removedScanEntries > 0) {
                                new Notice(t('epub.bookshelf.deleteMissingAndCleaned'));
                                return;
                        }

                        new Notice(t('epub.bookshelf.deleteMissing'));
                } catch (error) {
                        logger.error('Failed to delete tracked book file:', error);
                        new Notice(t('epub.bookshelf.deleteFailed'));
                }
        }

        async function showBookInfo(filePath: string) {
                try {
                        const context = await resolveBookContext(filePath);
                        if (!context) {
                                return;
                        }

                        const noteStats = await collectBookNoteStats(context.targetPath);
                        const { EpubBookInfoModal } = await import('../modals/EpubBookInfoModal');
                        const modal = new EpubBookInfoModal(app, {
                                filePath: context.targetPath,
                                fileName: context.file.name,
                                fileSize: context.file.stat.size,
                                metadata: context.metadata,
                                progress: context.storedBook
                                        ? resolveDisplayProgress(context.storedBook)
                                        : 0,
                                readingStats: context.storedBook?.readingStats ?? null,
                                noteStats,
                        });
                        modal.open();
                } catch (error) {
                        logger.error('Failed to show EPUB book info:', error);
                        new Notice(t('epub.bookshelf.loadInfoFailed'));
                }
        }

        async function customizeBookCover(filePath: string) {
                try {
                        const resolvedPath = await resolveActiveBookPath(filePath);
                        if (!resolvedPath) {
                                return;
                        }

                        const { VaultFileSuggestModal } = await import('../../modals/VaultFileSuggestModal');
                        const modal = new VaultFileSuggestModal(app, {
                                placeholder: t('epub.bookshelf.customCover.placeholder'),
                                filter: isVaultImageFile,
                                allowEmptySelection: true,
                                emptySelectionLabel: t('epub.bookshelf.customCover.reset'),
                                emptySelectionDescription: t('epub.bookshelf.customCover.resetDescription'),
                                icon: 'image',
                        });
                        const selection = await modal.openAndGetSelection();
                        if (selection.status === 'cancelled') {
                                return;
                        }

                        const coverPath = selection.status === 'selected' ? selection.file.path : null;
                        const saved = await storageService.setBookshelfCustomCover(resolvedPath, coverPath);
                        if (!saved) {
                                new Notice(t('epub.bookshelf.customCover.notOnShelf'));
                                return;
                        }

                        epubFiles = epubFiles.map((file) => {
                                if (file.path !== resolvedPath && file.path !== filePath) {
                                        return file;
                                }

                                return {
                                        ...file,
                                        path: resolvedPath,
                                        customCoverPath: coverPath || undefined,
                                };
                        });

                        if (coverPath) {
                                cacheResolvedCover(resolvedPath, resolveVaultImageResourceUrl(app, coverPath));
                        } else {
                                coverCache.delete(resolvedPath);
                                const targetFile = epubFiles.find((file) => file.path === resolvedPath);
                                if (targetFile) {
                                        void loadCoverForFile(targetFile, refreshRunId);
                                }
                        }

                        new Notice(
                                coverPath
                                        ? t('epub.bookshelf.customCover.success')
                                        : t('epub.bookshelf.customCover.resetSuccess')
                        );
                } catch (error) {
                        logger.error('Failed to customize bookshelf cover:', error);
                        new Notice(t('epub.bookshelf.customCover.failed'));
                }
        }

        async function markBookCompletedFromShelf(filePath: string) {
                try {
                        const context = await resolveBookContext(filePath);
                        if (!context?.storedBook?.id) {
                                return;
                        }
                        await storageService.markBookCompleted(context.storedBook.id);
                        await refreshBookshelf();
                        const title = context.metadata.title?.trim() || context.file.name;
                        new Notice(t('epub.reader.bookCompletionMarked', { title }));
                } catch (error) {
                        logger.error('Failed to mark book as completed:', error);
                }
        }

        function buildBookForRename(
                context: ResolvedBookContext,
                nextTitle: string
        ): EpubBook {
                if (context.storedBook) {
                        return {
                                ...context.storedBook,
                                metadata: {
                                        ...context.storedBook.metadata,
                                        title: nextTitle,
                                },
                        };
                }

                return {
                        id: '',
                        filePath: context.targetPath,
                        metadata: {
                                ...context.metadata,
                                title: nextTitle,
                                author: context.metadata.author || t('epub.bookshelf.unknownAuthor'),
                                chapterCount: context.metadata.chapterCount ?? 0,
                        },
                        currentPosition: { chapterIndex: 0, cfi: '', percent: 0 },
                        readingStats: {
                                totalReadTime: 0,
                                lastReadTime: 0,
                                createdTime: Date.now(),
                        },
                };
        }

        function patchBookshelfMetaTitle(filePath: string, nextTitle: string): void {
                const existing = bookMetaByPath.get(filePath);
                if (!existing) {
                        return;
                }
                const nextMeta = new Map(bookMetaByPath);
                nextMeta.set(filePath, { ...existing, title: nextTitle });
                bookMetaByPath = nextMeta;
        }

        function broadcastRenamedBookTitle(book: EpubBook): void {
                const normalizedPath = normalizePath(book.filePath || '');
                const nextTitle = book.metadata.title?.trim() || '';
                if (!normalizedPath || !nextTitle) {
                        return;
                }

                const shared = epubActiveDocumentStore.getSharedState();
                if (
                        shared.book
                        && normalizePath(shared.filePath || '') === normalizedPath
                ) {
                        epubActiveDocumentStore.setSharedState({
                                book: {
                                        ...shared.book,
                                        metadata: {
                                                ...shared.book.metadata,
                                                title: nextTitle,
                                        },
                                },
                        });
                }

                for (const leaf of app.workspace.getLeavesOfType(EPUB_RUNTIME.viewTypes.reader)) {
                        const view = leaf.view as { updateBookTitle?: (title: string) => void };
                        const leafFilePath = normalizePath(
                                String(leaf.getViewState()?.state?.filePath || leaf.getViewState()?.state?.file || '').trim()
                        );
                        if (typeof view?.updateBookTitle !== 'function' || leafFilePath !== normalizedPath) {
                                continue;
                        }
                        view.updateBookTitle(nextTitle);
                }

                window.dispatchEvent(
                        new CustomEvent(BOOK_DISPLAY_TITLE_CHANGED_EVENT, {
                                detail: { filePath: normalizedPath, title: nextTitle },
                        })
                );
        }

        async function renameBookFromShelf(filePath: string): Promise<void> {
                try {
                        const context = await resolveBookContext(filePath);
                        if (!context) {
                                return;
                        }

                        const currentTitle =
                                context.storedBook?.metadata.title?.trim()
                                || context.metadata.title?.trim()
                                || context.file.basename;
                        const { EpubBookRenameModal } = await import('../modals/EpubBookRenameModal');
                        const modal = new EpubBookRenameModal(app, {
                                title: t('epub.bookshelf.rename.title'),
                                label: t('epub.bookshelf.rename.label'),
                                placeholder: t('epub.bookshelf.rename.placeholder'),
                                hint: t('epub.bookshelf.rename.hint'),
                                confirmLabel: t('epub.bookshelf.rename.confirm'),
                                cancelLabel: t('epub.bookshelf.rename.cancel'),
                                initialTitle: currentTitle,
                        });
                        const nextTitle = await modal.openAndWait();
                        if (!nextTitle || nextTitle === currentTitle) {
                                return;
                        }

                        const book = buildBookForRename(context, nextTitle);
                        const savedBook = await storageService.updateBookDisplayTitle(book);
                        patchBookshelfMetaTitle(filePath, nextTitle);
                        if (context.targetPath !== filePath) {
                                patchBookshelfMetaTitle(context.targetPath, nextTitle);
                        }
                        broadcastRenamedBookTitle(savedBook);
                        dispatchBookshelfDataChanged();
                        new Notice(t('epub.bookshelf.rename.success', { title: nextTitle }));
                } catch (error) {
                        logger.error('Failed to rename book from shelf:', error);
                        new Notice(t('epub.bookshelf.rename.failed'));
                }
        }

        async function clearBookCompletionFromShelf(filePath: string) {
                try {
                        const context = await resolveBookContext(filePath);
                        if (!context?.storedBook?.id) {
                                return;
                        }
                        await storageService.clearBookCompletion(context.storedBook.id);
                        await refreshBookshelf();
                        const title = context.metadata.title?.trim() || context.file.name;
                        new Notice(t('epub.reader.bookCompletionCleared', { title }));
                } catch (error) {
                        logger.error('Failed to clear book completion:', error);
                }
        }

        function handleContextMenu(e: MouseEvent, filePath: string) {
                e.preventDefault();
                const meta = bookMetaByPath.get(filePath);
                const menu = new Menu();
                menu.addItem((item) => {
                        item.setTitle(t('epub.bookshelf.menu.openInNewTab'))
                                .setIcon('external-link')
                                .onClick(() => openBookInNewTab(filePath));
                });
                menu.addItem((item) => {
                        item.setTitle(t('epub.bookshelf.menu.viewFullInfo'))
                                .setIcon('info')
                                .onClick(() => {
                                        void showBookInfo(filePath);
                                });
                });
                menu.addItem((item) => {
                        item.setTitle(t('epub.bookshelf.menu.rename'))
                                .setIcon('pencil')
                                .onClick(() => {
                                        void renameBookFromShelf(filePath);
                                });
                });
                if (meta?.readingStatus === '已读完') {
                        menu.addItem((item) => {
                                item.setTitle(t('epub.bookshelf.menu.clearCompleted'))
                                        .setIcon('rotate-ccw')
                                        .onClick(() => {
                                                void clearBookCompletionFromShelf(filePath);
                                        });
                        });
                } else {
                        menu.addItem((item) => {
                                item.setTitle(t('epub.bookshelf.menu.markCompleted'))
                                        .setIcon('check-circle')
                                        .onClick(() => {
                                                void markBookCompletedFromShelf(filePath);
                                        });
                        });
                }
                menu.addItem((item) => {
                        item.setTitle(t('epub.bookshelf.menu.customCover'))
                                .setIcon('image')
                                .onClick(() => {
                                        void customizeBookCover(filePath);
                                });
                });
                menu.addSeparator();
                if (activePlaylistId) {
                        menu.addItem((item) => {
                                item.setTitle(t('epub.bookshelf.playlist.removeFromPlaylist'))
                                        .setIcon('minus-circle')
                                        .onClick(() => {
                                                void removeBookFromActivePlaylist(filePath);
                                        });
                        });
                        menu.addSeparator();
                }
                menu.addItem((item) => {
                        item.setTitle(t('epub.bookshelf.playlist.addToPlaylist'))
                                .setIcon('library')
                                .onClick(() => {
                                        openAddToPlaylistMenu(e, filePath);
                                });
                });
                menu.addSeparator();
                menu.addItem((item) => {
                        item.setTitle(t('epub.bookshelf.menu.removeFromShelf'))
                                .setIcon('trash')
                                .onClick(() => {
                                        void removeBookFromShelf(filePath);
                                });
                });
                menu.addItem((item) => {
                        item.setTitle(t('epub.bookshelf.menu.deleteBookFile'))
                                .setIcon('trash-2')
                                .onClick(() => {
                                        void deleteBookFile(filePath);
                                });
                });
                menu.showAtMouseEvent(e);
        }

        function buildBylineText(meta?: BookshelfBookMeta): string {
                const values = [
                        meta?.author?.trim() || '',
                        meta?.translator?.trim() ? t('epub.bookshelf.translator', { name: meta.translator.trim() }) : '',
                        meta?.publisher?.trim() || '',
                ].filter(Boolean);
                return values.join(' · ');
        }

        function buildBookStatsLine(file: EpubFileInfo, meta?: BookshelfBookMeta): string {
                return [
                        formatBookshelfWordCount(meta?.wordCount),
                        formatBookshelfChapterCount(meta?.chapterCount),
                        getBookFormatDisplayLabel(file.path),
                ]
                        .filter(Boolean)
                        .join(' · ');
        }

        function buildMetaText(file: EpubFileInfo, meta?: BookshelfBookMeta): string {
                const bylineText = buildBylineText(meta);
                const statsLine = buildBookStatsLine(file, meta);
                return [bylineText, statsLine]
                        .filter(Boolean)
                        .join(' · ');
        }

        let displayBooks = $derived.by(() => {
                return epubFiles
                        .map((file) => {
                                const meta = bookMetaByPath.get(file.path);
                                const bylineText = buildBylineText(meta);
                                const statsLine = buildBookStatsLine(file, meta);
                                const progress = meta?.progress || 0;
                                const lastReadTime = meta?.lastReadTime || 0;
                                const formatLabel = getBookFormatDisplayLabel(file.path);
                                const addedAt = typeof file.addedAt === 'number' && file.addedAt > 0
                                        ? file.addedAt
                                        : (meta?.createdTime || 0);
                                return {
                                        ...file,
                                        displayTitle: meta?.title || file.name || 'EPUB',
                                        bylineText,
                                        statsLine,
                                        metaText: buildMetaText(file, meta),
                                        author: meta?.author?.trim() || '',
                                        translator: meta?.translator?.trim() || undefined,
                                        publisher: meta?.publisher?.trim() || undefined,
                                        wordCount: meta?.wordCount,
                                        formatLabel,
                                        progress,
                                        lastReadTime,
                                        addedAt,
                                        readingStatus: meta?.readingStatus ?? '未开始'
                                } satisfies DisplayBookItem;
                        })
                        .sort((a, b) => {
                                const aRecent = a.lastReadTime > 0 ? 1 : 0;
                                const bRecent = b.lastReadTime > 0 ? 1 : 0;
                                if (aRecent !== bRecent) return bRecent - aRecent;
                                if (a.lastReadTime !== b.lastReadTime) return b.lastReadTime - a.lastReadTime;
                                return a.displayTitle.localeCompare(b.displayTitle, 'zh-CN');
                        });
        });

        let playlistAssignedPaths = $derived.by(() =>
                collectBookshelfPlaylistAssignedPaths(bookshelfPlaylists)
        );

        let shelfLevelBooks = $derived.by(() =>
                displayBooks.filter((book) => !playlistAssignedPaths.has(book.path))
        );

        let continueReadingBookPath = $derived.by(() => {
                const recentBook = shelfLevelBooks.find((book) => book.lastReadTime > 0);
                return recentBook?.path || null;
        });

        function isContinueReadingBook(file: DisplayBookItem): boolean {
                return Boolean(continueReadingBookPath && file.path === continueReadingBookPath);
        }

        let availableAuthorOptions = $derived.by(() =>
                buildUniqueSortedValues(shelfLevelBooks.map((book) => book.author))
        );

        let availablePublisherOptions = $derived.by(() =>
                buildUniqueSortedValues(shelfLevelBooks.map((book) => book.publisher))
        );

        let availableFormatOptions = $derived.by(() =>
                buildUniqueSortedValues(shelfLevelBooks.map((book) => book.formatLabel))
        );

        let localizedBookshelfReadingStatusOptions = $derived.by(() =>
                BOOKSHELF_READING_STATUS_OPTIONS.map((status) => getLocalizedReadingStatus(status))
        );

        let parsedBookshelfSearchQuery = $derived.by(() => parseSearchQuery(searchQuery));

        let filteredFiles = $derived.by(() => {
                const matchedBooks = shelfLevelBooks.filter((book) => matchesBookshelfQuery(book, parsedBookshelfSearchQuery));
                if (!continueReadingBookPath) {
                        return matchedBooks;
                }

                const pinnedIndex = matchedBooks.findIndex((book) => book.path === continueReadingBookPath);
                if (pinnedIndex <= 0) {
                        return matchedBooks;
                }

                return [
                        matchedBooks[pinnedIndex],
                        ...matchedBooks.slice(0, pinnedIndex),
                        ...matchedBooks.slice(pinnedIndex + 1),
                ];
        });

        let filteredPlaylists = $derived.by(() => {
                if (!searchQuery.trim()) {
                        return bookshelfPlaylists;
                }
                const booksByPath = new Map(displayBooks.map((book) => [book.path, book]));
                return bookshelfPlaylists.filter((playlist) => {
                        const bookFields: BookshelfSearchBookFields[] = playlist.bookPaths
                                .map((path) => booksByPath.get(path))
                                .filter((book): book is DisplayBookItem => Boolean(book))
                                .map((book) => ({
                                        displayTitle: book.displayTitle,
                                        metaText: book.metaText,
                                        statsLine: book.statsLine,
                                        name: book.name,
                                        folder: book.folder,
                                        author: book.author,
                                        translator: book.translator,
                                        publisher: book.publisher,
                                        formatLabel: book.formatLabel,
                                        readingStatus: book.readingStatus,
                                        localizedReadingStatus: getLocalizedReadingStatus(book.readingStatus),
                                        path: book.path,
                                        addedAt: book.addedAt,
                                }));
                        return matchesBookshelfPlaylistSearchQuery(
                                playlist.name,
                                bookFields,
                                parsedBookshelfSearchQuery
                        );
                });
        });

        let activePlaylist = $derived.by(() =>
                bookshelfPlaylists.find((playlist) => playlist.id === activePlaylistId) ?? null
        );

        let activePlaylistBooks = $derived.by(() => {
                if (!activePlaylist) {
                        return [];
                }
                const booksByPath = new Map(displayBooks.map((book) => [book.path, book]));
                return activePlaylist.bookPaths
                        .map((path) => booksByPath.get(path))
                        .filter((book): book is DisplayBookItem => Boolean(book));
        });

        let filteredActivePlaylistBooks = $derived.by(() =>
                activePlaylistBooks.filter((book) => matchesBookshelfQuery(book, parsedBookshelfSearchQuery))
        );

        let bookshelfSearchMatchCount = $derived.by(() =>
                activePlaylistId ? filteredActivePlaylistBooks.length : filteredFiles.length
        );

        let bookshelfSearchTotalCount = $derived.by(() =>
                activePlaylistId ? activePlaylistBooks.length : shelfLevelBooks.length
        );

        let showBookshelfEmptyState = $derived.by(() => {
                if (activePlaylistId) {
                        return false;
                }
                return filteredFiles.length === 0 && filteredPlaylists.length === 0;
        });

        let useListVirtualScroll = $derived.by(() =>
                filteredPlaylists.length === 0 &&
                        shouldUseBookshelfListVirtualScroll(filteredFiles.length, effectiveViewMode)
        );
        let useGridPaintOptimization = $derived.by(() =>
                shouldUseBookshelfGridPaintOptimization(filteredFiles.length, effectiveViewMode)
        );

        let bookshelfMainContainerClass = $derived.by(() => {
                if (effectiveViewMode === 'covers') {
                        return `epub-bookshelf-cover-grid${useGridPaintOptimization ? ' is-paint-optimized' : ''}`;
                }
                if (effectiveViewMode === 'grid') {
                        return `epub-bookshelf-grid${useGridPaintOptimization ? ' is-paint-optimized' : ''}`;
                }
                return 'epub-bookshelf-list';
        });

        let lastHandledRefreshToken = untrack(() => refreshToken);

        $effect(() => {
                if (refreshToken === lastHandledRefreshToken) {
                        return;
                }
                lastHandledRefreshToken = refreshToken;
                void refreshBookshelf();
        });

        let activeSearchSummary = $derived.by(() => {
                return searchQuery.trim() ? t('epub.bookshelf.queryLabel', { query: searchQuery.trim() }) : '';
        });

        let emptyStateMessage = $derived.by(() => {
                if (activePlaylistId && activePlaylistBooks.length > 0 && hasActiveSearchCriteria()) {
                        return activeSearchSummary
                                ? t('epub.bookshelf.noMatchesWithQuery', { query: activeSearchSummary })
                                : t('epub.bookshelf.noMatches');
                }
                if (epubFiles.length > 0) {
                        return activeSearchSummary ? t('epub.bookshelf.noMatchesWithQuery', { query: activeSearchSummary }) : t('epub.bookshelf.noMatches');
                }
                return t('epub.bookshelf.empty');
        });

        let activePlaylistEmptyMessage = $derived.by(() => {
                if (activePlaylistBooks.length === 0) {
                        return t('epub.bookshelf.playlist.empty');
                }
                if (hasActiveSearchCriteria()) {
                        return emptyStateMessage;
                }
                return t('epub.bookshelf.playlist.empty');
        });

        function handleBookshelfSettingsChanged(event: Event) {
                if (suppressBookshelfDataChangedReload) {
                        return;
                }
                const { bookPaths } = readBookshelfDataChangedDetail(event);
                if (bookPaths?.length) {
                        void refreshBookshelfMetadataForPaths(bookPaths);
                        return;
                }
                void loadBookshelfFromCache();
        }

        function handleBookshelfRefreshRequest(event: Event) {
                const { showNotice } = readBookshelfRefreshRequestDetail(event);
                void refreshBookshelf(showNotice);
        }

        function handleBookshelfDisplaySettingsChanged() {
                syncDisplayModePreferences();
        }

        async function persistBookshelfDisplayMode(mode: BookshelfDisplayMode): Promise<void> {
                if (bookshelfDisplayMode === mode) {
                        return;
                }

                const host = getEpubHost() as
                        | ({ settings?: Record<string, unknown>; saveSettings?: () => Promise<void> })
                        | null;

                if (host?.settings) {
                        host.settings.bookshelfDisplayMode = mode;
                        host.settings.bookshelfAutoViewByLocationEnabled = mode === 'adaptive';
                        if (typeof host.saveSettings === 'function') {
                                await host.saveSettings();
                        }
                }

                bookshelfDisplayMode = mode;
                window.dispatchEvent(new CustomEvent(BOOKSHELF_DISPLAY_SETTINGS_CHANGED_EVENT, {
                        detail: {
                                enabled: mode === 'adaptive',
                                mode
                        }
                }));
                new Notice(t('epub.bookshelf.switchDisplayMode', { mode: getBookshelfDisplayModeOption(mode).label }));
        }

        function dispatchBookshelfDataChanged(): void {
                suppressBookshelfDataChangedReload = true;
                dispatchEpubBookshelfDataChanged();
                queueMicrotask(() => {
                        suppressBookshelfDataChangedReload = false;
                });
        }

        function notifyBookshelfChanged(includeRefreshRequest = false, showRefreshNotice = false) {
                dispatchBookshelfDataChanged();
                if (includeRefreshRequest) {
                        dispatchEpubBookshelfRefreshRequest(undefined, {
                                showNotice: showRefreshNotice,
                        });
                }
        }

        async function openScanImportModal(
                scanEntries?: Awaited<ReturnType<typeof storageService.loadScanIndex>>
        ) {
                const entries = scanEntries ?? await storageService.loadScanIndex();
                if (entries.length === 0) {
                        new Notice(t('epub.bookshelf.vaultScanEmpty'));
                        return;
                }

                const membership = await storageService.loadBookshelfMembership();
                const { EpubBookshelfImportModal } = await import('../modals/EpubBookshelfImportModal');
                const modal = new EpubBookshelfImportModal(app, {
                        entries,
                        membership,
                        title: t('epub.bookshelf.vaultScanTitle'),
                                onConfirm: async (paths: string[]) => {
                                        const addedEntries = await storageService.addBooksToBookshelf(paths);
                                        if (addedEntries.length === 0) {
                                                new Notice(
                                                        paths.length > 0
                                                                ? t('epub.bookshelf.vaultScanAddFailed')
                                                                : t('epub.bookshelf.vaultScanAlreadyAdded')
                                                );
                                                return;
                                        }

                                await refreshBookshelf();
                                warmEpubAnnotationIndexForPaths(
                                        app,
                                        addedEntries.map((entry) => entry.path)
                                );
                                new Notice(t('epub.bookshelf.vaultScanAdded', { count: addedEntries.length }));
                        },
                });
                modal.open();
        }

        async function scanVaultAndPromptImport() {
                try {
                        const scanEntries = await storageService.scanVaultBooks();
                        notifyBookshelfChanged(false);

                        if (scanEntries.length === 0) {
                                new Notice(t('epub.bookshelf.vaultScanEmpty'));
                                return;
                        }

                        await openScanImportModal(scanEntries);
                } catch (error) {
                        logger.error('Failed to scan vault EPUB files:', error);
                        new Notice(t('epub.bookshelf.vaultScanFailed'));
                }
        }

	async function requestBookshelfRefresh() {
                try {
                        await refreshBookshelf(true);
                } catch (error) {
                        logger.error('Failed to refresh EPUB bookshelf:', error);
                        new Notice(t('epub.bookshelf.refreshFailed'));
                }
        }

        function openFallbackSettingsMenu(event: MouseEvent) {
                const menu = new Menu();
                menu.addItem((item) => {
                        item.setTitle(t('epub.bookshelf.menu.displayFeatures'))
                                .setIcon('library');
                        const subMenu = (item as any).setSubmenu();

                        for (const option of getBookshelfDisplayModeOptions()) {
                                subMenu.addItem((subItem: any) => {
                                        subItem.setTitle(option.label)
                                                .setIcon(option.icon)
                                                .setChecked(bookshelfDisplayMode === option.mode)
                                                .onClick(() => {
                                                        void persistBookshelfDisplayMode(option.mode);
                                                });
                                });
                        }
                });
                menu.addSeparator();
                menu.addItem((item) => {
                        item.setTitle(t('epub.bookshelf.playlist.createNew'))
                                .setIcon('plus')
                                .onClick(() => {
                                        void createBookshelfPlaylist();
                                });
                });
                menu.addItem((item) => {
                        item.setTitle(t('epub.bookshelf.menu.scanVault'))
                                .setIcon('scan-search')
                                .onClick(() => {
                                        void scanVaultAndPromptImport();
                                });
                });
                menu.addItem((item) => {
                        item.setTitle(t('epub.bookshelf.menu.refresh'))
                                .setIcon('refresh-cw')
                                .onClick(() => {
                                        void requestBookshelfRefresh();
                                });
                });
                menu.showAtMouseEvent(event);
        }

        function handleSettingsAction(event: MouseEvent) {
                if (onSettingsClick) {
                        onSettingsClick(event);
                        return;
                }
                openFallbackSettingsMenu(event);
        }

        function reconnectSurfaceContextObserver(): void {
                surfaceContextObserver?.disconnect();
                surfaceContextObserver = null;

                if (!bookshelfRootEl || typeof MutationObserver === 'undefined') {
                        return;
                }

                const observer = new MutationObserver(() => {
                        syncSurfaceContext();
                });

                let current: HTMLElement | null = bookshelfRootEl;
                while (current) {
                        observer.observe(current, {
                                attributes: true,
                                attributeFilter: ['data-weave-surface-context']
                        });
                        current = current.parentElement;
                }

                surfaceContextObserver = observer;
        }

        onMount(() => {
                syncDisplayModePreferences();
                reconnectSurfaceContextObserver();
                window.requestAnimationFrame(() => {
                        syncDisplayModePreferences();
                        reconnectSurfaceContextObserver();
                });
                void hydrateBookshelfSearch();
                void loadBookshelfFromCache();
                window.addEventListener(BOOKSHELF_DATA_CHANGED_EVENT, handleBookshelfSettingsChanged);
                window.addEventListener(BOOKSHELF_REFRESH_REQUEST_EVENT, handleBookshelfRefreshRequest);
                window.addEventListener(BOOKSHELF_DISPLAY_SETTINGS_CHANGED_EVENT, handleBookshelfDisplaySettingsChanged);
                const premiumGuard = PremiumFeatureGuard.getInstance();
                const handleBookshelfPremiumUiChanged = () => {
                        bookshelfPremiumUiRevision += 1;
                };
                const unsubscribePremiumActive = premiumGuard.isPremiumActive.subscribe(handleBookshelfPremiumUiChanged);
                const unsubscribePremiumPreview = premiumGuard.premiumFeaturesPreviewEnabled.subscribe(handleBookshelfPremiumUiChanged);
                window.addEventListener(EPUB_RUNTIME.events.premiumUiStateChanged, handleBookshelfPremiumUiChanged);
                const renameRef = app.vault.on('rename', (file, oldPath) => {
                        handleVaultRename(file, oldPath);
                });
                const deleteRef = app.vault.on('delete', (file) => {
                        const deletedPath = normalizePath(file.path || '');
                        if (!deletedPath) return;
                        removeInvalidFile(deletedPath);
                        void storageService.removeBookshelfEntryForDeletedVaultFile(deletedPath)
                                .then(async () => {
                                        bookshelfPlaylists = await storageService.loadBookshelfPlaylists();
                                        dispatchBookshelfDataChanged();
                                })
                                .catch((error) => {
                                        logger.error('Failed to persist bookshelf delete cleanup:', error);
                                });
                });
                return () => {
                        unsubscribePremiumActive();
                        unsubscribePremiumPreview();
                        window.removeEventListener(EPUB_RUNTIME.events.premiumUiStateChanged, handleBookshelfPremiumUiChanged);
                        app.vault.offref(renameRef);
                        app.vault.offref(deleteRef);
                        surfaceContextObserver?.disconnect();
                        surfaceContextObserver = null;
                        flushBookshelfSearchPersist();
                        if (coverPersistTimer) {
                                window.clearTimeout(coverPersistTimer);
                                coverPersistTimer = null;
                        }
                        if (metadataRetryTimer) {
                                window.clearTimeout(metadataRetryTimer);
                                metadataRetryTimer = null;
                        }
                        for (const [path, cover] of coverPersistPending.entries()) {
                                void storageService.cacheBookshelfCoverImage(path, cover);
                        }
                        coverPersistPending.clear();
                        coverCache.clear();
                };
        });

        onDestroy(() => {
                window.removeEventListener(BOOKSHELF_DATA_CHANGED_EVENT, handleBookshelfSettingsChanged);
                window.removeEventListener(BOOKSHELF_REFRESH_REQUEST_EVENT, handleBookshelfRefreshRequest);
                window.removeEventListener(BOOKSHELF_DISPLAY_SETTINGS_CHANGED_EVENT, handleBookshelfDisplaySettingsChanged);
                flushBookshelfSearchPersist();
        });

        $effect(() => {
                surfaceContext;
                syncSurfaceContext();
                reconnectSurfaceContextObserver();
        });

        $effect(() => {
                bookshelfRootEl;
                syncSurfaceContext();
                reconnectSurfaceContextObserver();
        });

        $effect(() => {
                scheduleBookshelfSearchPersist(searchQuery);
        });

        $effect(() => {
                if (!useListVirtualScroll || !listViewportEl) {
                        return;
                }

                updateListViewportHeight();
                const observer = new ResizeObserver(() => {
                        updateListViewportHeight();
                });
                observer.observe(listViewportEl);
                return () => {
                        observer.disconnect();
                };
        });

        $effect(() => {
                if (!useListVirtualScroll || filteredFiles.length === 0) {
                        return;
                }

                const visibleCount =
                        Math.ceil(listViewportHeight / BOOKSHELF_LIST_VIRTUAL_ITEM_HEIGHT) +
                        BOOKSHELF_LIST_VIRTUAL_OVERSCAN * 2;
                handleVirtualItemsRendered(0, Math.min(filteredFiles.length - 1, visibleCount));
        });
</script>

<style>
                .epub-bookshelf-root {
                        --weave-bookshelf-card-radius: var(--radius-xl);
                        --weave-bookshelf-card-padding: var(--size-4-3);
                        --weave-bookshelf-card-gap: var(--size-4-3);
                        --weave-bookshelf-card-shadow: 0 3px 10px rgba(0, 0, 0, 0.028);
                        --weave-bookshelf-card-shadow-hover: 0 7px 16px rgba(0, 0, 0, 0.044);
                        --weave-bookshelf-grid-card-shadow-hover: 0 8px 18px rgba(0, 0, 0, 0.048);
                        --weave-bookshelf-cover-tile-shadow: 0 6px 14px rgba(0, 0, 0, 0.036);
                        --weave-bookshelf-cover-tile-shadow-hover: 0 10px 22px rgba(0, 0, 0, 0.055);
                        --weave-bookshelf-cover-spine-radius: 4px;
                        --weave-bookshelf-cover-hover-lift-grid: -2px;
                        --weave-bookshelf-cover-hover-lift-tile: -3px;
                        --weave-bookshelf-cover-sheen: color-mix(in srgb, white 14%, transparent);
                        --weave-bookshelf-cover-spine-shadow: inset 3px 0 8px rgba(0, 0, 0, 0.1);
                        --weave-bookshelf-cover-hover-ease: cubic-bezier(0.22, 1, 0.36, 1);
                        --weave-bookshelf-thumb-width: 60px;
                        --weave-bookshelf-thumb-height: 88px;
                        --weave-bookshelf-thumb-radius: var(--radius-l);
                        --weave-bookshelf-thumb-icon-size: 20px;
                        --weave-bookshelf-title-size: calc(var(--font-text-size) * 0.9375);
                        --weave-bookshelf-meta-size: var(--font-ui-smaller);
                        --weave-bookshelf-chip-size: calc(var(--font-ui-smaller) * 0.9);
                        --weave-bookshelf-chip-primary-size: calc(var(--font-ui-smaller) * 0.95);
                        --weave-bookshelf-progress-size: 46px;
                        --weave-bookshelf-progress-font-size: var(--font-ui-smaller);
                        --weave-bookshelf-grid-gap: var(--size-4-3);
                        --weave-bookshelf-list-item-gap: var(--size-4-2);
                        --weave-bookshelf-grid-padding-inline: var(--size-4-4);
                        --weave-bookshelf-grid-padding-bottom: 22px;
                        --weave-bookshelf-card-cover-height: 170px;
                        --weave-bookshelf-card-cover-radius: 10px;
                        --weave-bookshelf-card-title-size: var(--font-ui-small);
                        --weave-bookshelf-card-author-size: calc(var(--font-ui-smaller) * 0.92);
                        --weave-bookshelf-cover-placeholder-icon-size: 28px;
                        --weave-bookshelf-cover-tile-title-size: 14px;
                        container-type: inline-size;
                        display: flex;
                        flex: 1 1 auto;
                        flex-direction: column;
                        width: 100%;
                        height: 100%;
                        min-height: 0;
                        overflow-x: hidden;
                        overflow-y: auto;
                        overscroll-behavior: contain;
                }

                .epub-bookshelf-root.is-list-virtualized {
                        overflow-y: hidden;
                }

                .epub-bookshelf-list.is-virtualized {
                        flex: 1 1 auto;
                        min-height: 0;
                        display: flex;
                        flex-direction: column;
                        padding: var(--size-4-2) var(--weave-bookshelf-grid-padding-inline) var(--weave-bookshelf-grid-padding-bottom);
                }

                .epub-bookshelf-list.is-virtualized :global(.virtual-scroll-container.epub-bookshelf-virtual-scroll) {
                        flex: 1 1 auto;
                        min-height: 0;
                        width: 100%;
                }

                .epub-bookshelf-list.is-virtualized :global(.virtual-scroll-item) {
                        display: flex;
                        flex-direction: column;
                        align-items: stretch;
                        justify-content: flex-start;
                        box-sizing: border-box;
                        padding: 0 0 var(--weave-bookshelf-list-item-gap);
                        border-bottom: none;
                        background-color: transparent;
                }

                .epub-bookshelf-list.is-virtualized :global(.virtual-scroll-item:hover) {
                        background-color: transparent;
                }

                .epub-bookshelf-root.is-list-virtualized :global(.epub-book-item) {
                        animation: none;
                        height: 100%;
                        min-height: 0;
                }

                .epub-bookshelf-grid.is-paint-optimized :global(.epub-book-card),
                .epub-bookshelf-cover-grid.is-paint-optimized :global(.epub-book-cover-tile) {
                        content-visibility: auto;
                        contain-intrinsic-size: 280px 220px;
                }

                .epub-bookshelf-grid.is-paint-optimized :global(.epub-bookshelf-playlist-card),
                .epub-bookshelf-cover-grid.is-paint-optimized :global(.epub-bookshelf-playlist-cover-tile) {
                        content-visibility: auto;
                        contain-intrinsic-size: 280px 220px;
                }

                /* Child Svelte components — must pierce scoped styles. */
                .epub-bookshelf-root :global {
                .epub-bookshelf-toolbar.nav-header {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        gap: 0;
                        min-height: var(--header-height);
                        padding: var(--size-4-2);
                        border-bottom: none;
                        background-color: transparent;
                        box-sizing: border-box;
                }

                .epub-bookshelf-toolbar .epub-bookshelf-actions.nav-buttons-container {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        gap: var(--size-2-1);
                        width: fit-content;
                        max-width: 100%;
                        flex-wrap: nowrap;
                        margin-inline: auto;
                        padding: var(--size-2-1);
                        border-radius: var(--radius-m);
                        background-color: var(--nav-button-container-bg, var(--background-secondary-alt));
                        box-sizing: border-box;
                }

        .epub-bookshelf-toolbar .epub-toolbar-btn.nav-action-button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: var(--size-2-2) var(--size-2-3);
                border: none;
                border-radius: var(--clickable-icon-radius);
                background-color: transparent;
                color: var(--icon-color);
                box-shadow: none;
                opacity: var(--icon-opacity);
                transition:
                        opacity var(--anim-duration-fast) ease-in-out,
                        color var(--anim-duration-fast) ease-in-out,
                        background-color var(--anim-duration-fast) ease-in-out;
        }

        .epub-bookshelf-toolbar .epub-toolbar-btn.nav-action-button:hover {
                color: var(--icon-color-hover);
        }

        .epub-bookshelf-toolbar .epub-toolbar-btn.nav-action-button .svg-icon {
                width: var(--icon-size);
                height: var(--icon-size);
        }
                }

        .epub-bookshelf-search {
                padding: var(--size-2-3) var(--size-4-5) var(--size-2-1);
        }

        .epub-bookshelf-search :global(.card-search-container) {
                width: 100%;
        }

        .epub-bookshelf-search :global(.search-input-wrapper) {
                min-height: calc(var(--input-height) + var(--size-4-3));
                padding: 0 var(--size-4-2) 0 var(--size-4-3);
                border-radius: var(--modal-radius, var(--radius-l));
                background: color-mix(in srgb, var(--weave-elevated-background, var(--background-primary)) 96%, transparent);
                border: 1px solid color-mix(in srgb, var(--background-modifier-border) 76%, transparent);
                box-shadow: none;
        }

        .epub-bookshelf-search :global(.search-input-wrapper:focus-within) {
                border-color: color-mix(in srgb, var(--interactive-accent) 24%, var(--background-modifier-border));
                box-shadow: 0 0 0 3px rgba(var(--interactive-accent-rgb), 0.08);
        }

        .epub-bookshelf-search :global(.search-icon) {
                margin-right: var(--size-4-1);
                color: var(--text-muted);
        }

        .epub-bookshelf-search :global(.search-input-wrapper.is-unified-shell .search-input),
        .epub-bookshelf-search :global(.search-input-wrapper.is-unified-shell input.search-input[type="text"]),
        .epub-bookshelf-search :global(.search-input-wrapper.is-unified-shell input.search-input[type="text"]:hover),
        .epub-bookshelf-search :global(.search-input-wrapper.is-unified-shell input.search-input[type="text"]:focus),
        .epub-bookshelf-search :global(.search-input-wrapper.is-unified-shell input.search-input[type="text"]:focus-visible),
        .epub-bookshelf-search :global(.search-input-wrapper.is-unified-shell input.search-input[type="text"]:active) {
                appearance: none;
                -webkit-appearance: none;
                min-width: 0;
                min-height: calc(var(--input-height) + var(--size-4-2));
                padding: var(--size-2-3) var(--size-2-1);
                font-size: var(--font-ui-small);
                color: var(--text-normal);
                border: none !important;
                background: transparent !important;
                background-color: transparent !important;
                box-shadow: none !important;
                outline: none !important;
                border-radius: 0 !important;
        }

        .epub-bookshelf-search :global(.search-input::placeholder) {
                color: var(--text-faint);
        }

        .epub-bookshelf-search :global(.match-count) {
                font-size: var(--font-ui-smaller);
                color: var(--text-muted);
        }

        .epub-bookshelf-search :global(.clear-button),
        .epub-bookshelf-search :global(.filter-button) {
                width: calc(var(--input-height) - 2px);
                height: calc(var(--input-height) - 2px);
                padding: 0;
                border-radius: var(--clickable-icon-radius);
                color: var(--text-muted);
        }

        .epub-bookshelf-search :global(.clear-button:hover),
        .epub-bookshelf-search :global(.filter-button:hover) {
                background: color-mix(in srgb, var(--background-modifier-hover) 64%, transparent);
                color: var(--text-normal);
        }

        .epub-bookshelf-list {
                display: flex;
                flex-direction: column;
                align-items: stretch;
                width: 100%;
                min-width: 0;
                gap: var(--weave-bookshelf-list-item-gap);
                padding: var(--size-4-2) var(--weave-bookshelf-grid-padding-inline) var(--weave-bookshelf-grid-padding-bottom);
        }

        .epub-bookshelf-playlists {
                display: flex;
                flex-direction: column;
                gap: var(--weave-bookshelf-list-item-gap);
                padding: 0 var(--weave-bookshelf-grid-padding-inline) var(--weave-bookshelf-grid-padding-bottom);
                flex-shrink: 0;
        }

        .epub-bookshelf-playlist-divider {
                flex-shrink: 0;
                margin: var(--size-4-2) 0 0;
                border-top: 1px dashed color-mix(in srgb, var(--background-modifier-border) 90%, transparent);
        }

        .epub-bookshelf-list .epub-bookshelf-playlist-divider {
                margin-inline: 0;
        }

        .epub-bookshelf-playlist-divider--grid {
                grid-column: 1 / -1;
                margin: var(--size-4-2) 0 0;
        }

        .epub-bookshelf-root :global {
        .epub-playlist-mosaic {
                display: grid;
                grid-template-columns: 1fr 1fr;
                grid-template-rows: 1fr 1fr;
                gap: 1px;
                width: 100%;
                height: 100%;
                background: color-mix(in srgb, var(--background-modifier-border) 70%, transparent);
        }

        .epub-playlist-mosaic__cell {
                width: 100%;
                height: 100%;
                min-height: 0;
                object-fit: cover;
                display: block;
                background: color-mix(in srgb, var(--weave-surface-background, var(--background-secondary)) 92%, transparent);
        }

        .epub-playlist-mosaic__placeholder {
                display: grid;
                place-items: center;
                color: var(--text-faint);
        }

        .epub-playlist-mosaic__placeholder :global(.svg-icon) {
                width: 14px;
                height: 14px;
        }

        .epub-bookshelf-playlist-row {
                display: grid;
                position: relative;
                width: 100%;
                max-width: 100%;
                box-sizing: border-box;
                grid-template-columns: var(--weave-bookshelf-thumb-width) minmax(0, 1fr) auto;
                grid-template-rows: minmax(var(--weave-bookshelf-thumb-height), auto) auto;
                column-gap: var(--weave-bookshelf-card-gap);
                row-gap: var(--size-2-2);
                align-items: start;
                padding: var(--weave-bookshelf-card-padding);
                border-radius: var(--weave-bookshelf-card-radius);
                border: 1px solid color-mix(in srgb, var(--background-modifier-border) 62%, transparent);
                background: color-mix(in srgb, var(--weave-elevated-background, var(--background-primary)) 98%, transparent);
                box-shadow: var(--weave-bookshelf-card-shadow);
                cursor: pointer;
                transition: box-shadow 0.14s ease, border-color 0.14s ease, background 0.14s ease;
                margin-bottom: 0;
        }

        .epub-bookshelf-playlist-row:hover,
        .epub-bookshelf-playlist-row:focus-visible {
                border-color: color-mix(in srgb, var(--interactive-accent) 24%, var(--background-modifier-border));
                background: color-mix(in srgb, var(--weave-elevated-background, var(--background-primary)) 100%, transparent);
                box-shadow: var(--weave-bookshelf-card-shadow-hover);
                outline: none;
        }

        .epub-bookshelf-playlist-row__mosaic {
                width: var(--weave-bookshelf-thumb-width);
                height: var(--weave-bookshelf-thumb-height);
                border-radius: var(--weave-bookshelf-thumb-radius);
                grid-column: 1;
                grid-row: 1;
                overflow: hidden;
                flex-shrink: 0;
                border: 1px solid color-mix(in srgb, var(--background-modifier-border) 52%, transparent);
                background: color-mix(in srgb, var(--weave-surface-background, var(--background-secondary)) 92%, transparent);
        }

        .epub-bookshelf-playlist-row__info {
                grid-column: 2;
                grid-row: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
                justify-content: flex-start;
                gap: var(--size-2-1);
                padding-block: 1px;
        }

        .epub-bookshelf-playlist-row__title {
                font-size: var(--weave-bookshelf-title-size);
                font-weight: 600;
                line-height: 1.38;
                color: var(--text-normal);
                display: -webkit-box;
                -webkit-line-clamp: 2;
                line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                word-break: break-word;
        }

        .epub-bookshelf-playlist-row__footer {
                grid-column: 2;
                grid-row: 2;
                width: 100%;
                min-width: 0;
                align-self: start;
                font-size: var(--weave-bookshelf-chip-size);
                line-height: 1.35;
                letter-spacing: 0.01em;
                color: color-mix(in srgb, var(--text-muted) 96%, var(--text-normal));
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
        }

        .epub-bookshelf-playlist-row__chevron {
                grid-column: 3;
                grid-row: 1;
                align-self: start;
                margin-top: 2px;
                color: var(--text-faint);
                font-size: 16px;
                line-height: 1;
                padding-right: 2px;
        }

        .epub-bookshelf-playlist-detail {
                flex: 1 1 auto;
                min-height: 0;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
        }

        .epub-bookshelf-playlist-detail__books,
        .epub-bookshelf-playlist-detail__empty {
                display: flex;
                flex-direction: column;
                gap: var(--weave-bookshelf-list-item-gap);
                padding: var(--size-4-2) var(--weave-bookshelf-grid-padding-inline) var(--weave-bookshelf-grid-padding-bottom);
        }

        .epub-bookshelf-playlist-detail__empty {
                color: var(--text-muted);
                font-size: var(--font-ui-small);
                line-height: 1.6;
                text-align: center;
        }
                }

        .epub-placeholder {
                padding: 28px var(--size-4-5);
                border-radius: var(--weave-bookshelf-card-radius);
                background: color-mix(in srgb, var(--weave-elevated-background, var(--background-secondary)) 88%, transparent);
                color: var(--text-muted);
                font-size: var(--font-ui-small);
                line-height: 1.7;
                text-align: center;
        }

        .epub-bookshelf-root :global(.epub-book-item) {
                display: grid;
                position: relative;
                width: 100%;
                max-width: 100%;
                box-sizing: border-box;
                grid-template-columns: var(--weave-bookshelf-thumb-width) minmax(0, 1fr) auto;
                grid-template-rows: minmax(var(--weave-bookshelf-thumb-height), auto) auto;
                column-gap: var(--weave-bookshelf-card-gap);
                row-gap: var(--size-2-2);
                align-items: start;
                padding: var(--weave-bookshelf-card-padding);
                border-radius: var(--weave-bookshelf-card-radius);
                border: 1px solid color-mix(in srgb, var(--background-modifier-border) 62%, transparent);
                background: color-mix(in srgb, var(--weave-elevated-background, var(--background-primary)) 98%, transparent);
                box-shadow: var(--weave-bookshelf-card-shadow);
                transition: box-shadow 0.14s ease, border-color 0.14s ease, background 0.14s ease;
                cursor: pointer;
                margin-bottom: 0;
        }

        .epub-bookshelf-root :global(.epub-book-item.is-continue-reading) {
                border-color: color-mix(in srgb, var(--interactive-accent) 38%, var(--background-modifier-border));
                background: linear-gradient(
                        105deg,
                        color-mix(in srgb, var(--interactive-accent) 9%, var(--weave-elevated-background, var(--background-primary))) 0%,
                        color-mix(in srgb, var(--weave-elevated-background, var(--background-primary)) 98%, transparent) 62%
                );
                box-shadow: 0 10px 20px rgba(var(--interactive-accent-rgb), 0.08);
        }

        .epub-bookshelf-root :global(.epub-book-item.is-opening) {
                opacity: 0.68;
                pointer-events: none;
        }

        .epub-bookshelf-root :global(.epub-book-item:hover),
        .epub-bookshelf-root :global(.epub-book-item:focus-visible) {
                border-color: color-mix(in srgb, var(--interactive-accent) 24%, var(--background-modifier-border));
                background: color-mix(in srgb, var(--weave-elevated-background, var(--background-primary)) 100%, transparent);
                box-shadow: var(--weave-bookshelf-card-shadow-hover);
                outline: none;
        }

        .epub-bookshelf-root :global(.book-thumb),
        .epub-bookshelf-root :global(.book-thumb-placeholder) {
                width: var(--weave-bookshelf-thumb-width);
                height: var(--weave-bookshelf-thumb-height);
                border-radius: var(--weave-bookshelf-thumb-radius);
                grid-column: 1;
                grid-row: 1;
                flex-shrink: 0;
                overflow: hidden;
                background: color-mix(in srgb, var(--weave-surface-background, var(--background-secondary)) 92%, transparent);
                border: 1px solid color-mix(in srgb, var(--background-modifier-border) 52%, transparent);
        }

        .epub-bookshelf-root :global(.book-thumb) {
                object-fit: cover;
                display: block;
                outline: 1px solid color-mix(in srgb, white 16%, transparent);
                outline-offset: -1px;
        }

        .epub-bookshelf-root :global(.book-thumb-placeholder) {
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--text-faint);
        }

        .epub-bookshelf-root :global(.book-thumb-placeholder .svg-icon) {
                width: var(--weave-bookshelf-thumb-icon-size);
                height: var(--weave-bookshelf-thumb-icon-size);
        }

        .epub-bookshelf-root :global(.book-info) {
                grid-column: 2;
                grid-row: 1;
                min-width: 0;
                flex: initial;
                display: flex;
                flex-direction: column;
                justify-content: flex-start;
                gap: var(--size-2-1);
                padding-block: 1px;
        }

        .epub-bookshelf-root :global(.book-name) {
                font-size: var(--weave-bookshelf-title-size);
                font-weight: 600;
                line-height: 1.38;
                color: var(--text-normal);
                display: -webkit-box;
                -webkit-line-clamp: 2;
                line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                word-break: break-word;
        }

        .epub-bookshelf-root :global(.book-meta-text) {
                font-size: var(--weave-bookshelf-meta-size);
                line-height: 1.45;
                color: var(--text-muted);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
        }

        .epub-bookshelf-root :global(.book-meta-footer) {
                grid-column: 2;
                grid-row: 2;
                width: 100%;
                min-width: 0;
                align-self: start;
                font-size: var(--weave-bookshelf-chip-size);
                line-height: 1.35;
                letter-spacing: 0.01em;
                color: color-mix(in srgb, var(--text-muted) 96%, var(--text-normal));
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
        }

        .epub-bookshelf-root :global(.book-continue-action) {
                grid-column: 3;
                grid-row: 2;
                justify-self: end;
                align-self: end;
                font-size: var(--weave-bookshelf-chip-primary-size);
                font-weight: 700;
                letter-spacing: 0.02em;
                color: color-mix(in srgb, var(--interactive-accent) 80%, var(--text-normal));
                white-space: nowrap;
        }

        .epub-bookshelf-root :global(.book-list-progress-badge) {
                grid-column: 3;
                grid-row: 1;
                align-self: start;
                margin-top: 2px;
        }

        /* -- View Toggle -- */
        .epub-view-toggle {
                display: inline-flex;
                align-items: center;
                border-radius: var(--clickable-icon-radius);
                border: 1px solid color-mix(in srgb, var(--background-modifier-border) 68%, transparent);
                overflow: hidden;
        }

        .epub-view-toggle-btn {
                width: var(--input-height);
                height: var(--input-height);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                border: none;
                border-radius: 0;
                background: transparent;
                color: var(--text-faint);
                box-shadow: none;
                transition: background-color 0.14s ease, color 0.14s ease;
        }

        .epub-view-toggle-btn:hover {
                color: var(--text-muted);
                background: color-mix(in srgb, var(--background-modifier-hover) 50%, transparent);
        }

        .epub-view-toggle-btn.is-active {
                color: var(--text-normal);
                background: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
        }

        .epub-view-toggle-btn :global(.svg-icon) {
                width: var(--icon-xs);
                height: var(--icon-xs);
        }

        /* -- Grid Layout -- */
        .epub-bookshelf-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
                gap: var(--weave-bookshelf-grid-gap);
                padding: var(--size-4-2) var(--weave-bookshelf-grid-padding-inline) var(--weave-bookshelf-grid-padding-bottom);
        }

        .epub-bookshelf-cover-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
                gap: var(--weave-bookshelf-card-gap) var(--weave-bookshelf-grid-gap);
                padding: var(--weave-bookshelf-card-padding) var(--weave-bookshelf-grid-padding-inline) var(--weave-bookshelf-grid-padding-bottom);
        }

        /* -- Grid Card -- */
        .epub-bookshelf-root :global {
        .epub-book-card {
                display: flex;
                flex-direction: column;
                padding: 8px;
                border-radius: var(--radius-xl);
                border: 1px solid color-mix(in srgb, var(--background-modifier-border) 62%, transparent);
                background: color-mix(in srgb, var(--weave-elevated-background, var(--background-primary)) 98%, transparent);
                box-shadow: var(--weave-bookshelf-card-shadow);
                cursor: pointer;
                transition:
                        transform 0.22s var(--weave-bookshelf-cover-hover-ease),
                        box-shadow 0.22s var(--weave-bookshelf-cover-hover-ease),
                        border-color 0.14s ease,
                        background 0.14s ease;
        }

        .epub-book-card.is-opening {
                opacity: 0.68;
                pointer-events: none;
        }

        .epub-book-card.is-continue-reading {
                border-color: color-mix(in srgb, var(--interactive-accent) 40%, var(--background-modifier-border));
                background: linear-gradient(
                        120deg,
                        color-mix(in srgb, var(--interactive-accent) 10%, var(--weave-elevated-background, var(--background-primary))) 0%,
                        color-mix(in srgb, var(--weave-elevated-background, var(--background-primary)) 98%, transparent) 66%
                );
        }

        .epub-book-card:hover,
        .epub-book-card:focus-visible {
                border-color: color-mix(in srgb, var(--interactive-accent) 24%, var(--background-modifier-border));
                background: color-mix(in srgb, var(--weave-elevated-background, var(--background-primary)) 100%, transparent);
                box-shadow: var(--weave-bookshelf-grid-card-shadow-hover);
                outline: none;
        }

        .card-cover-frame {
                position: relative;
                overflow: hidden;
                border-radius:
                        var(--weave-bookshelf-cover-spine-radius)
                        var(--weave-bookshelf-card-cover-radius)
                        var(--weave-bookshelf-card-cover-radius)
                        var(--weave-bookshelf-cover-spine-radius);
        }

        .card-cover-frame::before,
        .card-cover-frame::after {
                content: "";
                position: absolute;
                inset: 0;
                pointer-events: none;
                border-radius: inherit;
        }

        .card-cover-frame::before {
                z-index: 1;
                box-shadow: var(--weave-bookshelf-cover-spine-shadow);
        }

        .card-cover-frame::after {
                z-index: 2;
                background: linear-gradient(
                        105deg,
                        transparent 38%,
                        var(--weave-bookshelf-cover-sheen) 50%,
                        transparent 62%
                );
                transform: translate3d(-110%, 0, 0);
                transition: transform 0.48s var(--weave-bookshelf-cover-hover-ease);
        }

        .card-cover-img {
                width: 100%;
                height: var(--weave-bookshelf-card-cover-height);
                object-fit: cover;
                border-radius: inherit;
                display: block;
                outline: 1px solid color-mix(in srgb, white 14%, transparent);
                outline-offset: -1px;
        }

        .card-cover-placeholder {
                width: 100%;
                height: var(--weave-bookshelf-card-cover-height);
                border-radius: inherit;
                display: flex;
                align-items: center;
                justify-content: center;
                background: color-mix(in srgb, var(--weave-surface-background, var(--background-secondary)) 92%, transparent);
                border: 1px solid color-mix(in srgb, var(--background-modifier-border) 56%, transparent);
                color: var(--text-faint);
        }

        .card-cover-placeholder :global(.svg-icon) {
                width: var(--weave-bookshelf-cover-placeholder-icon-size);
                height: var(--weave-bookshelf-cover-placeholder-icon-size);
        }

        .card-body {
                padding: 8px 4px 4px;
                display: flex;
                flex-direction: column;
                flex: 1;
                gap: 4px;
                min-height: 0;
        }

        .card-title {
                font-size: var(--weave-bookshelf-card-title-size);
                font-weight: 600;
                line-height: 1.38;
                color: var(--text-normal);
                display: -webkit-box;
                -webkit-line-clamp: 2;
                line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                word-break: break-word;
        }

        .card-author {
                font-size: var(--weave-bookshelf-card-author-size);
                line-height: 1.35;
                color: var(--text-muted);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
        }

        .card-continue-cta {
                font-size: var(--weave-bookshelf-chip-primary-size);
                font-weight: 700;
                line-height: 1.35;
                letter-spacing: 0.02em;
                color: color-mix(in srgb, var(--interactive-accent) 82%, var(--text-normal));
        }

        .card-progress {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-top: auto;
                padding-top: 8px;
        }

        .card-progress-bar {
                flex: 1;
                height: 4px;
                border-radius: 999px;
                background: color-mix(in srgb, var(--background-modifier-border) 78%, transparent);
                overflow: hidden;
        }

        .card-progress-fill {
                --book-progress-ring: color-mix(in srgb, var(--interactive-accent) 82%, white 8%);
                height: 100%;
                border-radius: inherit;
                background: linear-gradient(
                        90deg,
                        var(--book-progress-ring),
                        color-mix(in srgb, var(--book-progress-ring) 82%, white)
                );
                transition: width 0.3s ease;
        }

        .card-progress-fill.is-progress-start {
                --book-progress-ring: var(--epub-progress-tone-start-flat);
        }

        .card-progress-fill.is-progress-low {
                --book-progress-ring: var(--epub-progress-tone-low);
        }

        .card-progress-fill.is-progress-mid {
                --book-progress-ring: var(--epub-progress-tone-mid);
        }

        .card-progress-fill.is-progress-high {
                --book-progress-ring: var(--epub-progress-tone-high);
        }

        .card-progress-fill.is-progress-near {
                --book-progress-ring: var(--epub-progress-tone-near);
        }

        .card-progress-fill.is-progress-complete {
                --book-progress-ring: var(--epub-progress-tone-complete);
        }

        .card-progress-text {
                flex: 0 0 auto;
                font-size: var(--weave-bookshelf-chip-size);
                font-weight: 700;
                color: var(--text-muted);
                letter-spacing: -0.02em;
        }

        .card-cover-frame--playlist {
                height: var(--weave-bookshelf-card-cover-height);
        }

        .card-cover-frame--playlist :global(.epub-playlist-mosaic) {
                width: 100%;
                height: 100%;
        }

        .epub-bookshelf-playlist-card {
                border-color: color-mix(in srgb, var(--interactive-accent) 18%, var(--background-modifier-border));
        }
                }

        .epub-bookshelf-root :global {
        .epub-book-cover-tile {
                display: flex;
                flex-direction: column;
                position: relative;
                border-radius: var(--radius-xl);
                overflow: hidden;
                border: 1px solid color-mix(in srgb, var(--background-modifier-border) 62%, transparent);
                background: color-mix(in srgb, var(--weave-elevated-background, var(--background-primary)) 98%, transparent);
                box-shadow: var(--weave-bookshelf-cover-tile-shadow);
                transition:
                        transform 0.22s var(--weave-bookshelf-cover-hover-ease),
                        box-shadow 0.22s var(--weave-bookshelf-cover-hover-ease),
                        border-color 0.14s ease,
                        background 0.14s ease;
        }

        .epub-book-cover-tile.is-opening {
                opacity: 0.68;
                pointer-events: none;
        }

        .epub-book-cover-tile.is-continue-reading {
                border-color: color-mix(in srgb, var(--interactive-accent) 38%, var(--background-modifier-border));
                box-shadow: 0 9px 20px rgba(var(--interactive-accent-rgb), 0.1);
        }

        .epub-book-cover-tile:hover,
        .epub-book-cover-tile:focus-visible {
                border-color: color-mix(in srgb, var(--interactive-accent) 24%, var(--background-modifier-border));
                background: color-mix(in srgb, var(--weave-elevated-background, var(--background-primary)) 100%, transparent);
                box-shadow: var(--weave-bookshelf-cover-tile-shadow-hover);
                outline: none;
        }

        .cover-tile-media {
                position: relative;
                overflow: hidden;
                border-radius:
                        var(--weave-bookshelf-cover-spine-radius)
                        15px
                        0
                        0;
                background: color-mix(in srgb, var(--weave-surface-background, var(--background-secondary)) 84%, transparent);
        }

        .cover-tile-media::before,
        .cover-tile-media::after {
                content: "";
                position: absolute;
                inset: 0;
                pointer-events: none;
        }

        .cover-tile-media::before {
                z-index: 1;
                box-shadow: var(--weave-bookshelf-cover-spine-shadow);
        }

        .cover-tile-media::after {
                z-index: 2;
                background: linear-gradient(
                        105deg,
                        transparent 38%,
                        var(--weave-bookshelf-cover-sheen) 50%,
                        transparent 62%
                );
                transform: translate3d(-110%, 0, 0);
                transition: transform 0.48s var(--weave-bookshelf-cover-hover-ease);
        }

        .cover-tile-continue-badge {
                position: absolute;
                top: 10px;
                left: 10px;
                z-index: 2;
                display: inline-flex;
                align-items: center;
                padding: 3px 8px;
                border-radius: 999px;
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.03em;
                color: color-mix(in srgb, var(--interactive-accent) 92%, var(--text-normal));
                background: color-mix(in srgb, var(--background-primary) 90%, transparent);
                border: 1px solid color-mix(in srgb, var(--interactive-accent) 32%, var(--background-modifier-border));
                backdrop-filter: blur(2px);
                pointer-events: none;
        }

        .cover-tile-playlist-badge {
                position: absolute;
                top: 10px;
                left: 10px;
                z-index: 3;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 3px 8px;
                border-radius: 999px;
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.03em;
                color: color-mix(in srgb, var(--interactive-accent) 92%, var(--text-normal));
                background: color-mix(in srgb, var(--background-primary) 90%, transparent);
                border: 1px solid color-mix(in srgb, var(--interactive-accent) 32%, var(--background-modifier-border));
                backdrop-filter: blur(2px);
                pointer-events: none;
        }

        .cover-tile-playlist-badge__icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
        }

        .cover-tile-playlist-badge__icon :global(.svg-icon) {
                width: 11px;
                height: 11px;
        }

        .cover-tile-media--playlist {
                aspect-ratio: 0.72;
        }

        .cover-tile-media--playlist :global(.epub-playlist-mosaic) {
                width: 100%;
                height: 100%;
                min-height: 100%;
        }

        .epub-bookshelf-playlist-cover-tile {
                border-color: color-mix(in srgb, var(--interactive-accent) 18%, var(--background-modifier-border));
        }

        .cover-tile-img,
        .cover-tile-placeholder {
                display: block;
                width: 100%;
                aspect-ratio: 0.72;
        }

        .cover-tile-img {
                object-fit: cover;
                outline: 1px solid color-mix(in srgb, white 12%, transparent);
                outline-offset: -1px;
        }

        .cover-tile-placeholder {
                position: relative;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                gap: 12px;
                padding: 14px 12px 12px;
                background:
                        linear-gradient(180deg, rgba(var(--interactive-accent-rgb), 0.18), rgba(0, 0, 0, 0.04)),
                        color-mix(in srgb, var(--weave-surface-background, var(--background-secondary)) 90%, transparent);
                color: var(--text-normal);
        }

        .cover-tile-placeholder-title {
                display: -webkit-box;
                -webkit-line-clamp: 4;
                line-clamp: 4;
                -webkit-box-orient: vertical;
                overflow: hidden;
                font-size: var(--weave-bookshelf-cover-tile-title-size);
                font-weight: 700;
                line-height: 1.35;
                letter-spacing: -0.02em;
        }

        .cover-tile-placeholder-icon {
                display: inline-flex;
                align-items: center;
                justify-content: flex-end;
                color: color-mix(in srgb, var(--text-normal) 62%, white);
        }

        .cover-tile-placeholder-icon :global(.svg-icon) {
                width: var(--weave-bookshelf-thumb-icon-size);
                height: var(--weave-bookshelf-thumb-icon-size);
        }

        .cover-tile-footer {
                display: flex;
                align-items: center;
                padding: 8px 10px 10px;
                background: color-mix(in srgb, var(--weave-elevated-background, var(--background-primary)) 98%, transparent);
        }

        .cover-tile-progress {
                --cover-progress: 0%;
                --book-progress-ring: color-mix(in srgb, var(--interactive-accent) 88%, black 6%);
                width: 100%;
                height: 4px;
                border-radius: 999px;
                background: color-mix(in srgb, var(--background-modifier-border) 70%, transparent);
                overflow: hidden;
                box-shadow:
                        inset 0 0 0 1px color-mix(in srgb, var(--background-modifier-border) 44%, transparent),
                        0 1px 4px rgba(0, 0, 0, 0.08);
        }

        .cover-tile-progress.is-progress-start {
                --book-progress-ring: var(--epub-progress-tone-start-flat);
        }

        .cover-tile-progress.is-progress-low {
                --book-progress-ring: var(--epub-progress-tone-low);
        }

        .cover-tile-progress.is-progress-mid {
                --book-progress-ring: var(--epub-progress-tone-mid);
        }

        .cover-tile-progress.is-progress-high {
                --book-progress-ring: var(--epub-progress-tone-high);
        }

        .cover-tile-progress.is-progress-near {
                --book-progress-ring: var(--epub-progress-tone-near);
        }

        .cover-tile-progress.is-progress-complete {
                --book-progress-ring: var(--epub-progress-tone-complete);
        }

        .cover-tile-progress::before {
                content: '';
                display: block;
                width: var(--cover-progress);
                height: 100%;
                border-radius: inherit;
                background: var(--book-progress-ring);
        }
                }

        /* -- Shelf Entrance Animation -- */
        @keyframes epub-shelf-enter {
                from {
                        opacity: 0;
                        transform: translateY(8px);
                }
                to {
                        opacity: 1;
                        transform: translateY(0);
                }
        }

        .epub-bookshelf-root :global(.epub-book-item),
        .epub-bookshelf-root :global(.epub-book-card),
        .epub-bookshelf-root :global(.epub-book-cover-tile),
        .epub-bookshelf-root :global(.epub-bookshelf-playlist-card),
        .epub-bookshelf-root :global(.epub-bookshelf-playlist-cover-tile) {
                animation: epub-shelf-enter 0.28s ease both;
        }

        @media (hover: hover) and (pointer: fine) {
                .epub-bookshelf-root :global(.epub-book-card:hover),
                .epub-bookshelf-root :global(.epub-book-card:focus-visible),
                .epub-bookshelf-root :global(.epub-bookshelf-playlist-card:hover),
                .epub-bookshelf-root :global(.epub-bookshelf-playlist-card:focus-visible) {
                        transform: translateY(var(--weave-bookshelf-cover-hover-lift-grid));
                }

                .epub-bookshelf-root :global(.epub-book-cover-tile:hover),
                .epub-bookshelf-root :global(.epub-book-cover-tile:focus-visible),
                .epub-bookshelf-root :global(.epub-bookshelf-playlist-cover-tile:hover),
                .epub-bookshelf-root :global(.epub-bookshelf-playlist-cover-tile:focus-visible) {
                        transform: translateY(var(--weave-bookshelf-cover-hover-lift-tile));
                }

                .epub-bookshelf-root :global(.epub-book-card:hover .card-cover-frame::after),
                .epub-bookshelf-root :global(.epub-book-card:focus-visible .card-cover-frame::after),
                .epub-bookshelf-root :global(.epub-book-cover-tile:hover .cover-tile-media::after),
                .epub-bookshelf-root :global(.epub-book-cover-tile:focus-visible .cover-tile-media::after) {
                        transform: translate3d(110%, 0, 0);
                }
        }

        @media (prefers-reduced-motion: reduce) {
                .epub-bookshelf-root :global(.epub-book-card),
                .epub-bookshelf-root :global(.epub-book-cover-tile),
                .epub-bookshelf-root :global(.epub-bookshelf-playlist-card),
                .epub-bookshelf-root :global(.epub-bookshelf-playlist-cover-tile) {
                        transition: border-color 0.14s ease, background 0.14s ease, box-shadow 0.14s ease;
                }

                .epub-bookshelf-root :global(.epub-book-card:hover),
                .epub-bookshelf-root :global(.epub-book-card:focus-visible),
                .epub-bookshelf-root :global(.epub-book-cover-tile:hover),
                .epub-bookshelf-root :global(.epub-book-cover-tile:focus-visible),
                .epub-bookshelf-root :global(.epub-bookshelf-playlist-card:hover),
                .epub-bookshelf-root :global(.epub-bookshelf-playlist-card:focus-visible),
                .epub-bookshelf-root :global(.epub-bookshelf-playlist-cover-tile:hover),
                .epub-bookshelf-root :global(.epub-bookshelf-playlist-cover-tile:focus-visible) {
                        transform: none;
                }

                .epub-bookshelf-root :global(.card-cover-frame::after),
                .epub-bookshelf-root :global(.cover-tile-media::after) {
                        display: none;
                }
        }

        @container (max-width: 360px) {
                .epub-bookshelf-root :global(.epub-book-item) {
                        column-gap: 12px;
                        row-gap: 8px;
                        padding: 11px;
                }

                .epub-bookshelf-root :global(.epub-bookshelf-toolbar.nav-header) {
                        padding-inline: 8px;
                }

                .epub-bookshelf-cover-grid {
                        grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
                        gap: 12px 10px;
                }
        }
</style>

<div class="epub-bookshelf-root" class:is-list-virtualized={useListVirtualScroll} bind:this={bookshelfRootEl}>
        <BookshelfToolbar
                {searching}
                backButtonLabel={effectiveBackButtonLabel}
                {t}
                onImport={scanVaultAndPromptImport}
                onToggleSearch={toggleBookshelfSearch}
                onBack={handleToolbarBack}
                onSettings={handleSettingsAction}
        />

{#if searching}
        <div class="epub-bookshelf-search">
                <EpubSearchInput
                        app={app}
                        bind:value={searchQuery}
                        onClear={clearSearchCriteria}
                        placeholder={t('epub.bookshelf.searchPlaceholder')}
                        dataSource="bookshelf"
                        availableStatuses={localizedBookshelfReadingStatusOptions}
                        availableAuthors={availableAuthorOptions}
                        availablePublishers={availablePublisherOptions}
                        availableFormats={availableFormatOptions}
                        matchCount={bookshelfSearchMatchCount}
                        totalCount={bookshelfSearchTotalCount}
                        autoFocus={!hasActiveSearchCriteria()}
                />
        </div>
{/if}

{#if loadingBooks && epubFiles.length > 0}
        <div class="epub-bookshelf-loading-banner">
                <EpubLoadingState variant="inline" message={t('epub.bookshelf.refreshing')} />
        </div>
{/if}

{#key `${effectiveViewMode}:${bookshelfDisplayMode}:${detectedSurfaceContext}:${useListVirtualScroll}:${activePlaylistId}`}
        {#if activePlaylist}
                <BookshelfPlaylistDetail
                        books={filteredActivePlaylistBooks.map((book) => ({
                                ...book,
                                coverUrl: covers.get(book.path) ?? null,
                        }))}
                        emptyMessage={activePlaylistEmptyMessage}
                        showProgress={canShowBookshelfProgress}
                        {t}
                        onOpenBook={switchBook}
                        onBookContextMenu={handleContextMenu}
                        onBookKeydown={handleBookKeydown}
                />
        {:else if loadingBooks && epubFiles.length === 0}
                <div class="epub-placeholder">
                        <EpubLoadingState message={t('epub.bookshelf.refreshing')} />
                </div>
        {:else if showBookshelfEmptyState}
                <div class="epub-placeholder">
                        {emptyStateMessage}
                </div>
        {:else}
                {#if filteredFiles.length > 0 && useListVirtualScroll}
                        <div class="epub-bookshelf-list is-virtualized" bind:this={listViewportEl}>
                                <VirtualScroll
                                        items={filteredFiles}
                                        itemHeight={BOOKSHELF_LIST_VIRTUAL_ITEM_HEIGHT}
                                        containerHeight={listViewportHeight}
                                        overscan={BOOKSHELF_LIST_VIRTUAL_OVERSCAN}
                                        className="epub-bookshelf-virtual-scroll"
                                        onItemsRendered={handleVirtualItemsRendered}
                                >
                                        {#snippet children(file, index)}
                                                <BookshelfListBookItem
                                                        file={file as DisplayBookItem}
                                                        {index}
                                                        animateEntry={false}
                                                        coverUrl={covers.get((file as DisplayBookItem).path) ?? null}
                                                        isOpening={openingBookPath === (file as DisplayBookItem).path}
                                                        isContinueReading={isContinueReadingBook(file as DisplayBookItem)}
                                                        showProgress={canShowBookshelfProgress}
                                                        {t}
                                                        onOpen={switchBook}
                                                        onContextMenu={handleContextMenu}
                                                        onKeydown={handleBookKeydown}
                                                />
                                        {/snippet}
                                </VirtualScroll>
                        </div>
                {:else if filteredFiles.length > 0 || filteredPlaylists.length > 0}
                        <div class={bookshelfMainContainerClass}>
                                {#each filteredFiles as file, index (file.path)}
                                        {#if effectiveViewMode === 'covers'}
                                                <BookshelfCoverTile
                                                        {file}
                                                        {index}
                                                        coverUrl={covers.get(file.path) ?? null}
                                                        isOpening={openingBookPath === file.path}
                                                        isContinueReading={isContinueReadingBook(file)}
                                                        showProgress={canShowBookshelfProgress}
                                                        {t}
                                                        onOpen={switchBook}
                                                        onContextMenu={handleContextMenu}
                                                        onKeydown={handleBookKeydown}
                                                />
                                        {:else if effectiveViewMode === 'grid'}
                                                <BookshelfGridCard
                                                        {file}
                                                        {index}
                                                        coverUrl={covers.get(file.path) ?? null}
                                                        isOpening={openingBookPath === file.path}
                                                        isContinueReading={isContinueReadingBook(file)}
                                                        showProgress={canShowBookshelfProgress}
                                                        {t}
                                                        onOpen={switchBook}
                                                        onContextMenu={handleContextMenu}
                                                        onKeydown={handleBookKeydown}
                                                />
                                        {:else}
                                                <BookshelfListBookItem
                                                        {file}
                                                        {index}
                                                        coverUrl={covers.get(file.path) ?? null}
                                                        isOpening={openingBookPath === file.path}
                                                        isContinueReading={isContinueReadingBook(file)}
                                                        showProgress={canShowBookshelfProgress}
                                                        {t}
                                                        onOpen={switchBook}
                                                        onContextMenu={handleContextMenu}
                                                        onKeydown={handleBookKeydown}
                                                />
                                        {/if}
                                {/each}
                                {#if filteredPlaylists.length > 0}
                                        {#if filteredFiles.length > 0}
                                                <div
                                                        class="epub-bookshelf-playlist-divider"
                                                        class:epub-bookshelf-playlist-divider--grid={effectiveViewMode !== 'list'}
                                                        aria-hidden="true"
                                                ></div>
                                        {/if}
                                        {#each filteredPlaylists as playlist, playlistIndex (playlist.id)}
                                                {#if effectiveViewMode === 'covers'}
                                                        <BookshelfPlaylistCoverTile
                                                                playlist={{
                                                                        id: playlist.id,
                                                                        name: playlist.name,
                                                                        metaLine: buildPlaylistMetaLine(playlist),
                                                                }}
                                                                index={filteredFiles.length + playlistIndex}
                                                                coverUrls={getPlaylistCoverUrls(playlist)}
                                                                badgeLabel={t('epub.bookshelf.playlist.coverBadge')}
                                                                onOpen={openPlaylistDetail}
                                                                onKeydown={handlePlaylistKeydown}
                                                                onContextMenu={handlePlaylistContextMenu}
                                                        />
                                                {:else if effectiveViewMode === 'grid'}
                                                        <BookshelfPlaylistGridCard
                                                                playlist={{
                                                                        id: playlist.id,
                                                                        name: playlist.name,
                                                                        metaLine: buildPlaylistMetaLine(playlist),
                                                                }}
                                                                index={filteredFiles.length + playlistIndex}
                                                                coverUrls={getPlaylistCoverUrls(playlist)}
                                                                onOpen={openPlaylistDetail}
                                                                onKeydown={handlePlaylistKeydown}
                                                                onContextMenu={handlePlaylistContextMenu}
                                                        />
                                                {:else}
                                                        <BookshelfPlaylistRow
                                                                playlist={{
                                                                        id: playlist.id,
                                                                        name: playlist.name,
                                                                        metaLine: buildPlaylistMetaLine(playlist),
                                                                }}
                                                                coverUrls={getPlaylistCoverUrls(playlist)}
                                                                onOpen={openPlaylistDetail}
                                                                onKeydown={handlePlaylistKeydown}
                                                                onContextMenu={handlePlaylistContextMenu}
                                                        />
                                                {/if}
                                        {/each}
                                {/if}
                        </div>
                {/if}
        {/if}
{/key}
</div>
