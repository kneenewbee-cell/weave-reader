import type { EpubBook, ReadingStats } from "./types";

export type BookshelfReadingStatus = "未开始" | "阅读中" | "已读完";

export function isBookCompleted(
	stats: Pick<ReadingStats, "completedTime"> | null | undefined
): boolean {
	const completedTime = stats?.completedTime;
	return typeof completedTime === "number" && Number.isFinite(completedTime) && completedTime > 0;
}

export function clampReadingPercent(percent: number): number {
	if (!Number.isFinite(percent)) {
		return 0;
	}
	return Math.max(0, Math.min(100, Math.round(percent)));
}

/** Display progress for UI and bookshelf; frozen at 100% after user-confirmed completion. */
export function resolveDisplayProgress(
	book: Pick<EpubBook, "currentPosition" | "readingStats">,
	rawPercent?: number
): number {
	if (isBookCompleted(book.readingStats)) {
		return 100;
	}
	const percent =
		typeof rawPercent === "number" && Number.isFinite(rawPercent)
			? rawPercent
			: book.currentPosition?.percent ?? 0;
	return clampReadingPercent(percent);
}

export function resolveBookshelfReadingStatus(
	book: Pick<EpubBook, "currentPosition" | "readingStats">
): BookshelfReadingStatus {
	if (isBookCompleted(book.readingStats)) {
		return "已读完";
	}
	const progress = clampReadingPercent(book.currentPosition?.percent ?? 0);
	const lastReadTime = book.readingStats?.lastReadTime ?? 0;
	if (progress > 0 || lastReadTime > 0) {
		return "阅读中";
	}
	return "未开始";
}
