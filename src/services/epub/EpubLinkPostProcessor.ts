import type { App } from "obsidian";
import { MarkdownPostProcessorContext, TFile, setIcon } from "obsidian";
import { isSupportedBookLocatorHref, stripSupportedBookExtension } from "./book-format";
import { maybeMigrateEpubLinksInMarkdownFile } from "./epub-link-content-migration";
import { EpubLinkService } from "./EpubLinkService";
import { resolveEpubSourceNavigationTextHint } from "./epub-source-navigation-text-hint";
import { isSupportedEpubProtocolName } from "./epub-runtime";
import { dispatchEpubDualWindowAnnotationEvent } from "./epub-dual-window";
import { resolveEpubHost } from "./epub-host";

type BoundEpubLinkElement = HTMLAnchorElement & {
	__weaveEpubClickHandler?: (event: MouseEvent) => void;
	__weaveEpubBoundHref?: string;
};

type AnnotationNoteFilterMarker = HTMLElement & {
	__weaveApplyAnnotationNoteFilters?: () => void;
	__weaveFilterRefreshPending?: boolean;
	__weaveDualWindowControlsBound?: boolean;
};

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
	results.push(...Array.from(root.querySelectorAll<HTMLElement>('.callout[data-callout="epub"]')));
	return results;
}

function extractCalloutQuoteText(linkEl: HTMLElement): string {
	const callout = linkEl.closest('.callout[data-callout="epub"]');
	if (!callout) {
		return "";
	}

	const quoteLines: string[] = [];
	for (const block of Array.from(callout.querySelectorAll<HTMLElement>(".callout-content blockquote p"))) {
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

interface AnnotationNoteFilterOption {
	value: string;
	label: string;
}

const ANNOTATION_NOTE_FILTER_MAX_RETRY = 6;
const ANNOTATION_NOTE_FILTER_RETRY_DELAY_MS = 80;
const ANNOTATION_NOTE_FILTER_REFRESH_DELAYS_MS = [80, 240, 520];

function normalizeFilterText(value: unknown): string {
	return String(value || "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

function collectAnnotationFilterOptions(
	lines: HTMLElement[],
	valueAttr: "chapterKey" | "semanticId",
	labelAttr: "chapterTitle" | "semanticLabel"
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
	return Array.from(options.entries()).map(([value, label]) => ({ value, label }));
}

function createAnnotationFilterSelect(
	doc: Document,
	className: string,
	ariaLabel: string,
	allLabel: string,
	options: AnnotationNoteFilterOption[]
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

function getAnnotationFilterOptionsSignature(options: AnnotationNoteFilterOption[]): string {
	return options.map((option) => `${option.value}\u0000${option.label}`).join("\u0001");
}

function syncAnnotationFilterSelectOptions(
	select: HTMLSelectElement,
	allLabel: string,
	options: AnnotationNoteFilterOption[]
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
	select.value = options.some((option) => option.value === previousValue) ? previousValue : "";
	select.dataset.optionsSignature = signature;
}

function findAnnotationNoteMarker(root: HTMLElement): HTMLElement | null {
	if (root.matches(".weave-annotation-note-root")) {
		return root;
	}
	return root.querySelector<HTMLElement>(".weave-annotation-note-root");
}

function resolveAnnotationNoteScope(marker: HTMLElement, fallback: HTMLElement): HTMLElement {
	return (
		marker.closest<HTMLElement>(
			".markdown-preview-view, .markdown-rendered, .markdown-source-view, .view-content"
		) ||
		fallback.closest<HTMLElement>(
			".markdown-preview-view, .markdown-rendered, .markdown-source-view, .view-content"
		) ||
		fallback.parentElement ||
		fallback
	);
}

function resolveAnnotationNoteContainer(fallback: HTMLElement): HTMLElement {
	return (
		fallback.closest<HTMLElement>(
			".markdown-preview-view, .markdown-rendered, .markdown-source-view, .view-content"
		) ||
		fallback.parentElement ||
		fallback
	);
}

function findMountedAnnotationNoteMarker(root: HTMLElement): AnnotationNoteFilterMarker | null {
	const direct = findAnnotationNoteMarker(root) as AnnotationNoteFilterMarker | null;
	if (direct) {
		return direct;
	}
	return resolveAnnotationNoteContainer(root).querySelector<AnnotationNoteFilterMarker>(
		".weave-annotation-note-root"
	);
}

function findAnnotationNoteDualWindowButton(target: EventTarget | null, scope: HTMLElement): HTMLButtonElement | null {
	if (!(target instanceof HTMLElement)) {
		return null;
	}
	const button = target.closest<HTMLButtonElement>('[data-weave-dual-window-action="open"]');
	return button && scope.contains(button) ? button : null;
}

function findAnnotationNoteLineFromEvent(target: EventTarget | null, scope: HTMLElement): HTMLElement | null {
	if (!(target instanceof HTMLElement)) {
		return null;
	}
	const line = target.closest<HTMLElement>(".weave-annotation-note-line");
	return line && scope.contains(line) ? line : null;
}

function didLeaveAnnotationNoteLine(event: MouseEvent, line: HTMLElement): boolean {
	const relatedTarget = event.relatedTarget;
	return !(relatedTarget instanceof Node && line.contains(relatedTarget));
}

function hasAnnotationNoteDualWindowTargets(root: HTMLElement): boolean {
	return Boolean(
		root.matches('[data-weave-dual-window-action="open"], .weave-annotation-note-line') ||
			root.querySelector('[data-weave-dual-window-action="open"], .weave-annotation-note-line')
	);
}

function readAnnotationNoteIdentity(
	target: HTMLElement,
	marker: AnnotationNoteFilterMarker | null
): { bookId: string; filePath: string } {
	return {
		bookId: String(target.dataset.bookId || marker?.dataset.bookId || "").trim(),
		filePath: String(target.dataset.sourceFile || marker?.dataset.sourceFile || "").trim(),
	};
}

function bindAnnotationNoteDualWindowControls(app: App, root: HTMLElement): void {
	const marker = findMountedAnnotationNoteMarker(root);
	if (!marker && !hasAnnotationNoteDualWindowTargets(root)) {
		return;
	}
	const scope = marker ? resolveAnnotationNoteScope(marker, root) : resolveAnnotationNoteContainer(root);
	const dualWindowMode = marker?.dataset.dualWindowMode === "true";

	const emitAnnotationEvent = (
		line: HTMLElement,
		phase: "enter" | "leave" | "click"
	): void => {
		const { bookId, filePath } = readAnnotationNoteIdentity(line, marker);
		dispatchEpubDualWindowAnnotationEvent(scope.ownerDocument.defaultView || window, {
			mode: "book-annotation-note",
			phase,
			bookId,
			filePath,
			cfiRange: line.dataset.cfiRange,
			annotationId: line.dataset.annotationId,
			semanticId: line.dataset.semanticId,
			text: line.dataset.annotationText,
		});
	};

	const boundTarget = (marker || scope) as AnnotationNoteFilterMarker;
	if (boundTarget.__weaveDualWindowControlsBound) {
		return;
	}
	boundTarget.__weaveDualWindowControlsBound = true;

	const handleDualWindowClick = (event: MouseEvent) => {
		const button = dualWindowMode ? null : findAnnotationNoteDualWindowButton(event.target, scope);
		if (button) {
			event.preventDefault();
			event.stopPropagation();
			const { bookId, filePath } = readAnnotationNoteIdentity(button, marker);
			if (!bookId || !filePath) {
				return;
			}
			void resolveEpubHost(app)?.openEpubAnnotationNote?.({
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

function requestAnnotationNoteFilterRefresh(root: HTMLElement): void {
	const marker = findMountedAnnotationNoteMarker(root);
	if (!marker?.__weaveApplyAnnotationNoteFilters || marker.__weaveFilterRefreshPending) {
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
	attempt: number
): void {
	if (attempt >= ANNOTATION_NOTE_FILTER_MAX_RETRY || marker.dataset.filterPending === "true") {
		return;
	}
	marker.dataset.filterPending = "true";
	const activeWindow = marker.ownerDocument.defaultView || window;
	activeWindow.setTimeout(() => {
		marker.dataset.filterPending = "";
		const scope = resolveAnnotationNoteScope(marker, fallback);
		mountAnnotationNoteFilter(scope, attempt + 1);
	}, attempt === 0 ? 0 : ANNOTATION_NOTE_FILTER_RETRY_DELAY_MS);
}

function mountAnnotationNoteFilter(root: HTMLElement, attempt = 0): void {
	const marker = findAnnotationNoteMarker(root);
	if (!marker || marker.dataset.filterMounted === "true") {
		return;
	}
	const scope = resolveAnnotationNoteScope(marker, root);
	if (scope.querySelector(".weave-annotation-note-filter")) {
		marker.dataset.filterMounted = "true";
		return;
	}

	const lines = Array.from(
		scope.querySelectorAll<HTMLElement>(".weave-annotation-note-line")
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
		"章节筛选",
		"全部章节",
		collectAnnotationFilterOptions(lines, "chapterKey", "chapterTitle")
	);
	const semanticSelect = createAnnotationFilterSelect(
		doc,
		"weave-annotation-note-filter-semantic",
		"语义筛选",
		"全部语义",
		collectAnnotationFilterOptions(lines, "semanticId", "semanticLabel")
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
		Array.from(scope.querySelectorAll<HTMLElement>(".weave-annotation-note-line"));

	const refreshFilterOptions = (): HTMLElement[] => {
		const currentLines = collectLines();
		syncAnnotationFilterSelectOptions(
			chapterSelect,
			"全部章节",
			collectAnnotationFilterOptions(currentLines, "chapterKey", "chapterTitle")
		);
		syncAnnotationFilterSelectOptions(
			semanticSelect,
			"全部语义",
			collectAnnotationFilterOptions(currentLines, "semanticId", "semanticLabel")
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
			const matchesChapter = !chapterValue || line.dataset.chapterKey === chapterValue;
			const matchesSemantic = !semanticValue || line.dataset.semanticId === semanticValue;
			const text = normalizeFilterText(line.dataset.annotationText || line.textContent || "");
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
			scope.querySelectorAll<HTMLElement>(".weave-annotation-note-chapter")
		)) {
			const chapterKey = String(chapter.dataset.chapterKey || "").trim();
			if (!chapterKey) {
				continue;
			}
			chapter.classList.toggle("is-hidden", !visibleChapterKeys.has(chapterKey));
		}
		countEl.textContent = `${visibleCount} / ${lines.length}`;
	};

	chapterSelect.addEventListener("change", applyFilters);
	semanticSelect.addEventListener("change", applyFilters);
	searchInput.addEventListener("input", applyFilters);
	(marker as AnnotationNoteFilterMarker).__weaveApplyAnnotationNoteFilters = applyFilters;
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

function resolveProtocolLocatorHref(href: string): string | null {
	const protocolName = extractEpubProtocolName(href);
	if (!isSupportedEpubProtocolName(protocolName)) {
		return null;
	}

	try {
		const url = new URL(href.startsWith("obsidian://") ? href : `obsidian://${href}`);
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
			}
		);
		return locatorHref && isSupportedBookLocatorHref(locatorHref) ? locatorHref : null;
	} catch {
		return null;
	}
}

function bindEpubLocatorLink(
	app: App,
	linkEl: HTMLAnchorElement,
	locatorHref: string,
	ctx: MarkdownPostProcessorContext,
	displayText?: string
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
			"Book"
	);

	boundLinkEl.__weaveEpubBoundHref = locatorHref;
	const navigateFromLink = () => {
		void (async () => {
			const linkService = new EpubLinkService(app);
			const sourceMarkdownPath = String(ctx?.sourcePath || "").trim() || undefined;
			const calloutQuoteText = String(parsed.cfi || "").trim()
				? ""
				: extractCalloutQuoteText(boundLinkEl);
			const quoteText = resolveEpubSourceNavigationTextHint(parsed, calloutQuoteText);
			await linkService.navigateToEpubLocation(
				filePath,
				parsed.cfi,
				quoteText,
				parsed.sourceId,
				sourceMarkdownPath
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
		applyEpubCalloutAppearanceAttributes(el);
		mountAnnotationNoteFilter(el);
		requestAnnotationNoteFilterRefresh(el);
		bindAnnotationNoteDualWindowControls(app, el);

		const sourcePath = String(ctx?.sourcePath || "").trim();
		if (sourcePath && !scheduledMigrationPaths.has(sourcePath)) {
			scheduledMigrationPaths.add(sourcePath);
			queueMicrotask(() => {
				void (async () => {
					try {
						const sourceFile = app.vault.getAbstractFileByPath(sourcePath);
						if (!(sourceFile instanceof TFile) || sourceFile.extension !== "md") {
							return;
						}
						const originalContent = await app.vault.cachedRead(sourceFile);
						await maybeMigrateEpubLinksInMarkdownFile(app, sourceFile, originalContent);
					} catch {
						// ignore background enrichment failures
					}
				})();
			});
		}

		const links = el.querySelectorAll("a");

		links.forEach((linkEl) => {
			if (!(linkEl.instanceOf(HTMLAnchorElement))) {
				return;
			}

			if (
				linkEl.closest(".weave-annotation-note-line") ||
				linkEl.classList.contains("weave-annotation-note-return")
			) {
				clearBoundEpubHandler(linkEl as BoundEpubLinkElement);
				return;
			}

			const rawHref = linkEl.getAttribute("href") || linkEl.getAttribute("data-href") || "";
			const protocolLocatorHref = resolveProtocolLocatorHref(rawHref);
			const locatorHref = protocolLocatorHref || (isSupportedBookLocatorHref(rawHref) ? rawHref : "");

			if (!locatorHref) {
				clearBoundEpubHandler(linkEl as BoundEpubLinkElement);
				return;
			}

			const displayText = protocolLocatorHref ? linkEl.textContent || undefined : undefined;
			bindEpubLocatorLink(app, linkEl, locatorHref, ctx, displayText);
		});
	};
}

function styleEpubLink(linkEl: Element, displayText: string): void {
	linkEl.addClass("weave-epub-link");
	linkEl.removeClass("external-link");
	linkEl.empty();

	const inEpubCalloutTitle = Boolean(
		(linkEl as HTMLElement).closest('.callout[data-callout="epub"] .callout-title')
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
