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
	sourceLinkForParagraph?: (paragraph: ReaderParagraph, blockId: string) => string;
	maxBlocks?: number;
}

function normalizeBlockText(value: string): string {
	return String(value || "").replace(/\s+/g, " ").trim();
}

function inferBlockKind(paragraph: ReaderParagraph): EpubAiReadingSourceBlockKind {
	const html = String(paragraph.html || "").trim().toLowerCase();
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

function formatSourceBlockId(index: number): string {
	return `P${String(index + 1).padStart(3, "0")}`;
}

export function buildEpubAiReadingSourceBlocksFromParagraphs(
	paragraphs: ReaderParagraph[],
	options: BuildEpubAiReadingSourceBlockOptions = {}
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
		const id = formatSourceBlockId(blocks.length);
		blocks.push({
			id,
			readerParagraphId: paragraph.id,
			chapterIndex: paragraph.chapterIndex,
			chapterTitle: paragraph.chapterTitle,
			chapterHref: paragraph.chapterHref,
			cfi: paragraph.cfiRange,
			sourceLink: options.sourceLinkForParagraph?.(paragraph, id) || undefined,
			headingPath: paragraph.chapterTitle ? [paragraph.chapterTitle] : [],
			text,
			kind: inferBlockKind(paragraph),
		});
	}
	return blocks;
}

export function formatEpubAiReadingSourceBlocksForPrompt(
	blocks: EpubAiReadingSourceBlock[]
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

export function decorateEpubAiReadingSourceReferences(
	markdown: string,
	blocks: EpubAiReadingSourceBlock[] = []
): string {
	const byId = new Map(blocks.map((block) => [block.id, block]));
	return String(markdown || "").replace(/\[(P\d{3})\]/g, (match, id: string) => {
		const block = byId.get(id);
		return block?.sourceLink || match;
	});
}
