import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { TocItem } from "../types";
import {
	buildEpubAiReadingMessages,
	buildEpubAiReadingNoteMarkdown,
	buildEpubAiReadingNoteSection,
	extractKimiChatCompletionText,
	parseEpubAiReadingEnv,
	requestEpubAiReading,
	upsertEpubAiReadingNote,
} from "../epub-ai-reading";

const tocItems: TocItem[] = [
	{
		id: "part-1",
		label: "第一部分 基础",
		href: "text/part1.xhtml",
		level: 1,
		subitems: [
			{
				id: "chapter-1",
				label: "第一章 注意力",
				href: "text/chapter1.xhtml",
				level: 2,
			},
		],
	},
	{
		id: "chapter-2",
		label: "第二章 信息过载",
		href: "text/chapter2.xhtml",
		level: 1,
	},
];

function createMemoryApp(initialFiles: Record<string, string> = {}) {
	const files = new Map(Object.entries(initialFiles));
	const createVaultFile = (path: string) =>
		Object.assign(Object.create(TFile.prototype), {
			path,
			name: path.split("/").pop() || path,
			basename: (path.split("/").pop() || path).replace(/\.md$/i, ""),
			extension: path.split(".").pop() || "",
			stat: { size: files.get(path)?.length || 0 },
		});
	const app = {
		vault: {
			configDir: ".obsidian",
			adapter: {
				mkdir: vi.fn(async () => undefined),
				exists: vi.fn(async (path: string) => {
					if (files.has(path)) {
						return true;
					}
					const prefix = path.replace(/\/+$/, "") + "/";
					return Array.from(files.keys()).some((filePath) => filePath.startsWith(prefix));
				}),
				read: vi.fn(async (path: string) => files.get(path) || ""),
			},
			getAbstractFileByPath: vi.fn((path: string) =>
				files.has(path) ? createVaultFile(path) : null
			),
			create: vi.fn(async (path: string, content: string) => {
				files.set(path, content);
				return createVaultFile(path);
			}),
			modify: vi.fn(async (file: TFile, content: string) => {
				files.set(file.path, content);
			}),
			read: vi.fn(async (file: TFile) => files.get(file.path) || ""),
		},
		workspace: {
			getLeaf: vi.fn(() => ({
				openFile: vi.fn(async () => undefined),
			})),
		},
		metadataCache: {
			getFirstLinkpathDest: vi.fn(),
		},
	} as unknown as App;

	return { app, files };
}

describe("epub-ai-reading", () => {
	it("builds chapter reading messages with chapter text and the book TOC", () => {
		const messages = buildEpubAiReadingMessages({
			bookTitle: "认知之书",
			author: "作者甲",
			filePath: "Books/demo.epub",
			chapterTitle: "第一章 注意力",
			chapterHref: "text/chapter1.xhtml",
			chapterText: "注意力是一种有限资源。本章讨论注意力如何被信息环境消耗。",
			tocItems,
			sourceLink: "obsidian://weave-reader?book=demo",
		});

		expect(messages.system).toContain("EPUB AI 阅读助手");
		expect(messages.user).toContain("认知之书");
		expect(messages.user).toContain("第一部分 基础 > 第一章 注意力");
		expect(messages.user).toContain("第二章 信息过载");
		expect(messages.user).toContain("注意力是一种有限资源");
		expect(messages.user).toContain("重要原文");
	});

	it("extracts assistant content from a Kimi chat completion response", () => {
		const text = extractKimiChatCompletionText({
			choices: [
				{
					message: {
						content: "这是 AI 阅读结果",
					},
				},
			],
		});

		expect(text).toBe("这是 AI 阅读结果");
	});

	it("parses local env configuration without requiring build-time injection", () => {
		const env = parseEpubAiReadingEnv(`
			# local only
			KIMI_API_KEY="runtime-key"
			KIMI_MODEL=kimi-k3
			export KIMI_API_BASE_URL=https://api.moonshot.ai/v1
		`);

		expect(env.KIMI_API_KEY).toBe("runtime-key");
		expect(env.KIMI_MODEL).toBe("kimi-k3");
		expect(env.KIMI_API_BASE_URL).toBe("https://api.moonshot.ai/v1");
	});

	it("requests a Kimi reading result with the configured chat completions endpoint", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content: "# 本章摘要\n内容总结",
						},
					},
				],
			},
		}));

		const result = await requestEpubAiReading(
			{
				bookTitle: "认知之书",
				filePath: "Books/demo.epub",
				chapterTitle: "第一章 注意力",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "完整章节正文",
				tocItems,
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.moonshot.ai/v1",
					model: "kimi-k3",
				},
				requester,
				now: () => 1710000000000,
			}
		);

		expect(result.content).toContain("本章摘要");
		expect(result.model).toBe("kimi-k3");
		expect(requester).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://api.moonshot.ai/v1/chat/completions",
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer test-key",
				}),
			})
		);
	});

	it("uses Kimi Code compatible generation options for the coding endpoint", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content: "AI reading result",
						},
					},
				],
			},
		}));

		await requestEpubAiReading(
			{
				bookTitle: "Demo",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Complete chapter text",
				tocItems,
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.kimi.com/coding/v1",
					model: "k3",
				},
				requester,
			}
		);

		const request = requester.mock.calls[0]?.[0];
		const body = JSON.parse(String(request.body));
		expect(request.url).toBe("https://api.kimi.com/coding/v1/chat/completions");
		expect(body.temperature).toBe(1);
		expect(body.max_tokens).toBe(4096);
	});

	it("emits stage updates while preparing and requesting AI reading", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content: "AI reading result",
						},
					},
				],
			},
		}));
		const stages: string[] = [];

		await requestEpubAiReading(
			{
				bookTitle: "Demo",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Complete chapter text",
				tocItems,
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.kimi.com/coding/v1",
					model: "k3",
				},
				requester,
				onStage: (stage) => stages.push(stage),
				enableStreaming: false,
			}
		);

		expect(stages).toEqual([
			"正在读取 AI 配置",
			"正在整理章节结构",
			"正在打包发送给 AI",
			"AI 正在整理阅读结果",
		]);
	});

	it("streams partial AI reading content from an SSE chat completion response", async () => {
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					encoder.encode('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n')
				);
				controller.enqueue(
					encoder.encode('data: {"choices":[{"delta":{"content":"第二段"}}]}\n\n')
				);
				controller.enqueue(encoder.encode("data: [DONE]\n\n"));
				controller.close();
			},
		});
		const fetcher = vi.fn(async () => new Response(stream, { status: 200 }));
		const requester = vi.fn();
		const partials: string[] = [];

		const result = await requestEpubAiReading(
			{
				bookTitle: "Demo",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Complete chapter text",
				tocItems,
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.kimi.com/coding/v1",
					model: "k3",
				},
				requester,
				fetcher,
				onPartialContent: (content) => partials.push(content),
			}
		);

		expect(result.content).toBe("第一段第二段");
		expect(partials).toEqual(["第一段", "第一段第二段"]);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(requester).not.toHaveBeenCalled();
	});

	it("uses a runtime stream requester before falling back to requestUrl", async () => {
		const streamRequester = vi.fn(async (request) => {
			const body = JSON.parse(request.body);
			expect(request.url).toBe("https://api.kimi.com/coding/v1/chat/completions");
			expect(request.headers.Accept).toBe("text/event-stream");
			expect(body.stream).toBe(true);
			return "Node streaming result";
		});
		const requester = vi.fn();

		const result = await requestEpubAiReading(
			{
				bookTitle: "Demo",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Complete chapter text",
				tocItems,
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.kimi.com/coding/v1",
					model: "k3",
				},
				requester,
				streamRequester,
				onPartialContent: vi.fn(),
			}
		);

		expect(result.content).toBe("Node streaming result");
		expect(streamRequester).toHaveBeenCalledOnce();
		expect(requester).not.toHaveBeenCalled();
	});

	it("uses Kimi reasoning chunks only for stage updates", async () => {
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"hidden reasoning"}}]}\n\n')
				);
				controller.enqueue(
					encoder.encode('data: {"choices":[{"delta":{"content":"visible answer"}}]}\n\n')
				);
				controller.enqueue(encoder.encode("data: [DONE]\n\n"));
				controller.close();
			},
		});
		const stages: string[] = [];
		const partials: string[] = [];

		const result = await requestEpubAiReading(
			{
				bookTitle: "Demo",
				filePath: "Books/demo.epub",
				chapterTitle: "Chapter 1",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "Complete chapter text",
				tocItems,
			},
			{
				config: {
					apiKey: "test-key",
					baseUrl: "https://api.kimi.com/coding/v1",
					model: "k3",
				},
				requester: vi.fn(),
				fetcher: vi.fn(async () => new Response(stream, { status: 200 })),
				onStage: (stage) => stages.push(stage),
				onPartialContent: (content) => partials.push(content),
			}
		);

		expect(result.content).toBe("visible answer");
		expect(result.content).not.toContain("hidden reasoning");
		expect(partials).toEqual(["visible answer"]);
		expect(stages).toContain("AI \u6b63\u5728\u5206\u6790\u6b63\u6587\u548c\u7ae0\u8282\u5173\u7cfb");
		expect(stages).toContain("\u6b63\u5728\u6d41\u5f0f\u8f93\u51fa AI \u9605\u8bfb\u7ed3\u679c");
	});

	it("loads Kimi configuration from the plugin .env file at request time", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content: "# 本章摘要\n运行时配置可用",
						},
					},
				],
			},
		}));
		const { app } = createMemoryApp({
			".obsidian/plugins/weave-reader/.env": [
				"KIMI_API_KEY=runtime-key",
				"KIMI_API_BASE_URL=https://api.moonshot.ai/v1",
				"KIMI_MODEL=kimi-k3",
			].join("\n"),
		});

		await requestEpubAiReading(
			{
				bookTitle: "认知之书",
				filePath: "Books/demo.epub",
				chapterTitle: "第一章 注意力",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "完整章节正文",
				tocItems,
			},
			{ app, requester }
		);

		expect(requester).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://api.moonshot.ai/v1/chat/completions",
				headers: expect.objectContaining({
					Authorization: "Bearer runtime-key",
				}),
			})
		);
	});

	it("runs a local closed loop from runtime env to generated AI reading note", async () => {
		const requester = vi.fn(async () => ({
			json: {
				choices: [
					{
						message: {
							content: [
								"## 本章摘要",
								"本章说明注意力是一种有限资源。",
								"## 关键知识点",
								"- 信息环境会消耗注意力。",
								"## 重要原文",
								"- `注意力是一种有限资源`：这是本章论证的核心句。",
							].join("\n"),
						},
					},
				],
			},
		}));
		const { app, files } = createMemoryApp({
			".obsidian/plugins/weave-reader/.env": [
				"KIMI_API_KEY=runtime-key",
				"KIMI_API_BASE_URL=https://api.moonshot.ai/v1",
				"KIMI_MODEL=kimi-k3",
			].join("\n"),
		});

		const result = await requestEpubAiReading(
			{
				bookTitle: "认知之书",
				author: "作者甲",
				filePath: "Books/demo.epub",
				chapterTitle: "第一章 注意力",
				chapterHref: "text/chapter1.xhtml",
				chapterText: "注意力是一种有限资源。本章讨论注意力如何被信息环境消耗。",
				tocItems,
				sourceLink: "obsidian://weave-reader?book=demo",
			},
			{ app, requester, now: () => 1710000000000 }
		);
		const noteFile = await upsertEpubAiReadingNote(app, result);
		const note = files.get(noteFile.path) || "";

		expect(noteFile.path).toBe("AI阅读笔记/认知之书 - AI阅读.md");
		expect(note).toContain("# 认知之书 - AI阅读");
		expect(note).toContain("## 第一章 注意力");
		expect(note).toContain("## 本章摘要");
		expect(note).toContain("信息环境会消耗注意力");
		expect(note).toContain("obsidian://weave-reader?book=demo");
		expect(requester).toHaveBeenCalledOnce();
	});

	it("builds a note section with a stable chapter marker and source link", () => {
		const markdown = buildEpubAiReadingNoteSection({
			bookTitle: "认知之书",
			filePath: "Books/demo.epub",
			chapterTitle: "第一章 注意力",
			chapterHref: "text/chapter1.xhtml",
			sourceLink: "obsidian://weave-reader?book=demo",
			content: "# 本章摘要\n内容总结",
			model: "kimi-k3",
			generatedAt: 1710000000000,
		});

		expect(markdown).toContain("weave-epub-ai-reading:start");
		expect(markdown).toContain("## 第一章 注意力");
		expect(markdown).toContain("EPUB 跳转");
		expect(markdown).toContain("# 本章摘要");
	});

	it("updates an existing chapter section instead of appending duplicates", async () => {
		const initialSection = buildEpubAiReadingNoteSection({
			bookTitle: "认知之书",
			filePath: "Books/demo.epub",
			chapterTitle: "第一章 注意力",
			chapterHref: "text/chapter1.xhtml",
			content: "旧结果",
			model: "kimi-k3",
			generatedAt: 1710000000000,
		});
		const existingNote = buildEpubAiReadingNoteMarkdown({
			bookTitle: "认知之书",
			filePath: "Books/demo.epub",
			sectionsMarkdown: initialSection,
		});
		const { app, files } = createMemoryApp({
			"AI阅读笔记/认知之书 - AI阅读.md": existingNote,
		});

		await upsertEpubAiReadingNote(app, {
			bookTitle: "认知之书",
			filePath: "Books/demo.epub",
			chapterTitle: "第一章 注意力",
			chapterHref: "text/chapter1.xhtml",
			content: "新结果",
			model: "kimi-k3",
			generatedAt: 1710000001000,
		});

		const updated = files.get("AI阅读笔记/认知之书 - AI阅读.md") || "";
		expect(updated).toContain("新结果");
		expect(updated).not.toContain("旧结果");
		expect(updated.match(/weave-epub-ai-reading:start/g)).toHaveLength(1);
	});
});
