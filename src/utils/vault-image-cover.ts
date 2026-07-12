import type { App } from "obsidian";
import { TFile } from "obsidian";

const VAULT_IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"bmp",
	"webp",
	"svg",
	"avif",
	"tiff",
	"tif",
	"heic",
	"heif",
	"ico",
]);

export function isVaultImageFile(file: TFile): boolean {
	const extension = file.extension?.trim().toLowerCase() || "";
	return VAULT_IMAGE_EXTENSIONS.has(extension);
}

export function resolveVaultImageResourceUrl(app: App, filePath: string | undefined | null): string | null {
	const normalizedPath = String(filePath || "").trim();
	if (!normalizedPath) {
		return null;
	}

	const file = app.vault.getAbstractFileByPath(normalizedPath);
	if (!(file instanceof TFile) || !isVaultImageFile(file)) {
		return null;
	}

	try {
		return app.vault.getResourcePath(file) || null;
	} catch {
		return null;
	}
}
