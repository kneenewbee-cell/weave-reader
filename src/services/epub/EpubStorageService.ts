import { type App, TAbstractFile, TFile } from "obsidian";
import { errorPlainText, unknownPlainText } from "../../utils/unknown-plain-text";
import { Platform, normalizePath } from "obsidian";
import {
	getPluginPathsById,
	LEGACY_PATHS,
	getV2Paths,
	toVaultAdapterPath,
} from "../../config/paths";
import { DirectoryUtils } from "../../utils/directory-utils";
import { logger } from "../../utils/logger";
import {
	getDefaultEpubReaderSettings,
	type EpubReaderSettingsDeviceKind,
} from "./reader-settings";
import {
	isSupportedBookFile,
	isSupportedBookPath,
	stripSupportedBookExtension,
} from "./book-format";
import {
	epubVaultPathsReferToSameBook,
	isVisibleVaultBookPath,
	resolveSupportedBookFile,
	resolveSupportedBookFilePath as resolveCanonicalSupportedBookFilePath,
} from "./epub-vault-path";
import { normalizeCanvasExcerptAnchorsMap } from "./canvas-excerpt-anchor";
import { EpubBookmarkService, type EpubBookmarkReadingState } from "./EpubBookmarkService";
import { normalizeReadingPaceStats } from "./reading-pace";
import type {
	BookMetadata,
	ConcealedText,
	EpubBook,
	EpubLastOpenBookmark,
	EpubParagraphModeReadingPosition,
	EpubReadingReferencePoint,
	EpubReaderSettings,
	ReadingPosition,
	ReadingStats,
	EpubStrikethroughDisplayMode,
} from "./types";
import { getEpubRuntime } from "./epub-runtime";
import { EpubProgressStore, normalizePendingProgressPayload } from "./epub-progress-store";
import {
	hasRetainedLocalBookData,
	normalizeBookMetadata,
	normalizeBookState,
	normalizeBookshelfIndexEntries,
	normalizeBookshelfMembershipEntries,
	normalizeConcealedTextMode,
	normalizeConcealedTexts,
	normalizeExcerptSettings,
	normalizeLastOpenBookmark,
	normalizeLegacyBook,
	normalizeLegacySourceIds,
	normalizeLocalBookRecord,
	normalizeLocalReaderData,
	normalizePluginUiMemory,
	normalizeReaderSettingsForDevice,
	normalizeReadingPosition,
	normalizeReadingReferencePoint,
	normalizeReadingStats,
	normalizeScanIndexEntries,
	normalizeSourceRegistryEntries,
	normalizeStoredBookDescriptor,
	toBookFromDescriptor,
	toStoredBookDescriptor,
} from "./epub-local-data-normalize";
import type {
	CanvasExcerptAnchorRecord,
	EpubPluginUiMemory,
	EpubReaderLocalBookRecord,
	EpubReaderLocalDataFile,
	EpubStoredBookDescriptor,
} from "./epub-local-data-types";
export type { CanvasExcerptAnchorRecord, EpubPluginUiMemory } from "./epub-local-data-types";
import { dedupeBookshelfMembershipEntries, type EpubBookshelfMembershipEntry } from "./epub-bookshelf-membership-store";
import {
	createBookshelfPlaylistId,
	normalizeBookshelfPlaylistBookPaths,
	normalizeBookshelfPlaylists,
	pruneBookshelfPlaylistPaths,
	remapBookshelfPlaylists,
	removeBookPathFromBookshelfPlaylists,
	sortBookshelfPlaylists,
	type EpubBookshelfPlaylist,
} from "./epub-bookshelf-playlist-store";
import { peelEmbeddedScanIndexFromUnifiedData } from "./epub-unified-local-data-read";
import {
	computeAvailableEpubFingerprints,
	type PartialEpubFingerprints,
} from "./epub-fingerprints";
import {
	getEpubPortableBookPath,
	getEpubPortableDataRoot,
	readEpubSemanticJson,
	safeEpubSemanticBookId,
	writeEpubSemanticJson,
} from "./semantic/semantic-store";
import {
	normalizeTocChapterMarkKey,
	normalizeTocChapterMarkMap,
	type EpubTocChapterMark,
	type EpubTocChapterMarkMap,
} from "./epub-toc-chapter-mark";
import {
	normalizeTocChapterMarkSettings,
	type EpubTocChapterMarkSettings,
} from "./epub-toc-chapter-mark-settings";


export interface EpubBookshelfSettings {
	lastScanAt?: number;
}

export interface EpubBookshelfIndexEntry {
	path: string;
	name: string;
	folder: string;
	size: number;
	addedAt?: number;
	customCoverPath?: string;
}

export interface EpubScanIndexEntry extends EpubBookshelfIndexEntry {
	mtime: number;
	coverImage?: string;
}

export type { EpubBookshelfMembershipEntry };

export type { EpubBookshelfPlaylist };

export interface EpubDeleteTrackedBookResult {
	deletedFilePath: string | null;
	fileDeleted: boolean;
	removedScanEntries: number;
	removedMembershipEntries: number;
	removedBookIds: string[];
}

export interface EpubSourceRegistryEntry {
	sourceId: string;
	filePath: string;
	sourceFingerprint?: string;
	fileFingerprint?: string;
	packageFingerprint?: string;
	contentFingerprint?: string;
	legacySourceIds?: string[];
	sourceSize?: number;
	sourceMtime?: number;
	lastSeenAt: number;
	lastKnownPath?: string;
}

const LEGACY_BOOKSHELF_SEARCH_QUERY_STORAGE_KEY = "weave-epub-bookshelf-search-query";
const UNIFIED_LOCAL_DATA_PARSE_RETRY_DELAY_MS = 60;

export interface EpubLocalDataMigrationInspection {
	hasUnifiedDataFile: boolean;
	legacyFileCount: number;
	legacyFiles: string[];
}

export interface EpubLocalDataMigrationReport {
	migratedSectionCount: number;
	removedLegacyFileCount: number;
	remainingLegacyFiles: string[];
	failures: Array<{ path: string; message: string }>;
}

export const DEFAULT_EPUB_BOOKSHELF_SETTINGS: EpubBookshelfSettings = {
	lastScanAt: 0,
};

export class EpubStorageService {
	private app: App;
	private basePath: string;
	private localPluginId: string;
	private static _localReaderDataCacheByApp = new WeakMap<App, Map<string, EpubReaderLocalDataFile>>();
	private static _localReaderDataWriteLockByApp = new WeakMap<App, Map<string, Promise<void>>>();
	private _progressDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private _pendingProgress: {
		bookId: string;
		position: ReadingPosition;
		readingStats?: ReadingStats;
	} | null = null;
	private _booksCache: Record<string, EpubBook> | null = null;
	private _booksCacheHydrated = false;
	private _booksCacheHydrationTask: Promise<void> | null = null;
	private _booksWriteLock: Promise<void> = Promise.resolve();
	private _bookStateWriteLocks = new Map<string, Promise<void>>();
	private bookIdAliasMap = new Map<string, string>();
	private automaticMigrationCompleted = false;
	private inflightAutomaticMigration: Promise<void> | null = null;
	private bookmarkService: EpubBookmarkService | null = null;

	constructor(app: App) {
		this.app = app;
		const runtime = getEpubRuntime();
		this.localPluginId = runtime.pluginDirName;
		this.basePath = getV2Paths().ir.epub;
	}

	getApp(): App {
		return this.app;
	}

	private getBookmarkService(): EpubBookmarkService {
		if (!this.bookmarkService) {
			this.bookmarkService = new EpubBookmarkService(this.app);
		}
		return this.bookmarkService;
	}

	async ensureDirectories(): Promise<void> {
		await Promise.all([
			this.ensureSyncBaseDirectory(),
			this.ensureUnifiedLocalDataDirectory(),
			this.ensureScanIndexDirectory(),
		]);
	}

	private async ensureSyncBaseDirectory(): Promise<void> {
		await DirectoryUtils.ensureDirRecursive(this.app.vault.adapter, this.basePath);
	}

	private async ensureUnifiedLocalDataDirectory(): Promise<void> {
		await DirectoryUtils.ensureDirForFile(this.app.vault.adapter, this.getUnifiedLocalDataPath());
	}

	private async ensureScanIndexDirectory(): Promise<void> {
		await DirectoryUtils.ensureDirForFile(this.app.vault.adapter, this.getScanIndexPath());
	}

	async loadBooks(options?: { hydrateStates?: boolean }): Promise<Record<string, EpubBook>> {
		const shouldHydrateStates = options?.hydrateStates !== false;
		await this.ensureAutomaticDataMigrations();
		if (this._booksCache) {
			if (shouldHydrateStates) {
				await this.ensureBooksCacheHydrated();
			}
			return this._booksCache;
		}
		const { books: localBooks, authoritative } = await this.readBooksFromUnifiedLocalData();
		if (authoritative) {
			this._booksCache = localBooks;
			if (shouldHydrateStates) {
				await this.ensureBooksCacheHydrated();
			}
			return localBooks;
		}
		const legacyBooks = await this.readLegacyBooks();
		const books = {
			...legacyBooks,
			...localBooks,
		};

		if (Object.keys(books).length > 0) {
			this._booksCache = books;
			if (shouldHydrateStates) {
				await this.ensureBooksCacheHydrated();
			}
			return books;
		}

		this._booksCache = {};
		this._booksCacheHydrated = shouldHydrateStates;
		return this._booksCache;
	}

	private async ensureBooksCacheHydrated(): Promise<void> {
		if (this._booksCacheHydrated || !this._booksCache) {
			return;
		}

		if (!this._booksCacheHydrationTask) {
			this._booksCacheHydrationTask = this.hydrateBookStates(this._booksCache)
				.then(() => {
					this._booksCacheHydrated = true;
				})
				.finally(() => {
					this._booksCacheHydrationTask = null;
				});
		}

		await this._booksCacheHydrationTask;
	}

	private async writeBooksWithLock(books: Record<string, EpubBook>): Promise<void> {
		const doWrite = async () => {
			this._booksCache = books;
			this._booksCacheHydrated = false;
			this._booksCacheHydrationTask = null;
			await this.updateUnifiedLocalReaderData((localData) => {
				const existingRecords = localData.books || {};
				const nextRecords: Record<string, EpubReaderLocalBookRecord> = {};

				for (const [bookId, record] of Object.entries(existingRecords)) {
					if (Object.prototype.hasOwnProperty.call(books, bookId)) {
						continue;
					}

					const retained: EpubReaderLocalBookRecord = { ...record };
					retained.descriptor = undefined;
					if (this.hasRetainedLocalBookData(retained)) {
						nextRecords[bookId] = retained;
					}
				}

				for (const [bookId, book] of Object.entries(books)) {
					const current = existingRecords[bookId] || {};
					const nextRecord: EpubReaderLocalBookRecord = {
						...current,
						descriptor: this.toStoredBookDescriptor(book),
					};
					nextRecord.state = undefined;
					nextRecords[bookId] = nextRecord;
				}

				localData.bookCatalogStoredLocally = true;
				localData.books = nextRecords;
			});

			for (const book of Object.values(books)) {
				await this.writeBookState(book.id, {
					currentPosition: book.currentPosition,
					readingStats: book.readingStats,
				});
			}
		};
		this._booksWriteLock = this._booksWriteLock.then(doWrite, doWrite);
		await this._booksWriteLock;
	}

	private getLocalReaderStateRoot(): string {
		return this.getPluginAdapterPath(
			`${
				getPluginPathsById(this.app, this.localPluginId).state.incrementalReading.readerState
			}/epub`
		);
	}

	private getPluginAdapterPath(relativePath: string): string {
		return toVaultAdapterPath(this.app, normalizePath(relativePath));
	}

	private getUnifiedLocalDataPath(): string {
		return this.getPluginAdapterPath(
			getPluginPathsById(this.app, this.localPluginId).state.epubLocalState
		);
	}

	private getLegacyUnifiedLocalDataPaths(): string[] {
		const targetPath = this.getUnifiedLocalDataPath();
		return Array.from(
			new Set([
				normalizePath(
					`${
						getPluginPathsById(this.app, this.localPluginId).state.incrementalReading
							.epubReaderData
					}`
				),
			])
		).filter((path) => Boolean(path) && path !== targetPath);
	}

	private getLocalReaderArtifactsRoot(): string {
		return this.getPluginAdapterPath(
			`${
				getPluginPathsById(this.app, this.localPluginId).cache.incrementalReading
					.readerArtifacts
			}/epub`
		);
	}

	private getBookStatePath(bookId: string): string {
		return normalizePath(`${this.getLocalReaderStateRoot()}/${bookId}/state.json`);
	}

	private getLegacyBookStatePath(bookId: string): string {
		return `${this.basePath}/${bookId}/state.json`;
	}

	private getLastOpenBookmarkPath(bookId: string): string {
		return normalizePath(`${this.getLocalReaderStateRoot()}/${bookId}/last-open-bookmark.json`);
	}

	private getLegacyLastOpenBookmarkPath(bookId: string): string {
		return `${this.basePath}/${bookId}/last-open-bookmark.json`;
	}

	private getConcealedTextsPath(bookId: string): string {
		return normalizePath(`${this.getLocalReaderArtifactsRoot()}/${bookId}/concealed-texts.json`);
	}

	private getLegacyConcealedTextsPath(bookId: string): string {
		return `${this.basePath}/${bookId}/concealed-texts.json`;
	}

	private getLegacyEpubBasePaths(): string[] {
		return Array.from(
			new Set([normalizePath(this.basePath), normalizePath(LEGACY_PATHS.epubReading)])
		).filter(Boolean);
	}

	private getBookshelfIndexPath(): string {
		return `${this.basePath}/bookshelf-index.json`;
	}

	private getScanIndexPath(): string {
		return this.getPluginAdapterPath(
			getPluginPathsById(this.app, this.localPluginId).cache.epubScanIndex
		);
	}

	private getLegacyStoredScanIndexPath(): string {
		return `${this.basePath}/epub-scan-index.json`;
	}

	private getBookshelfMembershipPath(): string {
		return `${this.basePath}/bookshelf-membership.json`;
	}

	private getSourceRegistryPath(): string {
		return `${this.basePath}/epub-source-registry.json`;
	}

	private paragraphModePositionsMigrated = false;

	private getParagraphModePositionsPath(): string {
		return this.getPluginAdapterPath(
			getPluginPathsById(this.app, this.localPluginId).cache.epubParagraphModePositions
		);
	}

	private getLegacyParagraphModePositionsPaths(): string[] {
		return Array.from(
			new Set(
				[this.basePath, ...this.getLegacyEpubBasePaths()].map(
					(basePath) => `${normalizePath(basePath)}/paragraph-mode-positions.md`
				)
			)
		).filter(Boolean);
	}

	private async ensureParagraphModePositionsDirectory(): Promise<void> {
		await DirectoryUtils.ensureDirForFile(
			this.app.vault.adapter,
			this.getParagraphModePositionsPath()
		);
	}

	private async migrateLegacyParagraphModePositionsIfNeeded(): Promise<void> {
		if (this.paragraphModePositionsMigrated) {
			return;
		}
		this.paragraphModePositionsMigrated = true;

		const adapter = this.app.vault.adapter as typeof this.app.vault.adapter & {
			remove?: (path: string) => Promise<void>;
		};
		const targetPath = this.getParagraphModePositionsPath();
		if (await adapter.exists(targetPath)) {
			return;
		}

		for (const legacyPath of this.getLegacyParagraphModePositionsPaths()) {
			if (!(await adapter.exists(legacyPath))) {
				continue;
			}
			try {
				const content = await adapter.read(legacyPath);
				const positions = this.parseParagraphModePositionsMarkdown(content);
				if (Object.keys(positions).length === 0) {
					continue;
				}
				await this.ensureParagraphModePositionsDirectory();
				await adapter.write(
					targetPath,
					JSON.stringify({ version: 1, positions }, null, 2)
				);
				if (typeof adapter.remove === "function") {
					await adapter.remove(legacyPath);
				}
				return;
			} catch (error) {
				logger.warn(
					"[EpubStorageService] Failed to migrate legacy paragraph mode positions:",
					error
				);
			}
		}
	}

	private parseParagraphModePositionsJson(
		content: string
	): Record<string, EpubParagraphModeReadingPosition> {
		try {
			const parsed = JSON.parse(content) as {
				positions?: Record<string, Partial<EpubParagraphModeReadingPosition>>;
			};
			if (!parsed.positions || typeof parsed.positions !== "object") {
				return {};
			}
			const result: Record<string, EpubParagraphModeReadingPosition> = {};
			for (const [bookId, position] of Object.entries(parsed.positions)) {
				const normalizedBookId = String(bookId || "").trim();
				const cfi = String(position?.cfi || "").trim();
				const paragraphId = String(position?.paragraphId || "").trim();
				if (!normalizedBookId || !cfi || !paragraphId) {
					continue;
				}
				result[normalizedBookId] = {
					bookId: normalizedBookId,
					filePath: String(position?.filePath || ""),
					bookTitle: String(position?.bookTitle || ""),
					chapterTitle: String(position?.chapterTitle || ""),
					chapterHref: String(position?.chapterHref || ""),
					chapterIndex: Number.isFinite(position?.chapterIndex)
						? Number(position.chapterIndex)
						: 0,
					cfi,
					percent: Number.isFinite(position?.percent) ? Number(position.percent) : 0,
					paragraphId,
					paragraphIndex: Number.isFinite(position?.paragraphIndex)
						? Number(position.paragraphIndex)
						: 0,
					paragraphTextPreview: String(position?.paragraphTextPreview || ""),
					savedAt: Number.isFinite(position?.savedAt) ? Number(position.savedAt) : Date.now(),
				};
			}
			return result;
		} catch (error) {
			logger.warn("[EpubStorageService] Failed to parse paragraph mode positions json:", error);
			return {};
		}
	}

	private getCurrentDeviceKind(): EpubReaderSettingsDeviceKind {
		return Platform.isMobile ? "mobile" : "desktop";
	}

	private createEmptyLocalReaderData(): EpubReaderLocalDataFile {
		return {
			version: 1,
			updatedAt: 0,
			bookCatalogStoredLocally: false,
			readerSettings: {},
			canvasBindings: {},
			books: {},
		};
	}

	private cloneLocalReaderData(data: EpubReaderLocalDataFile): EpubReaderLocalDataFile {
		return JSON.parse(JSON.stringify(data)) as EpubReaderLocalDataFile;
	}

	private getUnifiedLocalDataCacheKey(): string {
		return this.getUnifiedLocalDataPath();
	}

	private getUnifiedLocalDataCacheStore(): Map<string, EpubReaderLocalDataFile> {
		let store = EpubStorageService._localReaderDataCacheByApp.get(this.app);
		if (!store) {
			store = new Map<string, EpubReaderLocalDataFile>();
			EpubStorageService._localReaderDataCacheByApp.set(this.app, store);
		}
		return store;
	}

	private getUnifiedLocalDataWriteLockStore(): Map<string, Promise<void>> {
		let store = EpubStorageService._localReaderDataWriteLockByApp.get(this.app);
		if (!store) {
			store = new Map<string, Promise<void>>();
			EpubStorageService._localReaderDataWriteLockByApp.set(this.app, store);
		}
		return store;
	}

	private getUnifiedLocalDataWriteLock(): Promise<void> {
		return this.getUnifiedLocalDataWriteLockStore().get(this.getUnifiedLocalDataCacheKey()) ?? Promise.resolve();
	}

	private setUnifiedLocalDataWriteLock(lock: Promise<void>): void {
		this.getUnifiedLocalDataWriteLockStore().set(this.getUnifiedLocalDataCacheKey(), lock);
	}

	private getCachedUnifiedLocalReaderData(): EpubReaderLocalDataFile | null {
		return this.getUnifiedLocalDataCacheStore().get(this.getUnifiedLocalDataCacheKey()) ?? null;
	}

	private setCachedUnifiedLocalReaderData(data: EpubReaderLocalDataFile): void {
		this.getUnifiedLocalDataCacheStore().set(this.getUnifiedLocalDataCacheKey(), data);
	}

	private async removeStoredCompatibilityFile(filePath: string): Promise<void> {
		const normalizedPath = normalizePath(filePath || "");
		if (!normalizedPath) {
			return;
		}

		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(normalizedPath))) {
			return;
		}

		try {
			await adapter.remove(normalizedPath);
		} catch (error) {
			logger.warn(`[EpubStorageService] Failed to remove compatibility file ${normalizedPath}:`, error);
		}
	}

	private normalizePluginUiMemory(value: unknown): EpubPluginUiMemory {
		return normalizePluginUiMemory(value);
	}

	private normalizeReadingPosition(value: unknown): ReadingPosition | undefined {
		return normalizeReadingPosition(value);
	}

	private normalizeReadingStats(value: unknown): ReadingStats | undefined {
		return normalizeReadingStats(value);
	}

	private normalizeBookState(
		value: unknown
	): Pick<EpubBook, "currentPosition" | "readingStats"> | null {
		return normalizeBookState(value);
	}

	private normalizeLastOpenBookmark(value: unknown): EpubLastOpenBookmark | null {
		return normalizeLastOpenBookmark(value);
	}

	private lastOpenBookmarkFromReadingState(
		state: EpubBookmarkReadingState | null | undefined,
		titleHint?: string
	): EpubLastOpenBookmark | null {
		const cfi = String(state?.currentPosition?.cfi || "").trim();
		if (!cfi) {
			return null;
		}

		const chapterIndex =
			typeof state?.currentPosition?.chapterIndex === "number"
				? state.currentPosition.chapterIndex
				: 0;
		const percent =
			typeof state?.currentPosition?.percent === "number" ? state.currentPosition.percent : 0;
		const savedAt =
			typeof state?.readingStats?.lastReadTime === "number" && state.readingStats.lastReadTime > 0
				? state.readingStats.lastReadTime
				: Date.now();
		const title =
			String(titleHint || "").trim() ||
			(chapterIndex > 0 ? `章节 ${chapterIndex}` : "阅读位置");

		return {
			chapterIndex,
			cfi,
			percent,
			title,
			preview: title,
			savedAt,
		};
	}

	private readingStateFromLastOpenBookmark(
		bookmark: EpubLastOpenBookmark,
		readingStats?: ReadingStats
	): EpubBookmarkReadingState {
		const savedAt = bookmark.savedAt > 0 ? bookmark.savedAt : Date.now();
		return {
			currentPosition: {
				chapterIndex: bookmark.chapterIndex,
				cfi: bookmark.cfi,
				percent: bookmark.percent,
			},
			readingStats: normalizeReadingPaceStats({
				...(readingStats || { totalReadTime: 0, lastReadTime: 0, createdTime: 0 }),
				lastReadTime: savedAt,
			}),
		};
	}

	private normalizeReadingReferencePoint(value: unknown): EpubReadingReferencePoint | null {
		return normalizeReadingReferencePoint(value);
	}

	private normalizeScanIndexEntries(value: unknown): EpubScanIndexEntry[] {
		return normalizeScanIndexEntries(value);
	}

	private normalizeBookshelfIndexEntries(value: unknown): EpubBookshelfIndexEntry[] {
		return normalizeBookshelfIndexEntries(value);
	}

	private normalizeBookshelfMembershipEntries(value: unknown): EpubBookshelfMembershipEntry[] {
		return normalizeBookshelfMembershipEntries(value);
	}

	private dedupeBookshelfMembershipEntries(
		entries: EpubBookshelfMembershipEntry[]
	): EpubBookshelfMembershipEntry[] {
		return dedupeBookshelfMembershipEntries(entries);
	}

	private normalizeLegacySourceIds(value: unknown, canonicalSourceId?: string): string[] | undefined {
		return normalizeLegacySourceIds(value, canonicalSourceId);
	}

	private normalizeSourceRegistryEntries(value: unknown): EpubSourceRegistryEntry[] {
		return normalizeSourceRegistryEntries(value);
	}

	private normalizeBookMetadata(value: unknown): BookMetadata | null {
		return normalizeBookMetadata(value);
	}

	private normalizeStoredBookDescriptor(value: unknown): EpubStoredBookDescriptor | null {
		return normalizeStoredBookDescriptor(value);
	}

	private toStoredBookDescriptor(book: EpubBook): EpubStoredBookDescriptor {
		return toStoredBookDescriptor(book);
	}

	private toBookFromDescriptor(
		descriptor: EpubStoredBookDescriptor,
		state?: Pick<EpubBook, "currentPosition" | "readingStats"> | null
	): EpubBook {
		return toBookFromDescriptor(descriptor, state);
	}

	private normalizeLegacyBook(value: unknown, fallbackId: string): EpubBook | null {
		return normalizeLegacyBook(value, fallbackId);
	}

	private hasRetainedLocalBookData(record: EpubReaderLocalBookRecord): boolean {
		return hasRetainedLocalBookData(record);
	}

	private normalizeLocalBookRecord(value: unknown): EpubReaderLocalBookRecord {
		return normalizeLocalBookRecord(value);
	}

	private async readBooksFromUnifiedLocalData(): Promise<{
		books: Record<string, EpubBook>;
		authoritative: boolean;
	}> {
		const unifiedData = await this.readUnifiedLocalReaderData();
		const books: Record<string, EpubBook> = {};
		for (const [bookId, record] of Object.entries(unifiedData.books || {})) {
			const descriptor = record.descriptor;
			if (!descriptor) {
				continue;
			}
			books[descriptor.id || bookId] = this.toBookFromDescriptor(descriptor, record.state);
		}
		return {
			books,
			authoritative: unifiedData.bookCatalogStoredLocally === true,
		};
	}

	private async readLegacyBooks(): Promise<Record<string, EpubBook>> {
		const adapter = this.app.vault.adapter;
		const currentBooksPath = `${this.basePath}/books.json`;
		for (const booksPath of this.getLegacyEpubBasePaths().map(
			(basePath) => `${basePath}/books.json`
		)) {
			if (!(await adapter.exists(booksPath))) {
				continue;
			}

			try {
				const content = await adapter.read(booksPath);
				if (booksPath !== currentBooksPath && !(await adapter.exists(currentBooksPath))) {
					await this.ensureSyncBaseDirectory();
					await adapter.write(currentBooksPath, content);
				}
				const parsed = JSON.parse(content) as Record<string, unknown>;
				const books: Record<string, EpubBook> = {};
				for (const [bookId, bookData] of Object.entries(parsed || {})) {
					const normalizedBook = this.normalizeLegacyBook(bookData, bookId);
					if (!normalizedBook) {
						continue;
					}
					books[normalizedBook.id || bookId] = normalizedBook;
				}
				return books;
			} catch (error) {
				logger.warn(`[EpubStorageService] Failed to parse books.json from ${booksPath}:`, error);
			}
		}

		return {};
	}

	private normalizeLocalReaderData(value: unknown): EpubReaderLocalDataFile {
		return normalizeLocalReaderData(value);
	}

	private async readUnifiedLocalReaderData(): Promise<EpubReaderLocalDataFile> {
		const cached = this.getCachedUnifiedLocalReaderData();
		if (cached) {
			return this.cloneLocalReaderData(cached);
		}

		const adapter = this.app.vault.adapter;
		let sourcePath: string | null = null;
		for (const candidatePath of [this.getUnifiedLocalDataPath(), ...this.getLegacyUnifiedLocalDataPaths()]) {
			if (await adapter.exists(candidatePath)) {
				sourcePath = candidatePath;
				break;
			}
		}
		if (!sourcePath) {
			const empty = this.createEmptyLocalReaderData();
			this.setCachedUnifiedLocalReaderData(empty);
			return this.cloneLocalReaderData(empty);
		}

		try {
			const content = await adapter.read(sourcePath);
			const parsed = this.normalizeLocalReaderData(JSON.parse(content));
			const { data: normalized, embeddedScanIndex } = peelEmbeddedScanIndexFromUnifiedData(parsed);
			if (embeddedScanIndex) {
				const cachedScanIndex = await this.readCachedScanIndex();
				if (cachedScanIndex === null) {
					await this.writeCachedScanIndex(embeddedScanIndex);
				}
			}
			this.setCachedUnifiedLocalReaderData(normalized);
			if (sourcePath !== this.getUnifiedLocalDataPath()) {
				await this.writeUnifiedLocalReaderData(normalized);
				await this.removeStoredCompatibilityFile(sourcePath);
			}
		} catch (error) {
			logger.warn("[EpubStorageService] Failed to parse epub local state file, retrying:", error);
			const recovered = await this.readUnifiedLocalReaderDataWithRetry(sourcePath);
			if (recovered) {
				this.setCachedUnifiedLocalReaderData(recovered);
			} else {
				logger.warn(
					"[EpubStorageService] Failed to recover epub local state file; falling back to empty snapshot for this session."
				);
				this.setCachedUnifiedLocalReaderData(this.createEmptyLocalReaderData());
			}
		}

		return this.cloneLocalReaderData(this.getCachedUnifiedLocalReaderData() ?? this.createEmptyLocalReaderData());
	}

	private async readUnifiedLocalReaderDataWithRetry(
		sourcePath: string
	): Promise<EpubReaderLocalDataFile | null> {
		const adapter = this.app.vault.adapter;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			if (attempt > 0) {
				await new Promise((resolve) =>
					window.setTimeout(resolve, UNIFIED_LOCAL_DATA_PARSE_RETRY_DELAY_MS)
				);
			}
			try {
				const content = await adapter.read(sourcePath);
				const parsed = this.normalizeLocalReaderData(JSON.parse(content));
				const { data: normalized, embeddedScanIndex } = peelEmbeddedScanIndexFromUnifiedData(parsed);
				if (embeddedScanIndex) {
					const cachedScanIndex = await this.readCachedScanIndex();
					if (cachedScanIndex === null) {
						await this.writeCachedScanIndex(embeddedScanIndex);
					}
				}
				return normalized;
			} catch {
				// Retry once for transient partial-write reads during startup.
			}
		}
		return null;
	}

	private async hasUnifiedLocalDataFile(): Promise<boolean> {
		if (await this.app.vault.adapter.exists(this.getUnifiedLocalDataPath())) {
			return true;
		}
		for (const legacyPath of this.getLegacyUnifiedLocalDataPaths()) {
			if (await this.app.vault.adapter.exists(legacyPath)) {
				return true;
			}
		}
		return false;
	}

	private async writeUnifiedLocalReaderData(data: EpubReaderLocalDataFile): Promise<void> {
		await this.ensureUnifiedLocalDataDirectory();
		const normalizedData = this.normalizeLocalReaderData({
			...data,
			version: 1,
			updatedAt: Date.now(),
		});
		const adapter = this.app.vault.adapter as typeof this.app.vault.adapter & {
			rename?: (oldPath: string, newPath: string) => Promise<void>;
		};
		const targetPath = this.getUnifiedLocalDataPath();
		const tempPath = `${targetPath}.tmp`;
		const serialized = JSON.stringify(normalizedData);

		if (typeof adapter.rename === "function") {
			await adapter.write(tempPath, serialized);
			try {
				await adapter.rename(tempPath, targetPath);
			} catch (error) {
				if (!this.isDestinationFileAlreadyExistsError(error)) {
					throw error;
				}
				// Some adapters reject overwrite-on-rename; safely fall back to direct write.
				await adapter.write(targetPath, serialized);
				if (typeof adapter.remove === "function") {
					try {
						await adapter.remove(tempPath);
					} catch {
						// noop
					}
				}
			}
		} else {
			await adapter.write(targetPath, serialized);
		}
		this.setCachedUnifiedLocalReaderData(normalizedData);
	}

	private isDestinationFileAlreadyExistsError(error: unknown): boolean {
		const message =
			typeof error === "object" && error && "message" in error
				? errorPlainText((error as { message?: unknown }).message)
				: errorPlainText(error);
		return /destination file already exists/i.test(message);
	}

	private async updateUnifiedLocalReaderData(
		updater: (data: EpubReaderLocalDataFile) => void
	): Promise<void> {
		const doWrite = async () => {
			const current = this.cloneLocalReaderData(await this.readUnifiedLocalReaderData());
			updater(current);
			await this.writeUnifiedLocalReaderData(current);
		};

		const nextLock = this.getUnifiedLocalDataWriteLock().then(doWrite, doWrite);
		this.setUnifiedLocalDataWriteLock(nextLock);
		await nextLock;
	}

	private resolveBookIdAlias(bookId: string): string {
		const normalizedBookId = String(bookId || "").trim();
		return this.bookIdAliasMap.get(normalizedBookId) || normalizedBookId;
	}

	private async resolveCanonicalBookId(bookId: string): Promise<string> {
		await this.ensureAutomaticDataMigrations();
		return this.resolveBookIdAlias(bookId);
	}

	private async ensureAutomaticDataMigrations(): Promise<void> {
		if (this.automaticMigrationCompleted) {
			return;
		}
		if (this.inflightAutomaticMigration) {
			await this.inflightAutomaticMigration;
			return;
		}

		const migrationPromise = (async () => {
			const inspection = await this.inspectLocalDataMigrationStatus();
			if (inspection.legacyFileCount > 0) {
				await this.migrateLegacyLocalData({ cleanupLegacyFiles: true });
			}
			await this.migrateUnifiedDataToCanonicalBookIdentities();
			await this.reconcileMissingBookshelfDescriptors();
			this._booksCache = null;
			this._booksCacheHydrated = false;
			this._booksCacheHydrationTask = null;
			this.automaticMigrationCompleted = true;
		})();

		this.inflightAutomaticMigration = migrationPromise;
		try {
			await migrationPromise;
		} finally {
			if (this.inflightAutomaticMigration === migrationPromise) {
				this.inflightAutomaticMigration = null;
			}
		}
	}

	private buildShelfOnlyBookFromScanEntry(entry: EpubScanIndexEntry): EpubBook {
		const filePath = normalizePath(entry.path || "");
		return {
			id: this.buildStableBookId({ filePath }),
			filePath,
			metadata: {
				title:
					String(entry.name || "").trim() ||
					stripSupportedBookExtension(filePath.split("/").pop() || "") ||
					"书籍",
				author: "",
				chapterCount: 0,
			},
			currentPosition: { chapterIndex: 0, cfi: "", percent: 0 },
			readingStats: { totalReadTime: 0, lastReadTime: 0, createdTime: 0 },
		};
	}

	private buildBookFromBookmarkSnapshot(snapshot: {
		bookPath: string;
		bookTitle?: string;
		bookAuthor?: string;
		bookId?: string;
		readingState?: EpubBookmarkReadingState | null;
	}): EpubBook {
		const filePath = normalizePath(snapshot.bookPath || "");
		const readingState = snapshot.readingState ?? null;
		return {
			id: this.buildStableBookId({
				sourceId:
					snapshot.bookId && !this.isEphemeralBookId(snapshot.bookId)
						? snapshot.bookId
						: undefined,
				filePath,
			}),
			filePath,
			metadata: {
				title:
					String(snapshot.bookTitle || "").trim() ||
					stripSupportedBookExtension(filePath.split("/").pop() || "") ||
					"书籍",
				author: String(snapshot.bookAuthor || "").trim() || "",
				chapterCount: 0,
			},
			currentPosition: readingState?.currentPosition ?? {
				chapterIndex: 0,
				cfi: "",
				percent: 0,
			},
			readingStats: readingState?.readingStats ?? {
				totalReadTime: 0,
				lastReadTime: 0,
				createdTime: 0,
			},
		};
	}

	private async reconcileMissingBookshelfDescriptors(): Promise<void> {
		const unifiedData = this.cloneLocalReaderData(await this.readUnifiedLocalReaderData());
		if (!unifiedData.bookCatalogStoredLocally) {
			return;
		}

		const membership = unifiedData.bookshelfMembership;
		if (!membership?.length) {
			return;
		}

		const descriptorPaths = new Set<string>();
		for (const record of Object.values(unifiedData.books || {})) {
			const filePath = record.descriptor?.filePath;
			if (filePath) {
				descriptorPaths.add(normalizePath(filePath));
			}
		}

		const reconciledBooks: EpubBook[] = [];
		for (const member of membership) {
			const memberPath = normalizePath(member.path || "");
			if (!memberPath || descriptorPaths.has(memberPath)) {
				continue;
			}
			const snapshot = await this.getBookmarkService().findBookmarkSnapshotByBookPath(memberPath);
			if (!snapshot) {
				continue;
			}
			reconciledBooks.push(this.buildBookFromBookmarkSnapshot(snapshot));
		}

		if (reconciledBooks.length === 0) {
			return;
		}

		await this.updateUnifiedLocalReaderData((localData) => {
			localData.books = localData.books || {};
			for (const book of reconciledBooks) {
				localData.books[book.id] = {
					...localData.books[book.id],
					descriptor: this.toStoredBookDescriptor(book),
					state: {
						currentPosition: book.currentPosition,
						readingStats: book.readingStats,
					},
				};
			}

			for (const [bookId, record] of Object.entries({ ...(localData.books || {}) })) {
				if (record.descriptor) {
					continue;
				}
				if (reconciledBooks.some((book) => book.id === bookId)) {
					continue;
				}
				delete localData.books[bookId];
			}
		});

		if (!this._booksCache) {
			this._booksCache = {};
		}
		for (const book of reconciledBooks) {
			this._booksCache[book.id] = book;
		}
	}

	private async migrateUnifiedDataToCanonicalBookIdentities(): Promise<void> {
		const initialUnifiedData = this.cloneLocalReaderData(await this.readUnifiedLocalReaderData());
		const initialBooks = initialUnifiedData.books || {};
		if (Object.keys(initialBooks).length === 0) {
			return;
		}

		const nextBooks: Record<string, EpubReaderLocalBookRecord> = {};
		const oldToNewBookIds = new Map<string, string>();
		let booksChanged = false;

		for (const [legacyBookId, record] of Object.entries(initialBooks)) {
			const descriptor = record.descriptor;
			if (!descriptor) {
				nextBooks[legacyBookId] = record;
				continue;
			}

			let nextDescriptor = { ...descriptor };
			const preferredSourceId = String(nextDescriptor.sourceFingerprint || "").trim()
				? this.generateSourceId(nextDescriptor.sourceFingerprint)
				: String(nextDescriptor.sourceId || "").trim() || undefined;
			const sourceEntry = await this.ensureSourceIdentity(nextDescriptor.filePath, {
				preferredSourceId,
				preferredSourceFingerprint: nextDescriptor.sourceFingerprint,
			});
			if (sourceEntry) {
				nextDescriptor = {
					...nextDescriptor,
					filePath: sourceEntry.filePath,
					sourceId: sourceEntry.sourceId,
					sourceFingerprint: sourceEntry.sourceFingerprint,
					fileFingerprint: sourceEntry.fileFingerprint,
					packageFingerprint: sourceEntry.packageFingerprint,
					contentFingerprint: sourceEntry.contentFingerprint,
					sourceSize: sourceEntry.sourceSize,
					sourceMtime: sourceEntry.sourceMtime,
				};
			} else if (preferredSourceId) {
				nextDescriptor = {
					...nextDescriptor,
					sourceId: preferredSourceId,
				};
			}

			const canonicalBookId = this.buildStableBookId({
				sourceId: nextDescriptor.sourceId,
				sourceFingerprint: nextDescriptor.sourceFingerprint,
				filePath: nextDescriptor.filePath,
			});
			nextDescriptor.id = canonicalBookId;

			const nextRecord: EpubReaderLocalBookRecord = {
				...record,
				descriptor: nextDescriptor,
			};
			nextBooks[canonicalBookId] = this.mergeLocalBookRecord(
				nextBooks[canonicalBookId],
				nextRecord
			);
			oldToNewBookIds.set(legacyBookId, canonicalBookId);
			this.bookIdAliasMap.set(legacyBookId, canonicalBookId);

			if (
				canonicalBookId !== legacyBookId ||
				nextDescriptor.id !== descriptor.id ||
				nextDescriptor.sourceId !== descriptor.sourceId ||
				nextDescriptor.sourceFingerprint !== descriptor.sourceFingerprint ||
				nextDescriptor.fileFingerprint !== descriptor.fileFingerprint ||
				nextDescriptor.packageFingerprint !== descriptor.packageFingerprint ||
				nextDescriptor.contentFingerprint !== descriptor.contentFingerprint ||
				nextDescriptor.filePath !== descriptor.filePath
			) {
				booksChanged = true;
			}
		}

		const latestUnifiedData = this.cloneLocalReaderData(await this.readUnifiedLocalReaderData());
		const nextUnifiedData: EpubReaderLocalDataFile = {
			...latestUnifiedData,
			books: nextBooks,
		};

		let changed = booksChanged;
		const remappedCanvasBindings = this.remapCanvasBindingsToCanonicalBookIds(
			nextUnifiedData.canvasBindings,
			oldToNewBookIds
		);
		if (this.haveCanvasBindingsChanged(nextUnifiedData.canvasBindings, remappedCanvasBindings)) {
			nextUnifiedData.canvasBindings = remappedCanvasBindings;
			changed = true;
		}

		const canonicalSourceRegistry = this.canonicalizeSourceRegistryEntries(
			nextUnifiedData.sourceRegistry
		);
		if (
			this.haveSourceRegistryEntriesChanged(
				nextUnifiedData.sourceRegistry,
				canonicalSourceRegistry
			)
		) {
			nextUnifiedData.sourceRegistry = canonicalSourceRegistry;
			changed = true;
		}

		if (changed) {
			nextUnifiedData.bookCatalogStoredLocally =
				Object.keys(nextUnifiedData.books || {}).length > 0
					? true
					: nextUnifiedData.bookCatalogStoredLocally;
			await this.writeUnifiedLocalReaderData(nextUnifiedData);
		}
	}

	private mergeLocalBookRecord(
		existing: EpubReaderLocalBookRecord | undefined,
		incoming: EpubReaderLocalBookRecord
	): EpubReaderLocalBookRecord {
		if (!existing) {
			return incoming;
		}

		const existingLastRead = existing.state?.readingStats?.lastReadTime ?? 0;
		const incomingLastRead = incoming.state?.readingStats?.lastReadTime ?? 0;
		const preferredState =
			incoming.state && incomingLastRead >= existingLastRead
				? incoming.state
				: existing.state || incoming.state;
		const existingSavedAt = existing.lastOpenBookmark?.savedAt ?? 0;
		const incomingSavedAt = incoming.lastOpenBookmark?.savedAt ?? 0;
		const preferredLastOpen =
			incoming.lastOpenBookmark && incomingSavedAt >= existingSavedAt
				? incoming.lastOpenBookmark
				: existing.lastOpenBookmark || incoming.lastOpenBookmark;
		const preferredConcealedTexts =
			(existing.concealedTexts || []).length >= (incoming.concealedTexts || []).length
				? existing.concealedTexts || incoming.concealedTexts
				: incoming.concealedTexts;

		return {
			descriptor: incoming.descriptor || existing.descriptor,
			state: preferredState,
			lastOpenBookmark: preferredLastOpen,
			readingReferencePoint:
				existing.readingReferencePoint || incoming.readingReferencePoint,
			concealedTexts: preferredConcealedTexts,
		};
	}

	private remapCanvasBindingsToCanonicalBookIds(
		bindings: Record<string, string> | undefined,
		oldToNewBookIds: Map<string, string>
	): Record<string, string> {
		const nextBindings: Record<string, string> = {};
		for (const [bookId, canvasPath] of Object.entries(bindings || {})) {
			const nextBookId = oldToNewBookIds.get(bookId) || bookId;
			if (!nextBookId || !canvasPath) {
				continue;
			}
			nextBindings[nextBookId] = normalizePath(unknownPlainText(canvasPath).trim());
		}
		return nextBindings;
	}

	private haveCanvasBindingsChanged(
		current: Record<string, string> | undefined,
		next: Record<string, string>
	): boolean {
		const currentEntries = Object.entries(current || {}).sort(([a], [b]) => a.localeCompare(b));
		const nextEntries = Object.entries(next).sort(([a], [b]) => a.localeCompare(b));
		return JSON.stringify(currentEntries) !== JSON.stringify(nextEntries);
	}

	private canonicalizeSourceRegistryEntries(
		entries: EpubSourceRegistryEntry[] | undefined
	): EpubSourceRegistryEntry[] {
		const merged = new Map<string, EpubSourceRegistryEntry>();
		for (const entry of entries || []) {
			const fileFingerprint = String(
				entry.fileFingerprint || entry.sourceFingerprint || ""
			).trim();
			const canonicalSourceId =
				fileFingerprint
					? this.generateSourceId(fileFingerprint)
					: String(entry.sourceId || "").trim();
			if (!canonicalSourceId) {
				continue;
			}

			const existing = merged.get(canonicalSourceId);
			const normalizedEntry: EpubSourceRegistryEntry = {
				...entry,
				sourceId: canonicalSourceId,
				sourceFingerprint: fileFingerprint || entry.sourceFingerprint,
				fileFingerprint: fileFingerprint || entry.fileFingerprint,
				legacySourceIds: this.normalizeLegacySourceIds(
					[
						...(entry.legacySourceIds || []),
						...(entry.sourceId !== canonicalSourceId ? [entry.sourceId] : []),
					],
					canonicalSourceId
				),
			};
			if (!existing) {
				merged.set(canonicalSourceId, normalizedEntry);
				continue;
			}

			merged.set(canonicalSourceId, {
				...existing,
				...normalizedEntry,
				filePath: existing.filePath || normalizedEntry.filePath,
				sourceFingerprint: existing.sourceFingerprint || normalizedEntry.sourceFingerprint,
				fileFingerprint: existing.fileFingerprint || normalizedEntry.fileFingerprint,
				packageFingerprint: existing.packageFingerprint || normalizedEntry.packageFingerprint,
				contentFingerprint: existing.contentFingerprint || normalizedEntry.contentFingerprint,
				legacySourceIds: this.normalizeLegacySourceIds(
					[
						...(existing.legacySourceIds || []),
						...(normalizedEntry.legacySourceIds || []),
					],
					canonicalSourceId
				),
				sourceSize: existing.sourceSize ?? normalizedEntry.sourceSize,
				sourceMtime: existing.sourceMtime ?? normalizedEntry.sourceMtime,
				lastSeenAt: Math.max(existing.lastSeenAt || 0, normalizedEntry.lastSeenAt || 0),
				lastKnownPath:
					String(normalizedEntry.lastKnownPath || "").trim() ||
					existing.lastKnownPath ||
					normalizedEntry.filePath ||
					existing.filePath,
			});
		}

		return Array.from(merged.values()).sort((left, right) =>
			left.sourceId.localeCompare(right.sourceId, "zh-CN")
		);
	}

	private haveSourceRegistryEntriesChanged(
		current: EpubSourceRegistryEntry[] | undefined,
		next: EpubSourceRegistryEntry[]
	): boolean {
		return JSON.stringify(current || []) !== JSON.stringify(next);
	}

	private async readCachedScanIndex(): Promise<EpubScanIndexEntry[] | null> {
		const indexPath = this.getScanIndexPath();
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(indexPath))) {
			return null;
		}

		try {
			const content = await adapter.read(indexPath);
			return this.parseScanIndexEntries(content);
		} catch (error) {
			logger.warn("[EpubStorageService] Failed to read epub-scan-index.json:", error);
			return null;
		}
	}

	private async writeCachedScanIndex(entries: EpubScanIndexEntry[]): Promise<void> {
		await this.ensureScanIndexDirectory();
		await this.app.vault.adapter.write(this.getScanIndexPath(), JSON.stringify(entries));
	}

	private async clearLegacyScanIndexFromLocalState(): Promise<void> {
		if (!(await this.hasUnifiedLocalDataFile())) {
			return;
		}
		await this.updateUnifiedLocalReaderData((localData) => {
			if (Object.prototype.hasOwnProperty.call(localData, "scanIndex")) {
				localData.scanIndex = undefined;
			}
		});
	}

	private parseBookshelfIndexEntries(content: string): EpubBookshelfIndexEntry[] {
		try {
			return this.normalizeBookshelfIndexEntries(JSON.parse(content));
		} catch (error) {
			logger.warn("[EpubStorageService] Failed to parse bookshelf-index.json:", error);
			return [];
		}
	}

	private parseScanIndexEntries(content: string): EpubScanIndexEntry[] {
		try {
			return this.normalizeScanIndexEntries(JSON.parse(content));
		} catch (error) {
			logger.warn("[EpubStorageService] Failed to parse epub-scan-index.json:", error);
			return [];
		}
	}

	private parseBookshelfMembershipEntries(content: string): EpubBookshelfMembershipEntry[] {
		try {
			return this.normalizeBookshelfMembershipEntries(JSON.parse(content));
		} catch (error) {
			logger.warn("[EpubStorageService] Failed to parse bookshelf-membership.json:", error);
			return [];
		}
	}

	private parseSourceRegistryEntries(content: string): EpubSourceRegistryEntry[] {
		try {
			return this.normalizeSourceRegistryEntries(JSON.parse(content));
		} catch (error) {
			logger.warn("[EpubStorageService] Failed to parse epub-source-registry.json:", error);
			return [];
		}
	}

	private async readStoredBookshelfIndex(): Promise<EpubBookshelfIndexEntry[] | null> {
		const indexPath = this.getBookshelfIndexPath();
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(indexPath))) {
			return null;
		}

		try {
			const content = await adapter.read(indexPath);
			return this.parseBookshelfIndexEntries(content);
		} catch (error) {
			logger.warn("[EpubStorageService] Failed to read bookshelf-index.json:", error);
			return null;
		}
	}

	private async readStoredScanIndex(): Promise<EpubScanIndexEntry[] | null> {
		const indexPath = this.getLegacyStoredScanIndexPath();
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(indexPath))) {
			return null;
		}

		try {
			const content = await adapter.read(indexPath);
			return this.parseScanIndexEntries(content);
		} catch (error) {
			logger.warn("[EpubStorageService] Failed to read epub-scan-index.json:", error);
			return null;
		}
	}

	private async readStoredBookshelfMembership(): Promise<EpubBookshelfMembershipEntry[] | null> {
		const membershipPath = this.getBookshelfMembershipPath();
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(membershipPath))) {
			return null;
		}

		try {
			const content = await adapter.read(membershipPath);
			return this.parseBookshelfMembershipEntries(content);
		} catch (error) {
			logger.warn("[EpubStorageService] Failed to read bookshelf-membership.json:", error);
			return null;
		}
	}

	private async readStoredSourceRegistry(): Promise<EpubSourceRegistryEntry[] | null> {
		const registryPath = this.getSourceRegistryPath();
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(registryPath))) {
			return null;
		}

		try {
			const content = await adapter.read(registryPath);
			return this.parseSourceRegistryEntries(content);
		} catch (error) {
			logger.warn("[EpubStorageService] Failed to read epub-source-registry.json:", error);
			return null;
		}
	}

	private async readJsonObjectFromPath(path: string): Promise<object | null> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(path))) {
			return null;
		}

		try {
			return JSON.parse(await adapter.read(path)) as object;
		} catch (error) {
			logger.warn(`[EpubStorageService] Failed to parse JSON from ${path}:`, error);
			return null;
		}
	}

	private async readLegacyBookState(
		bookId: string
	): Promise<Pick<EpubBook, "currentPosition" | "readingStats"> | null> {
		for (const statePath of [
			this.getBookStatePath(bookId),
			...this.getLegacyEpubBasePaths().map((basePath) => `${basePath}/${bookId}/state.json`),
		]) {
			const parsed = await this.readJsonObjectFromPath(statePath);
			const normalized = this.normalizeBookState(parsed);
			if (normalized) {
				return normalized;
			}
		}

		return null;
	}

	private async readLegacyLastOpenBookmark(bookId: string): Promise<EpubLastOpenBookmark | null> {
		for (const bookmarkPath of [
			this.getLastOpenBookmarkPath(bookId),
			...this.getLegacyEpubBasePaths().map(
				(basePath) => `${basePath}/${bookId}/last-open-bookmark.json`
			),
		]) {
			const parsed = await this.readJsonObjectFromPath(bookmarkPath);
			if (parsed == null) {
				continue;
			}
			return this.normalizeLastOpenBookmark(parsed);
		}

		return null;
	}

	private async readLegacyConcealedTexts(bookId: string): Promise<ConcealedText[] | null> {
		for (const concealedTextsPath of [
			this.getConcealedTextsPath(bookId),
			...this.getLegacyEpubBasePaths().map(
				(basePath) => `${basePath}/${bookId}/concealed-texts.json`
			),
		]) {
			const parsed = await this.readJsonObjectFromPath(concealedTextsPath);
			if (parsed == null) {
				continue;
			}
			return this.normalizeConcealedTexts(parsed);
		}

		return null;
	}

	private async readLegacyReaderSettings(
		deviceKind: EpubReaderSettingsDeviceKind
	): Promise<EpubReaderSettings | null> {
		const suffix = deviceKind === "mobile" ? "mobile" : "desktop";
		for (const settingsPath of [
			normalizePath(`${this.getLocalReaderStateRoot()}/reader-settings.${suffix}.json`),
			...this.getLegacyEpubBasePaths().map(
				(basePath) => `${basePath}/reader-settings.${suffix}.json`
			),
			...(deviceKind === this.getCurrentDeviceKind()
				? this.getLegacyEpubBasePaths().map((basePath) => `${basePath}/reader-settings.json`)
				: []),
		].filter(Boolean)) {
			const parsed = await this.readJsonObjectFromPath(settingsPath);
			if (parsed == null) {
				continue;
			}
			return this.normalizeReaderSettingsForDevice(
				deviceKind,
				parsed as Partial<EpubReaderSettings>
			);
		}

		return null;
	}

	private async readLegacyExcerptSettings(): Promise<EpubExcerptSettings | null> {
		for (const settingsPath of this.getLegacyEpubBasePaths().map(
			(basePath) => `${basePath}/excerpt-settings.json`
		)) {
			const parsed = await this.readJsonObjectFromPath(settingsPath);
			if (parsed == null) {
				continue;
			}
			return this.normalizeExcerptSettings(parsed);
		}
		return null;
	}

	private async readLegacyCanvasBindings(): Promise<Record<string, string> | null> {
		for (const bindingsPath of this.getLegacyEpubBasePaths().map(
			(basePath) => `${basePath}/canvas-bindings.json`
		)) {
			const parsed = await this.readJsonObjectFromPath(bindingsPath);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				continue;
			}

			const normalized = Object.fromEntries(
				Object.entries(parsed as Record<string, unknown>)
					.map(
						([bookId, canvasPath]) =>
							[String(bookId || "").trim(), normalizePath(unknownPlainText(canvasPath).trim())] as const
					)
					.filter(([bookId, canvasPath]) => Boolean(bookId) && Boolean(canvasPath))
			);
			if (Object.keys(normalized).length > 0) {
				return normalized;
			}
		}
		return null;
	}

	private buildBookshelfIndexEntriesFromBooks(
		books: Record<string, EpubBook>
	): EpubBookshelfIndexEntry[] {
		return Object.values(books).map((book) => {
			const file = this.app.vault.getAbstractFileByPath(book.filePath);
			const size = file instanceof TFile ? file.stat.size : 0;
			const normalizedPath = normalizePath(book.filePath || "");
			const slashIndex = normalizedPath.lastIndexOf("/");
			return {
				path: normalizedPath,
				name:
					stripSupportedBookExtension(normalizedPath.split("/").pop() || "") ||
					book.metadata.title ||
					"书籍",
				folder: slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) || "/" : "/",
				size,
				addedAt: typeof book.readingStats?.createdTime === "number" ? book.readingStats.createdTime : 0,
			};
		});
	}

	private buildMembershipEntriesFromLegacyData(
		books: Record<string, EpubBook>,
		legacyIndexEntries: EpubBookshelfIndexEntry[]
	): EpubBookshelfMembershipEntry[] {
		const now = Date.now();
		const legacyIndexEntryMap = new Map(
			legacyIndexEntries.map((entry) => [normalizePath(entry.path || ""), entry] as const)
		);
		return Array.from(
			new Set(
				[
					...Object.values(books).map((book) => normalizePath(book.filePath || "")),
					...legacyIndexEntries.map((entry) => normalizePath(entry.path || "")),
				].filter(Boolean)
			)
		)
			.map((path, index) => ({
				path,
				addedAt: legacyIndexEntryMap.get(path)?.addedAt || now + index,
			}))
			.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
	}

	private toBookshelfIndexEntry(
		entry: EpubScanIndexEntry,
		addedAt = 0,
		customCoverPath?: string
	): EpubBookshelfIndexEntry {
		return {
			path: entry.path,
			name: entry.name,
			folder: entry.folder,
			size: entry.size,
			addedAt,
			customCoverPath,
		};
	}

	private isEpubPath(filePath: string): boolean {
		const normalizedPath = normalizePath(filePath || "");
		return isSupportedBookPath(normalizedPath);
	}

	private isEpubFile(file: TAbstractFile | null | undefined): boolean {
		return isSupportedBookFile(file);
	}

	private isPathWithinFolder(filePath: string, folderPath: string): boolean {
		if (!folderPath) {
			return true;
		}

		const normalizedFilePath = normalizePath(filePath || "");
		return normalizedFilePath.startsWith(`${folderPath}/`);
	}

	private normalizeScanFolderScope(folderPath?: string): string {
		const rawFolderPath = String(folderPath || "").trim();
		if (!rawFolderPath || rawFolderPath === "/" || rawFolderPath === ".") {
			return "";
		}

		const normalizedFolderPath = normalizePath(rawFolderPath);
		if (!normalizedFolderPath || normalizedFolderPath === "/" || normalizedFolderPath === ".") {
			return "";
		}

		return normalizedFolderPath;
	}

	private filterBookshelfEntriesByFolder<T extends { path: string }>(
		entries: T[],
		folderPath: string
	): T[] {
		return entries.filter((entry) => this.isPathWithinFolder(entry.path, folderPath));
	}

	private collectEpubPathsFromVaultIndex(folderPath?: string): string[] {
		const normalizedFolder = this.normalizeScanFolderScope(folderPath);

		return this.app.vault
			.getFiles()
			.filter(
				(file) =>
					this.isEpubFile(file) &&
					isVisibleVaultBookPath(file.path, this.app.vault.configDir) &&
					this.isPathWithinFolder(file.path, normalizedFolder)
			)
			.map((file) => normalizePath(file.path));
	}

	private async createScanIndexEntryFromPath(filePath: string): Promise<EpubScanIndexEntry> {
		const resolvedFile = resolveSupportedBookFile(this.app, filePath);
		const normalizedPath = resolvedFile?.path || normalizePath(filePath || "");
		const file = resolvedFile || this.app.vault.getAbstractFileByPath(normalizedPath);
		const slashIndex = normalizedPath.lastIndexOf("/");

		let size = file instanceof TFile ? file.stat.size : 0;
		let mtime = file instanceof TFile ? file.stat.mtime : 0;

		if (
			(size === 0 || mtime === 0) &&
			typeof (
				this.app.vault.adapter as {
					stat?: (path: string) => Promise<{ size?: number; mtime?: number }>;
				}
			).stat === "function"
		) {
			try {
				const stat = await (
					this.app.vault.adapter as {
						stat: (path: string) => Promise<{ size?: number; mtime?: number }>;
					}
				).stat(normalizedPath);
				if (typeof stat?.size === "number") {
					size = stat.size;
				}
				if (typeof stat?.mtime === "number") {
					mtime = stat.mtime;
				}
			} catch {
				// noop
			}
		}

		return {
			path: normalizedPath,
			name:
				file instanceof TFile
					? file.basename
					: stripSupportedBookExtension(normalizedPath.split("/").pop() || "") || "书籍",
			folder:
				file instanceof TFile
					? file.parent?.path || "/"
					: slashIndex >= 0
					? normalizedPath.slice(0, slashIndex) || "/"
					: "/",
			size,
			mtime,
		};
	}

	private async scanVaultBookshelfEntries(folderPath?: string): Promise<EpubScanIndexEntry[]> {
		const pathSet = new Set<string>(this.collectEpubPathsFromVaultIndex(folderPath));

		const canonicalPaths = new Set<string>();
		for (const path of pathSet) {
			const canonicalPath = this.resolveSupportedBookFilePath(path);
			if (canonicalPath) {
				canonicalPaths.add(canonicalPath);
			}
		}

		const entries = await Promise.all(
			Array.from(canonicalPaths).map((path) => this.createScanIndexEntryFromPath(path))
		);

		return entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
	}

	private areBookshelfEntryListsEqual(
		left: EpubScanIndexEntry[],
		right: EpubScanIndexEntry[]
	): boolean {
		if (left.length !== right.length) {
			return false;
		}

		return left.every((entry, index) => {
			const other = right[index];
			return (
				entry.path === other?.path &&
				entry.name === other.name &&
				entry.folder === other.folder &&
				entry.size === other.size &&
				entry.mtime === other.mtime
			);
		});
	}

	private async syncFolderBookshelfIndex(
		folderPath: string,
		entries: EpubScanIndexEntry[],
		existingEntries?: EpubScanIndexEntry[]
	): Promise<void> {
		const normalizedFolder = this.normalizeScanFolderScope(folderPath);
		if (!normalizedFolder) {
			await this.saveScanIndex(entries);
			return;
		}

		const baseEntries = existingEntries ?? (await this.loadScanIndex());
		const nextEntries = baseEntries
			.filter((entry) => !this.isPathWithinFolder(entry.path, normalizedFolder))
			.concat(entries)
			.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

		await this.saveScanIndex(nextEntries);
	}

	private async hasExistingEpubFile(filePath: string): Promise<boolean> {
		return this.resolveSupportedBookFilePath(filePath) !== null;
	}

	private isBookshelfMemberPath(
		filePath: string,
		membership: EpubBookshelfMembershipEntry[]
	): boolean {
		const canonicalPath = this.resolveSupportedBookFilePath(filePath);
		if (!canonicalPath) {
			return false;
		}
		return membership.some((entry) => epubVaultPathsReferToSameBook(entry.path, canonicalPath));
	}

	resolveSupportedBookFilePath(filePath: string): string | null {
		return resolveCanonicalSupportedBookFilePath(this.app, filePath);
	}

	async isBookshelfSourceMissing(filePath: string): Promise<boolean> {
		if (this.resolveSupportedBookFilePath(filePath)) {
			return false;
		}
		const normalizedPath = normalizePath(filePath || "");
		if (!normalizedPath || !this.isEpubPath(normalizedPath)) {
			return true;
		}
		const adapter = this.app.vault.adapter as { exists?: (path: string) => Promise<boolean> };
		if (typeof adapter.exists !== "function") {
			return true;
		}
		try {
			return !(await adapter.exists(normalizedPath));
		} catch {
			return true;
		}
	}

	private async filterExistingBookshelfEntries(
		entries: EpubScanIndexEntry[]
	): Promise<EpubScanIndexEntry[]> {
		const visibleEntries = entries.filter((entry) =>
			isVisibleVaultBookPath(entry.path, this.app.vault.configDir)
		);
		const results = await Promise.all(
			visibleEntries.map(async (entry) => ({
				entry,
				exists: await this.hasExistingEpubFile(entry.path),
			}))
		);

		return results.filter((item) => item.exists).map((item) => item.entry);
	}

	private async getMutableBookshelfIndexEntries(): Promise<EpubScanIndexEntry[]> {
		const cachedEntries = await this.readCachedScanIndex();
		if (cachedEntries !== null) {
			return cachedEntries;
		}
		const unifiedData = await this.readUnifiedLocalReaderData();
		if (Array.isArray(unifiedData.scanIndex)) {
			return unifiedData.scanIndex;
		}
		const storedEntries = await this.readStoredScanIndex();
		if (storedEntries !== null) {
			return storedEntries;
		}
		const books = await this.loadBooks({ hydrateStates: false });
		return this.buildBookshelfIndexEntriesFromBooks(books).map((entry) => ({
			...entry,
			mtime: 0,
		}));
	}

	private async readBookState(
		bookId: string
	): Promise<Pick<EpubBook, "currentPosition" | "readingStats"> | null> {
		bookId = await this.resolveCanonicalBookId(bookId);
		const book = await this.getBook(bookId);
		if (book) {
			try {
				const fromBookmark = await this.getBookmarkService().readReadingState(book);
				if (fromBookmark) {
					return fromBookmark;
				}
			} catch (error) {
				logger.warn("[EpubStorageService] Failed to read reading state from bookmark file:", error);
			}
		}

		const fromUnified = await this.readUnifiedBookState(bookId);
		const fromLegacy = fromUnified ?? (await this.readLegacyBookState(bookId));
		if (fromLegacy && book) {
			try {
				await this.getBookmarkService().writeReadingState(book, fromLegacy);
			} catch (error) {
				logger.warn(
					"[EpubStorageService] Failed to migrate reading state into bookmark file:",
					error
				);
			}
		}
		return fromLegacy;
	}

	private async readUnifiedBookState(
		bookId: string
	): Promise<Pick<EpubBook, "currentPosition" | "readingStats"> | null> {
		const unifiedData = await this.readUnifiedLocalReaderData();
		const bookRecord = unifiedData.books?.[bookId];
		if (bookRecord && Object.prototype.hasOwnProperty.call(bookRecord, "state")) {
			const state = bookRecord.state;
			if (!state) {
				return null;
			}
			return {
				currentPosition: state.currentPosition ?? { chapterIndex: 0, cfi: "", percent: 0 },
				readingStats: state.readingStats ?? { totalReadTime: 0, lastReadTime: 0, createdTime: 0 },
			};
		}
		return null;
	}

	private async writeBookState(
		bookId: string,
		data: Pick<EpubBook, "currentPosition" | "readingStats">
	): Promise<void> {
		bookId = await this.resolveCanonicalBookId(bookId);
		const previous = this._bookStateWriteLocks.get(bookId) || Promise.resolve();
		const persist = async () => {
			const book = await this.getBook(bookId);
			const normalizedStats = normalizeReadingPaceStats(data.readingStats);
			const payload = {
				currentPosition: data.currentPosition,
				readingStats: normalizedStats,
			};

			if (book) {
				try {
					await this.getBookmarkService().writeReadingState(book, payload);
					await this.clearUnifiedBookState(bookId);
					await this.clearUnifiedLastOpenBookmark(bookId);
					return;
				} catch (error) {
					logger.warn(
						"[EpubStorageService] Failed to write reading state to bookmark file, falling back to local JSON:",
						error
					);
				}
			}

			await this.writeUnifiedBookState(bookId, payload);
		};
		const next = previous.then(persist, persist);
		this._bookStateWriteLocks.set(bookId, next);
		await next;
	}

	private async writeUnifiedBookState(
		bookId: string,
		data: Pick<EpubBook, "currentPosition" | "readingStats">
	): Promise<void> {
		await this.updateUnifiedLocalReaderData((localData) => {
			localData.books = localData.books || {};
			const current = localData.books[bookId] || {};
			localData.books[bookId] = {
				...current,
				state: {
					currentPosition: data.currentPosition,
					readingStats: data.readingStats,
				},
			};
		});
	}

	private async clearUnifiedBookState(bookId: string): Promise<void> {
		await this.updateUnifiedLocalReaderData((localData) => {
			const current = localData.books?.[bookId];
			if (!current) {
				return;
			}
			const nextRecord = { ...current };
			nextRecord.state = undefined;
			if (this.hasRetainedLocalBookData(nextRecord)) {
				localData.books = localData.books || {};
				localData.books[bookId] = nextRecord;
				return;
			}
			if (localData.books) {
				delete localData.books[bookId];
			}
		});
	}

	private async readUnifiedLastOpenBookmark(bookId: string): Promise<EpubLastOpenBookmark | null> {
		const unifiedData = await this.readUnifiedLocalReaderData();
		const bookRecord = unifiedData.books?.[bookId];
		if (
			(await this.hasUnifiedLocalDataFile()) &&
			bookRecord &&
			Object.prototype.hasOwnProperty.call(bookRecord, "lastOpenBookmark")
		) {
			return bookRecord.lastOpenBookmark ?? null;
		}
		return null;
	}

	private async clearUnifiedLastOpenBookmark(bookId: string): Promise<void> {
		await this.updateUnifiedLocalReaderData((localData) => {
			const current = localData.books?.[bookId];
			if (!current || !Object.prototype.hasOwnProperty.call(current, "lastOpenBookmark")) {
				return;
			}
			const nextRecord = { ...current };
			delete nextRecord.lastOpenBookmark;
			if (this.hasRetainedLocalBookData(nextRecord)) {
				localData.books = localData.books || {};
				localData.books[bookId] = nextRecord;
				return;
			}
			if (localData.books) {
				delete localData.books[bookId];
			}
		});
	}

	private async migrateLastOpenBookmarkToBookmarkFile(
		book: EpubBook,
		bookmark: EpubLastOpenBookmark
	): Promise<void> {
		const normalized = this.normalizeLastOpenBookmark(bookmark);
		if (!normalized?.cfi) {
			return;
		}

		const existing = await this.getBookmarkService().readReadingState(book);
		if (existing?.currentPosition?.cfi) {
			await this.clearUnifiedLastOpenBookmark(book.id);
			return;
		}

		const payload = this.readingStateFromLastOpenBookmark(normalized, book.readingStats);
		try {
			await this.getBookmarkService().writeReadingState(book, payload);
			book.currentPosition = payload.currentPosition;
			book.readingStats = payload.readingStats;
			await this.clearUnifiedBookState(book.id);
			await this.clearUnifiedLastOpenBookmark(book.id);
		} catch (error) {
			logger.warn(
				"[EpubStorageService] Failed to migrate last-open bookmark into bookmark file:",
				error
			);
		}
	}

	async hydrateBookState(bookId: string): Promise<void> {
		const books = await this.loadBooks({ hydrateStates: false });
		const normalizedBookId = this.resolveBookIdAlias(await this.resolveCanonicalBookId(bookId));
		const book = books[normalizedBookId];
		if (!book) {
			return;
		}

		const state = await this.readBookState(book.id);
		if (!state) {
			return;
		}

		book.currentPosition = state.currentPosition ?? book.currentPosition;
		book.readingStats = state.readingStats ?? book.readingStats;
	}

	private applyUnifiedBookStateFromRecord(
		book: EpubBook,
		record: EpubReaderLocalBookRecord | undefined
	): boolean {
		if (!record || !Object.prototype.hasOwnProperty.call(record, "state")) {
			return false;
		}

		const state = record.state;
		if (!state) {
			return true;
		}

		book.currentPosition = state.currentPosition ?? book.currentPosition;
		book.readingStats = state.readingStats ?? book.readingStats;
		return true;
	}

	private async hydrateBookStates(books: Record<string, EpubBook>): Promise<void> {
		const unifiedData = await this.readUnifiedLocalReaderData();
		const deferredBookmarkHydration: EpubBook[] = [];

		for (const book of Object.values(books)) {
			const canonicalBookId = this.resolveBookIdAlias(book.id);
			if (this.applyUnifiedBookStateFromRecord(book, unifiedData.books?.[canonicalBookId])) {
				continue;
			}
			deferredBookmarkHydration.push(book);
		}

		if (deferredBookmarkHydration.length === 0) {
			return;
		}

		await Promise.all(
			deferredBookmarkHydration.map(async (book) => {
				const state = await this.readBookState(book.id);
				if (!state) {
					return;
				}
				book.currentPosition = state.currentPosition ?? book.currentPosition;
				book.readingStats = state.readingStats ?? book.readingStats;
			})
		);
	}

	async saveBooks(books: Record<string, EpubBook>): Promise<void> {
		await this.writeBooksWithLock(books);
	}

	async saveBook(book: EpubBook, options: { ensureOnBookshelf?: boolean } = {}): Promise<void> {
		await this.ensureAutomaticDataMigrations();
		const sourceEntry = await this.ensureSourceIdentity(book.filePath, {
			preferredSourceId: book.sourceId,
			preferredSourceFingerprint: book.sourceFingerprint,
		});
		if (sourceEntry) {
			book.sourceId = sourceEntry.sourceId;
			book.sourceFingerprint = sourceEntry.sourceFingerprint;
			book.fileFingerprint = sourceEntry.fileFingerprint;
			book.packageFingerprint = sourceEntry.packageFingerprint;
			book.contentFingerprint = sourceEntry.contentFingerprint;
			book.sourceSize = sourceEntry.sourceSize;
			book.sourceMtime = sourceEntry.sourceMtime;
			book.filePath = sourceEntry.filePath;
		}

		const books = await this.loadBooks();
		const existingBook =
			(sourceEntry?.sourceId
				? this.findBookInCollectionBySourceId(books, sourceEntry.sourceId)
				: null) ||
			(sourceEntry?.sourceFingerprint
				? this.findBookInCollectionByFingerprint(books, sourceEntry.sourceFingerprint)
				: null) ||
			this.findBookInCollectionByFilePath(books, book.filePath);
		if (existingBook?.id) {
			book.id = existingBook.id;
		} else if (!String(book.id || "").trim() || this.isEphemeralBookId(book.id)) {
			book.id = this.buildStableBookId({
				sourceId: sourceEntry?.sourceId || book.sourceId,
				sourceFingerprint: sourceEntry?.sourceFingerprint || book.sourceFingerprint,
				filePath: book.filePath,
			});
		}
		books[book.id] = book;
		await this.writeBooksWithLock(books);
		await this.upsertScanIndexEntry(book.filePath);
		if (options.ensureOnBookshelf) {
			await this.addBooksToBookshelf([book.filePath]);
		}
	}

	async loadScanIndex(): Promise<EpubScanIndexEntry[]> {
		await this.ensureAutomaticDataMigrations();
		const unifiedData = await this.readUnifiedLocalReaderData();
		let entries = await this.readCachedScanIndex();

		if (entries === null && Array.isArray(unifiedData.scanIndex)) {
			entries = unifiedData.scanIndex;
			await this.writeCachedScanIndex(entries);
			await this.clearLegacyScanIndexFromLocalState();
		}

		if (entries === null) {
			const legacyStoredEntries = await this.readStoredScanIndex();
			if (legacyStoredEntries !== null) {
				entries = legacyStoredEntries;
				await this.saveScanIndex(entries);
			}
		}

		if (entries === null) {
			const legacyEntries = await this.readStoredBookshelfIndex();
			if (legacyEntries !== null) {
				entries = legacyEntries.map((entry) => ({ ...entry, mtime: 0 }));
				await this.saveScanIndex(entries);
			} else {
				const books = await this.loadBooks({ hydrateStates: false });
				entries = this.buildBookshelfIndexEntriesFromBooks(books).map((entry) => ({
					...entry,
					mtime: 0,
				}));
				if (entries.length > 0) {
					await this.saveScanIndex(entries);
				}
			}
		}

		const filteredEntries = await this.filterExistingBookshelfEntries(entries);
		if (filteredEntries.length !== entries.length) {
			await this.saveScanIndex(filteredEntries);
		}
		return filteredEntries;
	}

	async loadBookshelfIndex(): Promise<EpubBookshelfIndexEntry[]> {
		const entries = await this.loadScanIndex();
		return entries.map((entry) => this.toBookshelfIndexEntry(entry));
	}

	async saveScanIndex(entries: EpubScanIndexEntry[]): Promise<void> {
		const normalizedEntries = Array.from(
			new Map(
				entries
					.map((entry) => ({
						path: normalizePath(entry.path || ""),
						name: entry.name,
						folder: entry.folder,
						size: entry.size,
						mtime: typeof entry.mtime === "number" ? entry.mtime : 0,
						coverImage:
							typeof entry.coverImage === "string" && entry.coverImage.trim()
								? entry.coverImage.trim()
								: undefined,
					}))
					.filter((entry) => entry.path)
					.map((entry) => [entry.path, entry] as const)
			).values()
		).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
		await this.writeCachedScanIndex(normalizedEntries);
		await this.clearLegacyScanIndexFromLocalState();
		await this.removeStoredCompatibilityFile(this.getLegacyStoredScanIndexPath());
	}

	async cacheBookshelfCoverImage(
		filePath: string,
		coverImage: string | null | undefined
	): Promise<void> {
		const normalizedPath = normalizePath(filePath || "");
		if (!normalizedPath) {
			return;
		}

		const normalizedCover =
			typeof coverImage === "string" && coverImage.trim() ? coverImage.trim() : undefined;
		const scanEntries = await this.loadScanIndex();
		const existingIndex = scanEntries.findIndex((entry) => entry.path === normalizedPath);
		if (existingIndex < 0) {
			return;
		}

		if (scanEntries[existingIndex].coverImage === normalizedCover) {
			return;
		}

		scanEntries[existingIndex] = {
			...scanEntries[existingIndex],
			coverImage: normalizedCover,
		};
		await this.saveScanIndex(scanEntries);
	}

	async saveBookshelfIndex(entries: EpubBookshelfIndexEntry[]): Promise<void> {
		await this.saveScanIndex(entries.map((entry) => ({ ...entry, mtime: 0 })));
	}

	async scanVaultBooks(): Promise<EpubScanIndexEntry[]> {
		const entries = await this.scanVaultBookshelfEntries();
		await this.saveScanIndex(entries);
		return entries;
	}

	async scanVaultEpubs(): Promise<EpubScanIndexEntry[]> {
		return this.scanVaultBooks();
	}

	async rebuildBookshelfIndex(folderPath?: string): Promise<EpubBookshelfIndexEntry[]> {
		const normalizedFolder = this.normalizeScanFolderScope(folderPath);
		const entries = await this.scanVaultBookshelfEntries(normalizedFolder);

		await this.syncFolderBookshelfIndex(normalizedFolder, entries);
		return entries.map((entry) => this.toBookshelfIndexEntry(entry));
	}

	async loadBookshelfEntriesForFolder(folderPath: string): Promise<EpubBookshelfIndexEntry[]> {
		const normalizedFolder = this.normalizeScanFolderScope(folderPath);
		if (!normalizedFolder) {
			return [];
		}

		const cachedEntries = await this.loadScanIndex();
		const filteredCachedEntries = this.filterBookshelfEntriesByFolder(
			cachedEntries,
			normalizedFolder
		);
		const liveEntries = await this.scanVaultBookshelfEntries(normalizedFolder);

		if (!this.areBookshelfEntryListsEqual(filteredCachedEntries, liveEntries)) {
			await this.syncFolderBookshelfIndex(normalizedFolder, liveEntries, cachedEntries);
		}

		return liveEntries.map((entry) => this.toBookshelfIndexEntry(entry));
	}

	private async upsertScanIndexEntry(filePath: string): Promise<void> {
		const normalizedFilePath = normalizePath(filePath || "");
		if (!normalizedFilePath) return;

		const file = this.app.vault.getAbstractFileByPath(normalizedFilePath);
		if (!(file instanceof TFile) || !this.isEpubFile(file)) return;

		const entries = await this.getMutableBookshelfIndexEntries();
		const nextEntry = {
			path: file.path,
			name: file.basename,
			folder: file.parent?.path || "/",
			size: file.stat.size,
			mtime: file.stat.mtime,
			addedAt: 0,
		};
		const existingIndex = entries.findIndex((entry) => entry.path === normalizedFilePath);
		if (existingIndex >= 0) {
			entries[existingIndex] = nextEntry;
		} else {
			entries.push(nextEntry);
			entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
		}
		await this.saveScanIndex(entries);
	}

	private async removeScanIndexEntry(filePath: string): Promise<boolean> {
		const normalizedFilePath = normalizePath(filePath || "");
		if (!normalizedFilePath) {
			return false;
		}

		const entries = await this.getMutableBookshelfIndexEntries();
		const nextEntries = entries.filter((entry) => entry.path !== normalizedFilePath);
		if (nextEntries.length === entries.length) {
			return false;
		}

		await this.saveScanIndex(nextEntries);
		return true;
	}

	async getBook(bookId: string): Promise<EpubBook | null> {
		const books = await this.loadBooks({ hydrateStates: false });
		const normalizedBookId = this.resolveBookIdAlias(bookId);
		return books[normalizedBookId] || null;
	}

	async loadBookshelfMembership(): Promise<EpubBookshelfMembershipEntry[]> {
		await this.ensureAutomaticDataMigrations();
		const unifiedData = await this.readUnifiedLocalReaderData();
		const hasUnifiedData = await this.hasUnifiedLocalDataFile();
		let entries =
			hasUnifiedData && Array.isArray(unifiedData.bookshelfMembership)
				? unifiedData.bookshelfMembership
				: await this.readStoredBookshelfMembership();

		if (entries === null) {
			const books = await this.loadBooks({ hydrateStates: false });
			const legacyEntries =
				(await this.readStoredBookshelfIndex()) ?? this.buildBookshelfIndexEntriesFromBooks(books);
			entries = this.buildMembershipEntriesFromLegacyData(books, legacyEntries);
			if (entries.length > 0) {
				await this.saveBookshelfMembership(entries);
			}
		}

		const normalizedEntries = this.normalizeBookshelfMembershipEntries(entries);
		const dedupedEntries = this.dedupeBookshelfMembershipEntries(normalizedEntries);

		if (dedupedEntries.length !== normalizedEntries.length) {
			await this.saveBookshelfMembership(dedupedEntries);
		}

		return dedupedEntries;
	}

	async saveBookshelfMembership(entries: EpubBookshelfMembershipEntry[]): Promise<void> {
		const normalizedEntries = this.normalizeBookshelfMembershipEntries(entries);
		await this.updateUnifiedLocalReaderData((localData) => {
			localData.bookshelfMembership = normalizedEntries;
		});
		await this.removeStoredCompatibilityFile(this.getBookshelfMembershipPath());
	}

	async loadBookshelfPlaylists(): Promise<EpubBookshelfPlaylist[]> {
		await this.ensureAutomaticDataMigrations();
		const unifiedData = await this.readUnifiedLocalReaderData();
		const playlists = normalizeBookshelfPlaylists(unifiedData.bookshelfPlaylists);
		const membership = await this.loadBookshelfMembership();
		const validPaths = new Set(membership.map((entry) => entry.path));
		const pruned = playlists.map((playlist) => pruneBookshelfPlaylistPaths(playlist, validPaths));
		const changed = pruned.some(
			(playlist, index) => playlist.bookPaths.length !== playlists[index]?.bookPaths.length
		);
		if (changed) {
			await this.saveBookshelfPlaylists(pruned);
		}
		return sortBookshelfPlaylists(pruned);
	}

	async saveBookshelfPlaylists(playlists: EpubBookshelfPlaylist[]): Promise<void> {
		const normalized = sortBookshelfPlaylists(normalizeBookshelfPlaylists(playlists));
		await this.updateUnifiedLocalReaderData((localData) => {
			localData.bookshelfPlaylists = normalized;
		});
	}

	async createBookshelfPlaylist(name: string, bookPaths: string[] = []): Promise<EpubBookshelfPlaylist> {
		const trimmedName = String(name || "").trim();
		if (!trimmedName) {
			throw new Error("Playlist name is required");
		}
		const now = Date.now();
		const playlist: EpubBookshelfPlaylist = {
			id: createBookshelfPlaylistId(),
			name: trimmedName,
			bookPaths: normalizeBookshelfPlaylistBookPaths(bookPaths),
			createdAt: now,
			updatedAt: now,
		};
		const playlists = await this.loadBookshelfPlaylists();
		playlists.push(playlist);
		await this.saveBookshelfPlaylists(playlists);
		return playlist;
	}

	async renameBookshelfPlaylist(playlistId: string, name: string): Promise<EpubBookshelfPlaylist | null> {
		const trimmedName = String(name || "").trim();
		if (!trimmedName) {
			return null;
		}
		const playlists = await this.loadBookshelfPlaylists();
		const index = playlists.findIndex((playlist) => playlist.id === playlistId);
		if (index < 0) {
			return null;
		}
		const nextPlaylist = {
			...playlists[index],
			name: trimmedName,
			updatedAt: Date.now(),
		};
		playlists[index] = nextPlaylist;
		await this.saveBookshelfPlaylists(playlists);
		return nextPlaylist;
	}

	async addBookToBookshelfPlaylist(playlistId: string, bookPath: string): Promise<EpubBookshelfPlaylist | null> {
		const normalizedPath = normalizePath(String(bookPath || "").trim());
		if (!normalizedPath) {
			return null;
		}
		const membership = await this.loadBookshelfMembership();
		if (!this.isBookshelfMemberPath(normalizedPath, membership)) {
			return null;
		}
		const playlists = await this.loadBookshelfPlaylists();
		const index = playlists.findIndex((playlist) => playlist.id === playlistId);
		if (index < 0) {
			return null;
		}
		const playlist = playlists[index];
		if (playlist.bookPaths.includes(normalizedPath)) {
			return playlist;
		}
		const nextPlaylist: EpubBookshelfPlaylist = {
			...playlist,
			bookPaths: [...playlist.bookPaths, normalizedPath],
			updatedAt: Date.now(),
		};
		playlists[index] = nextPlaylist;
		await this.saveBookshelfPlaylists(playlists);
		return nextPlaylist;
	}

	async removeBookFromBookshelfPlaylist(
		playlistId: string,
		bookPath: string
	): Promise<EpubBookshelfPlaylist | null> {
		const normalizedPath = normalizePath(String(bookPath || "").trim());
		const playlists = await this.loadBookshelfPlaylists();
		const index = playlists.findIndex((playlist) => playlist.id === playlistId);
		if (index < 0) {
			return null;
		}
		const playlist = playlists[index];
		const nextPaths = playlist.bookPaths.filter((path) => path !== normalizedPath);
		if (nextPaths.length === playlist.bookPaths.length) {
			return playlist;
		}
		const nextPlaylist: EpubBookshelfPlaylist = {
			...playlist,
			bookPaths: nextPaths,
			updatedAt: Date.now(),
		};
		playlists[index] = nextPlaylist;
		await this.saveBookshelfPlaylists(playlists);
		return nextPlaylist;
	}

	async deleteBookshelfPlaylist(playlistId: string): Promise<boolean> {
		const playlists = await this.loadBookshelfPlaylists();
		const nextPlaylists = playlists.filter((playlist) => playlist.id !== playlistId);
		if (nextPlaylists.length === playlists.length) {
			return false;
		}
		await this.saveBookshelfPlaylists(nextPlaylists);
		return true;
	}

	async loadSourceRegistry(): Promise<EpubSourceRegistryEntry[]> {
		const unifiedData = await this.readUnifiedLocalReaderData();
		if ((await this.hasUnifiedLocalDataFile()) && Array.isArray(unifiedData.sourceRegistry)) {
			return unifiedData.sourceRegistry;
		}

		const entries = await this.readStoredSourceRegistry();
		return entries ?? [];
	}

	async saveSourceRegistry(entries: EpubSourceRegistryEntry[]): Promise<void> {
		const normalizedEntries = this.normalizeSourceRegistryEntries(entries);
		await this.updateUnifiedLocalReaderData((localData) => {
			localData.sourceRegistry = normalizedEntries;
		});
	}

	private generateSourceId(sourceFingerprint?: string): string {
		const normalizedFingerprint = String(sourceFingerprint || "").trim().toLowerCase();
		if (normalizedFingerprint) {
			return `epubsrc-${normalizedFingerprint.slice(0, 24)}`;
		}
		return `epubsrc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
	}

	private buildStableBookId(input: {
		sourceId?: string;
		sourceFingerprint?: string;
		filePath?: string;
	}): string {
		const seed =
			String(input.sourceId || "").trim() ||
			String(input.sourceFingerprint || "").trim() ||
			normalizePath(String(input.filePath || "").trim()) ||
			"epub-book";
		return `epub-book-${this.hashString(seed)}`;
	}

	private isEphemeralBookId(bookId?: string): boolean {
		const normalizedBookId = String(bookId || "").trim();
		return /^epub-[0-9a-z]+$/i.test(normalizedBookId);
	}

	private hashString(input: string): string {
		let hash = 2166136261;
		for (let index = 0; index < input.length; index += 1) {
			hash ^= input.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		return (hash >>> 0).toString(36);
	}

	private normalizeFingerprint(value: unknown): string {
		return String(value || "").trim().toLowerCase();
	}

	private isPlainRecord(value: unknown): value is Record<string, unknown> {
		return Boolean(value && typeof value === "object" && !Array.isArray(value));
	}

	private getPortableIndexPath(): string {
		return normalizePath(`${getEpubPortableDataRoot()}/index.json`);
	}

	private getPortableBookDir(bookId: string): string {
		return normalizePath(`${getEpubPortableDataRoot()}/books/${safeEpubSemanticBookId(bookId)}`);
	}

	private getPortableBookFingerprints(value: unknown): PartialEpubFingerprints {
		if (!this.isPlainRecord(value)) {
			return {};
		}
		return {
			...(this.normalizeFingerprint(value.fileFingerprint || value.sourceFingerprint)
				? { fileFingerprint: this.normalizeFingerprint(value.fileFingerprint || value.sourceFingerprint) }
				: {}),
			...(this.normalizeFingerprint(value.packageFingerprint)
				? { packageFingerprint: this.normalizeFingerprint(value.packageFingerprint) }
				: {}),
			...(this.normalizeFingerprint(value.contentFingerprint)
				? { contentFingerprint: this.normalizeFingerprint(value.contentFingerprint) }
				: {}),
		};
	}

	private portableRecordMatchesSource(
		value: unknown,
		sourceEntry: EpubSourceRegistryEntry | null | undefined,
		filePath: string
	): boolean {
		if (!this.isPlainRecord(value)) {
			return false;
		}
		const normalizedPath = normalizePath(filePath || "");
		const sourceFileFingerprint = this.normalizeFingerprint(
			sourceEntry?.fileFingerprint || sourceEntry?.sourceFingerprint
		);
		const recordFingerprints = this.getPortableBookFingerprints(value);
		if (sourceFileFingerprint) {
			return this.normalizeFingerprint(recordFingerprints.fileFingerprint) === sourceFileFingerprint;
		}
		if (sourceEntry?.sourceId && String(value.sourceId || "").trim() === sourceEntry.sourceId) {
			return true;
		}
		if (normalizePath(String(value.filePath || "")) === normalizedPath) {
			return true;
		}
		return Array.isArray(value.knownPaths)
			? value.knownPaths.some((entry) => normalizePath(String(entry || "")) === normalizedPath)
			: false;
	}

	private getPortableSourceIdentityKey(
		sourceEntry: EpubSourceRegistryEntry | null | undefined
	): string {
		const fileFingerprint = this.normalizeFingerprint(
			sourceEntry?.fileFingerprint || sourceEntry?.sourceFingerprint
		);
		if (fileFingerprint) {
			return `file:${fileFingerprint}`;
		}
		const packageFingerprint = this.normalizeFingerprint(sourceEntry?.packageFingerprint);
		const contentFingerprint = this.normalizeFingerprint(sourceEntry?.contentFingerprint);
		if (packageFingerprint && contentFingerprint) {
			return `content:${packageFingerprint}:${contentFingerprint}`;
		}
		const sourceId = String(sourceEntry?.sourceId || "").trim();
		return sourceId ? `source:${sourceId}` : "";
	}

	private getPortableRecordIdentityKey(value: unknown): string {
		if (!this.isPlainRecord(value)) {
			return "";
		}
		const fingerprints = this.getPortableBookFingerprints(value);
		const fileFingerprint = this.normalizeFingerprint(fingerprints.fileFingerprint);
		if (fileFingerprint) {
			return `file:${fileFingerprint}`;
		}
		const packageFingerprint = this.normalizeFingerprint(fingerprints.packageFingerprint);
		const contentFingerprint = this.normalizeFingerprint(fingerprints.contentFingerprint);
		if (packageFingerprint && contentFingerprint) {
			return `content:${packageFingerprint}:${contentFingerprint}`;
		}
		const sourceId = String(value.sourceId || "").trim();
		return sourceId ? `source:${sourceId}` : "";
	}

	private findPortableBookIdsInIndex(
		index: Record<string, unknown>,
		sourceEntry: EpubSourceRegistryEntry | null | undefined,
		filePath: string
	): string[] {
		const books = this.isPlainRecord(index.books) ? index.books : {};
		const identityKey = this.getPortableSourceIdentityKey(sourceEntry);
		const matches: string[] = [];
		for (const [fallbackBookId, value] of Object.entries(books)) {
			if (identityKey) {
				if (this.getPortableRecordIdentityKey(value) !== identityKey) {
					continue;
				}
			} else if (!this.portableRecordMatchesSource(value, sourceEntry, filePath)) {
				continue;
			}
			const bookId = this.isPlainRecord(value) ? value.bookId || fallbackBookId : fallbackBookId;
			const safeBookId = safeEpubSemanticBookId(bookId);
			if (safeBookId && !matches.includes(safeBookId)) {
				matches.push(safeBookId);
			}
		}
		return matches;
	}

	private getPortableKnownPathsFromRecord(value: unknown): string[] {
		if (!this.isPlainRecord(value)) {
			return [];
		}
		return [
			normalizePath(String(value.filePath || "")),
			...(Array.isArray(value.knownPaths)
				? value.knownPaths.map((entry) => normalizePath(String(entry || "")))
				: []),
		].filter(Boolean);
	}

	private async scorePortableBookIdForCanonicalChoice(
		bookId: string,
		value: unknown,
		normalizedPath: string
	): Promise<number> {
		const safeBookId = safeEpubSemanticBookId(bookId);
		if (!safeBookId) {
			return -1;
		}
		let score = 0;
		if (this.getPortableKnownPathsFromRecord(value).includes(normalizedPath)) {
			score += 20;
		}
		if (this.isPlainRecord(value)) {
			if (this.normalizeFingerprint(value.fileFingerprint || value.sourceFingerprint)) {
				score += 5;
			}
			if (String(value.title || value.displayTitle || "").trim()) {
				score += 1;
			}
		}

		const adapter = this.app.vault.adapter;
		const bookDir = this.getPortableBookDir(safeBookId);
		if (!(await adapter.exists(bookDir))) {
			return score;
		}
		score += 10;
		const importantFiles = [
			"annotations.json",
			"annotations.md",
			"active-version.json",
			"bookmarks.json",
			"reading-state.json",
			"semantic-profile.json",
			"stats.json",
			"user.json",
		];
		for (const fileName of importantFiles) {
			if (await adapter.exists(normalizePath(`${bookDir}/${fileName}`))) {
				score += fileName.startsWith("annotations") ? 100 : 30;
			}
		}
		if (await adapter.exists(normalizePath(`${bookDir}/versions`))) {
			score += 120;
		}
		return score;
	}

	private async chooseCanonicalPortableBookId(
		candidateBookIds: string[],
		books: Record<string, unknown>,
		normalizedPath: string
	): Promise<string> {
		if (candidateBookIds.length === 0) {
			return "";
		}
		let bestBookId = "";
		let bestScore = Number.NEGATIVE_INFINITY;
		for (const bookId of candidateBookIds) {
			const score = await this.scorePortableBookIdForCanonicalChoice(
				bookId,
				books[bookId],
				normalizedPath
			);
			if (score > bestScore) {
				bestBookId = bookId;
				bestScore = score;
			}
		}
		return bestBookId ? safeEpubSemanticBookId(bestBookId) : "";
	}

	private async copyPortableBookFiles(
		sourceDir: string,
		targetDir: string,
		options: { overwrite?: boolean; skipBookJson?: boolean } = {}
	): Promise<void> {
		const adapter = this.app.vault.adapter as typeof this.app.vault.adapter & {
			list?: (path: string) => Promise<{ files?: string[]; folders?: string[] }>;
			read?: (path: string) => Promise<string>;
			write?: (path: string, data: string) => Promise<void>;
		};
		if (
			typeof adapter.list !== "function" ||
			typeof adapter.read !== "function" ||
			typeof adapter.write !== "function"
		) {
			return;
		}
		const normalizedSourceDir = normalizePath(sourceDir);
		const normalizedTargetDir = normalizePath(targetDir);
		if (!normalizedSourceDir || !normalizedTargetDir || !(await adapter.exists(normalizedSourceDir))) {
			return;
		}

		const visit = async (dir: string): Promise<void> => {
			const listing = await adapter.list!(dir);
			for (const filePath of listing.files || []) {
				const normalizedFilePath = normalizePath(filePath);
				const relativePath = normalizePath(normalizedFilePath.slice(normalizedSourceDir.length + 1));
				if (!relativePath || (options.skipBookJson && relativePath === "book.json")) {
					continue;
				}
				const targetPath = normalizePath(`${normalizedTargetDir}/${relativePath}`);
				if (!options.overwrite && (await adapter.exists(targetPath))) {
					continue;
				}
				await DirectoryUtils.ensureDirForFile(adapter, targetPath);
				await adapter.write(targetPath, await adapter.read(normalizedFilePath));
			}
			for (const folderPath of listing.folders || []) {
				await visit(normalizePath(folderPath));
			}
		};
		await visit(normalizedSourceDir);
	}

	private async mergeDuplicatePortableBookData(
		targetBookId: string,
		duplicateBookIds: string[]
	): Promise<void> {
		const safeTargetBookId = safeEpubSemanticBookId(targetBookId);
		const safeDuplicateBookIds = Array.from(
			new Set(duplicateBookIds.map((id) => safeEpubSemanticBookId(id)).filter(Boolean))
		).filter((id) => id !== safeTargetBookId);
		if (!safeTargetBookId || safeDuplicateBookIds.length === 0) {
			return;
		}

		const adapter = this.app.vault.adapter;
		const targetDir = this.getPortableBookDir(safeTargetBookId);
		const backupRoot = normalizePath(
			`${getEpubPortableDataRoot()}/backups/duplicate-bookids-${Date.now().toString(36)}`
		);
		for (const duplicateBookId of safeDuplicateBookIds) {
			const duplicateDir = this.getPortableBookDir(duplicateBookId);
			if (!(await adapter.exists(duplicateDir))) {
				continue;
			}
			await this.copyPortableBookFiles(
				duplicateDir,
				normalizePath(`${backupRoot}/${duplicateBookId}`),
				{ overwrite: true }
			);
			await this.copyPortableBookFiles(duplicateDir, targetDir, {
				overwrite: false,
				skipBookJson: true,
			});
			if (typeof adapter.rmdir === "function") {
				await adapter.rmdir(duplicateDir, true);
			}
		}
	}

	private async readPortableIndex(): Promise<Record<string, unknown>> {
		const current = await readEpubSemanticJson(this.app, this.getPortableIndexPath());
		return this.isPlainRecord(current) ? current : {};
	}

	private findPortableBookIdInIndex(
		index: Record<string, unknown>,
		sourceEntry: EpubSourceRegistryEntry | null | undefined,
		filePath: string
	): string {
		return this.findPortableBookIdsInIndex(index, sourceEntry, filePath)[0] || "";
	}

	private async findPortableBookIdForPath(filePath: string): Promise<string> {
		const normalizedPath = normalizePath(filePath || "");
		if (!normalizedPath) {
			return "";
		}
		const sourceEntry = await this.ensureSourceIdentity(normalizedPath);
		const index = await this.readPortableIndex();
		return this.findPortableBookIdInIndex(index, sourceEntry, normalizedPath);
	}

	private buildBookFromScanEntryAndSource(
		scanEntry: EpubScanIndexEntry,
		sourceEntry: EpubSourceRegistryEntry | null | undefined,
		bookId: string
	): EpubBook {
		const book = this.buildShelfOnlyBookFromScanEntry(scanEntry);
		book.id = safeEpubSemanticBookId(bookId);
		book.sourceId = sourceEntry?.sourceId;
		book.sourceFingerprint = sourceEntry?.sourceFingerprint;
		book.fileFingerprint = sourceEntry?.fileFingerprint;
		book.packageFingerprint = sourceEntry?.packageFingerprint;
		book.contentFingerprint = sourceEntry?.contentFingerprint;
		book.sourceSize = sourceEntry?.sourceSize;
		book.sourceMtime = sourceEntry?.sourceMtime;
		return book;
	}

	private async ensureLocalBookDescriptorForBookshelfPath(
		scanEntry: EpubScanIndexEntry,
		sourceEntry: EpubSourceRegistryEntry | null | undefined,
		bookId: string,
		duplicateBookIds: string[] = []
	): Promise<void> {
		const book = this.buildBookFromScanEntryAndSource(scanEntry, sourceEntry, bookId);
		await this.updateUnifiedLocalReaderData((localData) => {
			const books = { ...(localData.books || {}) };
			const sourceFingerprint = this.normalizeFingerprint(
				sourceEntry?.fileFingerprint || sourceEntry?.sourceFingerprint || book.fileFingerprint || book.sourceFingerprint
			);
			const duplicates = new Set(
				duplicateBookIds
					.map((id) => safeEpubSemanticBookId(id))
					.filter((id) => id && id !== book.id)
			);
			if (sourceFingerprint) {
				for (const [candidateBookId, record] of Object.entries(books)) {
					if (candidateBookId === book.id || !this.isPlainRecord(record)) {
						continue;
					}
					const descriptor = this.isPlainRecord(record.descriptor) ? record.descriptor : null;
					const descriptorFingerprint = this.normalizeFingerprint(
						descriptor?.fileFingerprint || descriptor?.sourceFingerprint
					);
					if (descriptorFingerprint === sourceFingerprint) {
						duplicates.add(candidateBookId);
					}
				}
			}
			let mergedRecord = this.isPlainRecord(books[book.id])
				? (books[book.id] as EpubReaderLocalBookRecord)
				: undefined;
			for (const duplicateBookId of duplicates) {
				const duplicateRecord = this.isPlainRecord(books[duplicateBookId])
					? (books[duplicateBookId] as EpubReaderLocalBookRecord)
					: undefined;
				if (duplicateRecord) {
					mergedRecord = this.mergeLocalBookRecord(mergedRecord, duplicateRecord);
				}
				delete books[duplicateBookId];
				this.bookIdAliasMap.set(duplicateBookId, book.id);
			}
			books[book.id] = {
				...(mergedRecord || {}),
				descriptor: this.toStoredBookDescriptor(book),
			};
			localData.bookCatalogStoredLocally = true;
			localData.books = books;
		});
		if (!this._booksCache) {
			this._booksCache = {};
		}
		this._booksCache[book.id] = book;
		for (const duplicateBookId of duplicateBookIds) {
			delete this._booksCache[duplicateBookId];
			this.bookIdAliasMap.set(duplicateBookId, book.id);
		}
	}

	private async ensurePortableBookDataForBookshelfPath(
		scanEntry: EpubScanIndexEntry,
		sourceEntry: EpubSourceRegistryEntry | null | undefined
	): Promise<string | null> {
		const normalizedPath = normalizePath(scanEntry.path || "");
		if (!normalizedPath) {
			return null;
		}

		const currentIndex = await this.readPortableIndex();
		const currentBooks = this.isPlainRecord(currentIndex.books) ? currentIndex.books : {};
		const matchingBookIds = this.findPortableBookIdsInIndex(currentIndex, sourceEntry, normalizedPath);
		const existingBookId = await this.chooseCanonicalPortableBookId(
			matchingBookIds,
			currentBooks,
			normalizedPath
		);
		const bookId = safeEpubSemanticBookId(
			existingBookId ||
				this.buildStableBookId({
					sourceId: sourceEntry?.sourceId,
					sourceFingerprint: sourceEntry?.sourceFingerprint || sourceEntry?.fileFingerprint,
					filePath: normalizedPath,
				})
		);
		const duplicateBookIds = matchingBookIds.filter((candidateBookId) => candidateBookId !== bookId);
		const previous = this.isPlainRecord(currentBooks[bookId]) ? currentBooks[bookId] : {};
		const previousKnownPaths = [
			...this.getPortableKnownPathsFromRecord(previous),
			...duplicateBookIds.flatMap((duplicateBookId) =>
				this.getPortableKnownPathsFromRecord(currentBooks[duplicateBookId])
			),
		];
		const knownPaths = Array.from(
			new Set([...previousKnownPaths, normalizedPath].map((entry) => normalizePath(String(entry || ""))).filter(Boolean))
		);
		const title =
			String(previous.title || previous.displayTitle || "").trim() ||
			String(scanEntry.name || "").trim() ||
			stripSupportedBookExtension(normalizedPath.split("/").pop() || "") ||
			"书籍";
		const fingerprints = this.getPortableBookFingerprints({
			...previous,
			sourceFingerprint: sourceEntry?.sourceFingerprint,
			fileFingerprint: sourceEntry?.fileFingerprint || sourceEntry?.sourceFingerprint,
			packageFingerprint: sourceEntry?.packageFingerprint,
			contentFingerprint: sourceEntry?.contentFingerprint,
		});
		const nextBook = {
			...previous,
			format: "weave-reader-book/v1",
			version: 1,
			bookId,
			filePath: normalizedPath,
			knownPaths,
			sourceId: sourceEntry?.sourceId || String(previous.sourceId || "").trim() || undefined,
			sourceFingerprint: fingerprints.fileFingerprint || undefined,
			fileFingerprint: fingerprints.fileFingerprint || undefined,
			packageFingerprint: fingerprints.packageFingerprint || undefined,
			contentFingerprint: fingerprints.contentFingerprint || undefined,
			sourceSize: sourceEntry?.sourceSize ?? previous.sourceSize,
			sourceMtime: sourceEntry?.sourceMtime ?? previous.sourceMtime,
			title,
			displayTitle: String(previous.displayTitle || "").trim() || title,
			updatedAt: Date.now(),
		};
		const nextBooks: Record<string, unknown> = {};
		const duplicateBookIdSet = new Set(duplicateBookIds);
		for (const [candidateBookId, value] of Object.entries(currentBooks)) {
			if (candidateBookId === bookId || duplicateBookIdSet.has(candidateBookId)) {
				continue;
			}
			if (!this.isPlainRecord(value)) {
				nextBooks[candidateBookId] = value;
				continue;
			}
			const candidateKnownPaths = Array.isArray(value.knownPaths) ? value.knownPaths : [];
			const filteredKnownPaths = candidateKnownPaths
				.map((entry) => normalizePath(String(entry || "")))
				.filter((entry) => entry && entry !== normalizedPath);
			nextBooks[candidateBookId] = {
				...value,
				...(filteredKnownPaths.length !== candidateKnownPaths.length
					? { knownPaths: Array.from(new Set(filteredKnownPaths)) }
					: {}),
				...(normalizePath(String(value.filePath || "")) === normalizedPath && filteredKnownPaths[0]
					? { filePath: filteredKnownPaths[0] }
					: {}),
			};
		}
		nextBooks[bookId] = nextBook;

		await writeEpubSemanticJson(this.app, this.getPortableIndexPath(), {
			...currentIndex,
			format: "weave-reader-epub-data-index/v1",
			version: 1,
			updatedAt: Date.now(),
			books: nextBooks,
		});
		await writeEpubSemanticJson(this.app, getEpubPortableBookPath(bookId, "book.json"), nextBook);
		await this.mergeDuplicatePortableBookData(bookId, duplicateBookIds);
		await this.ensureLocalBookDescriptorForBookshelfPath(
			scanEntry,
			sourceEntry,
			bookId,
			duplicateBookIds
		);
		return bookId;
	}

	private async removePortableBookData(bookId: string): Promise<void> {
		const safeBookId = safeEpubSemanticBookId(bookId);
		if (!safeBookId) {
			return;
		}
		const currentIndex = await this.readPortableIndex();
		if (this.isPlainRecord(currentIndex.books)) {
			const nextBooks = { ...currentIndex.books };
			delete nextBooks[safeBookId];
			await writeEpubSemanticJson(this.app, this.getPortableIndexPath(), {
				...currentIndex,
				format: "weave-reader-epub-data-index/v1",
				version: 1,
				updatedAt: Date.now(),
				books: nextBooks,
			});
		}

		const adapter = this.app.vault.adapter;
		const bookDir = this.getPortableBookDir(safeBookId);
		if (await adapter.exists(bookDir)) {
			await adapter.rmdir(bookDir, true);
		}
	}

	private sourceFingerprintsMatch(
		entry: EpubSourceRegistryEntry | undefined,
		fingerprints: PartialEpubFingerprints
	): boolean {
		if (!entry) {
			return false;
		}
		const fileFingerprint = this.normalizeFingerprint(fingerprints.fileFingerprint);
		const packageFingerprint = this.normalizeFingerprint(fingerprints.packageFingerprint);
		const contentFingerprint = this.normalizeFingerprint(fingerprints.contentFingerprint);
		if (
			fileFingerprint &&
			this.normalizeFingerprint(entry.fileFingerprint || entry.sourceFingerprint) !== fileFingerprint
		) {
			return false;
		}
		if (
			packageFingerprint &&
			this.normalizeFingerprint(entry.packageFingerprint) !== packageFingerprint
		) {
			return false;
		}
		if (
			contentFingerprint &&
			this.normalizeFingerprint(entry.contentFingerprint) !== contentFingerprint
		) {
			return false;
		}
		return true;
	}

	private async computeSourceFingerprints(filePath: string): Promise<PartialEpubFingerprints> {
		const normalizedPath = normalizePath(filePath || "");
		if (!normalizedPath) {
			return {};
		}

		const adapter = this.app.vault.adapter as {
			readBinary?: (path: string) => Promise<ArrayBuffer | Uint8Array>;
		};
		if (typeof adapter.readBinary !== "function" || typeof crypto?.subtle?.digest !== "function") {
			return {};
		}

		try {
			const binary = await adapter.readBinary(normalizedPath);
			return await computeAvailableEpubFingerprints(binary);
		} catch (error) {
			logger.debug("[EpubStorageService] Failed to compute book source fingerprints:", {
				filePath: normalizedPath,
				error,
			});
			return {};
		}
	}

	private async buildSourceRegistryEntry(
		filePath: string,
		sourceId: string,
		fingerprints: PartialEpubFingerprints = {},
		legacySourceIds?: string[]
	): Promise<EpubSourceRegistryEntry | null> {
		const normalizedPath = normalizePath(filePath || "");
		if (!normalizedPath || !(await this.hasExistingEpubFile(normalizedPath))) {
			return null;
		}

		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
		const now = Date.now();
		let sourceSize = file instanceof TFile ? file.stat.size : undefined;
		let sourceMtime = file instanceof TFile ? file.stat.mtime : undefined;

		if (
			(sourceSize === undefined || sourceMtime === undefined) &&
			typeof (
				this.app.vault.adapter as {
					stat?: (path: string) => Promise<{ size?: number; mtime?: number }>;
				}
			).stat === "function"
		) {
			try {
				const stat = await (
					this.app.vault.adapter as {
						stat: (path: string) => Promise<{ size?: number; mtime?: number }>;
					}
				).stat(normalizedPath);
				if (sourceSize === undefined && typeof stat?.size === "number") {
					sourceSize = stat.size;
				}
				if (sourceMtime === undefined && typeof stat?.mtime === "number") {
					sourceMtime = stat.mtime;
				}
			} catch {
				// noop
			}
		}

		const fileFingerprint = this.normalizeFingerprint(fingerprints.fileFingerprint);
		const packageFingerprint = this.normalizeFingerprint(fingerprints.packageFingerprint);
		const contentFingerprint = this.normalizeFingerprint(fingerprints.contentFingerprint);
		return {
			sourceId,
			filePath: normalizedPath,
			sourceFingerprint: fileFingerprint || undefined,
			fileFingerprint: fileFingerprint || undefined,
			packageFingerprint: packageFingerprint || undefined,
			contentFingerprint: contentFingerprint || undefined,
			legacySourceIds: this.normalizeLegacySourceIds(legacySourceIds, sourceId),
			sourceSize,
			sourceMtime,
			lastSeenAt: now,
			lastKnownPath: normalizedPath,
		};
	}

	private async getExistingEpubFileStat(
		filePath: string
	): Promise<{ size?: number; mtime?: number } | null> {
		const normalizedPath = normalizePath(filePath || "");
		if (!normalizedPath || !(await this.hasExistingEpubFile(normalizedPath))) {
			return null;
		}

		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
		let size = file instanceof TFile ? file.stat.size : undefined;
		let mtime = file instanceof TFile ? file.stat.mtime : undefined;

		if (
			(size === undefined || mtime === undefined) &&
			typeof (
				this.app.vault.adapter as {
					stat?: (path: string) => Promise<{ size?: number; mtime?: number }>;
				}
			).stat === "function"
		) {
			try {
				const stat = await (
					this.app.vault.adapter as {
						stat: (path: string) => Promise<{ size?: number; mtime?: number }>;
					}
				).stat(normalizedPath);
				if (size === undefined && typeof stat?.size === "number") {
					size = stat.size;
				}
				if (mtime === undefined && typeof stat?.mtime === "number") {
					mtime = stat.mtime;
				}
			} catch {
				// noop
			}
		}

		return { size, mtime };
	}

	async ensureSourceIdentity(
		filePath: string,
		options: {
			preferredSourceId?: string;
			preferredSourceFingerprint?: string;
			preferredFileFingerprint?: string;
			preferredPackageFingerprint?: string;
			preferredContentFingerprint?: string;
		} = {}
	): Promise<EpubSourceRegistryEntry | null> {
		const normalizedPath = normalizePath(filePath || "");
		if (!normalizedPath || !(await this.hasExistingEpubFile(normalizedPath))) {
			return null;
		}

		const registry = await this.loadSourceRegistry();
		const byPath = registry.find((entry) => entry.filePath === normalizedPath);
		const currentStat = await this.getExistingEpubFileStat(normalizedPath);
		const preferredSourceFingerprint = String(
			options.preferredFileFingerprint || options.preferredSourceFingerprint || ""
		).trim().toLowerCase();
		const computedFingerprints = await this.computeSourceFingerprints(normalizedPath);
		const fingerprints: PartialEpubFingerprints = {
			fileFingerprint:
				preferredSourceFingerprint ||
				this.normalizeFingerprint(computedFingerprints.fileFingerprint) ||
				undefined,
			packageFingerprint:
				this.normalizeFingerprint(options.preferredPackageFingerprint) ||
				this.normalizeFingerprint(computedFingerprints.packageFingerprint) ||
				undefined,
			contentFingerprint:
				this.normalizeFingerprint(options.preferredContentFingerprint) ||
				this.normalizeFingerprint(computedFingerprints.contentFingerprint) ||
				undefined,
		};
		const sourceFingerprint = fingerprints.fileFingerprint;
		const canonicalSourceId = sourceFingerprint
			? this.generateSourceId(sourceFingerprint)
			: undefined;
		const byCanonicalId = canonicalSourceId
			? registry.find((entry) => entry.sourceId === canonicalSourceId)
			: undefined;
		const byPreferredId = options.preferredSourceId
			? registry.find((entry) => entry.sourceId === options.preferredSourceId)
			: undefined;
		const matchesCurrentStat = (entry?: EpubSourceRegistryEntry): boolean =>
			Boolean(
				entry &&
					currentStat &&
					entry.filePath === normalizedPath &&
					entry.sourceSize === currentStat.size &&
					entry.sourceMtime === currentStat.mtime &&
					this.sourceFingerprintsMatch(entry, fingerprints)
			);

		if (matchesCurrentStat(byCanonicalId)) {
			return byCanonicalId || null;
		}

		if (
			matchesCurrentStat(byPreferredId) &&
			(!canonicalSourceId || byPreferredId?.sourceId === canonicalSourceId)
		) {
			return byPreferredId || null;
		}

		if (
			matchesCurrentStat(byPath) &&
			(!canonicalSourceId || byPath?.sourceId === canonicalSourceId)
		) {
			return byPath || null;
		}
		const byFingerprint = sourceFingerprint
			? registry.find(
					(entry) =>
						this.normalizeFingerprint(entry.sourceFingerprint || entry.fileFingerprint) ===
						sourceFingerprint
			  )
			: undefined;

		const target = byCanonicalId || byFingerprint || byPreferredId || byPath;
		const preserveExistingSourceId =
			Boolean(target?.sourceId) &&
			!preferredSourceFingerprint &&
			!String(target?.sourceFingerprint || "").trim();
		const sourceId = preserveExistingSourceId
			? String(target?.sourceId || "").trim()
			: canonicalSourceId || target?.sourceId || this.generateSourceId();
		const legacySourceIds = this.normalizeLegacySourceIds(
			[
				...(target?.legacySourceIds || []),
				...(target?.sourceId && target.sourceId !== sourceId ? [target.sourceId] : []),
			],
			sourceId
		);
		const nextEntry = await this.buildSourceRegistryEntry(
			normalizedPath,
			sourceId,
			fingerprints,
			legacySourceIds
		);
		if (!nextEntry) {
			return null;
		}

		const unchanged =
			target &&
			target.sourceId === nextEntry.sourceId &&
			target.filePath === nextEntry.filePath &&
			target.sourceFingerprint === nextEntry.sourceFingerprint &&
			target.fileFingerprint === nextEntry.fileFingerprint &&
			target.packageFingerprint === nextEntry.packageFingerprint &&
			target.contentFingerprint === nextEntry.contentFingerprint &&
			JSON.stringify(target.legacySourceIds || []) ===
				JSON.stringify(nextEntry.legacySourceIds || []) &&
			target.sourceSize === nextEntry.sourceSize &&
			target.sourceMtime === nextEntry.sourceMtime &&
			target.lastKnownPath === nextEntry.lastKnownPath;
		if (unchanged) {
			return target;
		}

		const nextRegistry = registry.filter((entry) => {
			if (entry.sourceId === sourceId) {
				return false;
			}
			if (sourceFingerprint && entry.sourceFingerprint === sourceFingerprint) {
				return false;
			}
			if (
				sourceFingerprint &&
				this.normalizeFingerprint(entry.fileFingerprint) === sourceFingerprint
			) {
				return false;
			}
			return entry.filePath !== normalizedPath;
		});
		nextRegistry.push(nextEntry);
		await this.saveSourceRegistry(nextRegistry);
		return nextEntry;
	}

	async resolveSourceFilePath(
		sourceId?: string,
		fallbackFilePath?: string
	): Promise<string | null> {
		const normalizedFallback = normalizePath(fallbackFilePath || "");
		if (sourceId) {
			const registry = await this.loadSourceRegistry();
			const registryEntry = registry.find((entry) => entry.sourceId === sourceId);
			if (registryEntry?.filePath && (await this.hasExistingEpubFile(registryEntry.filePath))) {
				return registryEntry.filePath;
			}

			if (normalizedFallback && (await this.hasExistingEpubFile(normalizedFallback))) {
				await this.ensureSourceIdentity(normalizedFallback, { preferredSourceId: sourceId });
				return normalizedFallback;
			}
		}

		if (normalizedFallback && (await this.hasExistingEpubFile(normalizedFallback))) {
			return normalizedFallback;
		}

		return null;
	}

	async listBookshelfEntries(
		options?: { pruneMissing?: boolean }
	): Promise<EpubBookshelfIndexEntry[]> {
		if (options?.pruneMissing) {
			await this.pruneMissingBooks();
		}

		const membership = await this.loadBookshelfMembership();
		if (membership.length === 0) {
			return [];
		}

		const scanEntries = await this.loadScanIndex();
		const scanEntryMap = new Map(scanEntries.map((entry) => [entry.path, entry] as const));
		const synthesizedEntries: EpubScanIndexEntry[] = [];
		const orphanedMembershipPaths = new Set<string>();

		const membershipPathRemaps = new Map<string, string>();

		const resolvedEntries = await Promise.all(
			membership.map(async (membershipEntry) => {
				const canonicalPath = this.resolveSupportedBookFilePath(membershipEntry.path);
				if (!canonicalPath) {
					orphanedMembershipPaths.add(membershipEntry.path);
					return null;
				}

				if (canonicalPath !== membershipEntry.path) {
					membershipPathRemaps.set(membershipEntry.path, canonicalPath);
				}

				const activePath = canonicalPath;
				let scanEntry = scanEntryMap.get(activePath) ?? scanEntryMap.get(membershipEntry.path);
				if (!scanEntry) {
					scanEntry = await this.createScanIndexEntryFromPath(activePath);
					if (!scanEntry) {
						orphanedMembershipPaths.add(membershipEntry.path);
						return null;
					}
					scanEntryMap.set(scanEntry.path, scanEntry);
					synthesizedEntries.push(scanEntry);
				}

				const sourceEntry = await this.ensureSourceIdentity(activePath);
				await this.ensurePortableBookDataForBookshelfPath(scanEntry, sourceEntry);

				return {
					...this.toBookshelfIndexEntry(
						scanEntry,
						membershipEntry.addedAt,
						membershipEntry.customCoverPath
					),
					path: activePath,
				};
			})
		);

		for (const [oldPath, newPath] of membershipPathRemaps.entries()) {
			await this.updateBookFileReferences(oldPath, newPath);
		}

		if (synthesizedEntries.length > 0) {
			await this.saveScanIndex(scanEntries.concat(synthesizedEntries));
		}

		return resolvedEntries
			.filter((entry): entry is EpubBookshelfIndexEntry => entry !== null)
			.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
	}

	async addBooksToBookshelf(paths: string[]): Promise<EpubBookshelfMembershipEntry[]> {
		const normalizedPaths = Array.from(
			new Set(paths.map((path) => normalizePath(path || "")).filter(Boolean))
		);
		if (normalizedPaths.length === 0) {
			return [];
		}

		const membership = await this.loadBookshelfMembership();
		const membershipPaths = new Set(membership.map((entry) => entry.path));
		const nextMembership = [...membership];
		const addedEntries: EpubBookshelfMembershipEntry[] = [];
		const scanEntriesToUpsert: EpubScanIndexEntry[] = [];
		const now = Date.now();

		for (let index = 0; index < normalizedPaths.length; index += 1) {
			const requestedPath = normalizedPaths[index];
			const canonicalPath = this.resolveSupportedBookFilePath(requestedPath);
			if (!canonicalPath || this.isBookshelfMemberPath(canonicalPath, membership)) {
				continue;
			}

			const sourceEntry = await this.ensureSourceIdentity(canonicalPath);
			const scanEntry = await this.createScanIndexEntryFromPath(canonicalPath);
			await this.ensurePortableBookDataForBookshelfPath(scanEntry, sourceEntry);

			const nextEntry = {
				path: canonicalPath,
				addedAt: now + index,
			};
			nextMembership.push(nextEntry);
			addedEntries.push(nextEntry);
			membershipPaths.add(canonicalPath);
			scanEntriesToUpsert.push(scanEntry);
		}

		if (addedEntries.length === 0) {
			return [];
		}

		await this.saveBookshelfMembership(nextMembership);
		if (scanEntriesToUpsert.length > 0) {
			const existingEntries = await this.loadScanIndex();
			const mergedByPath = new Map(
				existingEntries.map((entry) => [entry.path, entry] as const)
			);
			for (const entry of scanEntriesToUpsert) {
				mergedByPath.set(entry.path, entry);
			}
			await this.saveScanIndex(
				Array.from(mergedByPath.values()).sort((a, b) =>
					a.name.localeCompare(b.name, "zh-CN")
				)
			);
		}

		return addedEntries;
	}

	async checkBookshelfMembership(filePath: string): Promise<boolean> {
		const membership = await this.loadBookshelfMembership();
		return this.isBookshelfMemberPath(filePath, membership);
	}

	async ensureBookOnBookshelf(filePath: string): Promise<void> {
		await this.addBooksToBookshelf([filePath]);
	}

	async findBookByFilePath(filePath: string): Promise<EpubBook | null> {
		const normalizedFilePath = normalizePath(filePath || "");
		if (!normalizedFilePath) {
			return null;
		}

		const unifiedData = await this.readUnifiedLocalReaderData();
		for (const record of Object.values(unifiedData.books || {})) {
			const descriptor = record.descriptor;
			if (!descriptor) {
				continue;
			}
			if (normalizePath(descriptor.filePath) !== normalizedFilePath) {
				continue;
			}
			const book = this.toBookFromDescriptor(descriptor, record.state);
			if (!this._booksCache) {
				this._booksCache = { [book.id]: book };
			} else {
				this._booksCache[book.id] = book;
			}
			await this.hydrateBookState(book.id);
			return (await this.getBook(book.id)) ?? book;
		}

		if (this._booksCache) {
			const cached = this.findBookInCollectionByFilePath(this._booksCache, normalizedFilePath);
			if (cached?.id) {
				await this.hydrateBookState(cached.id);
				return (await this.getBook(cached.id)) ?? cached;
			}
		}

		if (!this._booksCache) {
			const { books: localBooks } = await this.readBooksFromUnifiedLocalData();
			if (Object.keys(localBooks).length > 0) {
				this._booksCache = localBooks;
			} else {
				const legacyBooks = await this.readLegacyBooks();
				if (Object.keys(legacyBooks).length > 0) {
					this._booksCache = { ...legacyBooks };
				}
			}
		}

		if (this._booksCache) {
			const catalogBook = this.findBookInCollectionByFilePath(this._booksCache, normalizedFilePath);
			if (catalogBook?.id) {
				await this.hydrateBookState(catalogBook.id);
				return (await this.getBook(catalogBook.id)) ?? catalogBook;
			}
		}

		const membership =
			unifiedData.bookshelfMembership ?? (await this.loadBookshelfMembership());
		const isMember = membership.some(
			(entry) => normalizePath(entry.path || "") === normalizedFilePath
		);
		if (!isMember) {
			return null;
		}

		const scanEntries = await this.loadScanIndex();
		const scanEntry =
			scanEntries.find((entry) => normalizePath(entry.path) === normalizedFilePath) ??
			(await this.createScanIndexEntryFromPath(normalizedFilePath));
		const book = this.buildShelfOnlyBookFromScanEntry(scanEntry);
		if (!this._booksCache) {
			this._booksCache = { [book.id]: book };
		} else {
			this._booksCache[book.id] = book;
		}
		return book;
	}

	async updateBookDisplayTitle(book: EpubBook): Promise<EpubBook> {
		await this.ensureAutomaticDataMigrations();
		const nextTitle = String(book.metadata?.title || "").trim();
		if (!nextTitle) {
			throw new Error("Book title is required");
		}

		const normalizedMetadata = this.normalizeBookMetadata({
			...book.metadata,
			title: nextTitle,
		});
		if (!normalizedMetadata) {
			throw new Error("Book metadata is invalid");
		}

		const nextBook: EpubBook = {
			...book,
			metadata: normalizedMetadata,
		};

		const paragraphPosition = await this.loadParagraphModeReadingPosition(nextBook.id);
		if (paragraphPosition) {
			await this.saveParagraphModeReadingPosition({
				...paragraphPosition,
				bookTitle: nextTitle,
			});
		}

		await this.saveBook(nextBook, { ensureOnBookshelf: true });
		await this.getBookmarkService().syncBookDisplayMetadata(nextBook);
		return nextBook;
	}

	async findBookBySourceId(sourceId: string): Promise<EpubBook | null> {
		const normalizedSourceId = String(sourceId || "").trim();
		if (!normalizedSourceId) {
			return null;
		}

		return this.findBookInCollectionBySourceId(
			await this.loadBooks({ hydrateStates: false }),
			normalizedSourceId
		);
	}

	private findBookInCollectionByFilePath(
		books: Record<string, EpubBook>,
		filePath: string
	): EpubBook | null {
		const normalizedFilePath = normalizePath(filePath || "");
		for (const book of Object.values(books)) {
			if (normalizePath(book.filePath || "") === normalizedFilePath) {
				return book;
			}
		}
		return null;
	}

	private findBookInCollectionBySourceId(
		books: Record<string, EpubBook>,
		sourceId: string
	): EpubBook | null {
		const normalizedSourceId = String(sourceId || "").trim();
		for (const book of Object.values(books)) {
			if (String(book.sourceId || "").trim() === normalizedSourceId) {
				return book;
			}
		}
		return null;
	}

	private findBookInCollectionByFingerprint(
		books: Record<string, EpubBook>,
		sourceFingerprint: string
	): EpubBook | null {
		const normalizedFingerprint = String(sourceFingerprint || "").trim().toLowerCase();
		if (!normalizedFingerprint) {
			return null;
		}
		for (const book of Object.values(books)) {
			if (
				String(book.sourceFingerprint || book.fileFingerprint || "").trim().toLowerCase() ===
				normalizedFingerprint
			) {
				return book;
			}
		}
		return null;
	}

	async updateBookFileReferences(oldPath: string, newPath: string): Promise<number> {
		const normalizedOldPath = normalizePath(oldPath || "");
		const normalizedNewPath = normalizePath(newPath || "");
		if (!normalizedOldPath || !normalizedNewPath || normalizedOldPath === normalizedNewPath) {
			return 0;
		}

		const books = await this.loadBooks();
		let updated = 0;
		let changed = false;

		for (const book of Object.values(books)) {
			const remapped = this.remapPath(book.filePath, normalizedOldPath, normalizedNewPath);
			if (!remapped || remapped === book.filePath) {
				continue;
			}

			book.filePath = remapped;
			updated += 1;
			changed = true;
		}

		if (changed) {
			await this.writeBooksWithLock(books);
		}

		await this.updateSourceRegistryReferences(normalizedOldPath, normalizedNewPath);
		await this.updateBookshelfMembershipReferences(normalizedOldPath, normalizedNewPath);
		await this.updateBookshelfPlaylistReferences(normalizedOldPath, normalizedNewPath);
		await this.updateBookshelfIndexReferences(normalizedOldPath, normalizedNewPath);

		return updated;
	}

	private async updateSourceRegistryReferences(oldPath: string, newPath: string): Promise<number> {
		const registry = await this.loadSourceRegistry();
		let changed = false;
		let updated = 0;

		const nextRegistry = registry.map((entry) => {
			const remappedPath = this.remapPath(entry.filePath, oldPath, newPath);
			const remappedKnownPath = this.remapPath(entry.lastKnownPath || "", oldPath, newPath);
			if (
				(!remappedPath || remappedPath === entry.filePath) &&
				(!remappedKnownPath || remappedKnownPath === entry.lastKnownPath)
			) {
				return entry;
			}

			changed = true;
			updated += 1;
			return {
				...entry,
				filePath: remappedPath || entry.filePath,
				lastKnownPath: remappedKnownPath || remappedPath || entry.lastKnownPath || entry.filePath,
			};
		});

		if (changed) {
			await this.saveSourceRegistry(nextRegistry);
		}

		return updated;
	}

	private async updateBookshelfMembershipReferences(
		oldPath: string,
		newPath: string
	): Promise<number> {
		const membership = await this.loadBookshelfMembership();
		let changed = false;
		let updated = 0;

		const nextMembership = membership.map((entry) => {
			let nextEntry = entry;
			const remappedPath = this.remapPath(entry.path, oldPath, newPath);
			if (remappedPath && remappedPath !== entry.path) {
				nextEntry = {
					...nextEntry,
					path: remappedPath,
				};
				changed = true;
				updated += 1;
			}

			const customCoverPath = entry.customCoverPath || "";
			if (!customCoverPath) {
				return nextEntry;
			}

			const remappedCoverPath = this.remapPath(customCoverPath, oldPath, newPath);
			if (!remappedCoverPath || remappedCoverPath === customCoverPath) {
				return nextEntry;
			}

			changed = true;
			if (nextEntry === entry) {
				updated += 1;
			}
			return {
				...nextEntry,
				customCoverPath: remappedCoverPath,
			};
		});

		if (changed) {
			await this.saveBookshelfMembership(nextMembership);
		}

		return updated;
	}

	private async updateBookshelfPlaylistReferences(
		oldPath: string,
		newPath: string
	): Promise<number> {
		const unifiedData = await this.readUnifiedLocalReaderData();
		const playlists = normalizeBookshelfPlaylists(unifiedData.bookshelfPlaylists);
		const { playlists: remappedPlaylists, changed } = remapBookshelfPlaylists(
			playlists,
			oldPath,
			newPath
		);

		if (!changed) {
			return 0;
		}

		await this.saveBookshelfPlaylists(remappedPlaylists);
		return remappedPlaylists.reduce((count, playlist, index) => {
			return playlist === playlists[index] ? count : count + 1;
		}, 0);
	}

	private async removeBookPathFromAllPlaylists(bookPath: string): Promise<boolean> {
		const normalizedPath = normalizePath(bookPath || "");
		if (!normalizedPath) {
			return false;
		}

		const unifiedData = await this.readUnifiedLocalReaderData();
		const playlists = normalizeBookshelfPlaylists(unifiedData.bookshelfPlaylists);
		const { playlists: nextPlaylists, changed } = removeBookPathFromBookshelfPlaylists(
			playlists,
			normalizedPath
		);

		if (!changed) {
			return false;
		}

		await this.saveBookshelfPlaylists(nextPlaylists);
		return true;
	}

	async remapBookshelfMembershipPaths(oldPath: string, newPath: string): Promise<number> {
		const normalizedOldPath = normalizePath(oldPath || "");
		const normalizedNewPath = normalizePath(newPath || "");
		if (!normalizedOldPath || !normalizedNewPath || normalizedOldPath === normalizedNewPath) {
			return 0;
		}

		const membershipUpdated = await this.updateBookshelfMembershipReferences(
			normalizedOldPath,
			normalizedNewPath
		);
		await this.updateBookshelfPlaylistReferences(normalizedOldPath, normalizedNewPath);
		await this.updateBookshelfIndexReferences(normalizedOldPath, normalizedNewPath);
		return membershipUpdated;
	}

	async setBookshelfCustomCover(filePath: string, coverPath: string | null): Promise<boolean> {
		const normalizedFilePath = normalizePath(filePath || "");
		if (!normalizedFilePath) {
			return false;
		}

		const membership = await this.loadBookshelfMembership();
		const entryIndex = membership.findIndex((entry) => entry.path === normalizedFilePath);
		if (entryIndex < 0) {
			return false;
		}

		const normalizedCoverPath = coverPath ? normalizePath(coverPath) : "";
		const nextMembership = [...membership];
		nextMembership[entryIndex] = {
			...membership[entryIndex],
			customCoverPath: normalizedCoverPath || undefined,
		};
		await this.saveBookshelfMembership(nextMembership);
		return true;
	}

	private async updateBookshelfIndexReferences(oldPath: string, newPath: string): Promise<number> {
		const entries = await this.getMutableBookshelfIndexEntries();
		let updated = 0;
		let changed = false;

		const nextEntries = entries.map((entry) => {
			const remappedPath = this.remapPath(entry.path, oldPath, newPath);
			if (!remappedPath || remappedPath === entry.path) {
				return entry;
			}

			updated += 1;
			changed = true;
			const file = this.app.vault.getAbstractFileByPath(remappedPath);
			const slashIndex = remappedPath.lastIndexOf("/");

			return {
				path: remappedPath,
				name:
					file instanceof TFile
						? file.basename
						: stripSupportedBookExtension(remappedPath.split("/").pop() || remappedPath) ||
							entry.name,
				folder:
					file instanceof TFile
						? file.parent?.path || "/"
						: slashIndex >= 0
						? remappedPath.slice(0, slashIndex) || "/"
						: "/",
				size: file instanceof TFile ? file.stat.size : entry.size,
				mtime: file instanceof TFile ? file.stat.mtime : entry.mtime,
			};
		});

		if (!changed) {
			return 0;
		}

		const dedupedEntries = Array.from(
			new Map(nextEntries.map((entry) => [entry.path, entry] as const)).values()
		).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

		await this.saveScanIndex(dedupedEntries);
		return updated;
	}

	async pruneMissingBooks(): Promise<{ removedBookIds: string[]; removedPaths: string[] }> {
		const books = await this.loadBooks({ hydrateStates: false });
		const nextBooks: Record<string, EpubBook> = {};
		const removedBookIds: string[] = [];
		const removedPaths: string[] = [];
		let changed = false;

		const existenceChecks = await Promise.all(
			Object.entries(books).map(async ([bookId, book]) => ({
				bookId,
				book,
				exists: await this.hasExistingEpubFile(book.filePath),
			}))
		);

		for (const { bookId, book, exists } of existenceChecks) {
			if (exists) {
				nextBooks[bookId] = book;
				continue;
			}

			removedBookIds.push(bookId);
			removedPaths.push(book.filePath);
			changed = true;
		}

		if (changed) {
			await this.writeBooksWithLock(nextBooks);

			for (const bookId of removedBookIds) {
				const bookDir = `${this.basePath}/${bookId}`;
				if (await this.app.vault.adapter.exists(bookDir)) {
					await this.app.vault.adapter.rmdir(bookDir, true);
				}
				await this.removePortableBookData(bookId);
				await this.removeLocalBookState(bookId);
			}
		}

		const orphanedMembershipPaths = await this.pruneOrphanedBookshelfMembership();
		const orphanedScanPaths = await this.pruneOrphanedScanIndexEntries();
		const allRemovedPaths = Array.from(
			new Set([...removedPaths, ...orphanedMembershipPaths, ...orphanedScanPaths])
		);

		if (allRemovedPaths.length > 0) {
			await this.detachMissingSourceRegistryPaths(allRemovedPaths);
		}

		logger.info("[EpubStorageService] Pruned missing EPUB records:", {
			removedBookIds,
			removedPaths,
			orphanedMembershipPaths,
			orphanedScanPaths,
		});

		return { removedBookIds, removedPaths: allRemovedPaths };
	}

	private async pruneOrphanedBookshelfMembership(): Promise<string[]> {
		const membership = await this.loadBookshelfMembership();
		const removedPaths: string[] = [];
		const nextMembership: EpubBookshelfMembershipEntry[] = [];

		for (const entry of membership) {
			if (await this.hasExistingEpubFile(entry.path)) {
				nextMembership.push(entry);
				continue;
			}
			removedPaths.push(entry.path);
		}

		if (nextMembership.length !== membership.length) {
			await this.saveBookshelfMembership(nextMembership);
		}

		return removedPaths;
	}

	private async pruneOrphanedScanIndexEntries(): Promise<string[]> {
		const scanEntries = await this.loadScanIndex();
		const filteredEntries = await this.filterExistingBookshelfEntries(scanEntries);
		const removedPaths = scanEntries
			.filter((entry) => !filteredEntries.some((filtered) => filtered.path === entry.path))
			.map((entry) => entry.path);

		if (filteredEntries.length !== scanEntries.length) {
			await this.saveScanIndex(filteredEntries);
		}

		return removedPaths;
	}

	private async detachMissingSourceRegistryPaths(paths: string[]): Promise<void> {
		const normalizedPaths = new Set(paths.map((path) => normalizePath(path || "")).filter(Boolean));
		if (normalizedPaths.size === 0) {
			return;
		}

		const registry = await this.loadSourceRegistry();
		let changed = false;
		const nextRegistry = registry.map((entry) => {
			if (!normalizedPaths.has(normalizePath(entry.filePath || ""))) {
				return entry;
			}

			changed = true;
			return {
				...entry,
				filePath: "",
				lastKnownPath: entry.filePath || entry.lastKnownPath,
			};
		});

		if (changed) {
			await this.saveSourceRegistry(nextRegistry);
		}
	}

	private async removeLocalBookState(bookId: string): Promise<void> {
		await this.updateUnifiedLocalReaderData((localData) => {
			if (localData.books) {
				const nextBooks = { ...localData.books };
				delete nextBooks[bookId];
				localData.books = nextBooks;
			}
		});

		const adapter = this.app.vault.adapter;
		for (const dir of [
			normalizePath(`${this.getLocalReaderStateRoot()}/${bookId}`),
			normalizePath(`${this.getLocalReaderArtifactsRoot()}/${bookId}`),
		]) {
			if (await adapter.exists(dir)) {
				await adapter.rmdir(dir, true);
			}
		}

		await Promise.all([
			DirectoryUtils.pruneEmptyDirsUnder(adapter as unknown, this.getLocalReaderStateRoot(), {
				preserveRoot: false,
			}),
			DirectoryUtils.pruneEmptyDirsUnder(adapter as unknown, this.getLocalReaderArtifactsRoot(), {
				preserveRoot: false,
			}),
		]);
	}

	private async deleteBook(bookId: string): Promise<void> {
		const books = await this.loadBooks();
		const nextBooks = { ...books };
		delete nextBooks[bookId];
		await this.writeBooksWithLock(nextBooks);

		const bookDir = `${this.basePath}/${bookId}`;
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(bookDir)) {
			await adapter.rmdir(bookDir, true);
		}
		await this.removePortableBookData(bookId);
		await this.removeLocalBookState(bookId);
	}

	private async removeMembershipEntry(filePath: string): Promise<boolean> {
		const normalizedFilePath = normalizePath(filePath || "");
		if (!normalizedFilePath) {
			return false;
		}

		const membership = await this.loadBookshelfMembership();
		const nextMembership = membership.filter((entry) => entry.path !== normalizedFilePath);
		if (nextMembership.length === membership.length) {
			return false;
		}

		await this.saveBookshelfMembership(nextMembership);
		return true;
	}

	async removeFromBookshelfByFilePath(
		filePath: string,
		options: { purgeCache?: boolean } = {}
	): Promise<{ removedBookId: string | null; removedMembership: boolean }> {
		const normalizedFilePath = normalizePath(filePath || "");
		if (!normalizedFilePath) {
			return { removedBookId: null, removedMembership: false };
		}

		const existingBook = options.purgeCache
			? await this.findBookByFilePath(normalizedFilePath)
			: null;
		const portableBookId = options.purgeCache
			? await this.findPortableBookIdForPath(normalizedFilePath)
			: "";
		const removedMembership = await this.removeMembershipEntry(normalizedFilePath);
		await this.removeBookPathFromAllPlaylists(normalizedFilePath);
		if (!options.purgeCache) {
			return { removedBookId: null, removedMembership };
		}

		if (existingBook) {
			await this.deleteBook(existingBook.id);
		}
		if (portableBookId && portableBookId !== existingBook?.id) {
			await this.removePortableBookData(portableBookId);
			await this.removeLocalBookState(portableBookId);
		}
		await this.loadScanIndex();
		return {
			removedBookId: portableBookId || existingBook?.id || null,
			removedMembership,
		};
	}

	async removeMissingBookshelfEntry(filePath: string): Promise<void> {
		const normalizedFilePath = normalizePath(filePath || "");
		if (!normalizedFilePath) {
			return;
		}

		if (!(await this.isBookshelfSourceMissing(normalizedFilePath))) {
			const canonicalPath = this.resolveSupportedBookFilePath(normalizedFilePath);
			if (canonicalPath && canonicalPath !== normalizedFilePath) {
				await this.updateBookFileReferences(normalizedFilePath, canonicalPath);
			}
			return;
		}

		await this.removeFromBookshelfByFilePath(normalizedFilePath, { purgeCache: true });
		await this.removeScanIndexEntry(normalizedFilePath);
		await this.pruneMissingBooks();
	}

	async removeBookshelfEntryForDeletedVaultFile(filePath: string): Promise<void> {
		const normalizedFilePath = normalizePath(filePath || "");
		if (!normalizedFilePath) {
			return;
		}

		await this.removeFromBookshelfByFilePath(normalizedFilePath, { purgeCache: true });
		await this.removeScanIndexEntry(normalizedFilePath);
	}

	async removeBookFromBookshelf(
		filePath: string,
		options: { purgeCache?: boolean } = {}
	): Promise<{ removedBookId: string | null; removedMembership: boolean }> {
		return this.removeFromBookshelfByFilePath(filePath, options);
	}

	async removeBookByFilePath(
		filePath: string
	): Promise<{ removedBookId: string | null; removedIndexEntry: boolean }> {
		const result = await this.removeFromBookshelfByFilePath(filePath, { purgeCache: true });
		return {
			removedBookId: result.removedBookId,
			removedIndexEntry: result.removedMembership,
		};
	}

	async deleteTrackedBookFile(filePath: string): Promise<EpubDeleteTrackedBookResult> {
		const normalizedFilePath = normalizePath(filePath || "");
		if (!normalizedFilePath) {
			return {
				deletedFilePath: null,
				fileDeleted: false,
				removedScanEntries: 0,
				removedMembershipEntries: 0,
				removedBookIds: [],
			};
		}

		let fileDeleted = false;
		const abstractFile = this.app.vault.getAbstractFileByPath(normalizedFilePath);
		if (abstractFile instanceof TFile) {
			const trashFile = (this.app as App & {
				fileManager?: {
					trashFile?: (file: TFile) => Promise<void>;
				};
			}).fileManager?.trashFile;
			if (typeof trashFile === "function") {
				await trashFile.call((this.app as App & { fileManager?: unknown }).fileManager, abstractFile);
			} else {
				await this.app.vault.adapter.remove(normalizedFilePath);
			}
			fileDeleted = true;
		} else if (await this.app.vault.adapter.exists(normalizedFilePath)) {
			await this.app.vault.adapter.remove(normalizedFilePath);
			fileDeleted = true;
		}

		const cleanup = await this.removeTrackedEpubTarget(normalizedFilePath);
		return {
			deletedFilePath: fileDeleted ? normalizedFilePath : null,
			fileDeleted,
			removedScanEntries: cleanup.removedScanEntries,
			removedMembershipEntries: cleanup.removedMembershipEntries,
			removedBookIds: cleanup.removedBookIds,
		};
	}

	async removeTrackedEpubTarget(targetPath: string): Promise<{
		removedScanEntries: number;
		removedMembershipEntries: number;
		removedBookIds: string[];
	}> {
		const normalizedTargetPath = normalizePath(targetPath || "");
		if (!normalizedTargetPath) {
			return {
				removedScanEntries: 0,
				removedMembershipEntries: 0,
				removedBookIds: [],
			};
		}

		const matchesTarget = (path: string) =>
			path === normalizedTargetPath || path.startsWith(`${normalizedTargetPath}/`);

		const books = await this.loadBooks();
		const removedBookIds: string[] = [];
		const removedBookPaths: string[] = [];
		const nextBooks: Record<string, EpubBook> = {};
		for (const [bookId, book] of Object.entries(books)) {
			if (!matchesTarget(normalizePath(book.filePath || ""))) {
				nextBooks[bookId] = book;
				continue;
			}
			removedBookIds.push(bookId);
			removedBookPaths.push(normalizePath(book.filePath || ""));
			const bookDir = `${this.basePath}/${bookId}`;
			if (await this.app.vault.adapter.exists(bookDir)) {
				await this.app.vault.adapter.rmdir(bookDir, true);
			}
			await this.removePortableBookData(bookId);
			await this.removeLocalBookState(bookId);
		}
		if (removedBookIds.length > 0) {
			await this.writeBooksWithLock(nextBooks);
		}

		const scanEntries = await this.loadScanIndex();
		const nextScanEntries = scanEntries.filter((entry) => !matchesTarget(entry.path));
		if (nextScanEntries.length !== scanEntries.length) {
			await this.saveScanIndex(nextScanEntries);
		}

		const membership = await this.loadBookshelfMembership();
		const nextMembership = membership.filter((entry) => !matchesTarget(entry.path));
		if (nextMembership.length !== membership.length) {
			await this.saveBookshelfMembership(nextMembership);
		}

		await this.detachMissingSourceRegistryPaths([
			...scanEntries.filter((entry) => matchesTarget(entry.path)).map((entry) => entry.path),
			...removedBookPaths,
		]);

		return {
			removedScanEntries: scanEntries.length - nextScanEntries.length,
			removedMembershipEntries: membership.length - nextMembership.length,
			removedBookIds,
		};
	}

	async saveProgress(
		bookId: string,
		position: ReadingPosition,
		readingStats?: ReadingStats
	): Promise<void> {
		bookId = await this.resolveCanonicalBookId(bookId);
		this._pendingProgress = { bookId, position, readingStats };
		if (this._progressDebounceTimer) return;
		this._progressDebounceTimer = window.setTimeout(() => {
			void (async () => {
				this._progressDebounceTimer = null;
				const pending = this._pendingProgress;
				if (!pending) return;
				this._pendingProgress = null;
				try {
					const book = await this.getBook(pending.bookId);
					if (book) {
						book.currentPosition = pending.position;
						if (pending.readingStats) {
							book.readingStats = normalizeReadingPaceStats(pending.readingStats);
						}
						book.readingStats.lastReadTime = Date.now();
						await this.writeBookState(book.id, {
							currentPosition: book.currentPosition,
							readingStats: book.readingStats,
						});
					}
				} catch (e) {
					logger.warn("[EpubStorageService] saveProgress failed:", e);
				}
			})();
		}, 300);
	}

	async flushPendingProgress(): Promise<void> {
		if (this._progressDebounceTimer) {
			window.clearTimeout(this._progressDebounceTimer);
			this._progressDebounceTimer = null;
		}
		const pending = this._pendingProgress;
		if (pending) {
			this._pendingProgress = null;
			try {
				const canonicalBookId = await this.resolveCanonicalBookId(pending.bookId);
				const book = await this.getBook(canonicalBookId);
				if (book) {
					book.currentPosition = pending.position;
					if (pending.readingStats) {
						book.readingStats = normalizeReadingPaceStats(pending.readingStats);
					}
					book.readingStats.lastReadTime = Date.now();
					await this.writeBookState(book.id, {
						currentPosition: book.currentPosition,
						readingStats: book.readingStats,
					});
				}
			} catch (error) {
				logger.warn("[EpubStorageService] flushPendingProgress failed:", error);
			}
		}
	}

	async loadProgress(bookId: string, bookHint?: EpubBook): Promise<ReadingPosition | null> {
		bookId = await this.resolveCanonicalBookId(bookId);
		const existingBook = (await this.getBook(bookId)) ?? bookHint ?? null;
		if (existingBook?.currentPosition?.cfi) {
			return existingBook.currentPosition;
		}

		await this.hydrateBookState(bookId);
		const hydratedBook = await this.getBook(bookId);
		if (hydratedBook?.currentPosition?.cfi) {
			return hydratedBook.currentPosition;
		}

		const filePath = bookHint?.filePath || hydratedBook?.filePath;
		if (!filePath) {
			return null;
		}

		const readingState = await this.getBookmarkService().readReadingStateByBookPath(filePath);
		return readingState?.currentPosition ?? null;
	}

	async markBookCompleted(bookId: string, completedAt = Date.now()): Promise<EpubBook | null> {
		bookId = await this.resolveCanonicalBookId(bookId);
		const book = await this.getBook(bookId);
		if (!book) {
			return null;
		}
		const timestamp = Number.isFinite(completedAt) && completedAt > 0 ? completedAt : Date.now();
		book.readingStats = normalizeReadingPaceStats({
			...book.readingStats,
			completedTime: book.readingStats.completedTime ?? timestamp,
		});
		await this.writeBookState(book.id, {
			currentPosition: book.currentPosition,
			readingStats: book.readingStats,
		});
		return book;
	}

	async clearBookCompletion(bookId: string): Promise<EpubBook | null> {
		bookId = await this.resolveCanonicalBookId(bookId);
		const book = await this.getBook(bookId);
		if (!book) {
			return null;
		}
		const stats = normalizeReadingPaceStats(book.readingStats);
		if (stats.completedTime === undefined) {
			return book;
		}
		const rest = { ...stats };
		delete rest.completedTime;
		book.readingStats = normalizeReadingPaceStats(rest);
		await this.writeBookState(book.id, {
			currentPosition: book.currentPosition,
			readingStats: book.readingStats,
		});
		return book;
	}

	async loadConcealedTexts(bookId: string): Promise<ConcealedText[]> {
		bookId = await this.resolveCanonicalBookId(bookId);
		const unifiedData = await this.readUnifiedLocalReaderData();
		const bookRecord = unifiedData.books?.[bookId];
		if (
			(await this.hasUnifiedLocalDataFile()) &&
			bookRecord &&
			Object.prototype.hasOwnProperty.call(bookRecord, "concealedTexts")
		) {
			return [...(bookRecord.concealedTexts || [])];
		}

		return (await this.readLegacyConcealedTexts(bookId)) ?? [];
	}

	async saveConcealedTexts(bookId: string, concealedTexts: ConcealedText[]): Promise<void> {
		bookId = await this.resolveCanonicalBookId(bookId);
		const normalizedConcealedTexts = this.normalizeConcealedTexts(concealedTexts);
		await this.updateUnifiedLocalReaderData((localData) => {
			localData.books = localData.books || {};
			const current = localData.books[bookId] || {};
			localData.books[bookId] = {
				...current,
				concealedTexts: normalizedConcealedTexts,
			};
		});
	}

	async addConcealedText(bookId: string, concealedText: ConcealedText): Promise<void> {
		const concealedTexts = await this.loadConcealedTexts(bookId);
		const existingIndex = concealedTexts.findIndex(
			(item) => item.cfiRange === concealedText.cfiRange
		);
		const normalizedItem = {
			...concealedText,
			mode: this.normalizeConcealedTextMode(concealedText.mode),
		};
		if (existingIndex >= 0) {
			concealedTexts[existingIndex] = normalizedItem;
		} else {
			concealedTexts.push(normalizedItem);
		}
		await this.saveConcealedTexts(bookId, concealedTexts);
	}

	async deleteConcealedText(bookId: string, concealedTextId: string): Promise<void> {
		const concealedTexts = await this.loadConcealedTexts(bookId);
		const filtered = concealedTexts.filter((item) => item.id !== concealedTextId);
		await this.saveConcealedTexts(bookId, filtered);
	}

	async deleteConcealedTextByCfi(bookId: string, cfiRange: string): Promise<void> {
		const concealedTexts = await this.loadConcealedTexts(bookId);
		const filtered = concealedTexts.filter((item) => item.cfiRange !== cfiRange);
		await this.saveConcealedTexts(bookId, filtered);
	}

	private normalizeConcealedTextMode(mode?: string): ConcealedText["mode"] {
		return normalizeConcealedTextMode(mode);
	}

	private normalizeConcealedTexts(concealedTexts: unknown): ConcealedText[] {
		return normalizeConcealedTexts(concealedTexts);
	}

	async loadLastOpenBookmark(bookId: string): Promise<EpubLastOpenBookmark | null> {
		bookId = await this.resolveCanonicalBookId(bookId);
		await this.hydrateBookState(bookId);
		const book = await this.getBook(bookId);

		if (book?.currentPosition?.cfi) {
			const fromBookmarkFile = this.lastOpenBookmarkFromReadingState(
				{
					currentPosition: book.currentPosition,
					readingStats: book.readingStats,
				},
				book.metadata?.title
			);
			if (fromBookmarkFile) {
				await this.clearUnifiedLastOpenBookmark(bookId);
				return fromBookmarkFile;
			}
		}

		const fromUnified = await this.readUnifiedLastOpenBookmark(bookId);
		if (fromUnified?.cfi) {
			if (book) {
				await this.migrateLastOpenBookmarkToBookmarkFile(book, fromUnified);
			}
			return fromUnified;
		}

		const fromLegacy = await this.readLegacyLastOpenBookmark(bookId);
		if (fromLegacy?.cfi && book) {
			await this.migrateLastOpenBookmarkToBookmarkFile(book, fromLegacy);
			return fromLegacy;
		}
		return fromLegacy;
	}

	async saveLastOpenBookmark(bookId: string, bookmark: EpubLastOpenBookmark): Promise<void> {
		bookId = await this.resolveCanonicalBookId(bookId);
		const normalized = this.normalizeLastOpenBookmark(bookmark);
		if (!normalized?.cfi) {
			return;
		}

		const book = await this.getBook(bookId);
		if (book) {
			const payload = this.readingStateFromLastOpenBookmark(normalized, book.readingStats);
			book.currentPosition = payload.currentPosition;
			book.readingStats = payload.readingStats;
			await this.writeBookState(bookId, payload);
			return;
		}

		await this.updateUnifiedLocalReaderData((localData) => {
			localData.books = localData.books || {};
			const current = localData.books[bookId] || {};
			localData.books[bookId] = {
				...current,
				lastOpenBookmark: normalized,
			};
		});
	}

	async loadReadingReferencePoint(bookId: string): Promise<EpubReadingReferencePoint | null> {
		bookId = await this.resolveCanonicalBookId(bookId);
		const unifiedData = await this.readUnifiedLocalReaderData();
		const bookRecord = unifiedData.books?.[bookId];
		if (
			(await this.hasUnifiedLocalDataFile()) &&
			bookRecord &&
			Object.prototype.hasOwnProperty.call(bookRecord, "readingReferencePoint")
		) {
			return bookRecord.readingReferencePoint ?? null;
		}

		return null;
	}

	async saveReadingReferencePoint(bookId: string, point: EpubReadingReferencePoint): Promise<void> {
		bookId = await this.resolveCanonicalBookId(bookId);
		await this.updateUnifiedLocalReaderData((localData) => {
			localData.books = localData.books || {};
			const current = localData.books[bookId] || {};
			localData.books[bookId] = {
				...current,
				readingReferencePoint: this.normalizeReadingReferencePoint(point),
			};
		});
	}

	async getTocChapterMarks(bookId: string): Promise<EpubTocChapterMarkMap> {
		bookId = await this.resolveCanonicalBookId(bookId);
		const unifiedData = await this.readUnifiedLocalReaderData();
		const bookRecord = unifiedData.books?.[bookId];
		if (!bookRecord?.tocChapterMarks) {
			return {};
		}
		return { ...bookRecord.tocChapterMarks };
	}

	async setTocChapterMark(
		bookId: string,
		href: string,
		mark: EpubTocChapterMark | null
	): Promise<EpubTocChapterMarkMap> {
		bookId = await this.resolveCanonicalBookId(bookId);
		const hrefKey = normalizeTocChapterMarkKey(href);
		if (!hrefKey) {
			return this.getTocChapterMarks(bookId);
		}

		let nextMarks: EpubTocChapterMarkMap = {};
		await this.updateUnifiedLocalReaderData((localData) => {
			localData.books = localData.books || {};
			const current = localData.books[bookId] || {};
			const existing = normalizeTocChapterMarkMap(current.tocChapterMarks);
			nextMarks = { ...existing };
			if (mark) {
				nextMarks[hrefKey] = mark;
			} else {
				delete nextMarks[hrefKey];
			}
			localData.books[bookId] = {
				...current,
				tocChapterMarks: Object.keys(nextMarks).length > 0 ? nextMarks : undefined,
			};
		});
		return nextMarks;
	}

	async loadTocChapterMarkSettings(): Promise<EpubTocChapterMarkSettings> {
		const unifiedData = await this.readUnifiedLocalReaderData();
		if (Object.prototype.hasOwnProperty.call(unifiedData, "tocChapterMarkSettings")) {
			return normalizeTocChapterMarkSettings(unifiedData.tocChapterMarkSettings);
		}
		return {};
	}

	async saveTocChapterMarkSettings(settings: EpubTocChapterMarkSettings): Promise<EpubTocChapterMarkSettings> {
		const normalizedSettings = normalizeTocChapterMarkSettings(settings);
		await this.updateUnifiedLocalReaderData((localData) => {
			if (Object.keys(normalizedSettings).length > 0) {
				localData.tocChapterMarkSettings = normalizedSettings;
				return;
			}
			delete localData.tocChapterMarkSettings;
		});
		return normalizedSettings;
	}

	private parseParagraphModePositionsMarkdown(markdown: string): Record<string, EpubParagraphModeReadingPosition> {
		const result: Record<string, EpubParagraphModeReadingPosition> = {};
		const blockPattern = /^##\s+(.+?)\r?\n```json\r?\n([\s\S]*?)\r?\n```\r?\n?/gm;
		let match: RegExpExecArray | null = blockPattern.exec(markdown);
		while (match) {
			const bookId = String(match[1] || "").trim();
			const jsonText = String(match[2] || "").trim();
			if (bookId && jsonText) {
				try {
					const parsed = JSON.parse(jsonText) as Partial<EpubParagraphModeReadingPosition>;
					const cfi = String(parsed.cfi || "").trim();
					const paragraphId = String(parsed.paragraphId || "").trim();
					if (cfi && paragraphId) {
						result[bookId] = {
							bookId,
							filePath: String(parsed.filePath || ""),
							bookTitle: String(parsed.bookTitle || ""),
							chapterTitle: String(parsed.chapterTitle || ""),
							chapterHref: String(parsed.chapterHref || ""),
							chapterIndex: Number.isFinite(parsed.chapterIndex) ? Number(parsed.chapterIndex) : 0,
							cfi,
							percent: Number.isFinite(parsed.percent) ? Number(parsed.percent) : 0,
							paragraphId,
							paragraphIndex: Number.isFinite(parsed.paragraphIndex)
								? Number(parsed.paragraphIndex)
								: 0,
							paragraphTextPreview: String(parsed.paragraphTextPreview || ""),
							savedAt: Number.isFinite(parsed.savedAt) ? Number(parsed.savedAt) : Date.now(),
						};
					}
				} catch (error) {
					logger.warn("[EpubStorageService] Failed to parse paragraph mode position block:", error);
				}
			}
			match = blockPattern.exec(markdown);
		}
		return result;
	}

	private async loadParagraphModePositionsMap(): Promise<Record<string, EpubParagraphModeReadingPosition>> {
		await this.migrateLegacyParagraphModePositionsIfNeeded();
		const path = this.getParagraphModePositionsPath();
		if (!(await this.app.vault.adapter.exists(path))) {
			return {};
		}
		try {
			const content = await this.app.vault.adapter.read(path);
			if (path.endsWith(".json")) {
				return this.parseParagraphModePositionsJson(content);
			}
			return this.parseParagraphModePositionsMarkdown(content);
		} catch (error) {
			logger.warn("[EpubStorageService] Failed to read paragraph mode positions cache:", error);
			return {};
		}
	}

	async loadParagraphModeReadingPosition(bookId: string): Promise<EpubParagraphModeReadingPosition | null> {
		const normalizedBookId = String(bookId || "").trim();
		if (!normalizedBookId) {
			return null;
		}
		const map = await this.loadParagraphModePositionsMap();
		return map[normalizedBookId] || null;
	}

	async saveParagraphModeReadingPosition(position: EpubParagraphModeReadingPosition): Promise<void> {
		const normalizedBookId = String(position.bookId || "").trim();
		const normalizedCfi = String(position.cfi || "").trim();
		const normalizedParagraphId = String(position.paragraphId || "").trim();
		if (!normalizedBookId || !normalizedCfi || !normalizedParagraphId) {
			return;
		}

		const path = this.getParagraphModePositionsPath();
		await this.ensureParagraphModePositionsDirectory();
		const map = await this.loadParagraphModePositionsMap();
		map[normalizedBookId] = {
			...position,
			bookId: normalizedBookId,
			cfi: normalizedCfi,
			paragraphId: normalizedParagraphId,
			savedAt: Number.isFinite(position.savedAt) ? position.savedAt : Date.now(),
		};
		try {
			await this.app.vault.adapter.write(
				path,
				JSON.stringify({ version: 1, positions: map }, null, 2)
			);
		} catch (error) {
			logger.warn("[EpubStorageService] Failed to write paragraph mode positions cache:", error);
		}
	}

	async deleteReadingReferencePoint(bookId: string): Promise<void> {
		bookId = await this.resolveCanonicalBookId(bookId);
		await this.updateUnifiedLocalReaderData((localData) => {
			localData.books = localData.books || {};
			const current = localData.books[bookId];
			if (!current) {
				return;
			}
			localData.books[bookId] = {
				...current,
				readingReferencePoint: null,
			};
		});
	}

	async deleteLastOpenBookmark(bookId: string): Promise<void> {
		bookId = await this.resolveCanonicalBookId(bookId);
		const adapter = this.app.vault.adapter as { remove?: (path: string) => Promise<void> };
		await this.updateUnifiedLocalReaderData((localData) => {
			localData.books = localData.books || {};
			const current = localData.books[bookId];
			if (!current) {
				return;
			}
			localData.books[bookId] = {
				...current,
				lastOpenBookmark: null,
			};
		});
		for (const bookmarkPath of [
			this.getLastOpenBookmarkPath(bookId),
			...this.getLegacyEpubBasePaths().map(
				(basePath) => `${basePath}/${bookId}/last-open-bookmark.json`
			),
		]) {
			if (!(await this.app.vault.adapter.exists(bookmarkPath))) {
				continue;
			}
			if (typeof adapter.remove === "function") {
				await adapter.remove(bookmarkPath);
				continue;
			}
			await this.app.vault.adapter.write(bookmarkPath, "null");
		}
	}

	async removeLegacyHighlights(bookId: string): Promise<void> {
		const highlightsPath = `${this.basePath}/${bookId}/highlights.json`;
		const adapter = this.app.vault.adapter as typeof this.app.vault.adapter & {
			remove?: (path: string) => Promise<void>;
		};
		if (typeof adapter.remove !== "function") {
			return;
		}
		if (await adapter.exists(highlightsPath)) {
			await adapter.remove(highlightsPath);
		}
	}

	async removeLegacyNotes(bookId: string): Promise<void> {
		const notesPath = `${this.basePath}/${bookId}/notes.json`;
		const adapter = this.app.vault.adapter as typeof this.app.vault.adapter & {
			remove?: (path: string) => Promise<void>;
		};
		if (typeof adapter.remove !== "function") {
			return;
		}
		if (await adapter.exists(notesPath)) {
			await adapter.remove(notesPath);
		}
	}

	async getCanvasBinding(bookId: string): Promise<string | null> {
		bookId = await this.resolveCanonicalBookId(bookId);
		const bindings = await this.loadCanvasBindings();
		return bindings[bookId] || null;
	}

	async setCanvasBinding(bookId: string, canvasPath: string): Promise<void> {
		bookId = await this.resolveCanonicalBookId(bookId);
		const bindings = await this.loadCanvasBindings();
		bindings[bookId] = canvasPath;
		await this.saveCanvasBindings(bindings);
	}

	async updateCanvasBindingReferences(oldPath: string, newPath: string): Promise<number> {
		const normalizedOldPath = normalizePath(oldPath || "");
		const normalizedNewPath = normalizePath(newPath || "");
		if (!normalizedOldPath || !normalizedNewPath || normalizedOldPath === normalizedNewPath) {
			return 0;
		}

		const bindings = await this.loadCanvasBindings();
		let updated = 0;
		let changed = false;

		for (const [bookId, canvasPath] of Object.entries(bindings)) {
			const remapped = this.remapPath(canvasPath, normalizedOldPath, normalizedNewPath);
			if (!remapped || remapped === canvasPath) {
				continue;
			}

			bindings[bookId] = remapped;
			updated += 1;
			changed = true;
		}

		if (changed) {
			await this.saveCanvasBindings(bindings);
		}

		await this.remapCanvasExcerptAnchorPath(normalizedOldPath, normalizedNewPath);

		return updated;
	}

	async getCanvasExcerptAnchor(canvasPath: string): Promise<CanvasExcerptAnchorRecord> {
		const normalizedPath = normalizePath(String(canvasPath || "").trim());
		if (!normalizedPath) {
			return { lockedNodeId: null, lastCreatedNodeId: null };
		}
		const anchors = await this.loadCanvasExcerptAnchors();
		const record = anchors[normalizedPath];
		return {
			lockedNodeId: record?.lockedNodeId ?? null,
			lastCreatedNodeId: record?.lastCreatedNodeId ?? null,
			layoutDirection: record?.layoutDirection,
		};
	}

	async setCanvasExcerptAnchor(
		canvasPath: string,
		record: CanvasExcerptAnchorRecord
	): Promise<void> {
		const normalizedPath = normalizePath(String(canvasPath || "").trim());
		if (!normalizedPath) {
			return;
		}
		const anchors = await this.loadCanvasExcerptAnchors();
		const nextRecord: CanvasExcerptAnchorRecord = {
			lockedNodeId: String(record.lockedNodeId || "").trim() || null,
			lastCreatedNodeId: String(record.lastCreatedNodeId || "").trim() || null,
			layoutDirection: record.layoutDirection,
		};
		if (!nextRecord.lockedNodeId && !nextRecord.lastCreatedNodeId && !nextRecord.layoutDirection) {
			if (Object.prototype.hasOwnProperty.call(anchors, normalizedPath)) {
				delete anchors[normalizedPath];
				await this.saveCanvasExcerptAnchors(anchors);
			}
			return;
		}
		anchors[normalizedPath] = nextRecord;
		await this.saveCanvasExcerptAnchors(anchors);
	}

	async remapCanvasExcerptAnchorPath(oldPath: string, newPath: string): Promise<boolean> {
		const normalizedOldPath = normalizePath(String(oldPath || "").trim());
		const normalizedNewPath = normalizePath(String(newPath || "").trim());
		if (
			!normalizedOldPath ||
			!normalizedNewPath ||
			normalizedOldPath === normalizedNewPath
		) {
			return false;
		}
		const anchors = await this.loadCanvasExcerptAnchors();
		const existing = anchors[normalizedOldPath];
		if (!existing) {
			return false;
		}
		delete anchors[normalizedOldPath];
		anchors[normalizedNewPath] = existing;
		await this.saveCanvasExcerptAnchors(anchors);
		return true;
	}

	async removeCanvasBinding(bookId: string): Promise<void> {
		bookId = await this.resolveCanonicalBookId(bookId);
		const bindings = await this.loadCanvasBindings();
		if (!Object.prototype.hasOwnProperty.call(bindings, bookId)) {
			return;
		}
		delete bindings[bookId];
		await this.saveCanvasBindings(bindings);
	}

	async loadPluginUiMemory(): Promise<EpubPluginUiMemory> {
		const unifiedData = await this.readUnifiedLocalReaderData();
		return this.normalizePluginUiMemory(unifiedData.uiMemory);
	}

	async hasPluginUiMemory(): Promise<boolean> {
		const unifiedData = await this.readUnifiedLocalReaderData();
		return Object.prototype.hasOwnProperty.call(unifiedData, "uiMemory");
	}

	async savePluginUiMemory(memory: Partial<EpubPluginUiMemory>): Promise<void> {
		const current = await this.loadPluginUiMemory();
		const normalizedMemory = this.normalizePluginUiMemory({ ...current, ...memory });
		await this.updateUnifiedLocalReaderData((localData) => {
			localData.uiMemory = normalizedMemory;
		});
	}

	async loadBookshelfSearchQuery(): Promise<string> {
		const saved = (await this.loadPluginUiMemory()).bookshelfSearchQuery;
		if (saved.trim()) {
			return saved;
		}

		try {
			const { vaultStorage } = await import("../../utils/vault-local-storage");
			const legacy = vaultStorage.getItem(LEGACY_BOOKSHELF_SEARCH_QUERY_STORAGE_KEY);
			if (!legacy?.trim()) {
				return "";
			}
			await this.saveBookshelfSearchQuery(legacy);
			vaultStorage.removeItem(LEGACY_BOOKSHELF_SEARCH_QUERY_STORAGE_KEY);
			return legacy;
		} catch {
			return "";
		}
	}

	async saveBookshelfSearchQuery(query: string): Promise<void> {
		const trimmed = query.trim();
		await this.savePluginUiMemory({
			bookshelfSearchQuery: trimmed ? query : "",
		});
	}

	async loadReaderSettings(): Promise<EpubReaderSettings> {
		const deviceKind = this.getCurrentDeviceKind();
		const unifiedData = await this.readUnifiedLocalReaderData();
		const unifiedSettings = unifiedData.readerSettings?.[deviceKind];
		if (
			(await this.hasUnifiedLocalDataFile()) &&
			Object.prototype.hasOwnProperty.call(unifiedData.readerSettings || {}, deviceKind)
		) {
			return unifiedSettings ?? this.getDefaultReaderSettingsForCurrentDevice();
		}

		return (
			(await this.readLegacyReaderSettings(deviceKind)) ??
			({ ...this.getDefaultReaderSettingsForCurrentDevice() } as EpubReaderSettings)
		);
	}

	async saveReaderSettings(settings: EpubReaderSettings): Promise<void> {
		const deviceKind = this.getCurrentDeviceKind();
		const normalizedSettings = this.normalizeReaderSettingsForDevice(deviceKind, settings);
		await this.updateUnifiedLocalReaderData((localData) => {
			localData.readerSettings = localData.readerSettings || {};
			localData.readerSettings[deviceKind] = normalizedSettings;
		});
	}

	async loadExcerptSettings(): Promise<EpubExcerptSettings> {
		const unifiedData = await this.readUnifiedLocalReaderData();
		if (Object.prototype.hasOwnProperty.call(unifiedData, "excerptSettings")) {
			return this.normalizeExcerptSettings(unifiedData.excerptSettings);
		}

		return (await this.readLegacyExcerptSettings()) ?? { ...DEFAULT_EPUB_EXCERPT_SETTINGS };
	}

	async saveExcerptSettings(settings: EpubExcerptSettings): Promise<void> {
		const normalizedSettings = this.normalizeExcerptSettings(settings);
		await this.updateUnifiedLocalReaderData((localData) => {
			localData.excerptSettings = normalizedSettings;
		});
	}

	private getDefaultReaderSettingsForCurrentDevice(): EpubReaderSettings {
		return getDefaultEpubReaderSettings(this.getCurrentDeviceKind());
	}

	private getDefaultReaderSettingsForDevice(
		deviceKind: EpubReaderSettingsDeviceKind
	): EpubReaderSettings {
		return getDefaultEpubReaderSettings(deviceKind);
	}

	private normalizeExcerptSettings(value: unknown): EpubExcerptSettings {
		return normalizeExcerptSettings(value);
	}

	private normalizeReaderSettingsForDevice(
		deviceKind: EpubReaderSettingsDeviceKind,
		settings: Partial<EpubReaderSettings>
	): EpubReaderSettings {
		return normalizeReaderSettingsForDevice(deviceKind, settings);
	}

	private normalizeLoadedReaderSettings(settings: Partial<EpubReaderSettings>): EpubReaderSettings {
		return this.normalizeReaderSettingsForDevice(this.getCurrentDeviceKind(), settings);
	}

		private getLegacyReaderSettingsPath(): string {
		return `${this.basePath}/reader-settings.json`;
	}

	private mergeArrayByKey<T>(
		current: T[] | undefined,
		incoming: T[],
		getKey: (item: T, index: number) => string
	): { merged: T[]; changed: boolean } {
		const existing = Array.isArray(current) ? current : [];
		if (incoming.length === 0) {
			return {
				merged: existing,
				changed: false,
			};
		}

		const merged = [...existing];
		const keys = new Set(existing.map((item, index) => getKey(item, index)));
		let changed = current === undefined && incoming.length > 0;

		for (const [index, item] of incoming.entries()) {
			const key = getKey(item, index);
			if (keys.has(key)) {
				continue;
			}
			keys.add(key);
			merged.push(item);
			changed = true;
		}

		return { merged, changed };
	}

	private async collectLegacyScopedFiles(rootPath: string, fileNames: string[]): Promise<string[]> {
		const normalizedRoot = normalizePath(rootPath);
		const adapter = this.app.vault.adapter as {
			list?: (path: string) => Promise<{ files?: string[]; folders?: string[] }>;
		};
		if (!normalizedRoot || typeof adapter.list !== "function") {
			return [];
		}

		if (!(await this.app.vault.adapter.exists(normalizedRoot))) {
			return [];
		}

		const result: string[] = [];
		const rootListing = await adapter.list(normalizedRoot);
		for (const filePath of rootListing.files || []) {
			const fileName = filePath.split("/").pop() || "";
			if (fileNames.includes(fileName)) {
				result.push(normalizePath(filePath));
			}
		}

		for (const folderPath of rootListing.folders || []) {
			const listing = await adapter.list(folderPath);
			for (const filePath of listing.files || []) {
				const fileName = filePath.split("/").pop() || "";
				if (fileNames.includes(fileName)) {
					result.push(normalizePath(filePath));
				}
			}
		}

		return result;
	}

	private async listLegacyLocalDataFiles(): Promise<string[]> {
		const adapter = this.app.vault.adapter;
		const files = new Set<string>();
		const tryAdd = async (path: string) => {
			const normalizedPath = normalizePath(path);
			if (normalizedPath && (await adapter.exists(normalizedPath))) {
				files.add(normalizedPath);
			}
		};

		for (const path of [
			`${this.basePath}/books.json`,
			`${this.basePath}/reader-settings.json`,
			`${this.basePath}/reader-settings.desktop.json`,
			`${this.basePath}/reader-settings.mobile.json`,
			`${this.basePath}/excerpt-settings.json`,
			`${this.basePath}/canvas-bindings.json`,
			`${this.basePath}/epub-source-registry.json`,
			`${this.basePath}/epub-scan-index.json`,
			`${this.basePath}/bookshelf-index.json`,
			`${this.basePath}/bookshelf-membership.json`,
			...this.getLegacyUnifiedLocalDataPaths(),
			normalizePath(`${this.getLocalReaderStateRoot()}/reader-settings.desktop.json`),
			normalizePath(`${this.getLocalReaderStateRoot()}/reader-settings.mobile.json`),
		]) {
			await tryAdd(path);
		}

		for (const scopedPath of await this.collectLegacyScopedFiles(this.basePath, [
			"bookmarks.json",
			"highlights.json",
			"notes.json",
			"state.json",
			"last-open-bookmark.json",
			"concealed-texts.json",
		])) {
			files.add(scopedPath);
		}

		for (const scopedPath of await this.collectLegacyScopedFiles(this.getLocalReaderStateRoot(), [
			"state.json",
			"last-open-bookmark.json",
		])) {
			files.add(scopedPath);
		}

		for (const scopedPath of await this.collectLegacyScopedFiles(
			this.getLocalReaderArtifactsRoot(),
			["concealed-texts.json"]
		)) {
			files.add(scopedPath);
		}

		return Array.from(files).sort();
	}

	private extractLegacyBookId(filePath: string): string | null {
		const normalizedPath = normalizePath(filePath);
		const mappings = [
			normalizePath(`${this.basePath}/`),
			normalizePath(`${this.getLocalReaderStateRoot()}/`),
			normalizePath(`${this.getLocalReaderArtifactsRoot()}/`),
		];

		for (const prefix of mappings) {
			if (!normalizedPath.startsWith(prefix)) {
				continue;
			}
			const relativePath = normalizedPath.slice(prefix.length);
			const segments = relativePath.split("/").filter(Boolean);
			if (segments.length >= 2) {
				return segments[0] || null;
			}
		}

		return null;
	}

	async inspectLocalDataMigrationStatus(): Promise<EpubLocalDataMigrationInspection> {
		const legacyFiles = await this.listLegacyLocalDataFiles();
		return {
			hasUnifiedDataFile: await this.hasUnifiedLocalDataFile(),
			legacyFileCount: legacyFiles.length,
			legacyFiles,
		};
	}

	async migrateLegacyLocalData(
		options: { cleanupLegacyFiles?: boolean } = {}
	): Promise<EpubLocalDataMigrationReport> {
		const cleanupLegacyFiles = options.cleanupLegacyFiles === true;
		const failures: Array<{ path: string; message: string }> = [];
		const unifiedData = this.cloneLocalReaderData(await this.readUnifiedLocalReaderData());
		let migratedSectionCount = 0;
		let changed = false;

		const markChanged = () => {
			changed = true;
			migratedSectionCount += 1;
		};

		const legacyBooks = await this.readLegacyBooks();
		if (Object.keys(legacyBooks).length > 0) {
			unifiedData.bookCatalogStoredLocally = true;
		}
		for (const [bookId, book] of Object.entries(legacyBooks)) {
			unifiedData.books = unifiedData.books || {};
			const current = unifiedData.books[bookId] || {};
			let bookChanged = false;

			if (!current.descriptor) {
				current.descriptor = this.toStoredBookDescriptor(book);
				bookChanged = true;
			}

			if (!current.state) {
				current.state = {
					currentPosition: book.currentPosition,
					readingStats: book.readingStats,
				};
				bookChanged = true;
			}

			if (bookChanged) {
				unifiedData.books[bookId] = current;
				markChanged();
			}
		}

		for (const deviceKind of ["desktop", "mobile"] as const) {
			const legacySettings = await this.readLegacyReaderSettings(deviceKind);
			if (
				legacySettings &&
				!Object.prototype.hasOwnProperty.call(unifiedData.readerSettings || {}, deviceKind)
			) {
				unifiedData.readerSettings = unifiedData.readerSettings || {};
				unifiedData.readerSettings[deviceKind] = legacySettings;
				markChanged();
			}
		}

		const legacyExcerptSettings = await this.readLegacyExcerptSettings();
		if (
			!Object.prototype.hasOwnProperty.call(unifiedData, "excerptSettings") &&
			legacyExcerptSettings
		) {
			unifiedData.excerptSettings = legacyExcerptSettings;
			markChanged();
		}

		const legacyCanvasBindings = await this.readLegacyCanvasBindings();
		if (
			legacyCanvasBindings &&
			Object.keys(legacyCanvasBindings).length > 0 &&
			(!unifiedData.canvasBindings || Object.keys(unifiedData.canvasBindings).length === 0)
		) {
			unifiedData.canvasBindings = legacyCanvasBindings;
			markChanged();
		}

		const legacyScanIndex = await this.readStoredScanIndex();
		if (legacyScanIndex) {
			const mergeResult = this.mergeArrayByKey(unifiedData.scanIndex, legacyScanIndex, (entry) =>
				normalizePath(entry.path || "")
			);
			if (mergeResult.changed) {
				await this.writeCachedScanIndex(mergeResult.merged);
				if (Object.prototype.hasOwnProperty.call(unifiedData, "scanIndex")) {
					unifiedData.scanIndex = undefined;
				}
				markChanged();
			}
		}
		if (legacyScanIndex === null) {
			const legacyBookshelfIndex = await this.readStoredBookshelfIndex();
			if (legacyBookshelfIndex !== null) {
				await this.writeCachedScanIndex(
					legacyBookshelfIndex.map((entry) => ({
						...entry,
						mtime: 0,
					}))
				);
				if (Object.prototype.hasOwnProperty.call(unifiedData, "scanIndex")) {
					unifiedData.scanIndex = undefined;
				}
				markChanged();
			}
		}

		const legacyMembership = await this.readStoredBookshelfMembership();
		if (
			legacyMembership
			&& !Object.prototype.hasOwnProperty.call(unifiedData, "bookshelfMembership")
		) {
			const mergeResult = this.mergeArrayByKey(
				unifiedData.bookshelfMembership,
				legacyMembership,
				(entry) => normalizePath(entry.path || "")
			);
			if (mergeResult.changed) {
				unifiedData.bookshelfMembership = mergeResult.merged;
				markChanged();
			}
		}

		const legacyRegistry = await this.readStoredSourceRegistry();
		if (legacyRegistry) {
			const mergeResult = this.mergeArrayByKey(
				unifiedData.sourceRegistry,
				legacyRegistry,
				(entry) => entry.sourceId
			);
			if (mergeResult.changed) {
				unifiedData.sourceRegistry = mergeResult.merged;
				markChanged();
			}
		}

		const legacyBookIds = Array.from(
			new Set(
				(await this.listLegacyLocalDataFiles())
					.map((path) => this.extractLegacyBookId(path))
					.filter((bookId): bookId is string => Boolean(bookId))
			)
		).sort();

		for (const bookId of legacyBookIds) {
			unifiedData.books = unifiedData.books || {};
			const current = unifiedData.books[bookId] || {};
			let bookChanged = false;

			const legacyState = await this.readLegacyBookState(bookId);
			const legacyBook = legacyBooks[bookId];
			const bookStateFromBooksFile = legacyBook
				? {
						currentPosition: legacyBook.currentPosition,
						readingStats: legacyBook.readingStats,
				  }
				: null;
			const canOverrideExistingState =
				!Object.prototype.hasOwnProperty.call(current, "state") ||
				(Boolean(legacyState) &&
					Boolean(bookStateFromBooksFile) &&
					JSON.stringify(current.state || null) === JSON.stringify(bookStateFromBooksFile));
			if (legacyState && canOverrideExistingState) {
				current.state = legacyState;
				bookChanged = true;
			}

			if (!Object.prototype.hasOwnProperty.call(current, "lastOpenBookmark")) {
				const legacyLastOpen = await this.readLegacyLastOpenBookmark(bookId);
				if (legacyLastOpen) {
					current.lastOpenBookmark = legacyLastOpen;
					bookChanged = true;
				}
			}

			const legacyConcealedTexts = await this.readLegacyConcealedTexts(bookId);
			if (legacyConcealedTexts && legacyConcealedTexts.length > 0) {
				const mergeResult = this.mergeArrayByKey(
					current.concealedTexts,
					legacyConcealedTexts,
					(entry, index) => entry.id || `${entry.cfiRange || ""}:${entry.createdTime || 0}:${index}`
				);
				if (mergeResult.changed) {
					current.concealedTexts = mergeResult.merged;
					bookChanged = true;
				}
			}

			if (bookChanged) {
				unifiedData.books[bookId] = current;
				markChanged();
			}
		}

		if (changed) {
			await this.writeUnifiedLocalReaderData(unifiedData);
		}

		if (cleanupLegacyFiles && legacyScanIndex) {
			await this.removeStoredCompatibilityFile(this.getLegacyStoredScanIndexPath());
		}

		let removedLegacyFileCount = 0;
		if (cleanupLegacyFiles) {
			const adapter = this.app.vault.adapter as {
				remove?: (path: string) => Promise<void>;
			};
			for (const legacyPath of await this.listLegacyLocalDataFiles()) {
				if (typeof adapter.remove !== "function") {
					failures.push({
						path: legacyPath,
						message: "当前适配器不支持删除旧 EPUB 本地数据文件。",
					});
					continue;
				}

				try {
					if (await this.app.vault.adapter.exists(legacyPath)) {
						await adapter.remove(legacyPath);
						removedLegacyFileCount += 1;
					}
				} catch (error) {
					failures.push({
						path: legacyPath,
						message: error instanceof Error ? error.message : String(error),
					});
				}
			}

			await Promise.all([
				DirectoryUtils.pruneEmptyDirsUnder(this.app.vault.adapter as unknown, this.basePath, {
					preserveRoot: false,
				}),
				DirectoryUtils.pruneEmptyDirsUnder(
					this.app.vault.adapter as unknown,
					this.getLocalReaderStateRoot(),
					{ preserveRoot: false }
				),
				DirectoryUtils.pruneEmptyDirsUnder(
					this.app.vault.adapter as unknown,
					this.getLocalReaderArtifactsRoot(),
					{ preserveRoot: false }
				),
			]);
		}

		return {
			migratedSectionCount,
			removedLegacyFileCount,
			remainingLegacyFiles: await this.listLegacyLocalDataFiles(),
			failures,
		};
	}

	private async loadCanvasBindings(): Promise<Record<string, string>> {
		const unifiedData = await this.readUnifiedLocalReaderData();
		if (unifiedData.canvasBindings && typeof unifiedData.canvasBindings === "object") {
			return { ...unifiedData.canvasBindings };
		}

		return (await this.readLegacyCanvasBindings()) ?? {};
	}

	private async saveCanvasBindings(bindings: Record<string, string>): Promise<void> {
		const normalizedBindings = Object.fromEntries(
			Object.entries(bindings || {})
				.map(
					([bookId, canvasPath]) =>
						[String(bookId || "").trim(), normalizePath(unknownPlainText(canvasPath).trim())] as const
				)
				.filter(([bookId, canvasPath]) => Boolean(bookId) && Boolean(canvasPath))
		);
		await this.updateUnifiedLocalReaderData((localData) => {
			localData.canvasBindings = normalizedBindings;
		});
	}

	private async loadCanvasExcerptAnchors(): Promise<Record<string, CanvasExcerptAnchorRecord>> {
		const unifiedData = await this.readUnifiedLocalReaderData();
		if (unifiedData.canvasExcerptAnchors && typeof unifiedData.canvasExcerptAnchors === "object") {
			return { ...unifiedData.canvasExcerptAnchors };
		}
		return {};
	}

	private async saveCanvasExcerptAnchors(
		anchors: Record<string, CanvasExcerptAnchorRecord>
	): Promise<void> {
		const normalizedAnchors = normalizeCanvasExcerptAnchorsMap(anchors);
		await this.updateUnifiedLocalReaderData((localData) => {
			localData.canvasExcerptAnchors = normalizedAnchors;
		});
	}

	private remapPath(filePath: string, oldPath: string, newPath: string): string | null {
		const normalizedFilePath = normalizePath(filePath || "");
		if (!normalizedFilePath) {
			return null;
		}

		if (normalizedFilePath === oldPath) {
			return newPath;
		}

		if (normalizedFilePath.startsWith(`${oldPath}/`)) {
			return `${newPath}${normalizedFilePath.slice(oldPath.length)}`;
		}

		return null;
	}
}

export interface EpubExcerptSettings {
	addCreationTime: boolean;
	strikethroughDisplayMode: EpubStrikethroughDisplayMode;
	showStrikethroughInSidebar: boolean;
	bookNotesExportTemplate: "template1" | "template2";
	bookNotesExportIncludeHighlight: boolean;
	bookNotesExportIncludeUnderline: boolean;
	bookNotesExportIncludeStrikethrough: boolean;
	bookNotesExportIncludeWavy: boolean;
}

export const DEFAULT_EPUB_EXCERPT_SETTINGS: EpubExcerptSettings = {
	addCreationTime: false,
	strikethroughDisplayMode: "conceal",
	showStrikethroughInSidebar: false,
	bookNotesExportTemplate: "template1",
	bookNotesExportIncludeHighlight: true,
	bookNotesExportIncludeUnderline: true,
	bookNotesExportIncludeStrikethrough: true,
	bookNotesExportIncludeWavy: true,
};

type EpubStoragePendingProgressPayload = import("./epub-progress-store").EpubPendingProgressPayload;

function isEpubStorageServiceLike(service: unknown): service is EpubStorageService {
	return typeof service === "object" && service !== null;
}

function readLegacyPendingProgress(service: EpubStorageService): EpubStoragePendingProgressPayload | null {
	if (!isEpubStorageServiceLike(service)) {
		return null;
	}
	const progressStore: unknown = Reflect.get(service as object, "progressStore");
	if (progressStore instanceof EpubProgressStore) {
		return progressStore.readPending();
	}
	const pending: unknown = Reflect.get(service as object, "_pendingProgress");
	return normalizePendingProgressPayload(pending);
}

function clearLegacyPendingProgressTimer(service: EpubStorageService): void {
	if (!isEpubStorageServiceLike(service)) {
		return;
	}
	const progressStore: unknown = Reflect.get(service as object, "progressStore");
	if (progressStore instanceof EpubProgressStore) {
		progressStore.clearTimer();
		return;
	}
	const timer: unknown = Reflect.get(service as object, "_progressDebounceTimer");
	if (typeof timer === "number") {
		window.clearTimeout(timer);
	}
	Reflect.set(service as object, "_progressDebounceTimer", null);
}

function clearLegacyPendingProgress(service: EpubStorageService): void {
	if (!isEpubStorageServiceLike(service)) {
		return;
	}
	const progressStore: unknown = Reflect.get(service as object, "progressStore");
	if (progressStore instanceof EpubProgressStore) {
		progressStore.clearPending();
		return;
	}
	Reflect.set(service as object, "_pendingProgress", null);
}

async function flushEpubStoragePendingProgressState(service: EpubStorageService): Promise<void> {
	if (!isEpubStorageServiceLike(service)) {
		return;
	}
	if (typeof service.flushPendingProgress === "function") {
		await service.flushPendingProgress();
		return;
	}
	clearLegacyPendingProgressTimer(service);
	const pending = readLegacyPendingProgress(service);
	if (!pending) {
		return;
	}
	clearLegacyPendingProgress(service);
	try {
		const canonicalBookId = await service.resolveCanonicalBookId(pending.bookId);
		const book = await service.getBook(canonicalBookId);
		if (book) {
			book.currentPosition = pending.position;
			if (pending.readingStats) {
				book.readingStats = normalizeReadingPaceStats(pending.readingStats);
			}
			book.readingStats.lastReadTime = Date.now();
			await service.writeBookState(book.id, {
				currentPosition: book.currentPosition,
				readingStats: book.readingStats,
			});
		}
	} catch (error) {
		logger.warn("[EpubStorageService] flushPendingProgress failed:", error);
	}
}

/** Flush debounced reading progress even when the service instance predates `flushPendingProgress`. */
export async function flushEpubStoragePendingProgress(service: EpubStorageService): Promise<void> {
	await flushEpubStoragePendingProgressState(service);
}
