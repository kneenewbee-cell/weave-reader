import type { HighlightClickInfo, ReaderHighlight } from "./reader-engine-types";
import {
	orderVisibleHighlightFrames,
	type HighlightSectionResolverPort,
	type VisibleHighlightFrame,
} from "./reader-highlight-section-resolver";

export type ViewportRectFromRangeMapper = (
	frame: VisibleHighlightFrame & { frameElement?: HTMLElement | null },
	range: Range
) => HighlightClickInfo["rect"] | null;

export type ViewportRectListFromRangeMapper = (
	frame: VisibleHighlightFrame & { frameElement?: HTMLElement | null },
	range: Range
) => HighlightClickInfo["rect"][] | null;

export interface ResolveHighlightViewportGeometryOptions {
	highlight?: Pick<ReaderHighlight, "text" | "chapterIndex"> | null;
	textHint?: string;
	frames: Array<VisibleHighlightFrame & { frameElement?: HTMLElement | null }>;
	port: HighlightSectionResolverPort;
	createViewportRect: ViewportRectFromRangeMapper;
	createViewportRectList: ViewportRectListFromRangeMapper;
}

export function resolveHighlightViewportGeometry(
	cfiRange: string,
	options: ResolveHighlightViewportGeometryOptions
): { rect: HighlightClickInfo["rect"]; rects?: HighlightClickInfo["rect"][] } | null {
	const { highlight, textHint, frames, port, createViewportRect, createViewportRectList } = options;
	const resolvedTextHint = String(textHint || highlight?.text || "").trim();
	const preferredChapter =
		typeof highlight?.chapterIndex === "number" && Number.isFinite(highlight.chapterIndex)
			? highlight.chapterIndex
			: port.getSectionIndexForCfi(cfiRange);

	for (const frame of orderVisibleHighlightFrames(frames, preferredChapter)) {
		const range = port.resolveRangeInLoadedSection(
			cfiRange,
			frame.frameDocument,
			frame.index,
			resolvedTextHint || undefined
		);
		if (!range) {
			continue;
		}
		const rect = createViewportRect(frame, range);
		if (rect) {
			const rects = createViewportRectList(frame, range);
			return {
				rect,
				rects: rects?.length ? rects : undefined,
			};
		}
	}
	return null;
}
