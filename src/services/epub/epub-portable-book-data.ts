import type { App } from "obsidian";
import {
	getEpubPortableBookPath,
	readEpubSemanticJson,
	safeEpubSemanticBookId,
	writeEpubSemanticJson,
} from "./semantic/semantic-store";
import type { ReadingPosition, ReadingStats } from "./types";

export interface EpubPortableReadingState {
	currentPosition: ReadingPosition;
	readingStats: ReadingStats;
}

export interface EpubPortableBookmarkRecord {
	id: string;
	cfi: string;
	chapterIndex: number;
	percent: number;
	chapterTitle: string;
	pageNumber?: number;
	totalPages?: number;
	createdAt: number;
	preview?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finiteNumber(value: unknown, fallback = 0): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cleanString(value: unknown): string {
	return String(value || "").trim();
}

function normalizeReadingPosition(value: unknown): ReadingPosition | null {
	if (!isRecord(value)) {
		return null;
	}
	const cfi = cleanString(value.cfi);
	return {
		chapterIndex: finiteNumber(value.chapterIndex),
		cfi,
		percent: finiteNumber(value.percent),
	};
}

function normalizeReadingStats(value: unknown): ReadingStats | null {
	if (!isRecord(value)) {
		return null;
	}
	return {
		totalReadTime: finiteNumber(value.totalReadTime),
		lastReadTime: finiteNumber(value.lastReadTime),
		createdTime: finiteNumber(value.createdTime),
		...(typeof value.completedTime === "number" && Number.isFinite(value.completedTime)
			? { completedTime: value.completedTime }
			: {}),
		...(typeof value.bookWpm === "number" && Number.isFinite(value.bookWpm)
			? { bookWpm: value.bookWpm }
			: {}),
		...(typeof value.paceSampleCount === "number" && Number.isFinite(value.paceSampleCount)
			? { paceSampleCount: value.paceSampleCount }
			: {}),
		...(typeof value.paceSampleWords === "number" && Number.isFinite(value.paceSampleWords)
			? { paceSampleWords: value.paceSampleWords }
			: {}),
		...(Array.isArray(value.recentIntervalWpms)
			? { recentIntervalWpms: value.recentIntervalWpms.filter((item): item is number => typeof item === "number") }
			: {}),
	};
}

function normalizeBookmarkRecord(value: unknown): EpubPortableBookmarkRecord | null {
	if (!isRecord(value)) {
		return null;
	}
	const id = cleanString(value.id);
	const cfi = cleanString(value.cfi);
	if (!id || !cfi) {
		return null;
	}
	return {
		id,
		cfi,
		chapterIndex: finiteNumber(value.chapterIndex),
		percent: finiteNumber(value.percent),
		chapterTitle: cleanString(value.chapterTitle),
		createdAt: finiteNumber(value.createdAt, Date.now()),
		...(typeof value.pageNumber === "number" && Number.isFinite(value.pageNumber)
			? { pageNumber: value.pageNumber }
			: {}),
		...(typeof value.totalPages === "number" && Number.isFinite(value.totalPages)
			? { totalPages: value.totalPages }
			: {}),
		...(cleanString(value.preview) ? { preview: cleanString(value.preview) } : {}),
	};
}

export async function readEpubPortableReadingState(
	app: App,
	bookId: unknown
): Promise<EpubPortableReadingState | null> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const payload = await readEpubSemanticJson(app, getEpubPortableBookPath(safeBookId, "reading-state.json"));
	if (!isRecord(payload)) {
		return null;
	}
	const currentPosition = normalizeReadingPosition(payload.currentPosition);
	const readingStats = normalizeReadingStats(payload.readingStats);
	if (!currentPosition || !readingStats) {
		return null;
	}
	return { currentPosition, readingStats };
}

export async function hasEpubPortableReadingStateData(
	app: App,
	bookId: unknown
): Promise<boolean> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	return Boolean(await readEpubSemanticJson(app, getEpubPortableBookPath(safeBookId, "reading-state.json")));
}

export async function writeEpubPortableReadingState(
	app: App,
	bookId: unknown,
	state: EpubPortableReadingState
): Promise<void> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	await writeEpubSemanticJson(app, getEpubPortableBookPath(safeBookId, "reading-state.json"), {
		format: "weave-reader-reading-state/v1",
		version: 1,
		bookId: safeBookId,
		updatedAt: Date.now(),
		currentPosition: state.currentPosition,
		readingStats: state.readingStats,
	});
}

export async function readEpubPortableBookmarks(
	app: App,
	bookId: unknown
): Promise<EpubPortableBookmarkRecord[]> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const payload = await readEpubSemanticJson(app, getEpubPortableBookPath(safeBookId, "bookmarks.json"));
	if (!isRecord(payload) || !Array.isArray(payload.bookmarks)) {
		return [];
	}
	return payload.bookmarks
		.map((bookmark) => normalizeBookmarkRecord(bookmark))
		.filter((bookmark): bookmark is EpubPortableBookmarkRecord => Boolean(bookmark))
		.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
}

export async function hasEpubPortableBookmarksData(
	app: App,
	bookId: unknown
): Promise<boolean> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	return Boolean(await readEpubSemanticJson(app, getEpubPortableBookPath(safeBookId, "bookmarks.json")));
}

export async function writeEpubPortableBookmarks(
	app: App,
	bookId: unknown,
	bookmarks: unknown[]
): Promise<void> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	await writeEpubSemanticJson(app, getEpubPortableBookPath(safeBookId, "bookmarks.json"), {
		format: "weave-reader-bookmarks/v1",
		version: 1,
		bookId: safeBookId,
		updatedAt: Date.now(),
		bookmarks: Array.isArray(bookmarks)
			? bookmarks
					.map((bookmark) => normalizeBookmarkRecord(bookmark))
					.filter((bookmark): bookmark is EpubPortableBookmarkRecord => Boolean(bookmark))
			: [],
	});
}
