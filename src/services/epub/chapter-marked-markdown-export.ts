import type { ReaderHighlight } from "./reader-engine-types";
import type { EpubHighlightStyle } from "./types";
import { normalizeTocHref } from "../../utils/epub-toc-reading-position";

export const CHAPTER_MARKED_HIGHLIGHT_COLORS: Record<string, string> = {
	yellow: "rgba(255, 235, 59, 0.4)",
	green: "rgba(76, 175, 80, 0.3)",
	blue: "rgba(33, 150, 243, 0.3)",
	red: "rgba(239, 68, 68, 0.3)",
	purple: "rgba(171, 71, 188, 0.3)",
};

export interface ChapterMarkedSpan {
	start: number;
	end: number;
	highlight: ReaderHighlight;
	footnoteIndex?: number;
}

export interface ChapterMarkedMarkdownResult {
	markdown: string;
	footnotesMarkdown: string;
}

export interface ChapterMarkedExportOptions {
	plainText?: string;
	resolveRangeText?: (highlight: ReaderHighlight) => Promise<string | null | undefined>;
}

export interface ChapterMarkedChapterMatchOptions {
	getSectionIndexForCfi?: (cfi: string) => number | null;
	getSectionHrefForCfi?: (cfi: string) => string | null;
	normalizeHref?: (href: string) => string;
}

export function highlightBelongsToChapterExport(
	highlight: ReaderHighlight,
	chapterIndex: number,
	chapterHref: string,
	options: ChapterMarkedChapterMatchOptions = {}
): boolean {
	const directIndex =
		typeof highlight.chapterIndex === "number" && Number.isFinite(highlight.chapterIndex)
			? highlight.chapterIndex
			: undefined;
	if (directIndex === chapterIndex) {
		return true;
	}

	const sectionIndex = options.getSectionIndexForCfi?.(highlight.cfiRange);
	if (typeof sectionIndex === "number" && sectionIndex === chapterIndex) {
		return true;
	}

	const sectionHref = String(options.getSectionHrefForCfi?.(highlight.cfiRange) || "").trim();
	const normalizedChapterHref = String(chapterHref || "").trim();
	if (sectionHref && normalizedChapterHref) {
		const normalizeHref = options.normalizeHref ?? normalizeTocHref;
		if (normalizeHref(sectionHref) === normalizeHref(normalizedChapterHref)) {
			return true;
		}
	}

	return false;
}

export function shouldIncludeHighlightInChapterMarkedExport(highlight: ReaderHighlight): boolean {
	if (highlight.presentation === "conceal" || highlight.color === "mask") {
		return false;
	}
	return String(highlight.text || "").trim().length > 0;
}

export function highlightTextAppearsInChapterDraft(
	highlight: ReaderHighlight,
	draftText: string
): boolean {
	if (!shouldIncludeHighlightInChapterMarkedExport(highlight)) {
		return false;
	}
	return findFlexibleTextRangeInMarkdown(String(draftText || ""), highlight.text || "", []) !== null;
}

export function resolveChapterMarkedFootnoteComment(highlight: ReaderHighlight): string | null {
	const comment = String(highlight.commentText || "").trim();
	return comment || null;
}

export function formatObsidianFootnoteDefinition(index: number, comment: string): string {
	const normalized = String(comment || "")
		.replace(/\r\n?/g, "\n")
		.trim();
	if (!normalized) {
		return "";
	}

	const lines = normalized.split("\n");
	if (lines.length === 1) {
		return `[^${index}]: ${lines[0]}`;
	}

	const [firstLine, ...restLines] = lines;
	const continuation = restLines.map((line) => `    ${line}`).join("\n");
	return `[^${index}]: ${firstLine}\n${continuation}`;
}

function escapeHtmlForMarkedExport(text: string): string {
	return String(text || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export function wrapChapterMarkedHighlightText(text: string, highlight: ReaderHighlight): string {
	const escapedText = escapeHtmlForMarkedExport(text);
	const style = (highlight.style || "highlight") as EpubHighlightStyle;
	switch (style) {
		case "strikethrough":
			return `~~${text}~~`;
		case "underline":
			return `<u>${escapedText}</u>`;
		case "wavy":
			return `<span style="text-decoration: underline wavy;">${escapedText}</span>`;
		default: {
			const colorKey = String(highlight.color || "yellow").trim().toLowerCase();
			const backgroundColor =
				CHAPTER_MARKED_HIGHLIGHT_COLORS[colorKey] || CHAPTER_MARKED_HIGHLIGHT_COLORS.yellow;
			return `<mark style="background-color: ${backgroundColor};">${escapedText}</mark>`;
		}
	}
}

export function buildChapterMarkedFootnotesBlock(spans: ChapterMarkedSpan[]): string {
	const lines: string[] = [];
	for (const span of spans) {
		if (typeof span.footnoteIndex !== "number") {
			continue;
		}
		const comment = resolveChapterMarkedFootnoteComment(span.highlight);
		if (!comment) {
			continue;
		}
		const definition = formatObsidianFootnoteDefinition(span.footnoteIndex, comment);
		if (definition) {
			lines.push(definition);
		}
	}
	return lines.join("\n");
}

function rangesOverlap(
	left: { start: number; end: number },
	right: { start: number; end: number }
): boolean {
	return left.start < right.end && right.start < left.end;
}

function collapseInlineWhitespace(text: string): string {
	return String(text || "")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeHighlightMatchText(text: string): string {
	return collapseInlineWhitespace(text);
}

function buildFlexibleSearchIndex(source: string): {
	text: string;
	toSourceStart: number[];
	toSourceEnd: number[];
} {
	const markdownSkipChars = new Set(["*", "_", "`", "#", "[", "]", "(", ")", ">", "{", "}", "|"]);
	const chars: string[] = [];
	const toSourceStart: number[] = [];
	const toSourceEnd: number[] = [];
	let pendingSpace = false;

	for (let index = 0; index < source.length; index += 1) {
		const char = source[index] || "";
		if (markdownSkipChars.has(char)) {
			continue;
		}
		if (/\s/.test(char)) {
			pendingSpace = chars.length > 0;
			continue;
		}
		if (pendingSpace) {
			chars.push(" ");
			toSourceStart.push(index);
			toSourceEnd.push(index);
			pendingSpace = false;
		}
		chars.push(char);
		toSourceStart.push(index);
		toSourceEnd.push(index + 1);
	}

	return {
		text: chars.join("").trim(),
		toSourceStart,
		toSourceEnd,
	};
}

export function findFlexibleTextRangeInMarkdown(
	markdown: string,
	needle: string,
	occupiedRanges: Array<{ start: number; end: number }> = []
): { start: number; end: number } | null {
	const trimmedNeedle = String(needle || "");
	if (!trimmedNeedle.trim()) {
		return null;
	}

	const normalizedNeedle = collapseInlineWhitespace(trimmedNeedle);
	if (!normalizedNeedle) {
		return null;
	}

	let exactFrom = 0;
	while (exactFrom <= markdown.length) {
		const exactIndex = markdown.indexOf(trimmedNeedle, exactFrom);
		if (exactIndex < 0) {
			break;
		}
		const candidate = { start: exactIndex, end: exactIndex + trimmedNeedle.length };
		if (!occupiedRanges.some((range) => rangesOverlap(range, candidate))) {
			return candidate;
		}
		exactFrom = exactIndex + 1;
	}

	const indexMap = buildFlexibleSearchIndex(markdown);
	let searchFrom = 0;
	while (searchFrom <= indexMap.text.length) {
		const matchIndex = indexMap.text.indexOf(normalizedNeedle, searchFrom);
		if (matchIndex < 0) {
			break;
		}
		const matchEndIndex = matchIndex + normalizedNeedle.length - 1;
		const start = indexMap.toSourceStart[matchIndex];
		const end = indexMap.toSourceEnd[matchEndIndex];
		if (typeof start !== "number" || typeof end !== "number" || end <= start) {
			searchFrom = matchIndex + 1;
			continue;
		}
		const candidate = { start, end };
		if (!occupiedRanges.some((range) => rangesOverlap(range, candidate))) {
			return candidate;
		}
		searchFrom = matchIndex + 1;
	}

	return null;
}

function collectHighlightSearchNeedles(
	highlight: ReaderHighlight,
	plainText?: string,
	resolvedRangeText?: string | null
): string[] {
	const needles: string[] = [];
	const pushNeedle = (value?: string | null) => {
		const raw = String(value || "").trim();
		if (!raw) {
			return;
		}
		if (!needles.includes(raw)) {
			needles.push(raw);
		}
		const normalized = normalizeHighlightMatchText(raw);
		if (normalized && normalized !== raw && !needles.includes(normalized)) {
			needles.push(normalized);
		}
	};

	pushNeedle(highlight.text);
	pushNeedle(resolvedRangeText);

	if (plainText) {
		const plainRange = findFlexibleTextRangeInMarkdown(plainText, highlight.text || "", []);
		if (plainRange) {
			pushNeedle(plainText.slice(plainRange.start, plainRange.end));
		}
	}

	return needles;
}

function resolveHighlightMarkdownRange(
	markdown: string,
	needles: string[],
	occupiedRanges: Array<{ start: number; end: number }>
): { start: number; end: number } | null {
	for (const needle of needles) {
		const range = findFlexibleTextRangeInMarkdown(markdown, needle, occupiedRanges);
		if (range) {
			return range;
		}
	}
	return null;
}

function finalizeChapterMarkedSpans(spans: ChapterMarkedSpan[]): ChapterMarkedSpan[] {
	const spansByPosition = [...spans].sort((left, right) => left.start - right.start);
	let footnoteCounter = 0;
	for (const span of spansByPosition) {
		if (!resolveChapterMarkedFootnoteComment(span.highlight)) {
			continue;
		}
		footnoteCounter += 1;
		span.footnoteIndex = footnoteCounter;
	}
	return spansByPosition;
}

function appendChapterMarkedSpan(
	markdown: string,
	highlight: ReaderHighlight,
	needles: string[],
	occupiedRanges: Array<{ start: number; end: number }>,
	spans: ChapterMarkedSpan[]
): void {
	const range = resolveHighlightMarkdownRange(markdown, needles, occupiedRanges);
	if (!range) {
		return;
	}
	occupiedRanges.push(range);
	spans.push({
		start: range.start,
		end: range.end,
		highlight,
	});
}

function sortHighlightsForChapterMarkedExport(highlights: ReaderHighlight[]): ReaderHighlight[] {
	return [...highlights]
		.filter(shouldIncludeHighlightInChapterMarkedExport)
		.sort((left, right) => (left.createdTime || 0) - (right.createdTime || 0));
}

export function resolveChapterMarkedSpans(
	markdown: string,
	highlights: ReaderHighlight[],
	options: Pick<ChapterMarkedExportOptions, "plainText"> = {}
): ChapterMarkedSpan[] {
	const occupiedRanges: Array<{ start: number; end: number }> = [];
	const spans: ChapterMarkedSpan[] = [];

	for (const highlight of sortHighlightsForChapterMarkedExport(highlights)) {
		appendChapterMarkedSpan(
			markdown,
			highlight,
			collectHighlightSearchNeedles(highlight, options.plainText, null),
			occupiedRanges,
			spans
		);
	}

	return finalizeChapterMarkedSpans(spans);
}

export async function resolveChapterMarkedSpansAsync(
	markdown: string,
	highlights: ReaderHighlight[],
	options: ChapterMarkedExportOptions = {}
): Promise<ChapterMarkedSpan[]> {
	const occupiedRanges: Array<{ start: number; end: number }> = [];
	const spans: ChapterMarkedSpan[] = [];

	for (const highlight of sortHighlightsForChapterMarkedExport(highlights)) {
		const resolvedRangeText = options.resolveRangeText
			? normalizeHighlightMatchText((await options.resolveRangeText(highlight)) || "")
			: "";
		appendChapterMarkedSpan(
			markdown,
			highlight,
			collectHighlightSearchNeedles(highlight, options.plainText, resolvedRangeText || null),
			occupiedRanges,
			spans
		);
	}

	return finalizeChapterMarkedSpans(spans);
}

export function applyChapterMarkedSpans(markdown: string, spans: ChapterMarkedSpan[]): string {
	let result = markdown;
	for (const span of [...spans].sort((left, right) => right.start - left.start)) {
		const original = result.slice(span.start, span.end);
		let wrapped = wrapChapterMarkedHighlightText(original, span.highlight);
		if (typeof span.footnoteIndex === "number") {
			wrapped += `[^${span.footnoteIndex}]`;
		}
		result = `${result.slice(0, span.start)}${wrapped}${result.slice(span.end)}`;
	}
	return result;
}

export function applyChapterHighlightsToMarkdown(
	markdown: string,
	highlights: ReaderHighlight[],
	options: Pick<ChapterMarkedExportOptions, "plainText"> = {}
): ChapterMarkedMarkdownResult {
	const sourceMarkdown = String(markdown || "");
	if (!sourceMarkdown.trim() || highlights.length === 0) {
		return { markdown: sourceMarkdown, footnotesMarkdown: "" };
	}

	const spans = resolveChapterMarkedSpans(sourceMarkdown, highlights, options);
	if (spans.length === 0) {
		return { markdown: sourceMarkdown, footnotesMarkdown: "" };
	}

	return {
		markdown: applyChapterMarkedSpans(sourceMarkdown, spans),
		footnotesMarkdown: buildChapterMarkedFootnotesBlock(spans),
	};
}

export async function applyChapterHighlightsToMarkdownAsync(
	markdown: string,
	highlights: ReaderHighlight[],
	options: ChapterMarkedExportOptions = {}
): Promise<ChapterMarkedMarkdownResult> {
	const sourceMarkdown = String(markdown || "");
	if (!sourceMarkdown.trim() || highlights.length === 0) {
		return { markdown: sourceMarkdown, footnotesMarkdown: "" };
	}

	const spans = await resolveChapterMarkedSpansAsync(sourceMarkdown, highlights, options);
	if (spans.length === 0) {
		return { markdown: sourceMarkdown, footnotesMarkdown: "" };
	}

	return {
		markdown: applyChapterMarkedSpans(sourceMarkdown, spans),
		footnotesMarkdown: buildChapterMarkedFootnotesBlock(spans),
	};
}
