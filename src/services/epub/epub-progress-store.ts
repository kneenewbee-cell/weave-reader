import { logger } from "../../utils/logger";
import { normalizeReadingPaceStats } from "./reading-pace";
import type { EpubBook, ReadingPosition, ReadingStats } from "./types";

export interface EpubPendingProgressPayload {
	bookId: string;
	position: ReadingPosition;
	readingStats?: ReadingStats;
}

export interface EpubProgressStorePort {
	resolveCanonicalBookId(bookId: string): Promise<string>;
	getBook(bookId: string): Promise<EpubBook | null>;
	writeBookState(
		bookId: string,
		state: { currentPosition: ReadingPosition; readingStats: ReadingStats }
	): Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 300;

export class EpubProgressStore {
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private pending: EpubPendingProgressPayload | null = null;

	constructor(
		private readonly port: EpubProgressStorePort,
		private readonly debounceMs = DEFAULT_DEBOUNCE_MS,
		private readonly logTag = "[EpubProgressStore]"
	) {}

	scheduleSave(
		bookId: string,
		position: ReadingPosition,
		readingStats?: ReadingStats
	): void {
		this.pending = { bookId, position, readingStats };
		if (this.debounceTimer) {
			return;
		}
		this.debounceTimer = window.setTimeout(() => {
			void this.flushScheduledSave();
		}, this.debounceMs);
	}

	async flush(): Promise<void> {
		this.clearTimer();
		const pending = this.pending;
		if (!pending) {
			return;
		}
		this.pending = null;
		await this.persistPending(pending);
	}

	readPending(): EpubPendingProgressPayload | null {
		return this.pending ? { ...this.pending } : null;
	}

	clearTimer(): void {
		if (this.debounceTimer) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	clearPending(): void {
		this.pending = null;
	}

	private async flushScheduledSave(): Promise<void> {
		this.debounceTimer = null;
		const pending = this.pending;
		if (!pending) {
			return;
		}
		this.pending = null;
		await this.persistPending(pending);
	}

	private async persistPending(pending: EpubPendingProgressPayload): Promise<void> {
		try {
			const canonicalBookId = await this.port.resolveCanonicalBookId(pending.bookId);
			const book = await this.port.getBook(canonicalBookId);
			if (!book) {
				return;
			}
			book.currentPosition = pending.position;
			if (pending.readingStats) {
				book.readingStats = normalizeReadingPaceStats(pending.readingStats);
			}
			book.readingStats.lastReadTime = Date.now();
			await this.port.writeBookState(book.id, {
				currentPosition: book.currentPosition,
				readingStats: book.readingStats,
			});
		} catch (error) {
			logger.warn(`${this.logTag} persist failed:`, error);
		}
	}
}

export function normalizePendingProgressPayload(
	value: unknown
): EpubPendingProgressPayload | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as Partial<EpubPendingProgressPayload>;
	if (typeof record.bookId !== "string" || !record.position || typeof record.position !== "object") {
		return null;
	}
	const position = record.position as Record<string, unknown>;
	if (typeof position.cfi !== "string") {
		return null;
	}
	return {
		bookId: record.bookId,
		position: {
			chapterIndex: typeof position.chapterIndex === "number" ? position.chapterIndex : 0,
			cfi: position.cfi,
			percent: typeof position.percent === "number" ? position.percent : 0,
		},
		readingStats: record.readingStats,
	};
}
