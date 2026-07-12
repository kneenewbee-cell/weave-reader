import type { App } from "obsidian";
import { logger } from "../../utils/logger";
import type { EpubAnnotationService } from "./EpubAnnotationService";
import type {
	EpubAnnotationBacklinkPort,
	EpubAnnotationBacklinkServicePort,
} from "./annotation-index-ports";
import { getEpubBacklinkHighlightService } from "./epub-backlink-highlight-access";
import { getEpubHighlightViewSnapshotService } from "./epub-highlight-view-snapshot-access";
import { canUseEpubExcerptNotes } from "./epub-premium";
import type { EpubHighlightSnapshotContextInput } from "./EpubHighlightViewSnapshotService";
import type { EpubReaderEngine } from "./reader-engine-types";
import { getEpubStorageService } from "./epub-storage-access";

const DEFAULT_BOOTSTRAP_IDLE_DELAY_MS = 2_000;
const DEFAULT_BOOKSHELF_WARMUP_DELAY_MS = 8_000;
const DEFAULT_BACKGROUND_BOOK_GAP_MS = 120;
const RECENT_BOOK_PREFETCH_LIMIT = 5;

export type EpubAnnotationIndexReadiness = "unknown" | "preparing" | "ready";

export interface EpubAnnotationPrefetchInput extends EpubHighlightSnapshotContextInput {
	annotationService?: EpubAnnotationService;
	backlinkService?: EpubAnnotationBacklinkPort | EpubAnnotationBacklinkServicePort;
	readerService?: EpubReaderEngine | null;
	highlightRevision?: number;
	priority?: "immediate" | "background";
}

/**
 * Tier-1 annotation index: warms excerpt disk cache + render snapshots per book
 * so notes panels can show stable lists without blocking the reader shell.
 */
export class EpubAnnotationIndexService {
	private static instances = new WeakMap<App, EpubAnnotationIndexService>();

	private readinessByContextKey = new Map<string, EpubAnnotationIndexReadiness>();
	private inflightPrefetchByContextKey = new Map<string, Promise<void>>();
	private bookshelfWarmupTimer: ReturnType<typeof setTimeout> | null = null;
	private inflightBookshelfWarmup: Promise<void> | null = null;
	private cancelled = false;
	private warmedBookPaths = new Set<string>();

	static forApp(app: App): EpubAnnotationIndexService {
		let instance = EpubAnnotationIndexService.instances.get(app);
		if (!instance) {
			instance = new EpubAnnotationIndexService(app);
			EpubAnnotationIndexService.instances.set(app, instance);
		}
		return instance;
	}

	private constructor(private readonly app: App) {}

	buildContextKey(input: EpubHighlightSnapshotContextInput): string {
		return getEpubHighlightViewSnapshotService(this.app).buildContextKey(input);
	}

	getReadiness(input: EpubHighlightSnapshotContextInput): EpubAnnotationIndexReadiness {
		const snapshotService = getEpubHighlightViewSnapshotService(this.app);
		if (snapshotService.getCachedSnapshot(input)) {
			return "ready";
		}
		const contextKey = this.buildContextKey(input);
		const tracked = this.readinessByContextKey.get(contextKey);
		if (tracked === "preparing") {
			return "preparing";
		}
		return tracked || "unknown";
	}

	async waitForReady(input: EpubHighlightSnapshotContextInput): Promise<void> {
		const contextKey = this.buildContextKey(input);
		const inflight = this.inflightPrefetchByContextKey.get(contextKey);
		if (inflight) {
			await inflight.catch(() => undefined);
		}
	}

	scheduleBookshelfWarmup(
		delayMs = DEFAULT_BOOKSHELF_WARMUP_DELAY_MS,
		options?: { forceAll?: boolean }
	): void {
		if (!canUseEpubExcerptNotes(this.app)) {
			return;
		}
		if (options?.forceAll) {
			this.warmedBookPaths.clear();
		}
		if (this.bookshelfWarmupTimer) {
			window.clearTimeout(this.bookshelfWarmupTimer);
		}
		this.cancelled = false;
		this.bookshelfWarmupTimer = window.setTimeout(() => {
			this.bookshelfWarmupTimer = null;
			void this.warmBookshelfMembers();
		}, delayMs);
	}

	cancel(): void {
		this.cancelled = true;
		if (this.bookshelfWarmupTimer) {
			window.clearTimeout(this.bookshelfWarmupTimer);
			this.bookshelfWarmupTimer = null;
		}
	}

	warmBookPaths(paths: string[], input?: Omit<EpubAnnotationPrefetchInput, "bookId" | "filePath">): void {
		if (!canUseEpubExcerptNotes(this.app)) {
			return;
		}
		const pending = Array.from(
			new Set(paths.map((path) => String(path || "").trim()).filter(Boolean))
		).filter((path) => !this.warmedBookPaths.has(path));
		if (pending.length === 0) {
			return;
		}
		void this.warmBookPathList(pending, input);
	}

	async bootstrapAfterLayoutReady(): Promise<void> {
		if (!canUseEpubExcerptNotes(this.app)) {
			return;
		}

		const storage = getEpubStorageService(this.app);
		let excerptSettings: Awaited<ReturnType<typeof storage.loadExcerptSettings>>;
		let books: Awaited<ReturnType<typeof storage.loadBooks>>;
		try {
			[excerptSettings, books] = await Promise.all([
				storage.loadExcerptSettings(),
				storage.loadBooks({ hydrateStates: true }),
			]);
		} catch (error) {
			logger.warn("[EpubAnnotationIndex] Bootstrap failed to load local reader data:", error);
			return;
		}

		const showStrikethroughHighlights = Boolean(excerptSettings.showStrikethroughInSidebar);
		const recentBooks = Object.values(books)
			.filter((book) => String(book.filePath || "").trim())
			.sort(
				(left, right) =>
					(right.readingStats?.lastReadTime || 0) - (left.readingStats?.lastReadTime || 0)
			)
			.slice(0, RECENT_BOOK_PREFETCH_LIMIT);

		for (const book of recentBooks) {
			if (this.cancelled) {
				return;
			}
			await this.prefetchBook({
				bookId: book.id,
				filePath: book.filePath,
				showStrikethroughHighlights,
				priority: "background",
			});
			await sleep(80);
		}
	}

	async prefetchBook(input: EpubAnnotationPrefetchInput): Promise<void> {
		if (!canUseEpubExcerptNotes(this.app)) {
			return;
		}

		const normalizedBookId = String(input.bookId || "").trim();
		const normalizedFilePath = String(input.filePath || "").trim();
		if (!normalizedBookId || !normalizedFilePath) {
			return;
		}

		const contextKey = this.buildContextKey(input);
		const snapshotService = getEpubHighlightViewSnapshotService(this.app);

		await snapshotService.hydrateFromDisk(input);

		const existingInflight = this.inflightPrefetchByContextKey.get(contextKey);
		if (snapshotService.getCachedSnapshot(input)) {
			this.readinessByContextKey.set(contextKey, "ready");
			if (input.priority === "background") {
				if (existingInflight) {
					await existingInflight.catch(() => undefined);
				}
				return;
			}
		}

		if (existingInflight) {
			if (input.priority === "immediate") {
				await existingInflight.catch(() => undefined);
			}
			return;
		}

		if (!snapshotService.getCachedSnapshot(input)) {
			this.readinessByContextKey.set(contextKey, "preparing");
		}

		const prefetchPromise = this.runPrefetch(input, contextKey).finally(() => {
			if (this.inflightPrefetchByContextKey.get(contextKey) === prefetchPromise) {
				this.inflightPrefetchByContextKey.delete(contextKey);
			}
		});
		this.inflightPrefetchByContextKey.set(contextKey, prefetchPromise);
		if (input.priority === "immediate") {
			await prefetchPromise;
		}
	}

	private async runPrefetch(
		input: EpubAnnotationPrefetchInput,
		contextKey: string
	): Promise<void> {
		const snapshotService = getEpubHighlightViewSnapshotService(this.app);
		try {
			const storage = getEpubStorageService(this.app);
			const backlink = input.backlinkService || getEpubBacklinkHighlightService(this.app);
			const canvasPath = await storage.getCanvasBinding(input.bookId);

			if (input.annotationService && input.filePath) {
				const preloadedHighlights = await input.annotationService.collectAllHighlights(
					input.bookId,
					input.filePath,
					backlink
				);
				await snapshotService.revalidateSnapshot({
					bookId: input.bookId,
					filePath: input.filePath,
					showStrikethroughHighlights: input.showStrikethroughHighlights,
					annotationService: input.annotationService,
					backlinkService: backlink,
					readerService: input.readerService,
					highlightRevision: input.highlightRevision,
					preloadedHighlights,
				});
			} else {
				await backlink.collectHighlights(input.filePath, canvasPath);
			}

			if (snapshotService.getCachedSnapshot(input)) {
				this.readinessByContextKey.set(contextKey, "ready");
				this.warmedBookPaths.add(input.filePath);
			} else {
				this.readinessByContextKey.set(contextKey, "unknown");
			}
		} catch (error) {
			logger.debug("[EpubAnnotationIndex] Prefetch failed:", {
				bookId: input.bookId,
				filePath: input.filePath,
				error,
			});
			if (snapshotService.getCachedSnapshot(input)) {
				this.readinessByContextKey.set(contextKey, "ready");
			} else {
				this.readinessByContextKey.set(contextKey, "unknown");
			}
		}
	}

	private async warmBookPathList(
		paths: string[],
		input?: Omit<EpubAnnotationPrefetchInput, "bookId" | "filePath">
	): Promise<void> {
		const storage = getEpubStorageService(this.app);
		let excerptSettings: Awaited<ReturnType<typeof storage.loadExcerptSettings>> | null = null;

		for (const filePath of paths) {
			if (this.cancelled) {
				return;
			}
			const normalizedPath = String(filePath || "").trim();
			if (!normalizedPath || this.warmedBookPaths.has(normalizedPath)) {
				continue;
			}

			try {
				const book = await storage.findBookByFilePath(normalizedPath);
				if (!book?.id) {
					continue;
				}
				if (!excerptSettings) {
					excerptSettings = await storage.loadExcerptSettings();
				}
				await this.prefetchBook({
					bookId: book.id,
					filePath: normalizedPath,
					showStrikethroughHighlights: Boolean(
						input?.showStrikethroughHighlights ??
							excerptSettings.showStrikethroughInSidebar
					),
					annotationService: input?.annotationService,
					backlinkService: input?.backlinkService,
					readerService: input?.readerService,
					highlightRevision: input?.highlightRevision,
					priority: "background",
				});
			} catch (error) {
				logger.debug("[EpubAnnotationIndex] Skipped warming book:", {
					path: normalizedPath,
					error,
				});
			}

			await sleep(DEFAULT_BACKGROUND_BOOK_GAP_MS);
		}
	}

	private async warmBookshelfMembers(): Promise<void> {
		if (this.cancelled) {
			return;
		}
		if (this.inflightBookshelfWarmup) {
			await this.inflightBookshelfWarmup.catch(() => undefined);
			return;
		}

		const warmupPromise = (async () => {
			const storage = getEpubStorageService(this.app);
			let entries: Awaited<ReturnType<typeof storage.listBookshelfEntries>>;
			try {
				entries = await storage.listBookshelfEntries();
			} catch (error) {
				logger.warn("[EpubAnnotationIndex] Failed to load bookshelf membership:", error);
				return;
			}

			await this.warmBookPathList(entries.map((entry) => entry.path));
		})();

		this.inflightBookshelfWarmup = warmupPromise;
		try {
			await warmupPromise;
		} finally {
			if (this.inflightBookshelfWarmup === warmupPromise) {
				this.inflightBookshelfWarmup = null;
			}
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function getEpubAnnotationIndexService(app: App): EpubAnnotationIndexService {
	return EpubAnnotationIndexService.forApp(app);
}

export function bootstrapEpubAnnotationIndex(app: App): void {
	if (!canUseEpubExcerptNotes(app)) {
		return;
	}
	void EpubAnnotationIndexService.forApp(app).bootstrapAfterLayoutReady();
}

export function scheduleEpubAnnotationIndexWarmup(
	app: App,
	delayMs = DEFAULT_BOOTSTRAP_IDLE_DELAY_MS,
	options?: { forceAll?: boolean }
): void {
	EpubAnnotationIndexService.forApp(app).scheduleBookshelfWarmup(delayMs, options);
}

export function warmEpubAnnotationIndexForPaths(app: App, paths: string[]): void {
	EpubAnnotationIndexService.forApp(app).warmBookPaths(paths);
}
