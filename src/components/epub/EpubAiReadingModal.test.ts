import { waitFor } from "@testing-library/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, MarkdownRenderer } from "obsidian";
import { EpubAiReadingModal } from "./EpubAiReadingModal";
import { requestEpubAiReading } from "../../services/epub/epub-ai-reading";

vi.mock("../../services/epub/epub-ai-reading", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../services/epub/epub-ai-reading")>();
	return {
		...actual,
		requestEpubAiReading: vi.fn(),
	};
});

const mockedRequestEpubAiReading = vi.mocked(requestEpubAiReading);
const mockedMarkdownRender = vi.mocked(MarkdownRenderer.render);

describe("EpubAiReadingModal", () => {
	beforeEach(() => {
		mockedRequestEpubAiReading.mockReset();
		mockedMarkdownRender.mockClear();
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
