import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import {
	getEpubPortableBookPath,
	getEpubPortableDataRoot,
	readEpubSemanticJson,
	safeEpubSemanticBookId,
} from "./semantic/semantic-store";

export interface EpubPortableBookDataLocation {
	bookId: string;
	bookDir: string;
	bookMetadataPath: string;
	annotationsPath: string;
	annotationsMarkdownPath: string;
	semanticProfilePath: string;
	bookmarksPath: string;
	readingStatePath: string;
	indexPath: string;
}

export interface EpubPortableBookIdentityHints {
	bookId?: unknown;
	sourceId?: unknown;
	sourceFingerprint?: unknown;
	filePath?: unknown;
	knownPaths?: unknown[];
}

function cleanString(value: unknown): string {
	return String(value || "").trim();
}

function normalizeVaultPath(value: unknown): string {
	return normalizePath(cleanString(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pathsReferToSameVaultFile(left: unknown, right: unknown): boolean {
	const normalizedLeft = normalizeVaultPath(left);
	const normalizedRight = normalizeVaultPath(right);
	return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function collectCandidatePaths(value: Record<string, unknown>): unknown[] {
	return [
		value.filePath,
		...(Array.isArray(value.knownPaths) ? value.knownPaths : []),
	];
}

function scorePortableBookIdentityMatch(
	fallbackBookId: string,
	value: Record<string, unknown>,
	hints: EpubPortableBookIdentityHints
): number {
	let score = 0;
	const candidateBookId = safeEpubSemanticBookId(value.bookId || fallbackBookId);
	const candidateIds = [
		candidateBookId,
		...(Array.isArray(value.legacyBookIds) ? value.legacyBookIds : []),
	].map((item) => safeEpubSemanticBookId(item));
	const hintBookId = cleanString(hints.bookId) ? safeEpubSemanticBookId(hints.bookId) : "";
	const hintSourceId = cleanString(hints.sourceId);
	const candidateSourceId = cleanString(value.sourceId);
	const hintFingerprint = cleanString(hints.sourceFingerprint).toLowerCase();
	const candidateFingerprint = cleanString(value.sourceFingerprint).toLowerCase();
	const hintPaths = [
		hints.filePath,
		...(Array.isArray(hints.knownPaths) ? hints.knownPaths : []),
	].filter((item) => cleanString(item));
	const candidatePaths = collectCandidatePaths(value);

	if (hintFingerprint && candidateFingerprint === hintFingerprint) {
		score += 300;
	}
	if (hintSourceId && candidateSourceId === hintSourceId) {
		score += 200;
	}
	if (
		hintPaths.some((hintPath) =>
			candidatePaths.some((candidatePath) => pathsReferToSameVaultFile(candidatePath, hintPath))
		)
	) {
		score += 100;
	}
	if (hintBookId && candidateIds.includes(hintBookId)) {
		score += 50;
	}
	return score;
}

export function resolveEpubPortableBookDataLocation(
	bookId: unknown
): EpubPortableBookDataLocation {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const bookDir = normalizePath(`${getEpubPortableDataRoot()}/books/${safeBookId}`);
	return {
		bookId: safeBookId,
		bookDir,
		bookMetadataPath: getEpubPortableBookPath(safeBookId, "book.json"),
		annotationsPath: getEpubPortableBookPath(safeBookId, "annotations.json"),
		annotationsMarkdownPath: getEpubPortableBookPath(safeBookId, "annotations.md"),
		semanticProfilePath: getEpubPortableBookPath(safeBookId, "semantic-profile.json"),
		bookmarksPath: getEpubPortableBookPath(safeBookId, "bookmarks.json"),
		readingStatePath: getEpubPortableBookPath(safeBookId, "reading-state.json"),
		indexPath: normalizePath(`${getEpubPortableDataRoot()}/index.json`),
	};
}

export function findEpubPortableBookIdInIndex(index: unknown, filePath: unknown): string {
	return findEpubPortableBookIdInIndexByIdentity(index, { filePath });
}

export function findEpubPortableBookIdInIndexByIdentity(
	index: unknown,
	hints: EpubPortableBookIdentityHints
): string {
	const fallbackBookId = cleanString(hints.bookId)
		? safeEpubSemanticBookId(hints.bookId)
		: "";
	if (!isRecord(index) || !isRecord(index.books)) {
		return fallbackBookId;
	}

	let bestBookId = "";
	let bestScore = 0;
	for (const [rawFallbackBookId, value] of Object.entries(index.books)) {
		if (!isRecord(value)) {
			continue;
		}
		const candidateBookId = safeEpubSemanticBookId(value.bookId || rawFallbackBookId);
		const score = scorePortableBookIdentityMatch(candidateBookId, value, hints);
		if (score > bestScore) {
			bestBookId = candidateBookId;
			bestScore = score;
		}
	}

	return bestBookId || fallbackBookId;
}

export async function findEpubPortableBookIdByPath(app: App, filePath: unknown): Promise<string> {
	const index = await readEpubSemanticJson(
		app,
		normalizePath(`${getEpubPortableDataRoot()}/index.json`)
	);
	return findEpubPortableBookIdInIndex(index, filePath);
}

export async function findEpubPortableBookIdByIdentity(
	app: App,
	hints: EpubPortableBookIdentityHints
): Promise<string> {
	const index = await readEpubSemanticJson(
		app,
		normalizePath(`${getEpubPortableDataRoot()}/index.json`)
	);
	return findEpubPortableBookIdInIndexByIdentity(index, hints);
}
