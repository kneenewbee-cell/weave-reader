import { describe, expect, it } from "vitest";
import type { FlatTocItem } from "../../../utils/epub-toc-reading-position";
import {
	EPUB_TOC_CHAPTER_MARK_ORDER,
	getExplicitTocChapterMark,
	normalizeTocChapterMarkMap,
	resolveTocChapterMarkDisplay,
	shouldApplyIncrementalTocMark,
} from "../epub-toc-chapter-mark";

const nestedFlatItems: FlatTocItem[] = [
	{ id: "a", label: "A", href: "Text/chapter.xhtml", depth: 0 },
	{ id: "b", label: "B", href: "Text/chapter.xhtml#section-b", depth: 1 },
	{ id: "c", label: "C", href: "Text/chapter.xhtml#section-c", depth: 2 },
	{ id: "d", label: "D", href: "Text/chapter.xhtml#section-d", depth: 2 },
];

describe("epub-toc-chapter-mark", () => {
	it("preserves fragment anchors in stored keys", () => {
		expect(
			normalizeTocChapterMarkMap({
				"Text/chapter1.xhtml#intro": "important",
				"Text/chapter2.xhtml": "invalid",
				"Text/chapter3.xhtml": "mastered",
			})
		).toEqual({
			"Text/chapter1.xhtml#intro": "important",
			"Text/chapter3.xhtml": "mastered",
		});
	});

	it("matches explicit marks only on the same href", () => {
		const marks = {
			"Text/chapter1.xhtml#section-c": "important",
		};
		expect(getExplicitTocChapterMark("Text/chapter1.xhtml#section-c", marks)).toBe("important");
		expect(getExplicitTocChapterMark("Text/chapter1.xhtml#section-b", marks)).toBeNull();
		expect(getExplicitTocChapterMark("Text/chapter1.xhtml", marks)).toBeNull();
		expect(getExplicitTocChapterMark("Text/chapter1.xhtml#section-b", marks)).toBeNull();
	});

	it("inherits marks only along TOC ancestors", () => {
		const marks = {
			"Text/chapter.xhtml#section-c": "important",
		};
		expect(resolveTocChapterMarkDisplay(nestedFlatItems, 2, marks)).toBe("important");
		expect(resolveTocChapterMarkDisplay(nestedFlatItems, 3, marks)).toBeNull();
		expect(resolveTocChapterMarkDisplay(nestedFlatItems, 1, marks)).toBeNull();
	});

	it("inherits a parent mark to all descendants", () => {
		const marks = {
			"Text/chapter.xhtml#section-b": "question",
		};
		expect(resolveTocChapterMarkDisplay(nestedFlatItems, 1, marks)).toBe("question");
		expect(resolveTocChapterMarkDisplay(nestedFlatItems, 2, marks)).toBe("question");
		expect(resolveTocChapterMarkDisplay(nestedFlatItems, 3, marks)).toBe("question");
		expect(resolveTocChapterMarkDisplay(nestedFlatItems, 0, marks)).toBeNull();
	});

	it("prefers an explicit child mark over an inherited parent mark", () => {
		const marks = {
			"Text/chapter.xhtml#section-b": "question",
			"Text/chapter.xhtml#section-c": "important",
		};
		expect(resolveTocChapterMarkDisplay(nestedFlatItems, 2, marks)).toBe("important");
		expect(resolveTocChapterMarkDisplay(nestedFlatItems, 3, marks)).toBe("question");
	});

	it("keeps legacy file-level marks on fragment-less entries only", () => {
		const marks = {
			"Text/chapter.xhtml": "mastered",
		};
		expect(getExplicitTocChapterMark("Text/chapter.xhtml", marks)).toBe("mastered");
		expect(getExplicitTocChapterMark("Text/chapter.xhtml#section-c", marks)).toBeNull();
	});

	it("keeps a stable mark display order", () => {
		expect(EPUB_TOC_CHAPTER_MARK_ORDER).toEqual([
			"important",
			"question",
			"mastered",
			"incremental",
		]);
	});

	it("allows incremental auto-mark only when no manual mark exists", () => {
		expect(shouldApplyIncrementalTocMark(null)).toBe(true);
		expect(shouldApplyIncrementalTocMark("incremental")).toBe(true);
		expect(shouldApplyIncrementalTocMark("important")).toBe(false);
		expect(shouldApplyIncrementalTocMark("question")).toBe(false);
		expect(shouldApplyIncrementalTocMark("mastered")).toBe(false);
	});
});
