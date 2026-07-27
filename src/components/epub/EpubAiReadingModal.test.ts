import { waitFor } from "@testing-library/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, MarkdownRenderer, TFile } from "obsidian";
import { EpubAiReadingModal } from "./EpubAiReadingModal";
import {
	requestEpubAiReading,
	upsertEpubAiReadingNote,
} from "../../services/epub/epub-ai-reading";
import { EPUB_AI_READING_ALL_SCOPE_ID } from "../../services/epub/epub-ai-reading-scope";
import type { TocItem } from "../../services/epub/types";
import { openFileWithExistingLeaf } from "../../utils/workspace-navigation";

vi.mock("../../services/epub/epub-ai-reading", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../services/epub/epub-ai-reading")>();
	return {
		...actual,
		requestEpubAiReading: vi.fn(),
		upsertEpubAiReadingNote: vi.fn(),
	};
});

vi.mock("../../utils/workspace-navigation", () => ({
	openFileWithExistingLeaf: vi.fn(),
}));

const mockedRequestEpubAiReading = vi.mocked(requestEpubAiReading);
const mockedUpsertEpubAiReadingNote = vi.mocked(upsertEpubAiReadingNote);
const mockedOpenFileWithExistingLeaf = vi.mocked(openFileWithExistingLeaf);
const mockedMarkdownRender = vi.mocked(MarkdownRenderer.render);

function createMockFile(path: string): TFile {
	return Object.assign(Object.create(TFile.prototype), {
		path,
		name: path.split("/").pop() || path,
		basename: (path.split("/").pop() || path).replace(/\.md$/i, ""),
		extension: path.split(".").pop() || "",
		stat: { size: 0 },
	});
}

function createScopeToc(): TocItem[] {
	return [
		{
			id: "chapter-1",
			label: "第一章",
			href: "text/ch1.xhtml",
			level: 1,
			subitems: [
				{
					id: "tools",
					label: "准备你的 LaTeX 工具",
					href: "text/ch1.xhtml#tools",
					level: 2,
					subitems: [
						{
							id: "setup",
							label: "准备工作",
							href: "text/ch1.xhtml#setup",
							level: 3,
						},
					],
				},
			],
		},
	];
}

describe("EpubAiReadingModal", () => {
	beforeEach(() => {
		mockedRequestEpubAiReading.mockReset();
		mockedUpsertEpubAiReadingNote.mockReset();
		mockedOpenFileWithExistingLeaf.mockReset();
		mockedMarkdownRender.mockClear();
		vi.restoreAllMocks();
	});

	it("adds a host class to the outer Obsidian modal", () => {
		mockedRequestEpubAiReading.mockResolvedValue({
			bookTitle: "Demo Book",
			filePath: "Books/demo.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "text/chapter1.xhtml",
			content: "AI reading result",
			model: "k3",
			generatedAt: 1710000000000,
		});
		const modal = new EpubAiReadingModal(new App(), {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
			},
		});

		EpubAiReadingModal.prototype.onOpen.call(modal);

		expect((modal as unknown as { modalEl: HTMLElement }).modalEl.classList.contains(
			"weave-epub-ai-reading-modal-host"
		)).toBe(true);

		EpubAiReadingModal.prototype.onClose.call(modal);

		expect((modal as unknown as { modalEl: HTMLElement }).modalEl.classList.contains(
			"weave-epub-ai-reading-modal-host"
		)).toBe(false);
	});

	it("allows the Obsidian backdrop to close the modal", () => {
		mockedRequestEpubAiReading.mockResolvedValue({
			bookTitle: "Demo Book",
			filePath: "Books/demo.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "text/chapter1.xhtml",
			content: "AI reading result",
			model: "k3",
			generatedAt: 1710000000000,
		});
		const modal = new EpubAiReadingModal(new App(), {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
			},
		});
		const closeSpy = vi.spyOn(modal, "close");

		EpubAiReadingModal.prototype.onOpen.call(modal);
		modal.containerEl.addEventListener("click", () => modal.close());
		modal.containerEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(closeSpy).toHaveBeenCalled();
	});

	it("shows scope selection first when TOC scopes are provided", () => {
		mockedRequestEpubAiReading.mockResolvedValue({
			bookTitle: "Demo Book",
			filePath: "Books/demo.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "text/chapter1.xhtml",
			content: "AI reading result",
			model: "k3",
			generatedAt: 1710000000000,
		});
		const modal = new EpubAiReadingModal(new App(), {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
			},
			tocItems: createScopeToc(),
			initialScopeIds: ["chapter-1", "tools", "setup"],
			resolveScopedInput: vi.fn(),
		});

		EpubAiReadingModal.prototype.onOpen.call(modal);

		expect(mockedRequestEpubAiReading).not.toHaveBeenCalled();
		expect(modal.contentEl.textContent || "").toContain("选择 AI 阅读范围");
		expect(
			Array.from(modal.contentEl.querySelectorAll("button")).some(
				(button) => button.textContent === "开始 AI 阅读" && !button.disabled
			)
		).toBe(true);
	});

	it("keeps lower scope controls visible as disabled All after parent All", () => {
		const modal = new EpubAiReadingModal(new App(), {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
			},
			tocItems: createScopeToc(),
			initialScopeIds: ["chapter-1", EPUB_AI_READING_ALL_SCOPE_ID],
			resolveScopedInput: vi.fn(),
		});

		EpubAiReadingModal.prototype.onOpen.call(modal);

		const scopeControls = modal.contentEl.querySelectorAll<HTMLSelectElement>(
			".weave-epub-ai-reading-scope-select"
		);
		expect(scopeControls).toHaveLength(3);
		expect(scopeControls[1].value).toBe(EPUB_AI_READING_ALL_SCOPE_ID);
		expect(scopeControls[1].disabled).toBe(false);
		expect(scopeControls[2].value).toBe(EPUB_AI_READING_ALL_SCOPE_ID);
		expect(scopeControls[2].disabled).toBe(true);
	});

	it("groups scope controls in a compact controls area", () => {
		const modal = new EpubAiReadingModal(new App(), {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
			},
			tocItems: createScopeToc(),
			initialScopeIds: ["chapter-1", "tools", "setup"],
			resolveScopedInput: vi.fn(),
		});

		EpubAiReadingModal.prototype.onOpen.call(modal);

		const controls = modal.contentEl.querySelector(".weave-epub-ai-reading-scope-controls");
		expect(controls).not.toBeNull();
		expect(controls?.querySelectorAll(".weave-epub-ai-reading-scope-row")).toHaveLength(3);
	});

	it("disables generation for the full-book All placeholder", () => {
		const modal = new EpubAiReadingModal(new App(), {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
			},
			tocItems: createScopeToc(),
			initialScopeIds: [EPUB_AI_READING_ALL_SCOPE_ID],
			resolveScopedInput: vi.fn(),
		});

		EpubAiReadingModal.prototype.onOpen.call(modal);

		const startButton = Array.from(modal.contentEl.querySelectorAll("button")).find(
			(button) => button.textContent === "开始 AI 阅读"
		);
		expect(startButton?.disabled).toBe(true);
		expect(modal.contentEl.textContent || "").toContain("全书 AI 阅读将在后续版本支持");
	});

	it("starts AI reading with the selected TOC scope input", async () => {
		const resolveScopedInput = vi.fn(async () => ({
			bookTitle: "Demo Book",
			filePath: "Books/scoped.epub",
			chapterTitle: "准备工作",
			chapterHref: "text/ch1.xhtml#setup",
			chapterText: "Scoped text",
			tocItems: createScopeToc(),
		}));
		mockedRequestEpubAiReading.mockResolvedValue({
			bookTitle: "Demo Book",
			filePath: "Books/scoped.epub",
			chapterTitle: "准备工作",
			chapterHref: "text/ch1.xhtml#setup",
			content: "scoped AI reading result",
			model: "k3",
			generatedAt: 1710000000000,
		});
		const modal = new EpubAiReadingModal(new App(), {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/scoped.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/ch1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
			},
			tocItems: createScopeToc(),
			initialScopeIds: ["chapter-1", "tools", "setup"],
			resolveScopedInput,
		});

		EpubAiReadingModal.prototype.onOpen.call(modal);
		Array.from(modal.contentEl.querySelectorAll("button"))
			.find((button) => button.textContent === "开始 AI 阅读")
			?.click();

		await waitFor(() => {
			expect(resolveScopedInput).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "toc",
					label: "准备工作",
					href: "text/ch1.xhtml#setup",
					flatIndex: 2,
				})
			);
			expect(mockedRequestEpubAiReading).toHaveBeenCalledWith(
				expect.objectContaining({
					chapterTitle: "准备工作",
					chapterHref: "text/ch1.xhtml#setup",
					chapterText: "Scoped text",
				}),
				expect.any(Object)
			);
			expect(modal.contentEl.textContent || "").toContain("scoped AI reading result");
		});
	});

	it("restores an in-progress scoped generation after the modal is closed", async () => {
		const app = new App();
		let finishGeneration!: () => void;
		const pendingGeneration = new Promise<void>((resolve) => {
			finishGeneration = resolve;
		});
		const resolveScopedInput = vi.fn(async () => ({
			bookTitle: "Demo Book",
			filePath: "Books/scoped-resume.epub",
			chapterTitle: "准备工作",
			chapterHref: "text/ch1.xhtml#setup",
			chapterText: "Scoped text",
			tocItems: createScopeToc(),
		}));
		mockedRequestEpubAiReading.mockImplementation(async (_input, options) => {
			const hooks = options as {
				onStage?: (message: string) => void;
				onPartialContent?: (content: string) => void;
			};
			hooks.onStage?.("AI 正在整理所选范围");
			hooks.onPartialContent?.("流式片段 A");
			await pendingGeneration;
			return {
				bookTitle: "Demo Book",
				filePath: "Books/scoped-resume.epub",
				chapterTitle: "准备工作",
				chapterHref: "text/ch1.xhtml#setup",
				content: "恢复后的最终结果",
				model: "k3",
				generatedAt: 1710000000000,
			};
		});
		const options = {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/scoped-resume.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/ch1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
			},
			tocItems: createScopeToc(),
			initialScopeIds: ["chapter-1", "tools", "setup"],
			resolveScopedInput,
		};
		const firstModal = new EpubAiReadingModal(app, options);

		EpubAiReadingModal.prototype.onOpen.call(firstModal);
		Array.from(firstModal.contentEl.querySelectorAll("button"))
			.find((button) => button.textContent === "开始 AI 阅读")
			?.click();

		await waitFor(() => {
			expect(firstModal.contentEl.textContent || "").toContain("流式片段 A");
		});
		EpubAiReadingModal.prototype.onClose.call(firstModal);

		const secondModal = new EpubAiReadingModal(app, options);

		EpubAiReadingModal.prototype.onOpen.call(secondModal);

		await waitFor(() => {
			expect(secondModal.contentEl.textContent || "").toContain("AI 正在整理所选范围");
			expect(secondModal.contentEl.textContent || "").toContain("流式片段 A");
		});
		expect(mockedRequestEpubAiReading).toHaveBeenCalledTimes(1);

		finishGeneration();

		await waitFor(() => {
			expect(secondModal.contentEl.textContent || "").toContain("恢复后的最终结果");
		});
		expect(mockedRequestEpubAiReading).toHaveBeenCalledTimes(1);
	});

	it("restores an unsaved AI reading result when reopening the same chapter", async () => {
		const app = new App();
		const input = {
			bookTitle: "Session Book",
			filePath: "Books/session-restore.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "text/chapter1.xhtml",
			chapterText: "Chapter text",
			tocItems: [],
		};
		mockedRequestEpubAiReading.mockResolvedValue({
			bookTitle: input.bookTitle,
			filePath: input.filePath,
			chapterTitle: input.chapterTitle,
			chapterHref: input.chapterHref,
			content: "cached same chapter result",
			model: "k3",
			generatedAt: 1710000000000,
		});
		const firstModal = new EpubAiReadingModal(app, { input });

		EpubAiReadingModal.prototype.onOpen.call(firstModal);

		await waitFor(() => {
			expect(firstModal.contentEl.textContent || "").toContain("cached same chapter result");
		});
		EpubAiReadingModal.prototype.onClose.call(firstModal);

		const secondModal = new EpubAiReadingModal(app, { input });

		EpubAiReadingModal.prototype.onOpen.call(secondModal);

		await waitFor(() => {
			expect(secondModal.contentEl.textContent || "").toContain("cached same chapter result");
			expect(secondModal.contentEl.textContent || "").toContain(
				"\u5df2\u6062\u590d\u4e0a\u6b21 AI \u9605\u8bfb\u7ed3\u679c"
			);
		});
		expect(mockedRequestEpubAiReading).toHaveBeenCalledTimes(1);
	});

	it("warns before generating another chapter when the previous result is not saved to a note", async () => {
		const app = new App();
		mockedRequestEpubAiReading
			.mockResolvedValueOnce({
				bookTitle: "Session Book",
				filePath: "Books/session-warning.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				content: "chapter one result",
				model: "k3",
				generatedAt: 1710000000000,
			})
			.mockResolvedValueOnce({
				bookTitle: "Session Book",
				filePath: "Books/session-warning.epub",
				chapterTitle: "Chapter 2",
				chapterHref: "text/chapter2.xhtml",
				content: "chapter two result",
				model: "k3",
				generatedAt: 1710000000001,
			});
		const firstModal = new EpubAiReadingModal(app, {
			input: {
				bookTitle: "Session Book",
				filePath: "Books/session-warning.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter one text",
				tocItems: [],
			},
		});

		EpubAiReadingModal.prototype.onOpen.call(firstModal);

		await waitFor(() => {
			expect(firstModal.contentEl.textContent || "").toContain("chapter one result");
		});
		EpubAiReadingModal.prototype.onClose.call(firstModal);

		const secondModal = new EpubAiReadingModal(app, {
			input: {
				bookTitle: "Session Book",
				filePath: "Books/session-warning.epub",
				chapterTitle: "Chapter 2",
				chapterHref: "text/chapter2.xhtml",
				chapterText: "Chapter two text",
				tocItems: [],
			},
		});

		EpubAiReadingModal.prototype.onOpen.call(secondModal);

		await waitFor(() => {
			expect(secondModal.contentEl.textContent || "").toContain(
				"\u4e0a\u4e00\u4efd AI \u9605\u8bfb\u7ed3\u679c\u5c1a\u672a\u751f\u6210/\u66f4\u65b0\u7b14\u8bb0"
			);
		});
		expect(mockedRequestEpubAiReading).toHaveBeenCalledTimes(2);
	});

	it("renders returned AI markdown with an Obsidian component host", async () => {
		mockedRequestEpubAiReading.mockResolvedValue({
			bookTitle: "Demo Book",
			filePath: "Books/demo.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "text/chapter1.xhtml",
			content: "## 本章摘要\nAI 阅读结果",
			model: "k3",
			generatedAt: 1710000000000,
		});
		const modal = new EpubAiReadingModal(new App(), {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
			},
		});

		EpubAiReadingModal.prototype.onOpen.call(modal);

		await waitFor(() => {
			expect(mockedMarkdownRender).toHaveBeenCalled();
			expect(modal.contentEl.textContent || "").toContain("AI 阅读结果");
			expect(modal.contentEl.textContent || "").not.toContain("AI 阅读生成失败");
		});
		const renderHost = mockedMarkdownRender.mock.calls[0]?.[4];
		expect(renderHost).not.toBe(modal);
		expect(typeof renderHost?.addChild).toBe("function");
	});

	it("renders section tabs for structured AI reading markdown", async () => {
		mockedRequestEpubAiReading.mockResolvedValue({
			bookTitle: "Demo Book",
			filePath: "Books/demo.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "text/chapter1.xhtml",
			content: [
				"## \u672c\u7ae0\u6458\u8981",
				"\u6458\u8981\u5185\u5bb9",
				"## \u5173\u952e\u77e5\u8bc6\u70b9",
				"- \u77e5\u8bc6\u70b9",
				"## \u91cd\u8981\u539f\u6587",
				"[[Books/demo.epub#weave-cfi=epubcfi(/6/2)|P001]]",
				"## \u7ae0\u8282\u5173\u7cfb",
				"\u627f\u4e0a\u542f\u4e0b",
				"## \u5efa\u8bae\u7cbe\u8bfb\u987a\u5e8f",
				"1. \u5148\u8bfb\u5b9a\u4e49",
			].join("\n"),
			model: "k3",
			generatedAt: 1710000000000,
		});
		const modal = new EpubAiReadingModal(new App(), {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
			},
		});

		EpubAiReadingModal.prototype.onOpen.call(modal);

		await waitFor(() => {
			expect(modal.contentEl.querySelectorAll(".weave-epub-ai-reading-tab")).toHaveLength(5);
			expect(modal.contentEl.textContent || "").toContain("\u6458\u8981\u5185\u5bb9");
		});

		const tabs = modal.contentEl.querySelectorAll<HTMLButtonElement>(
			".weave-epub-ai-reading-tab"
		);
		tabs[2].click();

		await waitFor(() => {
			expect(modal.contentEl.textContent || "").toContain("P001");
			expect(
				modal.contentEl.querySelector(".weave-epub-ai-reading-tab.is-active")?.textContent || ""
			).toContain("\u91cd\u8981\u539f\u6587");
		});
	});

	it("keeps the AI result visible if markdown rendering fails", async () => {
		mockedRequestEpubAiReading.mockResolvedValue({
			bookTitle: "Demo Book",
			filePath: "Books/demo.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "text/chapter1.xhtml",
			content: "## 本章摘要\nAI 阅读结果",
			model: "k3",
			generatedAt: 1710000000000,
		});
		mockedMarkdownRender.mockRejectedValueOnce(new Error("render failed"));
		const modal = new EpubAiReadingModal(new App(), {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
			},
		});

		EpubAiReadingModal.prototype.onOpen.call(modal);

		await waitFor(() => {
			expect(modal.contentEl.textContent || "").toContain("AI 阅读结果");
			expect(modal.contentEl.textContent || "").toContain("Markdown 渲染失败");
			expect(modal.contentEl.textContent || "").not.toContain("Kimi API Key");
		});
	});

	it("renders a clickable source link when the chapter source link is available", async () => {
		mockedRequestEpubAiReading.mockResolvedValue({
			bookTitle: "Demo Book",
			filePath: "Books/demo.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "text/chapter1.xhtml",
			sourceLink: "obsidian://weave-epub?file=Books%2Fdemo.epub&cfi=epubcfi%28%2F6%2F2%29",
			content: "AI 阅读结果",
			model: "k3",
			generatedAt: 1710000000000,
		});
		const modal = new EpubAiReadingModal(new App(), {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
				sourceLink: "obsidian://weave-epub?file=Books%2Fdemo.epub&cfi=epubcfi%28%2F6%2F2%29",
			},
		});

		EpubAiReadingModal.prototype.onOpen.call(modal);

		const sourceLink = modal.contentEl.querySelector<HTMLAnchorElement>(
			".weave-epub-ai-reading-source-link"
		);
		expect(sourceLink?.textContent || "").toContain("回到当前章节原文");
		expect(sourceLink?.getAttribute("href")).toBe(
			"obsidian://weave-epub?file=Books%2Fdemo.epub&cfi=epubcfi%28%2F6%2F2%29"
		);
	});

	it("closes after opening the chapter source link", async () => {
		const sourceHref = "obsidian://weave-epub?file=Books%2Fdemo.epub&cfi=epubcfi%28%2F6%2F2%29";
		const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
		mockedRequestEpubAiReading.mockResolvedValue({
			bookTitle: "Demo Book",
			filePath: "Books/demo.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "text/chapter1.xhtml",
			sourceLink: sourceHref,
			content: "AI 阅读结果",
			model: "k3",
			generatedAt: 1710000000000,
		});
		const modal = new EpubAiReadingModal(new App(), {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
				sourceLink: sourceHref,
			},
		});
		const closeSpy = vi.spyOn(modal, "close");

		EpubAiReadingModal.prototype.onOpen.call(modal);
		modal.contentEl
			.querySelector<HTMLAnchorElement>(".weave-epub-ai-reading-source-link")
			?.click();

		expect(openSpy).toHaveBeenCalledWith(sourceHref, "_blank");
		expect(closeSpy).toHaveBeenCalled();
	});

	it("closes after a rendered paragraph source link is clicked", async () => {
		mockedMarkdownRender.mockImplementationOnce(async (_app, _markdown, containerEl) => {
			const link = document.createElement("a");
			link.textContent = "P001";
			containerEl.appendChild(link);
		});
		mockedRequestEpubAiReading.mockResolvedValue({
			bookTitle: "Demo Book",
			filePath: "Books/demo.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "text/chapter1.xhtml",
			content: "P001",
			model: "k3",
			generatedAt: 1710000000000,
		});
		const modal = new EpubAiReadingModal(new App(), {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
			},
		});
		const closeSpy = vi.spyOn(modal, "close");

		EpubAiReadingModal.prototype.onOpen.call(modal);

		await waitFor(() => {
			expect(modal.contentEl.querySelector("a")?.textContent).toBe("P001");
		});
		modal.contentEl.querySelector<HTMLAnchorElement>("a")?.click();

		await waitFor(() => {
			expect(closeSpy).toHaveBeenCalled();
		});
	});

	it("lets the user drag the modal from the header", () => {
		mockedRequestEpubAiReading.mockResolvedValue({
			bookTitle: "Demo Book",
			filePath: "Books/demo.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "text/chapter1.xhtml",
			content: "AI reading result",
			model: "k3",
			generatedAt: 1710000000000,
		});
		const modal = new EpubAiReadingModal(new App(), {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
			},
		});

		EpubAiReadingModal.prototype.onOpen.call(modal);
		const modalEl = (modal as unknown as { modalEl: HTMLElement }).modalEl;
		vi.spyOn(modalEl, "getBoundingClientRect").mockReturnValue({
			left: 100,
			top: 100,
			right: 500,
			bottom: 400,
			width: 400,
			height: 300,
			x: 100,
			y: 100,
			toJSON: () => ({}),
		});

		modal.contentEl
			.querySelector<HTMLElement>(".weave-epub-ai-reading-header")
			?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 120, clientY: 130 }));
		document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 170, clientY: 190 }));
		document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

		expect(modalEl.style.position).toBe("fixed");
		expect(modalEl.style.left).toBe("150px");
		expect(modalEl.style.top).toBe("160px");
	});

	it("shows an explicit open-note action after generating a note", async () => {
		const noteFile = createMockFile("AI阅读笔记/Demo Book - AI阅读.md");
		mockedUpsertEpubAiReadingNote.mockResolvedValue(noteFile);
		mockedRequestEpubAiReading.mockResolvedValue({
			bookTitle: "Demo Book",
			filePath: "Books/demo.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "text/chapter1.xhtml",
			content: "AI 阅读结果",
			model: "k3",
			generatedAt: 1710000000000,
		});
		const app = new App();
		const modal = new EpubAiReadingModal(app, {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
			},
		});

		EpubAiReadingModal.prototype.onOpen.call(modal);

		let createButton: HTMLButtonElement | undefined;
		await waitFor(() => {
			createButton = Array.from(modal.contentEl.querySelectorAll("button")).find(
				(button) => button.textContent === "生成并打开笔记"
			);
			expect(createButton?.disabled).toBe(false);
		});
		createButton!.click();

		await waitFor(() => {
			expect(mockedUpsertEpubAiReadingNote).toHaveBeenCalled();
			expect(mockedOpenFileWithExistingLeaf).toHaveBeenCalledWith(app, noteFile, {
				openInNewTab: true,
				focus: true,
			});
			expect(
				Array.from(modal.contentEl.querySelectorAll("button")).some(
					(button) => button.textContent === "打开笔记"
				)
			).toBe(true);
		});
	});

	it("shows stage text and partial AI content while generation is in progress", async () => {
		let finishGeneration!: () => void;
		const pendingGeneration = new Promise<void>((resolve) => {
			finishGeneration = resolve;
		});
		mockedRequestEpubAiReading.mockImplementation(async (_input, options) => {
			const hooks = options as {
				onStage?: (message: string) => void;
				onPartialContent?: (content: string) => void;
			};
			hooks.onStage?.("AI 正在整理阅读结果");
			hooks.onPartialContent?.("正在生成的片段");
			await pendingGeneration;
			return {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				content: "最终 AI 阅读结果",
				model: "k3",
				generatedAt: 1710000000000,
			};
		});
		const modal = new EpubAiReadingModal(new App(), {
			input: {
				bookTitle: "Demo Book",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Chapter text",
				tocItems: [],
			},
		});

		EpubAiReadingModal.prototype.onOpen.call(modal);

		await waitFor(() => {
			expect(modal.contentEl.textContent || "").toContain("AI 正在整理阅读结果");
			expect(modal.contentEl.textContent || "").toContain("正在生成的片段");
		});

		finishGeneration();

		await waitFor(() => {
			expect(modal.contentEl.textContent || "").toContain("最终 AI 阅读结果");
		});
	});
});
