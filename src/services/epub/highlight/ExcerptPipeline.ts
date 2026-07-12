import { logger } from "../../../utils/logger";
import type { EpubSavedCardSnapshot } from "../epub-card-highlight-sync";
import { getEpubHighlightSyncPersistencePath } from "../epub-card-highlight-sync";
import type { BacklinkHighlight } from "../EpubBacklinkHighlightService";
import type { ReaderHighlight } from "../reader-engine-types";
import { HighlightIndex } from "./HighlightIndex";

export interface HighlightReloadRequest {
	invalidateCache?: boolean;
	incremental?: boolean;
	delayMs?: number;
}

export interface ExcerptPipelineCardSyncContext {
	card: EpubSavedCardSnapshot;
	extractFromCard: () => Promise<BacklinkHighlight[]>;
	mergeFromSourcePath: (sourcePath: string) => Promise<boolean>;
	applyReaderHighlights: (highlights: ReaderHighlight[]) => boolean;
	requestReload: (request: HighlightReloadRequest) => void;
	rememberSourcePath: (sourcePath?: string | null) => void;
}

export interface ExcerptPipelineOptions {
	cardSyncDedupeMs?: number;
	getEnableDebugMode?: () => boolean;
}

export class ExcerptPipeline {
	private readonly recentCardSyncAt = new Map<string, number>();
	private readonly cardSyncDedupeMs: number;
	private readonly getEnableDebugMode?: () => boolean;

	constructor(
		readonly highlightIndex: HighlightIndex,
		options: ExcerptPipelineOptions = {}
	) {
		this.cardSyncDedupeMs = options.cardSyncDedupeMs ?? 600;
		this.getEnableDebugMode = options.getEnableDebugMode;
	}

	shouldSkipDuplicateCardSync(card: EpubSavedCardSnapshot): boolean {
		const key = String(card.uuid || card.sourceFile || "").trim();
		if (!key) {
			return false;
		}
		const now = Date.now();
		const lastSyncAt = this.recentCardSyncAt.get(key);
		if (lastSyncAt !== undefined && now - lastSyncAt < this.cardSyncDedupeMs) {
			return true;
		}
		this.recentCardSyncAt.set(key, now);
		return false;
	}

	async handleCardSaved(context: ExcerptPipelineCardSyncContext): Promise<void> {
		const startedAt = this.getEnableDebugMode?.() ? performance.now() : 0;
		const { card } = context;
		if (this.shouldSkipDuplicateCardSync(card)) {
			return;
		}

		let optimisticApplied = false;
		try {
			const parsed = await context.extractFromCard();
			if (parsed.length > 0) {
				for (const highlight of parsed) {
					this.highlightIndex.upsert(highlight);
				}
				const incoming: ReaderHighlight[] = parsed.map((highlight) => ({
					...highlight,
					presentation: "highlight" as const,
				}));
				optimisticApplied = context.applyReaderHighlights(incoming);
			}
		} catch (error) {
			logger.warn("[ExcerptPipeline] Failed optimistic card highlight sync:", error);
		}

		const persistenceSourcePath = getEpubHighlightSyncPersistencePath(card);
		if (persistenceSourcePath) {
			context.rememberSourcePath(persistenceSourcePath);
		}

		if (optimisticApplied) {
			if (startedAt > 0) {
				logger.debug(
					`[ExcerptPipeline] card saved optimistic sync in ${(performance.now() - startedAt).toFixed(1)}ms`
				);
			}
			if (persistenceSourcePath) {
				context.requestReload({ incremental: true, delayMs: 450 });
			}
			return;
		}

		const sourcePath = persistenceSourcePath || "";
		if (sourcePath) {
			const mergedFromDisk = await context.mergeFromSourcePath(sourcePath);
			if (mergedFromDisk) {
				return;
			}
		}

		context.requestReload({ incremental: true, delayMs: 300 });
	}

	syncCollectedHighlights(highlights: BacklinkHighlight[]): void {
		this.highlightIndex.buildFrom(highlights);
	}

	requestReload(request: HighlightReloadRequest, schedule: (request: HighlightReloadRequest) => void): void {
		schedule(request);
	}
}
