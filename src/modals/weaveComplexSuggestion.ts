import { setIcon } from "obsidian";

export interface ComplexSuggestionRenderOptions {
	title: string;
	note?: string;
	icon?: string;
	showIcon?: boolean;
}

export function getVaultFileDisplayName(file: { path: string; name?: string }): string {
	return String(file.name || file.path.split("/").pop() || file.path);
}

export function getVaultFileFolderNote(filePath: string): string {
	const normalizedPath = String(filePath || "").replace(/\\/g, "/");
	const slashIndex = normalizedPath.lastIndexOf("/");
	if (slashIndex <= 0) {
		return "/";
	}

	return normalizedPath.slice(0, slashIndex) || "/";
}

export function buildVaultFileSearchText(file: { path: string; name?: string }): string {
	const displayName = getVaultFileDisplayName(file);
	const folderNote = getVaultFileFolderNote(file.path);
	return `${displayName} ${folderNote} ${file.path}`.trim();
}

export function renderComplexSuggestion(
	el: HTMLElement,
	options: ComplexSuggestionRenderOptions
): void {
	el.empty();
	el.addClass("mod-complex");

	if (options.showIcon !== false && options.icon) {
		const iconWrap = el.createDiv({ cls: "suggestion-icon" });
		const flair = iconWrap.createDiv({ cls: "suggestion-flair" });
		setIcon(flair, options.icon);
	}

	const content = el.createDiv({ cls: "suggestion-content" });
	content.createDiv({ cls: "suggestion-title", text: options.title });
	const note = options.note?.trim();
	if (note) {
		content.createDiv({ cls: "suggestion-note", text: note });
	}
}
