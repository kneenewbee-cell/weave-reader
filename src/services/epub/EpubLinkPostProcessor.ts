import type { App } from "obsidian";
import {
	Component,
	MarkdownPostProcessorContext,
	MarkdownRenderer,
	Notice,
	TFile,
	setIcon,
} from "obsidian";
import {
	isPdfBookFormat,
	isSupportedBookLocatorHref,
	stripSupportedBookExtension,
} from "./book-format";
import { maybeMigrateEpubLinksInMarkdownFile } from "./epub-link-content-migration";
import { EpubLinkService, type EpubLinkParams } from "./EpubLinkService";
import { resolveEpubSourceNavigationTextHint } from "./epub-source-navigation-text-hint";
import { isSupportedEpubProtocolName } from "./epub-runtime";
import { dispatchEpubDualWindowAnnotationEvent } from "./epub-dual-window";
import { resolveEpubHost } from "./epub-host";
import { EPUB_AI_READING_REQUEST_EVENT } from "./epub-ai-reading";
import {
	buildEpubAiReadingScopeLevels,
	EPUB_AI_READING_ALL_SCOPE_ID,
	resolveEpubAiReadingScopeSelection,
} from "./epub-ai-reading-scope";
import {
	parseEpubAiReadingSourceMapsFromMarkdown,
	type EpubAiReadingSourceMapBlock,
} from "./epub-ai-reading-source-map";
import type { TocItem } from "./types";
import { openBookForSourceNavigation } from "../../utils/epub-leaf-utils";

type BoundEpubLinkElement = HTMLAnchorElement & {
	__weaveEpubClickHandler?: (event: MouseEvent) => void;
	__weaveEpubBoundHref?: string;
};

type AnnotationNoteFilterMarker = HTMLElement & {
	__weaveApplyAnnotationNoteFilters?: () => void;
	__weaveFilterRefreshPending?: boolean;
	__weaveDualWindowControlsBound?: boolean;
	__weavePdfNavigationBound?: boolean;
};

type AiReadingNoteFilterMarker = HTMLElement & {
	__weaveApplyAiReadingNoteFilters?: () => void;
	__weaveAiReadingFilterRefreshPending?: boolean;
};

type AiReadingStartButtonElement = HTMLButtonElement & {
	__weaveAiReadingStartBound?: boolean;
};

interface AiReadingNoteFilterSegment {
	typeKey: string;
	typeLabel: string;
	sectionKey: string;
	sectionLabel: string;
	rangeKey: string;
	rangeHref: string;
	elements: HTMLElement[];
	groupElement: HTMLElement | null;
	text: string;
}

interface AiReadingNoteGeneratedRange {
	key: string;
	label: string;
	href: string;
	elements: HTMLElement[];
}

interface AiReadingNoteRangeAnchor {
	label: string;
	href: string;
	start: HTMLElement;
}

export interface AiReadingNoteSourceRange {
	key: string;
	label: string;
	href: string;
	markdown: string;
}

interface AiReadingSourceMarkdownSection {
	index: number;
	level: number;
	title: string;
	lines: string[];
	typeKey: string;
}

export const AI_READING_NOTE_TYPE_FILTER_OPTIONS: AnnotationNoteFilterOption[] = [
	{ value: "summary", label: "总览" },
	{ value: "core", label: "重点" },
	{ value: "knowledge", label: "知识点" },
	{ value: "quotes", label: "原文" },
	{ value: "relations", label: "关系" },
];

const RAW_EPUB_LOCATOR_WIKILINK_PATTERN =
	/\[\[([^\]\n]*#(?:weave-loc|weave-cfi)=[^\]\n]*?)\|([^\]\n]+)\]\]/g;
const AI_SOURCE_PLACEHOLDER_PATTERN =
	/\{\{\s*source\s*:\s*(U\d{3}\.P\d{3})\s*\}\}/gi;
const AI_SOURCE_RANGE_PLACEHOLDER_PATTERN =
	/\{\{\s*source-range\s*:\s*(U\d{3}\.P\d{3})\s*[-\u2010-\u2015]\s*((?:U\d{3}\.)?P\d{3})\s*\}\}/gi;

function extractEpubProtocolName(href: string): string {
	const normalizedHref = String(href || "").trim();
	if (!normalizedHref) {
		return "";
	}

	const withoutScheme = normalizedHref.startsWith("obsidian://")
		? normalizedHref.slice("obsidian://".length)
		: normalizedHref;
	return withoutScheme.split("?")[0]?.trim() || "";
}

function clearBoundEpubHandler(linkEl: BoundEpubLinkElement): void {
	if (linkEl.__weaveEpubClickHandler) {
		linkEl.removeEventListener("click", linkEl.__weaveEpubClickHandler, true);
		linkEl.removeEventListener("click", linkEl.__weaveEpubClickHandler);
		linkEl.__weaveEpubClickHandler = undefined;
	}
	linkEl.__weaveEpubBoundHref = undefined;
}

function collectEpubCalloutElements(root: HTMLElement): HTMLElement[] {
	const results: HTMLElement[] = [];
	if (root.matches('.callout[data-callout="epub"]')) {
		results.push(root);
	}
	results.push(
		...Array.from(
			root.querySelectorAll<HTMLElement>('.callout[data-callout="epub"]'),
		),
	);
	return results;
}

function extractCalloutQuoteText(linkEl: HTMLElement): string {
	const callout = linkEl.closest('.callout[data-callout="epub"]');
	if (!callout) {
		return "";
	}

	const quoteLines: string[] = [];
	for (const block of Array.from(
		callout.querySelectorAll<HTMLElement>(".callout-content blockquote p"),
	)) {
		const text = String(block.textContent || "")
			.replace(/\s+/g, " ")
			.trim();
		if (text) {
			quoteLines.push(text);
		}
	}

	if (quoteLines.length > 0) {
		return quoteLines.join("\n");
	}

	const content = callout.querySelector(".callout-content");
	if (!content) {
		return "";
	}

	return String(content.textContent || "")
		.replace(/\s+/g, " ")
		.trim();
}

function applyEpubCalloutAppearanceAttributes(root: HTMLElement): void {
	for (const calloutEl of collectEpubCalloutElements(root)) {
		const metadata = calloutEl.getAttribute("data-callout-metadata") || "";
		const appearance = EpubLinkService.parseHighlightCalloutMeta(metadata);
		const color = appearance.color || "";
		const style = appearance.style || "";

		if (color) {
			calloutEl.setAttribute("data-weave-epub-color", color);
		} else {
			calloutEl.removeAttribute("data-weave-epub-color");
		}

		if (style) {
			calloutEl.setAttribute("data-weave-epub-style", style);
		} else {
			calloutEl.removeAttribute("data-weave-epub-style");
		}
	}
}

export interface AnnotationNoteFilterOption {
	value: string;
	label: string;
}

const ANNOTATION_NOTE_FILTER_MAX_RETRY = 6;
const ANNOTATION_NOTE_FILTER_RETRY_DELAY_MS = 80;
const ANNOTATION_NOTE_FILTER_REFRESH_DELAYS_MS = [80, 240, 520];
const annotationNoteDocumentBindings = new WeakMap<Document, WeakSet<App>>();

function normalizeFilterText(value: unknown): string {
	return String(value || "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

function collectAnnotationFilterOptions(
	lines: HTMLElement[],
	valueAttr: "chapterKey" | "semanticId",
	labelAttr: "chapterTitle" | "semanticLabel",
): AnnotationNoteFilterOption[] {
	const options = new Map<string, string>();
	for (const line of lines) {
		const value = String(line.dataset[valueAttr] || "").trim();
		if (!value) {
			continue;
		}
		const label = String(line.dataset[labelAttr] || value).trim() || value;
		if (!options.has(value)) {
			options.set(value, label);
		}
	}
	return Array.from(options.entries()).map(([value, label]) => ({
		value,
		label,
	}));
}

function createAnnotationFilterSelect(
	doc: Document,
	className: string,
	ariaLabel: string,
	allLabel: string,
	options: AnnotationNoteFilterOption[],
): HTMLSelectElement {
	const select = doc.createElement("select");
	select.className = className;
	select.setAttribute("aria-label", ariaLabel);
	const allOption = doc.createElement("option");
	allOption.value = "";
	allOption.textContent = allLabel;
	select.appendChild(allOption);
	for (const option of options) {
		const optionEl = doc.createElement("option");
		optionEl.value = option.value;
		optionEl.textContent = option.label;
		select.appendChild(optionEl);
	}
	return select;
}

function getAnnotationFilterOptionsSignature(
	options: AnnotationNoteFilterOption[],
): string {
	return options
		.map((option) => `${option.value}\u0000${option.label}`)
		.join("\u0001");
}

function syncAnnotationFilterSelectOptions(
	select: HTMLSelectElement,
	allLabel: string,
	options: AnnotationNoteFilterOption[],
): void {
	const signature = getAnnotationFilterOptionsSignature(options);
	if (select.dataset.optionsSignature === signature) {
		return;
	}
	const previousValue = select.value;
	select.replaceChildren();
	const allOption = select.ownerDocument.createElement("option");
	allOption.value = "";
	allOption.textContent = allLabel;
	select.appendChild(allOption);
	for (const option of options) {
		const optionEl = select.ownerDocument.createElement("option");
		optionEl.value = option.value;
		optionEl.textContent = option.label;
		select.appendChild(optionEl);
	}
	select.value = options.some((option) => option.value === previousValue)
		? previousValue
		: "";
	select.dataset.optionsSignature = signature;
}

function findAnnotationNoteMarker(root: HTMLElement): HTMLElement | null {
	if (root.matches(".weave-annotation-note-root")) {
		return root;
	}
	return root.querySelector<HTMLElement>(".weave-annotation-note-root");
}

function resolveAnnotationNoteScope(
	marker: HTMLElement,
	fallback: HTMLElement,
): HTMLElement {
	return (
		marker.closest<HTMLElement>(
			".markdown-preview-view, .markdown-rendered, .markdown-source-view, .view-content",
		) ||
		fallback.closest<HTMLElement>(
			".markdown-preview-view, .markdown-rendered, .markdown-source-view, .view-content",
		) ||
		fallback.parentElement ||
		fallback
	);
}

function resolveAiReadingNoteScope(
	marker: HTMLElement,
	fallback: HTMLElement,
): HTMLElement | null {
	return (
		marker.closest<HTMLElement>(".markdown-preview-view") ||
		fallback.closest<HTMLElement>(".markdown-preview-view") ||
		marker.closest<HTMLElement>(".markdown-source-view") ||
		fallback.closest<HTMLElement>(".markdown-source-view") ||
		marker.closest<HTMLElement>(".view-content") ||
		fallback.closest<HTMLElement>(".view-content") ||
		marker.closest<HTMLElement>(".markdown-rendered") ||
		fallback.closest<HTMLElement>(".markdown-rendered")
	);
}

function resolveAnnotationNoteContainer(fallback: HTMLElement): HTMLElement {
	return (
		fallback.closest<HTMLElement>(
			".markdown-preview-view, .markdown-rendered, .markdown-source-view, .view-content",
		) ||
		fallback.parentElement ||
		fallback
	);
}

function findMountedAnnotationNoteMarker(
	root: HTMLElement,
): AnnotationNoteFilterMarker | null {
	const direct = findAnnotationNoteMarker(
		root,
	) as AnnotationNoteFilterMarker | null;
	if (direct) {
		return direct;
	}
	return resolveAnnotationNoteContainer(
		root,
	).querySelector<AnnotationNoteFilterMarker>(".weave-annotation-note-root");
}

function findAnnotationNoteDualWindowButton(
	target: EventTarget | null,
	scope: HTMLElement,
): HTMLButtonElement | null {
	if (!(target instanceof HTMLElement)) {
		return null;
	}
	const button = target.closest<HTMLButtonElement>(
		'[data-weave-dual-window-action="open"]',
	);
	return button && scope.contains(button) ? button : null;
}

function findAnnotationNoteLineFromEvent(
	target: EventTarget | null,
	scope: HTMLElement,
): HTMLElement | null {
	if (!(target instanceof HTMLElement)) {
		return null;
	}
	const line = target.closest<HTMLElement>(".weave-annotation-note-line");
	return line && scope.contains(line) ? line : null;
}

function isPdfAnnotationNoteMarker(marker: HTMLElement | null): boolean {
	return Boolean(
		marker?.classList.contains("weave-pdf-annotation-note-root") ||
			marker?.dataset.annotationNoteKind === "pdf"
	);
}

function isPdfAnnotationNoteScope(marker: HTMLElement | null, scope: HTMLElement): boolean {
	return (
		isPdfAnnotationNoteMarker(marker) ||
		Boolean(scope.querySelector(".weave-pdf-annotation-note-line"))
	);
}

function readPdfAnnotationNoteNavigationTarget(
	line: HTMLElement,
	marker: HTMLElement | null
): { filePath: string; annotationId: string; pageNumber?: number } | null {
	const filePath = String(line.dataset.sourceFile || marker?.dataset.sourceFile || "").trim();
	const annotationId = String(line.dataset.annotationId || "").trim();
	if (!filePath || !annotationId) {
		return null;
	}
	const rawPageNumber = Number(line.dataset.pageNumber || "");
	const pageNumber =
		Number.isFinite(rawPageNumber) && rawPageNumber > 0
			? Math.floor(rawPageNumber)
			: undefined;
	return { filePath, annotationId, pageNumber };
}

function bindPdfAnnotationNoteNavigationControls(app: App, root: HTMLElement): void {
	const marker = findMountedAnnotationNoteMarker(root);
	if (!marker && !root.querySelector(".weave-pdf-annotation-note-line")) {
		return;
	}
	const scope = marker ? resolveAnnotationNoteScope(marker, root) : resolveAnnotationNoteContainer(root);
	if (!isPdfAnnotationNoteScope(marker, scope)) {
		return;
	}
	if (marker?.dataset.dualWindowMode === "true") {
		return;
	}
	const boundTarget = (marker || scope) as AnnotationNoteFilterMarker;
	if (boundTarget.__weavePdfNavigationBound) {
		return;
	}
	boundTarget.__weavePdfNavigationBound = true;

	scope.addEventListener(
		"click",
		(event) => {
			const line = findAnnotationNoteLineFromEvent(event.target, scope);
			if (!line?.classList.contains("weave-pdf-annotation-note-line")) {
				return;
			}
			const target = readPdfAnnotationNoteNavigationTarget(line, marker);
			if (!target) {
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			void openBookForSourceNavigation(
				app,
				target.filePath,
				{
					annotationId: target.annotationId,
					pageNumber: target.pageNumber,
				},
				{ focus: true }
			);
		},
		true
	);
}

function didLeaveAnnotationNoteLine(event: MouseEvent, line: HTMLElement): boolean {
	const relatedTarget = event.relatedTarget;
	return !(relatedTarget instanceof Node && line.contains(relatedTarget));
}

function hasAnnotationNoteDualWindowTargets(root: HTMLElement): boolean {
	return Boolean(
		root.matches(
			'[data-weave-dual-window-action="open"], .weave-annotation-note-line',
		) ||
			root.querySelector(
				'[data-weave-dual-window-action="open"], .weave-annotation-note-line',
			),
	);
}

function readAnnotationNoteIdentity(
	target: HTMLElement,
	marker: AnnotationNoteFilterMarker | null,
): { bookId: string; filePath: string } {
	return {
		bookId: String(
			target.dataset.bookId || marker?.dataset.bookId || "",
		).trim(),
		filePath: String(
			target.dataset.sourceFile || marker?.dataset.sourceFile || "",
		).trim(),
	};
}

function parseOptionalDatasetNumber(value: string | undefined): number | undefined {
	const numberValue = Number(value);
	return Number.isFinite(numberValue) ? numberValue : undefined;
}

function safeResolveEpubHost(app: App): ReturnType<typeof resolveEpubHost> {
	try {
		return resolveEpubHost(app);
	} catch {
		return null;
	}
}

function bindAnnotationNoteDualWindowControls(
	app: App,
	root: HTMLElement,
): void {
	const marker = findMountedAnnotationNoteMarker(root);
	if (!marker && !hasAnnotationNoteDualWindowTargets(root)) {
		return;
	}
	const scope = marker
		? resolveAnnotationNoteScope(marker, root)
		: resolveAnnotationNoteContainer(root);
	const dualWindowMode = marker?.dataset.dualWindowMode === "true";

	const emitAnnotationEvent = (
		line: HTMLElement,
		phase: "enter" | "leave" | "click",
	): void => {
		const { bookId, filePath } = readAnnotationNoteIdentity(line, marker);
		const pageNumber = parseOptionalDatasetNumber(line.dataset.pageNumber);
		dispatchEpubDualWindowAnnotationEvent(
			scope.ownerDocument.defaultView || window,
			{
				mode: "book-annotation-note",
				phase,
				bookId,
				filePath,
				cfiRange: line.dataset.cfiRange,
				pageNumber,
				chapterIndex: parseOptionalDatasetNumber(line.dataset.chapterIndex),
				annotationId: line.dataset.annotationId,
				semanticId: line.dataset.semanticId,
				text: line.dataset.annotationText,
			},
		);
	};

	const boundTarget = (marker || scope) as AnnotationNoteFilterMarker;
	if (boundTarget.__weaveDualWindowControlsBound) {
		return;
	}
	boundTarget.__weaveDualWindowControlsBound = true;

	const handleDualWindowClick = (event: MouseEvent) => {
		const button = dualWindowMode
			? null
			: findAnnotationNoteDualWindowButton(event.target, scope);
		if (button) {
			event.preventDefault();
			event.stopPropagation();
			const { bookId, filePath } = readAnnotationNoteIdentity(button, marker);
			if (!bookId || !filePath) {
				return;
			}
			const host = safeResolveEpubHost(app);
			const isPdfNote = isPdfAnnotationNoteScope(marker, scope) || isPdfBookFormat(filePath);
			const openAnnotationNote = isPdfNote
				? host?.openPdfAnnotationNote
				: host?.openEpubAnnotationNote;
			void openAnnotationNote?.call(host, {
				bookId,
				filePath,
				dualWindowMode: true,
				openMode: "right-split",
				focus: false,
			});
			return;
		}

		const line = findAnnotationNoteLineFromEvent(event.target, scope);
		if (line) {
			emitAnnotationEvent(line, "click");
		}
	};

	scope.addEventListener("click", handleDualWindowClick, true);

	scope.addEventListener("mouseover", (event) => {
		const line = findAnnotationNoteLineFromEvent(event.target, scope);
		if (line) {
			emitAnnotationEvent(line, "enter");
		}
	});

	scope.addEventListener("mouseout", (event) => {
		const line = findAnnotationNoteLineFromEvent(event.target, scope);
		if (line && didLeaveAnnotationNoteLine(event, line)) {
			emitAnnotationEvent(line, "leave");
		}
	});
}

function bindAnnotationNoteDocumentDualWindowControls(app: App, doc: Document): void {
	let boundApps = annotationNoteDocumentBindings.get(doc);
	if (!boundApps) {
		boundApps = new WeakSet<App>();
		annotationNoteDocumentBindings.set(doc, boundApps);
	}
	if (boundApps.has(app)) {
		return;
	}
	boundApps.add(app);

	doc.addEventListener(
		"click",
		(event) => {
			const body = doc.body;
			if (!body) {
				return;
			}
			const button = findAnnotationNoteDualWindowButton(event.target, body);
			if (!button) {
				return;
			}
			const { bookId, filePath } = readAnnotationNoteIdentity(button, null);
			if (!bookId || !filePath || !isPdfBookFormat(filePath)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const host = resolveEpubHost(app);
			const openPdfAnnotationNote = host?.openPdfAnnotationNote;
			if (!openPdfAnnotationNote) {
				new Notice("PDF 双窗模式暂不可用，请重载插件");
				return;
			}
			void openPdfAnnotationNote.call(host, {
				bookId,
				filePath,
				dualWindowMode: true,
				openMode: "right-split",
				focus: false,
			}).catch(() => {
				new Notice("PDF 双窗模式打开失败");
			});
		},
		true
	);
}

function requestAnnotationNoteFilterRefresh(root: HTMLElement): void {
	const marker = findMountedAnnotationNoteMarker(root);
	if (
		!marker?.__weaveApplyAnnotationNoteFilters ||
		marker.__weaveFilterRefreshPending
	) {
		return;
	}
	marker.__weaveFilterRefreshPending = true;
	queueMicrotask(() => {
		marker.__weaveFilterRefreshPending = false;
		if (marker.isConnected) {
			marker.__weaveApplyAnnotationNoteFilters?.();
		}
	});
}

function scheduleAnnotationNoteFilterMount(
	marker: HTMLElement,
	fallback: HTMLElement,
	attempt: number,
): void {
	if (
		attempt >= ANNOTATION_NOTE_FILTER_MAX_RETRY ||
		marker.dataset.filterPending === "true"
	) {
		return;
	}
	marker.dataset.filterPending = "true";
	const activeWindow = marker.ownerDocument.defaultView || window;
	activeWindow.setTimeout(
		() => {
			marker.dataset.filterPending = "";
			const scope = resolveAnnotationNoteScope(marker, fallback);
			mountAnnotationNoteFilter(scope, attempt + 1);
		},
		attempt === 0 ? 0 : ANNOTATION_NOTE_FILTER_RETRY_DELAY_MS,
	);
}

function mountAnnotationNoteFilter(root: HTMLElement, attempt = 0): void {
	const marker = findAnnotationNoteMarker(root);
	if (!marker || marker.dataset.filterMounted === "true") {
		return;
	}
	const scope = resolveAnnotationNoteScope(marker, root);
	const isPdfNote = isPdfAnnotationNoteScope(marker, scope);
	if (scope.querySelector(".weave-annotation-note-filter")) {
		marker.dataset.filterMounted = "true";
		return;
	}

	const lines = Array.from(
		scope.querySelectorAll<HTMLElement>(".weave-annotation-note-line"),
	);
	if (lines.length === 0) {
		scheduleAnnotationNoteFilterMount(marker, root, attempt);
		return;
	}

	const doc = marker.ownerDocument;
	const toolbar = doc.createElement("div");
	toolbar.className = "weave-annotation-note-filter";
	toolbar.setAttribute("role", "search");

	const chapterSelect = createAnnotationFilterSelect(
		doc,
		"weave-annotation-note-filter-chapter",
		isPdfNote ? "页面筛选" : "章节筛选",
		isPdfNote ? "全部页面" : "全部章节",
		collectAnnotationFilterOptions(lines, "chapterKey", "chapterTitle")
	);
	const semanticSelect = createAnnotationFilterSelect(
		doc,
		"weave-annotation-note-filter-semantic",
		"语义筛选",
		"全部语义",
		collectAnnotationFilterOptions(lines, "semanticId", "semanticLabel"),
	);
	const searchInput = doc.createElement("input");
	searchInput.className = "weave-annotation-note-filter-search";
	searchInput.type = "search";
	searchInput.placeholder = "搜索标注文本";
	searchInput.setAttribute("aria-label", "搜索标注文本");
	const countEl = doc.createElement("span");
	countEl.className = "weave-annotation-note-filter-count";

	toolbar.append(chapterSelect, semanticSelect, searchInput, countEl);
	marker.insertAdjacentElement("afterend", toolbar);
	marker.dataset.filterMounted = "true";

	const collectLines = () =>
		Array.from(
			scope.querySelectorAll<HTMLElement>(".weave-annotation-note-line"),
		);

	const refreshFilterOptions = (): HTMLElement[] => {
		const currentLines = collectLines();
		syncAnnotationFilterSelectOptions(
			chapterSelect,
			isPdfNote ? "全部页面" : "全部章节",
			collectAnnotationFilterOptions(currentLines, "chapterKey", "chapterTitle")
		);
		syncAnnotationFilterSelectOptions(
			semanticSelect,
			"全部语义",
			collectAnnotationFilterOptions(
				currentLines,
				"semanticId",
				"semanticLabel",
			),
		);
		return currentLines;
	};

	const applyFilters = () => {
		const lines = refreshFilterOptions();
		const chapterValue = chapterSelect.value;
		const semanticValue = semanticSelect.value;
		const searchValue = normalizeFilterText(searchInput.value);
		const visibleChapterKeys = new Set<string>();
		let visibleCount = 0;

		for (const line of lines) {
			const matchesChapter =
				!chapterValue || line.dataset.chapterKey === chapterValue;
			const matchesSemantic =
				!semanticValue || line.dataset.semanticId === semanticValue;
			const text = normalizeFilterText(
				line.dataset.annotationText || line.textContent || "",
			);
			const matchesSearch = !searchValue || text.includes(searchValue);
			const visible = matchesChapter && matchesSemantic && matchesSearch;
			line.classList.toggle("is-hidden", !visible);
			if (visible) {
				visibleCount += 1;
				const chapterKey = String(line.dataset.chapterKey || "").trim();
				if (chapterKey) {
					visibleChapterKeys.add(chapterKey);
				}
			}
		}

		for (const chapter of Array.from(
			scope.querySelectorAll<HTMLElement>(".weave-annotation-note-chapter"),
		)) {
			const chapterKey = String(chapter.dataset.chapterKey || "").trim();
			if (!chapterKey) {
				continue;
			}
			chapter.classList.toggle(
				"is-hidden",
				!visibleChapterKeys.has(chapterKey),
			);
		}
		countEl.textContent = `${visibleCount} / ${lines.length}`;
	};

	chapterSelect.addEventListener("change", applyFilters);
	semanticSelect.addEventListener("change", applyFilters);
	searchInput.addEventListener("input", applyFilters);
	(marker as AnnotationNoteFilterMarker).__weaveApplyAnnotationNoteFilters =
		applyFilters;
	applyFilters();

	const activeWindow = marker.ownerDocument.defaultView || window;
	for (const delay of ANNOTATION_NOTE_FILTER_REFRESH_DELAYS_MS) {
		activeWindow.setTimeout(() => {
			if (marker.isConnected) {
				applyFilters();
			}
		}, delay);
	}
}

function findAiReadingNoteMarker(root: HTMLElement): HTMLElement | null {
	if (root.matches(".weave-epub-ai-reading-note-root")) {
		return root;
	}
	return root.querySelector<HTMLElement>(".weave-epub-ai-reading-note-root");
}

function findMountedAiReadingNoteMarker(
	root: HTMLElement,
): AiReadingNoteFilterMarker | null {
	const direct = findAiReadingNoteMarker(
		root,
	) as AiReadingNoteFilterMarker | null;
	if (direct) {
		return direct;
	}
	return resolveAnnotationNoteContainer(
		root,
	).querySelector<AiReadingNoteFilterMarker>(
		".weave-epub-ai-reading-note-root",
	);
}

function requestAiReadingNoteFilterRefresh(root: HTMLElement): void {
	if (root.closest(".weave-epub-ai-reading-note-source-preview")) {
		return;
	}
	const marker = findMountedAiReadingNoteMarker(root);
	if (
		!marker?.__weaveApplyAiReadingNoteFilters ||
		marker.__weaveAiReadingFilterRefreshPending
	) {
		return;
	}
	marker.__weaveAiReadingFilterRefreshPending = true;
	queueMicrotask(() => {
		marker.__weaveAiReadingFilterRefreshPending = false;
		if (marker.isConnected) {
			marker.__weaveApplyAiReadingNoteFilters?.();
		}
	});
}

function scheduleAiReadingNoteFilterMount(
	app: App,
	marker: HTMLElement,
	fallback: HTMLElement,
	attempt: number,
	sourcePath = "",
): void {
	if (
		attempt >= ANNOTATION_NOTE_FILTER_MAX_RETRY ||
		marker.dataset.aiFilterPending === "true"
	) {
		return;
	}
	marker.dataset.aiFilterPending = "true";
	const activeWindow = marker.ownerDocument.defaultView || window;
	activeWindow.setTimeout(
		() => {
			marker.dataset.aiFilterPending = "";
			mountAiReadingNoteFilter(app, fallback, attempt + 1, sourcePath);
		},
		attempt === 0 ? 0 : ANNOTATION_NOTE_FILTER_RETRY_DELAY_MS,
	);
}

function resolveAiReadingNoteType(title: string): AnnotationNoteFilterOption {
	const text = normalizeFilterText(title);
	if (/范围摘要|章节总览|本章摘要|内容概要|摘要|总览/u.test(text)) {
		return { value: "summary", label: "总览/摘要" };
	}
	if (/核心结论|主要结论|核心重点|重点/u.test(text)) {
		return { value: "core", label: "结论/重点" };
	}
	if (/关键知识点|概念\/术语|术语|知识点/u.test(text)) {
		return { value: "knowledge", label: "知识点" };
	}
	if (/按小节精读|逐小节精读|小节精读|下级小节/u.test(text)) {
		return { value: "sections", label: "小节精读" };
	}
	if (/重要原文|原文索引|原文/u.test(text)) {
		return { value: "quotes", label: "重要原文" };
	}
	if (/章节关系|小节关系|跨章关系|关系/u.test(text)) {
		return { value: "relations", label: "章节关系" };
	}
	if (/建议精读|精读路径|精读顺序|行动清单/u.test(text)) {
		return { value: "path", label: "精读路径" };
	}
	return { value: "other", label: "其他" };
}

function getAiReadingNoteBlockElement(
	element: HTMLElement,
	scope: HTMLElement,
): HTMLElement {
	const parent = element.parentElement;
	if (
		parent &&
		parent !== scope &&
		/\bel-(?:div|h[1-6]|p|ul|ol|blockquote|pre|table)\b/.test(
			parent.className,
		)
	) {
		return parent;
	}
	return element;
}

function getAiReadingNoteHostBlockElement(
	element: HTMLElement,
	scope: HTMLElement,
): HTMLElement {
	const host = element.closest<HTMLElement>(
		".el-div,.el-h1,.el-h2,.el-h3,.el-h4,.el-h5,.el-h6,.el-p,.el-ul,.el-ol,.el-blockquote,.el-pre,.el-table",
	);
	if (host && host !== scope && scope.contains(host)) {
		return host;
	}
	return element;
}

function isAfterAiReadingNoteMarker(
	element: HTMLElement,
	marker: HTMLElement,
): boolean {
	return Boolean(
		marker.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
	);
}

function getAiReadingHeadingLevel(element: HTMLElement): number {
	const match = element.tagName.match(/^H([1-6])$/i);
	return match ? Number(match[1]) : 0;
}

function createAiReadingSectionKey(label: string, index: number): string {
	const normalized = normalizeFilterText(label).replace(/\s+/g, "-");
	return `${normalized || "section"}-${index}`;
}

function normalizeAiReadingRangeKey(value: unknown): string {
	return String(value || "")
		.split(">")
		.map((part) =>
			part
				.replace(/\s+/g, " ")
				.trim()
				.replace(/\s*(?:\.{3}|…)+$/u, "")
				.trim(),
		)
		.filter(Boolean)
		.join(" > ");
}

function getAiReadingScopePathKey(pathLabels: string[]): string {
	return normalizeAiReadingRangeKey(pathLabels.join(" > "));
}

function normalizeAiReadingRangeHref(value: unknown): string {
	return String(value || "").replace(/\\/g, "/").trim();
}

function getAiReadingRangeHrefFragment(href: string): string {
	const normalized = normalizeAiReadingRangeHref(href);
	const hashIndex = normalized.indexOf("#");
	return hashIndex >= 0 ? normalized.slice(hashIndex + 1).trim() : "";
}

function aiReadingRangeHrefsMatch(candidate: string, selected: string): boolean {
	const candidateHref = normalizeAiReadingRangeHref(candidate);
	const selectedHref = normalizeAiReadingRangeHref(selected);
	if (!candidateHref || !selectedHref) {
		return false;
	}
	if (candidateHref === selectedHref) {
		return true;
	}
	const candidateFragment = getAiReadingRangeHrefFragment(candidateHref);
	const selectedFragment = getAiReadingRangeHrefFragment(selectedHref);
	return Boolean(
		candidateFragment &&
			selectedFragment &&
			candidateFragment === selectedFragment,
		);
}

function decodeHtmlAttributeValue(value: string): string {
	return String(value || "")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&gt;/g, ">")
		.replace(/&lt;/g, "<")
		.replace(/&amp;/g, "&");
}

function parseAiReadingHtmlAttributes(html: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	const attributePattern = /([A-Za-z0-9_:-]+)="([^"]*)"/g;
	let match: RegExpExecArray | null;
	while ((match = attributePattern.exec(html))) {
		attributes[match[1]] = decodeHtmlAttributeValue(match[2] || "");
	}
	return attributes;
}

function findMarkdownHeadingStartBefore(markdown: string, index: number): number {
	const before = markdown.slice(0, Math.max(0, index));
	const headingPattern = /^#{2,6}\s+.+(?:\r?\n|$)/gm;
	let match: RegExpExecArray | null;
	let start = -1;
	while ((match = headingPattern.exec(before))) {
		start = match.index;
	}
	return start >= 0 ? start : index;
}

function stripAiReadingSourceRangeMarkers(markdown: string): string {
	return String(markdown || "")
		.replace(/<!--\s*weave-epub-ai-reading:(?:start|end)[\s\S]*?-->\s*/g, "")
		.replace(
			/<div\s+class="weave-epub-ai-reading-note-root"[^>]*><\/div>\s*/g,
			"",
		)
		.replace(/^(\s*#{2,6}\s+)U\d{3,}\s+/gim, "$1")
		.trim();
}

export function collectAiReadingSourceRanges(markdown: string): AiReadingNoteSourceRange[] {
	const source = String(markdown || "");
	const markerPattern =
		/<div\s+class="weave-epub-ai-reading-note-root"[^>]*><\/div>/g;
	const anchors: Array<{
		key: string;
		label: string;
		href: string;
		markerIndex: number;
		start: number;
	}> = [];
	let match: RegExpExecArray | null;
	while ((match = markerPattern.exec(source))) {
		const attributes = parseAiReadingHtmlAttributes(match[0]);
		if (attributes["data-empty"] === "true") {
			continue;
		}
		const label =
			normalizeAiReadingRangeKey(attributes["data-scope-label"]) ||
			normalizeAiReadingRangeKey(attributes["data-chapter-href"]);
		if (!label) {
			continue;
		}
		anchors.push({
			key: label,
			label,
			href: normalizeAiReadingRangeHref(attributes["data-scope-href"]),
			markerIndex: match.index,
			start: findMarkdownHeadingStartBefore(source, match.index),
		});
	}
	const unitHeadingPattern = /^#{2,6}\s+(U\d{3,})\s+(.+?)\s*$/gim;
	let headingMatch: RegExpExecArray | null;
	while ((headingMatch = unitHeadingPattern.exec(source))) {
		const label = normalizeAiReadingRangeKey(headingMatch[2]);
		if (!label) {
			continue;
		}
		const start = headingMatch.index;
		if (
			anchors.some(
				(anchor) => anchor.start === start && anchor.key === label,
			)
		) {
			continue;
		}
		anchors.push({
			key: label,
			label,
			href: "",
			markerIndex: headingMatch.index,
			start,
		});
	}
	anchors.sort((a, b) => a.start - b.start || a.markerIndex - b.markerIndex);
	return anchors
		.map((anchor, index) => {
			const next = anchors[index + 1];
			const sectionEnd = source.indexOf(
				"<!-- weave-epub-ai-reading:end",
				anchor.markerIndex,
			);
			const end =
				next?.start ??
				(sectionEnd >= 0 ? sectionEnd : source.length);
			return {
				key: anchor.key,
				label: anchor.label,
				href: anchor.href,
				markdown: stripAiReadingSourceRangeMarkers(
					source.slice(anchor.start, end),
				),
			};
		})
		.filter((range) => range.markdown.length > 0);
}

function parseAiReadingSourceMarkdownSections(
	markdown: string,
): AiReadingSourceMarkdownSection[] {
	const lines = String(markdown || "").split(/\r?\n/);
	const sections: AiReadingSourceMarkdownSection[] = [];
	let current: AiReadingSourceMarkdownSection | null = null;
	const finishCurrent = () => {
		if (current) {
			sections.push(current);
		}
		current = null;
	};
	for (const line of lines) {
		const match = line.match(/^(#{2,6})\s+(.+?)\s*#*\s*$/);
		if (match) {
			finishCurrent();
			const title = String(match[2] || "").trim();
			current = {
				index: sections.length,
				level: match[1].length,
				title,
				lines: [line],
				typeKey: resolveAiReadingNoteType(title).value,
			};
			continue;
		}
		if (current) {
			current.lines.push(line);
		}
	}
	finishCurrent();
	return sections;
}

function getAiReadingSourceMarkdownAncestors(
	sections: AiReadingSourceMarkdownSection[],
	section: AiReadingSourceMarkdownSection,
): AiReadingSourceMarkdownSection[] {
	const ancestors: AiReadingSourceMarkdownSection[] = [];
	let level = section.level;
	for (let index = section.index - 1; index >= 0; index -= 1) {
		const candidate = sections[index];
		if (!candidate || candidate.level >= level) {
			continue;
		}
		ancestors.unshift(candidate);
		level = candidate.level;
	}
	return ancestors;
}

export function filterAiReadingSourceMarkdownByType(
	markdown: string,
	typeKey: string,
): string {
	const source = String(markdown || "").trim();
	if (!source || !typeKey) {
		return source;
	}
	const sections = parseAiReadingSourceMarkdownSections(source);
	if (sections.length === 0) {
		return "";
	}
	const selectedSections = sections.filter(
		(section) => section.typeKey === typeKey,
	);
	if (selectedSections.length === 0) {
		return "";
	}
	const emittedContext = new Set<number>();
	const blocks: string[] = [];
	for (const section of selectedSections) {
		for (const ancestor of getAiReadingSourceMarkdownAncestors(sections, section)) {
			if (emittedContext.has(ancestor.index)) {
				continue;
			}
			emittedContext.add(ancestor.index);
			blocks.push(ancestor.lines[0]);
		}
		blocks.push(section.lines.join("\n").trim());
	}
	return blocks.filter(Boolean).join("\n\n").trim();
}

function isMarkdownTFile(file: unknown): file is TFile {
	const candidate = file as { path?: unknown; extension?: unknown } | null;
	return Boolean(
		file instanceof TFile ||
			(typeof candidate?.path === "string" && candidate.extension === "md"),
	);
}

function normalizeAiReadingLookupText(value: unknown): string {
	return String(value || "")
		.replace(/\\/g, "/")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

function getAiReadingSourceFileName(sourceFilePath: string): string {
	const normalized = normalizeAiReadingLookupText(sourceFilePath);
	return normalized.split("/").pop() || normalized;
}

function getAiReadingSourceTitle(sourceFilePath: string): string {
	return stripSupportedBookExtension(getAiReadingSourceFileName(sourceFilePath));
}

function getAiReadingMarkdownFileStatKey(
	app: App,
	sourcePath: string,
): string {
	if (!sourcePath) {
		return "";
	}
	const sourceFile = app.vault.getAbstractFileByPath(sourcePath);
	if (!isMarkdownTFile(sourceFile)) {
		return "";
	}
	const stat = (sourceFile as TFile & { stat?: { mtime?: number; size?: number } })
		.stat;
	return `${Number(stat?.mtime || 0)}:${Number(stat?.size || 0)}`;
}

function scoreAiReadingNoteFileCandidate(
	file: TFile,
	sourceFilePath: string,
): number {
	const path = normalizeAiReadingLookupText(file.path);
	const sourceTitle = getAiReadingSourceTitle(sourceFilePath);
	const sourceFileName = getAiReadingSourceFileName(sourceFilePath);
	let score = 0;
	if (sourceTitle && path.includes(sourceTitle)) {
		score += 100;
	}
	if (sourceFileName && path.includes(sourceFileName)) {
		score += 80;
	}
	if (path.endsWith(".md")) {
		score += 1;
	}
	return score;
}

function aiReadingNoteMarkdownReferencesSource(
	markdown: string,
	sourceFilePath: string,
): boolean {
	const content = normalizeAiReadingLookupText(markdown);
	const source = normalizeAiReadingLookupText(sourceFilePath);
	const sourceFileName = getAiReadingSourceFileName(sourceFilePath);
	return Boolean(
		content.includes("weave-epub-ai-reading-note-root") &&
			((source && content.includes(source)) ||
				(sourceFileName && content.includes(sourceFileName))),
	);
}

async function readAiReadingNoteSourceMarkdown(
	app: App,
	sourcePath: string,
	sourceFilePath: string,
): Promise<string> {
	const seenPaths = new Set<string>();
	const readFile = async (file: TFile): Promise<string> => {
		seenPaths.add(file.path);
		return app.vault.cachedRead(file);
	};
	if (sourcePath) {
		const sourceFile = app.vault.getAbstractFileByPath(sourcePath);
		if (isMarkdownTFile(sourceFile)) {
			return readFile(sourceFile);
		}
	}
	const source = normalizeAiReadingLookupText(sourceFilePath);
	if (!source) {
		return "";
	}
	const markdownFiles = app.vault.getMarkdownFiles?.() || [];
	const candidates = markdownFiles
		.filter(isMarkdownTFile)
		.map((file) => ({
			file,
			score: scoreAiReadingNoteFileCandidate(file, sourceFilePath),
		}))
		.filter((candidate) => candidate.score > 0)
		.sort((a, b) => b.score - a.score);
	for (const { file } of candidates) {
		if (seenPaths.has(file.path)) {
			continue;
		}
		const markdown = await readFile(file);
		if (aiReadingNoteMarkdownReferencesSource(markdown, sourceFilePath)) {
			return markdown;
		}
	}
	return "";
}

function compareNodeOrder(a: HTMLElement, b: HTMLElement): number {
	if (a === b) {
		return 0;
	}
	return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
		? -1
		: 1;
}

function isBeforeNode(element: HTMLElement, boundary: HTMLElement): boolean {
	return Boolean(
		element === boundary ||
			(element.compareDocumentPosition(boundary) &
				Node.DOCUMENT_POSITION_FOLLOWING),
	);
}

function isAfterNode(element: HTMLElement, boundary: HTMLElement): boolean {
	return Boolean(
		element === boundary ||
			(boundary.compareDocumentPosition(element) &
				Node.DOCUMENT_POSITION_FOLLOWING),
	);
}

function findAiReadingRangeStart(
	marker: HTMLElement,
	scope: HTMLElement,
): HTMLElement {
	let start: HTMLElement = marker;
	for (const heading of Array.from(
		scope.querySelectorAll<HTMLElement>("h2,h3,h4"),
	)) {
		if (heading.closest(".weave-epub-ai-reading-note-filter")) {
			continue;
		}
		if (heading.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING) {
			start = heading;
		}
	}
	return start;
}

function isElementWithinAiReadingRange(
	element: HTMLElement,
	start: HTMLElement,
	end: HTMLElement | null,
): boolean {
	return (
		isAfterNode(element, start) &&
		(!end || (element !== end && isBeforeNode(element, end)))
	);
}

function getAiReadingParentRangeBase(label: string): string {
	const parts = normalizeAiReadingRangeKey(label).split(" > ").filter(Boolean);
	const last = parts[parts.length - 1];
	if (last === "全部" || last === "全书") {
		parts.pop();
	}
	return parts.join(" > ");
}

function findPreviousAiReadingRangeMarker(
	element: HTMLElement,
	markers: HTMLElement[],
): HTMLElement | null {
	let previous: HTMLElement | null = null;
	for (const marker of markers) {
		if (marker.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) {
			previous = marker;
			continue;
		}
		break;
	}
	return previous;
}

function parseAiReadingUnitHeadingRangeLabel(
	heading: HTMLElement,
	parentMarker: HTMLElement | null,
): string {
	const text = normalizeFilterText(heading.textContent || "");
	const match = text.match(/^U\d{3,}\s+(.+)$/iu);
	if (!match) {
		return "";
	}
	const parentBase = getAiReadingParentRangeBase(
		parentMarker?.dataset.scopeLabel || "",
	);
	const unitPath = normalizeAiReadingRangeKey(match[1]);
	if (!unitPath) {
		return "";
	}
	if (
		parentBase &&
		unitPath !== parentBase &&
		!unitPath.startsWith(`${parentBase} > `)
	) {
		return `${parentBase} > ${unitPath}`;
	}
	return unitPath;
}

function collectAiReadingRangeAnchors(
	marker: HTMLElement,
	scope: HTMLElement,
): AiReadingNoteRangeAnchor[] {
	const markers = Array.from(
		scope.querySelectorAll<HTMLElement>(".weave-epub-ai-reading-note-root"),
	)
		.filter(
			(item) =>
				item.dataset.empty !== "true" && !isInsideAiReadingNoteChrome(item),
		)
		.sort(compareNodeOrder);
	if (markers.length === 0 && marker.dataset.empty !== "true") {
		markers.push(marker);
	}
	const markerStarts = new Set(
		markers.map((item) => findAiReadingRangeStart(item, scope)),
	);
	const anchors: AiReadingNoteRangeAnchor[] = markers.map((item) => {
		const start = findAiReadingRangeStart(item, scope);
		return {
			label:
				normalizeAiReadingRangeKey(item.dataset.scopeLabel) ||
				normalizeAiReadingRangeKey(
					start.textContent || item.dataset.chapterHref || "当前范围",
				),
			href: normalizeAiReadingRangeHref(item.dataset.scopeHref),
			start,
		};
	});
	for (const heading of Array.from(
		scope.querySelectorAll<HTMLElement>("h2,h3,h4"),
	)) {
		if (
			markerStarts.has(heading) ||
			isInsideAiReadingNoteChrome(heading)
		) {
			continue;
		}
		const parentMarker = findPreviousAiReadingRangeMarker(heading, markers);
		const label = parseAiReadingUnitHeadingRangeLabel(heading, parentMarker);
		if (!label) {
			continue;
		}
		anchors.push({ label, href: "", start: heading });
	}
	return anchors.sort((a, b) => compareNodeOrder(a.start, b.start));
}

function collectAiReadingGeneratedRanges(
	marker: HTMLElement,
	scope: HTMLElement,
): AiReadingNoteGeneratedRange[] {
	const anchors = collectAiReadingRangeAnchors(marker, scope);
	const sourceBlocks = Array.from(
		scope.querySelectorAll<HTMLElement>(
			"h2,h3,h4,p,ul,ol,blockquote,pre,table,.weave-epub-ai-reading-note-root",
		),
	).filter(
		(element) =>
			!isInsideAiReadingNoteChrome(element),
	);
	return anchors.map((anchor, index) => {
		const end = anchors[index + 1]?.start || null;
		const elements = new Set<HTMLElement>();
		for (const sourceBlock of sourceBlocks) {
			if (isElementWithinAiReadingRange(sourceBlock, anchor.start, end)) {
				elements.add(getAiReadingNoteBlockElement(sourceBlock, scope));
			}
		}
		return {
			key: anchor.label,
			label: anchor.label,
			href: anchor.href,
			elements: Array.from(elements),
		};
	});
}

function isInsideAiReadingNoteChrome(element: HTMLElement): boolean {
	return Boolean(
		element.closest(
			".weave-epub-ai-reading-note-chrome, .weave-epub-ai-reading-note-filter, .weave-epub-ai-reading-note-missing, .weave-epub-ai-reading-note-source-preview, .weave-epub-ai-reading-empty",
		),
	);
}

function getAiReadingMutationElement(node: Node): HTMLElement | null {
	if (node instanceof HTMLElement) {
		return node;
	}
	return node.parentElement;
}

function mutationTouchesAiReadingNoteContent(
	mutations: MutationRecord[],
): boolean {
	return mutations.some((mutation) => {
		const target = getAiReadingMutationElement(mutation.target);
		if (target && isInsideAiReadingNoteChrome(target)) {
			return false;
		}
		const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
		return changedNodes.some((node) => {
			const element = getAiReadingMutationElement(node);
			return Boolean(element && !isInsideAiReadingNoteChrome(element));
		});
	});
}

function collectAiReadingOriginalContentBlocks(
	marker: HTMLElement,
	scope: HTMLElement,
): HTMLElement[] {
	const blocks = new Set<HTMLElement>();
	for (const element of Array.from(
		scope.querySelectorAll<HTMLElement>(
			[
				"h1,h2,h3,h4,h5,h6",
				"p,ul,ol,blockquote,pre,table",
				".el-div",
				".el-h1,.el-h2,.el-h3,.el-h4,.el-h5,.el-h6",
				".el-p,.el-ul,.el-ol,.el-blockquote,.el-pre,.el-table",
				".weave-epub-ai-reading-note-root",
			].join(","),
		),
	)) {
		if (
			!isAfterAiReadingNoteMarker(element, marker) ||
			isInsideAiReadingNoteChrome(element)
		) {
			continue;
		}
		blocks.add(getAiReadingNoteBlockElement(element, scope));
	}
	return Array.from(blocks);
}

function findAiReadingGeneratedRangeForElement(
	element: HTMLElement,
	ranges: AiReadingNoteGeneratedRange[],
): AiReadingNoteGeneratedRange | null {
	return (
		ranges.find((range) => range.elements.includes(element)) ||
		null
	);
}

function resolveAiReadingPendingGroupElement(
	group: { element: HTMLElement; typeKey: string } | null,
	typeKey: string,
): HTMLElement | null {
	return group?.typeKey === typeKey ? group.element : null;
}

function collectAiReadingNoteFilterSegments(
	marker: HTMLElement,
	scope: HTMLElement,
	ranges: AiReadingNoteGeneratedRange[] = collectAiReadingGeneratedRanges(
		marker,
		scope,
	),
): AiReadingNoteFilterSegment[] {
	const headingAndBody = Array.from(
		scope.querySelectorAll<HTMLElement>(
			"h2,h3,h4,p,ul,ol,blockquote,pre,table",
		),
	).filter(
		(element) =>
			isAfterAiReadingNoteMarker(element, marker) &&
			!isInsideAiReadingNoteChrome(element),
	);
	const seenBlocks = new Set<HTMLElement>();
	const segments: AiReadingNoteFilterSegment[] = [];
	let currentType: AnnotationNoteFilterOption = {
		value: "other",
		label: "其他",
	};
	let pendingGroup: { element: HTMLElement; typeKey: string } | null = null;
	let draft: Omit<AiReadingNoteFilterSegment, "text"> | null = null;

	const finishDraft = () => {
		if (!draft) {
			return;
		}
		const range = findAiReadingGeneratedRangeForElement(
			draft.elements[0],
			ranges,
		);
		const rangeKey = range?.key || "";
		const rangeHref = range?.href || "";
		if (draft.elements.length === 1 && draft.typeKey === "sections") {
			pendingGroup = {
				element: draft.elements[0],
				typeKey: draft.typeKey,
			};
			draft.elements[0].classList.add(
				"weave-epub-ai-reading-note-filtered-group",
			);
			draft = null;
			return;
		}
		for (const element of draft.elements) {
			element.classList.add("weave-epub-ai-reading-note-filtered-block");
		}
		segments.push({
			...draft,
			rangeKey,
			rangeHref,
			text: normalizeFilterText(
				draft.elements.map((element) => element.textContent || "").join(" "),
			),
		});
		draft = null;
	};

	for (const element of headingAndBody) {
		const block = getAiReadingNoteBlockElement(element, scope);
		if (seenBlocks.has(block)) {
			continue;
		}
		seenBlocks.add(block);
		const headingLevel = getAiReadingHeadingLevel(element);
		if (headingLevel === 2) {
			finishDraft();
			pendingGroup = null;
			const title = String(element.textContent || "").trim();
			currentType = resolveAiReadingNoteType(title);
			draft = {
				typeKey: currentType.value,
				typeLabel: currentType.label,
				sectionKey: createAiReadingSectionKey(title, segments.length),
				sectionLabel: title || currentType.label,
				elements: [block],
				groupElement: null,
			};
			continue;
		}
		if (headingLevel === 3 || headingLevel === 4) {
			finishDraft();
			const title = String(element.textContent || "").trim();
			const headingType = resolveAiReadingNoteType(title);
			const effectiveType =
				headingType.value === "other" ? currentType : headingType;
			draft = {
				typeKey: effectiveType.value,
				typeLabel: effectiveType.label,
				sectionKey: createAiReadingSectionKey(title, segments.length),
				sectionLabel: title || effectiveType.label,
				elements: [block],
				groupElement: resolveAiReadingPendingGroupElement(
					pendingGroup,
					effectiveType.value,
				),
			};
			continue;
		}
		if (draft) {
			draft.elements.push(block);
		}
	}
	finishDraft();
	return segments;
}

function mountAiReadingNoteFilter(
	app: App,
	root: HTMLElement,
	attempt = 0,
	sourcePath = "",
): void {
	const marker = findAiReadingNoteMarker(root);
	if (!marker || marker.dataset.aiReadingFilterMounted === "true") {
		return;
	}
	const scope = resolveAiReadingNoteScope(marker, root);
	if (!scope) {
		scheduleAiReadingNoteFilterMount(app, marker, root, attempt, sourcePath);
		return;
	}
	if (scope.querySelector(".weave-epub-ai-reading-note-filter")) {
		marker.dataset.aiReadingFilterMounted = "true";
		return;
	}
	const initialRanges = collectAiReadingGeneratedRanges(marker, scope);
	const initialSegments = collectAiReadingNoteFilterSegments(
		marker,
		scope,
		initialRanges,
	);
	const initialSourceFile = String(
		marker.dataset.sourceFile ||
			marker.getAttribute("data-source-file") ||
			"",
	).trim();
	if (
		initialSegments.length === 0 &&
		marker.dataset.empty !== "true" &&
		!scope.querySelector(".weave-epub-ai-reading-empty") &&
		!sourcePath &&
		!initialSourceFile
	) {
		scheduleAiReadingNoteFilterMount(app, marker, root, attempt, sourcePath);
		return;
	}

	const doc = marker.ownerDocument;
	const toolbar = doc.createElement("div");
	toolbar.className = "weave-epub-ai-reading-note-filter";
	toolbar.setAttribute("role", "search");

	const rangeControls = doc.createElement("div");
	rangeControls.className = "weave-epub-ai-reading-note-range-controls";
	rangeControls.setAttribute("aria-label", "AI 阅读目录范围筛选");

	const typeSelect = createAnnotationFilterSelect(
		doc,
		"weave-epub-ai-reading-note-filter-type",
		"AI 阅读内容类型筛选",
		"全部类型",
		AI_READING_NOTE_TYPE_FILTER_OPTIONS,
	);

	const countEl = doc.createElement("span");
	countEl.className = "weave-epub-ai-reading-note-filter-count";
	const renderModeEl = doc.createElement("span");
	renderModeEl.className = "weave-epub-ai-reading-note-render-mode";
	renderModeEl.dataset.mode = "mounting";
	renderModeEl.textContent = "mode: mounting";

	const missingState = doc.createElement("div");
	missingState.className = "weave-epub-ai-reading-note-missing is-hidden";
	const missingText = doc.createElement("span");
	missingText.className = "weave-epub-ai-reading-note-missing__text";
	const missingButton = doc.createElement("button");
	missingButton.type = "button";
	missingButton.className = "weave-epub-ai-reading-start";
	missingButton.textContent = "按这个范围开始 AI 阅读";
	missingState.append(missingText, missingButton);
	const sourcePreviewState = doc.createElement("div");
	sourcePreviewState.className =
		"weave-epub-ai-reading-note-source-preview is-hidden";
	sourcePreviewState.tabIndex = 0;
	const sourcePreviewHostBlock = getAiReadingNoteHostBlockElement(
		marker,
		scope,
	);
	const chrome = doc.createElement("div");
	chrome.className = "weave-epub-ai-reading-note-chrome";

	toolbar.append(rangeControls, typeSelect, countEl, renderModeEl);
	chrome.append(toolbar, missingState, sourcePreviewState);
	marker.insertAdjacentElement("afterend", chrome);
	marker.dataset.aiReadingFilterMounted = "true";

	let sourceRanges: AiReadingNoteSourceRange[] = [];
	let sourceRangesLoaded = false;
	let sourceRangesLoading = false;
	let sourceRangesLoadKey = "";
	let sourceRangesMissReloadKey = "";
	let sourcePreviewRenderId = 0;
	let sourcePreviewRenderKey = "";
	let sourcePreviewRenderedKey = "";
	let sourcePreviewComponent: Component | null = null;
	let sourcePreviewActive = false;
	let sourcePreviewShouldHideAddedOriginalContent = false;
	let sourcePreviewHidePending = false;
	let sourcePreviewHideSweepId = 0;
	let sourcePreviewHideSweepKey = "";
	let sourcePreviewObserver: MutationObserver | null = null;
	let sourcePreviewDetachedBlocks: Array<{
		element: HTMLElement;
		placeholder: Comment;
	}> = [];
	let contentFilterObserver: MutationObserver | null = null;
	let tocItems: TocItem[] = [];
	let selectedScopeIds: string[] = [EPUB_AI_READING_ALL_SCOPE_ID];
	let selectedRangeKey = "";
	let selectedRangeBaseKey = "";
	let selectedRangeHref = "";
	let selectedRangeIncludesDescendants = false;
	let selectedScopeCanGenerate = false;
	let contentFilterRefreshPending = false;

	const unloadSourcePreviewComponent = (component: Component | null) => {
		(component as unknown as { unload?: () => void } | null)?.unload?.();
	};

	const collectSourcePreviewOriginalContentBranches = (): HTMLElement[] => {
		const branches = new Set<HTMLElement>();
		let current: HTMLElement | null = sourcePreviewHostBlock;
		while (current && current !== scope) {
			const parent = current.parentElement;
			if (!parent || !scope.contains(parent)) {
				break;
			}
			for (const child of Array.from(parent.children)) {
				if (child === current) {
					continue;
				}
				if (!(child instanceof HTMLElement)) {
					continue;
				}
				if (isInsideAiReadingNoteChrome(child)) {
					continue;
				}
				branches.add(child);
			}
			current = parent;
		}
		return Array.from(branches);
	};

	const setSourcePreviewOriginalContentHidden = (
		block: HTMLElement,
		hidden: boolean,
	) => {
		if (block === sourcePreviewHostBlock || isInsideAiReadingNoteChrome(block)) {
			return;
		}
		if (hidden) {
			if (sourcePreviewDetachedBlocks.some((entry) => entry.element === block)) {
				return;
			}
			const parent = block.parentNode;
			if (!parent) {
				return;
			}
			const placeholder = doc.createComment(
				"weave-epub-ai-reading-note-original",
			);
			block.classList.add("weave-epub-ai-reading-note-source-detached");
			parent.replaceChild(placeholder, block);
			sourcePreviewDetachedBlocks.push({ element: block, placeholder });
			return;
		}
		const remaining: typeof sourcePreviewDetachedBlocks = [];
		for (const entry of sourcePreviewDetachedBlocks) {
			if (entry.element !== block) {
				remaining.push(entry);
				continue;
			}
			entry.element.classList.remove("weave-epub-ai-reading-note-source-detached");
			if (entry.placeholder.parentNode) {
				entry.placeholder.parentNode.replaceChild(
					entry.element,
					entry.placeholder,
				);
			}
		}
		sourcePreviewDetachedBlocks = remaining;
	};

	const setOriginalContentHiddenForSourcePreview = (hidden: boolean) => {
		if (!hidden) {
			for (const entry of [...sourcePreviewDetachedBlocks].reverse()) {
				entry.element.classList.remove(
					"weave-epub-ai-reading-note-source-detached",
				);
				if (entry.placeholder.parentNode) {
					entry.placeholder.parentNode.replaceChild(
						entry.element,
						entry.placeholder,
					);
				}
			}
			sourcePreviewDetachedBlocks = [];
			return;
		}
		for (const block of [
			...collectAiReadingOriginalContentBlocks(marker, scope),
			...collectSourcePreviewOriginalContentBranches(),
		]) {
			setSourcePreviewOriginalContentHidden(block, true);
		}
	};
	const hideAddedOriginalContentNodeForSourcePreview = (node: Node) => {
		if (!(node instanceof HTMLElement) || isInsideAiReadingNoteChrome(node)) {
			return;
		}
		const block = getAiReadingNoteBlockElement(node, scope);
		if (block === sourcePreviewHostBlock || isInsideAiReadingNoteChrome(block)) {
			return;
		}
		setSourcePreviewOriginalContentHidden(block, true);
	};

	const queueSourcePreviewOriginalContentHide = () => {
		if (sourcePreviewHidePending) {
			return;
		}
		sourcePreviewHidePending = true;
		queueMicrotask(() => {
			sourcePreviewHidePending = false;
			if (!scope.contains(marker)) {
				sourcePreviewObserver?.disconnect();
				sourcePreviewObserver = null;
				return;
			}
			if (sourcePreviewActive) {
				setOriginalContentHiddenForSourcePreview(true);
			}
		});
	};

	const scheduleSourcePreviewOriginalContentHideSweep = () => {
		const sweepId = ++sourcePreviewHideSweepId;
		const activeWindow = marker.ownerDocument.defaultView || window;
		for (const delay of [0, 20, 50, 100, 240, 520, 1000, 2000]) {
			activeWindow.setTimeout(() => {
				if (
					sweepId !== sourcePreviewHideSweepId ||
					!scope.contains(marker) ||
					!sourcePreviewActive
				) {
					return;
				}
				setOriginalContentHiddenForSourcePreview(true);
			}, delay);
		}
	};

	const mutationObserverConstructor =
		marker.ownerDocument.defaultView?.MutationObserver ||
		(typeof MutationObserver !== "undefined" ? MutationObserver : null);
	if (mutationObserverConstructor) {
		sourcePreviewObserver = new mutationObserverConstructor((mutations) => {
			if (!sourcePreviewActive && !sourcePreviewShouldHideAddedOriginalContent) {
				return;
			}
			const hasOriginalContentMutation = mutations.some((mutation) => {
				const target =
					mutation.target instanceof HTMLElement ? mutation.target : null;
				if (target && isInsideAiReadingNoteChrome(target)) {
					return false;
				}
				return Array.from(mutation.addedNodes).some((node) => {
					if (!(node instanceof HTMLElement)) {
						return false;
					}
					return !isInsideAiReadingNoteChrome(node);
				});
			});
			if (hasOriginalContentMutation) {
				for (const mutation of mutations) {
					for (const node of Array.from(mutation.addedNodes)) {
						hideAddedOriginalContentNodeForSourcePreview(node);
					}
				}
				if (sourcePreviewActive) {
					queueSourcePreviewOriginalContentHide();
				}
			}
		});
		sourcePreviewObserver.observe(scope, {
			childList: true,
			subtree: true,
		});
	}

	const getSourceFile = () =>
		String(
			marker.dataset.sourceFile ||
				marker.getAttribute("data-source-file") ||
				"",
		).trim() ||
		String(
			scope
				.querySelector<HTMLElement>(".weave-epub-ai-reading-note-root")
				?.getAttribute("data-source-file") ||
				"",
		).trim();

	const getSourceRangesLoadKey = () =>
		[
			String(sourcePath || "").trim(),
			getSourceFile(),
			getAiReadingMarkdownFileStatKey(app, sourcePath),
		].join("\n");

	const dispatchCurrentRangeRequest = () => {
		const filePath = getSourceFile();
		if (!filePath) {
			return;
		}
		const activeWindow = marker.ownerDocument.defaultView || window;
		dispatchAiReadingRequest(activeWindow, filePath, selectedScopeIds);
		void (async () => {
			try {
				await safeResolveEpubHost(app)?.openEpubReader?.(filePath);
				for (const delay of [120, 360]) {
					activeWindow.setTimeout(() => {
						dispatchAiReadingRequest(activeWindow, filePath, selectedScopeIds);
					}, delay);
				}
			} catch {
				// The already-open reader path above is enough for normal use.
			}
		})();
	};

	missingButton.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		dispatchCurrentRangeRequest();
	});

	const buildSourcePreviewMarkdown = (
		ranges: AiReadingNoteSourceRange[],
		typeKey = "",
	) =>
		ranges
			.map((range) =>
				filterAiReadingSourceMarkdownByType(range.markdown.trim(), typeKey),
			)
			.filter(Boolean)
			.join("\n\n---\n\n");
	const buildSourcePreviewItems = (
		ranges: AiReadingNoteSourceRange[],
		typeKey = "",
	) =>
		ranges
			.map((range) => ({
				range,
				markdown: filterAiReadingSourceMarkdownByType(
					range.markdown.trim(),
					typeKey,
				),
			}))
			.filter((item) => item.markdown.trim().length > 0);

	const renderSourceRanges = async (
		ranges: AiReadingNoteSourceRange[],
		typeKey = "",
	) => {
		const previewItems = buildSourcePreviewItems(ranges, typeKey);
		const markdown = previewItems
			.map((item) => item.markdown)
			.join("\n\n---\n\n");
		const renderKey = markdown;
		const shouldHidePreview = !markdown;
		if (
			renderKey === sourcePreviewRenderKey &&
			sourcePreviewState.classList.contains("is-hidden") === shouldHidePreview
		) {
			return;
		}
		sourcePreviewRenderKey = renderKey;
		sourcePreviewRenderedKey = "";
		const renderId = ++sourcePreviewRenderId;
		unloadSourcePreviewComponent(sourcePreviewComponent);
		sourcePreviewComponent = null;
		sourcePreviewState.replaceChildren();
		if (!markdown) {
			sourcePreviewState.classList.add("is-hidden");
			sourcePreviewRenderedKey = "";
			return;
		}
		sourcePreviewState.classList.remove("is-hidden");
		try {
			const component = new Component();
			sourcePreviewComponent = component;
			for (const item of previewItems) {
				if (renderId !== sourcePreviewRenderId) {
					unloadSourcePreviewComponent(component);
					return;
				}
				const rangeEl = sourcePreviewState.ownerDocument.createElement("div");
				rangeEl.className = "weave-epub-ai-reading-note-source-range";
				rangeEl.dataset.rangeKey = item.range.key;
				rangeEl.dataset.rangeLabel = item.range.label;
				rangeEl.dataset.rangeHref = item.range.href;
				sourcePreviewState.append(rangeEl);
				await MarkdownRenderer.render(
					app,
					item.markdown,
					rangeEl,
					sourcePath,
					component,
				);
			}
			sourcePreviewRenderedKey = renderKey;
			applyFilters();
		} catch {
			if (renderId === sourcePreviewRenderId) {
				sourcePreviewState.textContent = markdown;
				sourcePreviewRenderedKey = renderKey;
				applyFilters();
			}
		}
	};

	const loadSourceRanges = async (options: { force?: boolean } = {}) => {
		const loadKey = getSourceRangesLoadKey();
		if (!loadKey.trim() || sourceRangesLoading) {
			return;
		}
		if (
			!options.force &&
			sourceRangesLoaded &&
			sourceRangesLoadKey === loadKey
		) {
			return;
		}
		sourceRangesLoading = true;
		try {
			const markdown = await readAiReadingNoteSourceMarkdown(
				app,
				sourcePath,
				getSourceFile(),
			);
			sourceRanges = collectAiReadingSourceRanges(markdown);
			sourceRangesLoadKey = loadKey;
			sourceRangesLoaded = true;
		} catch {
			sourceRanges = [];
			sourceRangesLoadKey = loadKey;
			sourceRangesLoaded = true;
		} finally {
			sourceRangesLoading = false;
			applyFilters();
		}
	};

	const refreshFilterOptions = (): {
		ranges: AiReadingNoteGeneratedRange[];
		segments: AiReadingNoteFilterSegment[];
	} => {
		const ranges = collectAiReadingGeneratedRanges(marker, scope);
		const segments = collectAiReadingNoteFilterSegments(marker, scope, ranges);
		return { ranges, segments };
	};

	const applyFilters = () => {
		const { ranges, segments } = refreshFilterOptions();
		const typeValue = typeSelect.value;
		const visibleGroups = new Set<HTMLElement>();
		const allGroups = new Set<HTMLElement>();
		const hasRangeSelection = Boolean(selectedRangeKey);
		const canLoadSourceIndex = Boolean(sourcePath || getSourceFile());
		const domHasGeneratedRange =
			!hasRangeSelection ||
			ranges.some((range) => rangeMatchesSelection(range));
		const matchingSourceRanges =
			hasRangeSelection && sourceRangesLoaded
				? sourceRanges.filter((range) => sourceRangeMatchesSelection(range))
				: [];
		const visibleSourceRanges = typeValue
			? matchingSourceRanges.filter((range) =>
					filterAiReadingSourceMarkdownByType(range.markdown, typeValue),
				)
			: matchingSourceRanges;
		const sourcePreviewMarkdown = buildSourcePreviewMarkdown(
			visibleSourceRanges,
			typeValue,
		);
		const shouldUseSourcePreview =
			hasRangeSelection && sourceRangesLoaded && Boolean(sourcePreviewMarkdown);
		const sourcePreviewReady =
			shouldUseSourcePreview &&
			sourcePreviewRenderedKey === sourcePreviewMarkdown &&
			sourcePreviewRenderKey === sourcePreviewMarkdown &&
			!sourcePreviewState.classList.contains("is-hidden") &&
			sourcePreviewState.childNodes.length > 0;
		const hasSourcePreview = shouldUseSourcePreview;
		const needsInitialSourceLoad =
			hasRangeSelection &&
			canLoadSourceIndex &&
			(!sourceRangesLoaded ||
				(sourceRangesLoaded &&
					Boolean(sourceRangesLoadKey) &&
					sourceRangesLoadKey !== getSourceRangesLoadKey())) &&
			!sourceRangesLoading;
		if (needsInitialSourceLoad) {
			void loadSourceRanges({ force: sourceRangesLoaded });
		}
		const missReloadKey = [
			selectedRangeKey,
			selectedRangeHref,
			getSourceRangesLoadKey(),
			String(sourceRanges.length),
		].join("\n");
		const needsSourceMissReload =
			hasRangeSelection &&
			canLoadSourceIndex &&
			sourceRangesLoaded &&
			!sourceRangesLoading &&
			!hasSourcePreview &&
			!domHasGeneratedRange &&
			selectedScopeCanGenerate &&
			sourceRangesMissReloadKey !== missReloadKey;
		if (needsSourceMissReload) {
			sourceRangesMissReloadKey = missReloadKey;
			void loadSourceRanges({ force: true });
		}
		const waitingForSourceIndex =
			hasRangeSelection &&
			canLoadSourceIndex &&
			(!sourceRangesLoaded || sourceRangesLoading || needsInitialSourceLoad || needsSourceMissReload);
		const hasGeneratedRange =
			!hasRangeSelection ||
			shouldUseSourcePreview ||
			(!waitingForSourceIndex && domHasGeneratedRange);
		const hideDomRanges =
			hasRangeSelection &&
			(waitingForSourceIndex || sourcePreviewReady || !domHasGeneratedRange);
		sourcePreviewActive = sourcePreviewReady;
		sourcePreviewShouldHideAddedOriginalContent = shouldUseSourcePreview;
		const renderMode = sourcePreviewActive
			? "source-detach"
			: shouldUseSourcePreview || waitingForSourceIndex
				? "source-preview-pending"
				: hasRangeSelection
					? "dom-filter"
					: "no-selection";
		renderModeEl.dataset.mode = renderMode;
		renderModeEl.textContent = sourcePreviewActive
			? `mode: ${renderMode} · scroll: isolated`
			: `mode: ${renderMode}`;
		scope.classList.toggle(
			"weave-epub-ai-reading-note-source-active",
			sourcePreviewActive,
		);
		scope.classList.toggle(
			"weave-epub-ai-reading-note-scroll-isolated",
			sourcePreviewActive,
		);
		sourcePreviewHostBlock.classList.toggle(
			"weave-epub-ai-reading-note-source-host-active",
			sourcePreviewActive,
		);
		if (!sourcePreviewActive) {
			sourcePreviewHideSweepId += 1;
			sourcePreviewHideSweepKey = "";
			setOriginalContentHiddenForSourcePreview(false);
		}
		let visibleCount = 0;

		for (const range of ranges) {
			const matchesRange = !hideDomRanges && rangeMatchesSelection(range);
			for (const element of range.elements) {
				if (element === sourcePreviewHostBlock) {
					element.classList.remove("is-hidden");
					continue;
				}
				element.classList.add("weave-epub-ai-reading-note-range-block");
				element.classList.toggle("is-hidden", !matchesRange);
			}
		}

		for (const segment of segments) {
			if (segment.groupElement) {
				allGroups.add(segment.groupElement);
			}
			const matchesRange = segmentMatchesSelection(segment);
			const matchesType = !typeValue || segment.typeKey === typeValue;
			const visible =
				!hideDomRanges && matchesRange && matchesType && hasGeneratedRange;
			for (const element of segment.elements) {
				if (element === sourcePreviewHostBlock) {
					element.classList.remove("is-hidden");
					continue;
				}
				element.classList.toggle("is-hidden", !visible);
			}
			if (visible) {
				visibleCount += 1;
				if (segment.groupElement) {
					visibleGroups.add(segment.groupElement);
				}
			}
		}

		for (const group of allGroups) {
			group.classList.toggle("is-hidden", !visibleGroups.has(group));
		}
		countEl.textContent = shouldUseSourcePreview
			? `${visibleSourceRanges.length} / ${matchingSourceRanges.length}`
			: `${visibleCount} / ${segments.length}`;
		const shouldShowMissing = Boolean(
			selectedRangeKey &&
				!waitingForSourceIndex &&
				!hasGeneratedRange &&
				selectedScopeCanGenerate,
		);
		missingState.classList.toggle("is-hidden", !shouldShowMissing);
		missingText.textContent = shouldShowMissing
			? `当前目录范围还没有 AI 阅读内容：${selectedRangeKey}`
			: "";
		missingButton.disabled = !selectedScopeCanGenerate;
		void renderSourceRanges(
			shouldUseSourcePreview ? visibleSourceRanges : [],
			typeValue,
		);
		if (sourcePreviewActive) {
			setOriginalContentHiddenForSourcePreview(true);
			const hideSweepKey = [
				selectedRangeKey,
				selectedRangeHref,
				typeValue,
				sourcePreviewRenderedKey,
			].join("\n");
			if (hideSweepKey !== sourcePreviewHideSweepKey) {
				sourcePreviewHideSweepKey = hideSweepKey;
				scheduleSourcePreviewOriginalContentHideSweep();
			}
		}
	};

	const queueContentFilterRefresh = () => {
		if (contentFilterRefreshPending) {
			return;
		}
		contentFilterRefreshPending = true;
		const activeWindow = marker.ownerDocument.defaultView || window;
		activeWindow.setTimeout(() => {
			contentFilterRefreshPending = false;
			if (!scope.contains(marker)) {
				contentFilterObserver?.disconnect();
				contentFilterObserver = null;
				sourcePreviewObserver?.disconnect();
				sourcePreviewObserver = null;
				return;
			}
			applyFilters();
		}, 0);
	};

	if (mutationObserverConstructor) {
		contentFilterObserver = new mutationObserverConstructor((mutations) => {
			if (mutationTouchesAiReadingNoteContent(mutations)) {
				queueContentFilterRefresh();
			}
		});
		contentFilterObserver.observe(scope, {
			childList: true,
			subtree: true,
		});
	}

	const rangeMatchesSelection = (range: AiReadingNoteGeneratedRange) =>
		segmentRangeMatchesSelection(range.key) ||
		rangeHrefMatchesSelection(range.href);

	const segmentMatchesSelection = (segment: AiReadingNoteFilterSegment) =>
		segmentRangeMatchesSelection(segment.rangeKey) ||
		rangeHrefMatchesSelection(segment.rangeHref);

	const sourceRangeMatchesSelection = (range: AiReadingNoteSourceRange) =>
		segmentRangeMatchesSelection(range.key) ||
		rangeHrefMatchesSelection(range.href);

	const segmentRangeMatchesSelection = (rangeKey: string) => {
		const normalizedRangeKey = normalizeAiReadingRangeKey(rangeKey);
		if (!selectedRangeKey) {
			return true;
		}
		if (
			normalizedRangeKey === selectedRangeKey ||
			(Boolean(selectedRangeBaseKey) && normalizedRangeKey === selectedRangeBaseKey)
		) {
			return true;
		}
		return Boolean(
			selectedRangeIncludesDescendants &&
				selectedRangeBaseKey &&
				normalizedRangeKey.startsWith(`${selectedRangeBaseKey} > `),
		);
	};

	const rangeHrefMatchesSelection = (rangeHref: string) =>
		Boolean(
			selectedRangeHref &&
				aiReadingRangeHrefsMatch(rangeHref, selectedRangeHref),
		);

	const renderRangeControls = () => {
		rangeControls.replaceChildren();
		if (tocItems.length === 0) {
			const status = doc.createElement("span");
			status.className = "weave-epub-ai-reading-note-range-status";
			status.textContent = "目录范围：暂未读取到 EPUB 目录";
			rangeControls.append(status);
			selectedRangeKey = "";
			selectedRangeBaseKey = "";
			selectedRangeHref = "";
			selectedRangeIncludesDescendants = false;
			selectedScopeCanGenerate = false;
			return;
		}
		const levels = buildEpubAiReadingScopeLevels(tocItems, selectedScopeIds);
		selectedScopeIds = levels.map((level) => level.selectedId);
		const selection = resolveEpubAiReadingScopeSelection(
			tocItems,
			selectedScopeIds,
		);
		selectedRangeKey =
			selection.kind === "book-placeholder"
				? ""
				: getAiReadingScopePathKey(selection.pathLabels);
		selectedRangeIncludesDescendants = Boolean(selection.includeDescendants);
		selectedRangeBaseKey =
			selection.kind === "book-placeholder"
				? ""
				: getAiReadingScopePathKey(
						selection.includeDescendants
							? selection.pathLabels.slice(0, -1)
							: selection.pathLabels,
					);
		selectedRangeHref =
			selection.kind === "book-placeholder"
				? ""
				: normalizeAiReadingRangeHref(selection.href);
		selectedScopeCanGenerate = selection.canGenerate;
		for (const level of levels) {
			const row = doc.createElement("label");
			row.className = "weave-epub-ai-reading-note-range-row";
			const label = doc.createElement("span");
			label.className = "weave-epub-ai-reading-note-range-label";
			label.textContent = `第 ${level.depth + 1} 级`;
			const select = doc.createElement("select");
			select.className = "weave-epub-ai-reading-note-range-select";
			select.disabled = level.disabled;
			select.setAttribute("aria-label", `AI 阅读目录第 ${level.depth + 1} 级`);
			for (const option of level.options) {
				const optionEl = doc.createElement("option");
				optionEl.value = option.id;
				optionEl.textContent = option.label;
				select.append(optionEl);
			}
			select.value = level.selectedId;
			select.addEventListener("change", () => {
				selectedScopeIds = selectedScopeIds.slice(0, level.depth);
				selectedScopeIds[level.depth] = select.value;
				if (select.value !== EPUB_AI_READING_ALL_SCOPE_ID) {
					selectedScopeIds[level.depth + 1] = EPUB_AI_READING_ALL_SCOPE_ID;
				}
				renderRangeControls();
				applyFilters();
			});
			row.append(label, select);
			rangeControls.append(row);
		}
	};

	const loadRangeControls = async () => {
		const filePath = getSourceFile();
		try {
			const host = safeResolveEpubHost(app);
			const directHost = app as unknown as {
				loadPublicationTocItems?: (path: string) => Promise<TocItem[]>;
			};
			const loader = host?.loadPublicationTocItems || directHost.loadPublicationTocItems;
			const loadedToc = loader
				? await loader.call(host?.loadPublicationTocItems ? host : directHost, filePath)
				: [];
			tocItems = Array.isArray(loadedToc) ? loadedToc : [];
		} catch {
			tocItems = [];
		}
		renderRangeControls();
		applyFilters();
	};

	typeSelect.addEventListener("change", applyFilters);
	(marker as AiReadingNoteFilterMarker).__weaveApplyAiReadingNoteFilters =
		applyFilters;
	renderRangeControls();
	applyFilters();
	void loadRangeControls();
	void loadSourceRanges();

	const activeWindow = marker.ownerDocument.defaultView || window;
	for (const delay of ANNOTATION_NOTE_FILTER_REFRESH_DELAYS_MS) {
		activeWindow.setTimeout(() => {
			if (marker.isConnected) {
				applyFilters();
			}
		}, delay);
	}
}

function resolveAiReadingStartSourceFile(button: HTMLElement): string {
	const fromButton = String(button.dataset.sourceFile || "").trim();
	if (fromButton) {
		return fromButton;
	}
	const container = button.closest<HTMLElement>(".weave-epub-ai-reading-empty");
	const fromContainer = String(container?.dataset.sourceFile || "").trim();
	if (fromContainer) {
		return fromContainer;
	}
	const marker = button
		.closest(".markdown-rendered, .markdown-preview-view, .el-div")
		?.querySelector<HTMLElement>(".weave-epub-ai-reading-note-root");
	return String(marker?.dataset.sourceFile || "").trim();
}

function dispatchAiReadingRequest(
	targetWindow: Window,
	filePath: string,
	scopeIds: string[] = [],
): void {
	const detail = { filePath, scopeIds };
	targetWindow.dispatchEvent(
		new CustomEvent(EPUB_AI_READING_REQUEST_EVENT, { detail }),
	);
	if (targetWindow !== window) {
		window.dispatchEvent(
			new CustomEvent(EPUB_AI_READING_REQUEST_EVENT, { detail }),
		);
	}
}

function bindAiReadingNoteStartControls(app: App, root: HTMLElement): void {
	const buttons = Array.from(
		root.querySelectorAll<AiReadingStartButtonElement>(
			'button[data-weave-ai-reading-action="start"]',
		),
	);
	for (const button of buttons) {
		if (button.__weaveAiReadingStartBound) {
			continue;
		}
		button.__weaveAiReadingStartBound = true;
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const filePath = resolveAiReadingStartSourceFile(button);
			if (!filePath) {
				return;
			}
			const activeWindow = button.ownerDocument.defaultView || window;
			dispatchAiReadingRequest(activeWindow, filePath);
			void (async () => {
				try {
					await safeResolveEpubHost(app)?.openEpubReader?.(filePath);
					for (const delay of [120, 360]) {
						activeWindow.setTimeout(() => {
							dispatchAiReadingRequest(activeWindow, filePath);
						}, delay);
					}
				} catch {
					// The already-open reader path above is enough for normal use.
				}
			})();
		});
	}
}

function resolveProtocolLocatorHref(href: string): string | null {
	const protocolName = extractEpubProtocolName(href);
	if (!isSupportedEpubProtocolName(protocolName)) {
		return null;
	}

	try {
		const url = new URL(
			href.startsWith("obsidian://") ? href : `obsidian://${href}`,
		);
		const params = Object.fromEntries(url.searchParams.entries());
		if ((!params.file && !params.sid) || !params.cfi) {
			return null;
		}

		const parsed = EpubLinkService.parseProtocolParams(params);
		if (!parsed?.filePath || !parsed.cfi) {
			return null;
		}

		const locatorHref = EpubLinkService.buildEpubLocatorHref(
			parsed.filePath,
			parsed.cfi,
			parsed.text,
			parsed.chapter,
			parsed.sourceId,
			parsed.excerptId,
			{
				includeText: Boolean(String(parsed.text || "").trim()),
				includeChapter: parsed.chapter !== undefined,
				preferCompactLocator: true,
				flashStyle: parsed.flashStyle,
				flashColor: parsed.flashColor,
				sourceTitle: parsed.sourceTitle,
				rangeEndCfi: parsed.rangeEndCfi,
				rangeCfis: parsed.rangeCfis,
			},
		);
		return locatorHref && isSupportedBookLocatorHref(locatorHref)
			? locatorHref
			: null;
	} catch {
		return null;
	}
}

function shouldSkipRawEpubLocatorWikilinkRepair(node: Node): boolean {
	const parent = node.parentElement;
	if (!parent) {
		return true;
	}
	return Boolean(parent.closest("a, code, pre, script, style, textarea"));
}

function repairRawEpubLocatorWikilinks(root: HTMLElement): void {
	const doc = root.ownerDocument;
	const textNodes: Text[] = [];
	const walker = doc.createTreeWalker(root, 4, {
		acceptNode(node) {
			if (shouldSkipRawEpubLocatorWikilinkRepair(node)) {
				return 2;
			}
			RAW_EPUB_LOCATOR_WIKILINK_PATTERN.lastIndex = 0;
			return RAW_EPUB_LOCATOR_WIKILINK_PATTERN.test(node.nodeValue || "")
				? 1
				: 2;
		},
	});
	let current = walker.nextNode();
	while (current) {
		textNodes.push(current as Text);
		current = walker.nextNode();
	}

	for (const textNode of textNodes) {
		const source = textNode.nodeValue || "";
		RAW_EPUB_LOCATOR_WIKILINK_PATTERN.lastIndex = 0;
		let lastIndex = 0;
		let match: RegExpExecArray | null;
		const fragment = doc.createDocumentFragment();
		while ((match = RAW_EPUB_LOCATOR_WIKILINK_PATTERN.exec(source))) {
			const fullMatch = match[0] || "";
			const target = match[1] || "";
			const alias = match[2] || "";
			if (match.index > lastIndex) {
				fragment.append(doc.createTextNode(source.slice(lastIndex, match.index)));
			}
			const linkEl = doc.createElement("a");
			linkEl.setAttribute("href", target);
			linkEl.textContent = alias;
			fragment.append(linkEl);
			lastIndex = match.index + fullMatch.length;
		}
		if (lastIndex < source.length) {
			fragment.append(doc.createTextNode(source.slice(lastIndex)));
		}
		textNode.replaceWith(fragment);
	}
}

interface RenderedAiSourceLinkInfo {
	linkEl: HTMLAnchorElement;
	locatorHref: string;
	filePath: string;
	parsed: EpubLinkParams;
	id: string;
	unit: string;
	paragraph: number;
}

type AiSourceMapBlockWithFile = EpubAiReadingSourceMapBlock & {
	filePath: string;
};

function resolveAnchorLocatorHref(linkEl: HTMLAnchorElement): string {
	const rawHref =
		linkEl.getAttribute("href") || linkEl.getAttribute("data-href") || "";
	return (
		resolveProtocolLocatorHref(rawHref) ||
		(isSupportedBookLocatorHref(rawHref) ? rawHref : "")
	);
}

function getRenderedAiSourceLinkInfo(
	linkEl: HTMLAnchorElement,
): RenderedAiSourceLinkInfo | null {
	const locatorHref = resolveAnchorLocatorHref(linkEl);
	const hashIdx = locatorHref.indexOf("#");
	if (hashIdx === -1) {
		return null;
	}
	const filePath = locatorHref.substring(0, hashIdx);
	const parsed = EpubLinkService.parseEpubLink(locatorHref.substring(hashIdx));
	const excerptId = String(parsed?.excerptId || "").trim();
	const match = excerptId.match(/^ai-source-(U\d{3})-P(\d{3})$/);
	if (!parsed || !match) {
		return null;
	}
	return {
		linkEl,
		locatorHref,
		filePath,
		parsed,
		id: `${match[1]}.P${match[2]}`,
		unit: match[1],
		paragraph: Number(match[2]),
	};
}

function getAiSourceIdFromParsedLink(parsed: EpubLinkParams): {
	unit: string;
	paragraph: number;
	id: string;
} | null {
	const excerptId = String(parsed.excerptId || "").trim();
	const match = excerptId.match(/^ai-source-(U\d{3})-P(\d{3})$/);
	if (!match) {
		return null;
	}
	const paragraph = Number(match[2]);
	if (!Number.isFinite(paragraph)) {
		return null;
	}
	return {
		unit: match[1],
		paragraph,
		id: `${match[1]}.P${match[2]}`,
	};
}

function collectAiSourceCfisById(root: HTMLElement): Map<string, string> {
	const byId = new Map<string, string>();
	for (const linkEl of Array.from(root.querySelectorAll<HTMLAnchorElement>("a"))) {
		const info = getRenderedAiSourceLinkInfo(linkEl);
		if (info?.parsed.cfi && !byId.has(info.id)) {
			byId.set(info.id, info.parsed.cfi);
		}
	}
	return byId;
}

function collectAiSourceCfisByIdFromMarkdown(markdown: string): Map<string, string> {
	const byId = new Map<string, string>();
	const pattern = /\[\[([^\]|]*#(?:weave-loc|weave-cfi)=[^\]|]+)(?:\|[^\]]*)?\]\]/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(String(markdown || "")))) {
		const target = match[1] || "";
		const hashIdx = target.indexOf("#");
		if (hashIdx === -1) {
			continue;
		}
		const parsed = EpubLinkService.parseEpubLink(target.substring(hashIdx));
		if (!parsed?.cfi) {
			continue;
		}
		const source = getAiSourceIdFromParsedLink(parsed);
		if (source && !byId.has(source.id)) {
			byId.set(source.id, parsed.cfi);
		}
	}
	return byId;
}

function collectAiSourceMapBlocksByIdFromMarkdown(
	markdown: string,
): Map<string, AiSourceMapBlockWithFile> {
	const byId = new Map<string, AiSourceMapBlockWithFile>();
	for (const sourceMap of parseEpubAiReadingSourceMapsFromMarkdown(markdown)) {
		const filePath = String(sourceMap.filePath || "").trim();
		for (const block of sourceMap.blocks || []) {
			const id = String(block.id || "").trim();
			if (!id || byId.has(id)) {
				continue;
			}
			byId.set(id, { ...block, filePath });
		}
	}
	return byId;
}

async function collectAiSourceCfisByIdFromMarkdownFile(
	app: App,
	sourceMarkdownPath: string,
): Promise<Map<string, string>> {
	const path = String(sourceMarkdownPath || "").trim();
	const sourceFile = path
		? app.vault?.getAbstractFileByPath?.(path)
		: null;
	if (!(sourceFile instanceof TFile)) {
		return new Map();
	}
	const content = await app.vault.cachedRead(sourceFile);
	return collectAiSourceCfisByIdFromMarkdown(content);
}

async function collectAiSourceMapBlocksByIdFromMarkdownFile(
	app: App,
	sourceMarkdownPath: string,
): Promise<Map<string, AiSourceMapBlockWithFile>> {
	const path = String(sourceMarkdownPath || "").trim();
	const sourceFile = path
		? app.vault?.getAbstractFileByPath?.(path)
		: null;
	if (!(sourceFile instanceof TFile)) {
		return new Map();
	}
	const content = await app.vault.cachedRead(sourceFile);
	return collectAiSourceMapBlocksByIdFromMarkdown(content);
}

function collectAiSourceCfisByIdFromSourceMapBlocks(
	blocksById: Map<string, AiSourceMapBlockWithFile>,
): Map<string, string> {
	const cfisById = new Map<string, string>();
	for (const [id, block] of blocksById) {
		const cfi = String(block.cfi || "").trim();
		if (cfi && !cfisById.has(id)) {
			cfisById.set(id, cfi);
		}
	}
	return cfisById;
}

function buildAiSourceRangeMetadataFromCfiIndex(
	parsed: EpubLinkParams,
	cfisById: Map<string, string>,
	rangeTitleText = parsed.sourceTitle || "",
): { rangeEndCfi?: string; rangeCfis?: string[] } | null {
	const source = getAiSourceIdFromParsedLink(parsed);
	const range = parseAiSourceRangeIdsFromText(rangeTitleText);
	if (
		!source ||
		!range ||
		range.unit !== source.unit ||
		range.startParagraph !== source.paragraph
	) {
		return null;
	}
	const rangeCfis: string[] = [];
	for (
		let paragraph = range.startParagraph;
		paragraph <= range.endParagraph;
		paragraph += 1
	) {
		const cfi = cfisById.get(formatAiSourceId(range.unit, paragraph));
		if (cfi) {
			rangeCfis.push(cfi);
		}
	}
	const uniqueRangeCfis = Array.from(new Set(rangeCfis));
	if (uniqueRangeCfis.length <= 1) {
		return null;
	}
	const endCfi =
		cfisById.get(formatAiSourceId(range.unit, range.endParagraph)) ||
		uniqueRangeCfis[uniqueRangeCfis.length - 1];
	return {
		rangeEndCfi: endCfi,
		rangeCfis: uniqueRangeCfis,
	};
}

function getAiSourceRangeExpectedCfiCount(
	parsed: EpubLinkParams,
	rangeTitleText: string,
): number | null {
	const source = getAiSourceIdFromParsedLink(parsed);
	const range = parseAiSourceRangeIdsFromText(rangeTitleText);
	if (
		!source ||
		!range ||
		range.unit !== source.unit ||
		range.startParagraph !== source.paragraph
	) {
		return null;
	}
	return range.endParagraph - range.startParagraph + 1;
}

function shouldEnrichAiSourceRangeMetadata(
	parsed: EpubLinkParams,
	rangeTitleText: string,
	rangeCfis?: string[],
): boolean {
	const expectedCount = getAiSourceRangeExpectedCfiCount(parsed, rangeTitleText);
	if (expectedCount !== null) {
		return !rangeCfis || rangeCfis.length < expectedCount;
	}
	return !rangeCfis || rangeCfis.length <= 1;
}

function formatAiSourceId(unit: string, paragraph: number): string {
	return `${unit}.P${String(paragraph).padStart(3, "0")}`;
}

function parseAiSourceRangeIdsFromText(
	value: string,
): { unit: string; startParagraph: number; endParagraph: number } | null {
	const match = String(value || "").match(
		/\b(U\d{3})\.P(\d{3})\s*[-\u2010-\u2015]\s*(?:(U\d{3})\.)?P(\d{3})\b/i,
	);
	if (!match) {
		return null;
	}
	const startUnit = match[1].toUpperCase();
	const endUnit = (match[3] || startUnit).toUpperCase();
	const startParagraph = Number(match[2]);
	const endParagraph = Number(match[4]);
	if (
		startUnit !== endUnit ||
		!Number.isFinite(startParagraph) ||
		!Number.isFinite(endParagraph) ||
		endParagraph <= startParagraph
	) {
		return null;
	}
	return { unit: startUnit, startParagraph, endParagraph };
}

function normalizeAiSourceId(value: string): string {
	const match = String(value || "")
		.trim()
		.match(/^(U\d{3})\.P(\d{3})$/i);
	return match ? `${match[1].toUpperCase()}.P${match[2]}` : "";
}

function resolveAiSourceRangeEndId(
	startId: string,
	endRawId: string,
): string {
	const startMatch = normalizeAiSourceId(startId).match(/^(U\d{3})\.P\d{3}$/);
	const endText = String(endRawId || "").trim();
	if (/^P\d{3}$/i.test(endText) && startMatch) {
		return `${startMatch[1]}.${endText.toUpperCase()}`;
	}
	return normalizeAiSourceId(endText);
}

function parseAiSourceWikilinkTarget(sourceLink: string): string {
	const match = String(sourceLink || "").match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
	return String(match?.[1] || sourceLink || "").trim();
}

function getLocatorHrefFromSourceMapBlock(
	block: AiSourceMapBlockWithFile,
): string {
	const sourceTarget = parseAiSourceWikilinkTarget(block.sourceLink || "");
	if (sourceTarget) {
		const locatorHref =
			resolveProtocolLocatorHref(sourceTarget) ||
			(isSupportedBookLocatorHref(sourceTarget) ? sourceTarget : "");
		if (locatorHref) {
			return locatorHref;
		}
	}
	const filePath = String(block.filePath || "").trim();
	const cfi = String(block.cfi || "").trim();
	if (!filePath || !cfi) {
		return "";
	}
	const excerptId = normalizeAiSourceId(block.id).replace(".", "-");
	return EpubLinkService.buildEpubLocatorHref(
		filePath,
		cfi,
		"",
		undefined,
		undefined,
		`ai-source-${excerptId}`,
		{
			preferCompactLocator: true,
			flashStyle: "pulse",
			flashColor: "yellow",
			sourceTitle: `原文：${block.id}`,
		},
	);
}

function buildAiSourceLocatorHrefFromSourceMap(
	blocksById: Map<string, AiSourceMapBlockWithFile>,
	startId: string,
	endId?: string,
): { href: string; title: string } | null {
	const normalizedStartId = normalizeAiSourceId(startId);
	const startBlock = blocksById.get(normalizedStartId);
	if (!normalizedStartId || !startBlock) {
		return null;
	}
	const startHref = getLocatorHrefFromSourceMapBlock(startBlock);
	const hashIdx = startHref.indexOf("#");
	if (hashIdx === -1) {
		return null;
	}
	const filePath = startHref.substring(0, hashIdx);
	const parsed = EpubLinkService.parseEpubLink(startHref.substring(hashIdx));
	if (!parsed?.cfi) {
		return null;
	}
	const normalizedEndId = endId ? normalizeAiSourceId(endId) : "";
	if (!normalizedEndId || normalizedEndId === normalizedStartId) {
		const title = `原文：${normalizedStartId}`;
		const href = EpubLinkService.buildEpubLocatorHref(
			filePath || startBlock.filePath,
			parsed.cfi,
			parsed.text,
			parsed.chapter,
			parsed.sourceId,
			parsed.excerptId,
			{
				includeText: Boolean(String(parsed.text || "").trim()),
				includeChapter: parsed.chapter !== undefined,
				preferCompactLocator: true,
				flashStyle: "pulse",
				flashColor: parsed.flashColor || "yellow",
				sourceTitle: title,
			},
		);
		return href ? { href, title } : null;
	}
	const range = parseAiSourceRangeIdsFromText(
		`${normalizedStartId}-${normalizedEndId}`,
	);
	if (!range) {
		return null;
	}
	const rangeCfis: string[] = [];
	for (
		let paragraph = range.startParagraph;
		paragraph <= range.endParagraph;
		paragraph += 1
	) {
		const block = blocksById.get(formatAiSourceId(range.unit, paragraph));
		const cfi = String(block?.cfi || "").trim();
		if (cfi) {
			rangeCfis.push(cfi);
		}
	}
	const uniqueRangeCfis = Array.from(new Set(rangeCfis));
	if (uniqueRangeCfis.length === 0) {
		uniqueRangeCfis.push(parsed.cfi);
	}
	const endBlock = blocksById.get(normalizedEndId);
	const rangeEndCfi =
		String(endBlock?.cfi || "").trim() ||
		uniqueRangeCfis[uniqueRangeCfis.length - 1] ||
		parsed.cfi;
	const title = `原文范围：${normalizedStartId}-${normalizedEndId}`;
	const href = EpubLinkService.buildEpubLocatorHref(
		filePath || startBlock.filePath,
		parsed.cfi,
		parsed.text,
		parsed.chapter,
		parsed.sourceId,
		parsed.excerptId,
		{
			includeText: Boolean(String(parsed.text || "").trim()),
			includeChapter: parsed.chapter !== undefined,
			preferCompactLocator: true,
			flashStyle: "pulse",
			flashColor: parsed.flashColor || "yellow",
			sourceTitle: title,
			rangeEndCfi,
			rangeCfis: uniqueRangeCfis,
		},
	);
	return href ? { href, title } : null;
}

function shouldSkipAiSourcePlaceholderRender(node: Node): boolean {
	const parent = node.parentElement;
	if (!parent) {
		return true;
	}
	return Boolean(parent.closest("a, code, pre, script, style, textarea"));
}

function hasAiSourcePlaceholderText(root: HTMLElement): boolean {
	const text = String(root.textContent || "");
	AI_SOURCE_PLACEHOLDER_PATTERN.lastIndex = 0;
	AI_SOURCE_RANGE_PLACEHOLDER_PATTERN.lastIndex = 0;
	return (
		AI_SOURCE_PLACEHOLDER_PATTERN.test(text) ||
		AI_SOURCE_RANGE_PLACEHOLDER_PATTERN.test(text)
	);
}

function renderAiSourcePlaceholdersFromSourceMap(
	app: App,
	root: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	const sourcePath = String(ctx?.sourcePath || "").trim();
	if (
		!sourcePath ||
		typeof app.vault?.getAbstractFileByPath !== "function" ||
		typeof app.vault?.cachedRead !== "function" ||
		!hasAiSourcePlaceholderText(root)
	) {
		return;
	}

	queueMicrotask(() => {
		void (async () => {
			let blocksById: Map<string, AiSourceMapBlockWithFile>;
			try {
				blocksById = await collectAiSourceMapBlocksByIdFromMarkdownFile(
					app,
					sourcePath,
				);
			} catch {
				return;
			}
			if (blocksById.size === 0) {
				return;
			}

			const doc = root.ownerDocument;
			const textNodes: Text[] = [];
			const walker = doc.createTreeWalker(root, 4, {
				acceptNode(node) {
					if (shouldSkipAiSourcePlaceholderRender(node)) {
						return 2;
					}
					const text = node.nodeValue || "";
					AI_SOURCE_PLACEHOLDER_PATTERN.lastIndex = 0;
					AI_SOURCE_RANGE_PLACEHOLDER_PATTERN.lastIndex = 0;
					return AI_SOURCE_PLACEHOLDER_PATTERN.test(text) ||
						AI_SOURCE_RANGE_PLACEHOLDER_PATTERN.test(text)
						? 1
						: 2;
				},
			});
			let current = walker.nextNode();
			while (current) {
				textNodes.push(current as Text);
				current = walker.nextNode();
			}

			for (const textNode of textNodes) {
				const source = textNode.nodeValue || "";
				const tokenPattern =
					/\{\{\s*(source-range|source)\s*:\s*(U\d{3}\.P\d{3})(?:\s*[-\u2010-\u2015]\s*((?:U\d{3}\.)?P\d{3}))?\s*\}\}/gi;
				let lastIndex = 0;
				let match: RegExpExecArray | null;
				const fragment = doc.createDocumentFragment();
				while ((match = tokenPattern.exec(source))) {
					const fullMatch = match[0] || "";
					const kind = String(match[1] || "").toLowerCase();
					const startId = normalizeAiSourceId(match[2] || "");
					const endId =
						kind === "source-range"
							? resolveAiSourceRangeEndId(startId, match[3] || "")
							: "";
					if (match.index > lastIndex) {
						fragment.append(doc.createTextNode(source.slice(lastIndex, match.index)));
					}
					const locator = buildAiSourceLocatorHrefFromSourceMap(
						blocksById,
						startId,
						endId,
					);
					if (locator) {
						const linkEl = doc.createElement("a");
						linkEl.setAttribute("href", locator.href);
						linkEl.setAttribute("title", locator.title);
						linkEl.setAttribute("aria-label", locator.title);
						linkEl.setAttribute("data-tooltip-position", "top");
						linkEl.textContent = "原文";
						bindEpubLocatorLink(app, linkEl, locator.href, ctx, "原文");
						fragment.append(linkEl);
					} else {
						fragment.append(doc.createTextNode(fullMatch));
					}
					lastIndex = match.index + fullMatch.length;
				}
				if (lastIndex < source.length) {
					fragment.append(doc.createTextNode(source.slice(lastIndex)));
				}
				textNode.replaceWith(fragment);
			}
		})();
	});
}

function enrichRenderedSingleAiSourceTitleRangeLinks(root: HTMLElement): void {
	const cfisById = collectAiSourceCfisById(root);
	for (const linkEl of Array.from(root.querySelectorAll<HTMLAnchorElement>("a"))) {
		const info = getRenderedAiSourceLinkInfo(linkEl);
		if (
			!info ||
			info.parsed.rangeEndCfi ||
			(info.parsed.rangeCfis && info.parsed.rangeCfis.length > 0)
		) {
			continue;
		}
		const titleText =
			info.parsed.sourceTitle ||
			linkEl.getAttribute("title") ||
			linkEl.getAttribute("aria-label") ||
			"";
		const range = parseAiSourceRangeIdsFromText(titleText);
		if (
			!range ||
			range.unit !== info.unit ||
			range.startParagraph !== info.paragraph
		) {
			continue;
		}
		const endCfi = cfisById.get(
			formatAiSourceId(range.unit, range.endParagraph),
		);
		if (!info.parsed.cfi || !endCfi) {
			continue;
		}
		const rangeCfis: string[] = [];
		for (
			let paragraph = range.startParagraph;
			paragraph <= range.endParagraph;
			paragraph += 1
		) {
			const cfi = cfisById.get(formatAiSourceId(range.unit, paragraph));
			if (cfi) {
				rangeCfis.push(cfi);
			}
		}
		if (rangeCfis.length === 0) {
			rangeCfis.push(info.parsed.cfi, endCfi);
		}
		const nextHref = EpubLinkService.buildEpubLocatorHref(
			info.filePath,
			info.parsed.cfi,
			info.parsed.text,
			info.parsed.chapter,
			info.parsed.sourceId,
			info.parsed.excerptId,
			{
				includeText: Boolean(String(info.parsed.text || "").trim()),
				includeChapter: info.parsed.chapter !== undefined,
				preferCompactLocator: true,
				flashStyle: info.parsed.flashStyle || "pulse",
				flashColor: info.parsed.flashColor || "yellow",
				sourceTitle: titleText || `${info.id}-${formatAiSourceId(range.unit, range.endParagraph)}`,
				rangeEndCfi: endCfi,
				rangeCfis,
			},
		);
		if (nextHref) {
			linkEl.setAttribute("href", nextHref);
		}
	}
}

function getNextDashSeparatedAnchor(
	startLinkEl: HTMLAnchorElement,
): { endLinkEl: HTMLAnchorElement; separatorNodes: Node[] } | null {
	const separatorNodes: Node[] = [];
	let node = startLinkEl.nextSibling;
	let separatorText = "";
	while (node) {
		if (node.nodeType === 3) {
			separatorText += node.nodeValue || "";
			separatorNodes.push(node);
			node = node.nextSibling;
			continue;
		}
		if (
			node.nodeType === 1 &&
			((node as Element).tagName || "").toLowerCase() === "a"
		) {
			const compactSeparator = separatorText.replace(/\s/g, "");
			return ["-", "–", "—", "－"].includes(compactSeparator)
				? { endLinkEl: node as HTMLAnchorElement, separatorNodes }
				: null;
		}
		if (
			node.nodeType === 1 &&
			!(node as Element).matches("a") &&
			!String(node.textContent || "").trim()
		) {
			separatorText += node.textContent || "";
			separatorNodes.push(node);
			node = node.nextSibling;
			continue;
		}
		return null;
	}
	return null;
}

function collapseRenderedAdjacentAiSourceRangeLinks(root: HTMLElement): void {
	const cfisById = collectAiSourceCfisById(root);
	for (const startLinkEl of Array.from(
		root.querySelectorAll<HTMLAnchorElement>("a"),
	)) {
		if (!root.contains(startLinkEl)) {
			continue;
		}
		const start = getRenderedAiSourceLinkInfo(startLinkEl);
		if (
			!start ||
			start.parsed.rangeEndCfi ||
			(start.parsed.rangeCfis && start.parsed.rangeCfis.length > 0)
		) {
			continue;
		}
		const next = getNextDashSeparatedAnchor(startLinkEl);
		if (!next) {
			continue;
		}
		const end = getRenderedAiSourceLinkInfo(next.endLinkEl);
		if (
			!end ||
			start.filePath !== end.filePath ||
			start.parsed.sourceId !== end.parsed.sourceId ||
			start.unit !== end.unit ||
			end.paragraph <= start.paragraph
		) {
			continue;
		}
		const rangeCfis: string[] = [];
		for (let paragraph = start.paragraph; paragraph <= end.paragraph; paragraph += 1) {
			const cfi = cfisById.get(formatAiSourceId(start.unit, paragraph));
			if (cfi) {
				rangeCfis.push(cfi);
			}
		}
		if (!start.parsed.cfi || !end.parsed.cfi) {
			continue;
		}
		if (rangeCfis.length === 0) {
			rangeCfis.push(start.parsed.cfi, end.parsed.cfi);
		}
		const nextHref = EpubLinkService.buildEpubLocatorHref(
			start.filePath,
			start.parsed.cfi,
			start.parsed.text,
			start.parsed.chapter,
			start.parsed.sourceId,
			start.parsed.excerptId,
			{
				includeText: Boolean(String(start.parsed.text || "").trim()),
				includeChapter: start.parsed.chapter !== undefined,
				preferCompactLocator: true,
				flashStyle: "pulse",
				flashColor: start.parsed.flashColor || "yellow",
				sourceTitle:
					start.parsed.sourceTitle ||
					`原文范围：${start.id}-${end.id}`,
				rangeEndCfi: end.parsed.cfi,
				rangeCfis,
			},
		);
		if (!nextHref) {
			continue;
		}
		startLinkEl.setAttribute("href", nextHref);
		startLinkEl.textContent = startLinkEl.textContent || "原文";
		for (const node of next.separatorNodes) {
			node.remove();
		}
		next.endLinkEl.remove();
	}
}

function isAiReadingSourceLocatorLink(
	parsed: EpubLinkParams,
	displayText: string,
): boolean {
	const excerptId = String(parsed.excerptId || "").trim();
	if (excerptId.startsWith("ai-source-")) {
		return true;
	}
	if (parsed.rangeEndCfi || (parsed.rangeCfis && parsed.rangeCfis.length > 0)) {
		return true;
	}
	return /^U\d{3}\.P\d{3}$/i.test(String(displayText || "").trim());
}

function bindEpubLocatorLink(
	app: App,
	linkEl: HTMLAnchorElement,
	locatorHref: string,
	ctx: MarkdownPostProcessorContext,
	displayText?: string,
): void {
	const boundLinkEl = linkEl as BoundEpubLinkElement;
	const hashIdx = locatorHref.indexOf("#");
	if (hashIdx === -1) {
		clearBoundEpubHandler(boundLinkEl);
		return;
	}

	const filePath = locatorHref.substring(0, hashIdx);
	const subpath = locatorHref.substring(hashIdx);
	if (!EpubLinkService.hasSupportedEpubSubpath(subpath)) {
		clearBoundEpubHandler(boundLinkEl);
		return;
	}

	const parsed = EpubLinkService.parseEpubLink(subpath);
	if (!parsed) {
		clearBoundEpubHandler(boundLinkEl);
		return;
	}

	if (boundLinkEl.__weaveEpubBoundHref === locatorHref) {
		return;
	}

	clearBoundEpubHandler(boundLinkEl);
	linkEl.setAttribute("href", locatorHref);
	linkEl.addClass("internal-link");
	linkEl.removeClass("external-link");

	styleEpubLink(
		linkEl,
		displayText ||
			linkEl.textContent ||
			stripSupportedBookExtension(filePath.split("/").pop() || "") ||
			"Book",
	);
	if (parsed.sourceTitle) {
		linkEl.setAttribute("title", parsed.sourceTitle);
		linkEl.setAttribute("aria-label", parsed.sourceTitle);
		linkEl.setAttribute("data-tooltip-position", "top");
	}

	boundLinkEl.__weaveEpubBoundHref = locatorHref;
	const navigateFromLink = () => {
		void (async () => {
			const linkService = new EpubLinkService(app);
			const sourceMarkdownPath =
				String(ctx?.sourcePath || "").trim() || undefined;
			const calloutQuoteText = String(parsed.cfi || "").trim()
				? ""
				: extractCalloutQuoteText(boundLinkEl);
			const quoteText = resolveEpubSourceNavigationTextHint(
				parsed,
				calloutQuoteText,
			);
			const linkText = String(displayText || boundLinkEl.textContent || "").trim();
			const isAiReadingSourceLink = isAiReadingSourceLocatorLink(parsed, linkText);
			const effectiveFlashStyle =
				isAiReadingSourceLink && parsed.flashStyle !== "none"
					? "pulse"
					: parsed.flashStyle;
			const effectiveFlashColor =
				isAiReadingSourceLink && effectiveFlashStyle !== "none"
					? parsed.flashColor || "yellow"
					: parsed.flashColor;
			if (effectiveFlashStyle || effectiveFlashColor) {
				let rangeMetadata = {
					rangeEndCfi: parsed.rangeEndCfi,
					rangeCfis: parsed.rangeCfis,
				};
				const rangeTitleText =
					parsed.sourceTitle ||
					boundLinkEl.getAttribute("title") ||
					boundLinkEl.getAttribute("aria-label") ||
					"";
				if (
					isAiReadingSourceLink &&
					shouldEnrichAiSourceRangeMetadata(
						parsed,
						rangeTitleText,
						rangeMetadata.rangeCfis,
					) &&
					sourceMarkdownPath &&
					typeof app.vault?.getAbstractFileByPath === "function" &&
					typeof app.vault?.cachedRead === "function"
				) {
					try {
						const sourceMapBlocksById =
							await collectAiSourceMapBlocksByIdFromMarkdownFile(
								app,
								sourceMarkdownPath,
							);
						const sourceMapCfisById =
							collectAiSourceCfisByIdFromSourceMapBlocks(
								sourceMapBlocksById,
							);
						const sourceMapRangeMetadata =
							buildAiSourceRangeMetadataFromCfiIndex(
								parsed,
								sourceMapCfisById,
								rangeTitleText,
							);
						const noteCfisById = sourceMapRangeMetadata?.rangeCfis?.length
							? sourceMapCfisById
							: await collectAiSourceCfisByIdFromMarkdownFile(
									app,
									sourceMarkdownPath,
								);
						const noteRangeMetadata =
							sourceMapRangeMetadata ||
							buildAiSourceRangeMetadataFromCfiIndex(
								parsed,
								noteCfisById,
								rangeTitleText,
							);
						if (noteRangeMetadata?.rangeCfis?.length) {
							rangeMetadata = {
								rangeEndCfi:
									noteRangeMetadata.rangeEndCfi || rangeMetadata.rangeEndCfi,
								rangeCfis: noteRangeMetadata.rangeCfis,
							};
						}
					} catch {
						// Keep the source link clickable even if legacy range enrichment fails.
					}
				}
				await linkService.navigateToEpubLocation(
					filePath,
					parsed.cfi,
					quoteText,
					parsed.sourceId,
					sourceMarkdownPath,
					{
						flashStyle: effectiveFlashStyle,
						flashColor: effectiveFlashColor,
						showLocateOverlay: effectiveFlashStyle !== "none",
						...(rangeMetadata.rangeEndCfi
							? { rangeEndCfi: rangeMetadata.rangeEndCfi }
							: {}),
						...(rangeMetadata.rangeCfis
							? { rangeCfis: rangeMetadata.rangeCfis }
							: {}),
					},
				);
				return;
			}
			await linkService.navigateToEpubLocation(
				filePath,
				parsed.cfi,
				quoteText,
				parsed.sourceId,
				sourceMarkdownPath,
			);
		})();
	};

	boundLinkEl.__weaveEpubClickHandler = (e: MouseEvent) => {
		e.preventDefault();
		e.stopImmediatePropagation();
		navigateFromLink();
	};
	// Capture phase runs before Obsidian's obsidian:// default handler opens a new tab.
	linkEl.addEventListener("click", boundLinkEl.__weaveEpubClickHandler, true);
	linkEl.addEventListener("click", boundLinkEl.__weaveEpubClickHandler);
}

export function createEpubLinkPostProcessor(app: App) {
	const scheduledMigrationPaths = new Set<string>();
	return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
		bindAnnotationNoteDocumentDualWindowControls(app, el.ownerDocument);
		const sourcePath = String(ctx?.sourcePath || "").trim();
		const isInsideAiReadingSourcePreview = Boolean(
			el.closest(".weave-epub-ai-reading-note-source-preview"),
		);
		applyEpubCalloutAppearanceAttributes(el);
		if (!isInsideAiReadingSourcePreview) {
			mountAnnotationNoteFilter(el);
			requestAnnotationNoteFilterRefresh(el);
			bindPdfAnnotationNoteNavigationControls(app, el);
			mountAiReadingNoteFilter(app, el, 0, sourcePath);
			requestAiReadingNoteFilterRefresh(el);
			bindAnnotationNoteDualWindowControls(app, el);
			bindAiReadingNoteStartControls(app, el);
		}

		if (
			!isInsideAiReadingSourcePreview &&
			sourcePath &&
			!scheduledMigrationPaths.has(sourcePath)
		) {
			scheduledMigrationPaths.add(sourcePath);
			queueMicrotask(() => {
				void (async () => {
					try {
						const sourceFile = app.vault.getAbstractFileByPath(sourcePath);
						if (
							!(sourceFile instanceof TFile) ||
							sourceFile.extension !== "md"
						) {
							return;
						}
						const originalContent = await app.vault.cachedRead(sourceFile);
						await maybeMigrateEpubLinksInMarkdownFile(
							app,
							sourceFile,
							originalContent,
						);
					} catch {
						// ignore background enrichment failures
					}
				})();
			});
		}

		repairRawEpubLocatorWikilinks(el);
		renderAiSourcePlaceholdersFromSourceMap(app, el, ctx);

		enrichRenderedSingleAiSourceTitleRangeLinks(el);
		collapseRenderedAdjacentAiSourceRangeLinks(el);
		const links = el.querySelectorAll("a");

		links.forEach((linkEl) => {
			if (!linkEl.instanceOf(HTMLAnchorElement)) {
				return;
			}

			if (
				linkEl.closest(".weave-annotation-note-line") ||
				linkEl.classList.contains("weave-annotation-note-return")
			) {
				clearBoundEpubHandler(linkEl as BoundEpubLinkElement);
				return;
			}

			const rawHref =
				linkEl.getAttribute("href") || linkEl.getAttribute("data-href") || "";
			const protocolLocatorHref = resolveProtocolLocatorHref(rawHref);
			const locatorHref =
				protocolLocatorHref ||
				(isSupportedBookLocatorHref(rawHref) ? rawHref : "");

			if (!locatorHref) {
				clearBoundEpubHandler(linkEl as BoundEpubLinkElement);
				return;
			}

			const displayText = protocolLocatorHref
				? linkEl.textContent || undefined
				: undefined;
			bindEpubLocatorLink(app, linkEl, locatorHref, ctx, displayText);
		});
	};
}

function styleEpubLink(linkEl: Element, displayText: string): void {
	linkEl.addClass("weave-epub-link");
	linkEl.removeClass("external-link");
	linkEl.empty();

	const inEpubCalloutTitle = Boolean(
		(linkEl as HTMLElement).closest(
			'.callout[data-callout="epub"] .callout-title',
		),
	);
	if (!inEpubCalloutTitle) {
		const iconSpan = (linkEl as HTMLElement).createSpan({
			cls: "weave-epub-link-icon",
		});
		setIcon(iconSpan, "book-open");
	}

	(linkEl as HTMLElement).createSpan({
		cls: "weave-epub-link-text",
		text: displayText,
	});
}
