import type {
	HighlightClickInfo,
	ReaderAnchorPoint,
	ReaderHighlight,
	ReaderViewportRect,
} from "./reader-engine-types";

export type RawViewportRect = {
	left: number;
	top: number;
	width: number;
	height: number;
};

export function createElementViewportRect(element: Element): ReaderViewportRect | null {
	const rect = element.getBoundingClientRect?.();
	if (!rect || (!rect.width && !rect.height)) {
		return null;
	}
	return {
		top: rect.top,
		left: rect.left,
		bottom: rect.bottom,
		right: rect.right,
		width: rect.width,
		height: rect.height,
	};
}

export function createAnchorPointFromRect(
	rect: ReaderViewportRect | null | undefined
): ReaderAnchorPoint | undefined {
	if (!rect) {
		return undefined;
	}
	return {
		x: rect.left + rect.width / 2,
		y: rect.top + rect.height / 2,
	};
}

export function createViewportRectFromRawRect(rect: RawViewportRect): ReaderViewportRect | null {
	if (
		!Number.isFinite(rect.left) ||
		!Number.isFinite(rect.top) ||
		rect.width <= 0 ||
		rect.height <= 0
	) {
		return null;
	}
	return {
		top: rect.top,
		left: rect.left,
		bottom: rect.top + rect.height,
		right: rect.left + rect.width,
		width: rect.width,
		height: rect.height,
	};
}

export function createViewportRectListFromRawRectList(
	rects: RawViewportRect[]
): ReaderViewportRect[] {
	return rects
		.map((rect) => createViewportRectFromRawRect(rect))
		.filter((rect): rect is ReaderViewportRect => Boolean(rect));
}

export function createViewportRectFromRawRectList(rects: RawViewportRect[]): ReaderViewportRect | null {
	const validRects = createViewportRectListFromRawRectList(rects);
	if (!validRects.length) {
		return null;
	}
	const left = Math.min(...validRects.map((rect) => rect.left));
	const top = Math.min(...validRects.map((rect) => rect.top));
	const right = Math.max(...validRects.map((rect) => rect.right));
	const bottom = Math.max(...validRects.map((rect) => rect.bottom));
	return {
		top,
		left,
		bottom,
		right,
		width: right - left,
		height: bottom - top,
	};
}

export function buildHighlightClickInfo(
	highlight: ReaderHighlight,
	geometry: {
		rect: HighlightClickInfo["rect"];
		rects?: HighlightClickInfo["rects"];
		anchorPoint?: HighlightClickInfo["anchorPoint"];
	},
	interactionTarget: HighlightClickInfo["interactionTarget"] = "highlight"
): HighlightClickInfo {
	return {
		cfiRange: highlight.cfiRange,
		color: highlight.color,
		style: highlight.style,
		semanticId: highlight.semanticId,
		semanticLabel: highlight.semanticLabel,
		semanticGroup: highlight.semanticGroup,
		semanticDescription: highlight.semanticDescription,
		semanticSource: highlight.semanticSource,
		text: highlight.text || "",
		commentText: highlight.commentText,
		hasCommentDivider: highlight.hasCommentDivider,
		sourceFile: highlight.sourceFile || "",
		sourceRef: highlight.sourceRef,
		excerptId: highlight.excerptId,
		sourceLocators: highlight.sourceLocators,
		createdTime: highlight.createdTime,
		temporary: highlight.temporary,
		presentation: highlight.presentation,
		interactionTarget,
		rect: geometry.rect,
		rects: geometry.rects,
		anchorPoint: geometry.anchorPoint,
	};
}

export function hasUsableOverlayRects(rects: unknown[]): boolean {
	if (!Array.isArray(rects) || rects.length === 0) {
		return false;
	}
	return rects.some((rect) => {
		const candidate = rect as { width?: number; height?: number };
		return Number(candidate.width) > 0 || Number(candidate.height) > 0;
	});
}

export function extractRangeClientRects(range: Range): RawViewportRect[] {
	const rects = Array.from(range.getClientRects?.() || [])
		.map((rect) => ({
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
		}))
		.filter((rect) => rect.width > 0 || rect.height > 0);
	if (rects.length > 0) {
		return rects;
	}
	const fallbackRect = range.getBoundingClientRect?.();
	if (fallbackRect && (fallbackRect.width > 0 || fallbackRect.height > 0)) {
		return [
			{
				left: fallbackRect.left,
				top: fallbackRect.top,
				width: fallbackRect.width,
				height: fallbackRect.height,
			},
		];
	}
	return [];
}

export function extractRangeBoundingRect(range: Range): RawViewportRect | null {
	const rect = range.getBoundingClientRect?.();
	if (rect && (rect.width > 0 || rect.height > 0)) {
		return {
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
		};
	}
	return extractRangeClientRects(range)[0] || null;
}
