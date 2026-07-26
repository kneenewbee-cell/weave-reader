import type { TocItem } from "./types";
import { normalizeTocHref } from "../../utils/epub-toc-reading-position";

export const EPUB_AI_READING_ALL_SCOPE_ID = "__all__";

export type EpubAiReadingScopeKind = "toc" | "book-placeholder" | "section-fallback";

export interface EpubAiReadingScopeOption {
	id: string;
	label: string;
	isAll: boolean;
	pathIds: string[];
	pathLabels: string[];
	depth: number;
	item?: TocItem;
	flatIndex?: number;
}

export interface EpubAiReadingScopeLevel {
	depth: number;
	selectedId: string;
	options: EpubAiReadingScopeOption[];
	disabled: boolean;
}

export interface EpubAiReadingScopeSelection {
	kind: EpubAiReadingScopeKind;
	canGenerate: boolean;
	label: string;
	pathLabels: string[];
	href?: string;
	flatIndex?: number;
	depth?: number;
}

interface FlatScopeItem {
	id: string;
	label: string;
	href: string;
	depth: number;
	pathIds: string[];
	pathLabels: string[];
	item: TocItem;
	flatIndex: number;
}

interface ScopeHelperOptions {
	allLabel?: string;
}

const DEFAULT_ALL_LABEL = "\u5168\u90e8";

function normalizeScopeText(value: unknown): string {
	return String(value || "").trim();
}

function resolveItemId(item: TocItem, fallback: string): string {
	return normalizeScopeText(item.id) || normalizeScopeText(item.href) || fallback;
}

function resolveAllLabel(options?: ScopeHelperOptions): string {
	return normalizeScopeText(options?.allLabel) || DEFAULT_ALL_LABEL;
}

function flattenScopeItems(
	items: TocItem[],
	depth = 0,
	parentIds: string[] = [],
	parentLabels: string[] = [],
	output: FlatScopeItem[] = []
): FlatScopeItem[] {
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index];
		const id = resolveItemId(item, [...parentIds, String(index)].join("/"));
		const label = normalizeScopeText(item.label) || normalizeScopeText(item.href) || id;
		const flatItem: FlatScopeItem = {
			id,
			label,
			href: normalizeScopeText(item.href),
			depth,
			pathIds: [...parentIds, id],
			pathLabels: [...parentLabels, label],
			item,
			flatIndex: output.length,
		};
		output.push(flatItem);
		if (item.subitems?.length) {
			flattenScopeItems(item.subitems, depth + 1, flatItem.pathIds, flatItem.pathLabels, output);
		}
	}
	return output;
}

function getMaxDescendantDepth(items: TocItem[], depth: number): number {
	let maxDepth = Math.max(depth, 0);
	for (const item of items) {
		if (item.subitems?.length) {
			maxDepth = Math.max(maxDepth, getMaxDescendantDepth(item.subitems, depth + 1));
		}
	}
	return maxDepth;
}

function getAllOption(depth: number, pathIds: string[], pathLabels: string[], label: string): EpubAiReadingScopeOption {
	return {
		id: EPUB_AI_READING_ALL_SCOPE_ID,
		label,
		isAll: true,
		pathIds: [...pathIds, EPUB_AI_READING_ALL_SCOPE_ID],
		pathLabels: [...pathLabels, label],
		depth,
	};
}

function getItemsForPath(tocItems: TocItem[], selectedIds: string[], depth: number): TocItem[] {
	let items = tocItems;
	for (let index = 0; index < depth; index += 1) {
		const selectedId = selectedIds[index];
		if (!selectedId || selectedId === EPUB_AI_READING_ALL_SCOPE_ID) {
			return [];
		}
		const selected = items.find((item, itemIndex) => {
			const fallback = selectedIds.slice(0, index).concat(String(itemIndex)).join("/");
			return resolveItemId(item, fallback) === selectedId;
		});
		items = selected?.subitems || [];
	}
	return items;
}

export function buildEpubAiReadingScopeLevels(
	tocItems: TocItem[],
	selectedIds: string[] = [],
	options?: ScopeHelperOptions
): EpubAiReadingScopeLevel[] {
	const allLabel = resolveAllLabel(options);
	if (!Array.isArray(tocItems) || tocItems.length === 0) {
		return [];
	}

	const levels: EpubAiReadingScopeLevel[] = [];
	let items = tocItems;
	let pathIds: string[] = [];
	let pathLabels: string[] = [];
	let lockedUntilDepth: number | null = null;
	const rootMaxDepth = getMaxDescendantDepth(tocItems, 0);

	for (let depth = 0; depth <= rootMaxDepth; depth += 1) {
		if (lockedUntilDepth !== null) {
			levels.push({
				depth,
				selectedId: EPUB_AI_READING_ALL_SCOPE_ID,
				options: [getAllOption(depth, pathIds, pathLabels, allLabel)],
				disabled: true,
			});
			if (depth >= lockedUntilDepth) {
				break;
			}
			continue;
		}

		const optionItems = items;
		const itemOptions: EpubAiReadingScopeOption[] = optionItems.map((item, itemIndex) => {
			const id = resolveItemId(item, [...pathIds, String(itemIndex)].join("/"));
			const label = normalizeScopeText(item.label) || normalizeScopeText(item.href) || id;
			const flatItem = flattenScopeItems(tocItems).find(
				(candidate) => candidate.pathIds.join("\n") === [...pathIds, id].join("\n")
			);
			return {
				id,
				label,
				isAll: false,
				pathIds: [...pathIds, id],
				pathLabels: [...pathLabels, label],
				depth,
				item,
				flatIndex: flatItem?.flatIndex,
			};
		});
		const levelOptions = [getAllOption(depth, pathIds, pathLabels, allLabel), ...itemOptions];
		const requestedId = normalizeScopeText(selectedIds[depth]);
		const selectedId = levelOptions.some((option) => option.id === requestedId)
			? requestedId
			: itemOptions[0]?.id || EPUB_AI_READING_ALL_SCOPE_ID;
		levels.push({
			depth,
			selectedId,
			options: levelOptions,
			disabled: false,
		});

		if (selectedId === EPUB_AI_READING_ALL_SCOPE_ID) {
			lockedUntilDepth = getMaxDescendantDepth(optionItems, depth);
			if (depth >= lockedUntilDepth) {
				break;
			}
			continue;
		}

		const selectedItem = optionItems.find((item, itemIndex) => {
			const id = resolveItemId(item, [...pathIds, String(itemIndex)].join("/"));
			return id === selectedId;
		});
		if (!selectedItem) {
			break;
		}
		const selectedLabel =
			normalizeScopeText(selectedItem.label) || normalizeScopeText(selectedItem.href) || selectedId;
		pathIds = [...pathIds, selectedId];
		pathLabels = [...pathLabels, selectedLabel];
		items = selectedItem.subitems || [];
		if (items.length === 0) {
			break;
		}
	}

	return levels;
}

export function resolveEpubAiReadingScopeSelection(
	tocItems: TocItem[],
	selectedIds: string[] = [],
	options?: ScopeHelperOptions
): EpubAiReadingScopeSelection {
	const allLabel = resolveAllLabel(options);
	const flatItems = flattenScopeItems(tocItems);
	if (flatItems.length === 0) {
		return {
			kind: "section-fallback",
			canGenerate: true,
			label: "\u5f53\u524d\u7ae0\u8282",
			pathLabels: ["\u5f53\u524d\u7ae0\u8282"],
		};
	}

	if (!selectedIds[0] || selectedIds[0] === EPUB_AI_READING_ALL_SCOPE_ID) {
		return {
			kind: "book-placeholder",
			canGenerate: false,
			label: allLabel,
			pathLabels: [allLabel],
		};
	}

	let currentItems = tocItems;
	let selectedFlatItem: FlatScopeItem | null = null;
	for (let depth = 0; depth < selectedIds.length; depth += 1) {
		const selectedId = selectedIds[depth];
		if (selectedId === EPUB_AI_READING_ALL_SCOPE_ID) {
			break;
		}
		const selectedItem = currentItems.find((item, itemIndex) => {
			const fallback = selectedIds.slice(0, depth).concat(String(itemIndex)).join("/");
			return resolveItemId(item, fallback) === selectedId;
		});
		if (!selectedItem) {
			break;
		}
		selectedFlatItem =
			flatItems.find((item) => item.pathIds.join("\n") === selectedIds.slice(0, depth + 1).join("\n")) ||
			null;
		currentItems = selectedItem.subitems || [];
	}

	if (!selectedFlatItem) {
		const first = flatItems[0];
		return {
			kind: "toc",
			canGenerate: true,
			label: first.label,
			pathLabels: first.pathLabels,
			href: first.href,
			flatIndex: first.flatIndex,
			depth: first.depth,
		};
	}

	const hasChildAll = selectedIds[selectedFlatItem.depth + 1] === EPUB_AI_READING_ALL_SCOPE_ID;
	return {
		kind: "toc",
		canGenerate: true,
		label: selectedFlatItem.label,
		pathLabels: hasChildAll ? [...selectedFlatItem.pathLabels, allLabel] : selectedFlatItem.pathLabels,
		href: selectedFlatItem.href,
		flatIndex: selectedFlatItem.flatIndex,
		depth: selectedFlatItem.depth,
	};
}

export function resolveDefaultEpubAiReadingScopeIds(
	tocItems: TocItem[],
	currentHref: string | null | undefined
): string[] {
	const flatItems = flattenScopeItems(tocItems);
	if (flatItems.length === 0) {
		return [];
	}

	const href = normalizeScopeText(currentHref);
	const normalizedHref = normalizeTocHref(href);
	let best = href
		? flatItems.find((item) => item.href === href)
		: null;
	if (!best && normalizedHref) {
		for (const item of flatItems) {
			if (normalizeTocHref(item.href) !== normalizedHref) {
				continue;
			}
			if (!best || item.depth > best.depth) {
				best = item;
			}
		}
	}
	return (best || flatItems[0]).pathIds;
}

export function getEpubAiReadingScopeSessionKeyPart(scope: EpubAiReadingScopeSelection): string {
	return [
		scope.kind,
		normalizeScopeText(scope.href),
		String(scope.depth ?? ""),
		normalizeScopeText(scope.label),
		scope.pathLabels.map(normalizeScopeText).join(">"),
	].join("::");
}

