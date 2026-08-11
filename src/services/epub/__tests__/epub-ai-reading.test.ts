import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { TocItem } from "../types";
import {
	buildEpubAiReadingMessages,
	buildEpubAiReadingEmptyNoteMarkdown,
	buildEpubAiReadingNoteMarkdown,
	buildEpubAiReadingNoteSection,
	ensureEpubAiReadingNote,
	extractKimiChatCompletionText,
	parseEpubAiReadingEnv,
	requestEpubAiReading,
	resolveEpubAiReadingSelection,
	resolveEpubAiReadingOutputPlan,
	upsertEpubAiReadingNote,
	validateEpubAiReadingUnitBatchContent,
} from "../epub-ai-reading";
import type { EpubAiReadingSourceBlock } from "../epub-ai-reading-source-blocks";

const tocItems: TocItem[] = [
	{
		id: "part-1",
		label: "第一部分 基础",
		href: "text/part1.xhtml",
		level: 1,
		subitems: [
			{
				id: "chapter-1",
				label: "第一章 注意力",
				href: "text/chapter1.xhtml",
				level: 2,
			},
		],
	},
	{
		id: "chapter-2",
		label: "第二章 信息过载",
		href: "text/chapter2.xhtml",
		level: 1,
	},
];

function createMemoryApp(initialFiles: Record<string, string> = {}) {
	const files = new Map(Object.entries(initialFiles));
	const createVaultFile = (path: string) =>
		Object.assign(Object.create(TFile.prototype), {
			path,
			name: path.split("/").pop() || path,
			basename: (path.split("/").pop() || path).replace(/\.md$/i, ""),
			extension: path.split(".").pop() || "",
			stat: { size: files.get(path)?.length || 0 },
		});
	const app = {
		vault: {
			configDir: ".obsidian",
			adapter: {
				mkdir: vi.fn(async () => undefined),
				exists: vi.fn(async (path: string) => {
					if (files.has(path)) {
						return true;
					}
					const prefix = path.replace(/\/+$/, "") + "/";
					return Array.from(files.keys()).some((filePath) =>
						filePath.startsWith(prefix),
					);
				}),
				read: vi.fn(async (path: string) => files.get(path) || ""),
			},
			getAbstractFileByPath: vi.fn((path: string) =>
				files.has(path) ? createVaultFile(path) : null,
			),
			create: vi.fn(async (path: string, content: string) => {
				files.set(path, content);
				return createVaultFile(path);
			}),
			modify: vi.fn(async (file: TFile, content: string) => {
				files.set(file.path, content);
			}),
			read: vi.fn(async (file: TFile) => files.get(file.path) || ""),
		},
		workspace: {
			getLeaf: vi.fn(() => ({
				openFile: vi.fn(async () => undefined),
			})),
		},
		metadataCache: {
			getFirstLinkpathDest: vi.fn(),
		},
	} as unknown as App;

	return { app, files };
}

describe("epub-ai-reading", () => {
	it("builds chapter reading messages with chapter text and the book TOC", () => {
		const messages = buildEpubAiReadingMessages({
			bookTitle: "认知之书",
			author: "作者甲",
			filePath: "Books/demo.epub",
			chapterTitle: "第一章 注意力",
			chapterHref: "text/chapter1.xhtml",
			chapterText: "注意力是一种有限资源。本章讨论注意力如何被信息环境消耗。",
			tocItems,
			sourceLink: "obsidian://weave-reader?book=demo",
		});

		expect(messages.system).toContain("EPUB AI 阅读助手");
		expect(messages.user).toContain("认知之书");
		expect(messages.user).toContain("第一部分 基础 > 第一章 注意力");
		expect(messages.user).toContain("第二章 信息过载");
		expect(messages.user).toContain("注意力是一种有限资源");
		expect(messages.user).toContain("重要原文");
	});

	it("builds paragraph-located AI messages when source blocks are available", () => {
		const sourceBlocks: EpubAiReadingSourceBlock[] = [
			{
				id: "段001",
				chapterHref: "Text/chapter1.xhtml",
				cfi: "epubcfi(/6/2)",
				text: "LaTeX is a document markup language.",
				headingPath: ["Chapter 1", "What is LaTeX?"],
				kind: "paragraph",
				sourceLink: "[[Books/latex.epub#weave-cfi=epubcfi(/6/2)|段001]]",
			},
		];

		const messages = buildEpubAiReadingMessages({
			bookTitle: "LaTeX Guide",
			filePath: "Books/latex.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "Text/chapter1.xhtml",
			chapterText: "Fallback chapter text",
			tocItems,
			sourceBlocks,
		});

		expect(messages.user).toContain(
			"# \u7cbe\u8bfb\u8303\u56f4\u6b63\u6587\u5757",
		);
		expect(messages.user).toContain(
			"[段001] kind=paragraph path=Chapter 1 > What is LaTeX?",
		);
		expect(messages.user).toContain("段001");
		expect(messages.user).not.toContain("[P001]");
		expect(messages.user).not.toContain(
			"# \u5f53\u524d\u7ae0\u8282\u6b63\u6587\nFallback chapter text",
		);
	});

	it("builds scoped close-reading instructions with compact source rules", () => {
		const sourceBlocks: EpubAiReadingSourceBlock[] = [
			{
				id: "段001",
				chapterHref: "Text/ch1.xhtml#install",
				cfi: "epubcfi(/6/2)",
				text: "Install TeX Live before writing the first LaTeX document.",
				headingPath: ["Chapter 1", "Installing and using LaTeX"],
				kind: "paragraph",
				sourceLink: "[[Books/latex.epub#weave-cfi=epubcfi(/6/2)|段001]]",
			},
		];

		const messages = buildEpubAiReadingMessages({
			bookTitle: "LaTeX Guide",
			filePath: "Books/latex.epub",
			chapterTitle: "Installing and using LaTeX",
			chapterHref: "Text/ch1.xhtml#install",
			chapterText: "Install TeX Live before writing the first LaTeX document.",
			tocItems,
			sourceBlocks,
			scope: {
				label: "Installing and using LaTeX",
				pathLabels: ["Chapter 1", "Installing and using LaTeX", "\u5168\u90e8"],
				href: "Text/ch1.xhtml#install",
				includeDescendants: true,
				flatIndex: 1,
				endFlatIndex: 3,
			},
			scopeContext: "Next sibling: Overleaf",
		});

		expect(messages.user).toContain("## \u8303\u56f4\u6458\u8981");
		expect(messages.user).toContain("## \u6838\u5fc3\u7ed3\u8bba");
		expect(messages.user).toContain(
			"## \u91cd\u8981\u539f\u6587\u4e0e\u89e3\u8bfb",
		);
		expect(messages.user).toContain(
			"- \u9605\u8bfb\u8303\u56f4\uff1aChapter 1 > Installing and using LaTeX > \u5168\u90e8",
		);
		expect(messages.user).toContain(
			"\u6458\u8981\u3001\u6838\u5fc3\u7ed3\u8bba\u3001\u77e5\u8bc6\u70b9\u548c\u91cd\u8981\u539f\u6587\u53ea\u80fd\u6765\u81ea\u7cbe\u8bfb\u8303\u56f4\u6b63\u6587",
		);
		expect(messages.user).toContain(
			"\u6bcf\u6761\u6700\u591a 2 \u4e2a\u6765\u6e90\u5360\u4f4d\u7b26",
		);
		expect(messages.user).toContain("{{source:段001}}");
		expect(messages.user).toContain("\u8bf7\u53ea\u4f7f\u7528\u6765\u6e90\u5360\u4f4d\u7b26");
		expect(messages.user).not.toContain(
			"\u6bcf\u6761\u6700\u591a 2 \u4e2a\u6bb5\u843d\u7f16\u53f7",
		);
		expect(messages.user).toContain("[段001] kind=paragraph");
		expect(messages.user).not.toContain("[P001]");
		expect(messages.user).toContain("\u4e0d\u8981\u8f93\u51fa H1");
		expect(messages.user).not.toContain("## \u672c\u7ae0\u6458\u8981");
	});

	it("requires AI to close-read every closeReadingUnit without merging units", () => {
		const messages = buildEpubAiReadingMessages({
			bookTitle: "LaTeX Cookbook",
			filePath: "Books/latex-cookbook.epub",
			chapterTitle: "第五章：图像处理",
			chapterHref: "OEBPS/B21326_05.xhtml",
			chapterText: "操作指南正文。\n\n运行原理正文。",
			tocItems,
			scope: {
				label: "第五章：图像处理 > 全部",
				pathLabels: ["第五章：图像处理", "全部"],
				includeDescendants: true,
				flatIndex: 0,
				endFlatIndex: 2,
			},
			closeReadingUnits: [
				{
					id: "U016",
					label: "操作指南",
					href: "OEBPS/B21326_05.xhtml#how",
					pathLabels: ["第五章：图像处理", "图像对齐", "操作指南"],
					flatIndex: 16,
					depth: 2,
					sourceBlockIds: ["U016.P001", "U016.P002"],
				},
				{
					id: "U017",
					label: "运行原理",
					href: "OEBPS/B21326_05.xhtml#why",
					pathLabels: ["第五章：图像处理", "图像对齐", "运行原理"],
					flatIndex: 17,
					depth: 2,
					sourceBlockIds: ["U017.P001"],
				},
			],
			sourceBlocks: [
				{
					id: "U016.P001",
					chapterHref: "OEBPS/B21326_05.xhtml",
					headingPath: ["第五章：图像处理", "图像对齐", "操作指南"],
					text: "操作指南正文。",
					kind: "paragraph",
				},
			],
		});

		expect(messages.user).toContain("# 必须精析单元");
		expect(messages.user).toContain("U016 第五章：图像处理 > 图像对齐 > 操作指南");
		expect(messages.user).toContain("U017 第五章：图像处理 > 图像对齐 > 运行原理");
		expect(messages.user).toContain("不得合并 U 单元");
		expect(messages.user).toContain("不得跳过 U 单元");
		expect(messages.user).toContain("单个 U 单元标准精析模板");
		expect(messages.user).toContain(
			"无论用户选择最低级小节、二级范围、一级章节还是更大范围",
		);
		expect(messages.user).toContain(
			"必须执行与单独选择该 U 单元时相同的标准精析模板",
		);
		expect(messages.user).toContain("大范围不是压缩摘要版");
		expect(messages.user).toContain("小节摘要：2-4 句");
		expect(messages.user).toContain("核心结论：3-6 条");
		expect(messages.user).toContain("关键知识点：4-8 条");
		expect(messages.user).toContain("重要原文与解读：3-6 处");
		expect(messages.user).toContain("选择性内容");
		expect(messages.user).toContain("容易误解的点");
		expect(messages.user).toContain("至少满足下面任一条件");
		expect(messages.user).toContain("原文中存在两个容易混淆的概念、参数、命令、步骤或条件");
		expect(messages.user).toContain("普通说明、顺序步骤、简单定义、重复标题、背景介绍");
		expect(messages.user).toContain("每个 U 单元最多输出 1-3 条容易误解的点");
		expect(messages.user).not.toContain("与上下文关系");
		expect(messages.user).not.toContain("章节关系");
		expect(messages.user).toContain("{{source:U016.P001}}");
		expect(messages.user).toContain("{{source-range:U016.P001-U016.P001}}");
		expect(messages.user).toContain("不要生成 Obsidian wikilink");
		expect(messages.user).toContain("不要把 Uxxx.Pyyy 显示给读者");
		expect(messages.user).toContain("[U016.P001]");
		expect(messages.user).toContain(
			"Do not write Obsidian wikilinks, EPUB URLs, or bare source ids",
		);
		expect(messages.user).not.toContain("always wrap individual source ids as [U001.P001]");
	});

	it("does not request a duplicate global important-source section when close-reading units are required", () => {
		const messages = buildEpubAiReadingMessages({
			bookTitle: "LaTeX Cookbook",
			filePath: "Books/latex-cookbook.epub",
			chapterTitle: "第五章：图像处理",
			chapterHref: "OEBPS/B21326_05.xhtml",
			chapterText: "操作指南正文。\n\n运行原理正文。",
			tocItems,
			scope: {
				label: "第五章：图像处理 > 全部",
				pathLabels: ["第五章：图像处理", "全部"],
				includeDescendants: true,
				flatIndex: 0,
				endFlatIndex: 2,
			},
			closeReadingUnits: [
				{
					id: "U016",
					label: "操作指南",
					href: "OEBPS/B21326_05.xhtml#how",
					pathLabels: ["第五章：图像处理", "图像对齐", "操作指南"],
					flatIndex: 16,
					depth: 2,
					sourceBlockIds: ["U016.P001", "U016.P002"],
				},
			],
			sourceBlocks: [
				{
					id: "U016.P001",
					chapterHref: "OEBPS/B21326_05.xhtml",
					headingPath: ["第五章：图像处理", "图像对齐", "操作指南"],
					text: "操作指南正文。",
					kind: "paragraph",
				},
			],
		});

		expect(messages.user).toContain("重要原文与解读：3-6 处");
		expect(messages.user).not.toContain("\n## 重要原文与解读\n");
		expect(messages.user).toContain("U 单元内已经输出重要原文与解读");
	});

	it("uses source placeholders in unit-detail batch prompts", () => {
		const messages = buildEpubAiReadingMessages({
			bookTitle: "LaTeX Cookbook",
			filePath: "Books/latex-cookbook.epub",
			chapterTitle: "第五章：图像处理",
			chapterHref: "OEBPS/B21326_05.xhtml",
			chapterText: "操作指南正文。",
			tocItems,
			requestPurpose: "unit-detail",
			closeReadingUnits: [
				{
					id: "U016",
					label: "操作指南",
					href: "OEBPS/B21326_05.xhtml#how",
					pathLabels: ["第五章：图像处理", "图像对齐", "操作指南"],
					flatIndex: 16,
					depth: 2,
					sourceBlockIds: ["U016.P001", "U016.P002"],
				},
				{
					id: "U017",
					label: "运行原理",
					href: "OEBPS/B21326_05.xhtml#why",
					pathLabels: ["第五章：图像处理", "图像对齐", "运行原理"],
					flatIndex: 17,
					depth: 2,
					sourceBlockIds: ["U017.P001"],
				},
			],
			sourceBlocks: [
				{
					id: "U016.P001",
					chapterHref: "OEBPS/B21326_05.xhtml",
					headingPath: ["第五章：图像处理", "图像对齐", "操作指南"],
					text: "操作指南正文。",
					kind: "paragraph",
				},
				{
					id: "U017.P001",
					chapterHref: "OEBPS/B21326_05.xhtml",
					headingPath: ["第五章：图像处理", "图像对齐", "运行原理"],
					text: "运行原理正文。",
					kind: "paragraph",
				},
			],
		});

		expect(messages.system).toContain("原文引用只能写来源占位符");
		expect(messages.user).toContain("U016 第五章：图像处理 > 图像对齐 > 操作指南");
		expect(messages.user).toContain("U017 第五章：图像处理 > 图像对齐 > 运行原理");
		expect(messages.user).toContain("sourceBlocks=U016.P001-U016.P002");
		expect(messages.user).toContain("sourceBlocks=U017.P001");
		expect(messages.user).toContain("选择性内容判定规则");
		expect(messages.user).toContain("至少满足下面任一条件");
		expect(messages.user).toContain("不要为了格式完整而补写");
		expect(messages.user).toContain("每个 U 单元最多输出 1-3 条容易误解的点");
		expect(messages.user).not.toContain("与上下文关系");
		expect(messages.user).not.toContain("章节关系");
		expect(messages.user).toContain("{{source:U016.P001}}");
		expect(messages.user).toContain("{{source-range:U016.P001-U016.P001}}");
		expect(messages.user).toContain("不要生成 Obsidian wikilink");
		expect(messages.user).toContain("裸露 Uxxx.Pyyy");
		expect(messages.user).not.toContain("严格保留 Uxxx.Pyyy 来源编号");
		expect(messages.user).toContain("原文/位置：短摘录或位置说明");
		expect(messages.user).toContain("不要用反引号包住原文/位置整行或原文按钮");
		expect(messages.user).not.toContain("`原文/位置：");
	});

	it("plans chapter-scale AI reading output without the legacy 4096 cap", () => {
		const sourceBlocks: EpubAiReadingSourceBlock[] = Array.from(
			{ length: 80 },
			(_, index) => ({
				id: `段${String(index + 1).padStart(3, "0")}`,
				chapterHref: "Text/ch1.xhtml",
				text: `paragraph ${index + 1}`,
				headingPath: ["Chapter 1", `Section ${index + 1}`],
				kind: "paragraph" as const,
			}),
		);

		const plan = resolveEpubAiReadingOutputPlan({
			scope: {
				label: "Chapter 1",
				pathLabels: ["Chapter 1", "全部"],
				href: "Text/ch1.xhtml",
				includeDescendants: true,
				flatIndex: 0,
				endFlatIndex: 80,
			},
			sourceBlocks,
		});

		expect(plan.level).toBe("chapter");
		expect(plan.maxCompletionTokens).toBe(131072);
		expect(plan.promptLines.join("\n")).toContain("按最低级标题逐项精读");
		expect(plan.promptLines.join("\n")).toContain(
			"高级层数量不包含下级小节数据",
		);
	});

	it("adds range-scale output rules to higher-level prompts", () => {
		const messages = buildEpubAiReadingMessages({
			bookTitle: "LaTeX Guide",
			filePath: "Books/latex.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "Text/ch1.xhtml",
			chapterText: "Chapter body",
			tocItems,
			scope: {
				label: "Chapter 1",
				pathLabels: ["Chapter 1", "全部"],
				href: "Text/ch1.xhtml",
				includeDescendants: true,
				flatIndex: 0,
				endFlatIndex: 8,
			},
		});

		expect(messages.user).toContain("## 按小节精读");
		expect(messages.user).toContain("一级章节");
		expect(messages.user).toContain("高级层数量不包含下级小节数据");
		expect(messages.user).toContain("不需要填满输出上限");
	});

	it("requires chapter ranges to preserve leaf-level detail for every lowest-level section", () => {
		const messages = buildEpubAiReadingMessages({
			bookTitle: "LaTeX Cookbook",
			filePath: "Books/latex-cookbook.epub",
			chapterTitle: "第五章：图像处理",
			chapterHref: "chapter5.xhtml",
			tocMarkdown:
				"- 第五章：图像处理\n  - 图像对齐\n    - 操作指南\n    - 运行原理",
			chapterText: "操作指南正文。\n\n运行原理正文。",
			scope: {
				label: "第五章：图像处理 > 全部",
				pathLabels: ["第五章：图像处理", "全部"],
				includeDescendants: true,
			},
			sourceBlocks: [
				{
					id: "段001",
					readerParagraphId: "p1",
					chapterIndex: 4,
					chapterTitle: "第五章：图像处理",
					chapterHref: "chapter5.xhtml",
					kind: "paragraph",
					text: "操作指南正文。",
					headingPath: [
						"第五章：图像处理",
						"图像对齐",
						"操作指南",
					],
				},
			],
		});

		const prompt = messages.user;
		expect(prompt).toContain("基础精析层");
		expect(prompt).toContain(
			"每个最低级小节都必须按最低级小节/精读范围的同一标准输出",
		);
		expect(prompt).toContain(
			"高级范围只能额外增加总览、摘要、主线和全局观",
		);
		expect(prompt).not.toContain(
			"每个最低级小节可写摘要 1-3 句、重点 2-4 条、重要原文 1-3 处",
		);
	});

	it("requires mid-level ranges to use the same base close-reading template as leaf ranges", () => {
		const messages = buildEpubAiReadingMessages({
			bookTitle: "LaTeX Cookbook",
			filePath: "Books/latex-cookbook.epub",
			chapterTitle: "图像对齐",
			chapterHref: "chapter5.xhtml#image-align",
			tocMarkdown: "- 图像对齐\n  - 操作指南\n  - 运行原理",
			chapterText: "操作指南正文。\n\n运行原理正文。",
			scope: {
				label: "第五章：图像处理 > 图像对齐 > 全部",
				pathLabels: [
					"第五章：图像处理",
					"图像对齐",
					"全部",
				],
				includeDescendants: true,
			},
			sourceBlocks: [
				{
					id: "段001",
					readerParagraphId: "p1",
					chapterIndex: 4,
					chapterTitle: "图像对齐",
					chapterHref: "chapter5.xhtml#image-align",
					kind: "paragraph",
					text: "操作指南正文。",
					headingPath: [
						"第五章：图像处理",
						"图像对齐",
						"操作指南",
					],
				},
			],
		});

		const prompt = messages.user;
		expect(prompt).toContain("基础精析层");
		expect(prompt).toContain("必有内容");
		expect(prompt).toContain("选择性内容");
		expect(prompt).toContain("小节摘要、核心结论、关键知识点、重要原文与解读");
		expect(prompt).not.toContain("与上下文关系");
		expect(prompt).not.toContain("章节关系");
		expect(prompt).not.toContain(
			"每个下级小节可写摘要 1-3 句、重点 2-4 条、重要原文 1-3 处",
		);
	});

	it("formats higher-level results with detailed per-section close reading plus separate global layers", () => {
		const messages = buildEpubAiReadingMessages({
			bookTitle: "LaTeX Cookbook",
			filePath: "Books/latex-cookbook.epub",
			chapterTitle: "第五章：图像处理",
			chapterHref: "chapter5.xhtml",
			tocMarkdown: "- 第五章：图像处理\n  - 图像对齐\n    - 操作指南",
			chapterText: "操作指南正文。",
			scope: {
				label: "第五章：图像处理 > 全部",
				pathLabels: ["第五章：图像处理", "全部"],
				includeDescendants: true,
			},
		});

		expect(messages.user).toContain("## 按小节精读");
		expect(messages.user).toContain(
			"每个小节必须包含：小节摘要、核心结论、关键知识点、重要原文与解读",
		);
		expect(messages.user).toContain("容易误解的点");
		expect(messages.user).toContain("有实质价值时才输出");
		expect(messages.user).not.toContain("与上下文关系");
		expect(messages.user).not.toContain("章节关系");
	});

	it("includes scope context as structure guidance without requesting relationship sections", () => {
		const messages = buildEpubAiReadingMessages({
			bookTitle: "Scoped Book",
			filePath: "Books/scoped.epub",
			chapterTitle: "Selected section",
			chapterHref: "Text/chapter.xhtml#selected",
			chapterText:
				"Only this selected section body should be treated as the close reading source.",
			tocItems,
			scopeContext: [
				"Selected path: Chapter 1 > Selected section",
				"Previous sibling: Before section",
				"Next sibling: After section",
			].join("\n"),
		});

		expect(messages.user).toContain(
			"# \u9605\u8bfb\u8303\u56f4\u4e0e\u5916\u90e8\u7ed3\u6784\u7ebf\u7d22",
		);
		expect(messages.user).toContain(
			"Selected path: Chapter 1 > Selected section",
		);
		expect(messages.user).toContain(
			"\u5916\u90e8\u7ebf\u7d22\u53ea\u7528\u4e8e\u7406\u89e3\u8303\u56f4\u4f4d\u7f6e",
		);
		expect(messages.user).not.toContain("章节关系");
		expect(messages.user).not.toContain("与上下文关系");
		expect(messages.user).toContain(
			"Only this selected section body should be treated as the close reading source.",
		);
	});

	it("does not require optional misunderstanding or context fields in unit validation", () => {
		const issues = validateEpubAiReadingUnitBatchContent(
			[
				"## U001 Chapter > Unit",
				"### 小节摘要",
				"summary",
				"### 核心结论",
				"conclusion",
				"### 关键知识点",
				"points",
				"### 重要原文与解读",
				"{{source:U001.P001}}",
			].join("\n"),
			[
				{
					id: "U001",
					label: "Unit",
					href: "text/ch.xhtml#unit",
					pathLabels: ["Chapter", "Unit"],
					flatIndex: 0,
					depth: 1,
					sourceBlockIds: ["U001.P001"],
				},
			],
		);

		expect(issues).toEqual([]);
	});

	it("extracts assistant content from a Kimi chat completion response", () => {
		const text = extractKimiChatCompletionText({
			choices: [
				{
					message: {
						content: "这是 AI 阅读结果",
					},
				},
			],
		});

		expect(text).toBe("这是 AI 阅读结果");
	});

	it("parses local env configuration without requiring build-time injection", () => {
		const env = parseEpubAiReadingEnv(`
			# local only
			KIMI_API_KEY="runtime-key"
			KIMI_MODEL=kimi-k3
			export KIMI_API_BASE_URL=https://api.moonshot.ai/v1
		`);

		expect(env.KIMI_API_KEY).toBe("runtime-key");
		expect(env.KIMI_MODEL).toBe("kimi-k3");
		expect(env.KIMI_API_BASE_URL).toBe("https://api.moonshot.ai/v1");
	});

	it("requests a Kimi reading result with the configured chat completions endpoint", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content: "# 本章摘要\n内容总结",
						},
					},
				],
			},
		}));

		const result = await requestEpubAiReading(
			{
				bookTitle: "认知之书",
				filePath: "Books/demo.epub",
				chapterTitle: "第一章 注意力",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "完整章节正文",
				tocItems,
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.moonshot.ai/v1",
					model: "kimi-k3",
				},
				requester,
				now: () => 1710000000000,
			},
		);

		expect(result.content).toContain("本章摘要");
		expect(result.model).toBe("kimi-k3");
		expect(requester).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://api.moonshot.ai/v1/chat/completions",
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer test-key",
				}),
			}),
		);
	});

	it("uses Kimi Code compatible generation options for the coding endpoint", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content: "AI reading result",
						},
					},
				],
			},
		}));

		await requestEpubAiReading(
			{
				bookTitle: "Demo",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Complete chapter text",
				tocItems,
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.kimi.com/coding/v1",
					model: "k3",
				},
				requester,
			},
		);

		const request = requester.mock.calls[0]?.[0];
		const body = JSON.parse(String(request.body));
		expect(request.url).toBe("https://api.kimi.com/coding/v1/chat/completions");
		expect(body.temperature).toBe(1);
		expect(body.max_tokens).toBeUndefined();
		expect(body.max_completion_tokens).toBe(16000);
		expect(body.thinking).toBeUndefined();
		expect(body.reasoning_effort).toBe("low");
	});

	it("uses DeepSeek chat options with disabled thinking mode", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content: "AI reading result",
						},
					},
				],
			},
		}));

		await requestEpubAiReading(
			{
				bookTitle: "Demo",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Complete chapter text",
				tocItems,
			},
			{
				config: {
					provider: "deepseek",
					apiKey: "deepseek-key",
					baseUrl: "https://api.deepseek.com",
					model: "deepseek-v4-flash",
				},
				requester,
			},
		);

		const request = requester.mock.calls[0]?.[0];
		const body = JSON.parse(String(request.body));
		expect(request.url).toBe("https://api.deepseek.com/chat/completions");
		expect(body.max_tokens).toBe(16000);
		expect(body.max_completion_tokens).toBeUndefined();
		expect(body.thinking).toEqual({ type: "disabled" });
	});

	it("uses GPT chat options with disabled reasoning mode", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content: "AI reading result",
						},
					},
				],
			},
		}));

		await requestEpubAiReading(
			{
				bookTitle: "Demo",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Complete chapter text",
				tocItems,
			},
			{
				config: {
					provider: "openai",
					apiKey: "openai-key",
					baseUrl: "https://api.openai.com/v1",
					model: "gpt-5.5",
				},
				requester,
			},
		);

		const request = requester.mock.calls[0]?.[0];
		const body = JSON.parse(String(request.body));
		expect(request.url).toBe("https://api.openai.com/v1/chat/completions");
		expect(body.max_completion_tokens).toBe(16000);
		expect(body.max_tokens).toBeUndefined();
		expect(body.reasoning_effort).toBe("none");
		expect(body.temperature).toBeUndefined();
	});

	it("keeps kimi-k3 as a Kimi API Platform model", () => {
		const selection = resolveEpubAiReadingSelection({
			apiKeys: {
				kimi: {
					apiKey: "runtime-key",
					model: "kimi-k3",
				},
			},
			epubAiReading: {
				provider: "kimi",
				model: "kimi-k3",
			},
		});

		expect(selection).toEqual({
			provider: "kimi",
			model: "kimi-k3",
			kimiMode: "platform",
		});
	});

	it("keeps Kimi Code credentials separate from Kimi API Platform credentials", () => {
		const selection = resolveEpubAiReadingSelection({
			apiKeys: {
				kimi: {
					platform: {
						apiKey: "platform-key",
						baseUrl: "https://api.moonshot.ai/v1",
						model: "kimi-k2.6",
					},
					code: {
						apiKey: "code-key",
						baseUrl: "https://api.kimi.com/coding/v1",
						model: "k3",
					},
				},
			},
			epubAiReading: {
				provider: "kimi",
				kimiMode: "code",
				model: "k3",
			},
		});

		expect(selection).toEqual({
			provider: "kimi",
			model: "k3",
			kimiMode: "code",
		});
	});

	it("ignores legacy max token env and sends a dynamic max_completion_tokens value", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content: "AI reading result",
						},
					},
				],
			},
		}));

		await requestEpubAiReading(
			{
				bookTitle: "Demo",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Complete chapter text",
				tocItems,
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.kimi.com/coding/v1",
					model: "k3",
				},
				runtimeEnv: {
					KIMI_MAX_TOKENS: "4096",
				},
				requester,
			},
		);

		const request = requester.mock.calls[0]?.[0];
		const body = JSON.parse(String(request.body));
		expect(body.max_tokens).toBeUndefined();
		expect(body.max_completion_tokens).toBe(16000);
	});

	it("emits stage updates while preparing and requesting AI reading", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content: "AI reading result",
						},
					},
				],
			},
		}));
		const stages: string[] = [];

		await requestEpubAiReading(
			{
				bookTitle: "Demo",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Complete chapter text",
				tocItems,
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.kimi.com/coding/v1",
					model: "k3",
				},
				requester,
				onStage: (stage) => stages.push(stage),
				enableStreaming: false,
			},
		);

		expect(stages).toEqual([
			"正在读取 AI 配置",
			"正在整理章节结构",
			"正在打包发送给 AI",
			"AI 正在整理阅读结果",
		]);
	});

	it("streams partial AI reading content from an SSE chat completion response", async () => {
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					encoder.encode(
						'data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n',
					),
				);
				controller.enqueue(
					encoder.encode(
						'data: {"choices":[{"delta":{"content":"第二段"}}]}\n\n',
					),
				);
				controller.enqueue(encoder.encode("data: [DONE]\n\n"));
				controller.close();
			},
		});
		const fetcher = vi.fn(async () => new Response(stream, { status: 200 }));
		const requester = vi.fn();
		const partials: string[] = [];

		const result = await requestEpubAiReading(
			{
				bookTitle: "Demo",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Complete chapter text",
				tocItems,
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.kimi.com/coding/v1",
					model: "k3",
				},
				requester,
				fetcher,
				onPartialContent: (content) => partials.push(content),
			},
		);

		expect(result.content).toBe("第一段第二段");
		expect(partials).toEqual(["第一段", "第一段第二段"]);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(requester).not.toHaveBeenCalled();
	});

	it("uses a runtime stream requester before falling back to requestUrl", async () => {
		const streamRequester = vi.fn(async (request) => {
			const body = JSON.parse(request.body);
			expect(request.url).toBe(
				"https://api.kimi.com/coding/v1/chat/completions",
			);
			expect(request.headers.Accept).toBe("text/event-stream");
			expect(body.stream).toBe(true);
			return "Node streaming result";
		});
		const requester = vi.fn();

		const result = await requestEpubAiReading(
			{
				bookTitle: "Demo",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Complete chapter text",
				tocItems,
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.kimi.com/coding/v1",
					model: "k3",
				},
				requester,
				streamRequester,
				onPartialContent: vi.fn(),
			},
		);

		expect(result.content).toBe("Node streaming result");
		expect(streamRequester).toHaveBeenCalledOnce();
		expect(requester).not.toHaveBeenCalled();
	});

	it("uses Kimi reasoning chunks only for stage updates", async () => {
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					encoder.encode(
						'data: {"choices":[{"delta":{"reasoning_content":"hidden reasoning"}}]}\n\n',
					),
				);
				controller.enqueue(
					encoder.encode(
						'data: {"choices":[{"delta":{"content":"visible answer"}}]}\n\n',
					),
				);
				controller.enqueue(encoder.encode("data: [DONE]\n\n"));
				controller.close();
			},
		});
		const stages: string[] = [];
		const partials: string[] = [];

		const result = await requestEpubAiReading(
			{
				bookTitle: "Demo",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Complete chapter text",
				tocItems,
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.kimi.com/coding/v1",
					model: "k3",
				},
				requester: vi.fn(),
				fetcher: vi.fn(async () => new Response(stream, { status: 200 })),
				onStage: (stage) => stages.push(stage),
				onPartialContent: (content) => partials.push(content),
			},
		);

		expect(result.content).toBe("visible answer");
		expect(result.content).not.toContain("hidden reasoning");
		expect(partials).toEqual(["visible answer"]);
		expect(stages).toContain(
			"AI \u6b63\u5728\u5206\u6790\u6b63\u6587\u548c\u7ae0\u8282\u5173\u7cfb",
		);
		expect(stages).toContain(
			"\u6b63\u5728\u6d41\u5f0f\u8f93\u51fa AI \u9605\u8bfb\u7ed3\u679c",
		);
	});

	it("decorates AI source markers in request results and generated notes", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content:
								"## Important Excerpts\nLaTeX definition matters. [段001]",
						},
					},
				],
			},
		}));
		const sourceBlocks: EpubAiReadingSourceBlock[] = [
			{
				id: "段001",
				chapterHref: "Text/chapter1.xhtml",
				cfi: "epubcfi(/6/2)",
				text: "LaTeX is a document markup language.",
				headingPath: ["Chapter 1"],
				kind: "paragraph",
				sourceLink: "[[Books/latex.epub#weave-cfi=epubcfi(/6/2)|段001]]",
			},
		];

		const result = await requestEpubAiReading(
			{
				bookTitle: "LaTeX Guide",
				filePath: "Books/latex.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "Text/chapter1.xhtml",
				chapterText: "Fallback text",
				tocItems,
				sourceBlocks,
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.kimi.com/coding/v1",
					model: "k3",
				},
				requester,
				enableStreaming: false,
				now: () => 1710000000000,
			},
		);

		expect(result.content).toContain(
			"[[Books/latex.epub#weave-cfi=epubcfi(/6/2)&flashStyle=pulse&flashColor=yellow|原文]]",
		);
		expect(result.sourceBlocks).toEqual(sourceBlocks);
		expect(buildEpubAiReadingNoteSection(result)).toContain(
			"[[Books/latex.epub#weave-cfi=epubcfi(/6/2)&flashStyle=pulse&flashColor=yellow|原文]]",
		);
	});

	it("decorates AI source placeholders in request results before writing notes", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content:
								"## 关键知识点\n- 单段 {{source:U016.P001}}\n- 范围 {{source-range:U016.P001-U016.P002}}",
						},
					},
				],
			},
		}));
		const sourceBlocks: EpubAiReadingSourceBlock[] = [
			{
				id: "U016.P001",
				chapterHref: "OEBPS/B21326_05.xhtml",
				cfi: "readium:start",
				text: "First source paragraph.",
				headingPath: ["Chapter 5"],
				kind: "paragraph",
				sourceLink: "[[Books/latex.epub#weave-cfi=readium:start&eid=ai-source-U016-P001|U016.P001]]",
			},
			{
				id: "U016.P002",
				chapterHref: "OEBPS/B21326_05.xhtml",
				cfi: "readium:end",
				text: "Second source paragraph.",
				headingPath: ["Chapter 5"],
				kind: "paragraph",
				sourceLink: "[[Books/latex.epub#weave-cfi=readium:end&eid=ai-source-U016-P002|U016.P002]]",
			},
		];

		const result = await requestEpubAiReading(
			{
				bookTitle: "LaTeX Cookbook",
				filePath: "Books/latex.epub",
				chapterTitle: "Chapter 5",
				chapterHref: "OEBPS/B21326_05.xhtml",
				chapterText: "First source paragraph.\n\nSecond source paragraph.",
				tocItems,
				sourceBlocks,
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.kimi.com/coding/v1",
					model: "k3",
				},
				requester,
				enableStreaming: false,
				now: () => 1710000000000,
			},
		);
		const noteSection = buildEpubAiReadingNoteSection(result);

		expect(result.content).toContain(
			"[[Books/latex.epub#weave-cfi=readium:start&eid=ai-source-U016-P001&flashStyle=pulse&flashColor=yellow|原文]]",
		);
		expect(result.content).toContain("rangeEndCfi=readium%3Aend");
		expect(result.content).toContain("rangeCfis=readium%3Astart,readium%3Aend");
		expect(result.content.match(/\|原文\]\]/g)).toHaveLength(2);
		expect(result.content).not.toContain("{{source");
		expect(result.content).not.toContain("|U016.P001]]");
		expect(noteSection).toContain("rangeEndCfi=readium%3Aend");
		expect(noteSection).not.toContain("{{source");
	});

	it("passes close-reading units through request results and generated notes", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content: "## 按小节精读\n### U016 操作指南\n重点 [U016.P001]",
						},
					},
				],
			},
		}));
		const closeReadingUnits = [
			{
				id: "U016",
				label: "操作指南",
				href: "OEBPS/B21326_05.xhtml#how",
				pathLabels: ["第五章：图像处理", "图像对齐", "操作指南"],
				flatIndex: 16,
				depth: 2,
				sourceBlockIds: ["U016.P001"],
			},
		];

		const result = await requestEpubAiReading(
			{
				bookTitle: "LaTeX Cookbook",
				filePath: "Books/latex.epub",
				chapterTitle: "第五章：图像处理",
				chapterHref: "OEBPS/B21326_05.xhtml",
				chapterText: "操作指南正文。",
				tocItems,
				closeReadingUnits,
				sourceBlocks: [
					{
						id: "U016.P001",
						chapterHref: "OEBPS/B21326_05.xhtml",
						text: "操作指南正文。",
						headingPath: ["第五章：图像处理", "图像对齐", "操作指南"],
						kind: "paragraph",
						sourceLink: "[[Books/latex.epub#weave-cfi=epubcfi(/6/2)|U016.P001]]",
					},
				],
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.kimi.com/coding/v1",
					model: "k3",
				},
				requester,
				enableStreaming: false,
				now: () => 1710000000000,
			},
		);
		const noteSection = buildEpubAiReadingNoteSection(result);

		expect(result.closeReadingUnits).toEqual(closeReadingUnits);
	expect(result.content).toContain(
		"[[Books/latex.epub#weave-cfi=epubcfi(/6/2)&flashStyle=pulse&flashColor=yellow|原文]]",
	);
		expect(result.content).not.toContain("|U016.P001]]");
		expect(noteSection).toContain("> 来源：原文，共 1 段 · 共 1 个精读单元");
		expect(noteSection).toContain("U016 操作指南");
	});

	it("removes duplicate global important-source sections from close-reading unit note sections", () => {
		const noteSection = buildEpubAiReadingNoteSection({
			bookTitle: "LaTeX Cookbook",
			filePath: "Books/latex.epub",
			chapterTitle: "第五章：图像处理",
			chapterHref: "OEBPS/B21326_05.xhtml",
			model: "k3",
			generatedAt: "2026-08-04T08:00:00.000Z",
			scope: {
				label: "第五章：图像处理 > 全部",
				pathLabels: ["第五章：图像处理", "全部"],
				includeDescendants: true,
			},
			closeReadingUnits: [
				{
					id: "U016",
					label: "操作指南",
					href: "OEBPS/B21326_05.xhtml#how",
					pathLabels: ["第五章：图像处理", "图像对齐", "操作指南"],
					sourceBlockIds: ["U016.P001"],
				},
			],
			sourceBlocks: [],
			content: [
				"## U016 操作指南",
				"### 小节摘要",
				"正文摘要。",
				"**重要原文与解读**",
				"- U 单元内的重要原文。",
				"## 重要原文与解读",
				"- 重复的外层重要原文。",
				"## 概念/术语",
				"- 保留的术语说明。",
			].join("\n"),
		});

		expect(noteSection).toContain("**重要原文与解读**");
		expect(noteSection).toContain("U 单元内的重要原文");
		expect(noteSection).not.toContain("## 重要原文与解读");
		expect(noteSection).not.toContain("重复的外层重要原文");
		expect(noteSection).toContain("## 概念/术语");
		expect(noteSection).toContain("保留的术语说明");
	});

	it("loads Kimi configuration from the plugin .env file at request time", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content: "# 本章摘要\n运行时配置可用",
						},
					},
				],
			},
		}));
		const { app } = createMemoryApp({
			".obsidian/plugins/weave-reader/.env": [
				"KIMI_API_KEY=runtime-key",
				"KIMI_API_BASE_URL=https://api.moonshot.ai/v1",
				"KIMI_MODEL=kimi-k3",
			].join("\n"),
		});

		await requestEpubAiReading(
			{
				bookTitle: "认知之书",
				filePath: "Books/demo.epub",
				chapterTitle: "第一章 注意力",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "完整章节正文",
				tocItems,
			},
			{ app, requester },
		);

		expect(requester).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://api.moonshot.ai/v1/chat/completions",
				headers: expect.objectContaining({
					Authorization: "Bearer runtime-key",
				}),
			}),
		);
	});

	it("runs a local closed loop from runtime env to generated AI reading note", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content: [
								"## 本章摘要",
								"本章说明注意力是一种有限资源。",
								"## 关键知识点",
								"- 信息环境会消耗注意力。",
								"## 重要原文",
								"- `注意力是一种有限资源`：这是本章论证的核心句。",
							].join("\n"),
						},
					},
				],
			},
		}));
		const { app, files } = createMemoryApp({
			".obsidian/plugins/weave-reader/.env": [
				"KIMI_API_KEY=runtime-key",
				"KIMI_API_BASE_URL=https://api.moonshot.ai/v1",
				"KIMI_MODEL=kimi-k3",
			].join("\n"),
		});

		const result = await requestEpubAiReading(
			{
				bookTitle: "认知之书",
				author: "作者甲",
				filePath: "Books/demo.epub",
				chapterTitle: "第一章 注意力",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "注意力是一种有限资源。本章讨论注意力如何被信息环境消耗。",
				tocItems,
				sourceLink: "obsidian://weave-reader?book=demo",
			},
			{ app, requester, now: () => 1710000000000 },
		);
		const noteFile = await upsertEpubAiReadingNote(app, result);
		const note = files.get(noteFile.path) || "";

		expect(noteFile.path).toBe("AI阅读笔记/认知之书 - AI阅读.md");
		expect(note).toContain("# 认知之书 - AI阅读");
		expect(note).toContain("## 第一章 注意力");
		expect(note).toContain("## 本章摘要");
		expect(note).toContain("信息环境会消耗注意力");
		expect(note).toContain("[打开原文](obsidian://weave-reader?book=demo)");
		expect(requester).toHaveBeenCalledOnce();
	});

	it("builds a compact note section with a stable chapter marker and source link", () => {
		const markdown = buildEpubAiReadingNoteSection({
			bookTitle: "认知之书",
			filePath: "Books/demo.epub",
			chapterTitle: "第一章 注意力",
			chapterHref: "text/chapter1.xhtml",
			sourceLink: "obsidian://weave-reader?book=demo",
			content: "# 本章摘要\n内容总结",
			model: "kimi-k3",
			generatedAt: 1710000000000,
		});

		expect(markdown).toContain("weave-epub-ai-reading:start");
		expect(markdown).toContain("## 第一章 注意力");
		expect(markdown).toContain("> [!info] AI 阅读");
		expect(markdown).toContain("> 原文：[打开原文](obsidian://weave-reader?book=demo)");
		expect(markdown).not.toContain("EPUB 文件");
		expect(markdown).not.toContain("章节 href");
		expect(markdown).toContain("# 本章摘要");
	});

	it("adds an AI reading note filter root marker to generated sections", () => {
		const markdown = buildEpubAiReadingNoteSection({
			bookTitle: "Demo Book",
			filePath: "Books/demo.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "text/chapter1.xhtml",
			content: "## 范围摘要\nScoped result",
			model: "kimi-k3",
			generatedAt: 1710000000000,
		});

		expect(markdown).toContain("weave-epub-ai-reading-note-root");
		expect(markdown).toContain('data-source-file="Books/demo.epub"');
		expect(markdown).toContain('data-scope-label="Chapter 1"');
	});

	it("persists a machine-readable source map in generated note sections", () => {
		const markdown = buildEpubAiReadingNoteSection({
			bookTitle: "Demo Book",
			filePath: "Books/demo.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "text/chapter1.xhtml",
			sourceBlocks: [
				{
					id: "U191.P006",
					chapterHref: "text/chapter1.xhtml#unit",
					chapterTitle: "Chapter 1",
					cfi: "epubcfi(/6/2!/4/2,/1:0,/1:20)",
					sourceLink:
						"[[Books/demo.epub#weave-cfi=epubcfi(/6/2!/4/2,/1:0,/1:20)&sid=epubsrc-demo&eid=ai-source-U191-P006&flashStyle=pulse&flashColor=yellow|U191.P006]]",
					headingPath: ["Chapter 1", "Unit"],
					text: "Current unit paragraph.",
					kind: "paragraph",
				},
			],
			closeReadingUnits: [
				{
					id: "U191",
					label: "Unit",
					href: "text/chapter1.xhtml#unit",
					pathLabels: ["Chapter 1", "Unit"],
					flatIndex: 12,
					depth: 2,
					sourceBlockIds: ["U191.P006"],
				},
			],
			content: "## 范围摘要\nCurrent unit paragraph {{source:U191.P006}}",
			model: "kimi-k3",
			generatedAt: 1710000000000,
		});

		const encoded = markdown.match(
			/<!--\s*weave-epub-ai-reading-source-map:([^>]+?)-->/,
		)?.[1];
		expect(encoded).toBeTruthy();
		const sourceMap = JSON.parse(decodeURIComponent(encoded || ""));
		expect(sourceMap).toMatchObject({
			version: 1,
			filePath: "Books/demo.epub",
			blocks: [
				{
					id: "U191.P006",
					cfi: "epubcfi(/6/2!/4/2,/1:0,/1:20)",
					sourceLink:
						"[[Books/demo.epub#weave-cfi=epubcfi(/6/2!/4/2,/1:0,/1:20)&sid=epubsrc-demo&eid=ai-source-U191-P006&flashStyle=pulse&flashColor=yellow|U191.P006]]",
				},
			],
			units: [
				{
					id: "U191",
					href: "text/chapter1.xhtml#unit",
					sourceBlockIds: ["U191.P006"],
				},
			],
		});
		expect(JSON.stringify(sourceMap)).not.toContain("Current unit paragraph.");
	});

	it("indexes generated close-reading units so broad notes can be filtered by leaf scope", () => {
		const markdown = buildEpubAiReadingNoteSection({
			bookTitle: "LaTeX Cookbook",
			filePath: "Books/latex.epub",
			chapterTitle: "第六章：图形创作",
			chapterHref: "Text/ch6.xhtml",
			scope: {
				label: "第六章：图形创作",
				pathLabels: ["第六章：图形创作", "全部"],
				href: "Text/ch6.xhtml",
				includeDescendants: true,
				flatIndex: 199,
				endFlatIndex: 210,
			},
			closeReadingUnits: [
				{
					id: "U200",
					label: "准备工作",
					href: "Text/ch6.xhtml#prepare",
					pathLabels: ["第六章：图形创作", "准备工作"],
					flatIndex: 199,
					depth: 2,
					sourceBlockIds: ["U200.P001", "U200.P002"],
				},
				{
					id: "U206",
					label: "工作原理",
					href: "Text/ch6.xhtml#principle",
					pathLabels: ["第六章：图形创作", "绘制流程图", "工作原理"],
					flatIndex: 205,
					depth: 3,
					sourceBlockIds: ["U206.P001"],
				},
			],
			content: [
				"## 范围摘要",
				"整章总览。",
				"## 按小节精读",
				"## U200 第六章：图形创作 > 准备工作",
				"准备工作细节。",
				"## U206 第六章：图形创作 > 绘制流程图 > 工作原理",
				"工作原理细节。",
			].join("\n"),
			model: "kimi-k3",
			generatedAt: 1710000000000,
		});

		expect(markdown).toContain('data-scope-label="第六章：图形创作 &gt; 全部"');
		expect(markdown).toContain('data-scope-label="第六章：图形创作 &gt; 准备工作"');
		expect(markdown).toContain(
			'data-scope-label="第六章：图形创作 &gt; 绘制流程图 &gt; 工作原理"',
		);
		expect(markdown).toContain('data-ai-unit-id="U200"');
		expect(markdown).toContain('data-ai-unit-id="U206"');
		expect(markdown.indexOf('data-ai-unit-id="U200"')).toBeGreaterThan(
			markdown.indexOf("## U200"),
		);
		expect(markdown.indexOf('data-ai-unit-id="U206"')).toBeGreaterThan(
			markdown.indexOf("## U206"),
		);
	});

	it("builds an empty AI reading note with a start action", () => {
		const markdown = buildEpubAiReadingEmptyNoteMarkdown({
			bookTitle: "认知之书",
			filePath: "Books/demo.epub",
		});

		expect(markdown).toContain("# 认知之书 - AI阅读");
		expect(markdown).toContain("暂无 AI 阅读内容");
		expect(markdown).toContain('data-weave-ai-reading-action="start"');
		expect(markdown).toContain('data-source-file="Books/demo.epub"');
		expect(markdown).toContain("weave-epub-ai-reading-empty:start");
	});

	it("creates an empty AI reading note before the first generated section exists", async () => {
		const { app, files } = createMemoryApp();

		const noteFile = await ensureEpubAiReadingNote(app, {
			bookTitle: "认知之书",
			filePath: "Books/demo.epub",
		});

		const note = files.get(noteFile.path) || "";
		expect(noteFile.path).toBe("AI阅读笔记/认知之书 - AI阅读.md");
		expect(note).toContain("暂无 AI 阅读内容");
		expect(note).toContain('data-weave-ai-reading-action="start"');
	});

	it("repairs an existing blank AI reading note with the empty start action", async () => {
		const targetPath = "AI阅读笔记/Demo - AI阅读.md";
		const { app, files } = createMemoryApp({
			[targetPath]: "",
		});

		const noteFile = await ensureEpubAiReadingNote(app, {
			bookTitle: "Demo",
			filePath: "Books/demo.epub",
		});

		const note = files.get(noteFile.path) || "";
		expect(noteFile.path).toBe(targetPath);
		expect(note).toContain("暂无 AI 阅读内容");
		expect(note).toContain('data-weave-ai-reading-action="start"');
		expect(note).toContain('data-source-file="Books/demo.epub"');
	});

	it("repairs duplicate global important-source sections when opening existing AI reading notes", async () => {
		const targetPath = "AI阅读笔记/Demo - AI阅读.md";
		const duplicatedSection = [
			'<!-- weave-epub-ai-reading:start key="old-section" -->',
			"## 第五章：图像处理",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="第五章：图像处理 &gt; 全部"></div>',
			"## U016 操作指南",
			'<div class="weave-epub-ai-reading-note-root" data-ai-unit-id="U016" data-scope-level="leaf"></div>',
			"**重要原文与解读**",
			"- U 单元内的重要原文。",
			"## 重要原文与解读",
			"- 重复的外层重要原文。",
			"## 概念/术语",
			"- 保留的术语说明。",
			'<!-- weave-epub-ai-reading:end key="old-section" -->',
		].join("\n");
		const { app, files } = createMemoryApp({
			[targetPath]: buildEpubAiReadingNoteMarkdown({
				bookTitle: "Demo",
				filePath: "Books/demo.epub",
				sectionsMarkdown: duplicatedSection,
			}),
		});

		await ensureEpubAiReadingNote(app, {
			bookTitle: "Demo",
			filePath: "Books/demo.epub",
		});

		const note = files.get(targetPath) || "";
		expect(note).toContain("U 单元内的重要原文");
		expect(note).not.toContain("重复的外层重要原文");
		expect(note).toContain("## 概念/术语");
		expect(note).toContain("保留的术语说明");
	});

	it("writes scoped range and source-block diagnostics into note sections", () => {
		const markdown = buildEpubAiReadingNoteSection({
			bookTitle: "LaTeX Guide",
			filePath: "Books/latex.epub",
			chapterTitle: "Installing and using LaTeX",
			chapterHref: "Text/ch1.xhtml#install",
			sourceLink: "obsidian://weave-reader?book=latex",
			scope: {
				label: "Installing and using LaTeX",
				pathLabels: ["Chapter 1", "Installing and using LaTeX", "全部"],
				href: "Text/ch1.xhtml#install",
				includeDescendants: true,
				flatIndex: 1,
				endFlatIndex: 3,
			},
			sourceBlocks: [
				{
					id: "段001",
					chapterHref: "Text/ch1.xhtml#install",
					text: "Install TeX Live.",
					headingPath: ["Chapter 1"],
					kind: "paragraph",
				},
				{
					id: "段002",
					chapterHref: "Text/ch1.xhtml#install",
					text: "Open TeXworks.",
					headingPath: ["Chapter 1"],
					kind: "paragraph",
				},
				{
					id: "段003",
					chapterHref: "Text/ch1.xhtml#install",
					text: "Typeset the first document.",
					headingPath: ["Chapter 1"],
					kind: "paragraph",
				},
			],
			content: "## 范围摘要\nScoped result",
			model: "kimi-k3",
			generatedAt: 1710000000000,
		});

		expect(markdown).toContain(
			"> 范围：Chapter 1 > Installing and using LaTeX > 全部",
		);
		expect(markdown).toContain(
			"> 来源：共 3 段 · 包含该目录项及其下级目录正文",
		);
		expect(markdown).not.toContain("范围 href");
		expect(markdown).not.toContain("来源块：段001");
		expect(markdown).toContain("## 范围摘要");
	});

	it("updates an existing chapter section instead of appending duplicates", async () => {
		const initialSection = buildEpubAiReadingNoteSection({
			bookTitle: "认知之书",
			filePath: "Books/demo.epub",
			chapterTitle: "第一章 注意力",
			chapterHref: "text/chapter1.xhtml",
			content: "旧结果",
			model: "kimi-k3",
			generatedAt: 1710000000000,
		});
		const existingNote = buildEpubAiReadingNoteMarkdown({
			bookTitle: "认知之书",
			filePath: "Books/demo.epub",
			sectionsMarkdown: initialSection,
		});
		const { app, files } = createMemoryApp({
			"AI阅读笔记/认知之书 - AI阅读.md": existingNote,
		});

		await upsertEpubAiReadingNote(app, {
			bookTitle: "认知之书",
			filePath: "Books/demo.epub",
			chapterTitle: "第一章 注意力",
			chapterHref: "text/chapter1.xhtml",
			content: "新结果",
			model: "kimi-k3",
			generatedAt: 1710000001000,
		});

		const updated = files.get("AI阅读笔记/认知之书 - AI阅读.md") || "";
		expect(updated).toContain("新结果");
		expect(updated).not.toContain("旧结果");
		expect(updated.match(/weave-epub-ai-reading:start/g)).toHaveLength(1);
	});

	it("repairs duplicate global important-source sections in existing AI reading notes during upsert", async () => {
		const duplicatedSection = [
			'<!-- weave-epub-ai-reading:start key="old-section" -->',
			"## 第五章：图像处理",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="第五章：图像处理 &gt; 全部"></div>',
			"## U016 操作指南",
			'<div class="weave-epub-ai-reading-note-root" data-ai-unit-id="U016" data-scope-level="leaf"></div>',
			"**重要原文与解读**",
			"- U 单元内的重要原文。",
			"## 重要原文与解读",
			"- 重复的外层重要原文。",
			"## 概念/术语",
			"- 保留的术语说明。",
			'<!-- weave-epub-ai-reading:end key="old-section" -->',
		].join("\n");
		const existingNote = buildEpubAiReadingNoteMarkdown({
			bookTitle: "认知之书",
			filePath: "Books/demo.epub",
			sectionsMarkdown: duplicatedSection,
		});
		const { app, files } = createMemoryApp({
			"AI阅读笔记/认知之书 - AI阅读.md": existingNote,
		});

		await upsertEpubAiReadingNote(app, {
			bookTitle: "认知之书",
			filePath: "Books/demo.epub",
			chapterTitle: "第一章 注意力",
			chapterHref: "text/chapter1.xhtml",
			content: "新结果",
			model: "kimi-k3",
			generatedAt: 1710000001000,
		});

		const updated = files.get("AI阅读笔记/认知之书 - AI阅读.md") || "";
		expect(updated).toContain("U 单元内的重要原文");
		expect(updated).not.toContain("重复的外层重要原文");
		expect(updated).toContain("## 概念/术语");
		expect(updated).toContain("保留的术语说明");
		expect(updated).toContain("新结果");
	});

	it("removes the empty state when the first AI reading section is generated", async () => {
		const emptyNote = buildEpubAiReadingEmptyNoteMarkdown({
			bookTitle: "认知之书",
			filePath: "Books/demo.epub",
		});
		const { app, files } = createMemoryApp({
			"AI阅读笔记/认知之书 - AI阅读.md": emptyNote,
		});

		await upsertEpubAiReadingNote(app, {
			bookTitle: "认知之书",
			filePath: "Books/demo.epub",
			chapterTitle: "第一章 注意力",
			chapterHref: "text/chapter1.xhtml",
			content: "第一段 AI 阅读结果",
			model: "kimi-k3",
			generatedAt: 1710000001000,
		});

		const updated = files.get("AI阅读笔记/认知之书 - AI阅读.md") || "";
		expect(updated).not.toContain("暂无 AI 阅读内容");
		expect(updated).not.toContain("weave-epub-ai-reading-empty:start");
		expect(updated).toContain("第一段 AI 阅读结果");
		expect(updated.match(/weave-epub-ai-reading:start/g)).toHaveLength(1);
	});

	it("keeps different scoped ranges as separate note sections even when hrefs match", async () => {
		const existingNote = buildEpubAiReadingNoteMarkdown({
			bookTitle: "LaTeX Guide",
			filePath: "Books/latex.epub",
			sectionsMarkdown: buildEpubAiReadingNoteSection({
				bookTitle: "LaTeX Guide",
				filePath: "Books/latex.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "Text/ch1.xhtml",
				scope: {
					label: "Chapter 1",
					pathLabels: ["Chapter 1", "全部"],
					href: "Text/ch1.xhtml",
					includeDescendants: true,
					flatIndex: 0,
					endFlatIndex: 3,
				},
				content: "parent range result",
				model: "kimi-k3",
				generatedAt: 1710000000000,
			}),
		});
		const { app, files } = createMemoryApp({
			"AI阅读笔记/LaTeX Guide - AI阅读.md": existingNote,
		});

		await upsertEpubAiReadingNote(app, {
			bookTitle: "LaTeX Guide",
			filePath: "Books/latex.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "Text/ch1.xhtml",
			scope: {
				label: "Installing and using LaTeX",
				pathLabels: ["Chapter 1", "Installing and using LaTeX", "全部"],
				href: "Text/ch1.xhtml",
				includeDescendants: true,
				flatIndex: 1,
				endFlatIndex: 3,
			},
			content: "child range result",
			model: "kimi-k3",
			generatedAt: 1710000001000,
		});

		const updated = files.get("AI阅读笔记/LaTeX Guide - AI阅读.md") || "";
		expect(updated).toContain("parent range result");
		expect(updated).toContain("child range result");
		expect(updated.match(/weave-epub-ai-reading:start/g)).toHaveLength(2);
	});
});
