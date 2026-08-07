import { normalizePath } from "obsidian";

export const BOOK_PACKAGE_V2_FORMAT = "weave-reader-book-package/v2";

export type ReadingPackageBookFormat = "epub" | "pdf";

export type ReadingPackageModuleKey =
	| "book"
	| "annotationSystem"
	| "ink"
	| "navigationState"
	| "aiReadingNote";

export type ReadingPackageModuleSelection = Record<ReadingPackageModuleKey, boolean>;

export interface ReadingPackageManifestV2 {
	format: typeof BOOK_PACKAGE_V2_FORMAT;
	version: 2;
	bookFormat: ReadingPackageBookFormat;
	bookId: string;
	bookPath: string;
	bookFileName?: string;
	title?: string;
	sourceFingerprint?: string;
	fileFingerprint?: string;
	packageFingerprint?: string;
	contentFingerprint?: string;
	includeBook: boolean;
	modules: ReadingPackageModuleSelection;
	exportedAt: number;
}

const MODULE_KEYS: ReadingPackageModuleKey[] = [
	"book",
	"annotationSystem",
	"ink",
	"navigationState",
	"aiReadingNote",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanString(value: unknown): string {
	return String(value || "").trim();
}

function cleanFingerprint(value: unknown): string {
	return cleanString(value).toLowerCase();
}

function normalizeBookFormat(value: unknown): ReadingPackageBookFormat | "" {
	const format = cleanString(value).toLowerCase();
	return format === "epub" || format === "pdf" ? format : "";
}

export function normalizeReadingPackageModuleSelection(
	value: unknown,
): ReadingPackageModuleSelection {
	const record = isRecord(value) ? value : {};
	return MODULE_KEYS.reduce((selection, key) => {
		selection[key] = record[key] === true;
		return selection;
	}, {} as ReadingPackageModuleSelection);
}

export function normalizeReadingPackageManifest(
	value: unknown,
): ReadingPackageManifestV2 | null {
	if (
		!isRecord(value) ||
		value.format !== BOOK_PACKAGE_V2_FORMAT ||
		Number(value.version) !== 2
	) {
		return null;
	}
	const bookFormat = normalizeBookFormat(value.bookFormat);
	const bookId = cleanString(value.bookId);
	if (!bookFormat || !bookId) {
		return null;
	}
	return {
		format: BOOK_PACKAGE_V2_FORMAT,
		version: 2,
		bookFormat,
		bookId,
		bookPath: normalizePath(cleanString(value.bookPath)),
		bookFileName: cleanString(value.bookFileName) || undefined,
		title: cleanString(value.title) || undefined,
		sourceFingerprint:
			cleanFingerprint(value.fileFingerprint || value.sourceFingerprint) || undefined,
		fileFingerprint:
			cleanFingerprint(value.fileFingerprint || value.sourceFingerprint) || undefined,
		packageFingerprint: cleanFingerprint(value.packageFingerprint) || undefined,
		contentFingerprint: cleanFingerprint(value.contentFingerprint) || undefined,
		includeBook: value.includeBook === true,
		modules: normalizeReadingPackageModuleSelection(value.modules),
		exportedAt: Number.isFinite(Number(value.exportedAt))
			? Number(value.exportedAt)
			: Date.now(),
	};
}
