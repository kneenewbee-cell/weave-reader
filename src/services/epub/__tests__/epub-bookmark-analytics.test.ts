import { describe, expect, it } from "vitest";
import { buildEpubBookmarkAnalytics, parseEpubBookmarkAnalytics, readEpubBookmarkAnalyticsFromFrontmatter } from "../epub-bookmark-analytics";

describe("buildEpubBookmarkAnalytics", () => {
	it("aggregates highlight colors, notes, and recent excerpts", () => {
		const analytics = buildEpubBookmarkAnalytics(
			[
				{
					cfiRange: "epubcfi(/6/2)",
					color: "yellow",
					text: "间隔练习比集中练习更有效",
					chapterTitle: "间隔重复",
					sourceFile: "Notes/a.md",
					createdTime: 20,
					referenceHeat: 3,
				},
				{
					cfiRange: "epubcfi(/6/4)",
					color: "green",
					text: "睡眠巩固记忆",
					chapterTitle: "睡眠与记忆",
					sourceFile: "Notes/b.md",
					commentText: "重点",
					createdTime: 30,
				},
				{
					cfiRange: "epubcfi(/6/6)",
					color: "mask",
					text: "隐藏片段",
					presentation: "conceal",
					createdTime: 10,
				},
			],
			1000
		);

		expect(analytics.highlightCount).toBe(2);
		expect(analytics.highlightsByColor).toEqual({ yellow: 1, green: 1 });
		expect(analytics.excerptNoteCount).toBe(2);
		expect(analytics.commentCount).toBe(1);
		expect(analytics.concealedCount).toBe(1);
		expect(analytics.referenceHeatMax).toBe(3);
		expect(analytics.topChaptersByHighlights).toHaveLength(2);
		expect(analytics.recentExcerpts?.[0]?.preview).toContain("睡眠巩固记忆");
	});

	it("treats strikethrough-in-conceal-mode like concealed highlights", () => {
		const analytics = buildEpubBookmarkAnalytics(
			[
				{
					cfiRange: "epubcfi(/6/2)",
					color: "yellow",
					style: "strikethrough",
					text: "应计入 concealed",
				},
				{
					cfiRange: "epubcfi(/6/4)",
					color: "green",
					text: "正常高亮",
				},
			],
			1000,
			{ strikethroughDisplayMode: "conceal", showStrikethroughInSidebar: false }
		);

		expect(analytics.highlightCount).toBe(1);
		expect(analytics.concealedCount).toBe(1);
		expect(analytics.highlightsByColor).toEqual({ green: 1 });
	});
});

describe("parseEpubBookmarkAnalytics", () => {
	it("merges flat highlight counts with nested analytics payload", () => {
		const parsed = parseEpubBookmarkAnalytics(
			{
				highlightCount: 1,
				highlightsByColor: { yellow: 1 },
				excerptNoteCount: 0,
				commentCount: 0,
				concealedCount: 0,
				topChaptersByHighlights: [],
				linkedNotePaths: [],
			},
			{
				highlightCount: 3,
				excerptNoteCount: 2,
			}
		);

		expect(parsed?.highlightCount).toBe(3);
		expect(parsed?.excerptNoteCount).toBe(2);
		expect(parsed?.highlightsByColor).toEqual({ yellow: 1 });
	});

	it("builds analytics from flat counts when nested block is missing", () => {
		const parsed = parseEpubBookmarkAnalytics(null, {
			highlightCount: 4,
			excerptNoteCount: 1,
		});

		expect(parsed).toEqual({
			updatedAt: expect.any(Number),
			highlightCount: 4,
			highlightsByColor: {},
			excerptNoteCount: 1,
			commentCount: 0,
			concealedCount: 0,
			topChaptersByHighlights: [],
			linkedNotePaths: [],
			recentExcerpts: undefined,
		});
	});
});

describe("readEpubBookmarkAnalyticsFromFrontmatter", () => {
	it("prefers flat highlight counts over nested analytics block", () => {
		const analytics = readEpubBookmarkAnalyticsFromFrontmatter({
			"highlight-count": 5,
			"excerpt-note-count": 2,
			updatedAt: 123,
			analytics: {
				highlightCount: 1,
				highlightsByColor: { yellow: 1 },
				excerptNoteCount: 0,
				commentCount: 0,
				concealedCount: 0,
				topChaptersByHighlights: [],
				linkedNotePaths: [],
			},
		});

		expect(analytics?.highlightCount).toBe(5);
		expect(analytics?.excerptNoteCount).toBe(2);
		expect(analytics?.updatedAt).toBe(123);
		expect(analytics?.highlightsByColor).toEqual({ yellow: 1 });
	});
});
