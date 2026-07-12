import type { EpubBook, EpubReaderEngine, TocItem } from "../services/epub";

export type FlatTocItem = TocItem & { depth: number };

export function flattenTocItems(source: TocItem[], depth = 0): FlatTocItem[] {
	const result: FlatTocItem[] = [];
	for (const item of source) {
		result.push({ ...item, depth });
		if (item.subitems?.length) {
			result.push(...flattenTocItems(item.subitems, depth + 1));
		}
	}
	return result;
}

export function normalizeTocHref(href: string): string {
	const normalized = String(href || "").trim();
	if (!normalized) {
		return "";
	}

	const hashIndex = normalized.indexOf("#");
	return (hashIndex >= 0 ? normalized.slice(0, hashIndex) : normalized).trim();
}

export function tocHrefBasename(href: string): string {
	const path = normalizeTocHref(href);
	const segments = path.split("/").filter(Boolean);
	return (segments[segments.length - 1] || path).toLowerCase();
}

function tocHrefFragment(href: string): string {
	const trimmed = String(href || "").trim();
	const hashIndex = trimmed.indexOf("#");
	return hashIndex >= 0 ? trimmed.slice(hashIndex) : "";
}

const SPLIT_SECTION_BASENAME_PATTERN = /^(.+)_split_\d+$/i;

function hrefBasenameWithoutExtension(href: string): string {
	const basename = tocHrefBasename(href);
	return basename.replace(/\.[^.]+$/, "");
}

function isSplitSectionHref(href: string): boolean {
	return SPLIT_SECTION_BASENAME_PATTERN.test(hrefBasenameWithoutExtension(href));
}

function splitSectionMatchesTocParent(tocHref: string, sectionHref: string): boolean {
	const match = hrefBasenameWithoutExtension(sectionHref).match(SPLIT_SECTION_BASENAME_PATTERN);
	const splitParent = match?.[1];
	if (!splitParent) {
		return false;
	}
	return splitParent === hrefBasenameWithoutExtension(tocHref);
}

function tocHrefPathsMatch(normalizedTarget: string, normalizedItemHref: string): boolean {
	if (!normalizedTarget || !normalizedItemHref) {
		return false;
	}
	return (
		normalizedTarget === normalizedItemHref
		|| normalizedTarget.startsWith(`${normalizedItemHref}/`)
		|| normalizedItemHref.startsWith(`${normalizedTarget}/`)
		|| normalizedTarget.endsWith(`/${normalizedItemHref}`)
		|| normalizedItemHref.endsWith(`/${normalizedTarget}`)
	);
}

export function resolveSavedReadingSectionHref(
	book: EpubBook | null | undefined,
	readerService: EpubReaderEngine | null | undefined
): string | null {
	if (!book?.currentPosition) {
		return null;
	}

	const position = book.currentPosition;
	const hasMeaningfulProgress =
		(typeof position.percent === "number" && position.percent > 0)
		|| Boolean(String(position.cfi || "").trim())
		|| (typeof position.chapterIndex === "number" && position.chapterIndex > 0);

	if (!hasMeaningfulProgress) {
		return null;
	}

	const cfi = String(position.cfi || "").trim();
	if (cfi && typeof readerService?.getSectionHrefForCfi === "function") {
		const hrefFromCfi = readerService.getSectionHrefForCfi(cfi);
		if (hrefFromCfi) {
			return hrefFromCfi;
		}
	}

	if (typeof readerService?.getSectionHrefByChapterIndex === "function") {
		const chapterIndex =
			typeof position.chapterIndex === "number" && Number.isFinite(position.chapterIndex)
				? Math.max(0, Math.floor(position.chapterIndex))
				: 0;
		const hrefFromIndex = readerService.getSectionHrefByChapterIndex(chapterIndex);
		if (hrefFromIndex) {
			return hrefFromIndex;
		}
	}

	return null;
}

export function findTocHrefForSectionHref(
	items: TocItem[],
	sectionHref: string | null | undefined
): string | null {
	if (!sectionHref) {
		return null;
	}

	const flatItems = flattenTocItems(items);
	if (flatItems.length === 0) {
		return null;
	}

	const normalizedTarget = normalizeTocHref(sectionHref);
	const trimmedTarget = String(sectionHref || "").trim();

	for (const item of flatItems) {
		if (item.href === trimmedTarget) {
			return item.href;
		}
	}

	for (const item of flatItems) {
		if (normalizeTocHref(item.href) === normalizedTarget) {
			return item.href;
		}
	}

	if (isSplitSectionHref(trimmedTarget)) {
		let splitMatch: FlatTocItem | null = null;
		for (const item of flatItems) {
			if (!splitSectionMatchesTocParent(item.href, trimmedTarget) || tocHrefFragment(item.href)) {
				continue;
			}
			if (!splitMatch || item.depth < splitMatch.depth) {
				splitMatch = item;
			}
		}
		if (splitMatch) {
			return splitMatch.href;
		}
	}

	const targetBasename = tocHrefBasename(trimmedTarget);
	const targetFragment = tocHrefFragment(trimmedTarget);
	if (targetBasename) {
		let basenameMatch: FlatTocItem | null = null;
		for (const item of flatItems) {
			if (tocHrefBasename(item.href) !== targetBasename) {
				continue;
			}
			if (targetFragment) {
				const itemFragment = tocHrefFragment(item.href);
				if (itemFragment && itemFragment !== targetFragment) {
					continue;
				}
				if (!basenameMatch || item.depth > basenameMatch.depth) {
					basenameMatch = item;
				}
				continue;
			}
			if (!basenameMatch || item.depth < basenameMatch.depth) {
				basenameMatch = item;
			}
		}
		if (basenameMatch) {
			return basenameMatch.href;
		}
	}

	let bestMatch: FlatTocItem | null = null;
	for (const item of flatItems) {
		const normalizedItemHref = normalizeTocHref(item.href);
		if (!normalizedItemHref) {
			continue;
		}

		if (!tocHrefPathsMatch(normalizedTarget, normalizedItemHref)) {
			continue;
		}

		if (!bestMatch || item.depth > bestMatch.depth) {
			bestMatch = item;
		}
	}

	return bestMatch?.href ?? null;
}

export function resolveLastReadTocHref(
	book: EpubBook | null | undefined,
	readerService: EpubReaderEngine | null | undefined,
	tocItems: TocItem[]
): string | null {
	const sectionHref = resolveSavedReadingSectionHref(book, readerService);
	return findTocHrefForSectionHref(tocItems, sectionHref);
}

export function resolveActiveTocHref(
	tocItems: TocItem[],
	sectionHref: string | null | undefined
): string | null {
	return findTocHrefForSectionHref(tocItems, sectionHref);
}

export function isTocHrefActive(
	itemHref: string,
	activeHref: string | null | undefined
): boolean {
	const trimmedActive = String(activeHref || "").trim();
	if (!trimmedActive) {
		return false;
	}
	return String(itemHref || "").trim() === trimmedActive;
}
