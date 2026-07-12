import type { EpubFlowMode, EpubLayoutMode, EpubWidthMode } from "./types";

export interface PaginatorLayoutMetrics {
	hostWidth: number;
	inlineSize: string;
	paginatorMargin: number;
	gap: string;
}

export interface ReaderRendererLayoutInput {
	renderContainerWidth: number;
	rendererClientWidth: number;
	currentWidthMode: EpubWidthMode;
	currentLayoutMode: EpubLayoutMode;
	currentFlowMode: EpubFlowMode;
	currentPageMargin: number;
}

export interface FoliateRendererElement {
	tagName: string;
	setAttribute: (name: string, value: string) => void;
	render?: () => void;
}

export function isFoliatePaginatorTagName(tagName: unknown): boolean {
	if (typeof tagName !== "string" || !tagName.trim()) {
		return false;
	}
	return tagName.toLowerCase() === "foliate-paginator";
}

export function isFoliatePaginatorRenderer(
	renderer: FoliateRendererElement | null | undefined
): boolean {
	return isFoliatePaginatorTagName(renderer?.tagName);
}

export function computePaginatorLayoutMetrics(
	input: ReaderRendererLayoutInput
): PaginatorLayoutMetrics {
	const hostWidth = Math.max(0, Math.round(input.renderContainerWidth), input.rendererClientWidth);
	const isEdgeWidth = input.currentWidthMode === "edge";
	const isFitWidth = input.currentWidthMode === "fit";
	const isDoublePaginated =
		input.currentLayoutMode === "double" && input.currentFlowMode === "paginated";
	const isDoubleFitWidth = isFitWidth && isDoublePaginated;
	const paginatorMargin = isEdgeWidth
		? 0
		: isDoubleFitWidth
			? Math.min(32, Math.max(16, Math.round(input.currentPageMargin * 0.5)))
			: Math.max(0, Math.round(input.currentPageMargin));
	const fitInlineSize = Math.max(hostWidth - paginatorMargin * 2, 0);
	const doubleFitInlineSize = Math.max(Math.floor(fitInlineSize / 2), 0);
	const inlineSize = isEdgeWidth
		? `${Math.max(hostWidth, 0)}px`
		: isFitWidth
			? `${isDoublePaginated ? doubleFitInlineSize : fitInlineSize}px`
			: input.currentWidthMode === "full"
				? "920px"
				: "720px";
	const gap =
		input.currentFlowMode === "scrolled"
			? "4%"
			: isDoubleFitWidth
				? "6%"
				: input.currentLayoutMode === "double"
					? "10%"
					: "7%";

	return {
		hostWidth,
		inlineSize,
		paginatorMargin,
		gap,
	};
}

export function applyRendererLayoutAttributes(
	renderer: FoliateRendererElement,
	metrics: PaginatorLayoutMetrics,
	flowMode: EpubFlowMode,
	layoutMode: EpubLayoutMode,
	widthMode: EpubWidthMode
): void {
	const rawTagName = renderer.tagName;
	if (typeof rawTagName !== "string" || !rawTagName.trim()) {
		return;
	}
	const tagName = rawTagName.toLowerCase();
	if (tagName === "foliate-paginator") {
		renderer.setAttribute("flow", flowMode === "scrolled" ? "scrolled" : "paginated");
		renderer.setAttribute("max-column-count", layoutMode === "double" ? "2" : "1");
		renderer.setAttribute("max-inline-size", metrics.inlineSize);
		renderer.setAttribute("max-block-size", "1440px");
		renderer.setAttribute("margin", `${metrics.paginatorMargin}px`);
		renderer.setAttribute("gap", metrics.gap);
		renderer.setAttribute("animated", "");
		renderer.render?.();
		return;
	}

	if (tagName === "foliate-fxl") {
		renderer.setAttribute(
			"zoom",
			widthMode === "full" || widthMode === "edge" ? "fit-width" : "fit-page"
		);
	}
}
