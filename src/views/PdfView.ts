import {
	ItemView,
	Notice,
	TFile,
	loadPdfJs,
	normalizePath,
	setIcon,
	type EventRef,
	type WorkspaceLeaf,
} from "obsidian";
import "../styles/pdf/pdf-reader.css";
import { isPdfBookFormat, stripSupportedBookExtension } from "../services/epub/book-format";
import { createDebouncedBookshelfProgressChangedNotifier } from "../services/epub/bookshelf-data-events";
import { getEpubStorageService } from "../services/epub/epub-storage-access";
import { EPUB_RUNTIME } from "../services/epub/epub-runtime";
import {
	epubActiveDocumentStore,
	type PdfPageThumbnail,
	type PdfSharedState,
} from "../stores/epub-active-document-store";
import {
	PdfInkAnnotationStore,
	clonePdfInkStrokes,
	type PdfAnnotationTool,
	type PdfInkDrawingTool,
	type PdfInkPoint,
	type PdfInkStroke,
	type PdfTextAnnotation,
} from "../services/pdf/pdf-ink-annotation-store";

export const VIEW_TYPE_PDF = EPUB_RUNTIME.viewTypes.pdfReader;

interface PdfRenderTaskLike {
	promise: Promise<unknown>;
}

interface PdfPageLike {
	getViewport(options: { scale: number }): { width: number; height: number };
	render(options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): PdfRenderTaskLike;
	getTextContent?: () => Promise<{
		items?: Array<{
			str?: string;
			transform?: number[];
			width?: number;
			height?: number;
			fontName?: string;
			dir?: string;
		}>;
		styles?: Record<string, { ascent?: number }>;
	}>;
}

interface PdfDocumentLike {
	numPages: number;
	getPage(pageNumber: number): Promise<PdfPageLike>;
	destroy?: () => Promise<void> | void;
}

const PDF_INK_DEFAULTS = {
	penColor: "#111111",
	penWidth: 2,
	highlighterColor: "#ffd54a",
	highlighterWidth: 14,
	eraserRadius: 18,
	acceptTouchInput: false,
};

export class PdfView extends ItemView {
	private filePath = "";
	private isOpen = false;
	private activeLeafChangeRef: EventRef | null = null;
	private renderToken = 0;
	private pdfDocument: PdfDocumentLike | null = null;
	private currentPage = 1;
	private pageCount = 0;
	private zoom = 1;
	private thumbnails: PdfPageThumbnail[] = [];
	private pageIndicatorEl: HTMLElement | null = null;
	private zoomLabelEl: HTMLElement | null = null;
	private rootEl: HTMLElement | null = null;
	private previousPageButtonEl: HTMLButtonElement | null = null;
	private nextPageButtonEl: HTMLButtonElement | null = null;
	private undoInkButtonEl: HTMLButtonElement | null = null;
	private redoInkButtonEl: HTMLButtonElement | null = null;
	private inkToolsButtonEl: HTMLButtonElement | null = null;
	private moreToolsButtonEl: HTMLButtonElement | null = null;
	private moreToolsPanelEl: HTMLElement | null = null;
	private toolSettingsPanelEl: HTMLElement | null = null;
	private currentColorDot: HTMLElement | null = null;
	private pagesScrollEl: HTMLElement | null = null;
	private toolsRailEl: HTMLElement | null = null;
	private pageEls: Map<number, HTMLElement> = new Map();
	private annotationLayers: Map<number, SVGSVGElement> = new Map();
	private textAnnotationLayers: Map<number, HTMLElement> = new Map();
	private visitedPages: Set<number> = new Set();
	private activeTool: PdfAnnotationTool = "pan";
	private activeInkTool: PdfInkDrawingTool = "pen";
	private toolSettingsOpen = false;
	private toolButtons: Map<PdfAnnotationTool, HTMLButtonElement> = new Map();
	private inkModeButtons: Map<PdfInkDrawingTool, HTMLButtonElement> = new Map();
	private readonly annotationStore = new PdfInkAnnotationStore(this.app);
	private inkStrokes: PdfInkStroke[] = [];
	private textAnnotations: PdfTextAnnotation[] = [];
	private undoInkStack: PdfInkStroke[][] = [];
	private redoInkStack: PdfInkStroke[][] = [];
	private activeInkStroke: PdfInkStroke | null = null;
	private activeInkPathEl: SVGElement | null = null;
	private activeInkPointerId: number | null = null;
	private eraserSessionBefore: PdfInkStroke[] | null = null;
	private eraserSessionChanged = false;
	private selectedInkStrokeIds: Set<string> = new Set();
	private strokeSelectionDrag: {
		kind: "marquee" | "move";
		pageNumber: number;
		startPoint: PdfInkPoint;
		beforeStrokes?: PdfInkStroke[];
		moved: boolean;
	} | null = null;
	private selectionRectEl: SVGRectElement | null = null;
	private captureDrag: {
		pageNumber: number;
		startPoint: PdfInkPoint;
	} | null = null;
	private captureRectEl: SVGRectElement | null = null;
	private captureSelection: {
		pageNumber: number;
		box: { left: number; top: number; right: number; bottom: number };
	} | null = null;
	private strokeClipboard: PdfInkStroke[] = [];
	private pasteSequence = 0;
	private penColor = PDF_INK_DEFAULTS.penColor;
	private penWidth = PDF_INK_DEFAULTS.penWidth;
	private highlighterColor = PDF_INK_DEFAULTS.highlighterColor;
	private highlighterWidth = PDF_INK_DEFAULTS.highlighterWidth;
	private eraserRadius = PDF_INK_DEFAULTS.eraserRadius;
	private acceptTouchInput = PDF_INK_DEFAULTS.acceptTouchInput;
	private annotationsDirty = false;
	private lastPersistedProgressCfi = "";
	private persistProgressToken = 0;
	private readonly bookshelfProgressChangedNotifier =
		createDebouncedBookshelfProgressChangedNotifier();
	private readonly handleContentKeyDown = (event: KeyboardEvent) => {
		this.handleReaderKeyDown(event);
	};

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_PDF;
	}

	getDisplayText(): string {
		return this.getResolvedTitle();
	}

	getIcon(): string {
		return "file-text";
	}

	allowNoFile(): boolean {
		return true;
	}

	getCurrentFilePath(): string {
		return normalizePath(this.filePath || "");
	}

	getState(): unknown {
		return {
			filePath: this.filePath,
			file: this.filePath,
		};
	}

	async setState(state: unknown, result: unknown): Promise<void> {
		await super.setState(state, result);
		const viewState =
			state && typeof state === "object" && !Array.isArray(state)
				? (state as Record<string, unknown>)
				: {};
		const incomingPath = normalizePath(
			String(viewState.filePath || viewState.file || "").trim()
		);
		if (incomingPath !== this.filePath) {
			this.filePath = incomingPath;
			this.refreshViewTitle();
			if (this.isOpen) {
				await this.render();
				this.syncAsActivePdfDocumentIfActive();
			}
		}
	}

	async onOpen(): Promise<void> {
		this.isOpen = true;
		this.contentEl.empty();
		this.contentEl.addClass("weave-pdf-view-content");
		this.contentEl.tabIndex = 0;
		this.contentEl.addEventListener("keydown", this.handleContentKeyDown);
		this.activeLeafChangeRef = this.app.workspace.on("active-leaf-change", (leaf) => {
			this.syncAsActivePdfDocumentIfActive(leaf);
		});
		await this.render();
		this.syncAsActivePdfDocumentIfActive();
	}

	async onClose(): Promise<void> {
		this.isOpen = false;
		this.renderToken += 1;
		if (this.activeLeafChangeRef) {
			this.app.workspace.offref(this.activeLeafChangeRef);
			this.activeLeafChangeRef = null;
		}
		await this.persistPdfAnnotations();
		await this.flushPendingPdfProgress();
		await this.disposeLoadedPdf();
		this.bookshelfProgressChangedNotifier.flush();
		this.bookshelfProgressChangedNotifier.dispose();
		epubActiveDocumentStore.clearActiveDocument(this.getCurrentFilePath());
		this.contentEl.removeEventListener("keydown", this.handleContentKeyDown);
		this.contentEl.removeAttribute("tabindex");
		this.contentEl.removeClass("weave-pdf-view-content");
		this.contentEl.empty();
	}

	private async render(): Promise<void> {
		const token = ++this.renderToken;
		this.currentPage = 1;
		this.pageCount = 0;
		this.thumbnails = [];
		this.visitedPages.clear();
		this.inkStrokes = [];
		this.textAnnotations = [];
		this.undoInkStack = [];
		this.redoInkStack = [];
		this.activeInkStroke = null;
		this.activeInkPathEl = null;
		this.activeInkPointerId = null;
		this.eraserSessionBefore = null;
		this.eraserSessionChanged = false;
		this.selectedInkStrokeIds.clear();
		this.strokeSelectionDrag = null;
		this.selectionRectEl = null;
		this.captureDrag = null;
		this.captureRectEl = null;
		this.captureSelection = null;
		this.strokeClipboard = [];
		this.pasteSequence = 0;
		this.annotationsDirty = false;
		this.lastPersistedProgressCfi = "";
		this.pageEls.clear();
		this.annotationLayers.clear();
		this.textAnnotationLayers.clear();
		this.pagesScrollEl = null;
		this.toolsRailEl = null;
		this.inkToolsButtonEl = null;
		this.moreToolsButtonEl = null;
		this.moreToolsPanelEl = null;
		this.toolSettingsPanelEl = null;
		this.currentColorDot = null;
		this.rootEl = null;
		this.toolSettingsOpen = false;
		this.toolButtons.clear();
		this.inkModeButtons.clear();
		await this.disposeLoadedPdf();

		if (!this.isOpen || token !== this.renderToken) {
			return;
		}

		this.contentEl.empty();
		this.contentEl.addClass("weave-pdf-view-content");
		const root = this.contentEl.createDiv({ cls: "weave-pdf-reader" });
		this.rootEl = root;
		this.syncToolUiState();
		this.renderToolbar(root);
		await this.renderDocumentSurface(root, token);
	}

	private renderToolbar(root: HTMLElement): void {
		const toolbar = root.createDiv({ cls: "weave-pdf-reader-toolbar" });
		const titleWrap = toolbar.createDiv({ cls: "weave-pdf-reader-title-wrap" });
		titleWrap.createDiv({ cls: "weave-pdf-reader-format-badge", text: "PDF" });
		titleWrap.createDiv({ cls: "weave-pdf-reader-title", text: this.getResolvedTitle() });

		const actions = toolbar.createDiv({ cls: "weave-pdf-reader-actions" });
		this.previousPageButtonEl = this.createToolbarIconButton(
			actions,
			"chevron-left",
			"上一页",
			"prev-page",
			() => this.goToPage(this.currentPage - 1)
		);
		this.pageIndicatorEl = actions.createDiv({ cls: "weave-pdf-reader-page-indicator" });
		this.nextPageButtonEl = this.createToolbarIconButton(
			actions,
			"chevron-right",
			"下一页",
			"next-page",
			() => this.goToPage(this.currentPage + 1)
		);

		actions.createDiv({ cls: "weave-pdf-reader-toolbar-divider" });
		this.createToolbarIconButton(actions, "minus", "缩小", "zoom-out", () => {
			this.setZoom(this.zoom - 0.1);
		});
		this.zoomLabelEl = actions.createDiv({ cls: "weave-pdf-reader-zoom-label" });
		this.createToolbarIconButton(actions, "plus", "放大", "zoom-in", () => {
			this.setZoom(this.zoom + 0.1);
		});
		this.createToolbarIconButton(actions, "refresh-cw", "重新加载 PDF", "reload", () => {
			void this.render();
		});

		this.updateToolbarState();
	}

	private renderToolsRail(parent: HTMLElement): void {
		const rail = parent.createDiv({
			cls: "weave-pdf-reader-tools-rail",
			attr: {
				"aria-label": "PDF annotation tools",
			},
		});
		this.toolsRailEl = rail;

		this.createToolButton(rail, "hand", "拖动浏览", "pan");
		this.createToolButton(rail, "text-select", "选择文本", "select");
		this.createToolButton(rail, "mouse-pointer-2", "选择笔迹", "stroke-select");
		this.createToolButton(rail, "scan", "区域截图", "capture");

		rail.createDiv({ cls: "weave-pdf-reader-toolbar-divider" });
		this.inkToolsButtonEl = this.createToolbarIconButton(
			rail,
			"pen-line",
			"画笔工具",
			"ink-tools",
			() => this.toggleInkSettingsPanel()
		);
		this.createToolButton(rail, "eraser", "橡皮", "eraser");

		rail.createDiv({ cls: "weave-pdf-reader-toolbar-divider" });
		this.undoInkButtonEl = this.createToolbarIconButton(
			rail,
			"undo-2",
			"撤销标注",
			"undo-annotation",
			() => this.undoPdfInk()
		);
		this.redoInkButtonEl = this.createToolbarIconButton(
			rail,
			"redo-2",
			"重做标注",
			"redo-annotation",
			() => this.redoPdfInk()
		);
		this.createToolbarIconButton(rail, "save", "保存标注", "save-annotations", () => {
			void this.persistPdfAnnotations({ notify: true });
		});
		this.moreToolsButtonEl = this.createToolbarIconButton(
			rail,
			"more-horizontal",
			"更多操作",
			"more-tools",
			() => this.toggleMoreToolsPanel()
		);
		this.renderToolSettingsPanel(rail);
		this.renderMoreToolsPanel(rail);
		this.syncToolUiState();
		this.updateToolbarState();
	}

	private renderToolSettingsPanel(parent: HTMLElement): void {
		const panel = parent.createDiv({ cls: "weave-pdf-reader-tool-settings-panel" });
		panel.hidden = true;
		this.toolSettingsPanelEl = panel;
		const header = panel.createDiv({ cls: "weave-pdf-reader-tool-settings-header" });
		header.createEl("span", { text: "工具设置" });
		this.currentColorDot = header.createEl("span", { cls: "weave-pdf-reader-current-color" });

		const inkModeRow = panel.createDiv({
			cls: "weave-pdf-reader-ink-mode-row",
		});
		inkModeRow.setAttribute("data-weave-pdf-ink-mode-row", "true");
		this.createInkModeButton(inkModeRow, "pen", "普通笔");
		this.createInkModeButton(inkModeRow, "highlighter", "透明笔");

		const penSection = this.createToolSettingsSection(panel, "pen", "画笔");
		this.createColorInput(penSection, "pen-color", "颜色", this.penColor, (value) => {
			this.penColor = value;
			this.syncToolSettingsPanel();
		});
		this.createRangeInput(penSection, "pen-width", "粗细", this.penWidth, 1, 32, 1, (value) => {
			this.penWidth = value;
			this.syncToolSettingsPanel();
		});

		const highlighterSection = this.createToolSettingsSection(panel, "highlighter", "荧光笔");
		this.createColorInput(
			highlighterSection,
			"highlighter-color",
			"颜色",
			this.highlighterColor,
			(value) => {
				this.highlighterColor = value;
				this.syncToolSettingsPanel();
			}
		);
		this.createRangeInput(
			highlighterSection,
			"highlighter-width",
			"粗细",
			this.highlighterWidth,
			4,
			48,
			1,
			(value) => {
				this.highlighterWidth = value;
				this.syncToolSettingsPanel();
			}
		);

		const eraserSection = this.createToolSettingsSection(panel, "eraser", "橡皮");
		this.createRangeInput(
			eraserSection,
			"eraser-radius",
			"半径",
			this.eraserRadius,
			4,
			64,
			1,
			(value) => {
				this.eraserRadius = value;
				this.syncToolSettingsPanel();
			}
		);

		const touchRow = panel.createDiv({ cls: "weave-pdf-reader-setting-row" });
		touchRow.createEl("span", { text: "触摸书写" });
		const touchInput = touchRow.createEl("input", {
			attr: {
				type: "checkbox",
			},
		});
		touchInput.setAttribute("data-weave-pdf-setting", "touch-input");
		touchInput.checked = this.acceptTouchInput;
		touchInput.addEventListener("change", () => {
			this.acceptTouchInput = touchInput.checked;
		});

		this.syncToolSettingsPanel();
	}

	private createToolSettingsSection(
		parent: HTMLElement,
		tool: PdfAnnotationTool,
		title: string
	): HTMLElement {
		const section = parent.createDiv({
			cls: "weave-pdf-reader-tool-settings-section",
		});
		section.setAttribute("data-weave-pdf-settings-section", tool);
		section.createDiv({ cls: "weave-pdf-reader-tool-settings-title", text: title });
		return section;
	}

	private createInkModeButton(
		parent: HTMLElement,
		tool: PdfInkDrawingTool,
		label: string
	): HTMLButtonElement {
		const button = parent.createEl("button", {
			cls: "weave-pdf-reader-ink-mode-button",
			text: label,
		});
		button.type = "button";
		button.setAttribute("data-weave-pdf-ink-mode", tool);
		button.setAttribute("aria-pressed", "false");
		button.addEventListener("click", () => {
			this.activeInkTool = tool;
			this.toolSettingsOpen = true;
			if (this.activeTool === tool) {
				this.syncToolUiState();
				this.syncToolSettingsPanel();
				return;
			}
			this.setActiveTool(tool);
		});
		this.inkModeButtons.set(tool, button);
		return button;
	}

	private createColorInput(
		parent: HTMLElement,
		setting: string,
		label: string,
		value: string,
		onInput: (value: string) => void
	): HTMLInputElement {
		const row = parent.createDiv({ cls: "weave-pdf-reader-setting-row" });
		row.createEl("span", { text: label });
		const input = row.createEl("input", {
			attr: {
				type: "color",
				value,
			},
		});
		input.type = "color";
		input.value = value;
		input.setAttribute("data-weave-pdf-setting", setting);
		input.addEventListener("input", () => {
			onInput(this.normalizeInkColor(input.value, value));
		});
		return input;
	}

	private createRangeInput(
		parent: HTMLElement,
		setting: string,
		label: string,
		value: number,
		min: number,
		max: number,
		step: number,
		onInput: (value: number) => void
	): HTMLInputElement {
		const row = parent.createDiv({ cls: "weave-pdf-reader-setting-row" });
		row.createEl("span", { text: label });
		const input = row.createEl("input", {
			attr: {
				type: "range",
				min: String(min),
				max: String(max),
				step: String(step),
				value: String(value),
			},
		});
		input.type = "range";
		input.min = String(min);
		input.max = String(max);
		input.step = String(step);
		input.value = String(value);
		input.setAttribute("data-weave-pdf-setting", setting);
		const valueEl = row.createEl("span", {
			cls: "weave-pdf-reader-setting-value",
			text: String(value),
		});
		input.addEventListener("input", () => {
			const nextValue = Math.max(min, Math.min(max, Number(input.value) || value));
			input.value = String(nextValue);
			valueEl.textContent = String(nextValue);
			onInput(nextValue);
		});
		return input;
	}

	private renderMoreToolsPanel(parent: HTMLElement): void {
		const panel = parent.createDiv({ cls: "weave-pdf-reader-tools-panel" });
		panel.hidden = true;
		this.moreToolsPanelEl = panel;

		const copySelectedButton = panel.createEl("button", {
			cls: "weave-pdf-reader-tools-panel-button",
			text: "复制所选",
		});
		copySelectedButton.type = "button";
		copySelectedButton.addEventListener("click", () => {
			this.closeMoreToolsPanel();
			this.copySelectedInkStrokes();
		});

		const pasteButton = panel.createEl("button", {
			cls: "weave-pdf-reader-tools-panel-button",
			text: "粘贴笔迹",
		});
		pasteButton.type = "button";
		pasteButton.addEventListener("click", () => {
			this.closeMoreToolsPanel();
			this.pasteCopiedInkStrokes();
		});

		const copyCaptureButton = panel.createEl("button", {
			cls: "weave-pdf-reader-tools-panel-button",
			text: "复制截图",
		});
		copyCaptureButton.type = "button";
		copyCaptureButton.setAttribute("data-weave-pdf-action", "copy-capture");
		copyCaptureButton.addEventListener("click", () => {
			this.closeMoreToolsPanel();
			void this.copyCaptureSelectionImage();
		});

		const highlightTextButton = panel.createEl("button", {
			cls: "weave-pdf-reader-tools-panel-button",
			text: "高亮文本",
		});
		highlightTextButton.type = "button";
		highlightTextButton.setAttribute("data-weave-pdf-action", "highlight-text");
		highlightTextButton.addEventListener("click", () => {
			this.closeMoreToolsPanel();
			this.createTextHighlightFromSelection();
		});

		const deleteSelectedButton = panel.createEl("button", {
			cls: "weave-pdf-reader-tools-panel-button",
			text: "删除所选",
		});
		deleteSelectedButton.type = "button";
		deleteSelectedButton.addEventListener("click", () => {
			this.closeMoreToolsPanel();
			this.deleteSelectedInkStrokes();
		});

		const clearPageButton = panel.createEl("button", {
			cls: "weave-pdf-reader-tools-panel-button",
			text: "清空当前页",
		});
		clearPageButton.type = "button";
		clearPageButton.addEventListener("click", () => {
			this.closeMoreToolsPanel();
			this.clearCurrentPageInkStrokes();
		});

		const clearAllButton = panel.createEl("button", {
			cls: "weave-pdf-reader-tools-panel-button danger",
			text: "清空全部标注",
		});
		clearAllButton.type = "button";
		clearAllButton.addEventListener("click", () => {
			this.closeMoreToolsPanel();
			this.clearAllInkStrokes();
		});
	}

	private createToolButton(
		parent: HTMLElement,
		iconName: string,
		label: string,
		tool: PdfAnnotationTool
	): HTMLButtonElement {
		const button = parent.createEl("button", {
			cls: "weave-pdf-reader-icon-button weave-pdf-reader-tool-button",
		});
		button.type = "button";
		button.setAttribute("aria-label", label);
		button.setAttribute("title", label);
		button.setAttribute("data-weave-pdf-tool", tool);
		button.addEventListener("click", () => {
			this.setActiveTool(tool);
		});
		setIcon(button, iconName);
		this.toolButtons.set(tool, button);
		return button;
	}

	private createToolbarIconButton(
		parent: HTMLElement,
		iconName: string,
		label: string,
		action: string,
		onClick: () => void
	): HTMLButtonElement {
		const button = parent.createEl("button", {
			cls: "weave-pdf-reader-icon-button",
		});
		button.type = "button";
		button.setAttribute("aria-label", label);
		button.setAttribute("title", label);
		button.setAttribute("data-weave-pdf-action", action);
		setIcon(button, iconName);
		button.addEventListener("click", onClick);
		return button;
	}

	private setActiveTool(tool: PdfAnnotationTool): void {
		if (this.activeTool === tool) {
			if (tool === "pen" || tool === "highlighter" || tool === "eraser") {
				this.toolSettingsOpen = !this.toolSettingsOpen;
				this.syncToolUiState();
				this.syncToolSettingsPanel();
			}
			return;
		}
		this.finishActiveInkInput();
		if (tool !== "stroke-select") {
			this.clearInkSelection();
		}
		if (tool !== "capture") {
			this.clearCaptureSelection();
		}
		if (tool === "pen" || tool === "highlighter") {
			this.activeInkTool = tool;
			this.toolSettingsOpen = true;
		} else if (tool === "eraser") {
			this.toolSettingsOpen = true;
		} else {
			this.toolSettingsOpen = false;
		}
		this.closeMoreToolsPanel();
		this.activeTool = tool;
		this.syncToolUiState();
		this.syncToolSettingsPanel();
		this.syncAsActivePdfDocument();
	}

	private syncToolUiState(): void {
		if (this.rootEl) {
			this.rootEl.dataset.weavePdfTool = this.activeTool;
		}
		for (const [tool, button] of this.toolButtons) {
			const active = tool === this.activeTool;
			button.classList.toggle("active", active);
			button.setAttribute("aria-pressed", active ? "true" : "false");
		}
		if (this.moreToolsButtonEl) {
			this.moreToolsButtonEl.classList.toggle(
				"active",
				Boolean(this.moreToolsPanelEl && !this.moreToolsPanelEl.hidden)
			);
		}
		if (this.inkToolsButtonEl) {
			const inkActive = this.activeTool === "pen" || this.activeTool === "highlighter";
			const inkSettingsVisible = Boolean(this.toolSettingsOpen && inkActive);
			this.inkToolsButtonEl.classList.toggle("active", inkActive);
			this.inkToolsButtonEl.setAttribute("aria-pressed", inkActive ? "true" : "false");
			this.inkToolsButtonEl.setAttribute("aria-expanded", inkSettingsVisible ? "true" : "false");
		}
		for (const [tool, button] of this.inkModeButtons) {
			const active = tool === this.activeInkTool;
			button.classList.toggle("active", active);
			button.setAttribute("aria-pressed", active ? "true" : "false");
		}
		this.syncToolSettingsPanel();
	}

	private syncToolSettingsPanel(): void {
		if (!this.toolSettingsPanelEl) {
			return;
		}
		const settingsTool = this.toolSettingsOpen ? this.getVisibleSettingsTool() : null;
		this.toolSettingsPanelEl.hidden = !settingsTool;
		const inkModeRow = this.toolSettingsPanelEl.querySelector<HTMLElement>(
			"[data-weave-pdf-ink-mode-row]"
		);
		if (inkModeRow) {
			inkModeRow.hidden = settingsTool !== "pen" && settingsTool !== "highlighter";
		}
		for (const section of Array.from(
			this.toolSettingsPanelEl.querySelectorAll<HTMLElement>("[data-weave-pdf-settings-section]")
		)) {
			section.hidden = section.dataset.weavePdfSettingsSection !== settingsTool;
		}

		const color =
			settingsTool === "highlighter"
				? this.highlighterColor
				: settingsTool === "pen"
					? this.penColor
					: "transparent";
		if (this.currentColorDot) {
			this.currentColorDot.style.background = color;
			this.currentColorDot.hidden = color === "transparent";
		}

		this.syncSettingInput("pen-color", this.penColor);
		this.syncSettingInput("pen-width", String(this.penWidth));
		this.syncSettingInput("highlighter-color", this.highlighterColor);
		this.syncSettingInput("highlighter-width", String(this.highlighterWidth));
		this.syncSettingInput("eraser-radius", String(this.eraserRadius));
		const touchInput = this.toolSettingsPanelEl.querySelector<HTMLInputElement>(
			'[data-weave-pdf-setting="touch-input"]'
		);
		if (touchInput) {
			touchInput.checked = this.acceptTouchInput;
		}
		for (const [tool, button] of this.inkModeButtons) {
			const active = tool === this.activeInkTool;
			button.classList.toggle("active", active);
			button.setAttribute("aria-pressed", active ? "true" : "false");
		}
	}

	private getVisibleSettingsTool(): PdfAnnotationTool {
		if (this.activeTool === "pen" || this.activeTool === "highlighter" || this.activeTool === "eraser") {
			return this.activeTool;
		}
		return this.activeInkTool;
	}

	private syncSettingInput(setting: string, value: string): void {
		const input = this.toolSettingsPanelEl?.querySelector<HTMLInputElement>(
			`[data-weave-pdf-setting="${setting}"]`
		);
		if (input && input.value !== value) {
			input.value = value;
		}
	}

	private toggleMoreToolsPanel(): void {
		if (!this.moreToolsPanelEl) {
			return;
		}
		const willOpen = this.moreToolsPanelEl.hidden;
		if (willOpen) {
			this.closeToolSettingsPanel();
		}
		this.moreToolsPanelEl.hidden = !this.moreToolsPanelEl.hidden;
		this.syncToolUiState();
	}

	private closeMoreToolsPanel(): void {
		if (!this.moreToolsPanelEl || this.moreToolsPanelEl.hidden) {
			return;
		}
		this.moreToolsPanelEl.hidden = true;
		this.syncToolUiState();
	}

	private toggleInkSettingsPanel(): void {
		if (this.activeTool !== "pen" && this.activeTool !== "highlighter") {
			this.toolSettingsOpen = true;
			this.setActiveTool(this.activeInkTool);
			return;
		}
		this.toolSettingsOpen = !this.toolSettingsOpen;
		this.closeMoreToolsPanel();
		this.syncToolSettingsPanel();
		this.syncToolUiState();
	}

	private closeToolSettingsPanel(): void {
		if (!this.toolSettingsOpen) {
			return;
		}
		this.toolSettingsOpen = false;
		this.syncToolSettingsPanel();
		this.syncToolUiState();
	}

	private handleSurfacePointerDown(event: MouseEvent): void {
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest(".weave-pdf-reader-tools-rail")) {
			return;
		}
		this.closeToolSettingsPanel();
		this.closeMoreToolsPanel();
	}

	private async renderDocumentSurface(root: HTMLElement, token: number): Promise<void> {
		const surface = root.createDiv({ cls: "weave-pdf-reader-surface" });
		surface.addEventListener("mousedown", (event) => {
			this.handleSurfacePointerDown(event);
		});
		this.renderToolsRail(surface);
		const file = this.resolvePdfFile();
		if (!file) {
			surface.createDiv({
				cls: "weave-pdf-reader-empty",
				text: "PDF file not found",
			});
			this.syncAsActivePdfDocumentIfActive();
			return;
		}

		const loadingEl = surface.createDiv({
			cls: "weave-pdf-reader-loading",
			text: "Loading PDF...",
		});

		try {
			const pdf = await this.loadPdfDocument(file);
			if (!this.isCurrentRender(token)) {
				await this.destroyPdfDocument(pdf);
				return;
			}

			this.pdfDocument = pdf;
			this.pageCount = Math.max(0, Math.floor(Number(pdf.numPages) || 0));
			await this.restoreSavedPdfProgress(token);
			await this.loadPdfAnnotations(token);
			this.currentPage = this.clampPage(this.currentPage);
			this.markPageVisited(this.currentPage);
			this.updateToolbarState();
			this.syncAsActivePdfDocumentIfActive();

			loadingEl.remove();
			this.pagesScrollEl = surface.createDiv({ cls: "weave-pdf-reader-pages" });
			this.pagesScrollEl.addEventListener("scroll", () => {
				this.updateCurrentPageFromScroll();
			});

			await this.renderPages(pdf, this.pagesScrollEl, token);
			if (!this.isCurrentRender(token)) {
				return;
			}
			this.thumbnails = await this.renderThumbnails(pdf, token);
			if (!this.isCurrentRender(token)) {
				return;
			}
			this.updateToolbarState();
			this.syncAsActivePdfDocumentIfActive();
			void this.persistPdfProgress();
		} catch (error) {
			if (!this.isCurrentRender(token)) {
				return;
			}
			loadingEl.remove();
			new Notice("Unable to load PDF");
			surface.createDiv({
				cls: "weave-pdf-reader-empty",
				text: "Unable to load PDF",
			});
			this.syncAsActivePdfDocumentIfActive();
		}
	}

	private async loadPdfDocument(file: TFile): Promise<PdfDocumentLike> {
		const bytes = new Uint8Array(await this.app.vault.readBinary(file));
		const pdfjs = await loadPdfJs();
		const loadingTask = pdfjs.getDocument({
			data: bytes.slice(),
		});
		return loadingTask.promise;
	}

	private async renderPages(
		pdf: PdfDocumentLike,
		container: HTMLElement,
		token: number
	): Promise<void> {
		if (this.pageCount <= 0) {
			container.createDiv({
				cls: "weave-pdf-reader-empty",
				text: "This PDF has no pages",
			});
			return;
		}

		for (let pageNumber = 1; pageNumber <= this.pageCount; pageNumber += 1) {
			if (!this.isCurrentRender(token)) {
				return;
			}
			const pageWrap = container.createDiv({
				cls: "weave-pdf-page",
				attr: {
					"data-page-number": String(pageNumber),
				},
			});
			const canvasShell = pageWrap.createDiv({ cls: "weave-pdf-page-canvas-shell" });
			const canvas = await this.renderPageToCanvas(pdf, pageNumber, this.zoom);
			if (!this.isCurrentRender(token)) {
				return;
			}
			canvasShell.appendChild(canvas);
			this.createTextAnnotationLayer(canvasShell, pageNumber);
			await this.renderPageTextLayer(pdf, pageNumber, canvasShell, canvas, token);
			if (!this.isCurrentRender(token)) {
				return;
			}
			this.createAnnotationLayer(canvasShell, pageNumber);
			pageWrap.createDiv({ cls: "weave-pdf-page-number", text: String(pageNumber) });
			this.pageEls.set(pageNumber, pageWrap);
		}
	}

	private createAnnotationLayer(parent: HTMLElement, pageNumber: number): SVGSVGElement {
		const layer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		layer.classList.add("weave-pdf-annotation-layer");
		layer.setAttribute("viewBox", "0 0 1 1");
		layer.setAttribute("preserveAspectRatio", "none");
		layer.dataset.pageNumber = String(pageNumber);
		parent.appendChild(layer);
		this.annotationLayers.set(pageNumber, layer);
		this.bindAnnotationLayer(layer, pageNumber);
		this.renderInkStrokesForPage(pageNumber);
		return layer;
	}

	private createTextAnnotationLayer(parent: HTMLElement, pageNumber: number): HTMLElement {
		const layer = parent.createDiv({
			cls: "weave-pdf-text-annotation-layer",
			attr: {
				"data-page-number": String(pageNumber),
				"aria-hidden": "true",
			},
		});
		this.textAnnotationLayers.set(pageNumber, layer);
		this.renderTextAnnotationsForPage(pageNumber);
		return layer;
	}

	private bindAnnotationLayer(layer: SVGSVGElement, pageNumber: number): void {
		layer.addEventListener("pointerdown", (event) => {
			this.handleInkPointerDown(event, pageNumber, layer);
		});
		layer.addEventListener("pointermove", (event) => {
			this.handleInkPointerMove(event, pageNumber, layer);
		});
		layer.addEventListener("pointerup", (event) => {
			this.handleInkPointerUp(event, pageNumber, layer);
		});
		layer.addEventListener("pointercancel", (event) => {
			this.handleInkPointerCancel(event, pageNumber);
		});
		layer.addEventListener("lostpointercapture", (event) => {
			this.handleInkPointerCancel(event, pageNumber);
		});
	}

	private async renderThumbnails(
		pdf: PdfDocumentLike,
		token: number
	): Promise<PdfPageThumbnail[]> {
		const thumbnails: PdfPageThumbnail[] = [];
		for (let pageNumber = 1; pageNumber <= this.pageCount; pageNumber += 1) {
			if (!this.isCurrentRender(token)) {
				return thumbnails;
			}
			const canvas = await this.renderPageToCanvas(pdf, pageNumber, 0.28, {
				maxWidth: 180,
				maxHeight: 240,
			});
			if (!this.isCurrentRender(token)) {
				return thumbnails;
			}
			thumbnails.push({
				pageNumber,
				image: canvas.toDataURL("image/png"),
			});
		}
		return thumbnails;
	}

	private async renderPageToCanvas(
		pdf: PdfDocumentLike,
		pageNumber: number,
		scale: number,
		options: { maxWidth?: number; maxHeight?: number } = {}
	): Promise<HTMLCanvasElement> {
		const page = await pdf.getPage(pageNumber);
		const baseViewport = page.getViewport({ scale: 1 });
		const boundedScale = Math.max(
			0.1,
			Math.min(
				scale,
				options.maxWidth ? options.maxWidth / Math.max(1, baseViewport.width) : scale,
				options.maxHeight ? options.maxHeight / Math.max(1, baseViewport.height) : scale
			)
		);
		const cssViewport = page.getViewport({ scale: boundedScale });
		const outputScale = Math.max(
			1,
			Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1)
		);
		const viewport = page.getViewport({ scale: boundedScale * outputScale });
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.ceil(viewport.width));
		canvas.height = Math.max(1, Math.ceil(viewport.height));
		canvas.style.width = `${Math.max(1, Math.ceil(cssViewport.width))}px`;
		canvas.style.height = `${Math.max(1, Math.ceil(cssViewport.height))}px`;

		const context = canvas.getContext("2d", { alpha: false });
		if (!context) {
			throw new Error("Canvas context unavailable");
		}
		context.fillStyle = "#ffffff";
		context.fillRect(0, 0, canvas.width, canvas.height);
		await page.render({ canvasContext: context, viewport }).promise;
		return canvas;
	}

	private async renderPageTextLayer(
		pdf: PdfDocumentLike,
		pageNumber: number,
		parent: HTMLElement,
		canvas: HTMLCanvasElement,
		token: number
	): Promise<void> {
		try {
			const page = await pdf.getPage(pageNumber);
			if (!this.isCurrentRender(token) || typeof page.getTextContent !== "function") {
				return;
			}
			const textContent = await page.getTextContent();
			if (!this.isCurrentRender(token) || !Array.isArray(textContent.items)) {
				return;
			}
			const cssWidth = Number.parseFloat(canvas.style.width || "") || canvas.width;
			const cssHeight = Number.parseFloat(canvas.style.height || "") || canvas.height;
			const baseViewport = page.getViewport({ scale: 1 });
			const scaleX = cssWidth / Math.max(1, baseViewport.width);
			const scaleY = cssHeight / Math.max(1, baseViewport.height);
			const layer = parent.createDiv({
				cls: "weave-pdf-text-layer",
				attr: {
					"data-page-number": String(pageNumber),
					"aria-label": `PDF page ${pageNumber} text`,
				},
			});
			layer.style.width = `${Math.max(1, Math.ceil(cssWidth))}px`;
			layer.style.height = `${Math.max(1, Math.ceil(cssHeight))}px`;
			for (const item of textContent.items) {
				const text = String(item?.str || "");
				if (!text) {
					continue;
				}
				const transform = Array.isArray(item.transform) ? item.transform : [];
				const fontSize = Math.max(1, Math.hypot(Number(transform[2]) || 0, Number(transform[3]) || 0) || Number(item.height) || 10);
				const left = (Number(transform[4]) || 0) * scaleX;
				const top = (baseViewport.height - (Number(transform[5]) || 0) - fontSize) * scaleY;
				const width = Math.max(1, (Number(item.width) || text.length * fontSize * 0.5) * scaleX);
				const height = Math.max(1, (Number(item.height) || fontSize) * scaleY);
				const span = layer.createEl("span", {
					text,
					attr: {
						dir: item.dir === "rtl" ? "rtl" : "ltr",
					},
				});
				span.style.left = `${this.formatPdfCssNumber(left)}px`;
				span.style.top = `${this.formatPdfCssNumber(top)}px`;
				span.style.width = `${this.formatPdfCssNumber(width)}px`;
				span.style.height = `${this.formatPdfCssNumber(height)}px`;
				span.style.fontSize = `${this.formatPdfCssNumber(fontSize * scaleY)}px`;
				span.style.lineHeight = `${this.formatPdfCssNumber(height)}px`;
			}
		} catch {
			// Text extraction is best-effort; rendering the PDF page should not fail because of it.
		}
	}

	private async loadPdfAnnotations(token: number): Promise<void> {
		const filePath = this.getCurrentFilePath();
		if (!filePath || this.pageCount <= 0) {
			return;
		}

		try {
			const document = await this.annotationStore.load(filePath, this.pageCount);
			if (!this.isCurrentRender(token)) {
				return;
			}
			this.inkStrokes = document.strokes;
			this.textAnnotations = document.textAnnotations ?? [];
			this.annotationsDirty = false;
		} catch {
			this.inkStrokes = [];
			this.textAnnotations = [];
			this.annotationsDirty = false;
		}
	}

	private async persistPdfAnnotations(options: { notify?: boolean } = {}): Promise<void> {
		if (!this.annotationsDirty && !options.notify) {
			return;
		}
		const filePath = this.getCurrentFilePath();
		if (!filePath || this.pageCount <= 0) {
			return;
		}

		try {
			await this.annotationStore.save({
				version: 1,
				sourcePath: filePath,
				pageCount: this.pageCount,
				strokes: this.inkStrokes,
				textAnnotations: this.textAnnotations,
				updatedAt: Date.now(),
			});
			this.annotationsDirty = false;
			if (options.notify) {
				new Notice("PDF annotations saved");
			}
		} catch {
			if (options.notify) {
				new Notice("Unable to save PDF annotations");
			}
		}
	}

	private handleInkPointerDown(
		event: PointerEvent,
		pageNumber: number,
		layer: SVGSVGElement
	): void {
		if (
			this.activeTool === "pan" ||
			this.activeTool === "select" ||
			(event.pointerType === "touch" && !this.acceptTouchInput) ||
			(event.pointerType === "mouse" && event.button !== 0)
		) {
			return;
		}
		const point = this.eventToInkPoint(event, layer);
		if (!point) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.contentEl.focus?.({ preventScroll: true });
		this.currentPage = this.clampPage(pageNumber);
		this.markPageVisited(this.currentPage);
		this.updateToolbarState();
		this.syncAsActivePdfDocument();
		void this.persistPdfProgress();
		this.activeInkPointerId = Number.isFinite(event.pointerId) ? event.pointerId : 1;
		try {
			layer.setPointerCapture?.(this.activeInkPointerId);
		} catch {
			// Pointer capture is not available in all Obsidian/WebView test environments.
		}

		if (this.activeTool === "stroke-select") {
			this.startStrokeSelection(pageNumber, point, layer);
			return;
		}

		if (this.activeTool === "capture") {
			this.startCaptureSelection(pageNumber, point, layer);
			return;
		}

		if (this.activeTool === "eraser") {
			this.eraserSessionBefore = clonePdfInkStrokes(this.inkStrokes);
			this.eraserSessionChanged = this.eraseInkAtPoint(pageNumber, point, layer);
			return;
		}

		if (this.activeTool !== "pen" && this.activeTool !== "highlighter") {
			if (this.activeInkPointerId !== null) {
				this.releaseInkPointer(layer, this.activeInkPointerId);
			}
			this.activeInkPointerId = null;
			return;
		}

		const stroke = this.createInkStroke(pageNumber, point);
		this.activeInkStroke = stroke;
		this.activeInkPathEl = this.createInkStrokeElement(stroke, {
			forcePath: true,
			live: true,
		});
		layer.appendChild(this.activeInkPathEl);
	}

	private handleInkPointerMove(
		event: PointerEvent,
		pageNumber: number,
		layer: SVGSVGElement
	): void {
		if (this.activeInkPointerId === null || event.pointerId !== this.activeInkPointerId) {
			return;
		}
		const point = this.eventToInkPoint(event, layer);
		if (!point) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();

		if (this.activeTool === "stroke-select") {
			this.updateStrokeSelection(pageNumber, point, layer);
			return;
		}

		if (this.activeTool === "capture") {
			this.updateCaptureSelection(point);
			return;
		}

		if (this.activeTool === "eraser") {
			this.eraserSessionChanged =
				this.eraseInkAtPoint(pageNumber, point, layer) || this.eraserSessionChanged;
			return;
		}

		if (!this.activeInkStroke || this.activeInkStroke.pageNumber !== pageNumber) {
			return;
		}
		const previous = this.activeInkStroke.points[this.activeInkStroke.points.length - 1];
		const dx = previous ? point.x - previous.x : 1;
		const dy = previous ? point.y - previous.y : 1;
		if (previous && dx * dx + dy * dy < 0.000004) {
			return;
		}
		this.activeInkStroke.points.push(point);
		this.updateInkStrokeElement(this.activeInkPathEl, this.activeInkStroke);
	}

	private handleInkPointerUp(
		event: PointerEvent,
		pageNumber: number,
		layer: SVGSVGElement
	): void {
		if (this.activeInkPointerId === null || event.pointerId !== this.activeInkPointerId) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.releaseInkPointer(layer, event.pointerId);

		if (this.activeTool === "stroke-select") {
			const point = this.eventToInkPoint(event, layer);
			if (point) {
				this.finishStrokeSelection(pageNumber, point);
			} else {
				this.finishActiveInkInput();
			}
			return;
		}

		if (this.activeTool === "capture") {
			const point = this.eventToInkPoint(event, layer);
			if (point) {
				this.finishCaptureSelection(pageNumber, point);
			} else {
				this.finishActiveInkInput();
			}
			return;
		}

		if (this.activeTool === "eraser") {
			this.finishEraserSession();
			return;
		}

		if (!this.activeInkStroke || this.activeInkStroke.pageNumber !== pageNumber) {
			this.finishActiveInkInput();
			return;
		}
		const point = this.eventToInkPoint(event, layer);
		if (point) {
			this.activeInkStroke.points.push(point);
		}
		if (this.activeInkStroke.points.length === 1) {
			const onlyPoint = this.activeInkStroke.points[0];
			this.activeInkStroke.points.push({
				...onlyPoint,
				x: Math.min(1, onlyPoint.x + 0.001),
				y: Math.min(1, onlyPoint.y + 0.001),
			});
		}
		this.pushUndoSnapshot();
		this.inkStrokes.push(clonePdfInkStrokes([this.activeInkStroke])[0]);
		this.annotationsDirty = true;
		this.activeInkStroke = null;
		this.activeInkPathEl = null;
		this.activeInkPointerId = null;
		this.renderInkStrokesForPage(pageNumber);
		this.updateToolbarState();
		this.syncAsActivePdfDocument();
		void this.persistPdfAnnotations();
	}

	private handleInkPointerCancel(event: PointerEvent, pageNumber: number): void {
		if (this.activeInkPointerId === null || event.pointerId !== this.activeInkPointerId) {
			return;
		}
		const layer = this.annotationLayers.get(pageNumber);
		this.releaseInkPointer(layer, event.pointerId);
		this.finishActiveInkInput();
		this.renderInkStrokesForPage(pageNumber);
	}

	private finishActiveInkInput(): void {
		if (this.activeInkStroke || this.activeInkPathEl) {
			this.activeInkPathEl?.remove();
		}
		this.activeInkStroke = null;
		this.activeInkPathEl = null;
		this.activeInkPointerId = null;
		this.eraserSessionBefore = null;
		this.eraserSessionChanged = false;
		if (this.strokeSelectionDrag?.kind === "move") {
			this.clearSelectedInkDragTransform(this.strokeSelectionDrag.pageNumber);
		}
		this.strokeSelectionDrag = null;
		this.selectionRectEl?.remove();
		this.selectionRectEl = null;
		this.captureDrag = null;
		this.captureRectEl?.remove();
		this.captureRectEl = null;
	}

	private startStrokeSelection(
		pageNumber: number,
		point: PdfInkPoint,
		layer: SVGSVGElement
	): void {
		const hitStroke = this.findInkStrokeAtPoint(pageNumber, point, layer);
		if (hitStroke) {
			if (!this.selectedInkStrokeIds.has(hitStroke.id)) {
				this.selectedInkStrokeIds = new Set([hitStroke.id]);
				this.renderInkStrokesForPage(pageNumber);
			}
			this.strokeSelectionDrag = {
				kind: "move",
				pageNumber,
				startPoint: point,
				beforeStrokes: clonePdfInkStrokes(this.inkStrokes),
				moved: false,
			};
			return;
		}

		this.clearInkSelection();
		this.selectionRectEl = this.createInkSelectionRect(layer, "weave-pdf-ink-selection-box");
		this.updateInkRect(this.selectionRectEl, point, point);
		this.strokeSelectionDrag = {
			kind: "marquee",
			pageNumber,
			startPoint: point,
			moved: false,
		};
	}

	private updateStrokeSelection(
		pageNumber: number,
		point: PdfInkPoint,
		layer: SVGSVGElement
	): void {
		const drag = this.strokeSelectionDrag;
		if (!drag || drag.pageNumber !== pageNumber) {
			return;
		}

		if (drag.kind === "marquee") {
			this.updateInkRect(this.selectionRectEl, drag.startPoint, point);
			drag.moved = drag.moved || this.hasMeaningfulInkDrag(drag.startPoint, point);
			return;
		}

		if (!drag.beforeStrokes || this.selectedInkStrokeIds.size === 0) {
			return;
		}
		const dx = point.x - drag.startPoint.x;
		const dy = point.y - drag.startPoint.y;
		drag.moved = drag.moved || Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001;
		this.applySelectedInkDragTransform(pageNumber, dx, dy);
	}

	private finishStrokeSelection(pageNumber: number, point: PdfInkPoint): void {
		const drag = this.strokeSelectionDrag;
		this.strokeSelectionDrag = null;
		this.selectionRectEl?.remove();
		this.selectionRectEl = null;
		this.activeInkPointerId = null;
		if (!drag || drag.pageNumber !== pageNumber) {
			return;
		}

		if (drag.kind === "marquee") {
			if (!drag.moved) {
				this.clearInkSelection();
				return;
			}
			const box = this.normalizeInkBox(drag.startPoint, point);
			this.selectedInkStrokeIds = new Set(
				this.inkStrokes
					.filter((stroke) => stroke.pageNumber === pageNumber && this.isStrokeInInkBox(stroke, box))
					.map((stroke) => stroke.id)
			);
			this.renderInkStrokesForPage(pageNumber);
			return;
		}

		if (drag.moved && drag.beforeStrokes) {
			const dx = point.x - drag.startPoint.x;
			const dy = point.y - drag.startPoint.y;
			this.inkStrokes = drag.beforeStrokes.map((stroke) =>
				this.selectedInkStrokeIds.has(stroke.id)
					? this.translateInkStroke(stroke, dx, dy)
					: clonePdfInkStrokes([stroke])[0]
			);
			this.undoInkStack.push(drag.beforeStrokes);
			this.trimInkHistory();
			this.redoInkStack = [];
			this.annotationsDirty = true;
			this.renderInkStrokesForPage(pageNumber);
			this.updateToolbarState();
			this.syncAsActivePdfDocument();
			void this.persistPdfAnnotations();
		} else {
			this.clearSelectedInkDragTransform(pageNumber);
		}
	}

	private startCaptureSelection(
		pageNumber: number,
		point: PdfInkPoint,
		layer: SVGSVGElement
	): void {
		this.captureDrag = {
			pageNumber,
			startPoint: point,
		};
		this.captureRectEl = this.createInkSelectionRect(layer, "weave-pdf-capture-box");
		this.updateInkRect(this.captureRectEl, point, point);
	}

	private updateCaptureSelection(point: PdfInkPoint): void {
		if (!this.captureDrag) {
			return;
		}
		this.updateInkRect(this.captureRectEl, this.captureDrag.startPoint, point);
	}

	private finishCaptureSelection(pageNumber: number, point: PdfInkPoint): void {
		const drag = this.captureDrag;
		this.captureDrag = null;
		this.captureRectEl?.remove();
		this.captureRectEl = null;
		this.activeInkPointerId = null;
		if (!drag || drag.pageNumber !== pageNumber || !this.hasMeaningfulInkDrag(drag.startPoint, point)) {
			return;
		}
		this.captureSelection = {
			pageNumber,
			box: this.normalizeInkBox(drag.startPoint, point),
		};
		this.renderInkStrokesForPage(pageNumber);
	}

	private createInkSelectionRect(layer: SVGSVGElement, className: string): SVGRectElement {
		const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
		rect.classList.add(className);
		layer.appendChild(rect);
		return rect;
	}

	private updateInkRect(
		element: SVGRectElement | null,
		startPoint: PdfInkPoint,
		endPoint: PdfInkPoint
	): void {
		if (!element) {
			return;
		}
		const box = this.normalizeInkBox(startPoint, endPoint);
		element.setAttribute("x", this.formatInkNumber(box.left));
		element.setAttribute("y", this.formatInkNumber(box.top));
		element.setAttribute("width", this.formatInkNumber(box.right - box.left));
		element.setAttribute("height", this.formatInkNumber(box.bottom - box.top));
	}

	private clearInkSelection(): void {
		if (this.selectedInkStrokeIds.size === 0) {
			return;
		}
		this.selectedInkStrokeIds.clear();
		this.renderAllInkStrokes();
	}

	private applySelectedInkDragTransform(pageNumber: number, dx: number, dy: number): void {
		const layer = this.annotationLayers.get(pageNumber);
		if (!layer) {
			return;
		}
		const transform = `translate(${this.formatInkNumber(dx)} ${this.formatInkNumber(dy)})`;
		for (const element of Array.from(layer.querySelectorAll<SVGElement>("[data-stroke-id]"))) {
			const strokeId = element.getAttribute("data-stroke-id");
			if (!strokeId || !this.selectedInkStrokeIds.has(strokeId)) {
				continue;
			}
			element.setAttribute("transform", transform);
		}
	}

	private clearSelectedInkDragTransform(pageNumber: number): void {
		const layer = this.annotationLayers.get(pageNumber);
		if (!layer) {
			return;
		}
		for (const element of Array.from(layer.querySelectorAll<SVGElement>("[data-stroke-id]"))) {
			const strokeId = element.getAttribute("data-stroke-id");
			if (strokeId && this.selectedInkStrokeIds.has(strokeId)) {
				element.removeAttribute("transform");
			}
		}
	}

	private clearCapturePreview(): void {
		this.captureDrag = null;
		this.captureRectEl?.remove();
		this.captureRectEl = null;
	}

	private clearCaptureSelection(): void {
		const pageNumber = this.captureSelection?.pageNumber;
		this.captureSelection = null;
		this.clearCapturePreview();
		if (pageNumber) {
			this.renderInkStrokesForPage(pageNumber);
		}
	}

	private async copyCaptureSelectionImage(): Promise<void> {
		const selection = this.captureSelection;
		if (!selection) {
			new Notice("请先框选 PDF 区域");
			return;
		}
		const pageEl = this.pageEls.get(selection.pageNumber);
		const sourceCanvas = pageEl?.querySelector<HTMLCanvasElement>(".weave-pdf-page-canvas-shell canvas");
		if (!sourceCanvas || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
			new Notice("无法复制截图");
			return;
		}

		const left = Math.max(0, Math.floor(selection.box.left * sourceCanvas.width));
		const top = Math.max(0, Math.floor(selection.box.top * sourceCanvas.height));
		const width = Math.max(1, Math.ceil((selection.box.right - selection.box.left) * sourceCanvas.width));
		const height = Math.max(1, Math.ceil((selection.box.bottom - selection.box.top) * sourceCanvas.height));
		const output = document.createElement("canvas");
		output.width = width;
		output.height = height;
		const context = output.getContext("2d");
		if (!context) {
			new Notice("无法复制截图");
			return;
		}
		context.drawImage(sourceCanvas, left, top, width, height, 0, 0, width, height);
		const dataUrl = output.toDataURL("image/png");
		try {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
				await navigator.clipboard.writeText(dataUrl);
				new Notice("截图已复制");
				return;
			}
		} catch {
			// Fall through to the user-facing failure notice below.
		}
		new Notice("当前环境不支持复制截图");
	}

	private createTextHighlightFromSelection(): void {
		const selection = document.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount <= 0) {
			new Notice("请先选择 PDF 文本");
			return;
		}
		const range = selection.getRangeAt(0);
		const layer = this.findPdfTextLayerForSelection(range);
		if (!layer) {
			new Notice("请先选择 PDF 文本");
			return;
		}
		const pageNumber = this.clampPage(Number(layer.dataset.pageNumber) || 1);
		const layerRect = layer.getBoundingClientRect();
		if (layerRect.width <= 0 || layerRect.height <= 0) {
			new Notice("无法创建文本高亮");
			return;
		}
		const rects = Array.from(range.getClientRects())
			.map((rect) => ({
				x: Math.max(0, Math.min(1, (rect.left - layerRect.left) / layerRect.width)),
				y: Math.max(0, Math.min(1, (rect.top - layerRect.top) / layerRect.height)),
				width: Math.max(0.001, Math.min(1, rect.width / layerRect.width)),
				height: Math.max(0.001, Math.min(1, rect.height / layerRect.height)),
			}))
			.filter((rect) => rect.width > 0 && rect.height > 0);
		if (rects.length === 0) {
			new Notice("无法创建文本高亮");
			return;
		}
		this.textAnnotations.push({
			id: this.createInkId(),
			pageNumber,
			color: this.highlighterColor,
			text: selection.toString(),
			rects,
			createdAt: Date.now(),
		});
		selection.removeAllRanges();
		this.annotationsDirty = true;
		this.renderTextAnnotationsForPage(pageNumber);
		this.updateToolbarState();
		this.syncAsActivePdfDocument();
		void this.persistPdfAnnotations();
	}

	private findPdfTextLayerForSelection(range: Range): HTMLElement | null {
		const container = range.commonAncestorContainer;
		const element =
			container instanceof HTMLElement
				? container
				: container.parentElement instanceof HTMLElement
					? container.parentElement
					: null;
		return element?.closest<HTMLElement>(".weave-pdf-text-layer") ?? null;
	}

	private deleteSelectedInkStrokes(): void {
		if (this.selectedInkStrokeIds.size === 0) {
			return;
		}
		const selectedIds = new Set(this.selectedInkStrokeIds);
		const nextStrokes = this.inkStrokes.filter((stroke) => !selectedIds.has(stroke.id));
		if (nextStrokes.length === this.inkStrokes.length) {
			this.clearInkSelection();
			return;
		}
		this.pushUndoSnapshot();
		this.inkStrokes = nextStrokes;
		this.selectedInkStrokeIds.clear();
		this.annotationsDirty = true;
		this.renderAllInkStrokes();
		this.updateToolbarState();
		this.syncAsActivePdfDocument();
		void this.persistPdfAnnotations();
	}

	private copySelectedInkStrokes(): void {
		if (this.selectedInkStrokeIds.size === 0) {
			return;
		}
		const selectedIds = new Set(this.selectedInkStrokeIds);
		this.strokeClipboard = clonePdfInkStrokes(
			this.inkStrokes.filter((stroke) => selectedIds.has(stroke.id))
		);
		this.pasteSequence = 0;
	}

	private pasteCopiedInkStrokes(): void {
		if (this.strokeClipboard.length === 0 || this.pageCount <= 0) {
			return;
		}
		const pageNumber = this.clampPage(this.currentPage);
		const offset = Math.min(0.18, 0.035 * (this.pasteSequence + 1));
		this.pasteSequence += 1;
		const pastedStrokes = this.strokeClipboard.map((stroke) => ({
			...clonePdfInkStrokes([stroke])[0],
			id: this.createInkId(),
			pageNumber,
			points: stroke.points.map((point) => ({
				...point,
				x: this.clampInkUnit(point.x + offset),
				y: this.clampInkUnit(point.y + offset),
			})),
		}));
		if (pastedStrokes.length === 0) {
			return;
		}
		this.pushUndoSnapshot();
		this.inkStrokes.push(...pastedStrokes);
		this.selectedInkStrokeIds = new Set(pastedStrokes.map((stroke) => stroke.id));
		this.annotationsDirty = true;
		this.renderAllInkStrokes();
		this.updateToolbarState();
		this.syncAsActivePdfDocument();
		void this.persistPdfAnnotations();
	}

	private clearCurrentPageInkStrokes(): void {
		if (this.pageCount <= 0) {
			return;
		}
		const pageNumber = this.clampPage(this.currentPage);
		const nextStrokes = this.inkStrokes.filter((stroke) => stroke.pageNumber !== pageNumber);
		if (nextStrokes.length === this.inkStrokes.length) {
			return;
		}
		this.pushUndoSnapshot();
		this.inkStrokes = nextStrokes;
		this.selectedInkStrokeIds.clear();
		this.annotationsDirty = true;
		this.renderAllInkStrokes();
		this.updateToolbarState();
		this.syncAsActivePdfDocument();
		void this.persistPdfAnnotations({ notify: true });
	}

	private clearAllInkStrokes(): void {
		if (this.inkStrokes.length === 0) {
			return;
		}
		if (typeof window !== "undefined" && !window.confirm("清空这个 PDF 的全部标注？")) {
			return;
		}
		this.pushUndoSnapshot();
		this.inkStrokes = [];
		this.selectedInkStrokeIds.clear();
		this.annotationsDirty = true;
		this.renderAllInkStrokes();
		this.updateToolbarState();
		this.syncAsActivePdfDocument();
		void this.persistPdfAnnotations({ notify: true });
	}

	private handleReaderKeyDown(event: KeyboardEvent): void {
		const target = event.target instanceof HTMLElement ? event.target : null;
		if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
			return;
		}
		if (event.key === "Escape") {
			this.closeMoreToolsPanel();
			this.clearInkSelection();
			this.clearCaptureSelection();
			this.finishActiveInkInput();
			return;
		}
		if ((event.key === "Delete" || event.key === "Backspace") && this.selectedInkStrokeIds.size > 0) {
			event.preventDefault();
			this.deleteSelectedInkStrokes();
			return;
		}
		if (!(event.ctrlKey || event.metaKey)) {
			return;
		}
		const key = event.key.toLowerCase();
		if (key === "c" && this.selectedInkStrokeIds.size > 0) {
			event.preventDefault();
			this.copySelectedInkStrokes();
			return;
		}
		if (key === "v" && this.strokeClipboard.length > 0) {
			event.preventDefault();
			this.pasteCopiedInkStrokes();
		}
	}

	private finishEraserSession(): void {
		if (this.eraserSessionChanged && this.eraserSessionBefore) {
			this.undoInkStack.push(this.eraserSessionBefore);
			this.trimInkHistory();
			this.redoInkStack = [];
			this.annotationsDirty = true;
			this.updateToolbarState();
			this.syncAsActivePdfDocument();
			void this.persistPdfAnnotations();
		}
		this.activeInkPointerId = null;
		this.eraserSessionBefore = null;
		this.eraserSessionChanged = false;
	}

	private createInkStroke(pageNumber: number, point: PdfInkPoint): PdfInkStroke {
		const highlighter = this.activeTool === "highlighter";
		return {
			id: this.createInkId(),
			pageNumber,
			tool: highlighter ? "highlighter" : "pen",
			color: highlighter ? this.highlighterColor : this.penColor,
			width: highlighter ? this.highlighterWidth : this.penWidth,
			points: [point],
		};
	}

	private eventToInkPoint(event: PointerEvent, layer: SVGSVGElement): PdfInkPoint | null {
		const rect = layer.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			return null;
		}
		return {
			x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
			y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
			t: Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now(),
			pressure: Number.isFinite(event.pressure) ? event.pressure : undefined,
		};
	}

	private findInkStrokeAtPoint(
		pageNumber: number,
		point: PdfInkPoint,
		layer: SVGSVGElement
	): PdfInkStroke | null {
		const rect = layer.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			return null;
		}
		const pageStrokes = this.inkStrokes.filter((stroke) => stroke.pageNumber === pageNumber);
		for (let index = pageStrokes.length - 1; index >= 0; index -= 1) {
			const stroke = pageStrokes[index];
			if (this.isStrokeNearInkPoint(stroke, point, rect, 16)) {
				return stroke;
			}
		}
		return null;
	}

	private translateInkStroke(stroke: PdfInkStroke, dx: number, dy: number): PdfInkStroke {
		return {
			...stroke,
			points: stroke.points.map((point) => ({
				...point,
				x: this.clampInkUnit(point.x + dx),
				y: this.clampInkUnit(point.y + dy),
			})),
		};
	}

	private normalizeInkBox(
		startPoint: PdfInkPoint,
		endPoint: PdfInkPoint
	): { left: number; top: number; right: number; bottom: number } {
		return {
			left: Math.min(startPoint.x, endPoint.x),
			top: Math.min(startPoint.y, endPoint.y),
			right: Math.max(startPoint.x, endPoint.x),
			bottom: Math.max(startPoint.y, endPoint.y),
		};
	}

	private isStrokeInInkBox(
		stroke: PdfInkStroke,
		box: { left: number; top: number; right: number; bottom: number }
	): boolean {
		return stroke.points.some(
			(point) =>
				point.x >= box.left &&
				point.x <= box.right &&
				point.y >= box.top &&
				point.y <= box.bottom
		);
	}

	private hasMeaningfulInkDrag(startPoint: PdfInkPoint, endPoint: PdfInkPoint): boolean {
		return Math.abs(startPoint.x - endPoint.x) > 0.004 || Math.abs(startPoint.y - endPoint.y) > 0.004;
	}

	private clampInkUnit(value: number): number {
		return Math.max(0, Math.min(1, value));
	}

	private renderAllInkStrokes(): void {
		for (const pageNumber of this.annotationLayers.keys()) {
			this.renderInkStrokesForPage(pageNumber);
		}
	}

	private renderInkStrokesForPage(pageNumber: number): void {
		const layer = this.annotationLayers.get(pageNumber);
		if (!layer) {
			return;
		}
		layer.replaceChildren(
			...this.inkStrokes
				.filter((stroke) => stroke.pageNumber === pageNumber)
				.flatMap((stroke) =>
					this.selectedInkStrokeIds.has(stroke.id)
						? [this.createInkSelectionHaloElement(stroke), this.createInkStrokeElement(stroke)]
						: [this.createInkStrokeElement(stroke)]
				)
		);
		this.renderCaptureSelectionForPage(pageNumber);
	}

	private renderCaptureSelectionForPage(pageNumber: number): void {
		const selection = this.captureSelection;
		const layer = this.annotationLayers.get(pageNumber);
		if (!selection || !layer || selection.pageNumber !== pageNumber) {
			return;
		}
		const rect = this.createInkSelectionRect(layer, "weave-pdf-capture-box");
		const startPoint: PdfInkPoint = {
			x: selection.box.left,
			y: selection.box.top,
			t: 0,
		};
		const endPoint: PdfInkPoint = {
			x: selection.box.right,
			y: selection.box.bottom,
			t: 0,
		};
		this.updateInkRect(rect, startPoint, endPoint);
	}

	private renderTextAnnotationsForPage(pageNumber: number): void {
		const layer = this.textAnnotationLayers.get(pageNumber);
		if (!layer) {
			return;
		}
		layer.replaceChildren(
			...this.textAnnotations
				.filter((annotation) => annotation.pageNumber === pageNumber)
				.flatMap((annotation) =>
					annotation.rects.map((rect) => {
						const el = document.createElement("div");
						el.className = "weave-pdf-text-annotation";
						el.dataset.annotationId = annotation.id;
						el.style.left = `${this.formatPdfCssNumber(rect.x * 100)}%`;
						el.style.top = `${this.formatPdfCssNumber(rect.y * 100)}%`;
						el.style.width = `${this.formatPdfCssNumber(rect.width * 100)}%`;
						el.style.height = `${this.formatPdfCssNumber(rect.height * 100)}%`;
						el.style.background = annotation.color;
						return el;
					})
				)
		);
	}

	private createInkStrokeElement(
		stroke: PdfInkStroke,
		options: { forcePath?: boolean; live?: boolean } = {}
	): SVGElement {
		const element =
			!options.forcePath && stroke.points.length <= 1
				? document.createElementNS("http://www.w3.org/2000/svg", "circle")
				: document.createElementNS("http://www.w3.org/2000/svg", "path");
		element.classList.add("weave-pdf-ink-stroke", `weave-pdf-ink-${stroke.tool}`);
		if (options.live) {
			element.setAttribute("data-weave-pdf-live-stroke", "true");
		}
		if (this.selectedInkStrokeIds.has(stroke.id)) {
			element.classList.add("selected");
		}
		element.setAttribute("stroke", stroke.color);
		element.setAttribute("fill", "none");
		element.setAttribute("stroke-linecap", "round");
		element.setAttribute("stroke-linejoin", "round");
		element.setAttribute("stroke-width", String(stroke.width));
		element.setAttribute("vector-effect", "non-scaling-stroke");
		element.setAttribute("data-stroke-id", stroke.id);
		this.updateInkStrokeElement(element, stroke);
		return element;
	}

	private createInkSelectionHaloElement(stroke: PdfInkStroke): SVGElement {
		const element =
			stroke.points.length <= 1
				? document.createElementNS("http://www.w3.org/2000/svg", "circle")
				: document.createElementNS("http://www.w3.org/2000/svg", "path");
		element.classList.add("weave-pdf-ink-selection-halo");
		element.setAttribute("stroke", "var(--interactive-accent)");
		element.setAttribute("fill", "none");
		element.setAttribute("stroke-linecap", "round");
		element.setAttribute("stroke-linejoin", "round");
		element.setAttribute("stroke-width", String(Math.max(stroke.width + 8, stroke.width * 1.8)));
		element.setAttribute("vector-effect", "non-scaling-stroke");
		element.setAttribute("data-stroke-id", stroke.id);
		this.updateInkStrokeElement(element, stroke);
		return element;
	}

	private updateInkStrokeElement(element: SVGElement | null, stroke: PdfInkStroke): void {
		if (!element) {
			return;
		}
		if (element.tagName.toLowerCase() === "circle") {
			const point = stroke.points[0] ?? { x: 0, y: 0 };
			element.setAttribute("cx", this.formatInkNumber(point.x));
			element.setAttribute("cy", this.formatInkNumber(point.y));
			element.setAttribute("r", "0.001");
			return;
		}
		const path = stroke.points
			.map((point, index) => {
				const command = index === 0 ? "M" : "L";
				return `${command} ${this.formatInkNumber(point.x)} ${this.formatInkNumber(point.y)}`;
			})
			.join(" ");
		element.setAttribute("d", path);
	}

	private eraseInkAtPoint(
		pageNumber: number,
		point: PdfInkPoint,
		layer: SVGSVGElement
	): boolean {
		const rect = layer.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			return false;
		}
		const before = this.inkStrokes.length;
		this.inkStrokes = this.inkStrokes.filter((stroke) => {
			return (
				stroke.pageNumber !== pageNumber ||
				!this.isStrokeNearInkPoint(stroke, point, rect, this.eraserRadius)
			);
		});
		const changed = this.inkStrokes.length !== before;
		if (changed) {
			this.renderInkStrokesForPage(pageNumber);
		}
		return changed;
	}

	private isStrokeNearInkPoint(
		stroke: PdfInkStroke,
		point: PdfInkPoint,
		rect: DOMRect,
		radiusPx: number
	): boolean {
		const target = this.inkPointToPx(point, rect);
		const radiusSquared = radiusPx * radiusPx;
		for (let index = 0; index < stroke.points.length; index += 1) {
			const current = this.inkPointToPx(stroke.points[index], rect);
			const next = stroke.points[index + 1] ? this.inkPointToPx(stroke.points[index + 1], rect) : null;
			const distanceSquared = next
				? this.distanceToSegmentSquared(target, current, next)
				: this.distanceSquared(target, current);
			if (distanceSquared <= radiusSquared) {
				return true;
			}
		}
		return false;
	}

	private inkPointToPx(point: PdfInkPoint, rect: DOMRect): { x: number; y: number } {
		return {
			x: point.x * rect.width,
			y: point.y * rect.height,
		};
	}

	private distanceSquared(
		left: { x: number; y: number },
		right: { x: number; y: number }
	): number {
		const dx = left.x - right.x;
		const dy = left.y - right.y;
		return dx * dx + dy * dy;
	}

	private distanceToSegmentSquared(
		point: { x: number; y: number },
		start: { x: number; y: number },
		end: { x: number; y: number }
	): number {
		const dx = end.x - start.x;
		const dy = end.y - start.y;
		const lengthSquared = dx * dx + dy * dy;
		if (lengthSquared <= 0) {
			return this.distanceSquared(point, start);
		}
		const ratio = Math.max(
			0,
			Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
		);
		return this.distanceSquared(point, {
			x: start.x + ratio * dx,
			y: start.y + ratio * dy,
		});
	}

	private undoPdfInk(): void {
		const previous = this.undoInkStack.pop();
		if (!previous) {
			return;
		}
		this.redoInkStack.push(clonePdfInkStrokes(this.inkStrokes));
		this.inkStrokes = clonePdfInkStrokes(previous);
		this.annotationsDirty = true;
		this.renderAllInkStrokes();
		this.updateToolbarState();
		this.syncAsActivePdfDocument();
		void this.persistPdfAnnotations();
	}

	private redoPdfInk(): void {
		const next = this.redoInkStack.pop();
		if (!next) {
			return;
		}
		this.undoInkStack.push(clonePdfInkStrokes(this.inkStrokes));
		this.trimInkHistory();
		this.inkStrokes = clonePdfInkStrokes(next);
		this.annotationsDirty = true;
		this.renderAllInkStrokes();
		this.updateToolbarState();
		this.syncAsActivePdfDocument();
		void this.persistPdfAnnotations();
	}

	private pushUndoSnapshot(): void {
		this.undoInkStack.push(clonePdfInkStrokes(this.inkStrokes));
		this.trimInkHistory();
		this.redoInkStack = [];
	}

	private trimInkHistory(): void {
		if (this.undoInkStack.length > 50) {
			this.undoInkStack.splice(0, this.undoInkStack.length - 50);
		}
		if (this.redoInkStack.length > 50) {
			this.redoInkStack.splice(0, this.redoInkStack.length - 50);
		}
	}

	private releaseInkPointer(layer: SVGSVGElement | undefined, pointerId: number): void {
		try {
			layer?.releasePointerCapture?.(pointerId);
		} catch {
			// Pointer capture is optional in the embedded Obsidian webview.
		}
	}

	private formatInkNumber(value: number): string {
		return String(Math.round(value * 100000) / 100000);
	}

	private formatPdfCssNumber(value: number): string {
		return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "0";
	}

	private normalizeInkColor(value: string, fallback: string): string {
		const text = String(value || "").trim();
		return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
	}

	private createInkId(): string {
		if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
			return crypto.randomUUID();
		}
		return `pdf-ink-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	}

	private setZoom(nextZoom: number): void {
		const normalizedZoom = Math.max(0.5, Math.min(2, Number(nextZoom.toFixed(2))));
		if (normalizedZoom === this.zoom) {
			return;
		}
		this.zoom = normalizedZoom;
		void this.rerenderPagesAtCurrentZoom();
	}

	private async rerenderPagesAtCurrentZoom(): Promise<void> {
		if (!this.pdfDocument || !this.pagesScrollEl) {
			this.updateToolbarState();
			return;
		}
		const token = ++this.renderToken;
		this.pageEls.clear();
		this.pagesScrollEl.empty();
		await this.renderPages(this.pdfDocument, this.pagesScrollEl, token);
		if (!this.isCurrentRender(token)) {
			return;
		}
		this.goToPage(this.currentPage, { scroll: true });
		this.updateToolbarState();
	}

	private goToPage(
		pageNumber: number,
		options: { scroll?: boolean } = { scroll: true }
	): void {
		if (this.pageCount <= 0) {
			return;
		}
		const nextPage = this.clampPage(pageNumber);
		this.currentPage = nextPage;
		this.markPageVisited(nextPage);
		this.updateToolbarState();
		this.syncAsActivePdfDocument();
		void this.persistPdfProgress();

		if (options.scroll === false) {
			return;
		}
		const pageEl = this.pageEls.get(nextPage) as
			| (HTMLElement & { scrollIntoView?: (options?: ScrollIntoViewOptions) => void })
			| undefined;
		pageEl?.scrollIntoView?.({ block: "start", behavior: "smooth" });
	}

	private updateCurrentPageFromScroll(): void {
		if (!this.pagesScrollEl || this.pageEls.size === 0) {
			return;
		}
		const containerRect = this.pagesScrollEl.getBoundingClientRect();
		const targetY = containerRect.top + containerRect.height * 0.28;
		let closestPage = this.currentPage;
		let closestDistance = Number.POSITIVE_INFINITY;
		let visitedPagesChanged = false;

		for (const [pageNumber, pageEl] of this.pageEls) {
			const rect = pageEl.getBoundingClientRect();
			const distance = Math.abs(rect.top - targetY);
			if (distance < closestDistance) {
				closestDistance = distance;
				closestPage = pageNumber;
			}
			const visibleHeight = Math.max(
				0,
				Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top)
			);
			const minimumVisibleHeight = Math.max(1, Math.min(rect.height * 0.25, 80));
			if (visibleHeight >= minimumVisibleHeight) {
				const beforeSize = this.visitedPages.size;
				this.markPageVisited(pageNumber);
				visitedPagesChanged = visitedPagesChanged || this.visitedPages.size !== beforeSize;
			}
		}

		const currentPageChanged = closestPage !== this.currentPage;
		if (currentPageChanged) {
			this.currentPage = closestPage;
		}
		if (currentPageChanged || visitedPagesChanged) {
			this.updateToolbarState();
			this.syncAsActivePdfDocument();
			void this.persistPdfProgress();
		}
	}

	private updateToolbarState(): void {
		const pageLabel = this.pageCount > 0 ? `${this.currentPage} / ${this.pageCount}` : "0 / 0";
		if (this.pageIndicatorEl) {
			this.pageIndicatorEl.textContent = pageLabel;
		}
		if (this.zoomLabelEl) {
			this.zoomLabelEl.textContent = `${Math.round(this.zoom * 100)}%`;
		}
		if (this.previousPageButtonEl) {
			this.previousPageButtonEl.disabled = this.currentPage <= 1 || this.pageCount <= 0;
		}
		if (this.nextPageButtonEl) {
			this.nextPageButtonEl.disabled = this.currentPage >= this.pageCount || this.pageCount <= 0;
		}
		if (this.undoInkButtonEl) {
			this.undoInkButtonEl.disabled = this.undoInkStack.length === 0;
		}
		if (this.redoInkButtonEl) {
			this.redoInkButtonEl.disabled = this.redoInkStack.length === 0;
		}
		this.syncToolUiState();
	}

	private calculateProgress(): number {
		if (this.pageCount <= 0) {
			return 0;
		}
		return Math.max(
			0,
			Math.min(100, Math.round((this.getFurthestVisitedPage() / this.pageCount) * 100))
		);
	}

	private getFurthestVisitedPage(): number {
		const visited = Array.from(this.visitedPages).filter((page) => page >= 1 && page <= this.pageCount);
		return Math.max(0, ...visited, this.currentPage);
	}

	private clampPage(pageNumber: number): number {
		if (this.pageCount <= 0) {
			return 1;
		}
		return Math.max(1, Math.min(this.pageCount, Math.floor(Number(pageNumber) || 1)));
	}

	private resolvePdfFile(): TFile | null {
		const normalizedPath = normalizePath(this.filePath || "");
		if (!normalizedPath || !isPdfBookFormat(normalizedPath)) {
			return null;
		}

		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
		return file instanceof TFile && isPdfBookFormat(file.path) ? file : null;
	}

	private getResolvedTitle(): string {
		const fileName = this.filePath.split(/[\\/]/).pop() || "";
		return stripSupportedBookExtension(fileName).trim() || "PDF";
	}

	private syncAsActivePdfDocumentIfActive(
		leaf: WorkspaceLeaf | null = this.app.workspace.activeLeaf
	): void {
		if (leaf !== this.leaf) {
			return;
		}
		this.syncAsActivePdfDocument();
	}

	private syncAsActivePdfDocument(): void {
		const filePath = this.getCurrentFilePath();
		if (!filePath || !isPdfBookFormat(filePath)) {
			return;
		}

		const pdfState: PdfSharedState = {
			filePath,
			title: this.getResolvedTitle(),
		};
		if (this.pageCount > 0) {
			pdfState.currentPage = this.currentPage;
			pdfState.pageCount = this.pageCount;
			pdfState.furthestPage = this.getFurthestVisitedPage();
			pdfState.progress = this.calculateProgress();
			pdfState.visitedPageCount = this.visitedPages.size;
			pdfState.activeTool = this.activeTool;
			pdfState.inkStrokeCount = this.inkStrokes.length;
			pdfState.thumbnails = this.thumbnails;
			pdfState.onNavigatePage = (pageNumber: number) => {
				this.goToPage(pageNumber);
			};
		}
		epubActiveDocumentStore.setActivePdfDocument(pdfState);
	}

	private isCurrentRender(token: number): boolean {
		return this.isOpen && token === this.renderToken;
	}

	private async disposeLoadedPdf(): Promise<void> {
		const pdf = this.pdfDocument;
		this.pdfDocument = null;
		if (pdf) {
			await this.destroyPdfDocument(pdf);
		}
	}

	private async destroyPdfDocument(pdf: PdfDocumentLike): Promise<void> {
		if (typeof pdf.destroy === "function") {
			await pdf.destroy();
		}
	}

	private markPageVisited(pageNumber: number): void {
		if (this.pageCount <= 0) {
			return;
		}
		this.visitedPages.add(this.clampPage(pageNumber));
	}

	private async restoreSavedPdfProgress(token: number): Promise<void> {
		if (this.pageCount <= 0) {
			return;
		}

		try {
			const filePath = this.getCurrentFilePath();
			const book = await getEpubStorageService(this.app).findBookByFilePath(filePath);
			if (!this.isCurrentRender(token) || !book?.currentPosition) {
				return;
			}

			const restoredPage = this.parsePdfPageFromCfi(book.currentPosition.cfi);
			if (restoredPage) {
				this.currentPage = this.clampPage(restoredPage);
			}

			const restoredVisitedPages = this.parseVisitedPagesFromCfi(book.currentPosition.cfi);
			if (restoredVisitedPages.size > 0) {
				this.visitedPages = restoredVisitedPages;
				return;
			}

			const storedProgress = Math.max(
				0,
				Math.min(100, Math.round(Number(book.currentPosition.percent) || 0))
			);
			const restoredCount = Math.max(
				0,
				Math.min(this.pageCount, Math.ceil((storedProgress / 100) * this.pageCount))
			);
			for (let page = 1; page <= restoredCount; page += 1) {
				this.visitedPages.add(page);
			}
		} catch {
			// Progress restore is best-effort; a PDF can still be read without stored state.
		}
	}

	private async persistPdfProgress(): Promise<void> {
		if (this.pageCount <= 0 || this.visitedPages.size <= 0) {
			return;
		}

		const filePath = this.getCurrentFilePath();
		if (!filePath) {
			return;
		}

		const cfi = this.buildPdfProgressCfi();
		if (cfi === this.lastPersistedProgressCfi) {
			return;
		}

		const token = ++this.persistProgressToken;
		try {
			const storageService = getEpubStorageService(this.app);
			const book = await storageService.findBookByFilePath(filePath);
			if (token !== this.persistProgressToken || !book?.id) {
				return;
			}

			await storageService.saveProgress(book.id, {
				chapterIndex: this.currentPage - 1,
				cfi,
				percent: this.calculateProgress(),
			});
			this.lastPersistedProgressCfi = cfi;
			this.bookshelfProgressChangedNotifier.notify(filePath);
		} catch {
			// Keep reading responsive even if bookshelf persistence is temporarily unavailable.
		}
	}

	private async flushPendingPdfProgress(): Promise<void> {
		try {
			await getEpubStorageService(this.app).flushPendingProgress?.();
		} catch {
			// Closing the reader should not be blocked by a failed progress flush.
		}
	}

	private buildPdfProgressCfi(): string {
		const visitedRanges = this.serializeVisitedPageRanges();
		return visitedRanges
			? `pdf-page:${this.currentPage}|visited:${visitedRanges}`
			: `pdf-page:${this.currentPage}`;
	}

	private parsePdfPageFromCfi(cfi: string | undefined): number | null {
		const match = String(cfi || "").match(/(?:^|\|)pdf-page:(\d+)/);
		if (!match) {
			return null;
		}
		const page = Number(match[1]);
		return Number.isFinite(page) && page > 0 ? Math.floor(page) : null;
	}

	private parseVisitedPagesFromCfi(cfi: string | undefined): Set<number> {
		const result = new Set<number>();
		const match = String(cfi || "").match(/(?:^|\|)visited:([^|]+)/);
		if (!match) {
			return result;
		}

		for (const part of match[1].split(",")) {
			const range = part.trim();
			if (!range) {
				continue;
			}
			const rangeMatch = range.match(/^(\d+)-(\d+)$/);
			if (rangeMatch) {
				const start = Math.max(1, Math.floor(Number(rangeMatch[1])));
				const end = Math.min(this.pageCount, Math.floor(Number(rangeMatch[2])));
				for (let page = start; page <= end; page += 1) {
					result.add(page);
				}
				continue;
			}
			const page = Math.floor(Number(range));
			if (Number.isFinite(page) && page >= 1 && page <= this.pageCount) {
				result.add(page);
			}
		}
		return result;
	}

	private serializeVisitedPageRanges(): string {
		const pages = Array.from(this.visitedPages)
			.filter((page) => page >= 1 && page <= this.pageCount)
			.sort((left, right) => left - right);
		const ranges: string[] = [];
		for (const page of pages) {
			const lastRange = ranges[ranges.length - 1];
			if (!lastRange) {
				ranges.push(String(page));
				continue;
			}
			const [startText, endText = startText] = lastRange.split("-");
			const end = Number(endText);
			if (page === end + 1) {
				ranges[ranges.length - 1] = `${startText}-${page}`;
			} else {
				ranges.push(String(page));
			}
		}
		return ranges.join(",");
	}

	private refreshViewTitle(): void {
		const title = this.getResolvedTitle();
		try {
			const leafWithHeader = this.leaf as WorkspaceLeaf & { updateHeader?: () => void };
			leafWithHeader.updateHeader?.();
			const titleEl = this.leaf?.view?.containerEl?.querySelector(".view-header-title");
			if (titleEl instanceof HTMLElement) {
				titleEl.textContent = title;
				titleEl.setAttribute("aria-label", title);
			}
		} catch {
			// Obsidian refreshes the tab title on its own if this internal hook is unavailable.
		}
	}
}
