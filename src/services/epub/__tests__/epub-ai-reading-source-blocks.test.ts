import { describe, expect, it } from "vitest";
import type { ReaderParagraph } from "../reader-engine-types";
import {
	buildEpubAiReadingSourceBlocksFromParagraphs,
	decorateEpubAiReadingSourceReferences,
	formatEpubAiReadingSourceBlocksForPrompt,
	type EpubAiReadingSourceBlock,
} from "../epub-ai-reading-source-blocks";

describe("epub-ai-reading-source-blocks", () => {
	it("creates ordered P001 source blocks from reader paragraphs", () => {
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
				id: "P001",
				readerParagraphId: "reader-p1",
				chapterIndex: 4,
				headingPath: ["Chapter 1"],
				kind: "paragraph",
				text: "LaTeX is a document markup language.",
				sourceLink:
					"[[Books/demo.epub#weave-cfi=epubcfi(/6/10!/4/2,/1:0,/1:14)|P001]]",
			}),
			expect.objectContaining({
				id: "P002",
				readerParagraphId: "reader-p3",
				kind: "list",
				text: "Overleaf supports online collaboration.",
				sourceLink:
					"[[Books/demo.epub#weave-cfi=epubcfi(/6/10!/4/6,/1:0,/1:12)|P002]]",
			}),
		]);
	});

	it("formats source blocks for the model prompt", () => {
		const blocks: EpubAiReadingSourceBlock[] = [
			{
				id: "P001",
				chapterHref: "chapter.xhtml",
				cfi: "epubcfi(/6/2)",
				headingPath: ["Chapter 1", "Content and form"],
				text: "Tell LaTeX that this is a section heading.",
				kind: "paragraph",
				sourceLink: "[[Books/demo.epub#weave-cfi=epubcfi(/6/2)|P001]]",
			},
		];

		const prompt = formatEpubAiReadingSourceBlocksForPrompt(blocks);

		expect(prompt).toContain("[P001] kind=paragraph path=Chapter 1 > Content and form");
		expect(prompt).toContain("href=chapter.xhtml cfi=epubcfi(/6/2)");
		expect(prompt).toContain("Tell LaTeX that this is a section heading.");
	});

	it("decorates model source markers with plugin-owned EPUB links", () => {
		const markdown = "## Important Excerpts\nThis sentence matters. [P001]\nUnknown marker. [P999]";
		const decorated = decorateEpubAiReadingSourceReferences(markdown, [
			{
				id: "P001",
				chapterHref: "chapter.xhtml",
				text: "Tell LaTeX that this is a section heading.",
				headingPath: ["Chapter 1"],
				kind: "paragraph",
				sourceLink: "[[Books/demo.epub#weave-cfi=epubcfi(/6/2)|P001]]",
			},
		]);

		expect(decorated).toContain("[[Books/demo.epub#weave-cfi=epubcfi(/6/2)|P001]]");
		expect(decorated).toContain("Unknown marker. [P999]");
	});
});
