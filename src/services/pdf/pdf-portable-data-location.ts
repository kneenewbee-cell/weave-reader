import { type App, normalizePath } from "obsidian";

export const PDF_PORTABLE_DATA_ROOT = "weave/pdf-data";
export const PDF_PORTABLE_BOOK_FORMAT = "weave-reader-pdf-book/v1";
export const PDF_PORTABLE_INDEX_FORMAT = "weave-reader-pdf-index/v1";

export interface PdfPortableBookDataLocation {
	bookId: string;
	bookDir: string;
	bookMetadataPath: string;
	annotationsPath: string;
	inkPath: string;
	annotationsMarkdownPath: string;
	semanticProfilePath: string;
	bookmarksPath: string;
	readingStatePath: string;
	indexPath: string;
}

export interface PdfPortableBookMetadataDocument {
	format: typeof PDF_PORTABLE_BOOK_FORMAT;
	version: 1;
	bookId: string;
	legacyBookIds: string[];
	sourcePath: string;
	filePath: string;
	fileName: string;
	title: string;
	pageCount: number;
	dataPaths: {
		annotations: string;
		ink: string;
		annotationsMarkdown: string;
		readingState: string;
		bookmarks: string;
		semanticProfile: string;
	};
	createdAt: number;
	updatedAt: number;
}

export interface PdfPortableBookIndexEntry {
	bookId: string;
	legacyBookIds: string[];
	sourcePath: string;
	filePath: string;
	knownPaths: string[];
	fileName: string;
	title: string;
	pageCount: number;
	createdAt: number;
	updatedAt: number;
}

export interface PdfPortableBookIndexDocument {
	format: typeof PDF_PORTABLE_INDEX_FORMAT;
	version: 1;
	updatedAt: number;
	books: Record<string, PdfPortableBookIndexEntry>;
}

interface VaultAdapterLike {
	exists?: (path: string) => Promise<boolean>;
	read?: (path: string) => Promise<string>;
	write?: (path: string, data: string) => Promise<void>;
	mkdir?: (path: string) => Promise<void>;
}

export function resolvePdfPortableBookDataLocation(sourcePath: unknown): PdfPortableBookDataLocation {
	const bookId = createPdfPortableBookId(sourcePath);
	return resolvePdfPortableBookDataLocationForBookId(bookId);
}

export function resolveLegacyPdfPortableBookDataLocation(
	sourcePath: unknown
): PdfPortableBookDataLocation {
	const bookId = createLegacyTitleBasedPdfPortableBookId(sourcePath);
	return resolvePdfPortableBookDataLocationForBookId(bookId);
}

function resolvePdfPortableBookDataLocationForBookId(bookId: string): PdfPortableBookDataLocation {
	const bookDir = normalizePath(`${PDF_PORTABLE_DATA_ROOT}/books/${bookId}`);
	return {
		bookId,
		bookDir,
		bookMetadataPath: normalizePath(`${bookDir}/book.json`),
		annotationsPath: normalizePath(`${bookDir}/annotations.json`),
		inkPath: normalizePath(`${bookDir}/ink.json`),
		annotationsMarkdownPath: normalizePath(`${bookDir}/annotations.md`),
		semanticProfilePath: normalizePath(`${bookDir}/semantic-profile.json`),
		bookmarksPath: normalizePath(`${bookDir}/bookmarks.json`),
		readingStatePath: normalizePath(`${bookDir}/reading-state.json`),
		indexPath: normalizePath(`${PDF_PORTABLE_DATA_ROOT}/index.json`),
	};
}

export async function ensurePdfPortableBookData(
	app: App,
	sourcePath: string,
	pageCount: number
): Promise<PdfPortableBookDataLocation> {
	const normalizedSourcePath = normalizePath(sourcePath);
	const location = resolvePdfPortableBookDataLocation(normalizedSourcePath);
	const adapter = getAdapter(app);
	if (!adapter || typeof adapter.write !== "function") {
		throw new Error("Vault adapter is unavailable");
	}

	await ensureFolder(app, location.bookDir);
	const now = Date.now();
	const existingMetadata = await readJson(app, location.bookMetadataPath);
	const metadata = createBookMetadata(
		location,
		normalizedSourcePath,
		pageCount,
		normalizeTimestamp(existingMetadata?.createdAt, now),
		now
	);
	await adapter.write(location.bookMetadataPath, JSON.stringify(metadata, null, 2));

	const index = normalizeIndexDocument(await readJson(app, location.indexPath));
	const existingEntry = index.books[location.bookId];
	index.books[location.bookId] = createIndexEntry(
		metadata,
		existingEntry,
		normalizeTimestamp(existingEntry?.createdAt, metadata.createdAt)
	);
	index.updatedAt = now;
	await adapter.write(location.indexPath, JSON.stringify(index, null, 2));

	return location;
}

export async function ensurePdfPortableFolder(app: App, folderPath: string): Promise<void> {
	await ensureFolder(app, folderPath);
}

export function createPdfPortableBookId(sourcePath: unknown): string {
	const normalizedSourcePath = normalizePath(String(sourcePath || "").trim());
	return `pdf-book-${hashString(normalizedSourcePath)}`;
}

function createLegacyTitleBasedPdfPortableBookId(sourcePath: unknown): string {
	const normalizedSourcePath = normalizePath(String(sourcePath || "").trim());
	const fileName = normalizedSourcePath.split("/").pop() || "document.pdf";
	const stem = fileName.replace(/\.[^/.]+$/, "");
	const safeStem =
		stem
			.trim()
			.replace(/[^A-Za-z0-9._-]+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "document";
	return `pdf-${safeStem}-${hashString(normalizedSourcePath)}`;
}

function createBookMetadata(
	location: PdfPortableBookDataLocation,
	sourcePath: string,
	pageCount: number,
	createdAt: number,
	updatedAt: number
): PdfPortableBookMetadataDocument {
	const fileName = sourcePath.split("/").pop() || "document.pdf";
	const legacyBookId = createLegacyTitleBasedPdfPortableBookId(sourcePath);
	return {
		format: PDF_PORTABLE_BOOK_FORMAT,
		version: 1,
		bookId: location.bookId,
		legacyBookIds: legacyBookId === location.bookId ? [] : [legacyBookId],
		sourcePath,
		filePath: sourcePath,
		fileName,
		title: derivePdfTitle(fileName),
		pageCount: normalizePageCount(pageCount, 0),
		dataPaths: {
			annotations: location.annotationsPath,
			ink: location.inkPath,
			annotationsMarkdown: location.annotationsMarkdownPath,
			readingState: location.readingStatePath,
			bookmarks: location.bookmarksPath,
			semanticProfile: location.semanticProfilePath,
		},
		createdAt,
		updatedAt,
	};
}

function createIndexEntry(
	metadata: PdfPortableBookMetadataDocument,
	existingEntry: PdfPortableBookIndexEntry | undefined,
	createdAt: number
): PdfPortableBookIndexEntry {
	const knownPaths = uniqueNormalizedPaths([
		...(Array.isArray(existingEntry?.knownPaths) ? existingEntry.knownPaths : []),
		existingEntry?.filePath,
		metadata.filePath,
	]);
	return {
		bookId: metadata.bookId,
		legacyBookIds: uniqueStrings([
			...(Array.isArray(existingEntry?.legacyBookIds) ? existingEntry.legacyBookIds : []),
			...metadata.legacyBookIds,
		]),
		sourcePath: metadata.sourcePath,
		filePath: metadata.filePath,
		knownPaths,
		fileName: metadata.fileName,
		title: metadata.title,
		pageCount: metadata.pageCount,
		createdAt,
		updatedAt: metadata.updatedAt,
	};
}

function normalizeIndexDocument(value: unknown): PdfPortableBookIndexDocument {
	const record = isRecord(value) ? value : {};
	const booksRecord = isRecord(record.books) ? record.books : {};
	const books: Record<string, PdfPortableBookIndexEntry> = {};
	for (const [bookId, entry] of Object.entries(booksRecord)) {
		const normalizedEntry = normalizeIndexEntry(bookId, entry);
		if (normalizedEntry) {
			books[normalizedEntry.bookId] = normalizedEntry;
		}
	}
	return {
		format: PDF_PORTABLE_INDEX_FORMAT,
		version: 1,
		updatedAt: normalizeTimestamp(record.updatedAt, Date.now()),
		books,
	};
}

function normalizeIndexEntry(
	fallbackBookId: string,
	value: unknown
): PdfPortableBookIndexEntry | null {
	if (!isRecord(value)) {
		return null;
	}
	const bookId = cleanString(value.bookId) || cleanString(fallbackBookId);
	const filePath = normalizePath(cleanString(value.filePath || value.sourcePath));
	if (!bookId || !filePath) {
		return null;
	}
	const fileName = cleanString(value.fileName) || filePath.split("/").pop() || "document.pdf";
	const title = cleanString(value.title) || derivePdfTitle(fileName);
	return {
		bookId,
		legacyBookIds: uniqueStrings(
			Array.isArray(value.legacyBookIds) ? value.legacyBookIds : []
		),
		sourcePath: normalizePath(cleanString(value.sourcePath) || filePath),
		filePath,
		knownPaths: uniqueNormalizedPaths([
			...(Array.isArray(value.knownPaths) ? value.knownPaths : []),
			filePath,
		]),
		fileName,
		title,
		pageCount: normalizePageCount(value.pageCount, 0),
		createdAt: normalizeTimestamp(value.createdAt, Date.now()),
		updatedAt: normalizeTimestamp(value.updatedAt, Date.now()),
	};
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
	const adapter = getAdapter(app);
	if (!adapter || typeof adapter.mkdir !== "function") {
		return;
	}

	const parts = normalizePath(folderPath).split("/").filter(Boolean);
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (typeof adapter.exists === "function" && (await adapter.exists(current))) {
			continue;
		}
		await adapter.mkdir(current);
	}
}

async function readJson(app: App, path: string): Promise<Record<string, unknown> | null> {
	const adapter = getAdapter(app);
	if (!adapter || typeof adapter.exists !== "function" || typeof adapter.read !== "function") {
		return null;
	}
	if (!(await adapter.exists(path))) {
		return null;
	}
	try {
		const parsed = JSON.parse(await adapter.read(path)) as unknown;
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function getAdapter(app: App): VaultAdapterLike | null {
	return ((app.vault as unknown as { adapter?: VaultAdapterLike }).adapter ?? null);
}

function uniqueNormalizedPaths(paths: unknown[]): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const path of paths) {
		const rawPath = cleanString(path);
		if (!rawPath) {
			continue;
		}
		const normalizedPath = normalizePath(rawPath);
		if (!normalizedPath || normalizedPath === "/" || normalizedPath === "." || seen.has(normalizedPath)) {
			continue;
		}
		seen.add(normalizedPath);
		result.push(normalizedPath);
	}
	return result;
}

function uniqueStrings(values: unknown[]): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const text = cleanString(value);
		if (!text || seen.has(text)) {
			continue;
		}
		seen.add(text);
		result.push(text);
	}
	return result;
}

function derivePdfTitle(fileName: string): string {
	return (fileName.replace(/\.pdf$/i, "").trim() || "document");
}

function normalizePageCount(value: unknown, fallback: number): number {
	const pageCount = Number(value);
	return Number.isFinite(pageCount) && pageCount > 0
		? Math.floor(pageCount)
		: Math.max(0, Math.floor(Number(fallback) || 0));
}

function normalizeTimestamp(value: unknown, fallback: number): number {
	const timestamp = Number(value);
	return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function cleanString(value: unknown): string {
	return String(value || "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hashString(input: string): string {
	let hash = 2166136261;
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}
