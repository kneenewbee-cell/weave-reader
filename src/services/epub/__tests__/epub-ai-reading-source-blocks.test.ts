import { describe, expect, it } from "vitest";
import type { ReaderParagraph } from "../reader-engine-types";
import {
	buildEpubAiReadingSourceBlocksFromParagraphs,
	decorateEpubAiReadingSourceReferences,
	decorateEpubAiReadingLegacyNoteBareSourceReferences,
	filterReaderParagraphsForAiReadingDraft,
	formatEpubAiReadingSourceBlocksForPrompt,
	formatEpubAiReadingSourceReferenceLabel,
	formatEpubAiReadingSourceReferenceTitle,
	limitEpubAiReadingSourceReferencesPerLine,
	type EpubAiReadingSourceBlock,
} from "../epub-ai-reading-source-blocks";

describe("epub-ai-reading-source-blocks", () => {
	it("creates ordered segment source blocks from reader paragraphs", () => {
		const paragraphs: ReaderParagraph[] = [
			{
				id: "reader-p1",
				chapterIndex: 4,
				chapterTitle: "Chapter 1",
				chapterHref: "OEBPS/chapter1.xhtml",
				text: "LaTeX is a document markup language.",
				cfiRange: "epubcfi(/6/10!/4/2,/1:0,/1:14)",
			},
			{
				id: "reader-p2",
				chapterIndex: 4,
				chapterTitle: "Chapter 1",
				chapterHref: "OEBPS/chapter1.xhtml",
				text: "   ",
				cfiRange: "epubcfi(/6/10!/4/4)",
			},
			{
				id: "reader-p3",
				chapterIndex: 4,
				chapterTitle: "Chapter 1",
				chapterHref: "OEBPS/chapter1.xhtml",
				text: "Overleaf supports online collaboration.",
				html: "<li>Overleaf supports online collaboration.</li>",
				cfiRange: "epubcfi(/6/10!/4/6,/1:0,/1:12)",
			},
		];

		const blocks = buildEpubAiReadingSourceBlocksFromParagraphs(paragraphs, {
			sourceLinkForParagraph: (paragraph, id) =>
				`[[Books/demo.epub#weave-cfi=${paragraph.cfiRange}|${id}]]`,
		});

		expect(blocks).toEqual([
			expect.objectContaining({
				id: "段001",
				readerParagraphId: "reader-p1",
				chapterIndex: 4,
				headingPath: ["Chapter 1"],
				kind: "paragraph",
				text: "LaTeX is a document markup language.",
				sourceLink:
					"[[Books/demo.epub#weave-cfi=epubcfi(/6/10!/4/2,/1:0,/1:14)|段001]]",
			}),
			expect.objectContaining({
				id: "段002",
				readerParagraphId: "reader-p3",
				kind: "list",
				text: "Overleaf supports online collaboration.",
				sourceLink:
					"[[Books/demo.epub#weave-cfi=epubcfi(/6/10!/4/6,/1:0,/1:12)|段002]]",
			}),
		]);
	});

	it("formats source blocks for the model prompt", () => {
		const blocks: EpubAiReadingSourceBlock[] = [
			{
				id: "段001",
				chapterHref: "chapter.xhtml",
				cfi: "epubcfi(/6/2)",
				headingPath: ["Chapter 1", "Content and form"],
				text: "Tell LaTeX that this is a section heading.",
				kind: "paragraph",
				sourceLink: "[[Books/demo.epub#weave-cfi=epubcfi(/6/2)|段001]]",
			},
		];

		const prompt = formatEpubAiReadingSourceBlocksForPrompt(blocks);

		expect(prompt).toContain(
			"[段001] kind=paragraph path=Chapter 1 > Content and form",
		);
		expect(prompt).toContain("href=chapter.xhtml cfi=epubcfi(/6/2)");
		expect(prompt).toContain("Tell LaTeX that this is a section heading.");
	});

	it("creates unit-scoped source ids and heading paths", () => {
		const paragraphs: ReaderParagraph[] = [
			{
				id: "reader-p1",
				chapterIndex: 4,
				chapterTitle: "第五章：图像处理",
				chapterHref: "OEBPS/B21326_05.xhtml",
				text: "操作指南正文。",
				cfiRange: "epubcfi(/6/10!/4/2)",
			},
		];

		const blocks = buildEpubAiReadingSourceBlocksFromParagraphs(paragraphs, {
			headingPath: ["第五章：图像处理", "图像对齐", "操作指南"],
			idForIndex: (index) => `U016.P${String(index + 1).padStart(3, "0")}`,
			sourceLinkForParagraph: (_paragraph, id) => `[[Book.epub#loc|${id}]]`,
		});

		expect(blocks).toEqual([
			expect.objectContaining({
				id: "U016.P001",
				headingPath: ["第五章：图像处理", "图像对齐", "操作指南"],
				sourceLink: "[[Book.epub#loc|U016.P001]]",
			}),
		]);
	});

	it("filters source paragraphs to the scoped draft text before assigning source ids", () => {
		const paragraphs: ReaderParagraph[] = [
			{
				id: "outside-before",
				chapterIndex: 4,
				chapterTitle: "Chapter 1",
				chapterHref: "OEBPS/chapter1.xhtml",
				text: "This paragraph belongs to a different TOC section.",
				cfiRange: "epubcfi(/6/10!/4/2)",
			},
			{
				id: "inside",
				chapterIndex: 4,
				chapterTitle: "Chapter 1",
				chapterHref: "OEBPS/chapter1.xhtml#target",
				text: "Scoped paragraph that should be sent to AI.",
				cfiRange: "epubcfi(/6/10!/4/4)",
			},
			{
				id: "outside-after",
				chapterIndex: 4,
				chapterTitle: "Chapter 1",
				chapterHref: "OEBPS/chapter1.xhtml#next",
				text: "Another unrelated section after the selected range.",
				cfiRange: "epubcfi(/6/10!/4/6)",
			},
		];

		const filtered = filterReaderParagraphsForAiReadingDraft(
			paragraphs,
			"Scoped paragraph that should be sent to AI.",
		);
		const blocks = buildEpubAiReadingSourceBlocksFromParagraphs(filtered);

		expect(filtered.map((paragraph) => paragraph.id)).toEqual(["inside"]);
		expect(blocks.map((block) => block.id)).toEqual(["段001"]);
		expect(blocks[0]?.text).toBe("Scoped paragraph that should be sent to AI.");
	});

	it("decorates model source markers with plugin-owned EPUB links", () => {
		const markdown =
			"## Important Excerpts\nThis sentence matters. [段001]\nUnknown marker. [段999]";
		const decorated = decorateEpubAiReadingSourceReferences(markdown, [
			{
				id: "段001",
				chapterHref: "chapter.xhtml",
				text: "Tell LaTeX that this is a section heading.",
				headingPath: ["Chapter 1"],
				kind: "paragraph",
				sourceLink: "[[Books/demo.epub#weave-cfi=epubcfi(/6/2)|段001]]",
			},
		]);

		expect(decorated).toContain(
			"[[Books/demo.epub#weave-cfi=epubcfi(/6/2)&flashStyle=pulse&flashColor=yellow|原文]]",
		);
		expect(decorated).toContain("Unknown marker. [段999]");
	});

	it("unwraps inline code that accidentally contains generated source links", () => {
		const decorated = decorateEpubAiReadingSourceReferences(
			"- `原文/位置：样式局部定义 {{source-range:U206.P003-U206.P005}}`\n- `普通代码不应被改动`",
			[
				{
					id: "U206.P003",
					chapterHref: "OEBPS/B21326_06.xhtml",
					cfi: "epubcfi(/6/20!/4/2,/1:0,/1:1)",
					text: "Style paragraph.",
					headingPath: ["第六章", "工作原理"],
					kind: "paragraph",
					sourceLink:
						"[[Book.epub#weave-cfi=epubcfi(/6/20!/4/2,/1:0,/1:1)&eid=ai-source-U206-P003|U206.P003]]",
				},
				{
					id: "U206.P004",
					chapterHref: "OEBPS/B21326_06.xhtml",
					cfi: "epubcfi(/6/20!/4/4,/1:0,/1:1)",
					text: "Middle paragraph.",
					headingPath: ["第六章", "工作原理"],
					kind: "paragraph",
					sourceLink:
						"[[Book.epub#weave-cfi=epubcfi(/6/20!/4/4,/1:0,/1:1)&eid=ai-source-U206-P004|U206.P004]]",
				},
				{
					id: "U206.P005",
					chapterHref: "OEBPS/B21326_06.xhtml",
					cfi: "epubcfi(/6/20!/4/6,/1:0,/1:1)",
					text: "End paragraph.",
					headingPath: ["第六章", "工作原理"],
					kind: "paragraph",
					sourceLink:
						"[[Book.epub#weave-cfi=epubcfi(/6/20!/4/6,/1:0,/1:1)&eid=ai-source-U206-P005|U206.P005]]",
				},
			],
		);

		expect(decorated).toContain("- 原文/位置：样式局部定义 [[Book.epub#weave-cfi=epubcfi");
		expect(decorated).toContain("rangeEndCfi=epubcfi");
		expect(decorated).toContain("rangeCfis=");
		expect(decorated).not.toContain("`原文/位置：");
		expect(decorated).toContain("- `普通代码不应被改动`");
	});

	it("decorates legacy P source markers with segment aliases", () => {
		const markdown = "Legacy model marker [P001]";
		const decorated = decorateEpubAiReadingSourceReferences(markdown, [
			{
				id: "段001",
				chapterHref: "chapter.xhtml",
				text: "Tell LaTeX that this is a section heading.",
				headingPath: ["Chapter 1"],
				kind: "paragraph",
				sourceLink: "[[Books/demo.epub#weave-cfi=epubcfi(/6/2)|段001]]",
			},
		]);

		expect(decorated).toContain(
			"[[Books/demo.epub#weave-cfi=epubcfi(/6/2)&flashStyle=pulse&flashColor=yellow|原文]]",
		);
		expect(decorated).not.toContain("[P001]");
	});

	it("decorates unit paragraph references while keeping legacy paragraph ids", () => {
		const blocks: EpubAiReadingSourceBlock[] = [
			{
				id: "U016.P001",
				chapterHref: "OEBPS/B21326_05.xhtml",
				headingPath: ["第五章：图像处理", "图像对齐", "操作指南"],
				text: "正文",
				kind: "paragraph",
				sourceLink: "[[Book.epub#u016p001|U016.P001]]",
			},
			{
				id: "段001",
				chapterHref: "OEBPS/B21326_05.xhtml",
				headingPath: ["旧段落"],
				text: "旧正文",
				kind: "paragraph",
				sourceLink: "[[Book.epub#old|段001]]",
			},
		];

		const decorated = decorateEpubAiReadingSourceReferences(
			"重点 [U016.P001]，旧引用 [段001]。",
			blocks,
		);

		expect(decorated).toContain("[[Book.epub#u016p001|原文]]");
		expect(decorated).toContain("[[Book.epub#old|原文]]");
		expect(decorated).not.toContain("|U016.P001]]");
		expect(decorated).not.toContain("|段001]]");
	});

	it("decorates bare unit paragraph references generated in prose", () => {
		const blocks: EpubAiReadingSourceBlock[] = [
			{
				id: "U208.P026",
				chapterHref: "OEBPS/B21326_06.xhtml",
				headingPath: ["Chapter 6", "Growing a tree"],
				text: "A later paragraph pulled into the source range.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#u208p026|U208.P026]]",
			},
			{
				id: "U208.P030",
				chapterHref: "OEBPS/B21326_06.xhtml",
				headingPath: ["Chapter 6", "Growing a tree"],
				text: "Another boundary paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#u208p030|U208.P030]]",
			},
			{
				id: "U208.P046",
				chapterHref: "OEBPS/B21326_06.xhtml",
				headingPath: ["Chapter 6", "Growing a tree"],
				text: "Final boundary paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#u208p046|U208.P046]]",
			},
		];

		const decorated = decorateEpubAiReadingSourceReferences(
			"Source anchors point to later paragraphs (U208.P026, U208.P030, U208.P046).",
			blocks,
		);

		expect(decorated).toContain("[[Book.epub#u208p026|原文]]");
		expect(decorated).toContain("[[Book.epub#u208p030|原文]]");
		expect(decorated).toContain("[[Book.epub#u208p046|原文]]");
		expect(decorated).not.toContain("|U208.P026]]");
		expect(decorated).not.toContain("|U208.P030]]");
		expect(decorated).not.toContain("|U208.P046]]");
		expect(decorated).not.toContain("(U208.P026, U208.P030, U208.P046)");
	});

	it("decorates shorthand unit paragraph ranges generated in prose", () => {
		const blocks: EpubAiReadingSourceBlock[] = [
			{
				id: "U143.P004",
				chapterHref: "OEBPS/B21326_04.xhtml",
				headingPath: ["Chapter 4", "Tables"],
				text: "Start paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:start&eid=ai-source-U143-P004|U143.P004]]",
			},
			{
				id: "U143.P005",
				chapterHref: "OEBPS/B21326_04.xhtml",
				headingPath: ["Chapter 4", "Tables"],
				text: "Middle paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:middle&eid=ai-source-U143-P005|U143.P005]]",
			},
			{
				id: "U143.P008",
				chapterHref: "OEBPS/B21326_04.xhtml",
				headingPath: ["Chapter 4", "Tables"],
				text: "End paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:end&eid=ai-source-U143-P008|U143.P008]]",
			},
		];

		const decorated = decorateEpubAiReadingSourceReferences(
			"Read U143.P004-P008 for the complete example.",
			blocks,
		);

		expect(decorated).toContain("|原文]]");
		expect(decorated).toContain("rangeEndCfi=readium%3Aend");
		expect(decorated).toContain("rangeCfis=readium%3Astart,readium%3Amiddle,readium%3Aend");
		expect(decorated).toContain("sourceTitle=");
		expect(decorated).not.toContain("|U143.P004]]");
		expect(decorated).not.toContain("|U143.P008]]");
		expect(decorated).not.toContain("]]-[[");
		expect(decorated).not.toContain("-P008");
	});

	it("decorates model source placeholders without exposing source ids", () => {
		const blocks: EpubAiReadingSourceBlock[] = [
			{
				id: "U143.P004",
				chapterHref: "OEBPS/B21326_04.xhtml",
				headingPath: ["Chapter 4", "Tables"],
				text: "Start paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:start&eid=ai-source-U143-P004|U143.P004]]",
			},
		];

		const decorated = decorateEpubAiReadingSourceReferences(
			"Key idea {{source:U143.P004}}.",
			blocks,
		);

		expect(decorated).toBe(
			"Key idea [[Book.epub#weave-cfi=readium:start&eid=ai-source-U143-P004&flashStyle=pulse&flashColor=yellow|原文]].",
		);
		expect(decorated).not.toContain("{{source:");
		expect(decorated).not.toContain("|U143.P004]]");
	});

	it("decorates model source range placeholders as one source button", () => {
		const blocks: EpubAiReadingSourceBlock[] = [
			{
				id: "U143.P004",
				chapterHref: "OEBPS/B21326_04.xhtml",
				headingPath: ["Chapter 4", "Tables"],
				text: "Start paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:start&eid=ai-source-U143-P004|U143.P004]]",
			},
			{
				id: "U143.P005",
				chapterHref: "OEBPS/B21326_04.xhtml",
				headingPath: ["Chapter 4", "Tables"],
				text: "Middle paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:middle&eid=ai-source-U143-P005|U143.P005]]",
			},
			{
				id: "U143.P008",
				chapterHref: "OEBPS/B21326_04.xhtml",
				headingPath: ["Chapter 4", "Tables"],
				text: "End paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:end&eid=ai-source-U143-P008|U143.P008]]",
			},
		];

		const decorated = decorateEpubAiReadingSourceReferences(
			"Whole example {{source-range:U143.P004-U143.P008}}.",
			blocks,
		);

		expect(decorated).toContain(
			"[[Book.epub#weave-cfi=readium:start&eid=ai-source-U143-P004&flashStyle=pulse&flashColor=yellow&rangeEndCfi=readium%3Aend&rangeCfis=readium%3Astart,readium%3Amiddle,readium%3Aend",
		);
		expect(decorated).toContain("|原文]].");
		expect(decorated.match(/\|原文\]\]/g)).toHaveLength(1);
		expect(decorated).not.toContain("{{source-range:");
		expect(decorated).not.toContain("|U143.P004]]");
		expect(decorated).not.toContain("|U143.P008]]");
	});

	it("collapses adjacent consecutive source placeholders into one range button", () => {
		const blocks: EpubAiReadingSourceBlock[] = [
			{
				id: "U191.P006",
				chapterHref: "OEBPS/B21326_05.xhtml",
				headingPath: ["Chapter 5", "Image alignment"],
				text: "First paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:p006&eid=ai-source-U191-P006|U191.P006]]",
			},
			{
				id: "U191.P007",
				chapterHref: "OEBPS/B21326_05.xhtml",
				headingPath: ["Chapter 5", "Image alignment"],
				text: "Second paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:p007&eid=ai-source-U191-P007|U191.P007]]",
			},
			{
				id: "U191.P008",
				chapterHref: "OEBPS/B21326_05.xhtml",
				headingPath: ["Chapter 5", "Image alignment"],
				text: "Third paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:p008&eid=ai-source-U191-P008|U191.P008]]",
			},
			{
				id: "U191.P009",
				chapterHref: "OEBPS/B21326_05.xhtml",
				headingPath: ["Chapter 5", "Image alignment"],
				text: "Fourth paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:p009&eid=ai-source-U191-P009|U191.P009]]",
			},
		];

		const decorated = decorateEpubAiReadingSourceReferences(
			"Noise from nearby headings ({{source:U191.P006}} {{source:U191.P007}} {{source:U191.P008}} {{source:U191.P009}}) should be one range.",
			blocks,
		);

		expect(decorated.match(/\|原文\]\]/g)).toHaveLength(1);
		expect(decorated).toContain("eid=ai-source-U191-P006");
		expect(decorated).toContain("rangeEndCfi=readium%3Ap009");
		expect(decorated).toContain(
			"rangeCfis=readium%3Ap006,readium%3Ap007,readium%3Ap008,readium%3Ap009",
		);
		expect(decorated).not.toContain("eid=ai-source-U191-P007|原文");
		expect(decorated).not.toContain("eid=ai-source-U191-P008|原文");
		expect(decorated).not.toContain("eid=ai-source-U191-P009|原文");
	});

	it("collapses bracketed source marker ranges generated by the model", () => {
		const blocks: EpubAiReadingSourceBlock[] = [
			{
				id: "U143.P004",
				chapterHref: "OEBPS/B21326_04.xhtml",
				headingPath: ["Chapter 4", "Tables"],
				text: "Start paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:start&eid=ai-source-U143-P004|U143.P004]]",
			},
			{
				id: "U143.P008",
				chapterHref: "OEBPS/B21326_04.xhtml",
				headingPath: ["Chapter 4", "Tables"],
				text: "End paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:end&eid=ai-source-U143-P008|U143.P008]]",
			},
		];

		const decorated = decorateEpubAiReadingSourceReferences(
			"Model cited [U143.P004]-[U143.P008] for the whole range.",
			blocks,
		);

		expect(decorated).toContain(
			"[[Book.epub#weave-cfi=readium:start&eid=ai-source-U143-P004&flashStyle=pulse&flashColor=yellow&rangeEndCfi=readium%3Aend&rangeCfis=readium%3Astart,readium%3Aend",
		);
		expect(decorated).toContain("|原文]] for the whole range.");
		expect(decorated).not.toContain("]]-[[" );
		expect(decorated.match(/\|原文\]\]/g)).toHaveLength(1);
	});

	it("decorates comma-separated shorthand paragraph ids after a unit reference", () => {
		const blocks: EpubAiReadingSourceBlock[] = [
			{
				id: "U149.P005",
				chapterHref: "OEBPS/B21326_04.xhtml",
				headingPath: ["Chapter 4", "Tables"],
				text: "First boundary paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:p005&eid=ai-source-U149-P005|U149.P005]]",
			},
			{
				id: "U149.P017",
				chapterHref: "OEBPS/B21326_04.xhtml",
				headingPath: ["Chapter 4", "Tables"],
				text: "Second boundary paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:p017&eid=ai-source-U149-P017|U149.P017]]",
			},
			{
				id: "U149.P024",
				chapterHref: "OEBPS/B21326_04.xhtml",
				headingPath: ["Chapter 4", "Tables"],
				text: "Final boundary paragraph.",
				kind: "paragraph",
				sourceLink: "[[Book.epub#weave-cfi=readium:p024&eid=ai-source-U149-P024|U149.P024]]",
			},
		];

		const decorated = decorateEpubAiReadingSourceReferences(
			"Noise appears in U149.P005, P017-P024.",
			blocks,
		);

		expect(decorated).toContain("[[Book.epub#weave-cfi=readium:p005&eid=ai-source-U149-P005&flashStyle=pulse&flashColor=yellow|原文]]");
		expect(decorated).toContain("|原文]]");
		expect(decorated).toContain("rangeEndCfi=");
		expect(decorated).not.toContain("|U149.P005]]");
		expect(decorated).not.toContain("|U149.P017]]");
		expect(decorated).not.toContain("|U149.P024]]");
		expect(decorated).not.toContain("P017-P024");
	});

	it("decorates legacy note bare source references with exact existing links", () => {
		const markdown = [
			"See [[Book.epub#weave-cfi=readium:exact&eid=ai-source-U208-P026|原文]].",
			"Boundary paragraph U208.P026 should be clickable.",
		].join("\n");

		const decorated = decorateEpubAiReadingLegacyNoteBareSourceReferences(markdown);

		expect(decorated).toContain(
			"Boundary paragraph [[Book.epub#weave-cfi=readium:exact&eid=ai-source-U208-P026&flashStyle=pulse&flashColor=yellow|原文]] should be clickable.",
		);
	});

	it("adds pulse flash metadata to existing AI source links", () => {
		const markdown = [
			"See [[Book.epub#weave-cfi=readium:exact&eid=ai-source-U208-P026|U208.P026]].",
			"Static [[Book.epub#weave-cfi=readium:kept&eid=ai-source-U208-P027&flashStyle=highlight&flashColor=yellow|U208.P027]].",
		].join("\n");

		const decorated = decorateEpubAiReadingLegacyNoteBareSourceReferences(markdown);

		expect(decorated).toContain(
			"[[Book.epub#weave-cfi=readium:exact&eid=ai-source-U208-P026&flashStyle=pulse&flashColor=yellow|原文]]",
		);
		expect(decorated).toContain(
			"[[Book.epub#weave-cfi=readium:kept&eid=ai-source-U208-P027&flashStyle=pulse&flashColor=yellow|原文]]",
		);
	});

	it("decorates legacy note bare source references with the range source link when exact links are unavailable", () => {
		const markdown = [
			"> 原文：[[Book.epub#weave-cfi=readium:scope|打开原文]]",
			"Boundary paragraphs U208.P026 and U208.P030 should still navigate.",
		].join("\n");

		const decorated = decorateEpubAiReadingLegacyNoteBareSourceReferences(markdown);

		expect(decorated).toContain(
			"[[Book.epub#weave-cfi=readium:scope&flashStyle=pulse&flashColor=yellow|原文]]",
		);
		expect(decorated).toContain(
			"[[Book.epub#weave-cfi=readium:scope&flashStyle=pulse&flashColor=yellow|原文]]",
		);
	});

	it("decorates legacy note shorthand source ranges with exact existing links", () => {
		const markdown = [
			"Exact end [[Book.epub#weave-cfi=readium:end&eid=ai-source-U143-P008|U143.P008]].",
			"Use [[Book.epub#weave-cfi=readium:start&eid=ai-source-U143-P004|U143.P004]]-P008.",
		].join("\n");

		const decorated = decorateEpubAiReadingLegacyNoteBareSourceReferences(markdown);

		expect(decorated).toContain(
			"[[Book.epub#weave-cfi=readium:start&eid=ai-source-U143-P004&flashStyle=pulse&flashColor=yellow&rangeEndCfi=readium%3Aend&rangeCfis=readium%3Astart,readium%3Aend",
		);
		expect(decorated).toContain("|原文]]");
		expect(decorated).not.toContain("]]-[[");
		expect(decorated).not.toContain("|U143.P004]]-P008");
	});

	it("collapses legacy note source ranges already stored as two links", () => {
		const markdown = [
			"Use [[Book.epub#weave-cfi=readium:start&eid=ai-source-U143-P004|鍘熸枃]]-[[Book.epub#weave-cfi=readium:end&eid=ai-source-U143-P008|鍘熸枃]] for the range.",
		].join("\n");

		const decorated = decorateEpubAiReadingLegacyNoteBareSourceReferences(markdown);

		expect(decorated).toContain(
			"[[Book.epub#weave-cfi=readium:start&eid=ai-source-U143-P004&flashStyle=pulse&flashColor=yellow&rangeEndCfi=readium%3Aend&rangeCfis=readium%3Astart,readium%3Aend",
		);
		expect(decorated).toContain("|原文]] for the range.");
		expect(decorated).not.toContain("]]-[[" );
		expect(decorated.match(/\|原文\]\]/g)).toHaveLength(1);
	});

	it("reuses legacy unit-alias links without exact source ids for shorthand ranges", () => {
		const markdown = [
			"Known fallback [[Book.epub#weave-cfi=readium:fallback|U160.P005]].",
			"Use [[Book.epub#weave-cfi=readium:start&eid=ai-source-U160-P001|U160.P001]]-P005.",
		].join("\n");

		const decorated = decorateEpubAiReadingLegacyNoteBareSourceReferences(markdown);

		expect(decorated).toContain(
			"[[Book.epub#weave-cfi=readium:start&eid=ai-source-U160-P001&flashStyle=pulse&flashColor=yellow&rangeEndCfi=readium%3Afallback&rangeCfis=readium%3Astart,readium%3Afallback",
		);
		expect(decorated).toContain("|原文]]");
		expect(decorated).not.toContain("]]-[[");
	});

	it("enriches legacy source-title range links with range CFIs", () => {
		const markdown = [
			"Exact middle [[Book.epub#weave-cfi=readium:middle&eid=ai-source-U191-P007|U191.P007]].",
			"Exact end [[Book.epub#weave-cfi=readium:end&eid=ai-source-U191-P008|U191.P008]].",
			"Range [[Book.epub#weave-cfi=readium:start&eid=ai-source-U191-P006&flashStyle=pulse&flashColor=yellow&sourceTitle=%E5%8E%9F%E6%96%87%E8%8C%83%E5%9B%B4%EF%BC%9AU191.P006-U191.P008|原文]].",
		].join("\n");

		const decorated = decorateEpubAiReadingLegacyNoteBareSourceReferences(markdown);

		expect(decorated).toContain("eid=ai-source-U191-P006");
		expect(decorated).toContain("rangeEndCfi=readium%3Aend");
		expect(decorated).toContain(
			"rangeCfis=readium%3Astart,readium%3Amiddle,readium%3Aend",
		);
		expect(decorated).toContain("|原文]].");
	});

	it("enriches filtered legacy source-title ranges from full-note source links", () => {
		const fullNoteMarkdown = [
			"Exact end [[Book.epub#weave-cfi=readium:end&eid=ai-source-U191-P010|U191.P010]].",
		].join("\n");
		const filteredMarkdown =
			"Range [[Book.epub#weave-cfi=readium:start&eid=ai-source-U191-P009&flashStyle=pulse&flashColor=yellow&sourceTitle=%E5%8E%9F%E6%96%87%E8%8C%83%E5%9B%B4%EF%BC%9AU191.P009-U191.P010|鍘熸枃]].";

		const decorated = decorateEpubAiReadingLegacyNoteBareSourceReferences(
			filteredMarkdown,
			fullNoteMarkdown,
		);

		expect(decorated).toContain("eid=ai-source-U191-P009");
		expect(decorated).toContain("rangeEndCfi=readium%3Aend");
		expect(decorated).toContain("rangeCfis=readium%3Astart,readium%3Aend");
		expect(decorated).toContain("|原文]].");
	});

	it("enriches filtered source-title ranges from hidden source maps", () => {
		const sourceMap = {
			version: 1,
			filePath: "Book.epub",
			blocks: [
				{
					id: "U192.P002",
					chapterHref: "text/ch5.xhtml",
					cfi: "readium:p002",
					sourceLink:
						"[[Book.epub#weave-loc=opaque-loc-p002&eid=ai-source-U192-P002|U192.P002]]",
					kind: "paragraph",
					headingPath: ["Chapter 5", "Image alignment", "How it works"],
				},
				{
					id: "U192.P003",
					chapterHref: "text/ch5.xhtml",
					cfi: "readium:p003",
					sourceLink:
						"[[Book.epub#weave-loc=opaque-loc-p003&eid=ai-source-U192-P003|U192.P003]]",
					kind: "paragraph",
					headingPath: ["Chapter 5", "Image alignment", "How it works"],
				},
			],
			units: [],
		};
		const fullNoteMarkdown = `<!-- weave-epub-ai-reading-source-map:${encodeURIComponent(
			JSON.stringify(sourceMap),
		)} -->`;
		const filteredMarkdown =
			"Range [[Book.epub#weave-loc=opaque-loc-p002&eid=ai-source-U192-P002&flashStyle=pulse&flashColor=yellow&sourceTitle=%E5%8E%9F%E6%96%87%E8%8C%83%E5%9B%B4%EF%BC%9AU192.P002-U192.P003|鍘熸枃]].";

		const decorated = decorateEpubAiReadingLegacyNoteBareSourceReferences(
			filteredMarkdown,
			fullNoteMarkdown,
		);

		expect(decorated).toContain("eid=ai-source-U192-P002");
		expect(decorated).toContain("rangeEndCfi=readium%3Ap003");
		expect(decorated).toContain("rangeCfis=readium%3Ap002,readium%3Ap003");
		expect(decorated).toContain("|原文]].");
	});

	it("collapses adjacent consecutive source buttons in legacy notes", () => {
		const markdown = [
			"Noise ([[Book.epub#weave-cfi=readium:p006&eid=ai-source-U191-P006|原文]] [[Book.epub#weave-cfi=readium:p007&eid=ai-source-U191-P007|原文]] [[Book.epub#weave-cfi=readium:p008&eid=ai-source-U191-P008|原文]] [[Book.epub#weave-cfi=readium:p009&eid=ai-source-U191-P009|原文]]) should be a range.",
		].join("\n");

		const decorated = decorateEpubAiReadingLegacyNoteBareSourceReferences(markdown);

		expect(decorated.match(/\|原文\]\]/g)).toHaveLength(1);
		expect(decorated).toContain("eid=ai-source-U191-P006");
		expect(decorated).toContain("rangeEndCfi=readium%3Ap009");
		expect(decorated).toContain(
			"rangeCfis=readium%3Ap006,readium%3Ap007,readium%3Ap008,readium%3Ap009",
		);
	});

	it("formats reader-facing source labels and hover titles", () => {
		expect(formatEpubAiReadingSourceReferenceLabel("U016.P003")).toBe("原文");
		expect(formatEpubAiReadingSourceReferenceLabel("段012")).toBe("原文");
		expect(
			formatEpubAiReadingSourceReferenceTitle({
				id: "U016.P003",
				headingPath: ["第六章", "图像处理", "原理"],
			}),
		).toBe("第六章，图像处理，原理，第 3 段");
	});

	it("keeps only two source markers per generated line", () => {
		const markdown = [
			"- First claim [段001] [段002] [段003]",
			"- Second claim [段004]",
		].join("\n");

		const limited = limitEpubAiReadingSourceReferencesPerLine(markdown);

		expect(limited).toContain("- First claim [段001] [段002]");
		expect(limited).not.toContain("[段003]");
		expect(limited).toContain("- Second claim [段004]");
	});
});
