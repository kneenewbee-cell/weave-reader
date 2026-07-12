import { describe, expect, it } from "vitest";
import {
	BOOKSHELF_GRID_PAINT_OPTIMIZATION_THRESHOLD,
	BOOKSHELF_LIST_VIRTUAL_SCROLL_THRESHOLD,
	shouldUseBookshelfGridPaintOptimization,
	shouldUseBookshelfListVirtualScroll,
} from "../bookshelf-display-performance";

describe("bookshelf-display-performance", () => {
	it("enables list virtualization at the configured threshold", () => {
		expect(shouldUseBookshelfListVirtualScroll(BOOKSHELF_LIST_VIRTUAL_SCROLL_THRESHOLD - 1, "list")).toBe(
			false
		);
		expect(shouldUseBookshelfListVirtualScroll(BOOKSHELF_LIST_VIRTUAL_SCROLL_THRESHOLD, "list")).toBe(
			true
		);
		expect(shouldUseBookshelfListVirtualScroll(BOOKSHELF_LIST_VIRTUAL_SCROLL_THRESHOLD, "grid")).toBe(
			false
		);
	});

	it("enables grid paint optimization without list virtualization", () => {
		expect(
			shouldUseBookshelfGridPaintOptimization(BOOKSHELF_GRID_PAINT_OPTIMIZATION_THRESHOLD - 1, "grid")
		).toBe(false);
		expect(
			shouldUseBookshelfGridPaintOptimization(BOOKSHELF_GRID_PAINT_OPTIMIZATION_THRESHOLD, "grid")
		).toBe(true);
		expect(
			shouldUseBookshelfGridPaintOptimization(BOOKSHELF_GRID_PAINT_OPTIMIZATION_THRESHOLD, "list")
		).toBe(false);
	});
});
