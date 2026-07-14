import { tocHrefMatchesSectionHref } from "../../utils/epub-chapter-location-label";
import { normalizeTocHref, tocHrefBasename } from "../../utils/epub-toc-reading-position";
import type { TocItem } from "./types";

export interface EpubAnnotationChapterMetadata {
	chapterRootTitle?: string;
	chapterTitle?: string;
	chapterPath: string[];
	chapterHref?: string;
	spineIndex?: number;
}

export interface ResolveAnnotationChapterMetadataInput {
	tocItems: TocItem[];
	cfiRange?: string;
	sectionHref?: string | null;
	spineIndex?: number | null;
	fallbackChapterTitle?: string;
}

interface FlattenedTocEntry {
	title: string;
	path: string[];
	href: string;
	index: number;
	rootTitle: string;
	rootHref: string;
}

const CFI_BRACKET_PATTERN = /\[([^\]]+)]/g;

function normalizeText(value: unknown): string {
	return String(value || "").trim();
}

function normalizeSpineIndex(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.floor(value))
		: undefined;
}

function normalizeChapterPath(value: unknown): string[] {
	return Array.isArray(value)
		? value.map((entry) => normalizeText(entry)).filter(Boolean)
		: [];
}

function flattenTocItems(
	items: TocItem[],
	ancestors: string[] = [],
	output: FlattenedTocEntry[] = [],
	root?: { title: string; href: string }
): FlattenedTocEntry[] {
	for (const item of items || []) {
		const title = normalizeText(item?.label);
		const href = normalizeText(item.href);
		const path = title ? [...ancestors, title] : [...ancestors];
		const entryRoot = root || (title ? { title, href } : undefined);
		if (title) {
			output.push({
				title,
				path,
				href,
				index: output.length,
				rootTitle: normalizeText(entryRoot?.title) || title,
				rootHref: normalizeText(entryRoot?.href) || href,
			});
		}
		if (item.subitems?.length) {
			flattenTocItems(item.subitems, path, output, entryRoot);
		}
	}
	return output;
}

function extractCfiBracketTokens(cfiRange: unknown): Set<string> {
	const tokens = new Set<string>();
	const cfiText = normalizeText(cfiRange);
	for (const match of cfiText.matchAll(CFI_BRACKET_PATTERN)) {
		const token = normalizeText(match[1]);
		if (token) {
			tokens.add(token);
			try {
				tokens.add(decodeURIComponent(token));
			} catch {
				// Keep the raw EPUB CFI id when percent-decoding is not valid.
			}
		}
	}
	return tokens;
}

function extractCfiSectionToken(cfiRange: unknown): string {
	const tokens = Array.from(extractCfiBracketTokens(cfiRange));
	const sectionToken =
		tokens.find((token) => /_epub_/i.test(token) || /^b\d+/i.test(token)) ||
		tokens[0] ||
		"";
	return sectionToken.toLowerCase().replace(/\.[a-z0-9]+$/i, "");
}

function hrefFragment(href: unknown): string {
	const text = normalizeText(href);
	const hashIndex = text.indexOf("#");
	if (hashIndex < 0) {
		return "";
	}
	const raw = text.slice(hashIndex + 1).trim();
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

function hrefMatchesCfiSection(entry: FlattenedTocEntry, cfiSectionToken: string): boolean {
	if (!cfiSectionToken) {
		return false;
	}
	const href = normalizeTocHref(entry.href).toLowerCase();
	const basename = tocHrefBasename(entry.href).replace(/\.[^.]+$/, "").toLowerCase();
	return href.includes(cfiSectionToken) || basename === cfiSectionToken;
}

function findBestEntry(input: {
	entries: FlattenedTocEntry[];
	cfiRange?: string;
	sectionHref?: string | null;
}): FlattenedTocEntry | null {
	const { entries, cfiRange } = input;
	const sectionHref = normalizeText(input.sectionHref);
	const cfiTokens = extractCfiBracketTokens(cfiRange);
	const cfiSectionToken = extractCfiSectionToken(cfiRange);

	const sectionCandidates = entries.filter((entry) => {
		if (sectionHref) {
			return tocHrefMatchesSectionHref(entry.href, sectionHref);
		}
		return hrefMatchesCfiSection(entry, cfiSectionToken);
	});
	if (sectionCandidates.length === 0) {
		return null;
	}

	const anchorMatches = sectionCandidates.filter((entry) => {
		const fragment = hrefFragment(entry.href);
		return Boolean(fragment && cfiTokens.has(fragment));
	});
	if (anchorMatches.length > 0) {
		return [...anchorMatches].sort((left, right) => {
			const depthDiff = right.path.length - left.path.length;
			return depthDiff !== 0 ? depthDiff : left.index - right.index;
		})[0] || null;
	}

	const sectionRootMatches = sectionCandidates.filter((entry) => !hrefFragment(entry.href));
	if (sectionRootMatches.length > 0) {
		return [...sectionRootMatches].sort((left, right) => {
			const depthDiff = left.path.length - right.path.length;
			return depthDiff !== 0 ? depthDiff : left.index - right.index;
		})[0] || null;
	}

	const rootSignatures = new Map<string, FlattenedTocEntry>();
	for (const entry of sectionCandidates) {
		const rootTitle = normalizeText(entry.rootTitle || entry.path[0]);
		const rootHref = normalizeText(entry.rootHref);
		const signature = `${rootHref}\u0000${rootTitle}`;
		if (rootTitle && !rootSignatures.has(signature)) {
			rootSignatures.set(signature, entry);
		}
	}
	if (rootSignatures.size === 1) {
		return Array.from(rootSignatures.values())[0] || null;
	}

	return null;
}

function metadataFromEntry(
	entry: FlattenedTocEntry | null,
	spineIndex: number | undefined
): EpubAnnotationChapterMetadata {
	if (!entry) {
		return {
			chapterPath: [],
			...(spineIndex !== undefined ? { spineIndex } : {}),
		};
	}
	const entryPath = normalizeChapterPath(entry.path);
	const chapterRootTitle = normalizeText(entry.rootTitle) || entryPath[0];
	const chapterPath = chapterRootTitle ? [chapterRootTitle] : [];
	const chapterTitle = chapterRootTitle;
	const chapterHref = normalizeText(entry.rootHref) || (entryPath.length <= 1 ? entry.href : "");
	return {
		...(chapterRootTitle ? { chapterRootTitle } : {}),
		...(chapterTitle ? { chapterTitle } : {}),
		chapterPath,
		...(chapterHref ? { chapterHref } : {}),
		...(spineIndex !== undefined ? { spineIndex } : {}),
	};
}

export function resolveAnnotationChapterMetadata(
	input: ResolveAnnotationChapterMetadataInput
): EpubAnnotationChapterMetadata {
	const entries = flattenTocItems(input.tocItems || []);
	const spineIndex = normalizeSpineIndex(input.spineIndex);
	const entry = findBestEntry({
		entries,
		cfiRange: input.cfiRange,
		sectionHref: input.sectionHref,
	});
	return metadataFromEntry(entry, spineIndex);
}

export function applyAnnotationChapterMetadata<T extends Record<string, unknown>>(
	annotation: T,
	metadata: EpubAnnotationChapterMetadata
): T & EpubAnnotationChapterMetadata {
	const next = { ...annotation } as T & EpubAnnotationChapterMetadata;
	const chapterPath = normalizeChapterPath(metadata.chapterPath);
	if (chapterPath.length > 0) {
		next.chapterPath = chapterPath;
		next.chapterRootTitle = normalizeText(metadata.chapterRootTitle) || chapterPath[0];
		next.chapterTitle = normalizeText(metadata.chapterTitle) || chapterPath[chapterPath.length - 1];
		const chapterHref = normalizeText(metadata.chapterHref);
		if (chapterHref) {
			next.chapterHref = chapterHref;
		}
	}
	const spineIndex = normalizeSpineIndex(metadata.spineIndex);
	if (spineIndex !== undefined) {
		next.spineIndex = spineIndex;
	}
	return next;
}

export function hasAnnotationChapterMetadataChanged(
	before: Record<string, unknown>,
	after: Record<string, unknown>
): boolean {
	const fields = ["chapterRootTitle", "chapterTitle", "chapterPath", "chapterHref", "spineIndex"];
	return fields.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}
