import { describe, expect, it } from "vitest";
import {
	buildScreenPaginationLayoutKey,
	buildScreenPaginationState,
	cloneTocItemsWithScreenPages,
	estimateScreenPageCount,
	resolveScreenPageRange,
} from "../epub-screen-pagination";

describe("epub screen pagination", () => {
	it("estimates pages from the current screen capacity instead of a fixed text bucket", () => {
		expect(
			estimateScreenPageCount({
				textLength: 3600,
				viewportHeight: 720,
				inlineWidthPx: 420,
				fontSizePx: 20,
				lineHeight: 1.8,
				letterSpacing: 0,
				layoutMode: "paginated",
				flowMode: "paginated",
				fallbackPositionCount: 2,
				fixedLayout: false,
			})
		).toBeGreaterThan(2);
	});

	it("keeps dual-page display as two page numbers rather than halving the book total", () => {
		const state = buildScreenPaginationState({
			sections: [
				{ index: 0, href: "chapter-1.xhtml", textLength: 2000, fallbackPositionCount: 2 },
				{ index: 1, href: "chapter-2.xhtml", textLength: 2000, fallbackPositionCount: 2 },
			],
			layout: {
				bookId: "book",
				viewportWidth: 1200,
				viewportHeight: 720,
				inlineWidthPx: 520,
				fontSizePx: 18,
				lineHeight: 1.6,
				letterSpacing: 0,
				pageMargin: 48,
				gap: "10%",
				widthMode: "full",
				layoutMode: "double",
				flowMode: "paginated",
			},
		});

		const range = resolveScreenPageRange({
			state,
			sectionIndex: 0,
			sectionLocalPage: 1,
			visiblePageCount: 2,
		});

		expect(range.startPage).toBe(1);
		expect(range.endPage).toBe(2);
		expect(range.label).toBe("1-2");
		expect(state.totalPages).toBeGreaterThanOrEqual(4);
	});

	it("uses cumulative full-book page starts across sections", () => {
		const state = buildScreenPaginationState({
			sections: [
				{ index: 0, href: "chapter-1.xhtml", textLength: 400, fallbackPositionCount: 1 },
				{ index: 1, href: "chapter-2.xhtml", textLength: 400, fallbackPositionCount: 1 },
				{ index: 2, href: "chapter-3.xhtml", textLength: 400, fallbackPositionCount: 1 },
			],
			layout: {
				bookId: "book",
				viewportWidth: 720,
				viewportHeight: 720,
				inlineWidthPx: 720,
				fontSizePx: 18,
				lineHeight: 1.6,
				letterSpacing: 0,
				pageMargin: 48,
				gap: "7%",
				widthMode: "standard",
				layoutMode: "paginated",
				flowMode: "paginated",
			},
		});

		expect(state.sections.map((section) => section.pageStart)).toEqual([1, 2, 3]);
		expect(state.totalPages).toBe(3);
	});

	it("includes layout-affecting settings in the layout key", () => {
		const base = {
			bookId: "book",
			viewportWidth: 720,
			viewportHeight: 720,
			inlineWidthPx: 720,
			fontSizePx: 18,
			lineHeight: 1.6,
			letterSpacing: 0,
			pageMargin: 48,
			gap: "7%",
			widthMode: "standard" as const,
			layoutMode: "paginated" as const,
			flowMode: "paginated" as const,
		};

		expect(buildScreenPaginationLayoutKey(base)).not.toBe(
			buildScreenPaginationLayoutKey({ ...base, layoutMode: "double" })
		);
		expect(buildScreenPaginationLayoutKey(base)).not.toBe(
			buildScreenPaginationLayoutKey({ ...base, viewportHeight: 900 })
		);
	});

	it("clones TOC items with screen pages without mutating parser-owned items", () => {
		const toc = [
			{
				id: "root",
				label: "Root",
				href: "chapter-1.xhtml",
				level: 1,
				pageNumber: 7,
				subitems: [
					{
						id: "child",
						label: "Child",
						href: "chapter-2.xhtml",
						level: 2,
					},
				],
			},
		];

		const cloned = cloneTocItemsWithScreenPages(toc, (item) =>
			item.href === "chapter-1.xhtml" ? 1 : 3
		);

		expect(cloned[0]?.screenPageNumber).toBe(1);
		expect(cloned[0]?.subitems?.[0]?.screenPageNumber).toBe(3);
		expect(toc[0]?.screenPageNumber).toBeUndefined();
		expect(cloned[0]).not.toBe(toc[0]);
		expect(cloned[0]?.subitems?.[0]).not.toBe(toc[0]?.subitems?.[0]);
	});
});
