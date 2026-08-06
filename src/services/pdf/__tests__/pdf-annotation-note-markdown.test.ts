import { describe, expect, it } from "vitest";
import type { PdfTextAnnotation } from "../pdf-ink-annotation-store";
import { renderPdfAnnotationNoteMarkdown } from "../pdf-annotation-note-markdown";

function annotation(input: Partial<PdfTextAnnotation> & Pick<PdfTextAnnotation, "id" | "pageNumber" | "text">): PdfTextAnnotation {
	return {
		kind: "highlight",
		color: "#ffd54a",
		rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.04 }],
		createdAt: 1,
		...input,
	};
}

describe("pdf-annotation-note-markdown", () => {
	it("renders PDF text annotations grouped and sorted by page position", () => {
		const markdown = renderPdfAnnotationNoteMarkdown({
			bookId: "pdf-book-test",
			book: {
				title: "Report",
				filePath: "Books/report.pdf",
				pageCount: 3,
				currentPage: 2,
			},
			now: new Date("2026-07-30T10:20:30+08:00"),
			annotations: [
				annotation({
					id: "page-2",
					pageNumber: 2,
					text: "second page",
					rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.04 }],
					createdAt: 3,
				}),
				annotation({
					id: "page-1-late",
					pageNumber: 1,
					kind: "underline",
					text: "later on page one",
					semanticId: "definition",
					semanticLabel: "Definition",
					rects: [{ x: 0.5, y: 0.2, width: 0.2, height: 0.04 }],
					createdAt: 2,
				}),
				annotation({
					id: "page-1-first",
					pageNumber: 1,
					text: "first on page one",
					note: "my note",
					semanticId: "quote",
					semanticLabel: "Quote",
					rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.04 }],
					createdAt: 1,
				}),
			],
		});

		expect(markdown).toContain("# Report - PDF \u6807\u6ce8\u7b14\u8bb0");
		expect(markdown).toContain("class=\"weave-annotation-note-root weave-pdf-annotation-note-root\"");
		expect(markdown).toContain("class=\"weave-annotation-note-line weave-pdf-annotation-note-line\"");
		expect(markdown).toContain("\u53ea\u8bfb\u6d3e\u751f\u6587\u4ef6");
		expect(markdown).toContain("`annotations.json`");
		expect(markdown).toContain("- \u6570\u636e ID: `pdf-book-test`");
		expect(markdown).toContain("- PDF: `Books/report.pdf`");
		expect(markdown).toContain("- \u9875\u6570: 3");
		expect(markdown).toContain('data-current-page="2"');
		expect(markdown).toContain("class=\"weave-annotation-note-dual-window\"");
		expect(markdown).toContain('data-weave-dual-window-action="open"');
		expect(markdown).toContain('data-book-id="pdf-book-test"');
		expect(markdown).toContain('data-source-file="Books/report.pdf"');
		expect(markdown).toContain('data-dual-window-mode="false"');
		expect(markdown).toContain('class="weave-annotation-note-chapter weave-pdf-annotation-note-page"');
		expect(markdown).toContain('data-chapter-key="page-1"');
		expect(markdown).toContain('data-chapter-title="\u7b2c 1 \u9875"');
		expect(markdown).toContain('data-page-number="2"');
		expect(markdown).toContain('data-annotation-id="page-1-first"');
		expect(markdown).toContain('data-page-number="1"');
		expect(markdown).toContain('data-chapter-key="page-1"');
		expect(markdown).toContain('data-chapter-title="\u7b2c 1 \u9875"');
		expect(markdown).toContain('data-semantic-id="quote"');
		expect(markdown).toContain('data-semantic-label="Quote"');
		expect(markdown).toContain('data-annotation-text="first on page one"');
		expect(markdown).toContain("\u5907\u6ce8: my note");
		expect(markdown.indexOf("page-1-first")).toBeLessThan(markdown.indexOf("page-1-late"));
		expect(markdown.indexOf("page-1-late")).toBeLessThan(markdown.indexOf("page-2"));
		expect(markdown).toMatch(/<mark[^>]*>first on page one<\/mark>/);
		expect(markdown).toContain("text-decoration-line: underline");
		expect(markdown.endsWith("\n")).toBe(true);
	});

	it("hides the dual-window button when rendered for PDF dual-window mode", () => {
		const markdown = renderPdfAnnotationNoteMarkdown({
			bookId: "pdf-book-test",
			book: {
				title: "Report",
				filePath: "Books/report.pdf",
				pageCount: 3,
			},
			dualWindowMode: true,
			annotations: [
				annotation({
					id: "page-1-first",
					pageNumber: 1,
					text: "first on page one",
				}),
			],
		});

		expect(markdown).toContain('data-dual-window-mode="true"');
		expect(markdown).not.toContain("weave-annotation-note-dual-window");
		expect(markdown).toContain('data-page-number="1"');
	});

	it("renders an empty read-only PDF annotation note when no text annotations exist", () => {
		const markdown = renderPdfAnnotationNoteMarkdown({
			bookId: "pdf-book-empty",
			book: {
				title: "Empty PDF",
				filePath: "Books/empty.pdf",
				pageCount: 0,
			},
			annotations: [],
		});

		expect(markdown).toContain("# Empty PDF - PDF \u6807\u6ce8\u7b14\u8bb0");
		expect(markdown).toContain("> \u6682\u65e0 PDF \u6587\u672c\u6807\u6ce8\u3002");
		expect(markdown).toContain('data-page-count="0"');
	});
});
