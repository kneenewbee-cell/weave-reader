import { describe, expect, it } from "vitest";
import { EpubLinkService } from "../EpubLinkService";
import {
	EPUB_BOOKMARK_PAGE_MAINTENANCE_NOTE,
	renderEpubBookmarkFileContent,
	resolveEpubBookmarkReadingStatus,
} from "../epub-bookmark-page-render";
import { EPUB_BOOKMARK_FILE_FORMAT_V3 } from "../epub-bookmark-page-types";
import { deriveEpubBookmarkDisplayTitle } from "../epub-bookmark-display-title";

describe("epub-bookmark-page-render", () => {
	const linkService = new EpubLinkService({} as any);

	it("renders v3 frontmatter, flat properties, and sectioned body", () => {
		const content = renderEpubBookmarkFileContent(
			{
				stableKey: "epubsrc-demo",
				bookId: "book-1",
				bookPath: "Books/demo.epub",
				displayTitle: "示例书籍",
				bookTitle: "示例书籍(Z-Library) 1",
				bookAuthor: "作者甲",
				publisher: "测试出版社",
				description: "这是一本用于测试的书籍简介。",
				coverPath: "weave/epub-bookmarks/covers/epubsrc-demo.jpg",
				updatedAt: 1_700_000_000_000,
				bookmarks: [],
				readingState: {
					currentPosition: { chapterIndex: 1, cfi: "epubcfi(/6/2)", percent: 24 },
					readingStats: {
						totalReadTime: 180_000,
						lastReadTime: 1_700_000_000_000,
						createdTime: 1_699_000_000_000,
						bookWpm: 280,
					},
				},
				analytics: {
					updatedAt: 1_700_000_000_000,
					highlightCount: 2,
					highlightsByColor: { yellow: 2 },
					excerptNoteCount: 1,
					commentCount: 0,
					concealedCount: 0,
					topChaptersByHighlights: [{ title: "第一章", count: 2 }],
					linkedNotePaths: ["Notes/demo.md"],
					recentExcerpts: [
						{
							chapterTitle: "第一章",
							preview: "摘录预览",
							notePath: "Notes/demo.md",
							createdTime: 1,
						},
					],
				},
				user: {
					tags: ["测试"],
					notes: "用户备注",
				},
			},
			linkService
		);

		expect(content).toContain(EPUB_BOOKMARK_FILE_FORMAT_V3);
		expect(content).toContain("reading-progress: 24");
		expect(content).toContain('reading-status: "reading"');
		expect(content).toContain("highlight-count: 2");
		expect(content).toContain("bookmark-count: 0");
		expect(content).toContain(EPUB_BOOKMARK_PAGE_MAINTENANCE_NOTE);
		expect(content).toContain("## 📖 书籍信息");
		expect(content).toContain("## 📊 阅读进度");
		expect(content).toContain("## ✨ 标注统计");
		expect(content).toContain("## 💡 最近摘录");
		expect(content).toContain("## ✏️ 我的标注");
		expect(content).not.toContain("linkedNotePaths");
		expect(content).not.toContain("recentExcerpts:");
		expect(content).not.toContain("recentIntervalWpms");
	});

	it("resolves finished status when completedTime is set", () => {
		expect(
			resolveEpubBookmarkReadingStatus({
				currentPosition: { chapterIndex: 0, cfi: "", percent: 50 },
				readingStats: {
					totalReadTime: 0,
					lastReadTime: 1,
					createdTime: 1,
					completedTime: 99,
				},
			})
		).toBe("finished");
	});
});

describe("deriveEpubBookmarkDisplayTitle", () => {
	it("strips source suffixes and author suffix from long titles", () => {
		expect(
			deriveEpubBookmarkDisplayTitle({
				bookTitle:
					"蒙田随笔全集(许渊冲推荐译本,季羡林,周国平导读,穿越四百多年的人生智慧与生活哲学,开随笔式写作之先河) (米歇尔·德·蒙田) (Z-Library) 1",
				bookAuthor: "米歇尔·德·蒙田",
			})
		).toBe("蒙田随笔全集");
	});
});
