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
		chapterIndex: highlight.chapterIndex,
		chapterTitle: highlight.chapterTitle,
		chapterRootTitle: highlight.chapterRootTitle,
		chapterPath: highlight.chapterPath,
		chapterHref: highlight.chapterHref,
		spineIndex: highlight.spineIndex,
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

function getRangeRoot(range: Range): Element | null {
	const container = range.commonAncestorContainer;
	if (!container) {
		return null;
	}
	if (container.nodeType === Node.ELEMENT_NODE) {
		return container as Element;
	}
	return container.parentElement;
}

function getTextNodeSliceForRange(range: Range, node: Text): { start: number; end: number } | null {
	if (!range.intersectsNode(node)) {
		return null;
	}
	const text = node.textContent || "";
	let start = 0;
	let end = text.length;
	if (range.startContainer === node) {
		start = Math.max(0, Math.min(text.length, range.startOffset));
	}
	if (range.endContainer === node) {
		end = Math.max(0, Math.min(text.length, range.endOffset));
	}
	if (end <= start || !text.slice(start, end).trim()) {
		return null;
	}
	return { start, end };
}

function extractTextNodeClientRects(range: Range): RawViewportRect[] {
	const root = getRangeRoot(range);
	if (!root) {
		return [];
	}
	const doc = root.ownerDocument;
	const rects: RawViewportRect[] = [];
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		const node = walker.currentNode as Text;
		const slice = getTextNodeSliceForRange(range, node);
		if (!slice) {
			continue;
		}
		const textRange = doc.createRange();
		textRange.setStart(node, slice.start);
		textRange.setEnd(node, slice.end);
		rects.push(
			...Array.from(textRange.getClientRects?.() || []).map((rect) => ({
				left: rect.left,
				top: rect.top,
				width: rect.width,
				height: rect.height,
			}))
		);
	}
	return rects.filter((rect) => rect.width > 0 || rect.height > 0);
}

export function extractRangeClientRects(range: Range): RawViewportRect[] {
	const textRects = extractTextNodeClientRects(range);
	if (textRects.length > 0) {
		return textRects;
	}
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
