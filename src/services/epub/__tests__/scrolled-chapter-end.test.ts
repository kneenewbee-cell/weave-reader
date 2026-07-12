import { describe, expect, it } from "vitest";
import {
	isAtChapterEndByPositionMetrics,
	isScrolledRendererAtSectionBottom,
	resolveScrolledChapterEndState,
} from "../scrolled-chapter-end";

describe("scrolled chapter end detection", () => {
	it("detects when the scrolled renderer has reached the section bottom", () => {
		expect(isScrolledRendererAtSectionBottom(1200, 1180)).toBe(true);
		expect(isScrolledRendererAtSectionBottom(1200, 1170)).toBe(false);
		expect(isScrolledRendererAtSectionBottom(0, 0)).toBe(false);
	});

	it("detects chapter end from the final position bucket", () => {
		expect(
			isAtChapterEndByPositionMetrics({
				currentPage: 15,
				positionStart: 5,
				positionCount: 10,
				sectionProgression: 0.2,
			})
		).toBe(true);
	});

	it("detects chapter end from late progression on the last bucket", () => {
		expect(
			isAtChapterEndByPositionMetrics({
				currentPage: 14,
				positionStart: 5,
				positionCount: 10,
				sectionProgression: 0.95,
			})
		).toBe(true);

		expect(
			isAtChapterEndByPositionMetrics({
				currentPage: 14,
				positionStart: 5,
				positionCount: 10,
				sectionProgression: 0.5,
			})
		).toBe(false);
	});

	it("prefers renderer bottom geometry over stale position metrics", () => {
		expect(
			resolveScrolledChapterEndState({
				atSectionBottom: true,
				atChapterEndByMetrics: false,
			})
		).toBe(true);
	});
});
