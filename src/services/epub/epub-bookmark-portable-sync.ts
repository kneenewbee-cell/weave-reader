import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import { resolveEpubPortableBookDataLocation } from "./epub-portable-data-location";
import {
	getEpubPortableBookPath,
	readEpubSemanticJson,
	safeEpubSemanticBookId,
	writeEpubSemanticJson,
} from "./semantic/semantic-store";

export interface EpubBookmarkPortableSyncFrontmatter {
	stableKey?: string;
	bookId?: string;
	sourceId?: string;
	sourceFingerprint?: string;
	bookPath?: string;
	displayTitle?: string;
	bookTitle?: string;
	bookAuthor?: string;
	bookLanguage?: string;
	publisher?: string;
	isbn?: string;
	publishDate?: string;
	subjects?: string[];
	description?: string;
	translator?: string;
	coverPath?: string;
	wordCount?: number;
	chapterCount?: number;
	updatedAt?: number;
	bookmarks?: unknown[];
	readingState?: unknown;
	analytics?: unknown;
	user?: unknown;
}

export interface EpubBookmarkPortableSyncOptions {
	bookmarkFilePath?: string;
}

function now(): number {
	return Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanString(value: unknown): string {
	return String(value || "").trim();
}

function cleanPath(value: unknown): string {
	return normalizePath(cleanString(value));
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function uniqueStrings(values: unknown[]): string[] {
	return Array.from(
		new Set(values.map((value) => cleanString(value)).filter(Boolean)),
	);
}

function getPortableBookId(
	frontmatter: EpubBookmarkPortableSyncFrontmatter,
): string {
	return safeEpubSemanticBookId(
		frontmatter.bookId ||
			frontmatter.stableKey ||
			frontmatter.sourceId ||
			"epub-book",
	);
}

function normalizeExistingJsonObject(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function normalizeKnownPaths(...values: unknown[]): string[] {
	return uniqueStrings(values.map((value) => cleanPath(value)).filter(Boolean));
}

function pathMatchesAnyKnownPath(
	filePath: string,
	knownPaths: unknown[],
): boolean {
	const normalizedFilePath = cleanPath(filePath);
	if (!normalizedFilePath) {
		return false;
	}
	return knownPaths.some(
		(knownPath) => cleanPath(knownPath) === normalizedFilePath,
	);
}

function scorePortableIndexBookMatch(
	bookId: string,
	book: Record<string, unknown>,
	frontmatter: EpubBookmarkPortableSyncFrontmatter,
): number {
	let score = 0;
	const sourceFingerprint = cleanString(
		frontmatter.sourceFingerprint,
	).toLowerCase();
	const sourceId = cleanString(frontmatter.sourceId);
	const filePath = cleanPath(frontmatter.bookPath);
	const rawBookId = safeEpubSemanticBookId(book.bookId || bookId);
	const candidateFingerprint = cleanString(
		book.sourceFingerprint,
	).toLowerCase();
	const candidateSourceId = cleanString(book.sourceId);
	const candidatePaths = [
		book.filePath,
		...(Array.isArray(book.knownPaths) ? book.knownPaths : []),
	];

	if (sourceFingerprint && candidateFingerprint === sourceFingerprint) {
		score += 100;
	}
	if (sourceId && candidateSourceId === sourceId) {
		score += 80;
	}
	if (filePath && pathMatchesAnyKnownPath(filePath, candidatePaths)) {
		score += 50;
	}
	if (rawBookId === safeEpubSemanticBookId(frontmatter.bookId)) {
		score += 10;
	}
	if (candidateFingerprint) {
		score += 6;
	}
	if (candidateSourceId) {
		score += 4;
	}
	if (finiteNumber(book.updatedAt) !== undefined) {
		score += 1;
	}
	return score;
}

function findBestPortableBookIdInIndex(
	index: unknown,
	frontmatter: EpubBookmarkPortableSyncFrontmatter,
): string {
	if (!isRecord(index) || !isRecord(index.books)) {
		return "";
	}
	let bestBookId = "";
	let bestScore = 0;
	for (const [fallbackBookId, value] of Object.entries(index.books)) {
		if (!isRecord(value)) {
			continue;
		}
		const candidateBookId = safeEpubSemanticBookId(
			value.bookId || fallbackBookId,
		);
		const score = scorePortableIndexBookMatch(
			candidateBookId,
			value,
			frontmatter,
		);
		if (score > bestScore) {
			bestBookId = candidateBookId;
			bestScore = score;
		}
	}
	return bestScore > 0 ? bestBookId : "";
}

async function resolvePortableSyncBookId(
	app: App,
	frontmatter: EpubBookmarkPortableSyncFrontmatter,
): Promise<string> {
	const fallbackBookId = getPortableBookId(frontmatter);
	const indexPath =
		resolveEpubPortableBookDataLocation(fallbackBookId).indexPath;
	const indexedBookId = findBestPortableBookIdInIndex(
		await readEpubSemanticJson(app, indexPath),
		frontmatter,
	);
	return indexedBookId || fallbackBookId;
}

function buildBookJson(
	frontmatter: EpubBookmarkPortableSyncFrontmatter,
	options: EpubBookmarkPortableSyncOptions,
	existing: unknown,
	updatedAt: number,
): Record<string, unknown> {
	const previous = normalizeExistingJsonObject(existing);
	const bookId = getPortableBookId(frontmatter);
	const filePath = cleanPath(frontmatter.bookPath || previous.filePath);
	const knownPaths = normalizeKnownPaths(
		...(Array.isArray(previous.knownPaths) ? previous.knownPaths : []),
		previous.filePath,
		filePath,
	);
	const sourceFingerprint = cleanString(
		frontmatter.sourceFingerprint || previous.sourceFingerprint,
	);
	const sourceId = cleanString(frontmatter.sourceId || previous.sourceId);

	return {
		...previous,
		format: "weave-reader-book/v1",
		version: 1,
		bookId,
		stableKey: cleanString(previous.stableKey || frontmatter.stableKey),
		sourceId: sourceId || undefined,
		sourceFingerprint: sourceFingerprint || undefined,
		filePath,
		knownPaths,
		bookmarkPagePath:
			cleanPath(options.bookmarkFilePath || previous.bookmarkPagePath) ||
			undefined,
		title: cleanString(frontmatter.bookTitle || previous.title),
		displayTitle: cleanString(
			frontmatter.displayTitle || previous.displayTitle,
		),
		author: cleanString(frontmatter.bookAuthor || previous.author) || undefined,
		language:
			cleanString(frontmatter.bookLanguage || previous.language) || undefined,
		publisher:
			cleanString(frontmatter.publisher || previous.publisher) || undefined,
		isbn: cleanString(frontmatter.isbn || previous.isbn) || undefined,
		publishDate:
			cleanString(frontmatter.publishDate || previous.publishDate) || undefined,
		subjects: Array.isArray(frontmatter.subjects)
			? uniqueStrings(frontmatter.subjects)
			: Array.isArray(previous.subjects)
			? uniqueStrings(previous.subjects)
			: undefined,
		description:
			cleanString(frontmatter.description || previous.description) || undefined,
		translator:
			cleanString(frontmatter.translator || previous.translator) || undefined,
		coverPath:
			cleanPath(frontmatter.coverPath || previous.coverPath) || undefined,
		wordCount:
			finiteNumber(frontmatter.wordCount) ?? finiteNumber(previous.wordCount),
		chapterCount:
			finiteNumber(frontmatter.chapterCount) ??
			finiteNumber(previous.chapterCount),
		createdAt: finiteNumber(previous.createdAt) ?? updatedAt,
		updatedAt,
	};
}

function buildReadingStateJson(
	frontmatter: EpubBookmarkPortableSyncFrontmatter,
	existing: unknown,
	updatedAt: number,
): Record<string, unknown> | null {
	if (!isRecord(frontmatter.readingState)) {
		return isRecord(existing) ? existing : null;
	}

	const flat = frontmatter as Record<string, unknown>;
	return {
		format: "weave-reader-reading-state/v1",
		version: 1,
		bookId: getPortableBookId(frontmatter),
		updatedAt,
		readingProgress: finiteNumber(flat["reading-progress"]),
		readingStatus: cleanString(flat["reading-status"]) || undefined,
		readingTotalMinutes: finiteNumber(flat["reading-total-minutes"]),
		readingWpm: finiteNumber(flat["reading-wpm"]),
		lastReadAt: finiteNumber(flat["last-read-at"]),
		...frontmatter.readingState,
	};
}

function buildBookmarksJson(
	frontmatter: EpubBookmarkPortableSyncFrontmatter,
	updatedAt: number,
): Record<string, unknown> {
	return {
		format: "weave-reader-bookmarks/v1",
		version: 1,
		bookId: getPortableBookId(frontmatter),
		updatedAt,
		bookmarks: Array.isArray(frontmatter.bookmarks)
			? frontmatter.bookmarks
			: [],
	};
}

function buildStatsJson(
	frontmatter: EpubBookmarkPortableSyncFrontmatter,
	existing: unknown,
	updatedAt: number,
): Record<string, unknown> | null {
	const flat = frontmatter as Record<string, unknown>;
	const analytics = isRecord(frontmatter.analytics)
		? frontmatter.analytics
		: isRecord(existing)
		? existing.analytics
		: null;
	const hasFlatStats =
		finiteNumber(flat["highlight-count"]) !== undefined ||
		finiteNumber(flat["excerpt-note-count"]) !== undefined ||
		finiteNumber(flat["bookmark-count"]) !== undefined;

	if (!analytics && !hasFlatStats) {
		return isRecord(existing) ? existing : null;
	}

	return {
		format: "weave-reader-book-stats/v1",
		version: 1,
		bookId: getPortableBookId(frontmatter),
		updatedAt,
		highlightCount: finiteNumber(flat["highlight-count"]),
		excerptNoteCount: finiteNumber(flat["excerpt-note-count"]),
		bookmarkCount: finiteNumber(flat["bookmark-count"]),
		analytics,
	};
}

function buildUserJson(
	frontmatter: EpubBookmarkPortableSyncFrontmatter,
	existing: unknown,
	updatedAt: number,
): Record<string, unknown> | null {
	if (!isRecord(frontmatter.user)) {
		return isRecord(existing) ? existing : null;
	}
	return {
		format: "weave-reader-book-user/v1",
		version: 1,
		bookId: getPortableBookId(frontmatter),
		updatedAt,
		...frontmatter.user,
	};
}

async function mergeBookIntoPortableIndex(
	app: App,
	frontmatter: EpubBookmarkPortableSyncFrontmatter,
	location: ReturnType<typeof resolveEpubPortableBookDataLocation>,
	options: EpubBookmarkPortableSyncOptions,
	updatedAt: number,
): Promise<void> {
	const currentIndex = normalizeExistingJsonObject(
		await readEpubSemanticJson(app, location.indexPath),
	);
	const currentBooks = isRecord(currentIndex.books) ? currentIndex.books : {};
	const bookId = location.bookId;
	const previousBook = normalizeExistingJsonObject(currentBooks[bookId]);
	const filePath = cleanPath(frontmatter.bookPath || previousBook.filePath);
	const knownPaths = normalizeKnownPaths(
		...(Array.isArray(previousBook.knownPaths) ? previousBook.knownPaths : []),
		previousBook.filePath,
		filePath,
	);

	await writeEpubSemanticJson(app, location.indexPath, {
		...currentIndex,
		format: "weave-reader-epub-data-index/v1",
		version: 1,
		updatedAt,
		books: {
			...currentBooks,
			[bookId]: {
				...previousBook,
				bookId,
				stableKey: cleanString(previousBook.stableKey || frontmatter.stableKey),
				filePath,
				knownPaths,
				sourceId:
					cleanString(frontmatter.sourceId || previousBook.sourceId) ||
					undefined,
				sourceFingerprint:
					cleanString(
						frontmatter.sourceFingerprint || previousBook.sourceFingerprint,
					) || undefined,
				title: cleanString(frontmatter.bookTitle || previousBook.title),
				displayTitle: cleanString(
					frontmatter.displayTitle || previousBook.displayTitle,
				),
				bookmarkPagePath:
					cleanPath(
						options.bookmarkFilePath || previousBook.bookmarkPagePath,
					) || undefined,
				updatedAt,
			},
		},
	});
}

export async function syncEpubBookmarkFrontmatterToPortableData(
	app: App,
	frontmatter: EpubBookmarkPortableSyncFrontmatter,
	options: EpubBookmarkPortableSyncOptions = {},
): Promise<void> {
	const location = resolveEpubPortableBookDataLocation(
		await resolvePortableSyncBookId(app, frontmatter),
	);
	const effectiveFrontmatter = {
		...frontmatter,
		bookId: location.bookId,
	};
	const updatedAt = finiteNumber(frontmatter.updatedAt) ?? now();

	const existingBook = await readEpubSemanticJson(
		app,
		location.bookMetadataPath,
	);
	await writeEpubSemanticJson(
		app,
		location.bookMetadataPath,
		buildBookJson(effectiveFrontmatter, options, existingBook, updatedAt),
	);

	const existingReadingState = await readEpubSemanticJson(
		app,
		location.readingStatePath,
	);
	const readingState = buildReadingStateJson(
		effectiveFrontmatter,
		existingReadingState,
		updatedAt,
	);
	if (readingState) {
		await writeEpubSemanticJson(app, location.readingStatePath, readingState);
	}

	await writeEpubSemanticJson(
		app,
		location.bookmarksPath,
		buildBookmarksJson(effectiveFrontmatter, updatedAt),
	);

	const statsPath = getEpubPortableBookPath(location.bookId, "stats.json");
	const existingStats = await readEpubSemanticJson(app, statsPath);
	const stats = buildStatsJson(effectiveFrontmatter, existingStats, updatedAt);
	if (stats) {
		await writeEpubSemanticJson(app, statsPath, stats);
	}

	const userPath = getEpubPortableBookPath(location.bookId, "user.json");
	const existingUser = await readEpubSemanticJson(app, userPath);
	const user = buildUserJson(effectiveFrontmatter, existingUser, updatedAt);
	if (user) {
		await writeEpubSemanticJson(app, userPath, user);
	}

	await mergeBookIntoPortableIndex(
		app,
		effectiveFrontmatter,
		location,
		options,
		updatedAt,
	);
}
