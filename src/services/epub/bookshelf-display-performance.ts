import type { ResolvedBookshelfViewMode } from "./bookshelf-display-mode";

/**
 * List rows are structurally uniform (fixed thumb + clamped title), so fixed-height
 * virtualization is reliable and gives the best scroll performance in sidebar mode.
 */
export const BOOKSHELF_LIST_VIRTUAL_SCROLL_THRESHOLD = 24;

/**
 * Grid / cover layouts are multi-column; full row virtualization is heavier and brittle.
 * Native paint skipping is a better default until row-based virtualization is added.
 */
export const BOOKSHELF_GRID_PAINT_OPTIMIZATION_THRESHOLD = 12;

export const BOOKSHELF_LIST_VIRTUAL_ITEM_HEIGHT = 148;
export const BOOKSHELF_LIST_VIRTUAL_OVERSCAN = 4;

export function shouldUseBookshelfListVirtualScroll(
	itemCount: number,
	viewMode: ResolvedBookshelfViewMode
): boolean {
	return viewMode === "list" && itemCount >= BOOKSHELF_LIST_VIRTUAL_SCROLL_THRESHOLD;
}

export function shouldUseBookshelfGridPaintOptimization(
	itemCount: number,
	viewMode: ResolvedBookshelfViewMode
): boolean {
	return viewMode !== "list" && itemCount >= BOOKSHELF_GRID_PAINT_OPTIMIZATION_THRESHOLD;
}
