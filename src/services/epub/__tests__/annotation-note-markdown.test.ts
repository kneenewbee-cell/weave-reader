import { describe, expect, it } from "vitest";
import { renderEpubAnnotationNoteMarkdown } from "../annotation-note-markdown";

describe("annotation-note-markdown", () => {
	it("renders annotated snippets grouped by stored chapter metadata", () => {
		const markdown = renderEpubAnnotationNoteMarkdown({
			book: {
				title: "LaTeX Beginner",
				author: "Stefan Kottwitz",
				filePath: "Books/latex.epub",
				sourceId: "epubsrc-latex",
				currentCfi: "epubcfi(/6/4!/4/2)",
				currentChapterIndex: 0,
			},
			bookId: "epub-book-latex",
			annotations: [
				{
					id: "later",
					cfiRange: "epubcfi(/6/8!/4/2,/1:0,/1:3)",
					text: "mistake text",
					semanticId: "mistake",
					chapterIndex: 1,
					chapterTitle: "Chapter 2",
					chapterRootTitle: "Chapter 2",
					chapterPath: ["Chapter 2"],
					chapterHref: "Text/chapter2.xhtml",
					spineIndex: 2,
					createdTime: 30,
				},
				{
					id: "first",
					cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:3)",
					text: "theorem text",
					semanticId: "theorem",
					chapterIndex: 0,
					chapterTitle: "Leaf",
					chapterRootTitle: "Chapter 1",
					chapterPath: ["Chapter 1", "Leaf"],
					chapterHref: "Text/chapter1.xhtml#leaf",
					spineIndex: 1,
					createdTime: 20,
				},
				{
					id: "mask",
					cfiRange: "epubcfi(/6/2!/4/4,/1:0,/1:3)",
					text: "masked text",
					color: "orange",
					style: "strikethrough",
					chapterIndex: 0,
					chapterTitle: "Leaf",
					chapterRootTitle: "Chapter 1",
					chapterPath: ["Chapter 1", "Leaf"],
					chapterHref: "Text/chapter1.xhtml#leaf",
					spineIndex: 1,
					createdTime: 10,
				},
			],
			semanticProfile: {
				semantics: [
					{ id: "theorem", label: "Theorem", color: "yellow", style: "highlight" },
					{ id: "mistake", label: "Mistake", color: "red", style: "wavy" },
				],
			},
		});

		expect(markdown).toContain("# LaTeX Beginner - \u6807\u6ce8\u7b14\u8bb0");
		expect(markdown).toContain("cfi=epubcfi(/6/4!/4/2)");
		expect(markdown).toContain("flashStyle=pulse");
		expect(markdown).toContain("showLocateOverlay=true");
		expect(markdown).toContain("class=\"weave-annotation-note-root\"");
		expect(markdown).toContain("class=\"weave-annotation-note-line\"");
		expect(markdown).toContain('data-chapter-key="chapter-0"');
		expect(markdown).toContain('data-chapter-title="Chapter 1"');
		expect(markdown).not.toContain('data-chapter-title="Chapter 1 / Leaf"');
		expect(markdown).toContain('data-semantic-id="theorem"');
		expect(markdown).toContain('data-semantic-label="Theorem"');
		expect(markdown).toContain('data-annotation-text="theorem text"');
		expect(markdown.indexOf("Chapter 1")).toBeLessThan(markdown.indexOf("Chapter 2"));
		expect(markdown.indexOf("theorem text")).toBeLessThan(markdown.indexOf("masked text"));
		expect(markdown).toContain("<mark");
		expect(markdown).toContain("rgba(255, 224, 102, 0.62)");
		expect(markdown).toContain("text-decoration-style: wavy");
		expect(markdown).toContain("repeating-linear-gradient(135deg, rgba(180, 83, 9, 0.34)");
		expect(markdown).toContain('data-semantic="Theorem"');
		expect(markdown).toContain("obsidian://weave-epub?file=Books%2Flatex.epub&amp;cfi=epubcfi");
	});

	it("renders an empty read-only note when no annotations exist", () => {
		const markdown = renderEpubAnnotationNoteMarkdown({
			book: {
				title: "Empty book",
				filePath: "Books/empty.epub",
			},
			bookId: "epub-book-empty",
			annotations: [],
			semanticProfile: null,
		});

		expect(markdown).toContain("# Empty book - \u6807\u6ce8\u7b14\u8bb0");
		expect(markdown).toContain("> \u6682\u65e0\u6807\u6ce8\u3002");
		expect(markdown).toContain("\u53ea\u8bfb\u6d3e\u751f\u6587\u4ef6");
	});

	it("does not borrow chapter metadata from nearby annotations in the same CFI section", () => {
		const markdown = renderEpubAnnotationNoteMarkdown({
			book: {
				title: "LaTeX Beginner",
				filePath: "Books/latex.epub",
			},
			bookId: "epub-book-latex",
			annotations: [
				{
					id: "with-chapter",
					cfiRange: "epubcfi(/6/8!/4/2,/1:0,/1:8)",
					text: "target reader text",
					semanticId: "theorem",
					chapterTitle: "Target Reader",
					chapterPath: ["Preface", "Target Reader"],
					chapterHref: "preface.xhtml#target-reader",
					spineIndex: 3,
					createdTime: 10,
				},
				{
					id: "old-without-chapter",
					cfiRange: "epubcfi(/6/8!/4/4,/1:0,/1:8)",
					text: "old missing chapter",
					semanticId: "example",
					createdTime: 20,
				},
			],
			semanticProfile: null,
		});

		expect(markdown).toContain("old missing chapter");
		expect(markdown).toContain("\u672a\u5b9a\u4f4d\u7ae0\u8282");
		expect(markdown.match(/Preface/g)?.length).toBeGreaterThanOrEqual(2);
		expect(markdown).not.toContain("Preface / Target Reader");
	});

	it("does not cross-match duplicate titles because the renderer no longer reads TOC", () => {
		const markdown = renderEpubAnnotationNoteMarkdown({
			book: {
				title: "LaTeX Beginner",
				filePath: "Books/latex.epub",
			},
			bookId: "epub-book-latex",
			annotations: [
				{
					id: "frontmatter",
					cfiRange: "epubcfi(/6/4!/4[B17260_FM_ePub_RK]/2,/1:0,/1:20)",
					text: "copyright text",
					semanticId: "related-work",
					chapterTitle: "LaTeX Guide",
					createdTime: 10,
				},
				{
					id: "chapter-1-title",
					cfiRange: "epubcfi(/6/10!/4[B17260_01_ePub_RK]/2/2,/1:0,/1:8)",
					text: "chapter text",
					semanticId: "method",
					chapterTitle: "LaTeX Guide",
					chapterPath: ["Chapter 1", "What is LaTeX?", "LaTeX Guide"],
					chapterHref: "Text/B17260_01_ePub_RK.xhtml#intro",
					spineIndex: 4,
					createdTime: 30,
				},
			],
			semanticProfile: null,
		});

		expect(markdown).toContain('data-annotation-id="frontmatter" data-chapter-key="title-LaTeX Guide"');
		expect(markdown).toContain('data-annotation-id="chapter-1-title" data-chapter-key="title-Chapter 1"');
		expect(markdown.indexOf("copyright text")).toBeLessThan(markdown.indexOf("chapter text"));
		expect(markdown).toContain("Chapter 1");
		expect(markdown).not.toContain("Chapter 1 / What is LaTeX? / LaTeX Guide");
	});

	it("sorts by stored spine index before CFI structure", () => {
		const markdown = renderEpubAnnotationNoteMarkdown({
			book: {
				title: "Sort book",
				filePath: "Books/sort.epub",
			},
			bookId: "epub-book-sort",
			annotations: [
				{
					id: "later-spine",
					cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:3)",
					text: "later spine",
					chapterPath: ["B"],
					spineIndex: 2,
				},
				{
					id: "earlier-spine",
					cfiRange: "epubcfi(/6/10!/4/2,/1:0,/1:3)",
					text: "earlier spine",
					chapterPath: ["A"],
					spineIndex: 1,
				},
			],
			semanticProfile: null,
		});

		expect(markdown.indexOf("earlier spine")).toBeLessThan(markdown.indexOf("later spine"));
	});
});
