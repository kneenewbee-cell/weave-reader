import { normalizePath, TFile } from "obsidian";

export function normalizeVaultFolderPath(folderPath: string | null | undefined): string {
	const normalized = normalizePath(String(folderPath || "").trim());
	if (!normalized || normalized === "/") {
		return "";
	}
	return normalized.replace(/\/+$/, "");
}

export function isFileWithinVaultFolder(
	filePath: string | null | undefined,
	folderPath: string | null | undefined
): boolean {
	const normalizedFolder = normalizeVaultFolderPath(folderPath);
	if (!normalizedFolder) {
		return false;
	}

	const normalizedFilePath = normalizePath(String(filePath || "").trim());
	if (!normalizedFilePath) {
		return false;
	}

	return (
		normalizedFilePath === normalizedFolder ||
		normalizedFilePath.startsWith(`${normalizedFolder}/`)
	);
}

export function isMarkdownFileWithinVaultFolder(
	file: TFile,
	folderPath: string | null | undefined
): boolean {
	return isFileWithinVaultFolder(file.path, folderPath);
}

export function buildMarkdownFileInFolderFilter(
	folderPath: string | null | undefined
): (file: TFile) => boolean {
	return (file: TFile) =>
		file.extension.toLowerCase() === "md" &&
		isMarkdownFileWithinVaultFolder(file, folderPath);
}
