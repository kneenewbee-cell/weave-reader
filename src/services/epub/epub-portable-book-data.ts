import type { App } from "obsidian";
import { DirectoryUtils } from "../../utils/directory-utils";
import { getEpubPortableBookPath, safeEpubSemanticBookId } from "./semantic/semantic-store";

export interface EpubPortableReadingPosition {
	chapterIndex: number;
	cfi: string;
	percent: number;
}

export interface EpubPortableReadingStats {
	totalReadTime: number;
	lastReadTime: number;
	createdTime: number;
	completedTime?: number;
	bookWpm?: number;
	paceSampleCount?: number;
	paceSampleWords?: number;
	recentIntervalWpms?: number[];
}

export interface EpubPortableReadingState {
	currentPosition: EpubPortableReadingPosition;
	readingStats: EpubPortableReadingStats;
}

export interface EpubPortableBookmark {
	id: string;
	cfi: string;
	chapterIndex: number;
	percent: number;
	chapterTitle: string;
	createdAt: number;
	pageNumber?: number;
	totalPages?: number;
	preview?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanString(value: unknown): string {
	return String(value || "").trim();
}

function finiteNumber(value: unknown, fallback = 0): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function readPortableJson(app: App, filePath: string): Promise<unknown | null> {
	try {
		const adapter = app?.vault?.adapter;
		if (!adapter || typeof adapter.exists !== "function" || typeof adapter.read !== "function") {
			return null;
		}
		if (!(await adapter.exists(filePath))) {
			return null;
		}
		return JSON.parse(await adapter.read(filePath)) as unknown;
	} catch {
		return null;
	}
}

async function writePortableJson(app: App, filePath: string, value: unknown): Promise<void> {
	const adapter = app?.vault?.adapter;
	if (!adapter || typeof adapter.write !== "function") {
		return;
	}
	await DirectoryUtils.ensureDirForFile(adapter, filePath);
	await adapter.write(filePath, JSON.stringify(value, null, 2));
}

function normalizeReadingPosition(value: unknown): EpubPortableReadingPosition | null {
	if (!isRecord(value)) {
		return null;
	}
	const cfi = cleanString(value.cfi);
	if (!cfi) {
		return null;
	}
	return {
		chapterIndex: finiteNumber(value.chapterIndex),
		cfi,
		percent: finiteNumber(value.percent),
	};
}

function normalizeReadingStats(value: unknown): EpubPortableReadingStats | null {
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
			? {
					recentIntervalWpms: value.recentIntervalWpms.filter(
						(entry): entry is number => typeof entry === "number" && Number.isFinite(entry)
					),
			  }
			: {}),
	};
}

function normalizeBookmark(value: unknown): EpubPortableBookmark | null {
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
	const payload = await readPortableJson(app, getEpubPortableBookPath(safeBookId, "reading-state.json"));
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
	return Boolean(
		await readPortableJson(
			app,
			getEpubPortableBookPath(safeEpubSemanticBookId(bookId), "reading-state.json")
		)
	);
}

export async function writeEpubPortableReadingState(
	app: App,
	bookId: unknown,
	state: EpubPortableReadingState
): Promise<void> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	await writePortableJson(app, getEpubPortableBookPath(safeBookId, "reading-state.json"), {
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
): Promise<EpubPortableBookmark[]> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const payload = await readPortableJson(app, getEpubPortableBookPath(safeBookId, "bookmarks.json"));
	if (!isRecord(payload) || !Array.isArray(payload.bookmarks)) {
		return [];
	}
	return payload.bookmarks
		.map((bookmark) => normalizeBookmark(bookmark))
		.filter((bookmark): bookmark is EpubPortableBookmark => Boolean(bookmark))
		.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
}

export async function hasEpubPortableBookmarksData(
	app: App,
	bookId: unknown
): Promise<boolean> {
	return Boolean(
		await readPortableJson(
			app,
			getEpubPortableBookPath(safeEpubSemanticBookId(bookId), "bookmarks.json")
		)
	);
}

export async function writeEpubPortableBookmarks(
	app: App,
	bookId: unknown,
	bookmarks: unknown[]
): Promise<void> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	await writePortableJson(app, getEpubPortableBookPath(safeBookId, "bookmarks.json"), {
		format: "weave-reader-bookmarks/v1",
		version: 1,
		bookId: safeBookId,
		updatedAt: Date.now(),
		bookmarks: Array.isArray(bookmarks)
			? bookmarks
					.map((bookmark) => normalizeBookmark(bookmark))
					.filter((bookmark): bookmark is EpubPortableBookmark => Boolean(bookmark))
			: [],
	});
}
