import type { ReaderHighlight } from "./reader-engine-types";

export interface HighlightSectionResolverPort {
	getSectionIndexForCfi(cfiRange: string): number | null;
	resolveRangeInLoadedSection(
		cfiRange: string,
		frameDocument: Document,
		sectionIndex: number,
		textHint?: string
	): Range | null;
}

export interface VisibleHighlightFrame {
	index: number;
	frameDocument: Document;
}

export function orderVisibleHighlightFrames<T extends VisibleHighlightFrame>(
	frames: T[],
	preferredChapter: number | null | undefined
): T[] {
	if (typeof preferredChapter !== "number") {
		return frames;
	}
	return [
		...frames.filter((frame) => frame.index === preferredChapter),
		...frames.filter((frame) => frame.index !== preferredChapter),
	];
}

export function resolveHighlightSectionIndexForView(
	highlight: ReaderHighlight,
	visibleFrames: VisibleHighlightFrame[],
	port: HighlightSectionResolverPort
): number | null {
	const textHint = String(highlight.text || "").trim();
	const visibleIndexes = new Set(visibleFrames.map((frame) => frame.index));

	const direct = port.getSectionIndexForCfi(highlight.cfiRange);
	if (direct !== null && visibleIndexes.has(direct)) {
		return direct;
	}

	if (!textHint) {
		return direct !== null && visibleIndexes.has(direct) ? direct : null;
	}

	const preferredChapter =
		typeof highlight.chapterIndex === "number" && Number.isFinite(highlight.chapterIndex)
			? highlight.chapterIndex
			: direct;

	for (const frame of orderVisibleHighlightFrames(visibleFrames, preferredChapter)) {
		const range = port.resolveRangeInLoadedSection(
			highlight.cfiRange,
			frame.frameDocument,
			frame.index,
			textHint
		);
		if (range) {
			return frame.index;
		}
	}

	return direct !== null && visibleIndexes.has(direct) ? direct : null;
}
