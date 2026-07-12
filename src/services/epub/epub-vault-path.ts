import { normalizePath, TFile, type App } from "obsidian";
import { isSupportedBookFile, isSupportedBookPath } from "./book-format";

function normalizeComparableVaultPath(path: string): string {
	return normalizePath(String(path || "").trim())
		.replace(/^\/+/, "")
		.normalize("NFC")
		.toLowerCase();
}

function normalizeConfigDirRoot(configDir: string): string {
	return normalizePath(String(configDir || "").trim()).replace(/^\/+/, "");
}

/** Paths that should not appear in bookshelf scan/import (trash, plugin config, dot-folders). */
export function isVisibleVaultBookPath(filePath: string, configDir: string): boolean {
	const normalizedPath = normalizePath(String(filePath || "").trim()).replace(/^\/+/, "");
	if (!normalizedPath || !isSupportedBookPath(normalizedPath)) {
		return false;
	}

	const excludedConfigDir = normalizeConfigDirRoot(configDir);
	const excludedRoots = excludedConfigDir ? ([".trash", excludedConfigDir] as const) : ([".trash"] as const);
	for (const excludedRoot of excludedRoots) {
		if (normalizedPath === excludedRoot || normalizedPath.startsWith(`${excludedRoot}/`)) {
			return false;
		}
	}

	return !normalizedPath.split("/").some((segment) => segment.startsWith("."));
}

/** Join adapter.list folder + entry into a vault-root path. */
export function joinListedVaultPath(folderPath: string, listedPath: string): string {
	const normalizedFolder = normalizePath(String(folderPath || "").trim()).replace(/^\/+/, "");
	const normalizedListed = normalizePath(String(listedPath || "").trim()).replace(/^\/+/, "");
	if (!normalizedListed) {
		return "";
	}
	if (!normalizedFolder || normalizedListed.includes("/")) {
		return normalizedListed;
	}
	return normalizePath(`${normalizedFolder}/${normalizedListed}`);
}

/**
 * Resolve `../` / `./` link paths against the vault path of a source note.
 */
export function resolveRelativeVaultPath(sourcePath: string, linkPath: string): string {
	const normalizedLink = normalizePath(String(linkPath || "").trim());
	if (!normalizedLink) {
		return "";
	}
	if (!/(^|\/)\.\.(\/|$)|(^|\/)\.(\/|$)/.test(normalizedLink)) {
		return normalizedLink;
	}

	const sourceDir = normalizePath(String(sourcePath || "").trim())
		.split("/")
		.filter(Boolean);
	if (sourceDir.length > 0) {
		sourceDir.pop();
	}

	const stack = [...sourceDir];
	for (const segment of normalizedLink.split("/")) {
		if (!segment || segment === ".") {
			continue;
		}
		if (segment === "..") {
			if (stack.length > 0) {
				stack.pop();
			}
			continue;
		}
		stack.push(segment);
	}
	return stack.join("/");
}

function buildVaultBookPathCandidates(filePath: string): string[] {
	const normalizedPath = normalizePath(String(filePath || "").trim());
	if (!normalizedPath) {
		return [];
	}

	const candidates = new Set<string>([normalizedPath]);
	const withoutLeadingDot = normalizedPath.replace(/^\.\/+/, "");
	if (withoutLeadingDot) {
		candidates.add(withoutLeadingDot);
	}
	const withoutLeadingSlash = normalizedPath.replace(/^\/+/, "");
	if (withoutLeadingSlash) {
		candidates.add(withoutLeadingSlash);
	}
	return Array.from(candidates);
}

/**
 * Resolve a stored bookshelf path to the canonical vault TFile.
 * Falls back to vault.getFiles() when adapter paths and the file index disagree.
 */
export function resolveSupportedBookFile(app: App, filePath: string): TFile | null {
	const normalizedPath = normalizePath(String(filePath || "").trim());
	if (!normalizedPath || !isVisibleVaultBookPath(normalizedPath, app.vault.configDir)) {
		return null;
	}

	for (const candidate of buildVaultBookPathCandidates(normalizedPath)) {
		const direct = app.vault.getAbstractFileByPath(candidate);
		if (direct instanceof TFile && isSupportedBookFile(direct)) {
			return direct;
		}
	}

	const targetComparable = normalizeComparableVaultPath(normalizedPath);
	const targetName = normalizedPath.split("/").pop()?.toLowerCase() || "";
	const suffixMatches: TFile[] = [];
	const basenameMatches: TFile[] = [];

	for (const file of app.vault.getFiles()) {
		if (!isSupportedBookFile(file)) {
			continue;
		}
		const fileComparable = normalizeComparableVaultPath(file.path);
		if (fileComparable === targetComparable) {
			return file;
		}
		if (fileComparable.endsWith(`/${targetComparable}`)) {
			suffixMatches.push(file);
			continue;
		}
		if (targetName && file.name.toLowerCase() === targetName) {
			basenameMatches.push(file);
		}
	}

	if (suffixMatches.length === 1) {
		return suffixMatches[0];
	}
	if (basenameMatches.length === 1) {
		return basenameMatches[0];
	}

	return null;
}

export function isPathAlreadyOnBookshelf(
	filePath: string,
	membershipPaths: Iterable<string>
): boolean {
	for (const memberPath of membershipPaths) {
		if (epubVaultPathsReferToSameBook(memberPath, filePath)) {
			return true;
		}
	}
	return false;
}

export function resolveSupportedBookFilePath(app: App, filePath: string): string | null {
	return resolveSupportedBookFile(app, filePath)?.path ?? null;
}

/**
 * Resolve a wikilink / href path to the canonical vault path of an EPUB (or other book).
 * Uses direct lookup first, then Obsidian linkpath resolution from the source note context.
 */
export function resolveEpubVaultPath(
	app: App,
	linkPath: string,
	sourcePath = ""
): string | null {
	const normalizedLink = normalizePath(String(linkPath || "").trim());
	if (!normalizedLink) {
		return null;
	}

	const contextPath = normalizePath(String(sourcePath || "").trim());
	let candidatePath = normalizedLink;
	if (contextPath && /(^|\/)\.\.(\/|$)|(^|\/)\.(\/|$)/.test(normalizedLink)) {
		candidatePath = resolveRelativeVaultPath(contextPath, normalizedLink);
		const resolvedRelative = resolveSupportedBookFile(app, candidatePath);
		if (resolvedRelative) {
			return resolvedRelative.path;
		}
	}

	const resolvedBook = resolveSupportedBookFile(app, candidatePath);
	if (resolvedBook) {
		return resolvedBook.path;
	}

	if (typeof app.metadataCache?.getFirstLinkpathDest === "function") {
		const resolved = app.metadataCache.getFirstLinkpathDest(normalizedLink, contextPath);
		if (resolved instanceof TFile && isSupportedBookPath(resolved.path)) {
			return resolved.path;
		}
		if (candidatePath !== normalizedLink) {
			const resolvedCandidate = app.metadataCache.getFirstLinkpathDest(candidatePath, contextPath);
			if (resolvedCandidate instanceof TFile && isSupportedBookPath(resolvedCandidate.path)) {
				return resolvedCandidate.path;
			}
		}
	}

	return null;
}

/** Canonical vault path for comparing whether two stored paths refer to the same book. */
export function resolveComparableBookVaultPath(
	app: App,
	filePath: string,
	sourcePath = ""
): string {
	const normalizedPath = normalizePath(String(filePath || "").trim());
	if (!normalizedPath) {
		return "";
	}
	return (
		resolveEpubVaultPath(app, normalizedPath, sourcePath) ||
		resolveSupportedBookFilePath(app, normalizedPath) ||
		normalizedPath
	);
}

export function isPathAlreadyOnBookshelfForApp(
	app: App,
	filePath: string,
	membershipPaths: Iterable<string>
): boolean {
	const canonicalPath = resolveSupportedBookFilePath(app, filePath);
	if (!canonicalPath) {
		return false;
	}
	for (const memberPath of membershipPaths) {
		if (epubVaultPathsReferToSameBook(memberPath, canonicalPath)) {
			return true;
		}
	}
	return false;
}

/** Whether two vault paths refer to the same book file (exact or nested suffix match). */
export function epubVaultPathsReferToSameBook(left: string, right: string): boolean {
	const normalizedLeft = normalizeComparableVaultPath(left);
	const normalizedRight = normalizeComparableVaultPath(right);
	if (!normalizedLeft || !normalizedRight) {
		return false;
	}
	if (normalizedLeft === normalizedRight) {
		return true;
	}
	return (
		normalizedLeft.endsWith(`/${normalizedRight}`) ||
		normalizedRight.endsWith(`/${normalizedLeft}`)
	);
}
