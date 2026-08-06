import type { EpubAiReadingCloseReadingUnit } from "./epub-ai-reading-close-reading-units";
import type { EpubAiReadingSourceBlock } from "./epub-ai-reading-source-blocks";

export interface EpubAiReadingSourceMapBlock {
	id: string;
	chapterHref: string;
	chapterTitle?: string;
	cfi?: string;
	sourceLink?: string;
	kind: EpubAiReadingSourceBlock["kind"];
	headingPath?: string[];
}

export interface EpubAiReadingSourceMapUnit {
	id: string;
	label: string;
	href: string;
	pathLabels: string[];
	flatIndex: number;
	depth: number;
	sourceBlockIds: string[];
}

export interface EpubAiReadingSourceMap {
	version: 1;
	filePath: string;
	chapterHref?: string;
	blocks: EpubAiReadingSourceMapBlock[];
	units: EpubAiReadingSourceMapUnit[];
}

const SOURCE_MAP_COMMENT_PATTERN =
	/<!--\s*weave-epub-ai-reading-source-map:([\s\S]*?)-->/g;

function normalizeText(value: unknown): string {
	return String(value || "").trim();
}

function normalizeStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.map(normalizeText).filter(Boolean)
		: [];
}

export function buildEpubAiReadingSourceMap(input: {
	filePath: string;
	chapterHref?: string;
	sourceBlocks?: EpubAiReadingSourceBlock[];
	closeReadingUnits?: EpubAiReadingCloseReadingUnit[];
}): EpubAiReadingSourceMap | null {
	const blocks = (input.sourceBlocks || [])
		.map((block): EpubAiReadingSourceMapBlock | null => {
			const id = normalizeText(block.id);
			if (!id) {
				return null;
			}
			return {
				id,
				chapterHref: normalizeText(block.chapterHref),
				...(normalizeText(block.chapterTitle)
					? { chapterTitle: normalizeText(block.chapterTitle) }
					: {}),
				...(normalizeText(block.cfi) ? { cfi: normalizeText(block.cfi) } : {}),
				...(normalizeText(block.sourceLink)
					? { sourceLink: normalizeText(block.sourceLink) }
					: {}),
				kind: block.kind,
				headingPath: normalizeStringArray(block.headingPath),
			};
		})
		.filter((block): block is EpubAiReadingSourceMapBlock => Boolean(block));
	if (blocks.length === 0) {
		return null;
	}
	const units = (input.closeReadingUnits || [])
		.map((unit): EpubAiReadingSourceMapUnit | null => {
			const id = normalizeText(unit.id);
			if (!id) {
				return null;
			}
			return {
				id,
				label: normalizeText(unit.label),
				href: normalizeText(unit.href),
				pathLabels: normalizeStringArray(unit.pathLabels),
				flatIndex: Number.isFinite(unit.flatIndex) ? unit.flatIndex : -1,
				depth: Number.isFinite(unit.depth) ? unit.depth : 0,
				sourceBlockIds: normalizeStringArray(unit.sourceBlockIds),
			};
		})
		.filter((unit): unit is EpubAiReadingSourceMapUnit => Boolean(unit));
	return {
		version: 1,
		filePath: normalizeText(input.filePath),
		...(normalizeText(input.chapterHref)
			? { chapterHref: normalizeText(input.chapterHref) }
			: {}),
		blocks,
		units,
	};
}

export function serializeEpubAiReadingSourceMapComment(
	sourceMap: EpubAiReadingSourceMap | null | undefined,
): string {
	if (!sourceMap || sourceMap.blocks.length === 0) {
		return "";
	}
	return `<!-- weave-epub-ai-reading-source-map:${encodeURIComponent(
		JSON.stringify(sourceMap),
	)} -->`;
}

export function parseEpubAiReadingSourceMapsFromMarkdown(
	markdown: string,
): EpubAiReadingSourceMap[] {
	const maps: EpubAiReadingSourceMap[] = [];
	const source = String(markdown || "");
	let match: RegExpExecArray | null;
	SOURCE_MAP_COMMENT_PATTERN.lastIndex = 0;
	while ((match = SOURCE_MAP_COMMENT_PATTERN.exec(source))) {
		try {
			const parsed = JSON.parse(decodeURIComponent(match[1] || ""));
			if (parsed?.version === 1 && Array.isArray(parsed.blocks)) {
				maps.push(parsed as EpubAiReadingSourceMap);
			}
		} catch {
			// Ignore malformed source maps so old notes still render.
		}
	}
	return maps;
}

export function collectEpubAiReadingSourceMapBlocksById(
	maps: EpubAiReadingSourceMap[],
): Map<string, EpubAiReadingSourceMapBlock> {
	const blocks = new Map<string, EpubAiReadingSourceMapBlock>();
	for (const map of maps || []) {
		for (const block of map.blocks || []) {
			if (block.id && !blocks.has(block.id)) {
				blocks.set(block.id, block);
			}
		}
	}
	return blocks;
}
