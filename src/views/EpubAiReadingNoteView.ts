import { Component, ItemView, MarkdownRenderer, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import {
	collectAiReadingSourceRanges,
	type AiReadingNoteSourceRange,
} from "../services/epub/EpubLinkPostProcessor";
import {
	buildEpubAiReadingScopeLevels,
	EPUB_AI_READING_ALL_SCOPE_ID,
	resolveEpubAiReadingScopeSelection,
} from "../services/epub/epub-ai-reading-scope";
import { EPUB_AI_READING_REQUEST_EVENT } from "../services/epub/epub-ai-reading";
import { decorateEpubAiReadingLegacyNoteBareSourceReferences } from "../services/epub/epub-ai-reading-source-blocks";
import { EPUB_RUNTIME } from "../services/epub/epub-runtime";
import { resolveEpubHost } from "../services/epub/epub-host";
import type { TocItem } from "../services/epub/types";
import { logger } from "../utils/logger";

export const VIEW_TYPE_EPUB_AI_READING_NOTE = EPUB_RUNTIME.viewTypes.aiReadingNote;

interface EpubAiReadingNoteViewState {
	bookId?: string;
	notePath?: string;
	sourceFile?: string;
	dualWindowMode?: boolean;
	selectedParts?: string[];
	selectedScopeIds?: string[];
	typeKey?: string;
	searchText?: string;
}

function readPlainState(state: unknown): EpubAiReadingNoteViewState {
	return state && typeof state === "object" && !Array.isArray(state)
		? (state as EpubAiReadingNoteViewState)
		: {};
}

function normalizePart(value: unknown): string {
	return String(value || "")
		.replace(/\s+/g, " ")
		.trim();
}

function splitRangeLabel(label: string): string[] {
	return String(label || "")
		.split(">")
		.map(normalizePart)
		.filter(Boolean);
}

function getRangeKey(parts: string[]): string {
	return parts.map(normalizePart).filter(Boolean).join(" > ");
}

function normalizeHref(value: unknown): string {
	return String(value || "").replace(/\\/g, "/").trim();
}

function getHrefFragment(value: string): string {
	const normalized = normalizeHref(value);
	const hashIndex = normalized.indexOf("#");
	return hashIndex >= 0 ? normalized.slice(hashIndex + 1).trim() : "";
}

function hrefMatches(candidate: string, selected: string): boolean {
	const normalizedCandidate = normalizeHref(candidate);
	const normalizedSelected = normalizeHref(selected);
	if (!normalizedCandidate || !normalizedSelected) {
		return false;
	}
	if (normalizedCandidate === normalizedSelected) {
		return true;
	}
	const candidateFragment = getHrefFragment(normalizedCandidate);
	const selectedFragment = getHrefFragment(normalizedSelected);
	return Boolean(candidateFragment && selectedFragment && candidateFragment === selectedFragment);
}

function decodeHtmlAttribute(value: string): string {
	const doc = window.document;
	const textarea = doc.createElement("textarea");
	textarea.innerHTML = value;
	return textarea.value;
}

function inferSourceFileFromMarkdown(markdown: string): string {
	const match = String(markdown || "").match(/\sdata-source-file="([^"]+)"/i);
	return match ? decodeHtmlAttribute(match[1] || "").trim() : "";
}

interface AiReadingMarkdownSection {
	index: number;
	level: number;
	title: string;
	lines: string[];
}

function stripTrailingHeadingHashes(title: string): string {
	return normalizePart(String(title || "").replace(/\s+#+\s*$/u, ""));
}

function parseMarkdownSections(markdown: string): AiReadingMarkdownSection[] {
	const sections: AiReadingMarkdownSection[] = [];
	let current: AiReadingMarkdownSection | null = null;
	const finishCurrent = () => {
		if (current) {
			sections.push(current);
		}
		current = null;
	};
	for (const line of String(markdown || "").split(/\r?\n/)) {
		const match = line.match(/^(#{2,6})\s+(.+?)\s*#*\s*$/u);
		if (match) {
			finishCurrent();
			current = {
				index: sections.length,
				level: match[1].length,
				title: stripTrailingHeadingHashes(match[2] || ""),
				lines: [line],
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

function isRangeTitleHeading(title: string): boolean {
	const normalized = normalizePart(title);
	return (
		/^U\d{3,}\s+/iu.test(normalized) ||
		/^第\s*[\d一二三四五六七八九十百千万]+\s*章[：:]/u.test(normalized) ||
		normalized.includes(" > ") ||
		normalized === "按小节精读"
	);
}

export function collectAiReadingNoteSectionTitleOptions(markdowns: string[]): string[] {
	const titles = new Set<string>();
	for (const markdown of markdowns) {
		for (const section of parseMarkdownSections(markdown)) {
			if (isRangeTitleHeading(section.title)) {
				continue;
			}
			titles.add(section.title);
		}
	}
	return Array.from(titles);
}

function getSectionAncestors(
	sections: AiReadingMarkdownSection[],
	section: AiReadingMarkdownSection,
): AiReadingMarkdownSection[] {
	const ancestors: AiReadingMarkdownSection[] = [];
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

function filterMarkdownByExactSectionTitle(markdown: string, sectionTitle: string): string {
	const source = String(markdown || "").trim();
	const title = normalizePart(sectionTitle);
	if (!source || !title) {
		return source;
	}
	const sections = parseMarkdownSections(source);
	const selectedSections = sections.filter((section) => section.title === title);
	if (selectedSections.length === 0) {
		return "";
	}
	const emittedContext = new Set<number>();
	const blocks: string[] = [];
	for (const section of selectedSections) {
		for (const ancestor of getSectionAncestors(sections, section)) {
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

function createSelect(
	doc: Document,
	className: string,
	label: string,
	allLabel: string,
): { wrapper: HTMLLabelElement; select: HTMLSelectElement } {
	const wrapper = doc.createElement("label");
	wrapper.className = `${className}-row`;
	const labelEl = doc.createElement("span");
	labelEl.className = `${className}-label`;
	labelEl.textContent = label;
	const select = doc.createElement("select");
	select.className = className;
	const allOption = doc.createElement("option");
	allOption.value = "";
	allOption.textContent = allLabel;
	select.append(allOption);
	wrapper.append(labelEl, select);
	return { wrapper, select };
}

export class EpubAiReadingNoteView extends ItemView {
	private bookId = "";
	private notePath = "";
	private sourceFile = "";
	private dualWindowMode = false;
	private selectedParts: string[] = [];
	private selectedScopeIds: string[] = [EPUB_AI_READING_ALL_SCOPE_ID];
	private typeKey = "";
	private searchText = "";
	private ranges: AiReadingNoteSourceRange[] = [];
	private noteMarkdown = "";
	private tocItems: TocItem[] = [];
	private markdownComponent: Component | null = null;
	private renderId = 0;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_EPUB_AI_READING_NOTE;
	}

	getDisplayText(): string {
		const fileName = this.notePath.split("/").pop();
		return fileName || "AI 阅读笔记";
	}

	getIcon(): string {
		return "sparkles";
	}

	getState(): EpubAiReadingNoteViewState {
		return {
			bookId: this.bookId,
			notePath: this.notePath,
			sourceFile: this.sourceFile,
			dualWindowMode: this.dualWindowMode,
			selectedParts: this.selectedParts,
			selectedScopeIds: this.selectedScopeIds,
			typeKey: this.typeKey,
			searchText: this.searchText,
		};
	}

	async setState(state: unknown, result: unknown): Promise<void> {
		await super.setState(state, result);
		const viewState = readPlainState(state);
		this.bookId = normalizePart(viewState.bookId);
		this.notePath = normalizePath(String(viewState.notePath || "").trim());
		this.sourceFile = normalizePath(String(viewState.sourceFile || "").trim());
		this.dualWindowMode = viewState.dualWindowMode === true;
		this.selectedParts = Array.isArray(viewState.selectedParts)
			? viewState.selectedParts.map(normalizePart)
			: [];
		this.selectedScopeIds = Array.isArray(viewState.selectedScopeIds)
			? viewState.selectedScopeIds.map(normalizePart)
			: [EPUB_AI_READING_ALL_SCOPE_ID];
		this.typeKey = normalizePart(viewState.typeKey);
		this.searchText = normalizePart(viewState.searchText);
		await this.renderView();
	}

	async onOpen(): Promise<void> {
		await this.renderView();
	}

	async onClose(): Promise<void> {
		this.unloadMarkdownComponent();
	}

	private unloadMarkdownComponent(): void {
		(this.markdownComponent as unknown as { unload?: () => void } | null)?.unload?.();
		this.markdownComponent = null;
	}

	private async readNoteMarkdown(): Promise<string> {
		if (!this.notePath) {
			return "";
		}
		const file = this.app.vault.getAbstractFileByPath(this.notePath);
		if (!(file instanceof TFile)) {
			return "";
		}
		return this.app.vault.cachedRead(file);
	}

	private getMatchingRanges(): Array<{ range: AiReadingNoteSourceRange; markdown: string }> {
		return this.ranges
			.filter((range) => this.rangeMatchesSelection(range))
			.map((range) => ({
				range,
				markdown: filterMarkdownByExactSectionTitle(range.markdown, this.typeKey).trim(),
			}))
			.filter((item) => item.markdown.length > 0)
			.filter((item) => this.itemMatchesSearch(item.markdown));
	}

	private getMatchingRangesBeforeTypeFilter(): AiReadingNoteSourceRange[] {
		return this.ranges.filter((range) => this.rangeMatchesSelection(range));
	}

	private canStartAiReadingForCurrentSelection(): boolean {
		if (!this.sourceFile || this.tocItems.length === 0) {
			return false;
		}
		const selection = resolveEpubAiReadingScopeSelection(this.tocItems, this.selectedScopeIds);
		return selection.kind !== "book-placeholder" && selection.canGenerate;
	}

	private canStartAiReadingFromEmptyNote(): boolean {
		return Boolean(this.sourceFile && this.ranges.length === 0);
	}

	private canShowAiReadingStartAction(hasRangeContent: boolean): boolean {
		if (hasRangeContent || !this.sourceFile) {
			return false;
		}
		return this.canStartAiReadingForCurrentSelection() || this.canStartAiReadingFromEmptyNote();
	}

	private getAiReadingRequestScopeIds(): string[] {
		if (this.canStartAiReadingForCurrentSelection()) {
			return this.selectedScopeIds.filter(Boolean);
		}
		return [];
	}

	private dispatchAiReadingRequestForCurrentSelection(): void {
		if (
			!this.sourceFile ||
			(!this.canStartAiReadingForCurrentSelection() && !this.canStartAiReadingFromEmptyNote())
		) {
			return;
		}
		const detail = {
			filePath: this.sourceFile,
			scopeIds: this.getAiReadingRequestScopeIds(),
		};
		const activeWindow = this.contentEl.ownerDocument.defaultView || window;
		const dispatch = () => {
			activeWindow.dispatchEvent(new CustomEvent(EPUB_AI_READING_REQUEST_EVENT, { detail }));
			if (activeWindow !== window) {
				window.dispatchEvent(new CustomEvent(EPUB_AI_READING_REQUEST_EVENT, { detail }));
			}
		};
		dispatch();
		void (async () => {
			try {
				await resolveEpubHost(this.app)?.openEpubReader?.(this.sourceFile);
				for (const delay of [120, 360]) {
					activeWindow.setTimeout(dispatch, delay);
				}
			} catch {
				// The immediate event above is enough when the reader is already open.
			}
		})();
	}

	private getSectionTitleOptions(): string[] {
		return collectAiReadingNoteSectionTitleOptions(
			this.getMatchingRangesBeforeTypeFilter().map((range) => range.markdown),
		);
	}

	private itemMatchesSearch(markdown: string): boolean {
		const query = normalizePart(this.searchText).toLowerCase();
		if (!query) {
			return true;
		}
		return normalizePart(markdown).toLowerCase().includes(query);
	}

	private rangeMatchesSelection(range: AiReadingNoteSourceRange): boolean {
		if (this.tocItems.length > 0) {
			const selection = resolveEpubAiReadingScopeSelection(this.tocItems, this.selectedScopeIds);
			if (selection.kind === "book-placeholder") {
				return true;
			}
			const selectedRangeKey = getRangeKey(selection.pathLabels);
			const selectedRangeBaseKey = getRangeKey(
				selection.includeDescendants
					? selection.pathLabels.slice(0, -1)
					: selection.pathLabels,
			);
			const rangeKey = getRangeKey(splitRangeLabel(range.label || range.key));
			return (
				rangeKey === selectedRangeKey ||
				(Boolean(selectedRangeBaseKey) && rangeKey === selectedRangeBaseKey) ||
				Boolean(
					selection.includeDescendants &&
						selectedRangeBaseKey &&
						rangeKey.startsWith(`${selectedRangeBaseKey} > `),
				) ||
				hrefMatches(range.href, selection.href || "")
			);
		}
		const parts = splitRangeLabel(range.label || range.key);
		return this.selectedParts.every((selected, index) => !selected || parts[index] === selected);
	}

	private async loadTocItems(): Promise<void> {
		if (!this.sourceFile) {
			this.tocItems = [];
			return;
		}
		try {
			const host = resolveEpubHost(this.app);
			const directHost = this.app as unknown as {
				loadPublicationTocItems?: (path: string) => Promise<TocItem[]>;
			};
			const loader = host?.loadPublicationTocItems || directHost.loadPublicationTocItems;
			const loaded = loader
				? await loader.call(host?.loadPublicationTocItems ? host : directHost, this.sourceFile)
				: [];
			this.tocItems = Array.isArray(loaded) ? loaded : [];
		} catch (error) {
			logger.warn("[EpubAiReadingNoteView] Failed to load EPUB TOC:", error);
			this.tocItems = [];
		}
	}

	private getLevelValues(levelIndex: number): string[] {
		const previous = this.selectedParts.slice(0, levelIndex);
		const values = new Set<string>();
		for (const range of this.ranges) {
			const parts = splitRangeLabel(range.label || range.key);
			const matchesPrevious = previous.every(
				(selected, index) => !selected || parts[index] === selected,
			);
			if (matchesPrevious && parts[levelIndex]) {
				values.add(parts[levelIndex]);
			}
		}
		return Array.from(values);
	}

	private getLevelCount(): number {
		return Math.min(
			4,
			Math.max(
				1,
				...this.ranges.map((range) => splitRangeLabel(range.label || range.key).length),
			),
		);
	}

	private async renderView(): Promise<void> {
		const renderId = ++this.renderId;
		this.unloadMarkdownComponent();
		this.contentEl.empty();
		this.contentEl.addClass("weave-epub-ai-reading-note-view");

		const shell = this.contentEl.createDiv({ cls: "weave-epub-ai-reading-note-view__shell" });
		const toolbar = shell.createDiv({ cls: "weave-epub-ai-reading-note-view__toolbar" });
		const status = toolbar.createSpan({ cls: "weave-epub-ai-reading-note-view__count" });
		const content = shell.createDiv({ cls: "weave-epub-ai-reading-note-view__content markdown-rendered" });

		if (!this.notePath) {
			status.textContent = "未选择 AI 阅读笔记";
			return;
		}

		const markdown = await this.readNoteMarkdown();
		if (renderId !== this.renderId) {
			return;
		}

		if (!markdown.trim()) {
			status.textContent = "AI 阅读笔记为空或不存在";
			return;
		}

		this.ranges = collectAiReadingSourceRanges(markdown);
		this.noteMarkdown = markdown;
		if (!this.sourceFile) {
			this.sourceFile = inferSourceFileFromMarkdown(markdown);
		}
		await this.loadTocItems();
		if (renderId !== this.renderId) {
			return;
		}

		this.renderToolbar(toolbar, status);
		await this.renderRanges(content, status, renderId);
	}

	private renderToolbar(toolbar: HTMLElement, status: HTMLElement): void {
		toolbar.empty();
		const doc = toolbar.ownerDocument;
		const controls = doc.createElement("div");
		controls.className = "weave-epub-ai-reading-note-view__range-controls";

		if (this.tocItems.length > 0) {
			this.renderTocRangeControls(doc, controls);
		} else {
		const levelCount = this.getLevelCount();
		for (let index = 0; index < levelCount; index += 1) {
			const { wrapper, select } = createSelect(
				doc,
				"weave-epub-ai-reading-note-view__range-select",
				`第 ${index + 1} 级`,
				"全部",
			);
			for (const value of this.getLevelValues(index)) {
				const option = doc.createElement("option");
				option.value = value;
				option.textContent = value;
				select.append(option);
			}
			select.value = this.selectedParts[index] || "";
			select.addEventListener("change", () => {
				this.selectedParts[index] = select.value;
				this.selectedParts = this.selectedParts.slice(0, index + 1);
				void this.renderView();
			});
			controls.append(wrapper);
		}
		}

		const typeSelect = doc.createElement("select");
		typeSelect.className = "weave-epub-ai-reading-note-view__type-select";
		const allTypes = doc.createElement("option");
		allTypes.value = "";
		allTypes.textContent = "全部类型";
		typeSelect.append(allTypes);
		const sectionTitleOptions = this.getSectionTitleOptions();
		if (this.typeKey && !sectionTitleOptions.includes(this.typeKey)) {
			this.typeKey = "";
		}
		for (const title of sectionTitleOptions) {
			const option = doc.createElement("option");
			option.value = title;
			option.textContent = title;
			typeSelect.append(option);
		}
		typeSelect.value = this.typeKey;
		typeSelect.addEventListener("change", () => {
			this.typeKey = typeSelect.value;
			void this.renderView();
		});

		const searchInput = doc.createElement("input");
		searchInput.className = "weave-epub-ai-reading-note-view__search";
		searchInput.type = "search";
		searchInput.placeholder = "搜索内容";
		searchInput.setAttribute("aria-label", "搜索 AI 阅读内容");
		searchInput.value = this.searchText;
		searchInput.addEventListener("input", () => {
			this.searchText = searchInput.value;
			void this.renderView();
		});

		const openSourceButton = doc.createElement("button");
		openSourceButton.type = "button";
		openSourceButton.className = "weave-epub-ai-reading-note-view__source-button";
		openSourceButton.textContent = "打开原文";
		openSourceButton.disabled = !this.sourceFile;
		openSourceButton.addEventListener("click", () => {
			if (!this.sourceFile) {
				return;
			}
			void resolveEpubHost(this.app)?.openEpubReader?.(this.sourceFile);
		});

		const secondaryControls = doc.createElement("div");
		secondaryControls.className = "weave-epub-ai-reading-note-view__secondary-controls";
		secondaryControls.append(typeSelect, searchInput, openSourceButton);
		if (!this.dualWindowMode && this.notePath && this.sourceFile) {
			const dualWindowButton = doc.createElement("button");
			dualWindowButton.type = "button";
			dualWindowButton.className = "weave-epub-ai-reading-note-view__dual-window-button";
			dualWindowButton.textContent = "双窗模式";
			dualWindowButton.addEventListener("click", () => {
				void resolveEpubHost(this.app)?.openEpubAiReadingNote?.({
					...(this.bookId ? { bookId: this.bookId } : {}),
					notePath: this.notePath,
					sourceFile: this.sourceFile,
					openMode: "right-split",
					dualWindowMode: true,
					focus: false,
				});
			});
			secondaryControls.append(dualWindowButton);
		}
		secondaryControls.append(status);
		toolbar.append(controls, secondaryControls);
	}

	private renderTocRangeControls(doc: Document, controls: HTMLElement): void {
		const levels = buildEpubAiReadingScopeLevels(this.tocItems, this.selectedScopeIds);
		this.selectedScopeIds = levels.map((level) => level.selectedId);
		for (const level of levels) {
			const row = doc.createElement("label");
			row.className = "weave-epub-ai-reading-note-view__range-select-row";
			const label = doc.createElement("span");
			label.className = "weave-epub-ai-reading-note-view__range-select-label";
			label.textContent = `第 ${level.depth + 1} 级`;
			const select = doc.createElement("select");
			select.className = "weave-epub-ai-reading-note-view__range-select";
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
				this.selectedScopeIds = this.selectedScopeIds.slice(0, level.depth);
				this.selectedScopeIds[level.depth] = select.value;
				if (select.value !== EPUB_AI_READING_ALL_SCOPE_ID) {
					this.selectedScopeIds[level.depth + 1] = EPUB_AI_READING_ALL_SCOPE_ID;
				}
				this.selectedParts = [];
				void this.renderView();
			});
			row.append(label, select);
			controls.append(row);
		}
	}

	private async renderRanges(
		content: HTMLElement,
		status: HTMLElement,
		renderId: number,
	): Promise<void> {
		const items = this.getMatchingRanges();
		status.textContent = `${items.length} / ${this.ranges.length}`;
		if (items.length === 0) {
			const hasRangeContent = this.getMatchingRangesBeforeTypeFilter().length > 0;
			if (this.canShowAiReadingStartAction(hasRangeContent)) {
				const startButton = content.createEl("button", {
					cls: "weave-epub-ai-reading-note-view__start-button",
					text: "按这个范围开始 AI 阅读",
				});
				startButton.type = "button";
				startButton.addEventListener("click", () => {
					this.dispatchAiReadingRequestForCurrentSelection();
				});
			}
			content.createDiv({
				cls: "weave-epub-ai-reading-note-view__empty",
				text: "当前筛选范围没有可显示的 AI 阅读内容。",
			});
			return;
		}

		const component = new Component();
		this.markdownComponent = component;
		for (const item of items) {
			if (renderId !== this.renderId) {
				component.unload();
				return;
			}
			const rangeEl = content.createDiv({ cls: "weave-epub-ai-reading-note-view__range" });
			rangeEl.dataset.rangeKey = item.range.key;
			rangeEl.dataset.rangeLabel = item.range.label;
			rangeEl.dataset.rangeHref = item.range.href;
			try {
				await MarkdownRenderer.render(
					this.app,
					decorateEpubAiReadingLegacyNoteBareSourceReferences(
						item.markdown,
						this.noteMarkdown,
					),
					rangeEl,
					this.notePath,
					component,
				);
			} catch (error) {
				logger.warn("[EpubAiReadingNoteView] Markdown render failed, falling back to text:", error);
				rangeEl.textContent = item.markdown;
			}
		}
	}
}
