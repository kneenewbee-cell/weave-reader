import {
	applyChapterHighlightsToMarkdown,
	applyChapterHighlightsToMarkdownAsync,
	applyChapterMarkedSpans,
	buildChapterMarkedFootnotesBlock,
	findFlexibleTextRangeInMarkdown,
	formatObsidianFootnoteDefinition,
	highlightBelongsToChapterExport,
	resolveChapterMarkedSpans,
	shouldIncludeHighlightInChapterMarkedExport,
	wrapChapterMarkedHighlightText,
} from "../chapter-marked-markdown-export";
import type { ReaderHighlight } from "../reader-engine-types";

function createHighlight(
	partial: Partial<ReaderHighlight> & Pick<ReaderHighlight, "text">
): ReaderHighlight {
	return {
		cfiRange: "epubcfi(/6/4!/10/2/1:0)",
		color: "yellow",
		...partial,
	};
}

describe("chapter-marked-markdown-export", () => {
	it("skips concealed and empty highlights", () => {
		expect(
			shouldIncludeHighlightInChapterMarkedExport(
				createHighlight({ text: "hello", presentation: "conceal" })
			)
		).toBe(false);
		expect(shouldIncludeHighlightInChapterMarkedExport(createHighlight({ text: "   " }))).toBe(
			false
		);
	});

	it("wraps highlight styles with markdown and html", () => {
		expect(
			wrapChapterMarkedHighlightText("alpha", createHighlight({ text: "alpha", color: "green" }))
		).toContain('background-color: rgba(34, 197, 94, 0.28)');
		expect(
			wrapChapterMarkedHighlightText(
				"beta",
				createHighlight({ text: "beta", style: "strikethrough" })
			)
		).toBe("~~beta~~");
		expect(
			wrapChapterMarkedHighlightText(
				"gamma",
				createHighlight({ text: "gamma", style: "underline" })
			)
		).toBe("<u>gamma</u>");
		expect(
			wrapChapterMarkedHighlightText("delta", createHighlight({ text: "delta", style: "wavy" }))
		).toContain("text-decoration: underline wavy");
	});

	it("finds flexible whitespace matches in markdown", () => {
		const markdown = "## Heading\n\nFirst paragraph with **bold** text.";
		const range = findFlexibleTextRangeInMarkdown(markdown, "paragraph with bold text");
		expect(range?.start).toBe(markdown.indexOf("paragraph"));
		expect(markdown.slice(range?.start, range?.end)).toContain("paragraph with");
		expect(markdown.slice(range?.start, range?.end)).toContain("bold");
	});

	it("applies inline marks and obsidian footnotes at document end", () => {
		const markdown = "Alpha beta gamma.";
		const highlights = [
			createHighlight({
				text: "Alpha",
				color: "yellow",
				commentText: "First note",
				createdTime: 1,
			}),
			createHighlight({
				text: "gamma",
				color: "blue",
				style: "underline",
				commentText: "Second note",
				createdTime: 2,
			}),
		];

		const result = applyChapterHighlightsToMarkdown(markdown, highlights);

		expect(result.markdown).toContain('<mark style="background-color: rgba(250, 204, 21, 0.36);">Alpha</mark>[^1]');
		expect(result.markdown).toContain("<u>gamma</u>[^2]");
		expect(result.footnotesMarkdown).toBe("[^1]: First note\n[^2]: Second note");
	});

	it("formats multiline footnotes using obsidian continuation indentation", () => {
		expect(formatObsidianFootnoteDefinition(1, "Line one\nLine two")).toBe(
			"[^1]: Line one\n    Line two"
		);
	});

	it("escapes html characters inside marked highlight wrappers", () => {
		expect(
			wrapChapterMarkedHighlightText("<tag>", createHighlight({ text: "<tag>", color: "yellow" }))
		).toBe('<mark style="background-color: rgba(250, 204, 21, 0.36);">&lt;tag&gt;</mark>');
	});

	it("numbers footnotes by document order rather than creation time", () => {
		const markdown = "Start middle end.";
		const spans = resolveChapterMarkedSpans(markdown, [
			createHighlight({ text: "end", commentText: "Later in text", createdTime: 1 }),
			createHighlight({ text: "Start", commentText: "Earlier in text", createdTime: 2 }),
		]);

		expect(buildChapterMarkedFootnotesBlock(spans)).toBe(
			"[^1]: Earlier in text\n[^2]: Later in text"
		);
		expect(applyChapterMarkedSpans(markdown, spans)).toContain("</mark>[^1] middle");
		expect(applyChapterMarkedSpans(markdown, spans)).toContain("end</mark>[^2]");
	});

	it("matches highlights via plain text fallback when markdown formatting differs", async () => {
		const plainText = "Intro paragraph with bold text.";
		const markdown = "## Heading\n\nIntro paragraph with **bold** text.";
		const result = await applyChapterHighlightsToMarkdownAsync(
			markdown,
			[createHighlight({ text: "bold text", color: "green" })],
			{ plainText }
		);

		expect(result.markdown).toContain('<mark style="background-color: rgba(34, 197, 94, 0.28);">');
		expect(result.markdown).toContain("bold");
	});

	it("matches highlights using resolved range text from cfi", async () => {
		const markdown = "Alpha beta gamma.";
		const result = await applyChapterHighlightsToMarkdownAsync(
			markdown,
			[createHighlight({ text: "missing", color: "yellow" })],
			{
				resolveRangeText: async () => "beta",
			}
		);

		expect(result.markdown).toContain('<mark style="background-color: rgba(250, 204, 21, 0.36);">beta</mark>');
	});

	it("accepts chapter highlights resolved by cfi section index", () => {
		expect(
			highlightBelongsToChapterExport(
				createHighlight({ text: "sample", chapterIndex: undefined }),
				3,
				"Text/chapter4.xhtml",
				{
					getSectionIndexForCfi: () => 3,
				}
			)
		).toBe(true);
	});

	it("matches chapter hrefs without comparing toc fragments", () => {
		expect(
			highlightBelongsToChapterExport(
				createHighlight({ text: "sample", chapterIndex: undefined }),
				3,
				"Text/chapter4.xhtml#section-c",
				{
					getSectionHrefForCfi: () => "Text/chapter4.xhtml",
				}
			)
		).toBe(true);
	});
});
