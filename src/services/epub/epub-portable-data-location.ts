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
	semanticProfilePath: string;
	bookmarksPath: string;
	readingStatePath: string;
	indexPath: string;
}

function normalizeVaultPath(value: unknown): string {
	return normalizePath(String(value || "").trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pathsReferToSameVaultFile(left: unknown, right: unknown): boolean {
	const normalizedLeft = normalizeVaultPath(left);
	const normalizedRight = normalizeVaultPath(right);
	return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
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
		semanticProfilePath: getEpubPortableBookPath(safeBookId, "semantic-profile.json"),
		bookmarksPath: getEpubPortableBookPath(safeBookId, "bookmarks.json"),
		readingStatePath: getEpubPortableBookPath(safeBookId, "reading-state.json"),
		indexPath: normalizePath(`${getEpubPortableDataRoot()}/index.json`),
	};
}

export function findEpubPortableBookIdInIndex(index: unknown, filePath: unknown): string {
	const normalizedFilePath = normalizeVaultPath(filePath);
	if (!normalizedFilePath || !isRecord(index) || !isRecord(index.books)) {
		return "";
	}

	for (const [fallbackBookId, value] of Object.entries(index.books)) {
		if (!isRecord(value)) {
			continue;
		}
		const rawBookId = String(value.bookId || fallbackBookId || "").trim();
		if (!rawBookId) {
			continue;
		}
		const candidatePaths = [
			value.filePath,
			...(Array.isArray(value.knownPaths) ? value.knownPaths : []),
		];
		if (candidatePaths.some((candidatePath) => pathsReferToSameVaultFile(candidatePath, normalizedFilePath))) {
			return safeEpubSemanticBookId(rawBookId);
		}
	}

	return "";
}

export async function findEpubPortableBookIdByPath(app: App, filePath: unknown): Promise<string> {
	const index = await readEpubSemanticJson(
		app,
		normalizePath(`${getEpubPortableDataRoot()}/index.json`)
	);
	return findEpubPortableBookIdInIndex(index, filePath);
}
