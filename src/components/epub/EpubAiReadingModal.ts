import { Component, MarkdownRenderer, Modal, Notice, setIcon } from "obsidian";
import type { App, TFile } from "obsidian";
import { openFileWithExistingLeaf } from "../../utils/workspace-navigation";
import {
	requestEpubAiReading,
	upsertEpubAiReadingNote,
	type EpubAiReadingConfigHost,
	type EpubAiReadingInput,
	type EpubAiReadingResult,
} from "../../services/epub/epub-ai-reading";
import { logger } from "../../utils/logger";

interface EpubAiReadingModalOptions {
	input: EpubAiReadingInput;
	configHost?: EpubAiReadingConfigHost | null;
	envPathCandidates?: string[];
}

type EpubAiReadingSectionKey =
	| "summary"
	| "knowledge"
	| "quotes"
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

const EPUB_AI_READING_BACKDROP_EVENTS = ["pointerdown", "mousedown", "click"] as const;

const EPUB_AI_READING_SECTION_DEFINITIONS: Array<{
	key: EpubAiReadingSectionKey;
	label: string;
	match: RegExp;
}> = [
	{
		key: "summary",
		label: "\u6458\u8981",
		match: /\u672c\u7ae0\u6458\u8981|\u5185\u5bb9\u6982\u8981|\u6458\u8981/u,
	},
	{
		key: "knowledge",
		label: "\u77e5\u8bc6\u70b9",
		match: /\u5173\u952e\u77e5\u8bc6\u70b9|\u6982\u5ff5\/\u672f\u8bed|\u672f\u8bed|\u77e5\u8bc6\u70b9/u,
	},
	{
		key: "quotes",
		label: "\u91cd\u8981\u539f\u6587",
		match: /\u91cd\u8981\u539f\u6587|\u539f\u6587/u,
	},
	{
		key: "relations",
		label: "\u7ae0\u8282\u5173\u7cfb",
		match: /\u7ae0\u8282\u5173\u7cfb|\u5173\u7cfb/u,
	},
	{
		key: "path",
		label: "\u7cbe\u8bfb\u987a\u5e8f",
		match: /\u5efa\u8bae\u7cbe\u8bfb\u987a\u5e8f|\u7cbe\u8bfb\u8def\u5f84|\u884c\u52a8\u6e05\u5355|\u7cbe\u8bfb\u987a\u5e8f/u,
	},
];

export class EpubAiReadingModal extends Modal {
	private readonly input: EpubAiReadingInput;
	private readonly configHost: EpubAiReadingConfigHost | null;
	private readonly envPathCandidates: string[];
	private result: EpubAiReadingResult | null = null;
	private resultEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
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
	private readonly handleBackdropDismissEvent = (event: Event): void => {
		this.preventBackdropDismiss(event);
	};

	constructor(app: App, options: EpubAiReadingModalOptions) {
		super(app);
		this.input = options.input;
		this.configHost = options.configHost || null;
		this.envPathCandidates = options.envPathCandidates || [];
	}

	onOpen(): void {
		this.contentEl.empty();
		this.getModalHostEl()?.addClass("weave-epub-ai-reading-modal-host");
		this.addBackdropDismissGuard();
		this.contentEl.addClass("weave-epub-ai-reading-modal");
		this.renderShell();
		void this.generateReading();
	}

	onClose(): void {
		this.getModalHostEl()?.removeClass("weave-epub-ai-reading-modal-host");
		this.removeBackdropDismissGuard();
		this.stopModalDrag();
		this.releaseMarkdownRenderComponent();
	}

	private getModalHostEl(): HTMLElement | null {
		return (this as Modal & { modalEl?: HTMLElement }).modalEl || this.containerEl || null;
	}

	private addBackdropDismissGuard(): void {
		for (const eventName of EPUB_AI_READING_BACKDROP_EVENTS) {
			this.containerEl.addEventListener(eventName, this.handleBackdropDismissEvent, true);
		}
	}

	private removeBackdropDismissGuard(): void {
		for (const eventName of EPUB_AI_READING_BACKDROP_EVENTS) {
			this.containerEl.removeEventListener(eventName, this.handleBackdropDismissEvent, true);
		}
	}

	private preventBackdropDismiss(event: Event): void {
		const hostEl = this.getModalHostEl();
		const target = event.target;
		if (!hostEl || !(target instanceof Node) || hostEl.contains(target)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
	}

	private renderShell(): void {
		const header = this.contentEl.createDiv({ cls: "weave-epub-ai-reading-header" });
		header.addEventListener("mousedown", (event) => this.startModalDrag(event));
		const titleWrap = header.createDiv({ cls: "weave-epub-ai-reading-title-wrap" });
		const iconEl = titleWrap.createSpan({ cls: "weave-epub-ai-reading-icon" });
		setIcon(iconEl, "sparkles");
		titleWrap.createEl("h2", { text: "AI阅读" });
		const closeButton = header.createEl("button", {
			cls: "clickable-icon weave-epub-ai-reading-close",
			attr: { "aria-label": "关闭" },
		});
		setIcon(closeButton, "x");
		closeButton.addEventListener("click", () => this.close());

		this.statusEl = this.contentEl.createDiv({ cls: "weave-epub-ai-reading-status" });
		const meta = this.contentEl.createDiv({ cls: "weave-epub-ai-reading-meta" });
		meta.createEl("div", { text: this.input.bookTitle || "当前书籍" });
		meta.createEl("div", { text: this.input.chapterTitle || "当前章节" });
		if (this.input.sourceLink) {
			const sourceLink = meta.createEl("a", {
				cls: "weave-epub-ai-reading-source-link",
				text: "回到当前章节原文",
			});
			sourceLink.setAttribute("href", this.input.sourceLink);
			sourceLink.addEventListener("click", (event) => {
				this.openSourceLink(event);
			});
		}
		this.resultEl = this.contentEl.createDiv({ cls: "weave-epub-ai-reading-result" });
		this.resultEl.addEventListener("click", (event) => this.handleRenderedSourceLinkClick(event));
		this.actionsEl = this.contentEl.createDiv({ cls: "weave-epub-ai-reading-actions" });
		this.renderActions();
	}

	private setStatus(message: string): void {
		if (this.statusEl) {
			this.statusEl.textContent = message;
		}
	}

	private renderActions(): void {
		if (!this.actionsEl) {
			return;
		}
		this.actionsEl.empty();
		const regenerateButton = this.actionsEl.createEl("button", { text: "重新生成" });
		regenerateButton.addEventListener("click", () => {
			void this.generateReading();
		});
		if (this.noteFile) {
			const openNoteButton = this.actionsEl.createEl("button", { text: "打开笔记" });
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

	private async generateReading(): Promise<void> {
		this.result = null;
		this.noteFile = null;
		this.streamingPreviewEl = null;
		this.renderActions();
		this.setStatus("正在提取当前章节并请求 Kimi 生成 AI 阅读结果...");
		if (this.resultEl) {
			this.resultEl.empty();
			this.resultEl.createDiv({ text: "生成中..." });
		}

		try {
			this.result = await requestEpubAiReading(this.input, {
				app: this.app,
				configHost: this.configHost,
				envPathCandidates: this.envPathCandidates,
				onStage: (stage) => this.setStatus(stage),
				onPartialContent: (content) => this.renderStreamingPreview(content),
			});
			this.setStatus("已生成当前章节 AI 阅读结果。");
			await this.renderMarkdown(this.result.content);
		} catch (error) {
			logger.error("[EpubAiReadingModal] Failed to generate AI reading:", error);
			this.setStatus(error instanceof Error ? error.message : String(error));
			if (this.resultEl) {
				this.resultEl.empty();
				this.resultEl.createDiv({
					cls: "weave-epub-ai-reading-error",
					text: "AI 阅读生成失败，请检查 .env 中的 Kimi API Key、网络连接或模型配置。",
				});
			}
		} finally {
			this.renderActions();
		}
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
				this.resetMarkdownRenderComponent()
			);
		} catch (error) {
			logger.warn("[EpubAiReadingModal] Markdown rendering failed; showing raw result:", error);
			this.setStatus("AI 阅读已生成，但 Markdown 渲染失败，已显示原始结果。");
			this.resultEl.empty();
			this.resultEl.createEl("pre", {
				cls: "weave-epub-ai-reading-fallback",
				text: markdown,
			});
		}
	}

	private async renderMarkdownInto(markdown: string, targetEl: HTMLElement): Promise<void> {
		targetEl.empty();
		try {
			await MarkdownRenderer.render(
				this.app,
				markdown,
				targetEl,
				this.input.filePath,
				this.resetMarkdownRenderComponent()
			);
		} catch (error) {
			logger.warn("[EpubAiReadingModal] Markdown rendering failed; showing raw result:", error);
			this.setStatus(
				"AI \u9605\u8bfb\u5df2\u751f\u6210\uff0c\u4f46 Markdown \u6e32\u67d3\u5931\u8d25\uff0c\u5df2\u663e\u793a\u539f\u59cb\u7ed3\u679c\u3002"
			);
			targetEl.empty();
			targetEl.createEl("pre", {
				cls: "weave-epub-ai-reading-fallback",
				text: markdown,
			});
		}
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
				item.match.test(heading.title)
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

		const orderedSections = EPUB_AI_READING_SECTION_DEFINITIONS
			.map((definition) => byKey.get(definition.key))
			.filter((section): section is EpubAiReadingSection => Boolean(section));
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
				cls: `weave-epub-ai-reading-tab${section.key === this.activeSectionKey ? " is-active" : ""}`,
				text: section.label,
				attr: {
					type: "button",
					"aria-pressed": section.key === this.activeSectionKey ? "true" : "false",
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
			Boolean(target.closest("button, a, input, textarea, select, [contenteditable='true']"))
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
		const nextLeft = this.dragState.originLeft + event.clientX - this.dragState.startX;
		const nextTop = this.dragState.originTop + event.clientY - this.dragState.startY;
		hostEl.style.left = `${Math.round(Math.min(Math.max(nextLeft, 0), maxLeft))}px`;
		hostEl.style.top = `${Math.round(Math.min(Math.max(nextTop, 0), maxTop))}px`;
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
			/^P\d{3}$/.test(label) ||
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
			logger.warn("[EpubAiReadingModal] Failed to open EPUB source link:", error);
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
			logger.error("[EpubAiReadingModal] Failed to open AI reading note:", error);
			new Notice(`AI 阅读笔记打开失败：${error instanceof Error ? error.message : String(error)}`);
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
			this.renderActions();
		} catch (error) {
			logger.error("[EpubAiReadingModal] Failed to write AI reading note:", error);
			new Notice(`AI 阅读笔记生成失败：${error instanceof Error ? error.message : String(error)}`);
		}
	}
}
