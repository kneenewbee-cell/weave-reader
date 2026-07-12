import type { FlatTocItem } from "../../utils/epub-toc-reading-position";
import { normalizeTocHref } from "../../utils/epub-toc-reading-position";

/** Manual chapter marks shown as colored TOC bullets. */
export type EpubTocChapterManualMark = "important" | "question" | "mastered";

/** All persisted TOC chapter mark values, including auto incremental-reading marks. */
export type EpubTocChapterMark = EpubTocChapterManualMark | "incremental";

export type EpubTocChapterMarkMap = Record<string, EpubTocChapterMark>;

const MANUAL_MARKS = new Set<EpubTocChapterManualMark>(["important", "question", "mastered"]);
const ALL_MARKS = new Set<EpubTocChapterMark>(["important", "question", "mastered", "incremental"]);

/** Stable display / settings order for TOC chapter marks. */
export const EPUB_TOC_CHAPTER_MARK_ORDER: readonly EpubTocChapterMark[] = [
	"important",
	"question",
	"mastered",
	"incremental",
];

/** Preserve fragment anchors so sibling TOC entries in one file stay distinct. */
export function normalizeTocChapterMarkKey(href: string): string {
	return String(href || "").trim();
}

export function isEpubTocChapterManualMark(value: unknown): value is EpubTocChapterManualMark {
	return typeof value === "string" && MANUAL_MARKS.has(value as EpubTocChapterManualMark);
}

export function isEpubTocChapterMark(value: unknown): value is EpubTocChapterMark {
	return typeof value === "string" && ALL_MARKS.has(value as EpubTocChapterMark);
}

export function normalizeTocChapterMarkMap(value: unknown): EpubTocChapterMarkMap {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}

	const normalized: EpubTocChapterMarkMap = {};
	for (const [rawHref, rawMark] of Object.entries(value as Record<string, unknown>)) {
		const href = normalizeTocChapterMarkKey(rawHref);
		if (!href || !isEpubTocChapterMark(rawMark)) {
			continue;
		}
		normalized[href] = rawMark;
	}
	return normalized;
}

function lookupExplicitTocChapterMark(
	href: string,
	marks: EpubTocChapterMarkMap
): EpubTocChapterMark | null {
	const key = normalizeTocChapterMarkKey(href);
	if (key && marks[key]) {
		return marks[key];
	}

	// Legacy file-level keys (saved before fragment-aware storage) apply only to
	// entries without their own fragment anchor.
	const legacyKey = normalizeTocHref(href);
	if (
		legacyKey
		&& legacyKey !== key
		&& !key.includes("#")
		&& marks[legacyKey]
	) {
		return marks[legacyKey];
	}

	return null;
}

/** Returns a mark stored directly on this TOC href (no ancestor inheritance). */
export function getExplicitTocChapterMark(
	href: string,
	marks: EpubTocChapterMarkMap | null | undefined
): EpubTocChapterMark | null {
	if (!marks) {
		return null;
	}
	return lookupExplicitTocChapterMark(href, marks);
}

export function resolveTocChapterMarkDisplay(
	flatItems: ReadonlyArray<Pick<FlatTocItem, "href" | "depth">>,
	itemIndex: number,
	marks: EpubTocChapterMarkMap | null | undefined
): EpubTocChapterMark | null {
	if (!marks || itemIndex < 0 || itemIndex >= flatItems.length) {
		return null;
	}

	const selfMark = getExplicitTocChapterMark(flatItems[itemIndex].href, marks);
	if (selfMark) {
		return selfMark;
	}

	let depth = flatItems[itemIndex].depth;
	for (let index = itemIndex - 1; index >= 0; index -= 1) {
		const candidate = flatItems[index];
		if (candidate.depth >= depth) {
			continue;
		}

		const ancestorMark = getExplicitTocChapterMark(candidate.href, marks);
		if (ancestorMark) {
			return ancestorMark;
		}

		depth = candidate.depth;
		if (depth <= 0) {
			break;
		}
	}

	return null;
}

export function shouldApplyIncrementalTocMark(
	currentMark: EpubTocChapterMark | null | undefined
): boolean {
	return !currentMark || currentMark === "incremental";
}
