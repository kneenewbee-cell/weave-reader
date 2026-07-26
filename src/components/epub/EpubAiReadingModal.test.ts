import { waitFor } from "@testing-library/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, MarkdownRenderer, TFile } from "obsidian";
import { EpubAiReadingModal } from "./EpubAiReadingModal";
import {
	requestEpubAiReading,
	upsertEpubAiReadingNote,
} from "../../services/epub/epub-ai-reading";
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
