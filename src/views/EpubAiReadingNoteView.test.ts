import { describe, expect, it, vi } from "vitest";

function enhanceElement<T extends HTMLElement>(el: T): T {
	const enhanced = el as T & {
		empty: () => void;
		addClass: (...classes: string[]) => void;
		createDiv: (options?: { cls?: string; text?: string }) => HTMLDivElement;
		createEl: (tag: string, options?: { cls?: string; text?: string }) => HTMLElement;
		createSpan: (options?: { cls?: string; text?: string }) => HTMLSpanElement;
	};
	enhanced.empty = () => {
		enhanced.innerHTML = "";
	};
	enhanced.addClass = (...classes: string[]) => {
		enhanced.classList.add(...classes);
	};
	enhanced.createDiv = (options = {}) => {
		const child = enhanceElement(document.createElement("div"));
		if (options.cls) {
			child.className = options.cls;
		}
		if (options.text) {
			child.textContent = options.text;
		}
		enhanced.append(child);
		return child;
	};
	enhanced.createEl = (tag, options = {}) => {
		const child = enhanceElement(document.createElement(tag));
		if (options.cls) {
			child.className = options.cls;
		}
		if (options.text) {
			child.textContent = options.text;
		}
		enhanced.append(child);
		return child;
	};
	enhanced.createSpan = (options = {}) => {
		const child = enhanceElement(document.createElement("span"));
		if (options.cls) {
			child.className = options.cls;
		}
		if (options.text) {
			child.textContent = options.text;
		}
		enhanced.append(child);
		return child;
	};
	return enhanced;
}

vi.mock("obsidian", () => ({
	Component: class MockComponent {
		unload(): void {}
	},
	ItemView: class MockItemView {
		app: unknown;
		contentEl = enhanceElement(document.createElement("div"));
		constructor(public leaf: { app?: unknown }) {
			this.app = leaf.app;
		}
		async setState(): Promise<void> {}
	},
	MarkdownRenderer: { render: vi.fn(async () => undefined) },
	TFile: class MockTFile {},
	WorkspaceLeaf: class MockWorkspaceLeaf {},
	normalizePath: (value: string) => value,
}));

import { TFile } from "obsidian";
import { EPUB_AI_READING_ALL_SCOPE_ID } from "../services/epub/epub-ai-reading-scope";
import { EPUB_AI_READING_REQUEST_EVENT } from "../services/epub/epub-ai-reading";
import { registerEpubHost, unregisterEpubHost } from "../services/epub/epub-host";
import { collectAiReadingNoteSectionTitleOptions, EpubAiReadingNoteView } from "./EpubAiReadingNoteView";

describe("collectAiReadingNoteSectionTitleOptions", () => {
	it("excludes range headings from type filter options", () => {
		const markdown = [
			"## 第五章：图像处理 > 图像对齐 > 操作指南...",
			"### 小节摘要",
			"summary",
			"### 核心结论",
			"core",
			"## U191 第五章：图像处理 > 图像对齐 > 操作指南...",
			"### 关键知识点",
			"knowledge",
			"## 第 9 章：优化 PDF 文件",
			"### 重要原文与解读",
			"quotes",
		].join("\n");

		expect(collectAiReadingNoteSectionTitleOptions([markdown])).toEqual([
			"小节摘要",
			"核心结论",
			"关键知识点",
			"重要原文与解读",
		]);
	});
});

describe("EpubAiReadingNoteView dual-window action", () => {
	function createApp(markdown: string, openEpubAiReadingNote = vi.fn()) {
		const noteFile = Object.assign(Object.create(TFile.prototype), {
			path: "AI阅读笔记/demo - AI阅读.md",
		});
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn(() => noteFile),
				cachedRead: vi.fn(async () => markdown),
			},
		} as any;
		registerEpubHost(app, {
			openEpubAiReadingNote,
			loadPublicationTocItems: vi.fn(async () => []),
		});
		return { app, openEpubAiReadingNote };
	}

	it("shows a dual-window button for normal AI reading note views", async () => {
		const { app, openEpubAiReadingNote } = createApp(
			'<div data-source-file="Books/demo.epub"></div>\n## 范围\n正文'
		);
		const view = new EpubAiReadingNoteView({ app } as any);

		await view.setState({
			bookId: "book-1",
			notePath: "AI阅读笔记/demo - AI阅读.md",
			sourceFile: "Books/demo.epub",
		}, {});

		const button = view.contentEl.querySelector<HTMLButtonElement>(
			".weave-epub-ai-reading-note-view__dual-window-button"
		);
		expect(button?.textContent).toBe("双窗模式");

		button?.click();
		expect(openEpubAiReadingNote).toHaveBeenCalledWith({
			bookId: "book-1",
			notePath: "AI阅读笔记/demo - AI阅读.md",
			sourceFile: "Books/demo.epub",
			openMode: "right-split",
			dualWindowMode: true,
			focus: false,
		});

		unregisterEpubHost(app);
	});

	it("hides the dual-window button after the AI reading note is already in dual-window mode", async () => {
		const { app } = createApp('<div data-source-file="Books/demo.epub"></div>\n## 范围\n正文');
		const view = new EpubAiReadingNoteView({ app } as any);

		await view.setState({
			bookId: "book-1",
			notePath: "AI阅读笔记/demo - AI阅读.md",
			sourceFile: "Books/demo.epub",
			dualWindowMode: true,
		}, {});

		expect(
			view.contentEl.querySelector(".weave-epub-ai-reading-note-view__dual-window-button")
		).toBeNull();

		unregisterEpubHost(app);
	});
});

describe("EpubAiReadingNoteView empty ranges", () => {
	function createApp(markdown: string, tocItems: any[] = []) {
		const noteFile = Object.assign(Object.create(TFile.prototype), {
			path: "AI-notes/demo - AI.md",
		});
		const openEpubReader = vi.fn(async () => undefined);
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn(() => noteFile),
				cachedRead: vi.fn(async () => markdown),
			},
		} as any;
		registerEpubHost(app, {
			openEpubReader,
			loadPublicationTocItems: vi.fn(async () => tocItems),
		});
		return { app, openEpubReader };
	}

	it("keeps a start action when the AI reading note has no generated ranges yet", async () => {
		const { app, openEpubReader } = createApp(
			[
				"# Demo - AI",
				"",
				'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-empty="true"></div>',
				"",
				'<button class="weave-epub-ai-reading-start" type="button" data-weave-ai-reading-action="start" data-source-file="Books/demo.epub">Start</button>',
			].join("\n"),
		);
		const view = new EpubAiReadingNoteView({ app } as any);
		const listener = vi.fn();
		window.addEventListener(EPUB_AI_READING_REQUEST_EVENT, listener);

		await view.setState({
			notePath: "AI-notes/demo - AI.md",
		}, {});

		const startButton = view.contentEl.querySelector<HTMLButtonElement>(
			".weave-epub-ai-reading-note-view__start-button",
		);
		expect(startButton).not.toBeNull();
		expect(view.contentEl.querySelector(".weave-epub-ai-reading-note-view__empty")?.textContent)
			.toContain("AI");

		startButton?.click();

		expect(listener).toHaveBeenCalled();
		expect(openEpubReader).toHaveBeenCalledWith("Books/demo.epub");

		window.removeEventListener(EPUB_AI_READING_REQUEST_EVENT, listener);
		unregisterEpubHost(app);
	});

	it("requests generation with dual-window open context from a dual-window empty range", async () => {
		const { app } = createApp(
			[
				"# Demo - AI",
				"",
				'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-empty="true"></div>',
			].join("\n"),
		);
		const view = new EpubAiReadingNoteView({ app } as any);
		const listener = vi.fn();
		window.addEventListener(EPUB_AI_READING_REQUEST_EVENT, listener);

		await view.setState({
			bookId: "book-1",
			notePath: "AI-notes/demo - AI.md",
			sourceFile: "Books/demo.epub",
			dualWindowMode: true,
		}, {});

		view.contentEl
			.querySelector<HTMLButtonElement>(".weave-epub-ai-reading-note-view__start-button")
			?.click();

		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({
				detail: expect.objectContaining({
					filePath: "Books/demo.epub",
					openNoteOptions: {
						bookId: "book-1",
						dualWindowMode: true,
						openMode: "right-split",
						focus: false,
					},
				}),
			}),
		);

		window.removeEventListener(EPUB_AI_READING_REQUEST_EVENT, listener);
		unregisterEpubHost(app);
	});

	it("shows a start action for a selected TOC range that has not been generated", async () => {
		const { app } = createApp(
			[
				"# Demo - AI",
				"",
				"## Chapter 5 > Existing",
				'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Existing" data-scope-href="chapter5.xhtml#existing"></div>',
				"",
				"### Summary",
				"Generated content.",
			].join("\n"),
			[
				{
					id: "chapter-4",
					label: "Chapter 4",
					href: "chapter4.xhtml",
					subitems: [{ id: "missing", label: "Missing section", href: "chapter4.xhtml#missing" }],
				},
				{
					id: "chapter-5",
					label: "Chapter 5",
					href: "chapter5.xhtml",
					subitems: [{ id: "existing", label: "Existing", href: "chapter5.xhtml#existing" }],
				},
			],
		);
		const view = new EpubAiReadingNoteView({ app } as any);

		await view.setState({
			notePath: "AI-notes/demo - AI.md",
			sourceFile: "Books/demo.epub",
			selectedScopeIds: ["chapter-4", "missing", EPUB_AI_READING_ALL_SCOPE_ID],
		}, {});

		expect(
			view.contentEl.querySelector(".weave-epub-ai-reading-note-view__start-button"),
		).not.toBeNull();
		expect(view.contentEl.querySelector(".weave-epub-ai-reading-note-view__range")).toBeNull();

		unregisterEpubHost(app);
	});

	it("does not offer to start AI reading when only the type filter hides existing content", async () => {
		const { app } = createApp(
			[
				"# Demo - AI",
				"",
				"## Chapter 5 > Existing",
				'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Existing" data-scope-href="chapter5.xhtml#existing"></div>',
				"",
				"### Summary",
				"Generated content.",
			].join("\n"),
			[
				{
					id: "chapter-5",
					label: "Chapter 5",
					href: "chapter5.xhtml",
					subitems: [{ id: "existing", label: "Existing", href: "chapter5.xhtml#existing" }],
				},
			],
		);
		const view = new EpubAiReadingNoteView({ app } as any);

		await view.setState({
			notePath: "AI-notes/demo - AI.md",
			sourceFile: "Books/demo.epub",
			selectedScopeIds: [EPUB_AI_READING_ALL_SCOPE_ID],
			searchText: "unmatched query",
		}, {});

		expect(view.contentEl.querySelector(".weave-epub-ai-reading-note-view__start-button")).toBeNull();
		expect(view.contentEl.querySelector(".weave-epub-ai-reading-note-view__empty")?.textContent)
			.toContain("AI");

		unregisterEpubHost(app);
	});
});
