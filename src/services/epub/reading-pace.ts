import type { ReadingStats } from "./types";

/** Minimum interval WPM kept in samples. */
export const PACE_MIN_WPM = 40;
/** Kindle-style upper bound for speed-reading outliers. */
export const PACE_MAX_WPM = 900;
/** Ignore very short page turns (accidental flips). */
export const PACE_MIN_INTERVAL_MS = 3_000;
/** Cap a single page interval (distraction / background). */
export const PACE_MAX_INTERVAL_MS = 300_000;
/** Minimum forward word delta to count an interval. */
export const PACE_MIN_INTERVAL_WORDS = 5;
/** Book-specific WPM stabilizes after this many intervals. */
export const PACE_BOOK_MIN_SAMPLES = 15;
/** Or after this many sampled words in the book. */
export const PACE_BOOK_MIN_WORDS = 600;
export const PACE_RECENT_SAMPLES_MAX = 20;
export const PACE_LEGACY_MIN_READ_MS = 60_000;
export const PACE_HEARTBEAT_MS = 30_000;
export const PACE_IDLE_CUTOFF_MS = 120_000;

export const PACE_DEFAULT_WPM = 260;
export const PACE_DEFAULT_WPM_ZH = 320;
export const PACE_DEFAULT_WPM_EN = 240;

export interface SectionReadingSlice {
	index: number;
	wordCount: number;
	positionStart: number;
	positionCount: number;
}

export interface PaceAnchorSnapshot {
	at: number;
	consumedBookWords: number;
	currentPage: number;
}

export interface RecordPaceIntervalInput {
	stats: ReadingStats;
	wordsRead: number;
	activeMs: number;
	now?: number;
}

export interface RemainingReadingEstimateInput {
	totalWordCount: number;
	sections: SectionReadingSlice[];
	currentChapterIndex: number;
	currentPage: number;
	totalPositions: number;
	percentFallback: number;
	sectionProgression?: number;
	stats: ReadingStats;
	language?: string;
}

export interface RemainingReadingEstimateResult {
	bookMs?: number;
	chapterMs?: number;
	chapterProgressPercent?: number;
	wordsPerMinute?: number;
}

export function resolveDefaultWpm(language?: string): number {
	const normalized = String(language || "")
		.trim()
		.toLowerCase();
	if (!normalized) {
		return PACE_DEFAULT_WPM;
	}
	if (normalized.startsWith("zh") || normalized.startsWith("cmn") || normalized.startsWith("yue")) {
		return PACE_DEFAULT_WPM_ZH;
	}
	if (normalized.startsWith("en")) {
		return PACE_DEFAULT_WPM_EN;
	}
	return PACE_DEFAULT_WPM;
}

export function clampWpm(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return PACE_MIN_WPM;
	}
	return Math.min(PACE_MAX_WPM, Math.max(PACE_MIN_WPM, value));
}

export function computeIntervalWpm(wordsRead: number, activeMs: number): number | undefined {
	if (wordsRead < PACE_MIN_INTERVAL_WORDS || activeMs < PACE_MIN_INTERVAL_MS) {
		return undefined;
	}
	const cappedMs = Math.min(activeMs, PACE_MAX_INTERVAL_MS);
	const wpm = (wordsRead / cappedMs) * 60_000;
	if (!Number.isFinite(wpm)) {
		return undefined;
	}
	return clampWpm(wpm);
}

export function median(values: number[]): number | undefined {
	if (values.length === 0) {
		return undefined;
	}
	const sorted = [...values].sort((left, right) => left - right);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) {
		return sorted[mid];
	}
	return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function normalizeReadingPaceStats(
	stats: Partial<ReadingStats> | null | undefined,
	now = Date.now()
): ReadingStats {
	const base = stats || {};
	return {
		totalReadTime:
			typeof base.totalReadTime === "number" && Number.isFinite(base.totalReadTime)
				? Math.max(0, base.totalReadTime)
				: 0,
		lastReadTime:
			typeof base.lastReadTime === "number" && Number.isFinite(base.lastReadTime)
				? base.lastReadTime
				: now,
		createdTime:
			typeof base.createdTime === "number" && Number.isFinite(base.createdTime)
				? base.createdTime
				: now,
		completedTime:
			typeof base.completedTime === "number" && Number.isFinite(base.completedTime)
				? base.completedTime
				: undefined,
		bookWpm:
			typeof base.bookWpm === "number" && Number.isFinite(base.bookWpm)
				? clampWpm(base.bookWpm)
				: undefined,
		paceSampleCount:
			typeof base.paceSampleCount === "number" && Number.isFinite(base.paceSampleCount)
				? Math.max(0, Math.round(base.paceSampleCount))
				: 0,
		paceSampleWords:
			typeof base.paceSampleWords === "number" && Number.isFinite(base.paceSampleWords)
				? Math.max(0, Math.round(base.paceSampleWords))
				: 0,
		recentIntervalWpms: Array.isArray(base.recentIntervalWpms)
			? base.recentIntervalWpms
					.filter((value) => typeof value === "number" && Number.isFinite(value))
					.map((value) => clampWpm(value))
					.slice(-PACE_RECENT_SAMPLES_MAX)
			: [],
	};
}

export function recordReadingInterval(input: RecordPaceIntervalInput): ReadingStats {
	const now = input.now ?? Date.now();
	const stats = normalizeReadingPaceStats(input.stats, now);
	const intervalWpm = computeIntervalWpm(input.wordsRead, input.activeMs);
	const activeMs = Math.min(Math.max(0, input.activeMs), PACE_MAX_INTERVAL_MS);

	const next: ReadingStats = {
		...stats,
		totalReadTime: stats.totalReadTime + activeMs,
		lastReadTime: now,
	};

	if (!intervalWpm) {
		return next;
	}

	const recentIntervalWpms = [...(stats.recentIntervalWpms || []), intervalWpm].slice(
		-PACE_RECENT_SAMPLES_MAX
	);
	const bookWpm = median(recentIntervalWpms);

	return {
		...next,
		recentIntervalWpms,
		bookWpm,
		paceSampleCount: (stats.paceSampleCount || 0) + 1,
		paceSampleWords: (stats.paceSampleWords || 0) + Math.max(0, Math.round(input.wordsRead)),
	};
}

export function hasStableBookWpm(stats: ReadingStats): boolean {
	return (
		(stats.paceSampleCount || 0) >= PACE_BOOK_MIN_SAMPLES ||
		(stats.paceSampleWords || 0) >= PACE_BOOK_MIN_WORDS
	);
}

export function resolveEffectiveWpm(
	stats: ReadingStats,
	options?: {
		language?: string;
		consumedBookWords?: number;
	}
): number | undefined {
	const normalized = normalizeReadingPaceStats(stats);
	const language = options?.language;
	const consumedBookWords = options?.consumedBookWords ?? 0;

	if (hasStableBookWpm(normalized) && normalized.bookWpm) {
		return normalized.bookWpm;
	}

	const recentMedian = median(normalized.recentIntervalWpms || []);
	if (recentMedian && (normalized.recentIntervalWpms?.length || 0) >= 3) {
		return recentMedian;
	}

	if (
		normalized.totalReadTime >= PACE_LEGACY_MIN_READ_MS &&
		consumedBookWords > 0
	) {
		const legacyWpm = (consumedBookWords / normalized.totalReadTime) * 60_000;
		if (Number.isFinite(legacyWpm) && legacyWpm >= PACE_MIN_WPM) {
			return clampWpm(legacyWpm);
		}
	}

	if (normalized.bookWpm) {
		return normalized.bookWpm;
	}

	return resolveDefaultWpm(language);
}

export function estimateConsumedBookWords(
	sections: SectionReadingSlice[],
	currentPage: number,
	totalWordCount: number,
	percentFallback: number
): number {
	if (totalWordCount <= 0) {
		return 0;
	}
	if (sections.length === 0 || currentPage <= 0) {
		return Math.round((percentFallback / 100) * totalWordCount);
	}

	let consumed = 0;
	for (const section of sections) {
		const sectionStart = section.positionStart + 1;
		const sectionEnd = section.positionStart + Math.max(section.positionCount, 1);
		if (currentPage < sectionStart) {
			break;
		}
		if (currentPage >= sectionEnd) {
			consumed += section.wordCount;
			continue;
		}
		const span = Math.max(section.positionCount - 1, 1);
		const offset = Math.max(0, currentPage - sectionStart);
		const fraction = Math.min(1, offset / span);
		consumed += Math.round(fraction * section.wordCount);
		break;
	}

	return Math.min(totalWordCount, Math.max(0, consumed));
}

export function estimateChapterWordProgress(
	section: SectionReadingSlice | null | undefined,
	currentPage: number,
	sectionProgression = 0
): { consumed: number; remaining: number } {
	if (!section || section.wordCount <= 0) {
		return { consumed: 0, remaining: 0 };
	}

	const sectionStart = section.positionStart + 1;
	const sectionEnd = section.positionStart + Math.max(section.positionCount, 1);
	let fraction = Math.max(0, Math.min(1, sectionProgression));

	if (currentPage > 0) {
		if (currentPage >= sectionEnd) {
			fraction = 1;
		} else if (currentPage >= sectionStart) {
			const span = Math.max(section.positionCount - 1, 1);
			const offset = Math.max(0, currentPage - sectionStart);
			fraction = Math.max(fraction, Math.min(1, offset / span));
		}
	}

	const consumed = Math.round(fraction * section.wordCount);
	return {
		consumed: Math.min(section.wordCount, consumed),
		remaining: Math.max(0, section.wordCount - consumed),
	};
}

function resolveChapterProgressPercent(chapterProgress: {
	consumed: number;
	remaining: number;
}): number | undefined {
	const total = chapterProgress.consumed + chapterProgress.remaining;
	if (total <= 0) {
		return undefined;
	}
	return Math.round((chapterProgress.consumed / total) * 100);
}

export function buildRemainingReadingEstimate(
	input: RemainingReadingEstimateInput
): RemainingReadingEstimateResult {
	const totalWordCount = Math.max(0, input.totalWordCount);
	if (totalWordCount <= 0) {
		return {};
	}

	const consumedBookWords = estimateConsumedBookWords(
		input.sections,
		input.currentPage,
		totalWordCount,
		input.percentFallback
	);
	const remainingBookWords = Math.max(0, totalWordCount - consumedBookWords);

	const currentSection =
		input.sections.find((section) => section.index === input.currentChapterIndex) || null;
	const chapterProgress = estimateChapterWordProgress(
		currentSection,
		input.currentPage,
		input.sectionProgression
	);

	const effectiveWpm = resolveEffectiveWpm(input.stats, {
		language: input.language,
		consumedBookWords,
	});

	if (!effectiveWpm) {
		return {};
	}

	return {
		bookMs:
			remainingBookWords > 0
				? Math.round((remainingBookWords / effectiveWpm) * 60_000)
				: undefined,
		chapterMs:
			chapterProgress.remaining > 0
				? Math.round((chapterProgress.remaining / effectiveWpm) * 60_000)
				: undefined,
		chapterProgressPercent: resolveChapterProgressPercent(chapterProgress),
		wordsPerMinute: effectiveWpm,
	};
}

export function createPaceAnchor(
	consumedBookWords: number,
	currentPage: number,
	now = Date.now()
): PaceAnchorSnapshot {
	return {
		at: now,
		consumedBookWords: Math.max(0, consumedBookWords),
		currentPage: Math.max(0, currentPage),
	};
}

export function shouldRecordPaceInterval(
	wordsRead: number,
	activeMs: number,
	isDocumentVisible: boolean
): boolean {
	if (!isDocumentVisible) {
		return false;
	}
	return computeIntervalWpm(wordsRead, activeMs) !== undefined;
}
