import type { ReaderParagraph } from "./reader-engine-types";
import {
	collectEpubAiReadingSourceMapBlocksById,
	parseEpubAiReadingSourceMapsFromMarkdown,
} from "./epub-ai-reading-source-map";

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
const SOURCE_PLACEHOLDER_PATTERN =
	/\{\{\s*source\s*:\s*((?:U\d{3}\.P\d{3})|(?:段|P)\d{3})\s*\}\}/g;
const SOURCE_RANGE_PLACEHOLDER_PATTERN =
	/\{\{\s*source-range\s*:\s*(U\d{3}\.P\d{3})\s*[-–—]\s*(U\d{3}\.P\d{3})\s*\}\}/g;
const BARE_UNIT_SOURCE_REFERENCE_PATTERN = /(^|[^\w|\[#])(U\d{3}\.P\d{3})(?![\w\]])/g;
const SHORTHAND_UNIT_SOURCE_RANGE_PATTERN =
	/(\[\[[^\]]+\|U(\d{3})\.P\d{3}\]\]|U(\d{3})\.P\d{3})(\s*[–-]\s*)P(\d{3})(?![\w\]])/g;
const SHORTHAND_UNIT_PARAGRAPH_PATTERN =
	/(^|[、,，;；/\s(（])P(\d{3})(?![\w\]])/g;
const UNIT_REFERENCE_IN_LINE_PATTERN = /(?:\|U(\d{3})\.P\d{3}\]\]|(?<![\w|])U(\d{3})\.P\d{3})/g;
const EPUB_SOURCE_WIKILINK_PATTERN = /\[\[([^\]]*#(?:weave-loc|weave-cfi)=[^\]]*?)\|([^\]]*)\]\]/g;
const AI_SOURCE_EXCERPT_ID_PATTERN = /(?:^|[&?])eid=ai-source-(U\d{3})-P(\d{3})(?:[&|\]]|$)/;
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

function splitWikilink(link: string): { target: string; alias: string } | null {
	const match = String(link || "").match(/^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/);
	if (!match) {
		return null;
	}
	return {
		target: match[1] || "",
		alias: match[2] || "",
	};
}

function buildWikilink(target: string, alias: string): string {
	return `[[${target}|${alias}]]`;
}

function setWikilinkTargetParam(link: string, name: string, value: string): string {
	const parts = splitWikilink(link);
	const normalizedName = String(name || "").trim();
	const normalizedValue = String(value || "").trim();
	if (!parts || !normalizedName || !normalizedValue) {
		return link;
	}
	const encodedValue = encodeURIComponent(normalizedValue);
	const paramPattern = new RegExp(`([?&])${normalizedName}=[^&|\\]]*`);
	const nextTarget = paramPattern.test(parts.target)
		? parts.target.replace(paramPattern, `$1${normalizedName}=${encodedValue}`)
		: `${parts.target}&${normalizedName}=${encodedValue}`;
	return buildWikilink(nextTarget, parts.alias);
}

function setWikilinkTargetEncodedParam(link: string, name: string, encodedValue: string): string {
	const parts = splitWikilink(link);
	const normalizedName = String(name || "").trim();
	const normalizedValue = String(encodedValue || "").trim();
	if (!parts || !normalizedName || !normalizedValue) {
		return link;
	}
	const paramPattern = new RegExp(`([?&])${normalizedName}=[^&|\\]]*`);
	const nextTarget = paramPattern.test(parts.target)
		? parts.target.replace(paramPattern, `$1${normalizedName}=${normalizedValue}`)
		: `${parts.target}&${normalizedName}=${normalizedValue}`;
	return buildWikilink(nextTarget, parts.alias);
}

function extractCfiFromWikilink(link: string): string {
	const target = splitWikilink(link)?.target || "";
	const match = target.match(/(?:^|[#&?])weave-cfi=([^&|\]]*)/);
	if (!match?.[1]) {
		return "";
	}
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return match[1];
	}
}

function injectCfiIntoSourceWikilink(link: string, cfi: string): string {
	const normalizedCfi = String(cfi || "").trim();
	if (!normalizedCfi || /(?:^|[#&?])weave-cfi=/.test(splitWikilink(link)?.target || "")) {
		return link;
	}
	return setWikilinkTargetParam(link, "weave-cfi", normalizedCfi);
}

function formatAiReadingSourceLink(link: string, id: string): string {
	return replaceWikilinkAlias(
		ensureAiReadingSourceLinkFlash(link),
		formatEpubAiReadingSourceReferenceLabel(id),
	);
}

function sourceReferenceRangeTitle(startId: string, endId: string): string {
	return `原文范围：${startId}-${endId}`;
}

function formatAiReadingSourceRangeLink(
	startLink: string,
	startId: string,
	endLink: string,
	endId: string,
	rangeLinks: string[] = [],
): string {
	let link = formatAiReadingSourceLink(startLink, startId);
	const endCfi = extractCfiFromWikilink(endLink);
	const rangeCfis = [
		extractCfiFromWikilink(startLink),
		...rangeLinks.map((item) => extractCfiFromWikilink(item)),
		endCfi,
	]
		.map((cfi) => String(cfi || "").trim())
		.filter(Boolean);
	const uniqueRangeCfis = Array.from(new Set(rangeCfis));
	if (endCfi) {
		link = setWikilinkTargetParam(link, "rangeEndCfi", endCfi);
	}
	if (uniqueRangeCfis.length > 1) {
		link = setWikilinkTargetEncodedParam(
			link,
			"rangeCfis",
			uniqueRangeCfis.map((cfi) => encodeURIComponent(cfi)).join(","),
		);
	}
	return setWikilinkTargetParam(
		link,
		"sourceTitle",
		sourceReferenceRangeTitle(startId, endId),
	);
}

function collectUnitParagraphRangeIds(startId: string, endId: string): string[] {
	const startMatch = String(startId || "").match(/^U(\d{3})\.P(\d{3})$/);
	const endMatch = String(endId || "").match(/^U(\d{3})\.P(\d{3})$/);
	if (!startMatch || !endMatch || startMatch[1] !== endMatch[1]) {
		return [startId, endId].filter(Boolean);
	}
	const unit = startMatch[1];
	const start = Number(startMatch[2]);
	const end = Number(endMatch[2]);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
		return [startId, endId].filter(Boolean);
	}
	const ids: string[] = [];
	for (let current = start; current <= end; current += 1) {
		ids.push(`U${unit}.P${String(current).padStart(3, "0")}`);
	}
	return ids;
}

function resolveAiReadingSourceRangeLink(
	startId: string,
	endId: string,
	resolveLink: (id: string) => string,
): string {
	const startLink = resolveLink(startId);
	const endLink = resolveLink(endId);
	if (!startLink || !endLink) {
		return "";
	}
	const rangeLinks = collectUnitParagraphRangeIds(startId, endId)
		.map((id) => resolveLink(id))
		.filter(Boolean);
	return formatAiReadingSourceRangeLink(startLink, startId, endLink, endId, rangeLinks);
}

function decorateAiReadingSourcePlaceholders(
	markdown: string,
	resolveLink: (id: string) => string,
	resolveRangeLink?: (startId: string, endId: string) => string,
): string {
	return String(markdown || "")
		.replace(
			SOURCE_RANGE_PLACEHOLDER_PATTERN,
			(match, startId: string, endId: string) => {
				const rangeLink = resolveRangeLink?.(startId, endId);
				return rangeLink || match;
			},
		)
		.replace(SOURCE_PLACEHOLDER_PATTERN, (match, id: string) => {
			const normalizedId = normalizeSourceReferenceId(id);
			const link = resolveLink(normalizedId) || resolveLink(id);
			return link ? formatAiReadingSourceLink(link, normalizedId) : match;
		});
}

function collapseExistingAiSourceWikilinkRanges(
	markdown: string,
	resolveLink: (id: string) => string,
): string {
	const source = String(markdown || "");
	const links: Array<{
		start: number;
		end: number;
		markup: string;
		sourceId: string;
	}> = [];
	let match: RegExpExecArray | null;
	EPUB_SOURCE_WIKILINK_PATTERN.lastIndex = 0;
	while ((match = EPUB_SOURCE_WIKILINK_PATTERN.exec(source))) {
		const target = match[1] || "";
		const sourceId = getAiReadingSourceIdFromWikilinkTarget(target);
		if (!sourceId) {
			continue;
		}
		links.push({
			start: match.index,
			end: match.index + (match[0] || "").length,
			markup: match[0] || "",
			sourceId,
		});
	}
	const replacements: Array<{ start: number; end: number; value: string }> = [];
	for (let i = 0; i < links.length - 1; i += 1) {
		const first = links[i];
		const second = links[i + 1];
		const separator = source.slice(first.end, second.start);
		if (!/^\s*[-–—]\s*$/.test(separator)) {
			continue;
		}
		const startMatch = first.sourceId.match(/^U(\d{3})\.P(\d{3})$/);
		const endMatch = second.sourceId.match(/^U(\d{3})\.P(\d{3})$/);
		if (!startMatch || !endMatch || startMatch[1] !== endMatch[1]) {
			continue;
		}
		if (Number(endMatch[2]) <= Number(startMatch[2])) {
			continue;
		}
		const rangeIds = collectUnitParagraphRangeIds(first.sourceId, second.sourceId);
		const rangeLinks = rangeIds
			.map((id) => {
				if (id === first.sourceId) return first.markup;
				if (id === second.sourceId) return second.markup;
				return resolveLink(id);
			})
			.filter(Boolean);
		replacements.push({
			start: first.start,
			end: second.end,
			value: formatAiReadingSourceRangeLink(
				first.markup,
				first.sourceId,
				second.markup,
				second.sourceId,
				rangeLinks,
			),
		});
		i += 1;
	}
	return replacements
		.reverse()
		.reduce(
			(next, replacement) =>
				`${next.slice(0, replacement.start)}${replacement.value}${next.slice(replacement.end)}`,
			source,
		);
}

function isAiSourceRangeLink(markup: string): boolean {
	const parts = splitWikilink(markup);
	return Boolean(parts && /[?&](?:rangeEndCfi|rangeCfis)=/.test(parts.target));
}

function parseUnitSourceId(sourceId: string): { unit: string; paragraph: number } | null {
	const match = String(sourceId || "").match(/^U(\d{3})\.P(\d{3})$/);
	if (!match?.[1] || !match?.[2]) {
		return null;
	}
	const paragraph = Number(match[2]);
	return Number.isFinite(paragraph)
		? { unit: match[1], paragraph }
		: null;
}

function isAdjacentSourceLinkSeparator(separator: string): boolean {
	const normalized = String(separator || "");
	if (!normalized.trim()) {
		return true;
	}
	return /^[\s,，、;；/／|｜·・()（）\[\]【】<>《》]*$/.test(normalized);
}

function collapseAdjacentConsecutiveAiSourceLinks(
	markdown: string,
	resolveLink: (id: string) => string,
): string {
	const source = String(markdown || "");
	const links: Array<{
		start: number;
		end: number;
		markup: string;
		sourceId: string;
		unit: string;
		paragraph: number;
	}> = [];
	let match: RegExpExecArray | null;
	EPUB_SOURCE_WIKILINK_PATTERN.lastIndex = 0;
	while ((match = EPUB_SOURCE_WIKILINK_PATTERN.exec(source))) {
		const markup = match[0] || "";
		if (isAiSourceRangeLink(markup)) {
			continue;
		}
		const sourceId = getAiReadingSourceIdFromWikilinkTarget(match[1] || "");
		const parsed = parseUnitSourceId(sourceId);
		if (!parsed) {
			continue;
		}
		links.push({
			start: match.index,
			end: match.index + markup.length,
			markup,
			sourceId,
			unit: parsed.unit,
			paragraph: parsed.paragraph,
		});
	}
	const replacements: Array<{ start: number; end: number; value: string }> = [];
	for (let index = 0; index < links.length; index += 1) {
		const first = links[index];
		let last = first;
		let cursor = index + 1;
		while (cursor < links.length) {
			const next = links[cursor];
			const separator = source.slice(last.end, next.start);
			if (
				next.unit !== first.unit ||
				next.paragraph !== last.paragraph + 1 ||
				!isAdjacentSourceLinkSeparator(separator)
			) {
				break;
			}
			last = next;
			cursor += 1;
		}
		if (last !== first) {
			const rangeLinks = collectUnitParagraphRangeIds(first.sourceId, last.sourceId)
				.map((id) => {
					if (id === first.sourceId) return first.markup;
					if (id === last.sourceId) return last.markup;
					return resolveLink(id);
				})
				.filter(Boolean);
			replacements.push({
				start: first.start,
				end: last.end,
				value: formatAiReadingSourceRangeLink(
					first.markup,
					first.sourceId,
					last.markup,
					last.sourceId,
					rangeLinks,
				),
			});
			index = cursor - 1;
		}
	}
	return replacements
		.reverse()
		.reduce(
			(next, replacement) =>
				`${next.slice(0, replacement.start)}${replacement.value}${next.slice(replacement.end)}`,
			source,
		);
}

function enrichExistingAiSourceTitleRangeLinks(
	markdown: string,
	resolveLink: (id: string) => string,
): string {
	return String(markdown || "").replace(EPUB_SOURCE_WIKILINK_PATTERN, (link) => {
		const parts = splitWikilink(link);
		if (!parts) {
			return link;
		}
		if (/[?&]rangeEndCfi=/.test(parts.target) || /[?&]rangeCfis=/.test(parts.target)) {
			return link;
		}
		const startId = getAiReadingSourceIdFromWikilinkTarget(parts.target);
		if (!startId) {
			return link;
		}
		const rangeMatch = parts.target.match(
			/(U\d{3}\.P\d{3})\s*[-–—]\s*(U\d{3}\.P\d{3})/,
		);
		if (!rangeMatch?.[1] || !rangeMatch?.[2] || rangeMatch[1] !== startId) {
			return link;
		}
		const endId = rangeMatch[2];
		const startMatch = startId.match(/^U(\d{3})\.P(\d{3})$/);
		const endMatch = endId.match(/^U(\d{3})\.P(\d{3})$/);
		if (
			!startMatch ||
			!endMatch ||
			startMatch[1] !== endMatch[1] ||
			Number(endMatch[2]) <= Number(startMatch[2])
		) {
			return link;
		}
		const endLink = resolveLink(endId);
		if (!endLink) {
			return link;
		}
		const resolvedStartLink = resolveLink(startId) || link;
		const rangeLinks = collectUnitParagraphRangeIds(startId, endId)
			.map((id) => (id === startId ? resolvedStartLink : resolveLink(id)))
			.filter(Boolean);
		return formatAiReadingSourceRangeLink(
			resolvedStartLink,
			startId,
			endLink,
			endId,
			rangeLinks,
		);
	});
}

function ensureAiReadingSourceLinkFlash(link: string): string {
	const match = String(link || "").match(/^\[\[([^\]|]+)(\|[^\]]*)?\]\]$/);
	if (!match) {
		return link;
	}
	const target = match[1] || "";
	const aliasPart = match[2] || "";
	if (!/#(?:weave-loc|weave-cfi)=/.test(target)) {
		return link;
	}
	let nextTarget = /[?&]flashStyle=/.test(target)
		? target.replace(/([?&]flashStyle=)([^&|\]]*)/, "$1pulse")
		: `${target}&flashStyle=pulse`;
	if (!/[?&]flashColor=/.test(target)) {
		nextTarget += "&flashColor=yellow";
	}
	return `[[${nextTarget}${aliasPart}]]`;
}

function isInsideMarkdownWikilink(markdown: string, index: number): boolean {
	const before = markdown.slice(0, Math.max(0, index));
	return before.lastIndexOf("[[") > before.lastIndexOf("]]");
}

function isInsideInlineCode(markdown: string, index: number): boolean {
	const before = markdown.slice(0, Math.max(0, index));
	const ticks = before.match(/`/g);
	return Boolean(ticks && ticks.length % 2 === 1);
}

function unwrapInlineCodeAroundGeneratedSourceLinks(markdown: string): string {
	return String(markdown || "").replace(
		/`([^`\n]*\[\[[^`\n]*#(?:weave-loc|weave-cfi)=[^`\n]*\|原文\]\][^`\n]*)`/g,
		"$1",
	);
}

function getAiReadingSourceIdFromWikilinkTarget(target: string): string {
	const match = String(target || "").match(AI_SOURCE_EXCERPT_ID_PATTERN);
	if (!match) {
		return "";
	}
	return `${match[1]}.P${match[2]}`;
}

function decorateShorthandUnitSourceRanges(
	markdown: string,
	resolveLink: (id: string) => string,
	resolveRangeLink?: (startId: string, endId: string) => string,
): string {
	let current = String(markdown || "");
	const findPreviousUnitNumberInLine = (source: string, offset: number): string => {
		const lineStart = Math.max(
			source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1,
			0,
		);
		const prefix = source.slice(lineStart, Math.max(0, offset));
		let match: RegExpExecArray | null;
		let unitNumber = "";
		UNIT_REFERENCE_IN_LINE_PATTERN.lastIndex = 0;
		while ((match = UNIT_REFERENCE_IN_LINE_PATTERN.exec(prefix))) {
			unitNumber = match[1] || match[2] || unitNumber;
		}
		return unitNumber;
	};
	for (let pass = 0; pass < 8; pass += 1) {
		let changed = false;
		let next = current.replace(
			SHORTHAND_UNIT_SOURCE_RANGE_PATTERN,
			(
				match,
				startRef: string,
				unitFromWikilink: string | undefined,
				unitFromBareId: string | undefined,
				separator: string,
				paragraphNumber: string,
				offset: number,
			) => {
				if (
					isInsideInlineCode(current, offset) ||
					(!startRef.startsWith("[[") && isInsideMarkdownWikilink(current, offset))
				) {
					return match;
				}
				const unitNumber =
					unitFromWikilink || unitFromBareId || "";
				if (!unitNumber) {
					return match;
				}
				const startId = startRef.match(/U\d{3}\.P\d{3}/)?.[0] || "";
				const id = `U${unitNumber}.P${paragraphNumber}`;
				const rangeLink = startId ? resolveRangeLink?.(startId, id) : "";
				if (rangeLink) {
					changed = true;
					return rangeLink;
				}
				const link = resolveLink(id);
				if (!link) {
					return match;
				}
				changed = true;
				return `${startRef}${separator}${formatAiReadingSourceLink(link, id)}`;
			},
		);
		next = next.replace(
			/(^|[^\w|\[#])P(\d{3})(\s*[\-–—]\s*)P(\d{3})(?![\w\]])/g,
			(
				match,
				prefix: string,
				startParagraphNumber: string,
				_separator: string,
				endParagraphNumber: string,
				offset: number,
			) => {
				const paragraphOffset = offset + String(prefix || "").length;
				if (
					isInsideMarkdownWikilink(next, paragraphOffset) ||
					isInsideInlineCode(next, paragraphOffset)
				) {
					return match;
				}
				const unitNumber = findPreviousUnitNumberInLine(next, paragraphOffset);
				if (!unitNumber) {
					return match;
				}
				const startId = `U${unitNumber}.P${startParagraphNumber}`;
				const endId = `U${unitNumber}.P${endParagraphNumber}`;
				const rangeLink = resolveRangeLink?.(startId, endId);
				if (rangeLink) {
					changed = true;
					return `${prefix}${rangeLink}`;
				}
				return match;
			},
		);
		next = next.replace(
			/(^|[銆?锛?锛?\s(锛圿)P(\d{3})(\s*[鈥?\-–—]\s*)P(\d{3})(?![\w\]])/g,
			(
				match,
				prefix: string,
				startParagraphNumber: string,
				_separator: string,
				endParagraphNumber: string,
				offset: number,
			) => {
				const paragraphOffset = offset + String(prefix || "").length;
				if (
					isInsideMarkdownWikilink(next, paragraphOffset) ||
					isInsideInlineCode(next, paragraphOffset)
				) {
					return match;
				}
				const unitNumber = findPreviousUnitNumberInLine(next, paragraphOffset);
				if (!unitNumber) {
					return match;
				}
				const startId = `U${unitNumber}.P${startParagraphNumber}`;
				const endId = `U${unitNumber}.P${endParagraphNumber}`;
				const rangeLink = resolveRangeLink?.(startId, endId);
				if (rangeLink) {
					changed = true;
					return `${prefix}${rangeLink}`;
				}
				return match;
			},
		);
		next = next.replace(
			SHORTHAND_UNIT_PARAGRAPH_PATTERN,
			(match, prefix: string, paragraphNumber: string, offset: number) => {
				const paragraphOffset = offset + String(prefix || "").length;
				if (
					isInsideMarkdownWikilink(next, paragraphOffset) ||
					isInsideInlineCode(next, paragraphOffset)
				) {
					return match;
				}
				const unitNumber = findPreviousUnitNumberInLine(next, paragraphOffset);
				if (!unitNumber) {
					return match;
				}
				const id = `U${unitNumber}.P${paragraphNumber}`;
				const link = resolveLink(id);
				if (!link) {
					return match;
				}
				changed = true;
				return `${prefix}${formatAiReadingSourceLink(link, id)}`;
			},
		);
		current = next;
		if (!changed) {
			break;
		}
	}
	return current;
}

export function decorateEpubAiReadingLegacyNoteBareSourceReferences(
	markdown: string,
	contextMarkdown = "",
): string {
	const flashedSource = String(markdown || "").replace(
		EPUB_SOURCE_WIKILINK_PATTERN,
		(link) => ensureAiReadingSourceLinkFlash(link),
	);
	const flashedContext = String(contextMarkdown || "").replace(
		EPUB_SOURCE_WIKILINK_PATTERN,
		(link) => ensureAiReadingSourceLinkFlash(link),
	);
	const indexSource = [flashedContext, flashedSource].filter(Boolean).join("\n");
	const exactLinksById = new Map<string, string>();
	let fallbackLink = "";
	let linkMatch: RegExpExecArray | null;
	EPUB_SOURCE_WIKILINK_PATTERN.lastIndex = 0;
	while ((linkMatch = EPUB_SOURCE_WIKILINK_PATTERN.exec(indexSource))) {
		const target = linkMatch[1] || "";
		const alias = String(linkMatch[2] || "").trim();
		const link = linkMatch[0] || "";
		if (!fallbackLink) {
			fallbackLink = formatAiReadingSourceLink(link, alias || "source");
		}
		const sourceId = getAiReadingSourceIdFromWikilinkTarget(target);
		if (sourceId && !exactLinksById.has(sourceId)) {
			exactLinksById.set(sourceId, formatAiReadingSourceLink(link, sourceId));
		}
		if (/^U\d{3}\.P\d{3}$/.test(alias) && !exactLinksById.has(alias)) {
			exactLinksById.set(alias, formatAiReadingSourceLink(link, alias));
		}
	}
	const sourceMapBlocks = collectEpubAiReadingSourceMapBlocksById(
		parseEpubAiReadingSourceMapsFromMarkdown(indexSource),
	);
	for (const [id, block] of sourceMapBlocks) {
		const sourceLink = String(block.sourceLink || "").trim();
		if (id && sourceLink && (block.cfi || !exactLinksById.has(id))) {
			exactLinksById.set(
				id,
				formatAiReadingSourceLink(
					injectCfiIntoSourceWikilink(sourceLink, block.cfi || ""),
					id,
				),
			);
		}
	}
	if (!fallbackLink && exactLinksById.size === 0) {
		return flashedSource;
	}
	const placeholderDecorated = decorateAiReadingSourcePlaceholders(
		flashedSource,
		(id) => exactLinksById.get(id) || fallbackLink,
		(startId, endId) =>
			resolveAiReadingSourceRangeLink(
				startId,
				endId,
				(id) => exactLinksById.get(id) || fallbackLink,
			),
	);
	const enrichedExistingRangeLinks = enrichExistingAiSourceTitleRangeLinks(
		placeholderDecorated,
		(id) => exactLinksById.get(id) || fallbackLink,
	);
	const collapsedExistingRanges = collapseExistingAiSourceWikilinkRanges(
		enrichedExistingRangeLinks,
		(id) => exactLinksById.get(id) || fallbackLink,
	);
	const decoratedRanges = decorateShorthandUnitSourceRanges(
		collapsedExistingRanges,
		(id) => exactLinksById.get(id) || fallbackLink,
		(startId, endId) =>
			resolveAiReadingSourceRangeLink(
				startId,
				endId,
				(id) => exactLinksById.get(id) || fallbackLink,
			),
	);
	const source = decoratedRanges.replace(
		EPUB_SOURCE_WIKILINK_PATTERN,
		(link) => {
			const sourceId = getAiReadingSourceIdFromWikilinkTarget(splitWikilink(link)?.target || "");
			const alias = splitWikilink(link)?.alias || sourceId || "source";
			return formatAiReadingSourceLink(link, alias);
		},
	);
	const bareDecoratedSource = source.replace(
		BARE_UNIT_SOURCE_REFERENCE_PATTERN,
		(match, prefix: string, id: string, offset: number) => {
			const idOffset = offset + String(prefix || "").length;
			if (
				isInsideMarkdownWikilink(source, idOffset) ||
				isInsideInlineCode(source, idOffset)
			) {
				return match;
			}
			const link = exactLinksById.get(id) || fallbackLink;
			if (!link) {
				return match;
			}
			return `${prefix}${formatAiReadingSourceLink(link, id)}`;
		},
	);
	return unwrapInlineCodeAroundGeneratedSourceLinks(collapseAdjacentConsecutiveAiSourceLinks(
		bareDecoratedSource,
		(id) => exactLinksById.get(id) || fallbackLink,
	));
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
	const resolveBlockLink = (id: string): string => {
		const block = byId.get(id) || byId.get(normalizeSourceReferenceId(id));
		return block?.sourceLink ? formatAiReadingSourceLink(block.sourceLink, block.id) : "";
	};
	const placeholderDecorated = decorateAiReadingSourcePlaceholders(
		markdown,
		resolveBlockLink,
		(startId, endId) =>
			resolveAiReadingSourceRangeLink(startId, endId, resolveBlockLink),
	);
	const decoratedBracketReferences = String(placeholderDecorated || "").replace(
		SOURCE_REFERENCE_PATTERN,
		(match, id: string) => {
			const block = byId.get(id) || byId.get(normalizeSourceReferenceId(id));
			if (!block?.sourceLink) {
				return match;
			}
			return formatAiReadingSourceLink(block.sourceLink, block.id);
		},
	);
	const collapsedBracketRanges = collapseExistingAiSourceWikilinkRanges(
		decoratedBracketReferences,
		(id) => {
			const block = byId.get(id);
			return block?.sourceLink ? formatAiReadingSourceLink(block.sourceLink, block.id) : "";
		},
	);
	const rangeDecoratedSource = decorateShorthandUnitSourceRanges(collapsedBracketRanges, (id) => {
		const block = byId.get(id);
		return block?.sourceLink ? formatAiReadingSourceLink(block.sourceLink, block.id) : "";
	}, (startId, endId) => {
		return resolveAiReadingSourceRangeLink(startId, endId, (id) => {
			const block = byId.get(id);
			return block?.sourceLink ? formatAiReadingSourceLink(block.sourceLink, block.id) : "";
		});
	});
	const decoratedRanges = rangeDecoratedSource
		.replace(
			BARE_UNIT_SOURCE_REFERENCE_PATTERN,
			(match, prefix: string, id: string, offset: number) => {
				const idOffset = offset + String(prefix || "").length;
				if (
					isInsideMarkdownWikilink(rangeDecoratedSource, idOffset) ||
					isInsideInlineCode(rangeDecoratedSource, idOffset)
				) {
					return match;
				}
				const block = byId.get(id);
				if (!block?.sourceLink) {
					return match;
				}
				return `${prefix}${formatAiReadingSourceLink(block.sourceLink, block.id)}`;
			},
		);
	const collapsedAdjacentLinks = collapseAdjacentConsecutiveAiSourceLinks(
		decoratedRanges,
		(id) => {
			const block = byId.get(id);
			return block?.sourceLink ? formatAiReadingSourceLink(block.sourceLink, block.id) : "";
		},
	);
	return unwrapInlineCodeAroundGeneratedSourceLinks(collapsedAdjacentLinks)
		.replace(/\]\]\s*(?=\[\[)/g, "]] ");
}
