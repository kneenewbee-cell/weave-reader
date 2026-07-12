import { describe, expect, it } from "vitest";
import { getBuiltinBookNotesExportTemplate } from "../book-notes-export/builtin-templates";
import { buildBookNotesExportLabelsFromTranslator } from "../book-notes-export/export-labels";
import { buildBookNotesExportContext } from "../book-notes-export/export-context";
import { replaceBookNotesExportSection, wrapBookNotesExportSection } from "../book-notes-export/marker-append";
import { formatBookNotesPrintPageLabel } from "../book-notes-export/page-label";
import { renderBookNotesTemplate } from "../book-notes-export/template-renderer";

describe("book-notes-export marker append", () => {
	it("wraps rendered body with stable markers", () => {
		expect(wrapBookNotesExportSection("## Notes\n\n- one")).toContain(
			"<!-- weave-epub-excerpts:start -->"
		);
		expect(wrapBookNotesExportSection("## Notes\n\n- one")).toContain(
			"<!-- weave-epub-excerpts:end -->"
		);
	});

	it("replaces an existing marker section on re-export", () => {
		const existing = [
			"# Douban page",
			"",
			"Some metadata",
			"",
			"<!-- weave-epub-excerpts:start -->",
			"## Old notes",
			"<!-- weave-epub-excerpts:end -->",
		].join("\n");

		const next = replaceBookNotesExportSection(existing, "## New notes\n\n- fresh");
		expect(next).toContain("# Douban page");
		expect(next).toContain("Some metadata");
		expect(next).toContain("## New notes");
		expect(next).not.toContain("## Old notes");
	});

	it("appends a marker section when none exists", () => {
		const next = replaceBookNotesExportSection("# Book page\n", "## Notes");
		expect(next).toContain("# Book page");
		expect(next).toContain("<!-- weave-epub-excerpts:start -->");
		expect(next).toContain("## Notes");
	});
});

describe("book-notes-export template renderer", () => {
	it("renders chapter loops from builtin classic template", () => {
		const rendered = renderBookNotesTemplate({
			templateSource: getBuiltinBookNotesExportTemplate("classic"),
			context: {
				book: {
					title: "Demo",
					author: "Author",
					publisher: "",
					isbn: "",
					filePath: "Books/demo.epub",
					sourceId: "",
				},
				export: {
					notesTitle: "Notes",
					exportedAt: "2026-01-01T00:00:00.000Z",
				},
				chapters: [
					{
						index: 0,
						title: "Chapter 1",
						label: "Chapter 1",
						highlights: [
							{
								text: "Quote one",
								commentText: "",
								color: "yellow",
								style: "",
								styleLabel: "Highlight",
								createdTimeFormatted: "2026-01-01 10:00",
								excerptId: "excerpt-1",
								cfiRange: "cfi",
								chapterIndex: 0,
								chapterTitle: "Chapter 1",
								excerptHeading: "Excerpt 1",
								blockquote: "> Quote one",
								quoteBlock: "> [!quote|yellow]\n> Quote one",
								epubLink: "[[Books/demo.epub]]",
								blockRef: "^excerpt-1",
								metaLines: ["Color: yellow"],
								chapterLabel: "Chapter 1",
								pageLabel: "P.7",
								pageNumber: 7,
								citationInline: "",
								citationBlock: "",
								citationAcademic: "",
							},
						],
					},
				],
				highlights: [],
			},
		});

		expect(rendered).toContain("# Notes");
		expect(rendered).toContain("## Chapter 1");
		expect(rendered).toContain("> Quote one");
		expect(rendered).toContain("Color: yellow");
	});

	it("renders digest-b template with citation block and page label", () => {
		const labels = buildBookNotesExportLabelsFromTranslator((key, vars) => {
			if (key === "epub.export.citation.block") {
				return `——《${vars?.book}》· ${vars?.chapter} · ${vars?.page}`;
			}
			if (key === "epub.reader.notesTitle") {
				return "Reading notes";
			}
			if (key === "epub.reader.chapterLabel") {
				return `Chapter ${vars?.number}`;
			}
			if (key === "epub.reader.unlocatedChapter") {
				return "Unlocated";
			}
			if (key === "epub.reader.excerptHeading") {
				return `Excerpt ${vars?.number}`;
			}
			if (key === "epub.reader.emptyExcerpt") {
				return "Empty";
			}
			if (key === "epub.export.citation.pageUnknown") {
				return "No page";
			}
			if (key === "epub.export.citation.unknownAuthor") {
				return "Unknown";
			}
			return String(vars?.value ?? key);
		});

		const context = buildBookNotesExportContext({
			book: {
				id: "book-1",
				sourceId: "",
				metadata: { title: "Demo Book", author: "Author" },
			} as any,
			filePath: "Books/demo.epub",
			highlights: [
				{
					cfiRange: "cfi",
					color: "yellow",
					text: "Quote one",
					chapterIndex: 0,
					chapterTitle: "Chapter 1",
					createdTime: Date.parse("2026-06-10T21:30:00.000Z"),
					pageNumber: 42,
					pageLabel: "P.42",
				},
			],
			linkService: {
				buildEpubLink: () => "[[Books/demo.epub]]",
				buildQuoteBlock: () => "> Quote one",
			} as any,
			labels,
			formatTimestamp: () => "2026-06-10 21:30",
		});

		const rendered = renderBookNotesTemplate({
			templateSource: getBuiltinBookNotesExportTemplate("digest-b"),
			context,
		});

		expect(rendered).toContain("Quote one");
		expect(rendered).toContain("——《Demo Book》· Chapter 1 · P.42");
		expect(rendered).toContain("2026-06-10 21:30");
	});

	it("formats print page labels", () => {
		expect(formatBookNotesPrintPageLabel(42)).toBe("P.42");
		expect(formatBookNotesPrintPageLabel(undefined)).toBe("");
	});
});
