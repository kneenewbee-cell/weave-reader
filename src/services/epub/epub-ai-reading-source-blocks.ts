import type { ReaderParagraph } from "./reader-engine-types";

export type EpubAiReadingSourceBlockKind =
	| "heading"
	| "paragraph"
	| "list"
	| "code"
	| "quote"
	| "table";

export interface EpubAiReadingSourceBlock {
	id: string;
	readerParagraphId?: string;
	chapterIndex?: number;
	chapterTitle?: string;
	chapterHref: string;
	cfi?: string;
	sourceLink?: string;
	headingPath: string[];
	text: string;
	kind: EpubAiReadingSourceBlockKind;
}

export interface BuildEpubAiReadingSourceBlockOptions {
	sourceLinkForParagraph?: (
		paragraph: ReaderParagraph,
		blockId: string,
	) => string;
	idForIndex?: (index: number) => string;
	headingPath?: string[];
	maxBlocks?: number;
}

function normalizeBlockText(value: string): string {
	return String(value || "")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeComparableText(value: string): string {
	return normalizeBlockText(value).replace(/\s+/g, "").toLowerCase();
}

function paragraphAppearsInDraft(
	paragraphText: string,
	draftText: string,
): boolean {
	const paragraph = normalizeComparableText(paragraphText);
	const draft = normalizeComparableText(draftText);
	if (!paragraph || !draft) {
		return false;
	}
	if (draft.includes(paragraph)) {
		return true;
	}
	const probeLength = Math.min(48, paragraph.length);
	if (probeLength < 12) {
		return false;
	}
	return draft.includes(paragraph.slice(0, probeLength));
}

function inferBlockKind(
	paragraph: ReaderParagraph,
): EpubAiReadingSourceBlockKind {
	const html = String(paragraph.html || "")
		.trim()
		.toLowerCase();
	if (/^<h[1-6]\b/.test(html)) {
		return "heading";
	}
	if (html.startsWith("<li")) {
		return "list";
	}
	if (html.startsWith("<pre") || html.startsWith("<code")) {
		return "code";
	}
	if (html.startsWith("<blockquote")) {
		return "quote";
	}
	if (html.startsWith("<table")) {
		return "table";
	}
	return "paragraph";
}

const SOURCE_REFERENCE_PATTERN = /\[((?:U\d{3}\.P\d{3})|(?:段|P)\d{3})\]/g;
const LEGACY_SOURCE_REFERENCE_PATTERN = /^P\d{3}$/;
const UNIT_SOURCE_REFERENCE_ID_PATTERN = /^U\d{3}\.P(\d{3})$/;
const SEGMENT_SOURCE_REFERENCE_ID_PATTERN = /^(?:段|P)(\d{3})$/;

function formatSourceBlockId(index: number): string {
	return `段${String(index + 1).padStart(3, "0")}`;
}

function normalizeSourceReferenceId(id: string): string {
	return LEGACY_SOURCE_REFERENCE_PATTERN.test(id) ? `段${id.slice(1)}` : id;
}

export function formatEpubAiReadingSourceReferenceLabel(id: string): string {
	return "原文";
}

function getSourceReferenceParagraphNumber(id: string): number | null {
	const normalizedId = normalizeSourceReferenceId(String(id || "").trim());
	const unitMatch = normalizedId.match(UNIT_SOURCE_REFERENCE_ID_PATTERN);
	const segmentMatch = normalizedId.match(SEGMENT_SOURCE_REFERENCE_ID_PATTERN);
	const value = Number(unitMatch?.[1] || segmentMatch?.[1] || 0);
	return Number.isFinite(value) && value > 0 ? value : null;
}

export function formatEpubAiReadingSourceReferenceTitle(
	block: Pick<EpubAiReadingSourceBlock, "id" | "headingPath" | "chapterTitle">,
): string {
	const path = (block.headingPath || [])
		.map((part) => String(part || "").trim())
		.filter(Boolean);
	if (path.length === 0 && block.chapterTitle) {
		path.push(String(block.chapterTitle).trim());
	}
	const paragraphNumber = getSourceReferenceParagraphNumber(block.id);
	const parts = [...path];
	if (paragraphNumber) {
		parts.push(`第 ${paragraphNumber} 段`);
	}
	return parts.length > 0 ? parts.join("，") : "点击回到 EPUB 原文";
}

function replaceWikilinkAlias(link: string, alias: string): string {
	const normalizedAlias = String(alias || "").trim();
	if (!normalizedAlias) {
		return link;
	}
	if (/\|[^\]]*\]\]$/.test(link)) {
		return link.replace(/\|[^\]]*\]\]$/, `|${normalizedAlias}]]`);
	}
	return link.endsWith("]]") ? `${link.slice(0, -2)}|${normalizedAlias}]]` : link;
}

export function buildEpubAiReadingSourceBlocksFromParagraphs(
	paragraphs: ReaderParagraph[],
	options: BuildEpubAiReadingSourceBlockOptions = {},
): EpubAiReadingSourceBlock[] {
	const blocks: EpubAiReadingSourceBlock[] = [];
	for (const paragraph of paragraphs || []) {
		if (options.maxBlocks && blocks.length >= options.maxBlocks) {
			break;
		}
		const text = normalizeBlockText(paragraph.text);
		if (!text) {
			continue;
		}
		const id = options.idForIndex?.(blocks.length) || formatSourceBlockId(blocks.length);
		blocks.push({
			id,
			readerParagraphId: paragraph.id,
			chapterIndex: paragraph.chapterIndex,
			chapterTitle: paragraph.chapterTitle,
			chapterHref: paragraph.chapterHref,
			cfi: paragraph.cfiRange,
			sourceLink: options.sourceLinkForParagraph?.(paragraph, id) || undefined,
			headingPath:
				options.headingPath && options.headingPath.length > 0
					? options.headingPath
					: paragraph.chapterTitle
						? [paragraph.chapterTitle]
						: [],
			text,
			kind: inferBlockKind(paragraph),
		});
	}
	return blocks;
}

export function filterReaderParagraphsForAiReadingDraft(
	paragraphs: ReaderParagraph[],
	draftText: string,
): ReaderParagraph[] {
	const draft = normalizeBlockText(draftText);
	if (!draft) {
		return paragraphs || [];
	}
	return (paragraphs || []).filter((paragraph) =>
		paragraphAppearsInDraft(paragraph.text, draft),
	);
}

export function formatEpubAiReadingSourceBlocksForPrompt(
	blocks: EpubAiReadingSourceBlock[],
): string {
	return (blocks || [])
		.map((block) => {
			const path =
				block.headingPath.length > 0
					? block.headingPath.join(" > ")
					: block.chapterTitle || "";
			return [
				`[${block.id}] kind=${block.kind}${path ? ` path=${path}` : ""}`,
				`href=${block.chapterHref}${block.cfi ? ` cfi=${block.cfi}` : ""}`,
				block.text,
			].join("\n");
		})
		.join("\n\n");
}

export function limitEpubAiReadingSourceReferencesPerLine(
	markdown: string,
	maxReferencesPerLine = 2,
): string {
	const maxReferences = Math.max(0, Math.floor(maxReferencesPerLine));
	let insideFence = false;
	return String(markdown || "")
		.split(/\r?\n/g)
		.map((line) => {
			if (/^\s*```/.test(line)) {
				insideFence = !insideFence;
				return line;
			}
			if (insideFence) {
				return line;
			}
			let referenceCount = 0;
			return line
				.replace(SOURCE_REFERENCE_PATTERN, (match) => {
					referenceCount += 1;
					return referenceCount <= maxReferences ? match : "";
				})
				.replace(/[ \t]{2,}/g, " ")
				.replace(/[ \t]+$/g, "");
		})
		.join("\n");
}

export function decorateEpubAiReadingSourceReferences(
	markdown: string,
	blocks: EpubAiReadingSourceBlock[] = [],
): string {
	const byId = new Map(blocks.map((block) => [block.id, block]));
	return String(markdown || "")
		.replace(SOURCE_REFERENCE_PATTERN, (match, id: string) => {
			const block = byId.get(id) || byId.get(normalizeSourceReferenceId(id));
			if (!block?.sourceLink) {
				return match;
			}
			return replaceWikilinkAlias(
				block.sourceLink,
				formatEpubAiReadingSourceReferenceLabel(block.id),
			);
		})
		.replace(/\]\]\s*(?=\[\[)/g, "]] ");
}
