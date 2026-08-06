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
import type { VaultConfigLike } from "../types/obsidian-extensions";
import { isPdfBookFormat, stripSupportedBookExtension } from "../services/epub/book-format";
import { createDebouncedBookshelfProgressChangedNotifier } from "../services/epub/bookshelf-data-events";
import { getEpubStorageService } from "../services/epub/epub-storage-access";
import {
	EPUB_DUAL_WINDOW_ANNOTATION_EVENT,
	type EpubDualWindowAnnotationDetail,
} from "../services/epub/epub-dual-window";
import { EPUB_RUNTIME } from "../services/epub/epub-runtime";
import {
	activeSemanticEntries,
	normalizeAnnotationStyle,
	resolveExpertSemanticShortcutEntries,
	SEMANTIC_COLOR_HEX,
} from "../services/epub/semantic/profiles";
import {
	normalizeEpubSemanticSettings,
	type EpubAnnotationSemantic,
	type EpubSemanticSettings,
} from "../services/epub/semantic/semantic-store";
import {
	normalizeEpubReaderUiMode,
	type EpubReaderUiMode,
} from "../services/epub/reader-ui-mode";
import {
	epubActiveDocumentStore,
	type PdfPageThumbnail,
	type PdfSharedAnnotation,
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
	type PdfTextAnnotationKind,
	type PdfTextAnnotationRect,
} from "../services/pdf/pdf-ink-annotation-store";
import {
	PdfTextAnnotationStore,
	sortPdfTextAnnotationsByPosition,
} from "../services/pdf/pdf-text-annotation-store";
import { resolvePdfPortableBookDataLocation } from "../services/pdf/pdf-portable-data-location";
import { renderPdfAnnotationNoteMarkdown } from "../services/pdf/pdf-annotation-note-markdown";
import { openAnnotationNoteFileWithExistingLeaf } from "../services/epub/open-annotation-note-file";
import { DirectoryUtils } from "../utils/directory-utils";

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

interface PdfAnnotationNavigationTarget {
	annotationId?: string;
	pageNumber?: number;
}

interface PdfAnnotationHistorySnapshot {
	inkStrokes: PdfInkStroke[];
	textAnnotations: PdfTextAnnotation[];
}

interface PdfTextFlowFragment {
	text: string;
	flowIndex: number;
	lineIndex: number;
	rect: PdfTextAnnotationRect;
}

interface PdfTextSelectionAnchor {
	flowIndex: number;
	offset: number;
}

interface PdfTextSelectionSegment {
	text: string;
	lineIndex: number;
	rect: PdfTextAnnotationRect;
}

interface PdfCaptureSelection {
	pageNumber: number;
	box: { left: number; top: number; right: number; bottom: number };
}

type PdfTextSemanticKind = Exclude<PdfTextAnnotationKind, "note">;

interface PdfTextSemanticButtonOptions {
	mode?: "expert" | "standard";
	action?: string;
	active?: boolean;
	onClick?: (semantic: EpubAnnotationSemantic) => void;
}

type PdfPluginSettingsLike = Partial<{
	readerUiMode: EpubReaderUiMode;
	expertModeEnabled: boolean;
	annotationSemanticsEnabled: boolean;
	semanticSchemeId: string;
	annotationSemantics: EpubAnnotationSemantic[];
	expertSemanticLimit: EpubSemanticSettings["expertSemanticLimit"];
	standardSemanticIds: string[];
}>;

interface PdfVaultBinaryAdapterLike {
	exists?: (path: string) => Promise<boolean>;
	mkdir?: (path: string) => Promise<void>;
	writeBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
}

const PDF_SEMANTIC_COLOR_ALIASES: Record<string, string> = {
	cyan: "teal",
	pink: "magenta",
	gray: "slate",
};

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
	private textLayers: Map<number, HTMLElement> = new Map();
	private textAnnotationLayers: Map<number, HTMLElement> = new Map();
	private visitedPages: Set<number> = new Set();
	private activeTool: PdfAnnotationTool = "pan";
	private activeInkTool: PdfInkDrawingTool = "pen";
	private toolSettingsOpen = false;
	private toolButtons: Map<PdfAnnotationTool, HTMLButtonElement> = new Map();
	private inkModeButtons: Map<PdfInkDrawingTool, HTMLButtonElement> = new Map();
	private readonly annotationStore = new PdfInkAnnotationStore(this.app);
	private readonly textAnnotationStore = new PdfTextAnnotationStore(this.app);
	private inkStrokes: PdfInkStroke[] = [];
	private textAnnotations: PdfTextAnnotation[] = [];
	private undoInkStack: PdfAnnotationHistorySnapshot[] = [];
	private redoInkStack: PdfAnnotationHistorySnapshot[] = [];
	private activeInkStroke: PdfInkStroke | null = null;
	private activeInkPathEl: SVGElement | null = null;
	private activeInkPointerId: number | null = null;
	private eraserSessionBefore: PdfInkStroke[] | null = null;
	private eraserSessionChanged = false;
	private selectedInkStrokeIds: Set<string> = new Set();
	private selectedInkDragGroupEl: SVGGElement | null = null;
	private selectedInkDragPageNumber: number | null = null;
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
	private captureSelection: PdfCaptureSelection | null = null;
	private captureActionBarEl: HTMLElement | null = null;
	private textActionBarEl: HTMLElement | null = null;
	private editingTextAnnotationId = "";
	private focusedTextAnnotationTimer: number | null = null;
	private focusedTextAnnotationEl: HTMLElement | null = null;
	private activeTextSelectionPointerId: number | null = null;
	private textSelectionDrag: {
		pageNumber: number;
		anchor: PdfTextSelectionAnchor;
		moved: boolean;
	} | null = null;
	private selectedPdfTextSelection: {
		pageNumber: number;
		text: string;
		rects: PdfTextAnnotationRect[];
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
	private pendingAnnotationNavigation: PdfAnnotationNavigationTarget | null = null;
	private lastPersistedProgressCfi = "";
	private persistProgressToken = 0;
	private readonly bookshelfProgressChangedNotifier =
		createDebouncedBookshelfProgressChangedNotifier();
	private readonly handleContentKeyDown = (event: KeyboardEvent) => {
		this.handleReaderKeyDown(event);
	};
	private readonly handleDualWindowAnnotationEvent = (event: Event) => {
		this.handlePdfDualWindowAnnotationEvent(event);
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
		const parentSetState = Object.getPrototypeOf(PdfView.prototype)?.setState;
		if (typeof parentSetState === "function") {
			await parentSetState.call(this, state, result);
		}
		const viewState =
			state && typeof state === "object" && !Array.isArray(state)
				? (state as Record<string, unknown>)
				: {};
		const navigationTarget = this.readAnnotationNavigationTarget(viewState);
		if (navigationTarget) {
			this.pendingAnnotationNavigation = navigationTarget;
		}
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
			return;
		}
		if (navigationTarget && this.isOpen) {
			this.applyPendingAnnotationNavigation();
		}
	}

	private readAnnotationNavigationTarget(
		viewState: Record<string, unknown>
	): PdfAnnotationNavigationTarget | null {
		const annotationId = String(
			viewState.annotationId || viewState.pdfAnnotationId || ""
		).trim();
		const pageNumber = Math.floor(Number(viewState.pageNumber || viewState.page || 0));
		const target: PdfAnnotationNavigationTarget = {};
		if (annotationId) {
			target.annotationId = annotationId;
		}
		if (Number.isFinite(pageNumber) && pageNumber > 0) {
			target.pageNumber = pageNumber;
		}
		return target.annotationId || target.pageNumber ? target : null;
	}

	private applyPendingAnnotationNavigation(): void {
		const target = this.pendingAnnotationNavigation;
		if (!target) {
			return;
		}
		if (target.annotationId && this.goToTextAnnotation(target.annotationId)) {
			this.pendingAnnotationNavigation = null;
			return;
		}
		if (target.pageNumber) {
			this.goToPage(target.pageNumber, { scroll: true });
			this.pendingAnnotationNavigation = null;
		}
	}

	private handlePdfDualWindowAnnotationEvent(event: Event): void {
		const detail = (event as CustomEvent<EpubDualWindowAnnotationDetail>).detail;
		if (!detail || detail.mode !== "book-annotation-note") {
			return;
		}
		if (normalizePath(detail.filePath || "") !== this.getCurrentFilePath()) {
			return;
		}
		if (detail.phase === "leave") {
			this.clearFocusedTextAnnotation();
			return;
		}
		const annotationId = String(detail.annotationId || "").trim();
		if (annotationId) {
			const jumped = this.goToTextAnnotation(annotationId);
			if (jumped && detail.phase === "click") {
				this.showPdfAnnotationJumpNotice(this.currentPage);
			}
			return;
		}
		if (typeof detail.pageNumber === "number" && Number.isFinite(detail.pageNumber)) {
			this.goToPage(Math.floor(detail.pageNumber), { scroll: true });
			if (detail.phase === "click") {
				this.showPdfAnnotationJumpNotice(this.currentPage);
			}
		}
	}

	private showPdfAnnotationJumpNotice(pageNumber: number): void {
		if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
			return;
		}
		new Notice(`已跳转到第 ${Math.floor(pageNumber)} 页`, 1600);
	}

	async onOpen(): Promise<void> {
		this.isOpen = true;
		this.contentEl.empty();
		this.contentEl.addClass("weave-pdf-view-content");
		this.contentEl.tabIndex = 0;
		this.contentEl.addEventListener("keydown", this.handleContentKeyDown);
		window.addEventListener(
			EPUB_DUAL_WINDOW_ANNOTATION_EVENT,
			this.handleDualWindowAnnotationEvent
		);
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
		this.clearFocusedTextAnnotation();
		this.bookshelfProgressChangedNotifier.flush();
		this.bookshelfProgressChangedNotifier.dispose();
		epubActiveDocumentStore.clearActiveDocument(this.getCurrentFilePath());
		this.contentEl.removeEventListener("keydown", this.handleContentKeyDown);
		window.removeEventListener(
			EPUB_DUAL_WINDOW_ANNOTATION_EVENT,
			this.handleDualWindowAnnotationEvent
		);
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
		this.captureActionBarEl = null;
		this.textActionBarEl = null;
		this.editingTextAnnotationId = "";
		this.clearFocusedTextAnnotation();
		this.activeTextSelectionPointerId = null;
		this.textSelectionDrag = null;
		this.selectedPdfTextSelection = null;
		this.strokeClipboard = [];
		this.pasteSequence = 0;
		this.annotationsDirty = false;
		this.lastPersistedProgressCfi = "";
		this.pageEls.clear();
		this.annotationLayers.clear();
		this.textLayers.clear();
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
		root.dataset.readerUiMode = this.getPdfReaderUiMode();
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
		this.createToolbarIconButton(rail, "file-text", "标注笔记", "open-annotation-note", () => {
			void this.openPdfAnnotationNoteMarkdown();
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
		if (tool !== "select") {
			this.clearPdfTextSelection();
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
			this.applyPendingAnnotationNavigation();
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

	private bindTextLayer(layer: HTMLElement, pageNumber: number): void {
		layer.addEventListener("pointerdown", (event) => {
			this.handleTextSelectionPointerDown(event, pageNumber, layer);
		});
		layer.addEventListener("pointermove", (event) => {
			this.handleTextSelectionPointerMove(event, pageNumber, layer);
		});
		layer.addEventListener("pointerup", (event) => {
			this.handleTextSelectionPointerUp(event, pageNumber, layer);
		});
		layer.addEventListener("pointercancel", (event) => {
			this.handleTextSelectionPointerCancel(event, pageNumber, layer);
		});
		layer.addEventListener("lostpointercapture", (event) => {
			this.handleTextSelectionPointerCancel(event, pageNumber, layer);
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
			this.textLayers.set(pageNumber, layer);
			layer.style.width = `${Math.max(1, Math.ceil(cssWidth))}px`;
			layer.style.height = `${Math.max(1, Math.ceil(cssHeight))}px`;
			let textIndex = 0;
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
				span.setAttribute("data-weave-pdf-text-fragment", "true");
				span.setAttribute("data-weave-pdf-text-index", String(textIndex));
				span.setAttribute("data-weave-pdf-text-x", this.formatInkNumber(left / Math.max(1, cssWidth)));
				span.setAttribute("data-weave-pdf-text-y", this.formatInkNumber(top / Math.max(1, cssHeight)));
				span.setAttribute("data-weave-pdf-text-width", this.formatInkNumber(width / Math.max(1, cssWidth)));
				span.setAttribute("data-weave-pdf-text-height", this.formatInkNumber(height / Math.max(1, cssHeight)));
				span.style.left = `${this.formatPdfCssNumber(left)}px`;
				span.style.top = `${this.formatPdfCssNumber(top)}px`;
				span.style.width = `${this.formatPdfCssNumber(width)}px`;
				span.style.height = `${this.formatPdfCssNumber(height)}px`;
				span.style.fontSize = `${this.formatPdfCssNumber(fontSize * scaleY)}px`;
				span.style.lineHeight = `${this.formatPdfCssNumber(height)}px`;
				textIndex += 1;
			}
			this.bindTextLayer(layer, pageNumber);
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
			const [inkDocument, textResult] = await Promise.all([
				this.annotationStore.load(filePath, this.pageCount),
				this.textAnnotationStore.load(filePath, this.pageCount),
			]);
			if (!this.isCurrentRender(token)) {
				return;
			}
			this.inkStrokes = inkDocument.strokes;
			if (textResult.exists) {
				this.textAnnotations = textResult.document.annotations;
			} else {
				this.textAnnotations = sortPdfTextAnnotationsByPosition(inkDocument.textAnnotations ?? []);
				if (this.textAnnotations.length > 0) {
					try {
						await this.textAnnotationStore.save(
							this.textAnnotationStore.createDocument(
								filePath,
								this.pageCount,
								this.textAnnotations
							)
						);
					} catch {
						// Legacy text annotations still render even if migration cannot be written.
					}
				}
			}
			this.annotationsDirty = false;
		} catch {
			this.inkStrokes = [];
			this.textAnnotations = [];
			this.annotationsDirty = false;
		}
	}

	private async persistPdfAnnotations(
		options: { notify?: boolean; force?: boolean; writeMarkdown?: boolean } = {}
	): Promise<TFile | null> {
		if (!this.annotationsDirty && !options.notify && !options.force) {
			return null;
		}
		const filePath = this.getCurrentFilePath();
		if (!filePath || this.pageCount <= 0) {
			return null;
		}

		try {
			await Promise.all([
				this.annotationStore.save({
					version: 1,
					sourcePath: filePath,
					pageCount: this.pageCount,
					strokes: this.inkStrokes,
					updatedAt: Date.now(),
				}),
				this.textAnnotationStore.save(
					this.textAnnotationStore.createDocument(
						filePath,
						this.pageCount,
						this.textAnnotations
					)
				),
			]);
			const noteFile =
				options.writeMarkdown === false ? null : await this.writePdfAnnotationNoteMarkdown();
			this.annotationsDirty = false;
			if (options.notify) {
				new Notice("PDF annotations saved");
			}
			return noteFile;
		} catch {
			if (options.notify) {
				new Notice("Unable to save PDF annotations");
			}
			return null;
		}
	}

	private async writePdfAnnotationNoteMarkdown(): Promise<TFile | null> {
		const filePath = this.getCurrentFilePath();
		if (!filePath || this.pageCount <= 0) {
			return null;
		}
		const location = resolvePdfPortableBookDataLocation(filePath);
		const markdown = renderPdfAnnotationNoteMarkdown({
			bookId: location.bookId,
			book: {
				title: this.getResolvedTitle(),
				filePath,
				pageCount: this.pageCount,
				currentPage: this.currentPage,
			},
			annotations: this.textAnnotations,
		});
		const normalizedMarkdown = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
		await DirectoryUtils.ensureDirForFile(
			this.app.vault.adapter,
			location.annotationsMarkdownPath
		);
		const existing = this.app.vault.getAbstractFileByPath(location.annotationsMarkdownPath);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, normalizedMarkdown);
			return existing;
		}
		return await this.app.vault.create(location.annotationsMarkdownPath, normalizedMarkdown);
	}

	private async openPdfAnnotationNoteMarkdown(): Promise<void> {
		const noteFile = await this.persistPdfAnnotations({ force: true });
		if (!noteFile) {
			new Notice("PDF 标注笔记暂不可用");
			return;
		}
		await openAnnotationNoteFileWithExistingLeaf(this.app, noteFile, {
			focus: true,
		});
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
			this.beginSelectedInkDragPreview(pageNumber, layer);
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
			this.releaseSelectedInkDragPreview(pageNumber);
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
			this.pushUndoSnapshot({ inkStrokes: drag.beforeStrokes });
			this.annotationsDirty = true;
			this.releaseSelectedInkDragPreview(pageNumber);
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
		const previousSelectionPage = this.captureSelection?.pageNumber;
		this.captureSelection = null;
		this.clearCaptureActionBar();
		if (previousSelectionPage) {
			this.renderInkStrokesForPage(previousSelectionPage);
		}
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

	private handleTextSelectionPointerDown(
		event: PointerEvent,
		pageNumber: number,
		layer: HTMLElement
	): void {
		if (this.activeTool !== "select") {
			return;
		}
		const point = this.eventToTextLayerPoint(event, layer);
		if (!point) {
			return;
		}
		const anchor = this.findTextSelectionAnchor(layer, point);
		if (!anchor) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		document.getSelection()?.removeAllRanges();
		this.clearPdfTextSelection();
		this.contentEl.focus?.({ preventScroll: true });
		this.activeTextSelectionPointerId = Number.isFinite(event.pointerId) ? event.pointerId : 1;
		try {
			layer.setPointerCapture?.(this.activeTextSelectionPointerId);
		} catch {
			// Pointer capture is optional in the embedded Obsidian webview.
		}
		this.textSelectionDrag = {
			pageNumber,
			anchor,
			moved: false,
		};
	}

	private handleTextSelectionPointerMove(
		event: PointerEvent,
		pageNumber: number,
		layer: HTMLElement
	): void {
		if (
			this.activeTextSelectionPointerId === null ||
			event.pointerId !== this.activeTextSelectionPointerId ||
			this.activeTool !== "select"
		) {
			return;
		}
		const drag = this.textSelectionDrag;
		const point = this.eventToTextLayerPoint(event, layer);
		if (!drag || drag.pageNumber !== pageNumber || !point) {
			return;
		}
		const focus = this.findTextSelectionAnchor(layer, point);
		if (!focus) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		drag.moved = drag.moved || this.hasMeaningfulTextAnchorMove(drag.anchor, focus);
		this.updatePdfTextSelectionFromAnchors(pageNumber, layer, drag.anchor, focus);
	}

	private handleTextSelectionPointerUp(
		event: PointerEvent,
		pageNumber: number,
		layer: HTMLElement
	): void {
		if (
			this.activeTextSelectionPointerId === null ||
			event.pointerId !== this.activeTextSelectionPointerId
		) {
			return;
		}
		const drag = this.textSelectionDrag;
		const point = this.eventToTextLayerPoint(event, layer);
		event.preventDefault();
		event.stopPropagation();
		this.releaseTextSelectionPointer(layer, event.pointerId);
		this.activeTextSelectionPointerId = null;
		this.textSelectionDrag = null;
		if (!drag || drag.pageNumber !== pageNumber || !point) {
			this.clearPdfTextSelection();
			return;
		}
		const focus = this.findTextSelectionAnchor(layer, point);
		if (!focus || (!drag.moved && !this.hasMeaningfulTextAnchorMove(drag.anchor, focus))) {
			this.clearPdfTextSelection();
			return;
		}
		this.updatePdfTextSelectionFromAnchors(pageNumber, layer, drag.anchor, focus);
		this.renderTextSelectionActionBarForPage(pageNumber);
	}

	private handleTextSelectionPointerCancel(
		event: PointerEvent,
		pageNumber: number,
		layer: HTMLElement
	): void {
		if (
			this.activeTextSelectionPointerId === null ||
			event.pointerId !== this.activeTextSelectionPointerId
		) {
			return;
		}
		this.releaseTextSelectionPointer(layer, event.pointerId);
		this.activeTextSelectionPointerId = null;
		this.textSelectionDrag = null;
		this.renderPdfTextSelectionForPage(pageNumber);
	}

	private eventToTextLayerPoint(event: PointerEvent, layer: HTMLElement): PdfInkPoint | null {
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

	private findTextSelectionAnchor(
		layer: HTMLElement,
		point: PdfInkPoint
	): PdfTextSelectionAnchor | null {
		const fragments = this.readPdfTextFlowFragments(layer);
		if (fragments.length === 0) {
			return null;
		}
		const lines = this.groupPdfTextFragmentsByLine(fragments);
		if (lines.length === 0) {
			return null;
		}
		const line = this.findClosestPdfTextLine(lines, point.y);
		if (!line || line.fragments.length === 0) {
			return null;
		}
		const first = line.fragments[0];
		const last = line.fragments[line.fragments.length - 1];
		if (point.x <= first.rect.x) {
			return { flowIndex: first.flowIndex, offset: 0 };
		}
		if (point.x >= last.rect.x + last.rect.width) {
			return { flowIndex: last.flowIndex, offset: last.text.length };
		}
		for (let index = 0; index < line.fragments.length; index += 1) {
			const fragment = line.fragments[index];
			const right = fragment.rect.x + fragment.rect.width;
			if (point.x >= fragment.rect.x && point.x <= right) {
				return {
					flowIndex: fragment.flowIndex,
					offset: this.estimateTextOffset(fragment, point.x),
				};
			}
			const next = line.fragments[index + 1];
			if (next && point.x > right && point.x < next.rect.x) {
				const gapMiddle = right + (next.rect.x - right) / 2;
				return point.x < gapMiddle
					? { flowIndex: fragment.flowIndex, offset: fragment.text.length }
					: { flowIndex: next.flowIndex, offset: 0 };
			}
		}
		return { flowIndex: last.flowIndex, offset: last.text.length };
	}

	private readPdfTextFlowFragments(layer: HTMLElement): PdfTextFlowFragment[] {
		const rawFragments = Array.from(layer.querySelectorAll<HTMLElement>("[data-weave-pdf-text-fragment]"))
			.map((element) => {
				const text = element.textContent || "";
				const x = Number(element.getAttribute("data-weave-pdf-text-x"));
				const y = Number(element.getAttribute("data-weave-pdf-text-y"));
				const width = Number(element.getAttribute("data-weave-pdf-text-width"));
				const height = Number(element.getAttribute("data-weave-pdf-text-height"));
				if (!text || ![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
					return null;
				}
				return {
					text,
					rect: { x, y, width, height },
				};
			})
			.filter((fragment): fragment is { text: string; rect: PdfTextAnnotationRect } =>
				Boolean(fragment)
			);
		return this.groupPdfTextFragmentsByLine(
			rawFragments.map((fragment, index) => ({
				...fragment,
				flowIndex: index,
				lineIndex: 0,
			}))
		)
			.flatMap((line, lineIndex) =>
				line.fragments.map((fragment) => ({
					...fragment,
					lineIndex,
				}))
			)
			.map((fragment, flowIndex) => ({
				...fragment,
				flowIndex,
			}));
	}

	private groupPdfTextFragmentsByLine(
		fragments: PdfTextFlowFragment[]
	): Array<{ centerY: number; height: number; top: number; bottom: number; fragments: PdfTextFlowFragment[] }> {
		const lines: Array<{
			centerY: number;
			height: number;
			top: number;
			bottom: number;
			fragments: PdfTextFlowFragment[];
		}> = [];
		for (const fragment of [...fragments].sort((a, b) => {
			const yDelta = a.rect.y - b.rect.y;
			if (Math.abs(yDelta) > Math.max(a.rect.height, b.rect.height, 0.008) * 0.75) {
				return yDelta;
			}
			return a.rect.x - b.rect.x;
		})) {
			const centerY = fragment.rect.y + fragment.rect.height / 2;
			let line = lines.find(
				(candidate) =>
					Math.abs(candidate.centerY - centerY) <=
					Math.max(candidate.height, fragment.rect.height, 0.008) * 0.8
			);
			if (!line) {
				line = {
					centerY,
					height: fragment.rect.height,
					top: fragment.rect.y,
					bottom: fragment.rect.y + fragment.rect.height,
					fragments: [],
				};
				lines.push(line);
			}
			line.fragments.push(fragment);
			line.top = Math.min(line.top, fragment.rect.y);
			line.bottom = Math.max(line.bottom, fragment.rect.y + fragment.rect.height);
			line.height = Math.max(line.height, fragment.rect.height);
			line.centerY = line.top + (line.bottom - line.top) / 2;
		}
		lines.sort((a, b) => a.top - b.top);
		for (const line of lines) {
			line.fragments.sort((a, b) => a.rect.x - b.rect.x);
		}
		return lines;
	}

	private findClosestPdfTextLine(
		lines: Array<{ centerY: number; height: number; top: number; bottom: number; fragments: PdfTextFlowFragment[] }>,
		y: number
	): { centerY: number; height: number; top: number; bottom: number; fragments: PdfTextFlowFragment[] } | null {
		let closest = lines[0] ?? null;
		let closestDistance = Number.POSITIVE_INFINITY;
		for (const line of lines) {
			const tolerance = Math.max(line.height, 0.008) * 0.8;
			if (y >= line.top - tolerance && y <= line.bottom + tolerance) {
				return line;
			}
			const distance = Math.abs(line.centerY - y);
			if (distance < closestDistance) {
				closestDistance = distance;
				closest = line;
			}
		}
		return closest;
	}

	private estimateTextOffset(fragment: PdfTextFlowFragment, x: number): number {
		const ratio = Math.max(0, Math.min(1, (x - fragment.rect.x) / Math.max(0.0001, fragment.rect.width)));
		return Math.max(0, Math.min(fragment.text.length, Math.round(fragment.text.length * ratio)));
	}

	private hasMeaningfulTextAnchorMove(
		start: PdfTextSelectionAnchor,
		end: PdfTextSelectionAnchor
	): boolean {
		return start.flowIndex !== end.flowIndex || Math.abs(start.offset - end.offset) > 0;
	}

	private updatePdfTextSelectionFromAnchors(
		pageNumber: number,
		layer: HTMLElement,
		anchor: PdfTextSelectionAnchor,
		focus: PdfTextSelectionAnchor
	): void {
		const selection = this.buildPdfTextSelection(layer, anchor, focus);
		this.selectedPdfTextSelection = selection
			? {
					pageNumber,
					text: selection.text,
					rects: selection.rects,
			  }
			: null;
		this.renderPdfTextSelectionForPage(pageNumber);
	}

	private buildPdfTextSelection(
		layer: HTMLElement,
		anchor: PdfTextSelectionAnchor,
		focus: PdfTextSelectionAnchor
	): { text: string; rects: PdfTextAnnotationRect[] } | null {
		const fragments = this.readPdfTextFlowFragments(layer);
		if (fragments.length === 0 || !this.hasMeaningfulTextAnchorMove(anchor, focus)) {
			return null;
		}
		const [start, end] = this.compareTextSelectionAnchors(anchor, focus) <= 0
			? [anchor, focus]
			: [focus, anchor];
		const segments: PdfTextSelectionSegment[] = [];
		for (const fragment of fragments) {
			if (fragment.flowIndex < start.flowIndex || fragment.flowIndex > end.flowIndex) {
				continue;
			}
			const startOffset = fragment.flowIndex === start.flowIndex ? start.offset : 0;
			const endOffset = fragment.flowIndex === end.flowIndex ? end.offset : fragment.text.length;
			if (endOffset <= startOffset) {
				continue;
			}
			const text = fragment.text.slice(startOffset, endOffset);
			if (!text) {
				continue;
			}
			segments.push({
				text,
				lineIndex: fragment.lineIndex,
				rect: this.slicePdfTextFragmentRect(fragment, startOffset, endOffset),
			});
		}
		if (segments.length === 0) {
			return null;
		}
		const text = this.buildPdfTextSelectionText(segments);
		return text.trim()
			? {
					text,
					rects: segments.map((segment) => segment.rect),
			  }
			: null;
	}

	private compareTextSelectionAnchors(
		left: PdfTextSelectionAnchor,
		right: PdfTextSelectionAnchor
	): number {
		if (left.flowIndex !== right.flowIndex) {
			return left.flowIndex - right.flowIndex;
		}
		return left.offset - right.offset;
	}

	private slicePdfTextFragmentRect(
		fragment: PdfTextFlowFragment,
		startOffset: number,
		endOffset: number
	): PdfTextAnnotationRect {
		const textLength = Math.max(1, fragment.text.length);
		const startRatio = Math.max(0, Math.min(1, startOffset / textLength));
		const endRatio = Math.max(startRatio, Math.min(1, endOffset / textLength));
		return {
			x: fragment.rect.x + fragment.rect.width * startRatio,
			y: fragment.rect.y,
			width: Math.max(0.001, fragment.rect.width * (endRatio - startRatio)),
			height: fragment.rect.height,
		};
	}

	private buildPdfTextSelectionText(segments: PdfTextSelectionSegment[]): string {
		const lines: Array<{ lineIndex: number; parts: string[] }> = [];
		for (const segment of segments.sort((a, b) => {
			if (a.lineIndex !== b.lineIndex) {
				return a.lineIndex - b.lineIndex;
			}
			return a.rect.x - b.rect.x;
		})) {
			let line = lines.find((candidate) => candidate.lineIndex === segment.lineIndex);
			if (!line) {
				line = { lineIndex: segment.lineIndex, parts: [] };
				lines.push(line);
			}
			line.parts.push(segment.text);
		}
		return lines
			.map((line) => this.joinPdfTextFragments(line.parts))
			.filter(Boolean)
			.join("\n");
	}

	private joinPdfTextFragments(parts: string[]): string {
		return parts.reduce((line, part) => {
			if (!line) {
				return part;
			}
			return this.shouldInsertPdfTextSpace(line, part) ? `${line} ${part}` : `${line}${part}`;
		}, "");
	}

	private shouldInsertPdfTextSpace(left: string, right: string): boolean {
		if (!left || !right || /\s$/.test(left) || /^\s/.test(right)) {
			return false;
		}
		return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
	}

	private renderPdfTextSelectionForPage(pageNumber: number): void {
		const layer = this.textLayers.get(pageNumber);
		if (!layer) {
			return;
		}
		layer.querySelectorAll(".weave-pdf-text-selection-highlight").forEach((element) => element.remove());
		const selection = this.selectedPdfTextSelection;
		if (!selection || selection.pageNumber !== pageNumber) {
			return;
		}
		for (const rect of selection.rects) {
			const highlight = layer.createDiv({ cls: "weave-pdf-text-selection-highlight" });
			highlight.style.left = `${this.formatPdfCssNumber(rect.x * 100)}%`;
			highlight.style.top = `${this.formatPdfCssNumber(rect.y * 100)}%`;
			highlight.style.width = `${this.formatPdfCssNumber(rect.width * 100)}%`;
			highlight.style.height = `${this.formatPdfCssNumber(rect.height * 100)}%`;
		}
	}

	private readPdfPluginSettings(): PdfPluginSettingsLike {
		const plugins = (this.app as unknown as {
			plugins?: {
				getPlugin?: (pluginId: string) => { settings?: unknown } | null | undefined;
			};
		}).plugins;
		const plugin =
			plugins?.getPlugin?.("weave-reader") ??
			plugins?.getPlugin?.("weave-epub-reader") ??
			null;
		const settings = plugin?.settings;
		return settings && typeof settings === "object" ? (settings as PdfPluginSettingsLike) : {};
	}

	private getPdfReaderUiMode(): EpubReaderUiMode {
		const settings = this.readPdfPluginSettings();
		return normalizeEpubReaderUiMode(settings.readerUiMode, settings.expertModeEnabled);
	}

	private getPdfSemanticSettings(): EpubSemanticSettings {
		const settings = this.readPdfPluginSettings();
		return normalizeEpubSemanticSettings({
			annotationSemanticsEnabled: settings.annotationSemanticsEnabled,
			semanticSchemeId: settings.semanticSchemeId,
			annotationSemantics: settings.annotationSemantics,
			expertSemanticLimit: settings.expertSemanticLimit,
			standardSemanticIds: settings.standardSemanticIds,
		});
	}

	private listPdfTextSemanticActions(): EpubAnnotationSemantic[] {
		const settings = this.getPdfSemanticSettings();
		if (settings.annotationSemanticsEnabled === false) {
			return [];
		}
		const activeSemantics = activeSemanticEntries(settings) as EpubAnnotationSemantic[];
		const readerUiMode = this.getPdfReaderUiMode();
		if (readerUiMode === "expert") {
			return resolveExpertSemanticShortcutEntries(
				activeSemantics,
				settings.expertSemanticLimit
			) as EpubAnnotationSemantic[];
		}
		if (readerUiMode !== "standard") {
			return [];
		}
		const standardIds = new Set(settings.standardSemanticIds || []);
		return activeSemantics.filter((semantic) => standardIds.has(semantic.id));
	}

	private getSemanticColorHex(color?: string): string {
		const key = String(color || "yellow").trim().toLowerCase();
		if (key === "other") {
			return "#111827";
		}
		const canonicalKey = PDF_SEMANTIC_COLOR_ALIASES[key] || key;
		return (
			(SEMANTIC_COLOR_HEX as Record<string, string>)[canonicalKey] ||
			(SEMANTIC_COLOR_HEX as Record<string, string>).yellow ||
			"#FACC15"
		);
	}

	private getSemanticPreviewStyle(semantic: EpubAnnotationSemantic): string {
		return normalizeAnnotationStyle(semantic.style);
	}

	private getPdfTextKindForSemantic(semantic: EpubAnnotationSemantic): PdfTextSemanticKind {
		const style = normalizeAnnotationStyle(semantic.style);
		if (style === "underline" || style === "wavy" || style === "strikethrough") {
			return style;
		}
		return "highlight";
	}

	private renderTextSelectionActionBarForPage(pageNumber: number): void {
		this.clearTextActionBar();
		const hadEditingTextAnnotation = Boolean(this.editingTextAnnotationId);
		this.editingTextAnnotationId = "";
		if (hadEditingTextAnnotation) {
			this.renderAllTextAnnotations();
		}
		const selection = this.selectedPdfTextSelection;
		if (!selection || selection.pageNumber !== pageNumber || !selection.text.trim()) {
			return;
		}
		const pageEl = this.pageEls.get(pageNumber);
		const shell = pageEl?.querySelector<HTMLElement>(".weave-pdf-page-canvas-shell");
		const canvas = shell?.querySelector<HTMLCanvasElement>("canvas");
		if (!shell || !canvas || selection.rects.length === 0) {
			return;
		}
		const box = this.getPdfRectUnion(selection.rects);
		const cssWidth = this.getCanvasCssWidth(canvas);
		const cssHeight = this.getCanvasCssHeight(canvas);
		const readerUiMode = this.getPdfReaderUiMode();
		const semanticActions = this.listPdfTextSemanticActions();
		if (cssWidth <= 0 || cssHeight <= 0) {
			return;
		}
		const centerX = Math.max(8 / cssWidth, Math.min(1 - 8 / cssWidth, box.left + (box.right - box.left) / 2));
		const placeBelow = box.top * cssHeight < 42;
		const bar = shell.createDiv({
			cls: "weave-pdf-text-action-bar epub-selection-toolbar epub-glass-panel visible",
			attr: {
				"data-page-number": String(pageNumber),
				role: "toolbar",
			},
		});
		bar.dataset.readerUiMode = readerUiMode;
		bar.classList.toggle("is-below", placeBelow);
		bar.classList.toggle("below-selection", placeBelow);
		bar.style.left = `${10 + centerX * cssWidth}px`;
		bar.style.top = `${10 + (placeBelow ? box.bottom * cssHeight + 8 : box.top * cssHeight - 8)}px`;
		bar.style.setProperty("--toolbar-arrow-offset", "0px");
		bar.addEventListener("mousedown", (event) => event.stopPropagation());
		bar.addEventListener("pointerdown", (event) => event.stopPropagation());

		const mainRow = bar.createDiv({ cls: "selection-main-row" });
		const actionsShell = mainRow.createDiv({ cls: "selection-actions-shell" });
		if (readerUiMode === "expert" && semanticActions.length > 0) {
			const semanticRow = actionsShell.createDiv({
				cls: "toolbar-row weave-epub-expert-semantic-row",
			});
			for (const semantic of semanticActions) {
				this.createTextSemanticButton(semanticRow, semantic);
			}
			actionsShell.createDiv({ cls: "selection-actions-divider" });
		}
		const actionsRow = actionsShell.createDiv({
			cls: `toolbar-row actions-row selection-actions-row${
				readerUiMode === "standard" ? " selection-standard-semantic-row" : ""
			}`,
		});

		if (readerUiMode === "standard") {
			for (const semantic of semanticActions) {
				this.createTextSemanticButton(actionsRow, semantic, "standard");
			}
		}
		this.createTextActionButton(actionsRow, "想法", "note-text-selection", "message-square-plus", () => {
			this.renderTextNoteEditorForSelection();
		}, "comment-action");
		this.createTextActionButton(actionsRow, "取消", "cancel-text-selection", "x", () => {
			this.clearPdfTextSelection();
		});
		bar.createDiv({ cls: "toolbar-arrow" });
		this.textActionBarEl = bar;
	}

	private createTextSemanticButton(
		parent: HTMLElement,
		semantic: EpubAnnotationSemantic,
		optionsOrMode: "expert" | "standard" | PdfTextSemanticButtonOptions = "expert"
	): HTMLButtonElement {
		const options: PdfTextSemanticButtonOptions =
			typeof optionsOrMode === "string" ? { mode: optionsOrMode } : optionsOrMode;
		const mode = options.mode ?? "expert";
		const label = String(semantic.label || semantic.id || "标注").trim();
		const button = parent.createEl("button", {
			cls: `clickable-icon action-item weave-epub-semantic-chip${
				mode === "standard" ? " weave-epub-standard-semantic-btn" : ""
			}`,
		});
		button.type = "button";
		button.setAttribute("data-weave-pdf-action", options.action ?? "semantic-text-selection");
		button.setAttribute("data-semantic-id", semantic.id);
		button.setAttribute("data-semantic-style", this.getSemanticPreviewStyle(semantic));
		button.setAttribute("aria-label", label);
		button.setAttribute("aria-pressed", options.active ? "true" : "false");
		button.classList.toggle("is-active", Boolean(options.active));
		button.style.setProperty("--weave-semantic-color", this.getSemanticColorHex(semantic.color));
		button.createEl("span", { cls: "action-icon weave-epub-semantic-dot" });
		button.createEl("span", { cls: "action-label weave-epub-semantic-label", text: label });
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (options.onClick) {
				options.onClick(semantic);
				return;
			}
			this.createTextAnnotationFromSelection(this.getPdfTextKindForSemantic(semantic), "", semantic);
		});
		return button;
	}

	private openTextAnnotationEditBar(annotationId: string): void {
		const annotation = this.findTextAnnotationById(annotationId);
		if (!annotation) {
			return;
		}
		this.editingTextAnnotationId = annotation.id;
		this.clearFocusedTextAnnotation();
		this.clearPdfTextSelection({ keepActionBar: true });
		this.renderAllTextAnnotations();
		this.renderTextAnnotationEditBar(annotation);
	}

	private renderTextAnnotationEditBar(annotation: PdfTextAnnotation): void {
		this.clearTextActionBar();
		const pageEl = this.pageEls.get(annotation.pageNumber);
		const shell = pageEl?.querySelector<HTMLElement>(".weave-pdf-page-canvas-shell");
		const canvas = shell?.querySelector<HTMLCanvasElement>("canvas");
		if (!shell || !canvas || annotation.rects.length === 0) {
			this.editingTextAnnotationId = "";
			return;
		}
		const box = this.getPdfRectUnion(annotation.rects);
		const cssWidth = this.getCanvasCssWidth(canvas);
		const cssHeight = this.getCanvasCssHeight(canvas);
		const readerUiMode = this.getPdfReaderUiMode();
		const semanticActions = this.listPdfTextSemanticActions();
		if (cssWidth <= 0 || cssHeight <= 0) {
			this.editingTextAnnotationId = "";
			return;
		}
		const centerX = Math.max(8 / cssWidth, Math.min(1 - 8 / cssWidth, box.left + (box.right - box.left) / 2));
		const placeBelow = box.top * cssHeight < 42;
		const bar = shell.createDiv({
			cls: "weave-pdf-text-action-bar epub-selection-toolbar epub-glass-panel visible",
			attr: {
				"data-page-number": String(annotation.pageNumber),
				role: "toolbar",
			},
		});
		bar.dataset.readerUiMode = readerUiMode;
		bar.dataset.editingAnnotationId = annotation.id;
		bar.classList.add("is-editing-annotation");
		bar.classList.toggle("is-below", placeBelow);
		bar.classList.toggle("below-selection", placeBelow);
		bar.style.left = `${10 + centerX * cssWidth}px`;
		bar.style.top = `${10 + (placeBelow ? box.bottom * cssHeight + 8 : box.top * cssHeight - 8)}px`;
		bar.style.setProperty("--toolbar-arrow-offset", "0px");
		bar.addEventListener("mousedown", (event) => event.stopPropagation());
		bar.addEventListener("pointerdown", (event) => event.stopPropagation());

		const mainRow = bar.createDiv({ cls: "selection-main-row" });
		const actionsShell = mainRow.createDiv({ cls: "selection-actions-shell" });
		if (readerUiMode === "expert" && semanticActions.length > 0) {
			const semanticRow = actionsShell.createDiv({
				cls: "toolbar-row weave-epub-expert-semantic-row",
			});
			for (const semantic of semanticActions) {
				this.createTextSemanticButton(semanticRow, semantic, {
					action: "semantic-text-annotation",
					active: annotation.semanticId === semantic.id,
					onClick: (nextSemantic) => {
						this.updateTextAnnotationSemantic(annotation.id, nextSemantic);
					},
				});
			}
			actionsShell.createDiv({ cls: "selection-actions-divider" });
		}
		const actionsRow = actionsShell.createDiv({
			cls: `toolbar-row actions-row selection-actions-row${
				readerUiMode === "standard" ? " selection-standard-semantic-row" : ""
			}`,
		});
		if (readerUiMode === "standard") {
			for (const semantic of semanticActions) {
				this.createTextSemanticButton(actionsRow, semantic, {
					mode: "standard",
					action: "semantic-text-annotation",
					active: annotation.semanticId === semantic.id,
					onClick: (nextSemantic) => {
						this.updateTextAnnotationSemantic(annotation.id, nextSemantic);
					},
				});
			}
		}
		this.createTextActionButton(actionsRow, "想法", "note-text-annotation", "message-square-plus", () => {
			this.renderTextNoteEditorForAnnotation(annotation.id);
		}, "comment-action");
		this.createTextActionButton(actionsRow, "删除", "delete-text-annotation", "trash-2", () => {
			this.deleteTextAnnotation(annotation.id);
		}, "danger-action");
		this.createTextActionButton(actionsRow, "取消", "cancel-text-annotation", "x", () => {
			this.clearTextAnnotationEdit();
		});
		bar.createDiv({ cls: "toolbar-arrow" });
		this.textActionBarEl = bar;
	}

	private renderTextNoteEditorForSelection(): void {
		const bar = this.textActionBarEl;
		if (!bar || !this.selectedPdfTextSelection) {
			new Notice("请先选择 PDF 文本");
			return;
		}
		bar.empty();
		bar.addClass("is-note-editor");
		const mainRow = bar.createDiv({ cls: "selection-main-row" });
		const actionsShell = mainRow.createDiv({ cls: "selection-actions-shell" });
		const input = actionsShell.createEl("textarea", {
			cls: "weave-pdf-text-note-input",
			attr: {
				placeholder: "输入想法",
				rows: "3",
			},
		});
		const actions = actionsShell.createDiv({
			cls: "toolbar-row actions-row selection-actions-row weave-pdf-text-note-actions",
		});
		this.createTextActionButton(actions, "保存", "save-text-note", "check", () => {
			this.createTextAnnotationFromSelection("note", input.value);
		}, "accent");
		this.createTextActionButton(actions, "取消", "cancel-text-note", "x", () => {
			const pageNumber = this.selectedPdfTextSelection?.pageNumber;
			if (pageNumber) {
				this.renderTextSelectionActionBarForPage(pageNumber);
				return;
			}
			this.clearPdfTextSelection();
		});
		bar.createDiv({ cls: "toolbar-arrow" });
		window.setTimeout(() => input.focus(), 0);
	}

	private renderTextNoteEditorForAnnotation(annotationId: string): void {
		const annotation = this.findTextAnnotationById(annotationId);
		const bar = this.textActionBarEl;
		if (!annotation || !bar) {
			this.clearTextAnnotationEdit();
			return;
		}
		bar.empty();
		bar.addClass("is-note-editor");
		bar.dataset.editingAnnotationId = annotation.id;
		const mainRow = bar.createDiv({ cls: "selection-main-row" });
		const actionsShell = mainRow.createDiv({ cls: "selection-actions-shell" });
		const input = actionsShell.createEl("textarea", {
			cls: "weave-pdf-text-note-input",
			attr: {
				placeholder: "输入想法",
				rows: "3",
			},
		});
		input.value = annotation.note ?? "";
		const actions = actionsShell.createDiv({
			cls: "toolbar-row actions-row selection-actions-row weave-pdf-text-note-actions",
		});
		this.createTextActionButton(actions, "保存", "save-text-annotation-note", "check", () => {
			this.updateTextAnnotationNote(annotation.id, input.value);
		}, "accent");
		this.createTextActionButton(actions, "取消", "cancel-text-annotation-note", "x", () => {
			const latest = this.findTextAnnotationById(annotation.id);
			if (latest) {
				this.renderTextAnnotationEditBar(latest);
				return;
			}
			this.clearTextAnnotationEdit();
		});
		bar.createDiv({ cls: "toolbar-arrow" });
		window.setTimeout(() => input.focus(), 0);
	}

	private createTextActionButton(
		parent: HTMLElement,
		label: string,
		action: string,
		iconName: string,
		onClick: () => void,
		extraClass = ""
	): HTMLButtonElement {
		const button = parent.createEl("button", {
			cls: `weave-pdf-text-action-button clickable-icon action-item ${extraClass}`.trim(),
		});
		button.type = "button";
		button.setAttribute("data-weave-pdf-action", action);
		button.setAttribute("aria-label", label);
		const iconEl = button.createEl("span", { cls: "action-icon" });
		setIcon(iconEl, iconName);
		button.createEl("span", { cls: "action-label", text: label });
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			onClick();
		});
		return button;
	}

	private getPdfRectUnion(
		rects: PdfTextAnnotationRect[]
	): { left: number; top: number; right: number; bottom: number } {
		return rects.reduce(
			(box, rect) => ({
				left: Math.min(box.left, rect.x),
				top: Math.min(box.top, rect.y),
				right: Math.max(box.right, rect.x + rect.width),
				bottom: Math.max(box.bottom, rect.y + rect.height),
			}),
			{ left: 1, top: 1, right: 0, bottom: 0 }
		);
	}

	private normalizePdfAnnotationTextForMerge(text: string): string {
		return String(text || "").trim().replace(/\s+/g, " ");
	}

	private arePdfTextAnnotationAreasMergeable(
		leftRects: PdfTextAnnotationRect[],
		rightRects: PdfTextAnnotationRect[]
	): boolean {
		if (leftRects.length === 0 || rightRects.length === 0 || leftRects.length !== rightRects.length) {
			return false;
		}
		const remaining = [...rightRects];
		for (const leftRect of leftRects) {
			const matchIndex = remaining.findIndex((rightRect) =>
				this.arePdfTextAnnotationRectsMergeable(leftRect, rightRect)
			);
			if (matchIndex < 0) {
				return false;
			}
			remaining.splice(matchIndex, 1);
		}
		return true;
	}

	private arePdfTextAnnotationRectsMergeable(
		leftRect: PdfTextAnnotationRect,
		rightRect: PdfTextAnnotationRect
	): boolean {
		const leftRight = leftRect.x + leftRect.width;
		const rightRight = rightRect.x + rightRect.width;
		const leftBottom = leftRect.y + leftRect.height;
		const rightBottom = rightRect.y + rightRect.height;
		const verticalOverlap = Math.max(
			0,
			Math.min(leftBottom, rightBottom) - Math.max(leftRect.y, rightRect.y)
		);
		const minHeight = Math.min(leftRect.height, rightRect.height);
		const edgeTolerance = Math.max(0.006, Math.min(leftRect.width, rightRect.width) * 0.025);
		const heightTolerance = Math.max(0.006, minHeight * 0.35);
		return (
			minHeight > 0 &&
			verticalOverlap / minHeight >= 0.8 &&
			Math.abs(leftRect.x - rightRect.x) <= edgeTolerance &&
			Math.abs(leftRight - rightRight) <= edgeTolerance &&
			Math.abs(leftRect.height - rightRect.height) <= heightTolerance
		);
	}

	private findMergeableTextAnnotationForSelection(selection: {
		pageNumber: number;
		text: string;
		rects: PdfTextAnnotationRect[];
	}): PdfTextAnnotation | null {
		const selectedText = this.normalizePdfAnnotationTextForMerge(selection.text);
		if (!selectedText || selection.rects.length === 0) {
			return null;
		}
		return (
			this.textAnnotations.find(
				(annotation) =>
					annotation.pageNumber === selection.pageNumber &&
					this.normalizePdfAnnotationTextForMerge(annotation.text) === selectedText &&
					this.arePdfTextAnnotationAreasMergeable(annotation.rects, selection.rects)
			) ?? null
		);
	}

	private shouldMergeTextAnnotationFromSelection(
		kind: PdfTextAnnotationKind,
		annotation: PdfTextAnnotation | null
	): annotation is PdfTextAnnotation {
		if (!annotation) {
			return false;
		}
		return kind === "note" || annotation.kind === "note";
	}

	private clearTextActionBar(): void {
		this.textActionBarEl?.remove();
		this.textActionBarEl = null;
	}

	private clearTextAnnotationEdit(): void {
		const pageNumber = this.findTextAnnotationById(this.editingTextAnnotationId)?.pageNumber;
		this.editingTextAnnotationId = "";
		this.clearTextActionBar();
		if (pageNumber) {
			this.renderTextAnnotationsForPage(pageNumber);
			return;
		}
		this.renderAllTextAnnotations();
	}

	private clearPdfTextSelection(options: { keepActionBar?: boolean } = {}): void {
		document.getSelection()?.removeAllRanges();
		if (!options.keepActionBar) {
			this.clearTextActionBar();
		}
		this.selectedPdfTextSelection = null;
		this.textSelectionDrag = null;
		this.activeTextSelectionPointerId = null;
		for (const pageNumber of this.textLayers.keys()) {
			this.renderPdfTextSelectionForPage(pageNumber);
		}
	}

	private async copyPdfTextSelection(): Promise<void> {
		const selection = this.selectedPdfTextSelection;
		if (!selection || !selection.text.trim()) {
			new Notice("请先选择 PDF 文本");
			return;
		}
		try {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
				await navigator.clipboard.writeText(selection.text);
				new Notice("文本已复制");
				return;
			}
		} catch {
			// Fall through to the user-facing failure notice below.
		}
		new Notice("当前环境不支持复制文本");
	}

	private findTextAnnotationById(annotationId: string): PdfTextAnnotation | null {
		return this.textAnnotations.find((annotation) => annotation.id === annotationId) ?? null;
	}

	private updateTextAnnotationSemantic(
		annotationId: string,
		semantic: EpubAnnotationSemantic
	): void {
		const annotation = this.findTextAnnotationById(annotationId);
		if (!annotation) {
			this.clearTextAnnotationEdit();
			return;
		}
		this.pushUndoSnapshot();
		const semanticStyle = normalizeAnnotationStyle(semantic.style);
		this.textAnnotations = sortPdfTextAnnotationsByPosition(
			this.textAnnotations.map((entry) =>
				entry.id === annotation.id
					? {
							...entry,
							kind: this.getPdfTextKindForSemantic(semantic),
							color: this.getSemanticColorHex(semantic.color),
							semanticId: semantic.id,
							semanticLabel: semantic.label,
							semanticColor: semantic.color,
							semanticStyle,
						}
					: entry
			)
		);
		this.editingTextAnnotationId = annotation.id;
		this.annotationsDirty = true;
		this.renderTextAnnotationsForPage(annotation.pageNumber);
		const latest = this.findTextAnnotationById(annotation.id);
		if (latest) {
			this.renderTextAnnotationEditBar(latest);
		}
		this.updateToolbarState();
		this.syncAsActivePdfDocument();
		void this.persistPdfAnnotations();
	}

	private updateTextAnnotationNote(annotationId: string, note: string): void {
		const annotation = this.findTextAnnotationById(annotationId);
		if (!annotation) {
			this.clearTextAnnotationEdit();
			return;
		}
		this.pushUndoSnapshot();
		const trimmedNote = note.trim();
		this.textAnnotations = sortPdfTextAnnotationsByPosition(
			this.textAnnotations.map((entry) => {
				if (entry.id !== annotation.id) {
					return entry;
				}
				const next: PdfTextAnnotation = { ...entry };
				if (trimmedNote) {
					next.note = trimmedNote;
				} else {
					delete next.note;
				}
				return next;
			})
		);
		this.editingTextAnnotationId = annotation.id;
		this.annotationsDirty = true;
		this.renderTextAnnotationsForPage(annotation.pageNumber);
		const latest = this.findTextAnnotationById(annotation.id);
		if (latest) {
			this.renderTextAnnotationEditBar(latest);
		}
		this.updateToolbarState();
		this.syncAsActivePdfDocument();
		void this.persistPdfAnnotations();
	}

	private deleteTextAnnotation(annotationId: string): void {
		const annotation = this.findTextAnnotationById(annotationId);
		if (!annotation) {
			this.clearTextAnnotationEdit();
			return;
		}
		this.pushUndoSnapshot();
		this.textAnnotations = this.textAnnotations.filter((entry) => entry.id !== annotation.id);
		this.editingTextAnnotationId = "";
		this.annotationsDirty = true;
		this.clearTextActionBar();
		this.renderTextAnnotationsForPage(annotation.pageNumber);
		this.updateToolbarState();
		this.syncAsActivePdfDocument();
		void this.persistPdfAnnotations();
	}

	private releaseTextSelectionPointer(layer: HTMLElement, pointerId: number): void {
		try {
			layer.releasePointerCapture?.(pointerId);
		} catch {
			// Pointer capture is optional in the embedded Obsidian webview.
		}
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

	private beginSelectedInkDragPreview(pageNumber: number, layer: SVGSVGElement): void {
		this.releaseSelectedInkDragPreview(pageNumber);
		const selectedElements = Array.from(layer.querySelectorAll<SVGElement>("[data-stroke-id]")).filter(
			(element) => {
				const strokeId = element.getAttribute("data-stroke-id");
				return Boolean(strokeId && this.selectedInkStrokeIds.has(strokeId));
			}
		);
		if (selectedElements.length === 0) {
			return;
		}
		const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
		group.classList.add("weave-pdf-ink-drag-group");
		group.setAttribute("data-weave-pdf-ink-drag-group", "true");
		for (const element of selectedElements) {
			group.appendChild(element);
		}
		layer.appendChild(group);
		layer.classList.add("is-moving-ink");
		this.selectedInkDragGroupEl = group;
		this.selectedInkDragPageNumber = pageNumber;
	}

	private releaseSelectedInkDragPreview(pageNumber: number): void {
		if (this.selectedInkDragPageNumber !== pageNumber && !this.selectedInkDragGroupEl) {
			return;
		}
		const activePageNumber = this.selectedInkDragPageNumber ?? pageNumber;
		this.annotationLayers.get(activePageNumber)?.classList.remove("is-moving-ink");
		this.selectedInkDragGroupEl = null;
		this.selectedInkDragPageNumber = null;
	}

	private applySelectedInkDragTransform(pageNumber: number, dx: number, dy: number): void {
		if (!this.selectedInkDragGroupEl || this.selectedInkDragPageNumber !== pageNumber) {
			return;
		}
		const transform = `translate(${this.formatInkNumber(dx)} ${this.formatInkNumber(dy)})`;
		this.selectedInkDragGroupEl.setAttribute("transform", transform);
	}

	private clearSelectedInkDragTransform(pageNumber: number): void {
		const layer = this.annotationLayers.get(pageNumber);
		if (layer) {
			layer.classList.remove("is-moving-ink");
		}
		this.selectedInkDragGroupEl = null;
		this.selectedInkDragPageNumber = null;
		this.renderInkStrokesForPage(pageNumber);
	}

	private clearCapturePreview(): void {
		this.captureDrag = null;
		this.captureRectEl?.remove();
		this.captureRectEl = null;
	}

	private clearCaptureActionBar(): void {
		this.captureActionBarEl?.remove();
		this.captureActionBarEl = null;
	}

	private clearCaptureSelection(): void {
		const pageNumber = this.captureSelection?.pageNumber;
		this.captureSelection = null;
		this.clearCapturePreview();
		this.clearCaptureActionBar();
		if (pageNumber) {
			this.renderInkStrokesForPage(pageNumber);
		}
	}

	private renderCaptureActionBarForPage(selection: PdfCaptureSelection): void {
		this.clearCaptureActionBar();
		const pageEl = this.pageEls.get(selection.pageNumber);
		const canvasShell = pageEl?.querySelector<HTMLElement>(".weave-pdf-page-canvas-shell");
		const sourceCanvas = canvasShell?.querySelector<HTMLCanvasElement>("canvas");
		if (!canvasShell || !sourceCanvas) {
			return;
		}

		const cssWidth = this.getCanvasCssWidth(sourceCanvas);
		const cssHeight = this.getCanvasCssHeight(sourceCanvas);
		const placeBelow = selection.box.top < 0.12;
		const bar = canvasShell.createDiv({
			cls: "weave-pdf-capture-action-bar",
			attr: {
				"data-page-number": String(selection.pageNumber),
				role: "toolbar",
				"aria-label": "区域截图操作",
			},
		});
		bar.classList.toggle("is-below", placeBelow);
		bar.style.left = `${10 + selection.box.right * cssWidth}px`;
		bar.style.top = `${10 + (placeBelow ? selection.box.bottom * cssHeight + 8 : selection.box.top * cssHeight - 8)}px`;
		bar.addEventListener("mousedown", (event) => event.stopPropagation());
		bar.addEventListener("pointerdown", (event) => event.stopPropagation());

		this.createCaptureActionButton(bar, "复制图片", "copy-capture-image", () => {
			void this.copyCaptureSelectionImage();
		});
		this.createCaptureActionButton(bar, "保存图片", "save-capture-image", () => {
			void this.saveCaptureSelectionImage();
		});
		this.createCaptureActionButton(bar, "取消", "cancel-capture", () => {
			this.clearCaptureSelection();
		});
		this.captureActionBarEl = bar;
	}

	private createCaptureActionButton(
		parent: HTMLElement,
		label: string,
		action: string,
		onClick: () => void
	): HTMLButtonElement {
		const button = parent.createEl("button", {
			cls: "weave-pdf-capture-action-button",
			text: label,
		});
		button.type = "button";
		button.setAttribute("data-weave-pdf-action", action);
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			onClick();
		});
		return button;
	}

	private async copyCaptureSelectionImage(): Promise<void> {
		const selection = this.captureSelection;
		if (!selection) {
			new Notice("请先框选 PDF 区域");
			return;
		}
		const blob = await this.createCaptureSelectionBlob(selection);
		if (!blob) {
			new Notice("无法复制截图");
			return;
		}
		try {
			if (
				navigator.clipboard &&
				typeof navigator.clipboard.write === "function" &&
				typeof ClipboardItem !== "undefined"
			) {
				await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
				new Notice("截图已复制");
				return;
			}
		} catch {
			// Fall through to the user-facing failure notice below.
		}
		new Notice("当前环境不支持复制截图");
	}

	private async saveCaptureSelectionImage(): Promise<void> {
		const selection = this.captureSelection;
		if (!selection) {
			new Notice("请先框选 PDF 区域");
			return;
		}
		const blob = await this.createCaptureSelectionBlob(selection);
		if (!blob) {
			new Notice("无法保存截图");
			return;
		}
		try {
			const imagePath = await this.saveCaptureImageBlob(blob, selection.pageNumber);
			try {
				if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
					await navigator.clipboard.writeText(`![[${imagePath}]]`);
				}
			} catch {
				// Saving is still useful even if the embed link cannot be copied.
			}
			new Notice(`截图已保存：${imagePath}`);
		} catch {
			new Notice("保存截图失败");
		}
	}

	private async createCaptureSelectionBlob(selection: PdfCaptureSelection): Promise<Blob | null> {
		try {
			const canvas = this.renderCaptureSelectionCanvas(selection);
			return await this.canvasToBlob(canvas, "image/png");
		} catch {
			return null;
		}
	}

	private renderCaptureSelectionCanvas(selection: PdfCaptureSelection): HTMLCanvasElement {
		const pageEl = this.pageEls.get(selection.pageNumber);
		const sourceCanvas = pageEl?.querySelector<HTMLCanvasElement>(".weave-pdf-page-canvas-shell canvas");
		if (!sourceCanvas || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
			throw new Error("PDF capture source canvas is unavailable");
		}

		const left = Math.max(0, Math.floor(selection.box.left * sourceCanvas.width));
		const top = Math.max(0, Math.floor(selection.box.top * sourceCanvas.height));
		const width = Math.max(1, Math.ceil((selection.box.right - selection.box.left) * sourceCanvas.width));
		const height = Math.max(1, Math.ceil((selection.box.bottom - selection.box.top) * sourceCanvas.height));
		const output = document.createElement("canvas");
		output.width = width;
		output.height = height;
		const context = output.getContext("2d", { alpha: false });
		if (!context) {
			throw new Error("PDF capture output canvas is unavailable");
		}
		context.fillStyle = "#ffffff";
		context.fillRect(0, 0, width, height);
		context.drawImage(sourceCanvas, left, top, width, height, 0, 0, width, height);
		this.drawTextAnnotationsToCaptureCanvas(context, selection, sourceCanvas, left, top);
		this.drawInkStrokesToCaptureCanvas(context, selection, sourceCanvas, left, top);
		return output;
	}

	private drawTextAnnotationsToCaptureCanvas(
		context: CanvasRenderingContext2D,
		selection: PdfCaptureSelection,
		sourceCanvas: HTMLCanvasElement,
		cropLeft: number,
		cropTop: number
	): void {
		for (const annotation of this.textAnnotations.filter(
			(item) => item.pageNumber === selection.pageNumber
		)) {
			context.save();
			if (
				annotation.kind === "underline" ||
				annotation.kind === "wavy" ||
				annotation.kind === "strikethrough"
			) {
				const cssWidth = this.getCanvasCssWidth(sourceCanvas);
				const strokeScale = sourceCanvas.width / Math.max(1, cssWidth);
				context.globalAlpha = 0.9;
				context.strokeStyle = annotation.color;
				context.lineWidth = Math.max(2, 2 * strokeScale);
				context.lineCap = "round";
				for (const rect of annotation.rects) {
					const left = rect.x * sourceCanvas.width - cropLeft;
					const right = left + rect.width * sourceCanvas.width;
					if (annotation.kind === "wavy") {
						const y = (rect.y + rect.height) * sourceCanvas.height - cropTop - context.lineWidth / 2;
						this.drawPdfWavyLine(context, left, right, y, Math.max(2, 2.5 * strokeScale));
					} else {
						const y = annotation.kind === "strikethrough"
							? (rect.y + rect.height / 2) * sourceCanvas.height - cropTop
							: (rect.y + rect.height) * sourceCanvas.height - cropTop - context.lineWidth / 2;
						context.beginPath();
						context.moveTo(left, y);
						context.lineTo(right, y);
						context.stroke();
					}
				}
			} else {
				context.globalAlpha = annotation.kind === "note" ? 0.24 : 0.38;
				context.fillStyle = annotation.color;
				for (const rect of annotation.rects) {
					context.fillRect(
						rect.x * sourceCanvas.width - cropLeft,
						rect.y * sourceCanvas.height - cropTop,
						rect.width * sourceCanvas.width,
						rect.height * sourceCanvas.height
					);
				}
			}
			context.restore();
		}
	}

	private drawPdfWavyLine(
		context: CanvasRenderingContext2D,
		left: number,
		right: number,
		centerY: number,
		amplitude: number
	): void {
		const step = Math.max(4, amplitude * 2.4);
		context.beginPath();
		context.moveTo(left, centerY);
		for (let x = left; x < right; x += step) {
			const mid = Math.min(right, x + step / 2);
			const end = Math.min(right, x + step);
			context.quadraticCurveTo((x + mid) / 2, centerY - amplitude, mid, centerY);
			context.quadraticCurveTo((mid + end) / 2, centerY + amplitude, end, centerY);
		}
		context.stroke();
	}

	private drawInkStrokesToCaptureCanvas(
		context: CanvasRenderingContext2D,
		selection: PdfCaptureSelection,
		sourceCanvas: HTMLCanvasElement,
		cropLeft: number,
		cropTop: number
	): void {
		const cssWidth = this.getCanvasCssWidth(sourceCanvas);
		const strokeScale = sourceCanvas.width / Math.max(1, cssWidth);
		for (const stroke of this.inkStrokes.filter((item) => item.pageNumber === selection.pageNumber)) {
			if (stroke.points.length === 0) {
				continue;
			}
			context.save();
			context.globalAlpha = stroke.tool === "highlighter" ? 0.36 : 1;
			context.strokeStyle = stroke.color;
			context.lineWidth = Math.max(1, stroke.width * strokeScale);
			context.lineCap = "round";
			context.lineJoin = "round";
			context.beginPath();
			for (const [index, point] of stroke.points.entries()) {
				const x = point.x * sourceCanvas.width - cropLeft;
				const y = point.y * sourceCanvas.height - cropTop;
				if (index === 0) {
					context.moveTo(x, y);
				} else {
					context.lineTo(x, y);
				}
			}
			if (stroke.points.length === 1) {
				const point = stroke.points[0];
				context.lineTo(
					point.x * sourceCanvas.width - cropLeft + 0.1,
					point.y * sourceCanvas.height - cropTop + 0.1
				);
			}
			context.stroke();
			context.restore();
		}
	}

	private async canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
		if (typeof canvas.toBlob !== "function") {
			return null;
		}
		return new Promise((resolve) => {
			canvas.toBlob((blob) => resolve(blob), type);
		});
	}

	private async saveCaptureImageBlob(blob: Blob, pageNumber: number): Promise<string> {
		const arrayBuffer = await this.blobToArrayBuffer(blob);
		const imagePath = await this.buildUniqueCaptureImagePath(pageNumber);
		const folderPath = imagePath.includes("/") ? imagePath.slice(0, imagePath.lastIndexOf("/")) : "";
		await this.ensureVaultFolderExists(folderPath);
		await this.writeVaultBinaryFile(imagePath, arrayBuffer);
		return imagePath;
	}

	private async blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
		if (typeof blob.arrayBuffer === "function") {
			return await blob.arrayBuffer();
		}
		if (typeof FileReader === "undefined") {
			throw new Error("Blob arrayBuffer is unavailable");
		}
		return await new Promise<ArrayBuffer>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				if (reader.result instanceof ArrayBuffer) {
					resolve(reader.result);
					return;
				}
				reject(new Error("Unable to read image blob"));
			};
			reader.onerror = () => reject(reader.error ?? new Error("Unable to read image blob"));
			reader.readAsArrayBuffer(blob);
		});
	}

	private async buildUniqueCaptureImagePath(pageNumber: number): Promise<string> {
		const attachmentFolder = this.readAttachmentFolderPath();
		const folderPath = attachmentFolder && attachmentFolder !== "/" && attachmentFolder !== "."
			? normalizePath(attachmentFolder)
			: "";
		const safeTitle = this.sanitizeCaptureFileName(this.getResolvedTitle(), "pdf");
		const timestamp = this.createCaptureTimestamp();
		const baseName = `pdf-${safeTitle}-p${pageNumber}-${timestamp}`;
		let candidate = normalizePath(folderPath ? `${folderPath}/${baseName}.png` : `${baseName}.png`);
		let index = 2;
		while (await this.vaultPathExists(candidate)) {
			candidate = normalizePath(folderPath ? `${folderPath}/${baseName}-${index}.png` : `${baseName}-${index}.png`);
			index += 1;
		}
		return candidate;
	}

	private readAttachmentFolderPath(): string {
		const vault = this.app.vault as unknown as VaultConfigLike;
		const configured = vault.getConfig?.("attachmentFolderPath") ?? vault.config?.attachmentFolderPath;
		return typeof configured === "string" ? configured.trim() : "";
	}

	private async ensureVaultFolderExists(folderPath: string): Promise<void> {
		const normalizedFolderPath = normalizePath(String(folderPath || "").trim());
		if (!normalizedFolderPath) {
			return;
		}
		const adapter = this.getVaultBinaryAdapter();
		const segments = normalizedFolderPath.split("/").filter(Boolean);
		let currentPath = "";
		for (const segment of segments) {
			currentPath = currentPath ? `${currentPath}/${segment}` : segment;
			if (await this.vaultPathExists(currentPath)) {
				continue;
			}
			if (typeof adapter.mkdir === "function") {
				await adapter.mkdir(currentPath);
				continue;
			}
			const vault = this.app.vault as unknown as { createFolder?: (path: string) => Promise<void> };
			if (typeof vault.createFolder === "function") {
				await vault.createFolder(currentPath);
			}
		}
	}

	private async writeVaultBinaryFile(path: string, data: ArrayBuffer): Promise<void> {
		const adapter = this.getVaultBinaryAdapter();
		if (typeof adapter.writeBinary === "function") {
			await adapter.writeBinary(path, data);
			return;
		}
		const vault = this.app.vault as unknown as { createBinary?: (path: string, data: ArrayBuffer) => Promise<void> };
		if (typeof vault.createBinary === "function") {
			await vault.createBinary(path, data);
			return;
		}
		throw new Error("Binary vault writes are unavailable");
	}

	private async vaultPathExists(path: string): Promise<boolean> {
		const normalizedPath = normalizePath(String(path || "").trim());
		if (!normalizedPath) {
			return false;
		}
		const existing = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (existing) {
			return true;
		}
		const adapter = this.getVaultBinaryAdapter();
		return typeof adapter.exists === "function" ? await adapter.exists(normalizedPath) : false;
	}

	private getVaultBinaryAdapter(): PdfVaultBinaryAdapterLike {
		return ((this.app.vault as unknown as { adapter?: PdfVaultBinaryAdapterLike }).adapter ?? {}) as PdfVaultBinaryAdapterLike;
	}

	private sanitizeCaptureFileName(value: string, fallback: string): string {
		const sanitized = String(value || "")
			.replace(/[\\/:*?"<>|]/g, "_")
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^[-_.]+|[-_.]+$/g, "")
			.slice(0, 36);
		return sanitized || fallback;
	}

	private createCaptureTimestamp(): string {
		const now = new Date();
		const pad = (value: number) => String(value).padStart(2, "0");
		return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	}

	private getCanvasCssWidth(canvas: HTMLCanvasElement): number {
		return Number.parseFloat(canvas.style.width || "") || canvas.clientWidth || canvas.width;
	}

	private getCanvasCssHeight(canvas: HTMLCanvasElement): number {
		return Number.parseFloat(canvas.style.height || "") || canvas.clientHeight || canvas.height;
	}

	private createTextAnnotationFromSelection(
		kind: PdfTextAnnotationKind,
		note = "",
		semantic?: EpubAnnotationSemantic
	): void {
		const selection = this.selectedPdfTextSelection;
		if (!selection || !selection.text.trim() || selection.rects.length === 0) {
			new Notice("请先选择 PDF 文本");
			return;
		}
		const semanticStyle = semantic ? normalizeAnnotationStyle(semantic.style) : undefined;
		const mergeCandidate = this.findMergeableTextAnnotationForSelection(selection);
		const mergeTarget = this.shouldMergeTextAnnotationFromSelection(kind, mergeCandidate)
			? mergeCandidate
			: null;
		const pageNumber = selection.pageNumber;
		this.pushUndoSnapshot();
		if (mergeTarget) {
			const trimmedNote = note.trim();
			this.textAnnotations = sortPdfTextAnnotationsByPosition(
				this.textAnnotations.map((annotation) => {
					if (annotation.id !== mergeTarget.id) {
						return annotation;
					}
					if (kind === "note") {
						const next: PdfTextAnnotation = {
							...annotation,
							text: selection.text,
							rects: selection.rects,
						};
						if (trimmedNote) {
							next.note = trimmedNote;
						} else {
							delete next.note;
						}
						return next;
					}
					return {
						...annotation,
						pageNumber: selection.pageNumber,
						kind,
						color: semantic ? this.getSemanticColorHex(semantic.color) : this.highlighterColor,
						text: selection.text,
						semanticId: semantic?.id,
						semanticLabel: semantic?.label,
						semanticColor: semantic?.color,
						semanticStyle,
						rects: selection.rects,
					};
				})
			);
		} else {
			this.textAnnotations = sortPdfTextAnnotationsByPosition([
				...this.textAnnotations,
				{
					id: this.createInkId(),
					pageNumber: selection.pageNumber,
					kind,
					color: semantic ? this.getSemanticColorHex(semantic.color) : this.highlighterColor,
					text: selection.text,
					note: kind === "note" ? note : undefined,
					semanticId: semantic?.id,
					semanticLabel: semantic?.label,
					semanticColor: semantic?.color,
					semanticStyle,
					rects: selection.rects,
					createdAt: Date.now(),
				},
			]);
		}
		this.clearPdfTextSelection();
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
			this.clearPdfTextSelection();
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
		if (key === "c" && this.selectedPdfTextSelection?.text.trim()) {
			event.preventDefault();
			void this.copyPdfTextSelection();
			return;
		}
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
			this.pushUndoSnapshot({ inkStrokes: this.eraserSessionBefore });
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

	private renderAllTextAnnotations(): void {
		this.clearFocusedTextAnnotation();
		for (const pageNumber of this.textAnnotationLayers.keys()) {
			this.renderTextAnnotationsForPage(pageNumber);
		}
	}

	private renderInkStrokesForPage(pageNumber: number): void {
		const layer = this.annotationLayers.get(pageNumber);
		if (!layer) {
			return;
		}
		this.releaseSelectedInkDragPreview(pageNumber);
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
			if (this.captureActionBarEl?.dataset.pageNumber === String(pageNumber)) {
				this.clearCaptureActionBar();
			}
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
		this.renderCaptureActionBarForPage(selection);
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
						el.className = `weave-pdf-text-annotation weave-pdf-text-annotation--${annotation.kind}`;
						el.dataset.annotationId = annotation.id;
						el.dataset.annotationKind = annotation.kind;
						if (annotation.semanticId) {
							el.dataset.semanticId = annotation.semanticId;
						}
						if (annotation.semanticLabel) {
							el.dataset.semanticLabel = annotation.semanticLabel;
						}
						if (annotation.semanticColor) {
							el.dataset.semanticColor = annotation.semanticColor;
						}
						if (annotation.semanticStyle) {
							el.dataset.semanticStyle = annotation.semanticStyle;
						}
						if (annotation.note) {
							el.title = annotation.note;
						}
						el.style.left = `${this.formatPdfCssNumber(rect.x * 100)}%`;
						el.style.top = `${this.formatPdfCssNumber(rect.y * 100)}%`;
						el.style.width = `${this.formatPdfCssNumber(rect.width * 100)}%`;
						el.style.height = `${this.formatPdfCssNumber(rect.height * 100)}%`;
						el.style.setProperty("--weave-pdf-text-annotation-color", annotation.color);
						el.addEventListener("mousedown", (event) => {
							event.preventDefault();
							event.stopPropagation();
						});
						el.addEventListener("pointerdown", (event) => {
							event.stopPropagation();
						});
						el.addEventListener("click", (event) => {
							event.preventDefault();
							event.stopPropagation();
							this.openTextAnnotationEditBar(annotation.id);
						});
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
		this.redoInkStack.push(this.createAnnotationHistorySnapshot());
		this.restoreAnnotationHistorySnapshot(previous);
		this.annotationsDirty = true;
		this.updateToolbarState();
		this.syncAsActivePdfDocument();
		void this.persistPdfAnnotations();
	}

	private redoPdfInk(): void {
		const next = this.redoInkStack.pop();
		if (!next) {
			return;
		}
		this.undoInkStack.push(this.createAnnotationHistorySnapshot());
		this.trimInkHistory();
		this.restoreAnnotationHistorySnapshot(next);
		this.annotationsDirty = true;
		this.updateToolbarState();
		this.syncAsActivePdfDocument();
		void this.persistPdfAnnotations();
	}

	private pushUndoSnapshot(
		overrides: Partial<PdfAnnotationHistorySnapshot> = {}
	): void {
		this.undoInkStack.push(
			this.createAnnotationHistorySnapshot(
				overrides.inkStrokes ?? this.inkStrokes,
				overrides.textAnnotations ?? this.textAnnotations
			)
		);
		this.trimInkHistory();
		this.redoInkStack = [];
	}

	private createAnnotationHistorySnapshot(
		inkStrokes: PdfInkStroke[] = this.inkStrokes,
		textAnnotations: PdfTextAnnotation[] = this.textAnnotations
	): PdfAnnotationHistorySnapshot {
		return {
			inkStrokes: clonePdfInkStrokes(inkStrokes),
			textAnnotations: this.clonePdfTextAnnotations(textAnnotations),
		};
	}

	private restoreAnnotationHistorySnapshot(snapshot: PdfAnnotationHistorySnapshot): void {
		this.inkStrokes = clonePdfInkStrokes(snapshot.inkStrokes);
		this.textAnnotations = this.clonePdfTextAnnotations(snapshot.textAnnotations);
		this.selectedInkStrokeIds.clear();
		this.editingTextAnnotationId = "";
		this.clearPdfTextSelection();
		this.renderAllInkStrokes();
		this.renderAllTextAnnotations();
	}

	private clonePdfTextAnnotations(annotations: PdfTextAnnotation[]): PdfTextAnnotation[] {
		return annotations.map((annotation) => ({
			...annotation,
			rects: annotation.rects.map((rect) => ({ ...rect })),
		}));
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
		this.clearCaptureActionBar();
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
			pdfState.annotationCount = this.textAnnotations.length;
			pdfState.annotations = this.buildPdfSharedAnnotations();
			pdfState.thumbnails = this.thumbnails;
			pdfState.onNavigatePage = (pageNumber: number) => {
				this.goToPage(pageNumber);
			};
			pdfState.onNavigateAnnotation = (annotationId: string) => {
				this.goToTextAnnotation(annotationId);
			};
		}
		epubActiveDocumentStore.setActivePdfDocument(pdfState);
	}

	private buildPdfSharedAnnotations(): PdfSharedAnnotation[] {
		return sortPdfTextAnnotationsByPosition(this.textAnnotations)
			.map((annotation) => ({
				id: annotation.id,
				pageNumber: annotation.pageNumber,
				kind: annotation.kind,
				color: annotation.color,
				text: annotation.text,
				note: annotation.note,
				semanticId: annotation.semanticId,
				semanticLabel: annotation.semanticLabel,
				semanticStyle: annotation.semanticStyle,
				createdAt: annotation.createdAt,
			}));
	}

	private goToTextAnnotation(annotationId: string): boolean {
		const id = String(annotationId || "").trim();
		if (!id) {
			return false;
		}
		const annotation = this.textAnnotations.find((entry) => entry.id === id);
		if (!annotation) {
			return false;
		}
		this.goToPage(annotation.pageNumber, { scroll: false });
		const focusEl = this.focusTextAnnotation(annotation);
		if (focusEl) {
			focusEl.scrollIntoView?.({ block: "center", behavior: "smooth" });
			return true;
		}
		const annotationEl = this.findTextAnnotationElement(id);
		if (annotationEl) {
			annotationEl.scrollIntoView?.({ block: "center", behavior: "smooth" });
			return true;
		}
		this.pageEls.get(annotation.pageNumber)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
		return true;
	}

	private findTextAnnotationElement(annotationId: string): HTMLElement | null {
		return (
			Array.from(
				this.contentEl.querySelectorAll<HTMLElement>(".weave-pdf-text-annotation")
			).find((element) => element.dataset.annotationId === annotationId) ?? null
		);
	}

	private focusTextAnnotation(annotation: PdfTextAnnotation): HTMLElement | null {
		this.clearFocusedTextAnnotation();
		const layer = this.textAnnotationLayers.get(annotation.pageNumber);
		if (!layer || annotation.rects.length === 0) {
			return null;
		}
		const bounds = this.getPdfRectUnion(annotation.rects);
		const padding = 0.01;
		const left = Math.max(0, bounds.left - padding);
		const top = Math.max(0, bounds.top - padding);
		const right = Math.min(1, bounds.right + padding);
		const bottom = Math.min(1, bounds.bottom + padding);
		const focusEl = layer.createDiv({
			cls: "weave-pdf-text-annotation-focus",
		});
		focusEl.dataset.annotationId = annotation.id;
		focusEl.style.left = `${this.formatPdfCssNumber(left * 100)}%`;
		focusEl.style.top = `${this.formatPdfCssNumber(top * 100)}%`;
		focusEl.style.width = `${this.formatPdfCssNumber((right - left) * 100)}%`;
		focusEl.style.height = `${this.formatPdfCssNumber((bottom - top) * 100)}%`;
		this.focusedTextAnnotationEl = focusEl;
		this.focusedTextAnnotationTimer = window.setTimeout(() => {
			this.clearFocusedTextAnnotation();
		}, 1600);
		return focusEl;
	}

	private clearFocusedTextAnnotation(): void {
		if (this.focusedTextAnnotationTimer !== null) {
			window.clearTimeout(this.focusedTextAnnotationTimer);
			this.focusedTextAnnotationTimer = null;
		}
		this.focusedTextAnnotationEl?.remove();
		this.focusedTextAnnotationEl = null;
		this.contentEl
			.querySelectorAll<HTMLElement>(".weave-pdf-text-annotation.is-focused")
			.forEach((element) => element.classList.remove("is-focused"));
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
