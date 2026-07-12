import type { RawViewportRect } from "./reader-highlight-geometry";
import { extractRangeClientRects } from "./reader-highlight-geometry";
import {
	type HighlightSectionResolverPort,
	orderVisibleHighlightFrames,
	type VisibleHighlightFrame,
} from "./reader-highlight-section-resolver";

export function resolveHighlightOverlayRects(
	highlight: {
		cfiRange: string;
		text?: string;
		chapterIndex?: number;
	},
	visibleFrames: VisibleHighlightFrame[],
	port: HighlightSectionResolverPort
): RawViewportRect[] {
	const textHint = String(highlight.text || "").trim();
	if (!textHint) {
		return [];
	}

	const preferredChapter =
		typeof highlight.chapterIndex === "number" && Number.isFinite(highlight.chapterIndex)
			? highlight.chapterIndex
			: port.getSectionIndexForCfi(highlight.cfiRange);

	for (const frame of orderVisibleHighlightFrames(visibleFrames, preferredChapter)) {
		const range = port.resolveRangeInLoadedSection(
			highlight.cfiRange,
			frame.frameDocument,
			frame.index,
			textHint
		);
		if (!range) {
			continue;
		}
		const rects = extractRangeClientRects(range);
		if (rects.length > 0) {
			return rects;
		}
	}

	return [];
}
