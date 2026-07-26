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

	constructor(app: App, options: EpubAiReadingModalOptions) {
		super(app);
		this.input = options.input;
		this.configHost = options.configHost || null;
		this.envPathCandidates = options.envPathCandidates || [];
	}

	onOpen(): void {
		this.contentEl.empty();
		this.getModalHostEl()?.addClass("weave-epub-ai-reading-modal-host");
		this.contentEl.addClass("weave-epub-ai-reading-modal");
		this.renderShell();
		void this.generateReading();
	}

	onClose(): void {
		this.getModalHostEl()?.removeClass("weave-epub-ai-reading-modal-host");
		this.releaseMarkdownRenderComponent();
	}

	private getModalHostEl(): HTMLElement | null {
		return (this as Modal & { modalEl?: HTMLElement }).modalEl || this.containerEl || null;
	}

	private renderShell(): void {
		const header = this.contentEl.createDiv({ cls: "weave-epub-ai-reading-header" });
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
