import type { App } from "obsidian";
import { TFile, normalizePath } from "obsidian";
import { DirectoryUtils } from "../../utils/directory-utils";
import { logger } from "../../utils/logger";
import { isSupportedBookPath } from "./book-format";
import { FoliateVaultPublicationParser } from "./FoliateVaultPublicationParser";

export const EPUB_BOOKMARK_COVER_SUBFOLDER = "covers";

export function buildEpubBookmarkCoverFolderPath(bookmarkFolder: string): string {
	const normalizedFolder = normalizePath(String(bookmarkFolder || "").trim());
	return normalizePath(`${normalizedFolder}/${EPUB_BOOKMARK_COVER_SUBFOLDER}`);
}

export function buildEpubBookmarkCoverPath(
	bookmarkFolder: string,
	stableKey: string,
	extension = "jpg"
): string {
	const safeKey = String(stableKey || "")
		.trim()
		.replace(/[\\/:*?"<>|]/g, "-");
	return normalizePath(
		`${buildEpubBookmarkCoverFolderPath(bookmarkFolder)}/${safeKey}.${extension}`
	);
}

function decodeDataUrlToArrayBuffer(dataUrl: string): { buffer: ArrayBuffer; mimeType: string } | null {
	const normalized = String(dataUrl || "").trim();
	const match = normalized.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i);
	if (!match) {
		return null;
	}

	const mimeType = String(match[1] || "image/jpeg").trim().toLowerCase();
	const base64 = match[2] || "";
	if (!base64) {
		return null;
	}

	try {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return {
			buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
			mimeType,
		};
	} catch {
		return null;
	}
}

function resolveCoverExtension(mimeType: string): string {
	switch (mimeType) {
		case "image/png":
			return "png";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		default:
			return "jpg";
	}
}

export async function ensureEpubBookmarkCoverPath(
	app: App,
	input: {
		bookPath: string;
		stableKey: string;
		bookmarkFolder: string;
		existingCoverPath?: string;
	}
): Promise<string | undefined> {
	const existingCoverPath = normalizePath(String(input.existingCoverPath || "").trim());
	if (existingCoverPath && (await app.vault.adapter.exists(existingCoverPath))) {
		return existingCoverPath;
	}

	const bookPath = normalizePath(String(input.bookPath || "").trim());
	const stableKey = String(input.stableKey || "").trim();
	if (!bookPath || !stableKey || !isSupportedBookPath(bookPath)) {
		return existingCoverPath || undefined;
	}

	const vaultFile = app.vault.getAbstractFileByPath(bookPath);
	if (!(vaultFile instanceof TFile)) {
		return existingCoverPath || undefined;
	}

	let coverImage: string | undefined;
	try {
		const parser = new FoliateVaultPublicationParser(app);
		const loaded = await parser.load(bookPath);
		coverImage = loaded.coverImage;
		parser.dispose();
	} catch (error) {
		logger.warn("[EpubBookmarkCover] Failed to load cover from book:", error);
		return existingCoverPath || undefined;
	}

	const decoded = coverImage ? decodeDataUrlToArrayBuffer(coverImage) : null;
	if (!decoded) {
		return existingCoverPath || undefined;
	}

	const extension = resolveCoverExtension(decoded.mimeType);
	const coverPath = buildEpubBookmarkCoverPath(input.bookmarkFolder, stableKey, extension);
	await DirectoryUtils.ensureDirForFile(app.vault.adapter, coverPath);
	await app.vault.adapter.writeBinary(coverPath, decoded.buffer);
	return coverPath;
}
