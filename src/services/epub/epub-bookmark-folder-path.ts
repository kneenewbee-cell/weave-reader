import { normalizePath } from "obsidian";
import { DEFAULT_EPUB_BOOKMARK_FOLDER } from "../../config/epub-user-vault-folders";
import { unknownPlainText } from "../../utils/unknown-plain-text";

export { DEFAULT_EPUB_BOOKMARK_FOLDER };
export const EPUB_BOOKMARK_DATA_FILE_PREFIX = "data_";

export function normalizeEpubBookmarkFolderPath(value: unknown): string {
	const normalized = unknownPlainText(value)
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
	if (!normalized) {
		return "";
	}
	return normalizePath(normalized);
}

/** True when `path` is the bookmark folder itself or any descendant (covers, nested data notes). */
export function isPathUnderEpubBookmarkFolder(path: string, folderPath: string): boolean {
	const normalizedPath = normalizePath(String(path || "").trim());
	const normalizedFolder = normalizeEpubBookmarkFolderPath(folderPath);
	if (!normalizedPath || !normalizedFolder) {
		return false;
	}
	return (
		normalizedPath === normalizedFolder ||
		normalizedPath.startsWith(`${normalizedFolder}/`)
	);
}

export function isEpubBookmarkMarkdownInFolder(filePath: string, folderPath: string): boolean {
	const normalizedFilePath = normalizePath(String(filePath || "").trim());
	if (!normalizedFilePath.endsWith(".md")) {
		return false;
	}
	const normalizedFolder = normalizeEpubBookmarkFolderPath(folderPath);
	if (!normalizedFolder) {
		return !normalizedFilePath.includes("/");
	}
	return isPathUnderEpubBookmarkFolder(normalizedFilePath, folderPath);
}
