export const SCROLLED_SECTION_BOTTOM_TOLERANCE_PX = 24;
export const CHAPTER_END_PROGRESSION_THRESHOLD = 0.92;

export function isScrolledRendererAtSectionBottom(
	viewSize: number,
	scrollEnd: number,
	tolerancePx = SCROLLED_SECTION_BOTTOM_TOLERANCE_PX
): boolean {
	if (!Number.isFinite(viewSize) || viewSize <= 0) {
		return false;
	}
	if (!Number.isFinite(scrollEnd)) {
		return false;
	}
	return viewSize - scrollEnd <= tolerancePx;
}

export function isAtChapterEndByPositionMetrics(input: {
	currentPage: number;
	positionStart: number;
	positionCount: number;
	sectionProgression: number;
	progressionThreshold?: number;
}): boolean {
	const chapterEndPage = input.positionStart + Math.max(input.positionCount, 1);
	if (input.currentPage >= chapterEndPage) {
		return true;
	}

	const chapterLastPage = Math.max(input.positionStart + 1, chapterEndPage - 1);
	const threshold = input.progressionThreshold ?? CHAPTER_END_PROGRESSION_THRESHOLD;
	return input.currentPage >= chapterLastPage && input.sectionProgression >= threshold;
}

export function resolveScrolledChapterEndState(input: {
	atSectionBottom: boolean;
	atChapterEndByMetrics: boolean;
}): boolean {
	return input.atSectionBottom || input.atChapterEndByMetrics;
}
