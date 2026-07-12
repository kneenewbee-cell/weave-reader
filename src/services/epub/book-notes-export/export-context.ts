import type { EpubBook } from "../types";
import { EpubLinkService } from "../EpubLinkService";
import type { ReaderHighlight } from "../reader-engine-types";

export interface BookNotesExportCitationParts {
	bookTitle: string;
	author: string;
	chapterLabel: string;
	chapterTitle: string;
	pageLabel: string;
	createdTimeFormatted: string;
}

export interface BookNotesExportHighlightView {
	text: string;
	commentText: string;
	color: string;
	style: string;
	styleLabel: string;
	createdTime?: number;
	createdTimeFormatted: string;
	excerptId: string;
	cfiRange: string;
	chapterIndex?: number;
	chapterTitle: string;
	chapterLabel: string;
	pageLabel: string;
	pageNumber?: number;
	citationInline: string;
	citationBlock: string;
	citationAcademic: string;
	excerptHeading: string;
	blockquote: string;
	quoteBlock: string;
	epubLink: string;
	blockRef: string;
	metaLines: string[];
}

export interface BookNotesExportChapterView {
	index?: number;
	title: string;
	label: string;
	highlights: BookNotesExportHighlightView[];
}

export interface BookNotesExportContext {
	book: {
		title: string;
		author: string;
		publisher: string;
		isbn: string;
		filePath: string;
		sourceId: string;
		progressPercent?: number;
	};
	export: {
		notesTitle: string;
		exportedAt: string;
	};
	chapters: BookNotesExportChapterView[];
	highlights: BookNotesExportHighlightView[];
}

export interface BuildBookNotesExportContextInput {
	book: EpubBook;
	filePath: string;
	highlights: ReaderHighlight[];
	linkService: EpubLinkService;
	labels: {
		notesTitle: string;
		chapterLabel: (number: number) => string;
		unlocatedChapter: string;
		excerptHeading: (number: number) => string;
		highlight: string;
		concealed: string;
		underline: string;
		strikethrough: string;
		wavy: string;
		emptyExcerpt: string;
		metaColor: (value: string) => string;
		metaStyle: (value: string) => string;
		metaTime: (value: string) => string;
		metaSource: (value: string) => string;
		formatPageLabel?: (pageNumber: number | undefined, pageLabel: string) => string;
		citationInline?: (parts: BookNotesExportCitationParts) => string;
		citationBlock?: (parts: BookNotesExportCitationParts) => string;
		citationAcademic?: (parts: BookNotesExportCitationParts) => string;
	};
	formatTimestamp: (date: Date) => string;
}

function getHighlightChapterIndex(highlight: ReaderHighlight): number | undefined {
	return typeof highlight.chapterIndex === "number" && Number.isFinite(highlight.chapterIndex)
		? highlight.chapterIndex
		: undefined;
}

function getHighlightStyleLabel(
	highlight: ReaderHighlight,
	labels: BuildBookNotesExportContextInput["labels"]
): string {
	if (highlight.presentation === "conceal") {
		return labels.concealed;
	}

	switch (highlight.style) {
		case "underline":
			return labels.underline;
		case "strikethrough":
			return labels.strikethrough;
		case "wavy":
			return labels.wavy;
		default:
			return labels.highlight;
	}
}

function getHighlightTextForExport(
	highlight: ReaderHighlight,
	emptyExcerpt: string
): string {
	const normalizedText = String(highlight.text || "").trim();
	return normalizedText || emptyExcerpt;
}

function renderHighlightQuote(text: string, emptyExcerpt: string): string {
	const normalized = String(text || "")
		.replace(/\r\n?/g, "\n")
		.trim();
	if (!normalized) {
		return `> ${emptyExcerpt}`;
	}
	return normalized
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
}

function sortHighlightsForExport(highlights: ReaderHighlight[]): ReaderHighlight[] {
	return [...highlights].sort((left, right) => {
		const chapterDiff = (left.chapterIndex || 0) - (right.chapterIndex || 0);
		if (chapterDiff !== 0) {
			return chapterDiff;
		}
		return (left.createdTime || 0) - (right.createdTime || 0);
	});
}

function buildCitationParts(
	highlight: ReaderHighlight,
	input: BuildBookNotesExportContextInput,
	chapterLabel: string,
	chapterTitle: string,
	pageLabel: string,
	createdTimeFormatted: string
): BookNotesExportCitationParts {
	return {
		bookTitle: String(input.book.metadata.title || "").trim(),
		author: String(input.book.metadata.author || "").trim(),
		chapterLabel,
		chapterTitle,
		pageLabel,
		createdTimeFormatted,
	};
}

function buildHighlightView(
	highlight: ReaderHighlight,
	input: BuildBookNotesExportContextInput,
	chapterExcerptIndex: number,
	chapterLabel: string,
	chapterTitle: string
): BookNotesExportHighlightView {
	const highlightChapterIndex = getHighlightChapterIndex(highlight);
	const highlightText = getHighlightTextForExport(highlight, input.labels.emptyExcerpt);
	const styleLabel = getHighlightStyleLabel(highlight, input.labels);
	const createdTimeFormatted =
		typeof highlight.createdTime === "number" && highlight.createdTime > 0
			? input.formatTimestamp(new Date(highlight.createdTime))
			: "";
	const rawPageLabel = String(highlight.pageLabel || "").trim();
	const pageNumber =
		typeof highlight.pageNumber === "number" && Number.isFinite(highlight.pageNumber)
			? highlight.pageNumber
			: undefined;
	const pageLabel = input.labels.formatPageLabel
		? input.labels.formatPageLabel(pageNumber, rawPageLabel)
		: rawPageLabel;
	const citationParts = buildCitationParts(
		highlight,
		input,
		chapterLabel,
		chapterTitle,
		pageLabel,
		createdTimeFormatted
	);
	const epubLink = input.linkService.buildEpubLink(
		input.filePath,
		highlight.cfiRange,
		highlightText,
		highlightChapterIndex,
		undefined,
		undefined,
		input.book.sourceId,
		highlight.excerptId,
		{
			includeText: false,
			includeChapter: false,
			preferCompactLocator: true,
		}
	);
	const quoteBlock = input.linkService
		.buildQuoteBlock(
			input.filePath,
			highlight.cfiRange,
			highlightText,
			highlightChapterIndex,
			highlight.color,
			highlight.chapterTitle,
			createdTimeFormatted || undefined,
			undefined,
			input.book.sourceId,
			highlight.excerptId,
			highlight.style,
			undefined,
			highlight.semanticId
		)
		.trim();
	const metaLines = [
		highlight.color ? input.labels.metaColor(String(highlight.color)) : "",
		styleLabel ? input.labels.metaStyle(styleLabel) : "",
		createdTimeFormatted ? input.labels.metaTime(createdTimeFormatted) : "",
		epubLink ? input.labels.metaSource(epubLink) : "",
	].filter(Boolean);

	return {
		text: highlightText,
		commentText: String(highlight.commentText || "").trim(),
		color: String(highlight.color || "").trim(),
		style: String(highlight.style || "").trim(),
		styleLabel,
		createdTime: highlight.createdTime,
		createdTimeFormatted,
		excerptId: String(highlight.excerptId || "").trim(),
		cfiRange: highlight.cfiRange,
		chapterIndex: highlightChapterIndex,
		chapterTitle: String(highlight.chapterTitle || "").trim() || chapterTitle,
		chapterLabel,
		pageLabel,
		pageNumber,
		citationInline: input.labels.citationInline?.(citationParts) || "",
		citationBlock: input.labels.citationBlock?.(citationParts) || "",
		citationAcademic: input.labels.citationAcademic?.(citationParts) || "",
		excerptHeading: input.labels.excerptHeading(chapterExcerptIndex),
		blockquote: renderHighlightQuote(highlightText, input.labels.emptyExcerpt),
		quoteBlock,
		epubLink,
		blockRef: highlight.excerptId ? `^${highlight.excerptId}` : "",
		metaLines,
	};
}

export function buildBookNotesExportContext(
	input: BuildBookNotesExportContextInput
): BookNotesExportContext {
	const sortedHighlights = sortHighlightsForExport(input.highlights);
	const chapters: BookNotesExportChapterView[] = [];
	const flatHighlights: BookNotesExportHighlightView[] = [];
	let currentChapterLabel = "";
	let chapterExcerptIndex = 0;
	let currentChapter: BookNotesExportChapterView | null = null;

	for (const highlight of sortedHighlights) {
		const highlightChapterIndex = getHighlightChapterIndex(highlight);
		const chapterNumber =
			typeof highlightChapterIndex === "number" ? highlightChapterIndex + 1 : 0;
		const chapterLabel =
			chapterNumber > 0
				? input.labels.chapterLabel(chapterNumber)
				: input.labels.unlocatedChapter;

		if (chapterLabel !== currentChapterLabel) {
			currentChapterLabel = chapterLabel;
			chapterExcerptIndex = 0;
			currentChapter = {
				index: highlightChapterIndex,
				title: String(highlight.chapterTitle || "").trim() || chapterLabel,
				label: chapterLabel,
				highlights: [],
			};
			chapters.push(currentChapter);
		}

		chapterExcerptIndex += 1;
		const resolvedChapterTitle =
			String(highlight.chapterTitle || "").trim() || currentChapter?.title || chapterLabel;
		const highlightView = buildHighlightView(
			highlight,
			input,
			chapterExcerptIndex,
			chapterLabel,
			resolvedChapterTitle
		);
		currentChapter?.highlights.push(highlightView);
		flatHighlights.push(highlightView);
	}

	return {
		book: {
			title: String(input.book.metadata.title || "").trim(),
			author: String(input.book.metadata.author || "").trim(),
			publisher: String(input.book.metadata.publisher || "").trim(),
			isbn: String(input.book.metadata.isbn || "").trim(),
			filePath: input.filePath,
			sourceId: String(input.book.sourceId || "").trim(),
		},
		export: {
			notesTitle: input.labels.notesTitle,
			exportedAt: new Date().toISOString(),
		},
		chapters,
		highlights: flatHighlights,
	};
}
