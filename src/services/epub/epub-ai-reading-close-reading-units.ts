import type { FlatTocExportItem } from "./epub-toc-export-scope";

export interface EpubAiReadingCloseReadingUnit {
	id: string;
	label: string;
	href: string;
	pathLabels: string[];
	flatIndex: number;
	depth: number;
	sourceBlockIds?: string[];
}

interface EpubAiReadingCloseReadingScope {
	label?: string;
	pathLabels?: string[];
	href?: string;
	includeDescendants?: boolean;
	flatIndex?: number;
	endFlatIndex?: number;
}

function normalizeText(value: unknown): string {
	return String(value || "").trim();
}

function normalizeInteger(value: unknown, fallback: number): number {
	const number = typeof value === "number" ? value : Number(value);
	return Number.isFinite(number) ? Math.floor(number) : fallback;
}

function normalizeDepth(value: unknown): number {
	return Math.max(0, normalizeInteger(value, 0));
}

function getBaseDepth(flatItems: FlatTocExportItem[]): number {
	const depths = (flatItems || []).map((item) => normalizeDepth(item.depth));
	return depths.length > 0 ? Math.min(...depths) : 0;
}

function getItemLabel(item: FlatTocExportItem): string {
	return normalizeText(item.label) || normalizeText(item.href) || "未命名目录";
}

function buildPathLabelsForIndex(
	flatItems: FlatTocExportItem[],
	itemIndex: number,
): string[] {
	const baseDepth = getBaseDepth(flatItems);
	const stack: string[] = [];
	for (let index = 0; index <= itemIndex; index += 1) {
		const item = flatItems[index];
		if (!item) {
			continue;
		}
		const depth = Math.max(0, normalizeDepth(item.depth) - baseDepth);
		stack.length = depth;
		stack.push(getItemLabel(item));
	}
	return stack.filter(Boolean);
}

function clampScopeIndex(
	value: unknown,
	minimum: number,
	maximum: number,
): number {
	const index = normalizeInteger(value, minimum);
	return Math.min(Math.max(index, minimum), maximum);
}

function isLeafInFlatSlice(
	item: FlatTocExportItem,
	index: number,
	candidates: FlatTocExportItem[],
): boolean {
	const next = candidates[index + 1];
	return !next || normalizeDepth(next.depth) <= normalizeDepth(item.depth);
}

export function formatEpubAiReadingUnitId(index: number): string {
	return `U${String(Math.max(0, Math.floor(index)) + 1).padStart(3, "0")}`;
}

export function formatEpubAiReadingUnitSourceBlockId(
	unitId: string,
	paragraphIndex: number,
): string {
	return `${unitId}.P${String(Math.max(0, Math.floor(paragraphIndex)) + 1).padStart(3, "0")}`;
}

export function attachSourceBlockIdsToCloseReadingUnit(
	unit: EpubAiReadingCloseReadingUnit,
	sourceBlockIds: string[],
): EpubAiReadingCloseReadingUnit {
	const ids = (sourceBlockIds || []).map(normalizeText).filter(Boolean);
	return {
		...unit,
		...(ids.length > 0 ? { sourceBlockIds: ids } : {}),
	};
}

export function buildEpubAiReadingCloseReadingUnits(
	flatItems: FlatTocExportItem[],
	scope: EpubAiReadingCloseReadingScope,
): EpubAiReadingCloseReadingUnit[] {
	if (!Array.isArray(flatItems) || flatItems.length === 0) {
		return [];
	}
	const maxIndex = flatItems.length - 1;
	const start = clampScopeIndex(scope.flatIndex, 0, maxIndex);
	const end = clampScopeIndex(scope.endFlatIndex ?? start, start, maxIndex);
	const selected = flatItems.slice(start, end + 1);
	if (selected.length === 0) {
		return [];
	}

	const descendantCandidates =
		scope.includeDescendants && selected.length > 1
			? selected.slice(1)
			: selected.slice(0, 1);
	const leaves = descendantCandidates.filter((item, index) =>
		isLeafInFlatSlice(item, index, descendantCandidates),
	);

	return leaves.map((item) => {
		const flatIndex = flatItems.indexOf(item);
		const pathLabels = buildPathLabelsForIndex(flatItems, flatIndex);
		const label = getItemLabel(item);
		return {
			id: formatEpubAiReadingUnitId(flatIndex),
			label,
			href: normalizeText(item.href),
			pathLabels: pathLabels.length > 0 ? pathLabels : [label],
			flatIndex,
			depth: normalizeDepth(item.depth),
		};
	});
}

function formatSourceBlockIdRange(ids: string[] | undefined): string {
	const sourceBlockIds = (ids || []).map(normalizeText).filter(Boolean);
	if (sourceBlockIds.length === 0) {
		return "sourceBlocks=none";
	}
	const first = sourceBlockIds[0];
	const last = sourceBlockIds[sourceBlockIds.length - 1];
	const range = first === last ? first : `${first}-${last}`;
	return `sourceBlocks=${range}`;
}

export function formatEpubAiReadingCloseReadingUnitsForPrompt(
	units: EpubAiReadingCloseReadingUnit[],
): string {
	return (units || [])
		.map((unit) => {
			const path = unit.pathLabels.length > 0 ? unit.pathLabels.join(" > ") : unit.label;
			const sourceBlocks = formatSourceBlockIdRange(unit.sourceBlockIds);
			const href = normalizeText(unit.href);
			return `${unit.id} ${path}${href ? ` href=${href}` : ""} ${sourceBlocks}`;
		})
		.join("\n");
}
