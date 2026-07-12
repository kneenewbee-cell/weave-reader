import { isFileWithinVaultFolder } from "../../utils/vault-folder-markdown-filter";
import type { BookNotesExportLegacyTemplate } from "./book-notes-export/constants";
import { resolveBookNotesExportTemplateFolder } from "./book-notes-export/template-folder";
import type { EpubExcerptSettings } from "./epub-excerpt-settings";
import { DEFAULT_EPUB_EXCERPT_SETTINGS } from "./epub-excerpt-settings";

export function normalizeBookNotesExportBookKey(bookFilePath: string): string {
	return String(bookFilePath || "").trim();
}

export function normalizeBookNotesExportAppendMap(
	value: Record<string, string> | undefined
): Record<string, string> {
	if (!value || typeof value !== "object") {
		return {};
	}
	const next: Record<string, string> = {};
	for (const [bookPath, appendPath] of Object.entries(value)) {
		const normalizedBookPath = normalizeBookNotesExportBookKey(bookPath);
		const normalizedAppendPath = String(appendPath || "").trim();
		if (normalizedBookPath && normalizedAppendPath) {
			next[normalizedBookPath] = normalizedAppendPath;
		}
	}
	return next;
}

export function readBookNotesExportAppendPath(
	map: Record<string, string> | undefined,
	bookFilePath: string
): string | null {
	const normalizedBookPath = normalizeBookNotesExportBookKey(bookFilePath);
	if (!normalizedBookPath) {
		return null;
	}
	const storedPath = map?.[normalizedBookPath];
	return typeof storedPath === "string" && storedPath.trim() ? storedPath.trim() : null;
}

export function writeBookNotesExportAppendPath(
	map: Record<string, string> | undefined,
	bookFilePath: string,
	appendPath: string | null
): Record<string, string> {
	const normalizedBookPath = normalizeBookNotesExportBookKey(bookFilePath);
	if (!normalizedBookPath) {
		return { ...(map || {}) };
	}
	const nextMap = { ...(map || {}) };
	const normalizedAppendPath = String(appendPath || "").trim();
	if (normalizedAppendPath) {
		nextMap[normalizedBookPath] = normalizedAppendPath;
	} else {
		delete nextMap[normalizedBookPath];
	}
	return nextMap;
}

type LegacyExcerptSettingsInput = Partial<EpubExcerptSettings> & {
	bookNotesExportTemplate?: "template1" | "template2";
};

export function normalizeBookNotesExportExcerptFields(
	settings: LegacyExcerptSettingsInput
): Pick<
	EpubExcerptSettings,
	| "bookNotesExportTemplatePath"
	| "bookNotesExportTemplateFolder"
	| "bookNotesExportLegacyTemplate"
	| "bookNotesExportTargetMode"
	| "bookNotesExportAppendPath"
	| "bookNotesExportTrimBlocks"
	| "bookNotesExportIncludeHighlight"
	| "bookNotesExportIncludeUnderline"
	| "bookNotesExportIncludeStrikethrough"
	| "bookNotesExportIncludeWavy"
> {
	const legacyTemplateSetting = settings.bookNotesExportTemplate;
	const legacyTemplateFromOldSetting: BookNotesExportLegacyTemplate =
		legacyTemplateSetting === "template2" ? "callout" : "classic";
	const resolvedLegacyTemplate =
		settings.bookNotesExportLegacyTemplate === "callout"
			? "callout"
			: legacyTemplateFromOldSetting;
	const templateFolder = resolveBookNotesExportTemplateFolder({
		bookNotesExportTemplateFolder: settings.bookNotesExportTemplateFolder,
	});
	let bookNotesExportTemplatePath =
		typeof settings.bookNotesExportTemplatePath === "string" &&
		settings.bookNotesExportTemplatePath.trim()
			? settings.bookNotesExportTemplatePath.trim()
			: DEFAULT_EPUB_EXCERPT_SETTINGS.bookNotesExportTemplatePath;
	if (
		bookNotesExportTemplatePath &&
		!isFileWithinVaultFolder(bookNotesExportTemplatePath, templateFolder)
	) {
		bookNotesExportTemplatePath = DEFAULT_EPUB_EXCERPT_SETTINGS.bookNotesExportTemplatePath;
	}
	return {
		bookNotesExportTemplatePath,
		bookNotesExportTemplateFolder: templateFolder,
		bookNotesExportLegacyTemplate: resolvedLegacyTemplate,
		bookNotesExportTargetMode:
			settings.bookNotesExportTargetMode === "append"
				? "append"
				: DEFAULT_EPUB_EXCERPT_SETTINGS.bookNotesExportTargetMode,
		bookNotesExportAppendPath:
			typeof settings.bookNotesExportAppendPath === "string" &&
			settings.bookNotesExportAppendPath.trim()
				? settings.bookNotesExportAppendPath.trim()
				: DEFAULT_EPUB_EXCERPT_SETTINGS.bookNotesExportAppendPath,
		bookNotesExportTrimBlocks:
			typeof settings.bookNotesExportTrimBlocks === "boolean"
				? settings.bookNotesExportTrimBlocks
				: DEFAULT_EPUB_EXCERPT_SETTINGS.bookNotesExportTrimBlocks,
		bookNotesExportIncludeHighlight:
			typeof settings.bookNotesExportIncludeHighlight === "boolean"
				? settings.bookNotesExportIncludeHighlight
				: DEFAULT_EPUB_EXCERPT_SETTINGS.bookNotesExportIncludeHighlight,
		bookNotesExportIncludeUnderline:
			typeof settings.bookNotesExportIncludeUnderline === "boolean"
				? settings.bookNotesExportIncludeUnderline
				: DEFAULT_EPUB_EXCERPT_SETTINGS.bookNotesExportIncludeUnderline,
		bookNotesExportIncludeStrikethrough:
			typeof settings.bookNotesExportIncludeStrikethrough === "boolean"
				? settings.bookNotesExportIncludeStrikethrough
				: DEFAULT_EPUB_EXCERPT_SETTINGS.bookNotesExportIncludeStrikethrough,
		bookNotesExportIncludeWavy:
			typeof settings.bookNotesExportIncludeWavy === "boolean"
				? settings.bookNotesExportIncludeWavy
				: DEFAULT_EPUB_EXCERPT_SETTINGS.bookNotesExportIncludeWavy,
	};
}
