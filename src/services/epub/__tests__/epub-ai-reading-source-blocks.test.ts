import { describe, expect, it } from "vitest";
import type { ReaderParagraph } from "../reader-engine-types";
import {
	buildEpubAiReadingSourceBlocksFromParagraphs,
	decorateEpubAiReadingSourceReferences,
	filterReaderParagraphsForAiReadingDraft,
	formatEpubAiReadingSourceBlocksForPrompt,
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
			"[[Books/demo.epub#weave-cfi=epubcfi(/6/2)|段001]]",
		);
		expect(decorated).toContain("Unknown marker. [段999]");
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
			"[[Books/demo.epub#weave-cfi=epubcfi(/6/2)|段001]]",
		);
		expect(decorated).not.toContain("[P001]");
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
