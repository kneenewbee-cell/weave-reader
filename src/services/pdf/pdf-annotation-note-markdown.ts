import type { PdfTextAnnotation, PdfTextAnnotationKind } from "./pdf-ink-annotation-store";
import { sortPdfTextAnnotationsByPosition } from "./pdf-text-annotation-store";

export interface PdfAnnotationNoteBookInput {
	title?: string;
	filePath: string;
	pageCount?: number;
	currentPage?: number;
}

export interface RenderPdfAnnotationNoteMarkdownInput {
	book: PdfAnnotationNoteBookInput;
	bookId: string;
	annotations: PdfTextAnnotation[];
	now?: Date;
}

const TEXT = {
	untitledBook: "\u672a\u547d\u540d PDF",
	noteTitle: "PDF \u6807\u6ce8\u7b14\u8bb0",
	readonlyNotice:
		"\u8fd9\u662f\u7531 Weave Reader \u6839\u636e `annotations.json` \u81ea\u52a8\u751f\u6210\u7684\u53ea\u8bfb\u6d3e\u751f\u6587\u4ef6\u3002\u91cd\u65b0\u6253\u5f00\u6807\u6ce8\u7b14\u8bb0\u65f6\uff0c\u672c\u6587\u4ef6\u53ef\u80fd\u88ab\u8986\u76d6\u3002",
	dataId: "\u6570\u636e ID",
	generatedAt: "\u751f\u6210\u65f6\u95f4",
	pageCount: "\u9875\u6570",
	noAnnotations: "\u6682\u65e0 PDF \u6587\u672c\u6807\u6ce8\u3002",
	pageHeading: "\u7b2c",
	pageUnit: "\u9875",
	unsemantic: "\u672a\u6807\u6ce8\u8bed\u4e49",
	comment: "\u5907\u6ce8",
};

function escapeHtml(value: unknown): string {
	return String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function escapeDisplayText(value: unknown): string {
	return escapeHtml(String(value || "").trim())
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\n+/g, "<br>");
}

function normalizeInlineText(value: unknown): string {
	return String(value || "")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeHexColor(value: unknown, fallback = "#ffd54a"): string {
	const color = String(value || "").trim();
	return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function hexToRgba(hexColor: string, alpha: number): string {
	const hex = normalizeHexColor(hexColor).slice(1);
	const red = Number.parseInt(hex.slice(0, 2), 16);
	const green = Number.parseInt(hex.slice(2, 4), 16);
	const blue = Number.parseInt(hex.slice(4, 6), 16);
	return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function normalizePageNumber(value: unknown): number {
	const pageNumber = Math.floor(Number(value) || 1);
	return Math.max(1, pageNumber);
}

function getSemanticId(annotation: PdfTextAnnotation): string {
	return String(annotation.semanticId || "").trim() || "unsemantic";
}

function getSemanticLabel(annotation: PdfTextAnnotation): string {
	return (
		String(annotation.semanticLabel || "").trim() ||
		String(annotation.semanticId || "").trim() ||
		TEXT.unsemantic
	);
}

function getPageKey(pageNumber: number): string {
	return `page-${pageNumber}`;
}

function getPageTitle(pageNumber: number): string {
	return `${TEXT.pageHeading} ${pageNumber} ${TEXT.pageUnit}`;
}

function renderPageHeading(pageNumber: number): string {
	const pageTitle = getPageTitle(pageNumber);
	return `<h2 class="weave-annotation-note-chapter weave-pdf-annotation-note-page" data-chapter-key="${getPageKey(pageNumber)}" data-chapter-title="${escapeHtml(pageTitle)}" data-page-number="${pageNumber}">${escapeHtml(pageTitle)}</h2>`;
}

function renderStyledText(annotation: PdfTextAnnotation): string {
	const color = normalizeHexColor(annotation.color);
	const text = escapeDisplayText(annotation.text);
	const semanticLabel = escapeHtml(annotation.semanticLabel || annotation.semanticId || "");
	const semanticAttr = semanticLabel ? ` data-semantic="${semanticLabel}"` : "";
	const kind: PdfTextAnnotationKind = annotation.kind;

	if (kind === "underline" || kind === "wavy") {
		const wavy = kind === "wavy" ? " text-decoration-style: wavy;" : "";
		const thickness = kind === "wavy" ? "1.6px" : "2px";
		return `<span${semanticAttr} style="text-decoration-line: underline;${wavy} text-decoration-color: ${color}; text-decoration-thickness: ${thickness}; text-underline-offset: 4px; color: var(--text-normal);">${text}</span>`;
	}
	if (kind === "strikethrough") {
		return `<span${semanticAttr} style="text-decoration-line: line-through; text-decoration-color: ${color}; text-decoration-thickness: 2px; color: var(--text-normal);">${text}</span>`;
	}
	if (kind === "note") {
		return `<span${semanticAttr} style="border: 1.5px solid ${color}; border-radius: 4px; padding: 0 4px; color: var(--text-normal); background: transparent;">${text}</span>`;
	}
	return `<mark${semanticAttr} style="background: ${hexToRgba(color, 0.32)}; color: var(--text-normal); border-radius: 4px; padding: 0 2px;">${text}</mark>`;
}

function renderAnnotationLine(
	annotation: PdfTextAnnotation,
	bookId: string,
	book: PdfAnnotationNoteBookInput
): string {
	const pageNumber = normalizePageNumber(annotation.pageNumber);
	const pageTitle = getPageTitle(pageNumber);
	const semanticId = getSemanticId(annotation);
	const semanticLabel = getSemanticLabel(annotation);
	const annotationText = normalizeInlineText(annotation.text);
	const rects = JSON.stringify(annotation.rects || []);
	const lines = [
		`<div class="weave-annotation-note-line weave-pdf-annotation-note-line" data-book-id="${escapeHtml(bookId)}" data-source-file="${escapeHtml(book.filePath)}" data-annotation-id="${escapeHtml(annotation.id || "")}" data-page-number="${pageNumber}" data-chapter-key="${getPageKey(pageNumber)}" data-chapter-title="${escapeHtml(pageTitle)}" data-semantic-id="${escapeHtml(semanticId)}" data-semantic-label="${escapeHtml(semanticLabel)}" data-annotation-text="${escapeHtml(annotationText)}" data-pdf-rects="${escapeHtml(rects)}">${renderStyledText(annotation)}`,
	];
	const note = String(annotation.note || "").trim();
	if (note) {
		lines.push(`<div class="weave-annotation-note-comment">${TEXT.comment}: ${escapeHtml(note)}</div>`);
	}
	lines.push("</div>");
	return lines.join("\n");
}

export function renderPdfAnnotationNoteMarkdown(
	input: RenderPdfAnnotationNoteMarkdownInput
): string {
	const title = String(input.book.title || "").trim() || TEXT.untitledBook;
	const filePath = String(input.book.filePath || "").trim();
	const bookId = String(input.bookId || "").trim();
	const pageCount = Math.max(0, Math.floor(Number(input.book.pageCount) || 0));
	const currentPage = normalizePageNumber(input.book.currentPage);
	const generatedAt = (input.now || new Date()).toLocaleString("zh-CN", { hour12: false });
	const annotations = sortPdfTextAnnotationsByPosition(
		(input.annotations || []).filter((annotation) => String(annotation.text || "").trim())
	);
	const lines: string[] = [
		`# ${title} - ${TEXT.noteTitle}`,
		"",
		`<div class="weave-annotation-note-root weave-pdf-annotation-note-root" data-annotation-note-kind="pdf" data-book-id="${escapeHtml(bookId)}" data-source-file="${escapeHtml(filePath)}" data-page-count="${pageCount}" data-current-page="${currentPage}"></div>`,
		"",
		`> ${TEXT.readonlyNotice}`,
		"",
		`- ${TEXT.dataId}: \`${escapeHtml(bookId)}\``,
		`- PDF: \`${escapeHtml(filePath)}\``,
		`- ${TEXT.pageCount}: ${pageCount}`,
		`- ${TEXT.generatedAt}: ${escapeHtml(generatedAt)}`,
		"",
	];

	if (annotations.length === 0) {
		lines.push(`> ${TEXT.noAnnotations}`);
		return `${lines.join("\n").trim()}\n`;
	}

	let currentPageHeading = 0;
	for (const annotation of annotations) {
		const pageNumber = normalizePageNumber(annotation.pageNumber);
		if (pageNumber !== currentPageHeading) {
			currentPageHeading = pageNumber;
			lines.push(renderPageHeading(pageNumber), "");
		}
		lines.push(renderAnnotationLine(annotation, bookId, input.book), "");
	}

	return `${lines.join("\n").trim()}\n`;
}
