import type { TocItem } from "../services/epub/types";
import type { EpubChapterLocationFormat } from "../services/epub/epub-excerpt-settings";
import { normalizeTocHref } from "./epub-toc-reading-position";

function tocHrefBasename(href: string): string {
	const path = normalizeTocHref(href);
	const segments = path.split("/").filter(Boolean);
	return (segments[segments.length - 1] || path).toLowerCase();
}

export const EPUB_CHAPTER_LOCATION_PATH_SEPARATOR = "/";

const SPLIT_SECTION_BASENAME_PATTERN = /^(.+)_split_\d+$/i;

function tocHrefFragment(href: string): string {
	const trimmed = String(href || "").trim();
	const hashIndex = trimmed.indexOf("#");
	return hashIndex >= 0 ? trimmed.slice(hashIndex) : "";
}

function hrefBasenameWithoutExtension(href: string): string {
	const basename = tocHrefBasename(href);
	return basename.replace(/\.[^.]+$/, "");
}

export function isSplitSectionHref(href: string): boolean {
	return SPLIT_SECTION_BASENAME_PATTERN.test(hrefBasenameWithoutExtension(href));
}

export function getSplitSectionParentBasename(href: string): string | null {
	const match = hrefBasenameWithoutExtension(href).match(SPLIT_SECTION_BASENAME_PATTERN);
	return match?.[1] || null;
}

function splitSectionMatchesTocParent(tocHref: string, sectionHref: string): boolean {
	const splitParent = getSplitSectionParentBasename(sectionHref);
	if (!splitParent) {
		return false;
	}
	return splitParent === hrefBasenameWithoutExtension(tocHref);
}

export function tocHrefMatchesSectionHref(tocHref: string, sectionHref: string): boolean {
	const trimmedToc = String(tocHref || "").trim();
	const trimmedSection = String(sectionHref || "").trim();
	if (!trimmedToc || !trimmedSection) {
		return false;
	}
	if (trimmedToc === trimmedSection) {
		return true;
	}

	const normalizedToc = normalizeTocHref(trimmedToc);
	const normalizedSection = normalizeTocHref(trimmedSection);
	if (!normalizedToc || !normalizedSection) {
		return false;
	}
	if (normalizedToc === normalizedSection) {
		return true;
	}
	if (
		normalizedSection.startsWith(`${normalizedToc}/`) ||
		normalizedToc.startsWith(`${normalizedSection}/`)
	) {
		return true;
	}

	const sectionBasename = tocHrefBasename(trimmedSection);
	const tocBasename = tocHrefBasename(trimmedToc);
	if (sectionBasename && tocBasename && sectionBasename === tocBasename) {
		return true;
	}

	// Calibre/Kepub split spine items (e.g. part0011_split_009.xhtml) map to parent TOC files.
	if (isSplitSectionHref(trimmedSection) && splitSectionMatchesTocParent(trimmedToc, trimmedSection)) {
		return !tocHrefFragment(trimmedToc);
	}

	return false;
}

export function resolveTocLabelPathForSectionHref(
	tocItems: TocItem[],
	sectionHref: string | null | undefined
): string[] {
	const trimmedSection = String(sectionHref || "").trim();
	if (!trimmedSection || tocItems.length === 0) {
		return [];
	}

	let bestPath: string[] = [];
	let bestDepth = -1;

	const visit = (entries: TocItem[], ancestors: string[]) => {
		for (const item of entries) {
			const label = String(item.label || "").trim();
			const path = label ? [...ancestors, label] : [...ancestors];
			if (tocHrefMatchesSectionHref(item.href, trimmedSection) && path.length > bestDepth) {
				bestDepth = path.length;
				bestPath = path;
			}
			if (item.subitems?.length) {
				visit(item.subitems, path);
			}
		}
	};

	visit(tocItems, []);
	return bestPath;
}

export function resolveTocLabelPathBySpineIndex(
	tocItems: TocItem[],
	sectionIndex: number,
	resolveSpineIndex: (href: string) => number
): string[] {
	if (!Number.isInteger(sectionIndex) || sectionIndex < 0 || tocItems.length === 0) {
		return [];
	}

	let bestPath: string[] = [];
	let bestSpineIndex = -1;
	let bestDepth = -1;

	const visit = (entries: TocItem[], ancestors: string[]) => {
		for (const item of entries) {
			const label = String(item.label || "").trim();
			const path = label ? [...ancestors, label] : [...ancestors];
			const spineIndex = resolveSpineIndex(item.href);
			if (spineIndex >= 0 && spineIndex <= sectionIndex) {
				if (
					spineIndex > bestSpineIndex ||
					(spineIndex === bestSpineIndex && path.length > bestDepth)
				) {
					bestSpineIndex = spineIndex;
					bestDepth = path.length;
					bestPath = path;
				}
			}
			if (item.subitems?.length) {
				visit(item.subitems, path);
			}
		}
	};

	visit(tocItems, []);
	return bestPath;
}

export function formatChapterLocationLabel(
	labels: string[],
	format: EpubChapterLocationFormat,
	separator = EPUB_CHAPTER_LOCATION_PATH_SEPARATOR
): string {
	const path = labels.map((label) => label.trim()).filter(Boolean);
	if (path.length === 0) {
		return "";
	}
	switch (format) {
		case "root":
			return path[0] || "";
		case "full":
			return path.join(separator);
		case "leaf":
		default:
			return path[path.length - 1] || "";
	}
}

export function normalizeChapterLocationFormat(value: unknown): EpubChapterLocationFormat {
	return value === "root" || value === "full" ? value : "leaf";
}

export function resolveChapterLocationLabel(
	tocItems: TocItem[],
	sectionHref: string | null | undefined,
	fallbackTitle: string,
	format: EpubChapterLocationFormat,
	options?: {
		sectionIndex?: number;
		resolveSpineIndex?: (href: string) => number;
	}
): string {
	const trimmedSectionHref = String(sectionHref || "").trim();
	const hrefPath = resolveTocLabelPathForSectionHref(tocItems, trimmedSectionHref);
	const sectionIndex = options?.sectionIndex;
	const resolveSpineIndex = options?.resolveSpineIndex;
	const preferSpineIndex =
		isSplitSectionHref(trimmedSectionHref) &&
		typeof sectionIndex === "number" &&
		sectionIndex >= 0 &&
		typeof resolveSpineIndex === "function";

	if (preferSpineIndex) {
		const spinePath = resolveTocLabelPathBySpineIndex(tocItems, sectionIndex, resolveSpineIndex);
		if (spinePath.length > 0) {
			return formatChapterLocationLabel(spinePath, format);
		}
	}

	if (hrefPath.length > 0) {
		return formatChapterLocationLabel(hrefPath, format);
	}

	if (
		typeof sectionIndex === "number" &&
		sectionIndex >= 0 &&
		typeof resolveSpineIndex === "function"
	) {
		const spinePath = resolveTocLabelPathBySpineIndex(tocItems, sectionIndex, resolveSpineIndex);
		if (spinePath.length > 0) {
			return formatChapterLocationLabel(spinePath, format);
		}
	}

	const effectivePath = [String(fallbackTitle || "").trim()].filter(Boolean);
	return formatChapterLocationLabel(effectivePath, format);
}
