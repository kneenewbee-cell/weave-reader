import { describe, expect, it } from "vitest";
import { areEpubBookmarkAnalyticsEquivalent } from "../epub-bookmark-analytics";

describe("areEpubBookmarkAnalyticsEquivalent", () => {
	it("ignores updatedAt when comparing analytics payloads", () => {
		expect(
			areEpubBookmarkAnalyticsEquivalent(
				{
					updatedAt: 1,
					highlightCount: 2,
					highlightsByColor: { yellow: 2 },
					excerptNoteCount: 1,
					commentCount: 0,
					concealedCount: 0,
					topChaptersByHighlights: [],
					linkedNotePaths: ["Notes/demo.md"],
					recentExcerpts: [],
				},
				{
					updatedAt: 99,
					highlightCount: 2,
					highlightsByColor: { yellow: 2 },
					excerptNoteCount: 1,
					commentCount: 0,
					concealedCount: 0,
					topChaptersByHighlights: [],
					linkedNotePaths: ["Notes/demo.md"],
					recentExcerpts: [],
				}
			)
		).toBe(true);
	});

	it("returns false when highlight counts differ", () => {
		expect(
			areEpubBookmarkAnalyticsEquivalent(
				{
					updatedAt: 1,
					highlightCount: 2,
					highlightsByColor: {},
					excerptNoteCount: 0,
					commentCount: 0,
					concealedCount: 0,
					topChaptersByHighlights: [],
					linkedNotePaths: [],
					recentExcerpts: [],
				},
				{
					updatedAt: 1,
					highlightCount: 3,
					highlightsByColor: {},
					excerptNoteCount: 0,
					commentCount: 0,
					concealedCount: 0,
					topChaptersByHighlights: [],
					linkedNotePaths: [],
					recentExcerpts: [],
				}
			)
		).toBe(false);
	});
});
