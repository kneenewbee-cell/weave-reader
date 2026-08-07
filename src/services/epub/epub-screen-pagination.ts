import type { EpubFlowMode, EpubLayoutMode, EpubWidthMode, TocItem } from "./types";

export interface ScreenPaginationLayoutInput {
	bookId: string;
	viewportWidth: number;
	viewportHeight: number;
	inlineWidthPx: number;
	fontSizePx: number;
	lineHeight: number;
	letterSpacing: number;
	pageMargin: number;
	gap: string;
	widthMode: EpubWidthMode;
	layoutMode: EpubLayoutMode;
	flowMode: EpubFlowMode;
}

export interface ScreenPaginationSectionMetric {
	index: number;
	href: string;
	textLength: number;
	fallbackPositionCount: number;
	fixedLayout?: boolean;
}

export interface ScreenPaginationSectionIndex {
	index: number;
	href: string;
	pageStart: number;
	pageCount: number;
}

export interface ScreenPaginationState {
	layoutKey: string;
	totalPages: number;
	sections: ScreenPaginationSectionIndex[];
	sectionByHref: Map<string, ScreenPaginationSectionIndex>;
}

export interface ScreenPageRange {
	startPage: number;
	endPage: number;
	totalPages: number;
	label: string;
}

export interface ScreenPageEstimateInput {
	textLength: number;
	viewportHeight: number;
	inlineWidthPx: number;
	fontSizePx: number;
	lineHeight: number;
	letterSpacing: number;
	layoutMode: EpubLayoutMode;
	flowMode: EpubFlowMode;
	fallbackPositionCount: number;
	fixedLayout?: boolean;
}

export interface BuildScreenPaginationStateInput {
	layout: ScreenPaginationLayoutInput;
	sections: ScreenPaginationSectionMetric[];
}

export interface ResolveScreenPageRangeInput {
	state: ScreenPaginationState;
	sectionIndex: number;
	sectionLocalPage: number;
	visiblePageCount: number;
}

export type TocItemWithScreenPage = TocItem & {
	screenPageNumber?: number;
	subitems?: TocItemWithScreenPage[];
};

const MIN_SCREEN_CAPACITY_CHARS = 120;
const MAX_SCREEN_CAPACITY_CHARS = 8000;

function finiteNumber(value: number, fallback: number): number {
	return Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: number, fallback: number): number {
	const normalized = finiteNumber(value, fallback);
	return normalized > 0 ? normalized : fallback;
}

function roundForKey(value: number): number {
	return Math.round(finiteNumber(value, 0) * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function normalizeHref(value: string): string {
	return String(value || "").split("#")[0] || String(value || "");
}

export function buildScreenPaginationLayoutKey(input: ScreenPaginationLayoutInput): string {
	return [
		input.bookId || "book",
		`vw:${Math.round(positiveNumber(input.viewportWidth, 1))}`,
		`vh:${Math.round(positiveNumber(input.viewportHeight, 1))}`,
		`iw:${Math.round(positiveNumber(input.inlineWidthPx, 1))}`,
		`fs:${roundForKey(positiveNumber(input.fontSizePx, 16))}`,
		`lh:${roundForKey(positiveNumber(input.lineHeight, 1.6))}`,
		`ls:${roundForKey(finiteNumber(input.letterSpacing, 0))}`,
		`pm:${Math.round(finiteNumber(input.pageMargin, 0))}`,
		`gap:${input.gap || "0"}`,
		`width:${input.widthMode}`,
		`layout:${input.layoutMode}`,
		`flow:${input.flowMode}`,
	].join("|");
}

export function estimateScreenPageCount(input: ScreenPageEstimateInput): number {
	const fallback = Math.max(1, Math.round(positiveNumber(input.fallbackPositionCount, 1)));
	if (input.fixedLayout) {
		return fallback;
	}

	const textLength = Math.max(0, Math.round(finiteNumber(input.textLength, 0)));
	if (textLength <= 0) {
		return fallback;
	}

	const viewportHeight = positiveNumber(input.viewportHeight, 0);
	const inlineWidthPx = positiveNumber(input.inlineWidthPx, 0);
	const fontSizePx = positiveNumber(input.fontSizePx, 16);
	const lineHeight = positiveNumber(input.lineHeight, 1.6);
	if (viewportHeight <= 0 || inlineWidthPx <= 0) {
		return fallback;
	}

	const lineHeightPx = Math.max(fontSizePx * lineHeight, fontSizePx);
	const usableLines = Math.max(1, Math.floor(viewportHeight / lineHeightPx));
	const averageCharWidth = Math.max(fontSizePx * 0.56 + Math.max(0, input.letterSpacing), 4);
	const charsPerLine = Math.max(1, Math.floor(inlineWidthPx / averageCharWidth));
	const capacity = clamp(usableLines * charsPerLine, MIN_SCREEN_CAPACITY_CHARS, MAX_SCREEN_CAPACITY_CHARS);
	return Math.max(1, Math.ceil(textLength / capacity));
}

export function buildScreenPaginationState(
	input: BuildScreenPaginationStateInput
): ScreenPaginationState {
	const sections: ScreenPaginationSectionIndex[] = [];
	const sectionByHref = new Map<string, ScreenPaginationSectionIndex>();
	let pageStart = 1;

	for (const section of input.sections) {
		const pageCount = estimateScreenPageCount({
			textLength: section.textLength,
			viewportHeight: input.layout.viewportHeight,
			inlineWidthPx: input.layout.inlineWidthPx,
			fontSizePx: input.layout.fontSizePx,
			lineHeight: input.layout.lineHeight,
			letterSpacing: input.layout.letterSpacing,
			layoutMode: input.layout.layoutMode,
			flowMode: input.layout.flowMode,
			fallbackPositionCount: section.fallbackPositionCount,
			fixedLayout: section.fixedLayout,
		});
		const indexedSection = {
			index: section.index,
			href: section.href,
			pageStart,
			pageCount,
		};
		sections.push(indexedSection);
		sectionByHref.set(normalizeHref(section.href), indexedSection);
		pageStart += pageCount;
	}

	return {
		layoutKey: buildScreenPaginationLayoutKey(input.layout),
		totalPages: Math.max(0, pageStart - 1),
		sections,
		sectionByHref,
	};
}

export function resolveScreenPageRange(input: ResolveScreenPageRangeInput): ScreenPageRange {
	const section = input.state.sections.find((item) => item.index === input.sectionIndex);
	const totalPages = Math.max(0, input.state.totalPages);
	if (!section || totalPages <= 0) {
		return {
			startPage: 0,
			endPage: 0,
			totalPages,
			label: "0",
		};
	}

	const localPage = clamp(
		Math.round(positiveNumber(input.sectionLocalPage, 1)),
		1,
		Math.max(1, section.pageCount)
	);
	const visiblePageCount = Math.max(1, Math.round(positiveNumber(input.visiblePageCount, 1)));
	const startPage = clamp(section.pageStart + localPage - 1, 1, totalPages);
	const endPage = clamp(startPage + visiblePageCount - 1, startPage, totalPages);

	return {
		startPage,
		endPage,
		totalPages,
		label: startPage === endPage ? String(startPage) : `${startPage}-${endPage}`,
	};
}

export function overrideScreenPaginationSectionPageCount(
	state: ScreenPaginationState,
	sectionIndex: number,
	pageCount: number
): ScreenPaginationState {
	const normalizedPageCount = Math.max(1, Math.round(positiveNumber(pageCount, 1)));
	let pageStart = 1;
	const sections = state.sections.map((section) => {
		const nextSection = {
			...section,
			pageStart,
			pageCount: section.index === sectionIndex ? normalizedPageCount : section.pageCount,
		};
		pageStart += nextSection.pageCount;
		return nextSection;
	});
	const sectionByHref = new Map<string, ScreenPaginationSectionIndex>();
	for (const section of sections) {
		sectionByHref.set(normalizeHref(section.href), section);
	}
	return {
		...state,
		totalPages: Math.max(0, pageStart - 1),
		sections,
		sectionByHref,
	};
}

export function cloneTocItemsWithScreenPages(
	items: TocItem[],
	resolvePage: (item: TocItem) => number | undefined
): TocItemWithScreenPage[] {
	return items.map((item) => {
		const pageNumber = resolvePage(item);
		const cloned: TocItemWithScreenPage = {
			...item,
			subitems: item.subitems
				? cloneTocItemsWithScreenPages(item.subitems, resolvePage)
				: undefined,
		};
		if (typeof pageNumber === "number" && Number.isFinite(pageNumber) && pageNumber > 0) {
			cloned.screenPageNumber = Math.round(pageNumber);
		}
		return cloned;
	});
}
