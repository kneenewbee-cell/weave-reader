import type { BookNotesExportContext } from "./export-context";

export function buildBookNotesExportPreviewContext(
	overrides: Partial<BookNotesExportContext> = {}
): BookNotesExportContext {
	const base: BookNotesExportContext = {
		book: {
			title: "思考快与慢",
			author: "丹尼尔·卡尼曼",
			publisher: "中信出版社",
			isbn: "978-7-5086-3335-1",
			filePath: "Books/thinking-fast-and-slow.epub",
			sourceId: "preview-book",
			progressPercent: 42,
		},
		export: {
			notesTitle: "阅读笔记",
			exportedAt: "2026-06-11T08:00:00.000Z",
		},
		chapters: [
			{
				index: 0,
				title: "第一章 故事与系统",
				label: "第一章",
				highlights: [
					{
						text: "读书不是为了雄辩和驳斥，也不是为了轻信和盲从，而是为了思考和权衡。",
						commentText: "值得反复体会",
						color: "yellow",
						style: "",
						styleLabel: "高亮",
						createdTime: Date.parse("2026-06-10T21:30:00.000Z"),
						createdTimeFormatted: "2026-06-10 21:30",
						excerptId: "preview-excerpt-1",
						cfiRange: "epubcfi(/6/4!/4/2/1:0)",
						chapterIndex: 0,
						chapterTitle: "第一章 故事与系统",
						chapterLabel: "第一章",
						pageLabel: "P.42",
						pageNumber: 42,
						citationInline: " ——《思考快与慢，第一章，P.42》",
						citationBlock: "——《思考快与慢》· 第一章 · P.42",
						citationAcademic:
							"（丹尼尔·卡尼曼，《思考快与慢》，第一章 故事与系统，P.42，摘录于 2026-06-10 21:30）",
						excerptHeading: "摘录 1",
						blockquote:
							"> 读书不是为了雄辩和驳斥，也不是为了轻信和盲从，而是为了思考和权衡。",
						quoteBlock:
							"> [!quote|yellow]\n> 读书不是为了雄辩和驳斥，也不是为了轻信和盲从，而是为了思考和权衡。",
						epubLink: "[[Books/thinking-fast-and-slow.epub]]",
						blockRef: "^preview-excerpt-1",
						metaLines: ["颜色: yellow", "样式: 高亮", "时间: 2026-06-10 21:30"],
					},
					{
						text: "有些书只需浅尝辄止，有些书则应细品慢读。",
						commentText: "",
						color: "blue",
						style: "underline",
						styleLabel: "下划线",
						createdTime: Date.parse("2026-06-10T22:05:00.000Z"),
						createdTimeFormatted: "2026-06-10 22:05",
						excerptId: "preview-excerpt-2",
						cfiRange: "epubcfi(/6/4!/4/2/2:0)",
						chapterIndex: 0,
						chapterTitle: "第一章 故事与系统",
						chapterLabel: "第一章",
						pageLabel: "P.45",
						pageNumber: 45,
						citationInline: " ——《思考快与慢，第一章，P.45》",
						citationBlock: "——《思考快与慢》· 第一章 · P.45",
						citationAcademic:
							"（丹尼尔·卡尼曼，《思考快与慢》，第一章 故事与系统，P.45，摘录于 2026-06-10 22:05）",
						excerptHeading: "摘录 2",
						blockquote: "> 有些书只需浅尝辄止，有些书则应细品慢读。",
						quoteBlock: "> [!quote|blue]\n> 有些书只需浅尝辄止，有些书则应细品慢读。",
						epubLink: "[[Books/thinking-fast-and-slow.epub]]",
						blockRef: "^preview-excerpt-2",
						metaLines: ["颜色: blue", "样式: 下划线"],
					},
				],
			},
			{
				index: 1,
				title: "第二章 注意力与努力",
				label: "第二章",
				highlights: [
					{
						text: "我们对自己认为了解的事物确信无疑，实际上这种确信往往是错的。",
						commentText: "",
						color: "green",
						style: "wavy",
						styleLabel: "波浪线",
						createdTime: Date.parse("2026-06-11T07:15:00.000Z"),
						createdTimeFormatted: "2026-06-11 07:15",
						excerptId: "preview-excerpt-3",
						cfiRange: "epubcfi(/6/6!/4/2/1:0)",
						chapterIndex: 1,
						chapterTitle: "第二章 注意力与努力",
						chapterLabel: "第二章",
						pageLabel: "P.68",
						pageNumber: 68,
						citationInline: " ——《思考快与慢，第二章，P.68》",
						citationBlock: "——《思考快与慢》· 第二章 · P.68",
						citationAcademic:
							"（丹尼尔·卡尼曼，《思考快与慢》，第二章 注意力与努力，P.68，摘录于 2026-06-11 07:15）",
						excerptHeading: "摘录 1",
						blockquote: "> 我们对自己认为了解的事物确信无疑，实际上这种确信往往是错的。",
						quoteBlock:
							"> [!quote|green]\n> 我们对自己认为了解的事物确信无疑，实际上这种确信往往是错的。",
						epubLink: "[[Books/thinking-fast-and-slow.epub]]",
						blockRef: "^preview-excerpt-3",
						metaLines: ["颜色: green", "样式: 波浪线"],
					},
				],
			},
		],
		highlights: [],
	};

	base.highlights = base.chapters.flatMap((chapter) => chapter.highlights);

	return {
		...base,
		...overrides,
		book: { ...base.book, ...overrides.book },
		export: { ...base.export, ...overrides.export },
		chapters: overrides.chapters ?? base.chapters,
		highlights: overrides.highlights ?? base.highlights,
	};
}
