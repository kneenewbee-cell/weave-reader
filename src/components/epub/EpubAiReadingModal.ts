import {
	Component,
	MarkdownRenderer,
	Modal,
	Notice,
	normalizePath,
	setIcon,
} from "obsidian";
import type { App, TFile } from "obsidian";
import { openFileWithExistingLeaf } from "../../utils/workspace-navigation";
import {
	requestEpubAiReading,
	upsertEpubAiReadingNote,
	type EpubAiReadingConfigHost,
	type EpubAiReadingInput,
	type EpubAiReadingResult,
} from "../../services/epub/epub-ai-reading";
import {
	buildEpubAiReadingScopeLevels,
	getEpubAiReadingScopeSessionKeyPart,
	resolveDefaultEpubAiReadingScopeIds,
	resolveEpubAiReadingScopeSelection,
	type EpubAiReadingScopeSelection,
} from "../../services/epub/epub-ai-reading-scope";
import type { TocItem } from "../../services/epub/types";
import { logger } from "../../utils/logger";

interface EpubAiReadingModalOptions {
	input: EpubAiReadingInput;
	configHost?: EpubAiReadingConfigHost | null;
	envPathCandidates?: string[];
	tocItems?: TocItem[];
	initialScopeIds?: string[];
	resolveScopedInput?: (
		scope: EpubAiReadingScopeSelection,
	) => Promise<EpubAiReadingInput | null>;
}

type EpubAiReadingSectionKey =
	| "summary"
	| "core"
	| "knowledge"
	| "sections"
	| "quotes"
	| "pitfalls"
	| "relations"
	| "path"
	| "other"
	| "full";

interface EpubAiReadingSection {
	key: EpubAiReadingSectionKey;
	label: string;
	markdown: string;
}

interface EpubAiReadingModalDragState {
	startX: number;
	startY: number;
	originLeft: number;
	originTop: number;
	width: number;
	height: number;
}

interface EpubAiReadingSessionDraft {
	key: string;
	bookKey: string;
	input: EpubAiReadingInput;
	result: EpubAiReadingResult;
	noteFile: TFile | null;
	savedToNote: boolean;
	updatedAt: number;
}

interface EpubAiReadingGenerationSession {
	key: string;
	bookKey: string;
	input: EpubAiReadingInput;
	state: "generating" | "result" | "error";
	status: string;
	partialContent: string;
	result: EpubAiReadingResult | null;
	errorMessage: string;
	noteFile: TFile | null;
	savedToNote: boolean;
	updatedAt: number;
	request: Promise<EpubAiReadingResult>;
	listeners: Set<() => void>;
}

interface EpubAiReadingSessionState {
	drafts: Map<string, EpubAiReadingSessionDraft>;
	generations: Map<string, EpubAiReadingGenerationSession>;
	latestUnsavedDraftKey: string | null;
	latestSessionKeyByBook: Map<string, string>;
}

const EPUB_AI_READING_SESSION_STATE = new WeakMap<
	App,
	EpubAiReadingSessionState
>();
const EPUB_AI_READING_RESTORED_STATUS =
	"\u5df2\u6062\u590d\u4e0a\u6b21 AI \u9605\u8bfb\u7ed3\u679c\uff0c\u672a\u91cd\u65b0\u751f\u6210\u3002";
const EPUB_AI_READING_RESTORED_SAVED_STATUS =
	"\u5df2\u6062\u590d\u4e0a\u6b21 AI \u9605\u8bfb\u7ed3\u679c\uff0c\u5bf9\u5e94\u7b14\u8bb0\u5df2\u751f\u6210\u3002";
const EPUB_AI_READING_UNSAVED_WARNING =
	"\u4e0a\u4e00\u4efd AI \u9605\u8bfb\u7ed3\u679c\u5c1a\u672a\u751f\u6210/\u66f4\u65b0\u7b14\u8bb0\uff0c\u5df2\u4fdd\u7559\uff1b\u5f53\u524d\u7ae0\u8282\u5c06\u91cd\u65b0\u751f\u6210\u3002";
const EPUB_AI_READING_SOURCE_LINK_TITLE =
	"\u70b9\u51fb\u56de\u5230 EPUB \u539f\u6587";

const EPUB_AI_READING_SECTION_DEFINITIONS: Array<{
	key: EpubAiReadingSectionKey;
	label: string;
	match: RegExp;
}> = [
	{
		key: "summary",
		label: "\u6458\u8981",
		match:
			/\u8303\u56f4\u6458\u8981|\u672c\u7ae0\u6458\u8981|\u5185\u5bb9\u6982\u8981|\u6458\u8981/u,
	},
	{
		key: "core",
		label: "\u6838\u5fc3\u7ed3\u8bba",
		match: /\u6838\u5fc3\u7ed3\u8bba|\u4e3b\u8981\u7ed3\u8bba/u,
	},
	{
		key: "knowledge",
		label: "\u77e5\u8bc6\u70b9",
		match:
			/\u5173\u952e\u77e5\u8bc6\u70b9|\u6982\u5ff5\/\u672f\u8bed|\u672f\u8bed|\u77e5\u8bc6\u70b9/u,
	},
	{
		key: "sections",
		label: "\u5c0f\u8282\u7cbe\u8bfb",
		match:
			/\u6309\u5c0f\u8282\u7cbe\u8bfb|\u9010\u5c0f\u8282\u7cbe\u8bfb|\u5c0f\u8282\u7cbe\u8bfb|\u4e0b\u7ea7\u5c0f\u8282/u,
	},
	{
		key: "quotes",
		label: "\u91cd\u8981\u539f\u6587",
		match:
			/\u91cd\u8981\u539f\u6587\u4e0e\u89e3\u8bfb|\u91cd\u8981\u539f\u6587|\u539f\u6587/u,
	},
	{
		key: "pitfalls",
		label: "\u6613\u8bef\u89e3",
		match:
			/\u5bb9\u6613\u8bef\u89e3\u7684\u70b9|\u6613\u8bef\u89e3|\u8bef\u89e3/u,
	},
	{
		key: "relations",
		label: "\u7ae0\u8282\u5173\u7cfb",
		match: /\u7ae0\u8282\u5173\u7cfb|\u5173\u7cfb/u,
	},
	{
		key: "path",
		label: "\u7cbe\u8bfb\u987a\u5e8f",
		match:
			/\u5efa\u8bae\u7cbe\u8bfb\u4f4d\u7f6e|\u5efa\u8bae\u7cbe\u8bfb\u987a\u5e8f|\u7cbe\u8bfb\u8def\u5f84|\u884c\u52a8\u6e05\u5355|\u7cbe\u8bfb\u987a\u5e8f/u,
	},
];

function getEpubAiReadingSessionState(app: App): EpubAiReadingSessionState {
	let state = EPUB_AI_READING_SESSION_STATE.get(app);
	if (!state) {
		state = {
			drafts: new Map(),
			generations: new Map(),
			latestUnsavedDraftKey: null,
			latestSessionKeyByBook: new Map(),
		};
		EPUB_AI_READING_SESSION_STATE.set(app, state);
	}
	return state;
}

function normalizeSessionValue(value: unknown): string {
	return String(value || "").trim();
}

function getEpubAiReadingBookKey(
	input: Pick<EpubAiReadingInput, "filePath">,
): string {
	return normalizePath(normalizeSessionValue(input.filePath));
}

function getEpubAiReadingSessionKey(
	input: EpubAiReadingInput,
	scope?: EpubAiReadingScopeSelection | null,
): string {
	const filePath = normalizePath(normalizeSessionValue(input.filePath));
	if (scope) {
		return `${filePath}::${getEpubAiReadingScopeSessionKeyPart(scope)}`;
	}
	const chapterKey =
		normalizeSessionValue(input.chapterHref) ||
		normalizeSessionValue(input.sourceLink) ||
		normalizeSessionValue(input.chapterTitle);
	return `${filePath}::${chapterKey}`;
}

function findLatestUnsavedDraftKey(
	state: EpubAiReadingSessionState,
): string | null {
	let latestKey: string | null = null;
	let latestUpdatedAt = -1;
	for (const [key, draft] of state.drafts.entries()) {
		if (!draft.savedToNote && draft.updatedAt > latestUpdatedAt) {
			latestKey = key;
			latestUpdatedAt = draft.updatedAt;
		}
	}
	return latestKey;
}

function getLatestUnsavedDraftExcept(
	state: EpubAiReadingSessionState,
	currentKey: string,
): EpubAiReadingSessionDraft | null {
	const latestKey = state.latestUnsavedDraftKey;
	const latestDraft = latestKey ? state.drafts.get(latestKey) : null;
	if (latestDraft && latestKey !== currentKey && !latestDraft.savedToNote) {
		return latestDraft;
	}
	let fallback: EpubAiReadingSessionDraft | null = null;
	for (const [key, draft] of state.drafts.entries()) {
		if (key === currentKey || draft.savedToNote) {
			continue;
		}
		if (!fallback || draft.updatedAt > fallback.updatedAt) {
			fallback = draft;
		}
	}
	return fallback;
}

export class EpubAiReadingModal extends Modal {
	private readonly input: EpubAiReadingInput;
	private readonly configHost: EpubAiReadingConfigHost | null;
	private readonly envPathCandidates: string[];
	private readonly tocItems: TocItem[];
	private readonly resolveScopedInput: EpubAiReadingModalOptions["resolveScopedInput"];
	private readonly sessionKey: string;
	private readonly sessionState: EpubAiReadingSessionState;
	private selectedScopeIds: string[];
	private mode: "selecting-scope" | "reading" = "reading";
	private activeInput: EpubAiReadingInput;
	private activeSessionKey: string;
	private generationSessionUnsubscribe: (() => void) | null = null;
	private result: EpubAiReadingResult | null = null;
	private resultEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private warningEl: HTMLElement | null = null;
	private actionsEl: HTMLElement | null = null;
	private noteFile: TFile | null = null;
	private markdownRenderComponent: Component | null = null;
	private streamingPreviewEl: HTMLPreElement | null = null;
	private activeSectionKey: EpubAiReadingSectionKey | null = null;
	private sectionTabsEl: HTMLElement | null = null;
	private sectionBodyEl: HTMLElement | null = null;
	private dragState: EpubAiReadingModalDragState | null = null;
	private readonly handleDocumentDragMove = (event: MouseEvent): void => {
		this.updateModalDrag(event);
	};
	private readonly handleDocumentDragEnd = (): void => {
		this.stopModalDrag();
	};

	constructor(app: App, options: EpubAiReadingModalOptions) {
		super(app);
		this.input = options.input;
		this.configHost = options.configHost || null;
		this.envPathCandidates = options.envPathCandidates || [];
		this.tocItems = options.tocItems || [];
		this.resolveScopedInput = options.resolveScopedInput;
		this.selectedScopeIds =
			options.initialScopeIds ||
			resolveDefaultEpubAiReadingScopeIds(
				this.tocItems,
				this.input.chapterHref,
			);
		this.sessionKey = getEpubAiReadingSessionKey(this.input);
		this.sessionState = getEpubAiReadingSessionState(app);
		this.activeInput = this.input;
		this.activeSessionKey = this.sessionKey;
	}

	onOpen(): void {
		this.contentEl.empty();
		this.getModalHostEl()?.addClass("weave-epub-ai-reading-modal-host");
		this.contentEl.addClass("weave-epub-ai-reading-modal");
		this.renderShell();
		if (this.shouldShowScopeSelection()) {
			const restorableSession = this.getLatestRestorableSessionForBook();
			if (restorableSession?.generation) {
				this.attachGenerationSession(restorableSession.generation);
				return;
			}
			if (restorableSession?.draft) {
				void this.restoreCachedReading(restorableSession.draft);
				return;
			}
			this.renderScopeSelection();
			return;
		}
		void this.restoreOrGenerateReading();
	}

	onClose(): void {
		this.getModalHostEl()?.removeClass("weave-epub-ai-reading-modal-host");
		this.stopModalDrag();
		this.detachGenerationSession();
		this.releaseMarkdownRenderComponent();
	}

	private getModalHostEl(): HTMLElement | null {
		return (
			(this as Modal & { modalEl?: HTMLElement }).modalEl ||
			this.containerEl ||
			null
		);
	}

	private shouldShowScopeSelection(): boolean {
		return (
			this.tocItems.length > 0 && typeof this.resolveScopedInput === "function"
		);
	}

	private getLatestRestorableSessionForBook(): {
		generation?: EpubAiReadingGenerationSession;
		draft?: EpubAiReadingSessionDraft;
	} | null {
		const bookKey = getEpubAiReadingBookKey(this.input);
		const latestKey = this.sessionState.latestSessionKeyByBook.get(bookKey);
		if (latestKey) {
			const generation = this.sessionState.generations.get(latestKey);
			if (generation) {
				return { generation };
			}
			const draft = this.sessionState.drafts.get(latestKey);
			if (draft) {
				return { draft };
			}
		}
		for (const generation of this.sessionState.generations.values()) {
			if (generation.bookKey === bookKey) {
				return { generation };
			}
		}
		return null;
	}

	private detachGenerationSession(): void {
		this.generationSessionUnsubscribe?.();
		this.generationSessionUnsubscribe = null;
	}

	private attachGenerationSession(
		session: EpubAiReadingGenerationSession,
	): void {
		this.detachGenerationSession();
		this.mode = "reading";
		this.activeInput = session.input;
		this.activeSessionKey = session.key;
		const listener = () => {
			void this.renderGenerationSession(session);
		};
		session.listeners.add(listener);
		this.generationSessionUnsubscribe = () => {
			session.listeners.delete(listener);
		};
		void this.renderGenerationSession(session);
	}

	private notifyGenerationSession(
		session: EpubAiReadingGenerationSession,
	): void {
		for (const listener of session.listeners) {
			listener();
		}
	}

	private async renderGenerationSession(
		session: EpubAiReadingGenerationSession,
	): Promise<void> {
		if (this.activeSessionKey !== session.key) {
			return;
		}
		this.mode = "reading";
		this.activeInput = session.input;
		this.result = session.result;
		this.noteFile = session.noteFile;
		if (session.state === "generating") {
			this.setStatus(session.status || "正在生成 AI 阅读结果...");
			if (session.partialContent) {
				this.renderStreamingPreview(session.partialContent);
			} else if (this.resultEl) {
				this.resultEl.empty();
				this.resultEl.createDiv({ text: "生成中..." });
			}
			this.renderActions();
			return;
		}
		if (session.state === "error") {
			this.setStatus(session.errorMessage || "AI 阅读生成失败。");
			if (this.resultEl) {
				this.resultEl.empty();
				this.resultEl.createDiv({
					cls: "weave-epub-ai-reading-error",
					text: "AI 阅读生成失败，请检查 .env 中的 Kimi API Key、网络连接或模型配置。",
				});
			}
			this.renderActions();
			return;
		}
		if (session.result) {
			this.setStatus(session.status || "已生成当前范围 AI 阅读结果。");
			await this.renderMarkdown(session.result.content);
			this.renderActions();
		}
	}

	private renderShell(): void {
		const header = this.contentEl.createDiv({
			cls: "weave-epub-ai-reading-header",
		});
		header.addEventListener("mousedown", (event) => this.startModalDrag(event));
		const titleWrap = header.createDiv({
			cls: "weave-epub-ai-reading-title-wrap",
		});
		const iconEl = titleWrap.createSpan({ cls: "weave-epub-ai-reading-icon" });
		setIcon(iconEl, "sparkles");
		titleWrap.createEl("h2", { text: "AI阅读" });
		const closeButton = header.createEl("button", {
			cls: "clickable-icon weave-epub-ai-reading-close",
			attr: { "aria-label": "关闭" },
		});
		setIcon(closeButton, "x");
		closeButton.addEventListener("click", () => this.close());

		this.statusEl = this.contentEl.createDiv({
			cls: "weave-epub-ai-reading-status",
		});
		this.warningEl = this.contentEl.createDiv({
			cls: "weave-epub-ai-reading-warning",
		});
		this.clearWarning();
		const meta = this.contentEl.createDiv({
			cls: "weave-epub-ai-reading-meta",
		});
		meta.createEl("div", { text: this.input.bookTitle || "当前书籍" });
		meta.createEl("div", { text: this.input.chapterTitle || "当前章节" });
		if (this.input.sourceLink) {
			const sourceLink = meta.createEl("a", {
				cls: "weave-epub-ai-reading-source-link",
				text: "回到当前章节原文",
			});
			sourceLink.setAttribute("href", this.input.sourceLink);
			this.decorateEpubSourceLink(sourceLink);
			sourceLink.addEventListener("click", (event) => {
				this.openSourceLink(event);
			});
		}
		this.resultEl = this.contentEl.createDiv({
			cls: "weave-epub-ai-reading-result",
		});
		this.resultEl.addEventListener("click", (event) =>
			this.handleRenderedSourceLinkClick(event),
		);
		this.actionsEl = this.contentEl.createDiv({
			cls: "weave-epub-ai-reading-actions",
		});
		this.renderActions();
	}

	private setStatus(message: string): void {
		if (this.statusEl) {
			this.statusEl.textContent = message;
		}
	}

	private setWarning(message: string): void {
		if (!this.warningEl) {
			return;
		}
		this.warningEl.textContent = message;
		this.warningEl.toggleClass("is-hidden", !message);
	}

	private clearWarning(): void {
		this.setWarning("");
	}

	private renderActions(): void {
		if (!this.actionsEl) {
			return;
		}
		this.actionsEl.empty();
		if (this.mode === "selecting-scope") {
			this.renderScopeActions();
			return;
		}
		if (this.shouldShowScopeSelection() && this.result) {
			const changeScopeButton = this.actionsEl.createEl("button", {
				text: "更改范围",
			});
			changeScopeButton.addEventListener("click", () => {
				this.renderScopeSelection();
			});
		}
		const regenerateButton = this.actionsEl.createEl("button", {
			text: "重新生成",
		});
		regenerateButton.addEventListener("click", () => {
			void this.generateReading({
				force: true,
				input: this.activeInput,
				sessionKey: this.activeSessionKey,
			});
		});
		if (this.noteFile) {
			const openNoteButton = this.actionsEl.createEl("button", {
				text: "打开笔记",
			});
			openNoteButton.addEventListener("click", () => {
				void this.openGeneratedNote();
			});
		}
		const noteButton = this.actionsEl.createEl("button", {
			text: this.noteFile ? "更新并打开笔记" : "生成并打开笔记",
			cls: "mod-cta",
		});
		noteButton.disabled = !this.result;
		noteButton.addEventListener("click", () => {
			void this.writeAndOpenNote();
		});
	}

	private renderScopeSelection(): void {
		this.mode = "selecting-scope";
		this.result = null;
		this.noteFile = null;
		this.clearWarning();
		const selection = resolveEpubAiReadingScopeSelection(
			this.tocItems,
			this.selectedScopeIds,
		);
		this.setStatus(
			selection.kind === "book-placeholder"
				? "全书 AI 阅读将在后续版本支持。"
				: "请选择 AI 阅读范围，然后点击开始 AI 阅读。",
		);
		if (!this.resultEl) {
			return;
		}
		this.resultEl.empty();
		const scopeRoot = this.resultEl.createDiv({
			cls: "weave-epub-ai-reading-scope-picker",
		});
		scopeRoot.createEl("h3", { text: "选择 AI 阅读范围" });
		const levels = buildEpubAiReadingScopeLevels(
			this.tocItems,
			this.selectedScopeIds,
		);
		const controlsRoot = scopeRoot.createDiv({
			cls: "weave-epub-ai-reading-scope-controls",
		});
		for (const level of levels) {
			const row = controlsRoot.createDiv({
				cls: "weave-epub-ai-reading-scope-row",
			});
			row.createEl("label", {
				cls: "weave-epub-ai-reading-scope-label",
				text: `第 ${level.depth + 1} 级`,
			});
			const select = row.createEl("select", {
				cls: "weave-epub-ai-reading-scope-select",
			});
			select.disabled = level.disabled;
			for (const option of level.options) {
				const optionEl = select.createEl("option", {
					text: option.label,
				});
				optionEl.value = option.id;
			}
			select.value = level.selectedId;
			select.addEventListener("change", () => {
				this.selectedScopeIds = [
					...this.selectedScopeIds.slice(0, level.depth),
					select.value,
				];
				this.renderScopeSelection();
			});
		}
		const summary = scopeRoot.createDiv({
			cls: "weave-epub-ai-reading-scope-summary",
			text: selection.pathLabels.join(" > "),
		});
		if (!selection.canGenerate) {
			summary.addClass("is-disabled");
		}
		this.renderActions();
	}

	private renderScopeActions(): void {
		if (!this.actionsEl) {
			return;
		}
		const selection = resolveEpubAiReadingScopeSelection(
			this.tocItems,
			this.selectedScopeIds,
		);
		const startButton = this.actionsEl.createEl("button", {
			text: "开始 AI 阅读",
			cls: "mod-cta",
		});
		startButton.disabled = !selection.canGenerate;
		startButton.addEventListener("click", () => {
			void this.startScopedReading();
		});
	}

	private async startScopedReading(): Promise<void> {
		const selection = resolveEpubAiReadingScopeSelection(
			this.tocItems,
			this.selectedScopeIds,
		);
		if (!selection.canGenerate) {
			this.setStatus("全书 AI 阅读将在后续版本支持。");
			return;
		}
		if (!this.resolveScopedInput) {
			this.setStatus("AI 阅读范围解析不可用。");
			return;
		}
		this.setStatus("正在准备所选范围...");
		try {
			const scopedInput = await this.resolveScopedInput(selection);
			if (
				!scopedInput?.chapterText?.trim() &&
				!scopedInput?.chapterMarkdown?.trim()
			) {
				this.setStatus("所选范围没有可用于 AI 阅读的正文。");
				return;
			}
			this.mode = "reading";
			this.activeInput = scopedInput;
			this.activeSessionKey = getEpubAiReadingSessionKey(
				scopedInput,
				selection,
			);
			await this.generateReading({
				input: scopedInput,
				sessionKey: this.activeSessionKey,
			});
		} catch (error) {
			logger.error(
				"[EpubAiReadingModal] Failed to prepare scoped AI reading:",
				error,
			);
			this.setStatus(error instanceof Error ? error.message : String(error));
		}
	}

	private async restoreOrGenerateReading(): Promise<void> {
		this.mode = "reading";
		this.clearWarning();
		const generatingSession = this.sessionState.generations.get(
			this.sessionKey,
		);
		if (generatingSession) {
			this.attachGenerationSession(generatingSession);
			return;
		}
		const cachedDraft = this.sessionState.drafts.get(this.sessionKey);
		if (cachedDraft) {
			await this.restoreCachedReading(cachedDraft);
			return;
		}
		if (getLatestUnsavedDraftExcept(this.sessionState, this.sessionKey)) {
			this.setWarning(EPUB_AI_READING_UNSAVED_WARNING);
			new Notice(EPUB_AI_READING_UNSAVED_WARNING);
		}
		await this.generateReading({ force: true });
	}

	private async restoreCachedReading(
		draft: EpubAiReadingSessionDraft,
	): Promise<void> {
		this.result = draft.result;
		this.noteFile = draft.noteFile;
		this.activeInput = draft.input;
		this.activeSessionKey = draft.key;
		this.streamingPreviewEl = null;
		this.setStatus(
			draft.savedToNote
				? EPUB_AI_READING_RESTORED_SAVED_STATUS
				: EPUB_AI_READING_RESTORED_STATUS,
		);
		await this.renderMarkdown(draft.result.content);
		this.renderActions();
	}

	private rememberCurrentResult(savedToNote: boolean): void {
		if (!this.result) {
			return;
		}
		const key = this.activeSessionKey || this.sessionKey;
		const bookKey = getEpubAiReadingBookKey(this.activeInput);
		this.sessionState.drafts.set(key, {
			key,
			bookKey,
			input: this.activeInput,
			result: this.result,
			noteFile: this.noteFile,
			savedToNote,
			updatedAt: Date.now(),
		});
		this.sessionState.latestSessionKeyByBook.set(bookKey, key);
		if (savedToNote) {
			if (this.sessionState.latestUnsavedDraftKey === key) {
				this.sessionState.latestUnsavedDraftKey = findLatestUnsavedDraftKey(
					this.sessionState,
				);
			}
			return;
		}
		this.sessionState.latestUnsavedDraftKey = key;
	}

	private async generateReading(
		options: {
			force?: boolean;
			input?: EpubAiReadingInput;
			sessionKey?: string;
		} = {},
	): Promise<void> {
		const input = options.input || this.activeInput || this.input;
		const sessionKey =
			options.sessionKey || this.activeSessionKey || this.sessionKey;
		const existingSession = this.sessionState.generations.get(sessionKey);
		if (existingSession && !options.force) {
			this.attachGenerationSession(existingSession);
			return;
		}
		this.detachGenerationSession();
		this.activeInput = input;
		this.activeSessionKey = sessionKey;
		this.result = null;
		this.noteFile = null;
		this.streamingPreviewEl = null;
		this.renderActions();
		this.setStatus("正在提取所选范围并请求 Kimi 生成 AI 阅读结果...");
		if (this.resultEl) {
			this.resultEl.empty();
			this.resultEl.createDiv({ text: "生成中..." });
		}
		const bookKey = getEpubAiReadingBookKey(input);
		const generationSession = this.createGenerationSession(
			input,
			sessionKey,
			bookKey,
		);
		this.attachGenerationSession(generationSession);

		try {
			await generationSession.request;
		} catch (error) {
			logger.error(
				"[EpubAiReadingModal] Failed to generate AI reading:",
				error,
			);
		} finally {
			this.renderActions();
		}
	}

	private createGenerationSession(
		input: EpubAiReadingInput,
		sessionKey: string,
		bookKey: string,
	): EpubAiReadingGenerationSession {
		this.sessionState.generations.delete(sessionKey);
		const session = {
			key: sessionKey,
			bookKey,
			input,
			state: "generating" as const,
			status: "正在提取所选范围并请求 Kimi 生成 AI 阅读结果...",
			partialContent: "",
			result: null,
			errorMessage: "",
			noteFile: null,
			savedToNote: false,
			updatedAt: Date.now(),
			request: Promise.resolve(null as unknown as EpubAiReadingResult),
			listeners: new Set<() => void>(),
		};
		this.sessionState.generations.set(sessionKey, session);
		this.sessionState.latestSessionKeyByBook.set(bookKey, sessionKey);
		session.request = requestEpubAiReading(input, {
			app: this.app,
			configHost: this.configHost,
			envPathCandidates: this.envPathCandidates,
			onStage: (stage) => {
				session.status = stage;
				session.updatedAt = Date.now();
				this.notifyGenerationSession(session);
			},
			onPartialContent: (content) => {
				session.partialContent = content;
				session.updatedAt = Date.now();
				this.notifyGenerationSession(session);
			},
		})
			.then((result) => {
				session.state = "result";
				session.result = result;
				session.status = "已生成当前范围 AI 阅读结果。";
				session.updatedAt = Date.now();
				this.sessionState.generations.delete(sessionKey);
				this.result = result;
				this.noteFile = session.noteFile;
				this.activeInput = input;
				this.activeSessionKey = sessionKey;
				this.rememberCurrentResult(false);
				this.notifyGenerationSession(session);
				return result;
			})
			.catch((error) => {
				session.state = "error";
				session.errorMessage =
					error instanceof Error ? error.message : String(error);
				session.status = session.errorMessage;
				session.updatedAt = Date.now();
				this.notifyGenerationSession(session);
				throw error;
			});
		return session;
	}

	private async renderMarkdown(markdown: string): Promise<void> {
		if (!this.resultEl) {
			return;
		}
		this.resultEl.empty();
		this.streamingPreviewEl = null;
		this.sectionTabsEl = null;
		this.sectionBodyEl = null;
		const sections = this.splitAiReadingSections(markdown);
		if (sections.length > 1) {
			this.activeSectionKey = sections[0].key;
			this.sectionTabsEl = this.resultEl.createDiv({
				cls: "weave-epub-ai-reading-tabs",
			});
			this.sectionBodyEl = this.resultEl.createDiv({
				cls: "weave-epub-ai-reading-section-body",
			});
			this.renderSectionTabs(sections);
			await this.renderMarkdownInto(sections[0].markdown, this.sectionBodyEl);
			return;
		}
		this.activeSectionKey = null;
		try {
			await MarkdownRenderer.render(
				this.app,
				markdown,
				this.resultEl,
				this.input.filePath,
				this.resetMarkdownRenderComponent(),
			);
			this.decorateRenderedSourceLinks(this.resultEl);
		} catch (error) {
			logger.warn(
				"[EpubAiReadingModal] Markdown rendering failed; showing raw result:",
				error,
			);
			this.setStatus("AI 阅读已生成，但 Markdown 渲染失败，已显示原始结果。");
			this.resultEl.empty();
			this.resultEl.createEl("pre", {
				cls: "weave-epub-ai-reading-fallback",
				text: markdown,
			});
		}
	}

	private async renderMarkdownInto(
		markdown: string,
		targetEl: HTMLElement,
	): Promise<void> {
		targetEl.empty();
		try {
			await MarkdownRenderer.render(
				this.app,
				markdown,
				targetEl,
				this.input.filePath,
				this.resetMarkdownRenderComponent(),
			);
			this.decorateRenderedSourceLinks(targetEl);
		} catch (error) {
			logger.warn(
				"[EpubAiReadingModal] Markdown rendering failed; showing raw result:",
				error,
			);
			this.setStatus(
				"AI \u9605\u8bfb\u5df2\u751f\u6210\uff0c\u4f46 Markdown \u6e32\u67d3\u5931\u8d25\uff0c\u5df2\u663e\u793a\u539f\u59cb\u7ed3\u679c\u3002",
			);
			targetEl.empty();
			targetEl.createEl("pre", {
				cls: "weave-epub-ai-reading-fallback",
				text: markdown,
			});
		}
	}

	private decorateRenderedSourceLinks(targetEl: HTMLElement): void {
		for (const link of targetEl.querySelectorAll<HTMLAnchorElement>("a")) {
			if (this.isEpubSourceLink(link)) {
				this.decorateEpubSourceLink(link);
			}
		}
	}

	private decorateEpubSourceLink(link: HTMLAnchorElement): void {
		link.setAttribute("title", EPUB_AI_READING_SOURCE_LINK_TITLE);
		link.setAttribute("aria-label", EPUB_AI_READING_SOURCE_LINK_TITLE);
		link.setAttribute("data-tooltip-position", "top");
	}

	private splitAiReadingSections(markdown: string): EpubAiReadingSection[] {
		const source = String(markdown || "").trim();
		if (!source) {
			return [{ key: "full", label: "\u5168\u90e8", markdown: "" }];
		}

		const headingPattern = /^##\s+(.+)$/gm;
		const headings: Array<{ title: string; index: number }> = [];
		let match: RegExpExecArray | null;
		while ((match = headingPattern.exec(source)) !== null) {
			headings.push({
				title: match[1].trim(),
				index: match.index,
			});
		}
		if (headings.length === 0) {
			return [{ key: "full", label: "\u5168\u90e8", markdown: source }];
		}

		const byKey = new Map<EpubAiReadingSectionKey, EpubAiReadingSection>();
		for (let index = 0; index < headings.length; index += 1) {
			const heading = headings[index];
			const nextHeading = headings[index + 1];
			const bodyEnd = nextHeading ? nextHeading.index : source.length;
			const sectionMarkdown = source.slice(heading.index, bodyEnd).trim();
			const definition = EPUB_AI_READING_SECTION_DEFINITIONS.find((item) =>
				item.match.test(heading.title),
			);
			const key = definition?.key || "other";
			const label = definition?.label || "\u5176\u4ed6";
			const existing = byKey.get(key);
			if (existing) {
				existing.markdown = `${existing.markdown}\n\n${sectionMarkdown}`.trim();
			} else {
				byKey.set(key, { key, label, markdown: sectionMarkdown });
			}
		}

		const orderedSections = EPUB_AI_READING_SECTION_DEFINITIONS.map(
			(definition) => byKey.get(definition.key),
		).filter((section): section is EpubAiReadingSection => Boolean(section));
		const otherSection = byKey.get("other");
		if (otherSection) {
			orderedSections.push(otherSection);
		}
		return orderedSections.length > 0
			? orderedSections
			: [{ key: "full", label: "\u5168\u90e8", markdown: source }];
	}

	private renderSectionTabs(sections: EpubAiReadingSection[]): void {
		if (!this.sectionTabsEl) {
			return;
		}
		this.sectionTabsEl.empty();
		for (const section of sections) {
			const tab = this.sectionTabsEl.createEl("button", {
				cls: `weave-epub-ai-reading-tab${
					section.key === this.activeSectionKey ? " is-active" : ""
				}`,
				text: section.label,
				attr: {
					type: "button",
					"aria-pressed":
						section.key === this.activeSectionKey ? "true" : "false",
				},
			});
			tab.addEventListener("click", () => {
				if (!this.sectionBodyEl || section.key === this.activeSectionKey) {
					return;
				}
				this.activeSectionKey = section.key;
				this.renderSectionTabs(sections);
				void this.renderMarkdownInto(section.markdown, this.sectionBodyEl);
			});
		}
	}

	private renderStreamingPreview(markdown: string): void {
		if (!this.resultEl) {
			return;
		}
		if (!this.streamingPreviewEl?.isConnected) {
			this.resultEl.empty();
			this.streamingPreviewEl = this.resultEl.createEl("pre", {
				cls: "weave-epub-ai-reading-stream",
			});
		}
		this.streamingPreviewEl.textContent = markdown;
		this.resultEl.scrollTop = this.resultEl.scrollHeight;
	}

	private shouldIgnoreDragStart(target: EventTarget | null): boolean {
		return (
			target instanceof Element &&
			Boolean(
				target.closest(
					"button, a, input, textarea, select, [contenteditable='true']",
				),
			)
		);
	}

	private startModalDrag(event: MouseEvent): void {
		if (event.button !== 0 || this.shouldIgnoreDragStart(event.target)) {
			return;
		}
		const hostEl = this.getModalHostEl();
		if (!hostEl) {
			return;
		}
		const rect = hostEl.getBoundingClientRect();
		this.dragState = {
			startX: event.clientX,
			startY: event.clientY,
			originLeft: rect.left,
			originTop: rect.top,
			width: rect.width,
			height: rect.height,
		};
		hostEl.addClass("is-dragging");
		hostEl.style.position = "fixed";
		hostEl.style.left = `${Math.round(rect.left)}px`;
		hostEl.style.top = `${Math.round(rect.top)}px`;
		hostEl.style.right = "auto";
		hostEl.style.bottom = "auto";
		hostEl.style.margin = "0";
		hostEl.style.transform = "none";
		document.addEventListener("mousemove", this.handleDocumentDragMove);
		document.addEventListener("mouseup", this.handleDocumentDragEnd);
		event.preventDefault();
	}

	private updateModalDrag(event: MouseEvent): void {
		if (!this.dragState) {
			return;
		}
		const hostEl = this.getModalHostEl();
		if (!hostEl) {
			return;
		}
		const maxLeft = Math.max(0, window.innerWidth - this.dragState.width);
		const maxTop = Math.max(0, window.innerHeight - this.dragState.height);
		const nextLeft =
			this.dragState.originLeft + event.clientX - this.dragState.startX;
		const nextTop =
			this.dragState.originTop + event.clientY - this.dragState.startY;
		hostEl.style.left = `${Math.round(
			Math.min(Math.max(nextLeft, 0), maxLeft),
		)}px`;
		hostEl.style.top = `${Math.round(
			Math.min(Math.max(nextTop, 0), maxTop),
		)}px`;
	}

	private stopModalDrag(): void {
		if (!this.dragState) {
			return;
		}
		this.dragState = null;
		this.getModalHostEl()?.removeClass("is-dragging");
		document.removeEventListener("mousemove", this.handleDocumentDragMove);
		document.removeEventListener("mouseup", this.handleDocumentDragEnd);
	}

	private handleRenderedSourceLinkClick(event: MouseEvent): void {
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}
		const link = target.closest<HTMLAnchorElement>("a");
		if (!link || !this.isEpubSourceLink(link)) {
			return;
		}
		window.setTimeout(() => this.close(), 0);
	}

	private isEpubSourceLink(link: HTMLAnchorElement): boolean {
		const href = link.getAttribute("href") || "";
		const label = (link.textContent || "").trim();
		return (
			/^(?:段|P)\d{3}$/.test(label) ||
			href.includes("weave-loc=") ||
			href.includes("weave-cfi=") ||
			href.includes("weave-epub") ||
			href.includes("epubcfi(") ||
			href.includes("sid=epubsrc-")
		);
	}

	private openSourceLink(event: MouseEvent): void {
		const sourceLink = this.input.sourceLink;
		if (!sourceLink) {
			return;
		}
		event.preventDefault();
		try {
			window.open(sourceLink, "_blank");
		} catch (error) {
			logger.warn(
				"[EpubAiReadingModal] Failed to open EPUB source link:",
				error,
			);
		}
		this.close();
	}

	private resetMarkdownRenderComponent(): Component {
		this.releaseMarkdownRenderComponent();
		const component = new Component();
		component.load();
		this.markdownRenderComponent = component;
		return component;
	}

	private releaseMarkdownRenderComponent(): void {
		this.markdownRenderComponent?.unload();
		this.markdownRenderComponent = null;
	}

	private async openGeneratedNote(): Promise<void> {
		if (!this.noteFile) {
			return;
		}
		try {
			await openFileWithExistingLeaf(this.app, this.noteFile, {
				openInNewTab: true,
				focus: true,
			});
			this.setStatus(`已打开 AI 阅读笔记：${this.noteFile.path}`);
		} catch (error) {
			logger.error(
				"[EpubAiReadingModal] Failed to open AI reading note:",
				error,
			);
			new Notice(
				`AI 阅读笔记打开失败：${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	private async writeAndOpenNote(): Promise<void> {
		if (!this.result) {
			return;
		}
		try {
			const noteFile = await upsertEpubAiReadingNote(this.app, this.result);
			this.noteFile = noteFile;
			await openFileWithExistingLeaf(this.app, noteFile, {
				openInNewTab: true,
				focus: true,
			});
			this.setStatus(`已生成/更新 AI 阅读笔记：${noteFile.path}`);
			new Notice("AI 阅读笔记已生成");
			this.rememberCurrentResult(true);
			this.clearWarning();
			this.renderActions();
		} catch (error) {
			logger.error(
				"[EpubAiReadingModal] Failed to write AI reading note:",
				error,
			);
			new Notice(
				`AI 阅读笔记生成失败：${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}
}
