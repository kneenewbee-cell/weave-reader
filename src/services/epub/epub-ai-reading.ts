import { TFile, normalizePath, requestUrl } from "obsidian";
import type { App } from "obsidian";
import { DirectoryUtils } from "../../utils/directory-utils";
import { sanitizeExportFileName } from "../../utils/sanitize-export-filename";
import type { AIConfig } from "../../types/plugin-settings";
import type { TocItem } from "./types";
import {
	decorateEpubAiReadingSourceReferences,
	formatEpubAiReadingSourceBlocksForPrompt,
	type EpubAiReadingSourceBlock,
} from "./epub-ai-reading-source-blocks";

export interface EpubAiReadingInput {
	bookTitle?: string;
	author?: string;
	filePath: string;
	chapterTitle: string;
	chapterHref: string;
	chapterText: string;
	chapterMarkdown?: string;
	tocItems: TocItem[];
	sourceLink?: string;
	sourceBlocks?: EpubAiReadingSourceBlock[];
	scopeContext?: string;
}

export interface EpubAiReadingConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	temperature: number;
	maxTokens: number;
}

export interface EpubAiReadingConfigHost {
	settings?: {
		aiConfig?: AIConfig;
	};
}

export interface EpubAiReadingResult {
	bookTitle?: string;
	author?: string;
	filePath: string;
	chapterTitle: string;
	chapterHref: string;
	sourceLink?: string;
	sourceBlocks?: EpubAiReadingSourceBlock[];
	content: string;
	model: string;
	generatedAt: number;
}

export interface EpubAiReadingRequestOptions {
	config?: Partial<EpubAiReadingConfig>;
	configHost?: EpubAiReadingConfigHost | null;
	app?: App;
	envPathCandidates?: string[];
	runtimeEnv?: Record<string, string | undefined>;
	requester?: EpubAiReadingRequester;
	fetcher?: EpubAiReadingFetch;
	streamRequester?: EpubAiReadingStreamRequester;
	enableStreaming?: boolean;
	onStage?: (message: string) => void;
	onPartialContent?: (content: string) => void;
	now?: () => number;
}

export interface EpubAiReadingNoteOptions {
	folderPath?: string;
}

type EpubAiReadingRequester = (request: {
	url: string;
	method: "POST";
	contentType: string;
	headers: Record<string, string>;
	body: string;
	throw: boolean;
}) => Promise<{
	json?: unknown;
	text?: string;
	status?: number;
}>;

type EpubAiReadingFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type EpubAiReadingStreamRequest = {
	url: string;
	headers: Record<string, string>;
	body: string;
};

type EpubAiReadingStreamRequester = (
	request: EpubAiReadingStreamRequest
) => Promise<string>;

type RuntimeRequire = (id: string) => unknown;

type NodeStreamingResponse = {
	statusCode?: number;
	setEncoding?: (encoding: string) => void;
	on: (
		event: "data" | "end" | "error",
		callback: (chunkOrError?: unknown) => void
	) => void;
};

type NodeStreamingRequest = {
	on: (event: "error", callback: (error: Error) => void) => void;
	write: (chunk: string) => void;
	end: () => void;
};

type NodeHttpModule = {
	request: (
		url: URL,
		options: { method: "POST"; headers: Record<string, string> },
		callback: (response: NodeStreamingResponse) => void
	) => NodeStreamingRequest;
};

type StreamingChatState = {
	content: string;
	contentStarted: boolean;
	reasoningStarted: boolean;
};

const DEFAULT_KIMI_BASE_URL = "https://api.moonshot.ai/v1";
const DEFAULT_KIMI_MODEL = "kimi-k3";
const DEFAULT_KIMI_TEMPERATURE = 0.3;
const DEFAULT_KIMI_CODE_TEMPERATURE = 1;
const DEFAULT_KIMI_MAX_TOKENS = 4096;
const DEFAULT_NOTE_FOLDER = "AI阅读笔记";

function normalizeConfigValue(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function getProcessEnv(): Record<string, string | undefined> {
	return (
		(globalThis as typeof globalThis & {
			process?: { env?: Record<string, string | undefined> };
		}).process?.env || {}
	);
}

function readEnvValue(env: Record<string, string | undefined>, keys: string[]): string {
	for (const key of keys) {
		const value = normalizeConfigValue(env[key]);
		if (value) {
			return value;
		}
	}
	return "";
}

function normalizeNumberValue(value: unknown): number | undefined {
	if (typeof value !== "number" && typeof value !== "string") {
		return undefined;
	}
	const parsed = Number(typeof value === "string" ? value.trim() : value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function readEnvNumberValue(
	env: Record<string, string | undefined>,
	keys: string[]
): number | undefined {
	for (const key of keys) {
		const value = normalizeNumberValue(env[key]);
		if (typeof value === "number") {
			return value;
		}
	}
	return undefined;
}

export function parseEpubAiReadingEnv(content: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const rawLine of String(content || "").split(/\r?\n/g)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) {
			continue;
		}
		const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
		const separatorIndex = normalized.indexOf("=");
		if (separatorIndex <= 0) {
			continue;
		}
		const key = normalized.slice(0, separatorIndex).trim();
		let value = normalized.slice(separatorIndex + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (key) {
			env[key] = value;
		}
	}
	return env;
}

function getEpubAiReadingEnvPathCandidates(app?: App, extraPaths: string[] = []): string[] {
	const configDir = normalizePath(normalizeConfigValue(app?.vault?.configDir) || ".obsidian");
	const candidates = [
		...extraPaths,
		`${configDir}/plugins/weave-reader/.env`,
		`${configDir}/plugins/weave-reader-epub/.env`,
		".env",
	];
	return Array.from(new Set(candidates.map((path) => normalizePath(path)).filter(Boolean)));
}

export async function loadEpubAiReadingRuntimeEnv(
	app?: App,
	envPathCandidates: string[] = []
): Promise<Record<string, string>> {
	const adapter = app?.vault?.adapter as
		| {
				exists?: (path: string) => Promise<boolean>;
				read?: (path: string) => Promise<string>;
		  }
		| undefined;
	if (!adapter?.read) {
		return {};
	}
	for (const path of getEpubAiReadingEnvPathCandidates(app, envPathCandidates)) {
		try {
			if (adapter.exists && !(await adapter.exists(path))) {
				continue;
			}
			const content = await adapter.read(path);
			const env = parseEpubAiReadingEnv(content);
			if (Object.keys(env).length > 0) {
				return env;
			}
		} catch {
			/* Try the next candidate. */
		}
	}
	return {};
}

type AIProviderConfig = {
	apiKey?: string;
	model?: string;
	baseUrl?: string;
};

function collectAIProviderConfigs(aiConfig?: AIConfig): AIProviderConfig[] {
	const apiKeys = (aiConfig?.apiKeys || {}) as Record<string, AIProviderConfig | undefined>;
	const preferredProviders = [
		"kimi",
		"moonshot",
		normalizeConfigValue(aiConfig?.lastUsedProvider),
		normalizeConfigValue(aiConfig?.defaultProvider),
		"openai",
	].filter(Boolean);
	const configs: AIProviderConfig[] = [];
	for (const provider of preferredProviders) {
		const config = apiKeys[provider];
		if (config) {
			configs.push(config);
		}
	}
	for (const config of Object.values(apiKeys)) {
		if (!config || configs.includes(config)) {
			continue;
		}
		const baseUrl = normalizeConfigValue(config.baseUrl).toLowerCase();
		const model = normalizeConfigValue(config.model).toLowerCase();
		if (baseUrl.includes("moonshot") || model.includes("kimi")) {
			configs.push(config);
		}
	}
	return configs;
}

export function resolveEpubAiReadingConfigFromHost(
	host?: EpubAiReadingConfigHost | null
): Partial<EpubAiReadingConfig> {
	for (const config of collectAIProviderConfigs(host?.settings?.aiConfig)) {
		const apiKey = normalizeConfigValue(config.apiKey);
		if (!apiKey) {
			continue;
		}
		return {
			apiKey,
			baseUrl: normalizeConfigValue(config.baseUrl) || DEFAULT_KIMI_BASE_URL,
			model: normalizeConfigValue(config.model) || DEFAULT_KIMI_MODEL,
		};
	}
	return {};
}

export function resolveEpubAiReadingConfig(
	overrides: Partial<EpubAiReadingConfig> = {},
	runtimeEnv: Record<string, string | undefined> = {}
): EpubAiReadingConfig {
	const env = { ...getProcessEnv(), ...runtimeEnv };
	const baseUrl =
		normalizeConfigValue(overrides.baseUrl) ||
		readEnvValue(env, [
			"KIMI_API_BASE_URL",
			"MOONSHOT_API_BASE_URL",
			"VITE_KIMI_API_BASE_URL",
			"VITE_MOONSHOT_API_BASE_URL",
		]) ||
		DEFAULT_KIMI_BASE_URL;
	const model =
		normalizeConfigValue(overrides.model) ||
		readEnvValue(env, [
			"KIMI_MODEL",
			"MOONSHOT_MODEL",
			"VITE_KIMI_MODEL",
			"VITE_MOONSHOT_MODEL",
		]) ||
		DEFAULT_KIMI_MODEL;
	const temperature =
		normalizeNumberValue(overrides.temperature) ??
		readEnvNumberValue(env, [
			"KIMI_TEMPERATURE",
			"MOONSHOT_TEMPERATURE",
			"VITE_KIMI_TEMPERATURE",
			"VITE_MOONSHOT_TEMPERATURE",
		]) ??
		getDefaultEpubAiReadingTemperature(baseUrl, model);
	const maxTokens =
		normalizeNumberValue(overrides.maxTokens) ??
		readEnvNumberValue(env, [
			"KIMI_MAX_TOKENS",
			"MOONSHOT_MAX_TOKENS",
			"VITE_KIMI_MAX_TOKENS",
			"VITE_MOONSHOT_MAX_TOKENS",
		]) ??
		DEFAULT_KIMI_MAX_TOKENS;

	return {
		apiKey:
			normalizeConfigValue(overrides.apiKey) ||
			readEnvValue(env, [
				"KIMI_API_KEY",
				"MOONSHOT_API_KEY",
				"VITE_KIMI_API_KEY",
				"VITE_MOONSHOT_API_KEY",
			]),
		baseUrl,
		model,
		temperature,
		maxTokens,
	};
}

function normalizeBaseUrl(baseUrl: string): string {
	const normalized = normalizeConfigValue(baseUrl) || DEFAULT_KIMI_BASE_URL;
	return normalized.replace(/\/+$/, "");
}

function isKimiCodeConfig(baseUrl: string, model: string): boolean {
	const normalizedBaseUrl = normalizeConfigValue(baseUrl).toLowerCase();
	const normalizedModel = normalizeConfigValue(model).toLowerCase();
	return (
		normalizedBaseUrl.includes("api.kimi.com/coding") ||
		normalizedModel === "k3" ||
		normalizedModel.startsWith("k3-")
	);
}

function getDefaultEpubAiReadingTemperature(baseUrl: string, model: string): number {
	return isKimiCodeConfig(baseUrl, model)
		? DEFAULT_KIMI_CODE_TEMPERATURE
		: DEFAULT_KIMI_TEMPERATURE;
}

function flattenTocItems(
	items: TocItem[],
	ancestors: string[] = [],
	lines: string[] = []
): string[] {
	for (const item of items || []) {
		const label = normalizeConfigValue(item.label) || "未命名章节";
		const path = [...ancestors, label];
		const href = normalizeConfigValue(item.href);
		lines.push(`${"  ".repeat(Math.max(item.level - 1, 0))}- ${path.join(" > ")}${href ? ` (${href})` : ""}`);
		if (Array.isArray(item.subitems) && item.subitems.length > 0) {
			flattenTocItems(item.subitems, path, lines);
		}
	}
	return lines;
}

function normalizeHrefForCompare(href: string): string {
	return normalizeConfigValue(href).split("#")[0] || normalizeConfigValue(href);
}

function findTocPath(
	items: TocItem[],
	chapterHref: string,
	ancestors: string[] = []
): string[] | null {
	const target = normalizeHrefForCompare(chapterHref);
	for (const item of items || []) {
		const label = normalizeConfigValue(item.label) || "未命名章节";
		const currentPath = [...ancestors, label];
		const itemHref = normalizeHrefForCompare(item.href);
		if (target && itemHref && target === itemHref) {
			return currentPath;
		}
		const childPath = findTocPath(item.subitems || [], chapterHref, currentPath);
		if (childPath) {
			return childPath;
		}
	}
	return null;
}

export function buildEpubAiReadingMessages(input: EpubAiReadingInput): {
	system: string;
	user: string;
} {
	const tocLines = flattenTocItems(input.tocItems).join("\n") || "- 暂无目录";
	const tocPath = findTocPath(input.tocItems, input.chapterHref)?.join(" > ") || input.chapterTitle;
	const chapterText = normalizeConfigValue(input.chapterMarkdown) || input.chapterText;
	const sourceLink = normalizeConfigValue(input.sourceLink);
	const sourceBlocks = Array.isArray(input.sourceBlocks) ? input.sourceBlocks : [];
	const sourceBlockText = formatEpubAiReadingSourceBlocksForPrompt(sourceBlocks);
	const scopeContext = normalizeConfigValue(input.scopeContext);
	const sourceReferenceRule = sourceBlockText
		? "\u8bf7\u5f15\u7528 P001 \u8fd9\u79cd\u6bb5\u843d\u7f16\u53f7\uff1b\u4e0d\u8981\u751f\u6210 EPUB CFI\u3001\u5185\u90e8\u951a\u70b9\u6216 URL\u3002"
		: "\u63d0\u53d6\u91cd\u8981\u539f\u6587\u65f6\uff0c\u7528\u201c\u4f4d\u7f6e\u8bf4\u660e + \u4e3a\u4ec0\u4e48\u91cd\u8981\u201d\u63cf\u8ff0\uff0c\u4e0d\u8981\u4f2a\u9020\u4e0d\u53ef\u70b9\u51fb\u7684\u951a\u70b9\u3002";
	const system = [
		"你是 EPUB AI 阅读助手。",
		"你帮助用户理解当前章节，但不能替代原文阅读。",
		"只基于用户提供的 EPUB 正文、章节标题和目录结构回答；不要编造书中没有的信息。",
		"输出中文 Markdown，结构清晰，保留可回到原文的线索。",
	].join("\n");
	const user = [
		"# 任务",
		"请对当前 EPUB 章节做 AI 阅读：总结、摘要、关键知识点、重要原文提取说明、概念解释、与前后章节或全书目录的关系、建议精读段落。",
		"",
		"# 输出格式",
		"## 本章摘要",
		"## 关键知识点",
		"## 重要原文",
		"- 用短摘录或位置描述列出值得回到 EPUB 精读的原文，并说明为什么重要。",
		"## 概念/术语",
		"## 章节关系",
		"## 建议精读顺序",
		"",
		"# 书籍信息",
		`- 书名：${normalizeConfigValue(input.bookTitle) || "未知书名"}`,
		`- 作者：${normalizeConfigValue(input.author) || "未知作者"}`,
		`- EPUB 文件：${normalizePath(input.filePath)}`,
		`- 当前章节：${normalizeConfigValue(input.chapterTitle) || "当前章节"}`,
		`- 当前章节路径：${tocPath}`,
		`- 当前章节 href：${normalizeConfigValue(input.chapterHref) || "未知"}`,
		sourceLink ? `- EPUB 跳转：${sourceLink}` : "",
		"",
		"# \u5b9a\u4f4d\u89c4\u5219",
		"\u53ef\u70b9\u51fb\u8df3\u8f6c\u7531\u9605\u8bfb\u5668\u754c\u9762\u63d0\u4f9b\uff1b\u4f60\u4e0d\u8981\u628a EPUB \u5185\u90e8\u951a\u70b9\uff08\u5982 #id\u3001#_idParaDest\uff09\u5199\u6210\u9700\u8981\u7528\u6237\u70b9\u51fb\u7684\u94fe\u63a5\u3002",
		sourceReferenceRule,
		scopeContext ? "" : "",
		scopeContext ? "# \u9605\u8bfb\u8303\u56f4\u4e0e\u5916\u90e8\u7ed3\u6784\u7ebf\u7d22" : "",
		scopeContext
			? "\u5916\u90e8\u7ebf\u7d22\u53ea\u7528\u4e8e\u7406\u89e3\u7ae0\u8282\u5173\u7cfb\u3001\u8de8\u7ae0\u5f15\u7528\u548c\u5efa\u8bae\u7cbe\u8bfb\u987a\u5e8f\uff1b\u6458\u8981\u3001\u77e5\u8bc6\u70b9\u548c\u91cd\u8981\u539f\u6587\u5fc5\u987b\u4ee5\u4e0b\u65b9\u201c\u7cbe\u8bfb\u8303\u56f4\u6b63\u6587\u201d\u4e3a\u4e3b\u3002"
			: "",
		scopeContext,
		sourceBlockText
			? "\u6458\u8981\u53ef\u4ee5\u7efc\u5408\u591a\u4e2a\u6bb5\u843d\uff0c\u4f46\u5173\u952e\u77e5\u8bc6\u70b9\u548c\u91cd\u8981\u539f\u6587\u5fc5\u987b\u5c3d\u91cf\u5e26\u6765\u6e90\u7f16\u53f7\uff0c\u4f8b\u5982 [P001]\u3002\u63d2\u4ef6\u4f1a\u628a\u6bb5\u843d\u7f16\u53f7\u8f6c\u6362\u6210\u53ef\u70b9\u51fb\u94fe\u63a5\u3002"
			: "",
		"",
		"# 全书目录",
		tocLines,
		"",
		sourceBlockText ? "# \u5f53\u524d\u7ae0\u8282\u5b9a\u4f4d\u6b63\u6587\u5757" : "# 当前章节正文",
		sourceBlockText || chapterText,
	].filter(Boolean).join("\n");

	return { system, user };
}

function readContentPart(part: unknown): string {
	if (typeof part === "string") {
		return part;
	}
	if (!part || typeof part !== "object") {
		return "";
	}
	const record = part as Record<string, unknown>;
	return typeof record.text === "string" ? record.text : "";
}

export function extractKimiChatCompletionText(response: unknown): string {
	if (!response || typeof response !== "object") {
		return "";
	}
	const choices = (response as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		return "";
	}
	const message = (choices[0] as { message?: { content?: unknown } }).message;
	const content = message?.content;
	if (typeof content === "string") {
		return content.trim();
	}
	if (Array.isArray(content)) {
		return content.map(readContentPart).join("").trim();
	}
	return "";
}

function emitAiReadingStage(
	options: EpubAiReadingRequestOptions,
	message: string
): void {
	try {
		options.onStage?.(message);
	} catch {
		/* Stage callbacks are UI-only and must not break generation. */
	}
}

function buildChatCompletionRequestBody(
	config: EpubAiReadingConfig,
	messages: ReturnType<typeof buildEpubAiReadingMessages>,
	options: { stream?: boolean } = {}
): Record<string, unknown> {
	return {
		model: config.model,
		messages: [
			{ role: "system", content: messages.system },
			{ role: "user", content: messages.user },
		],
		temperature: config.temperature,
		max_tokens: config.maxTokens,
		...(options.stream ? { stream: true } : {}),
	};
}

function getGlobalFetch(): EpubAiReadingFetch | null {
	const fetcher = (globalThis as typeof globalThis & { fetch?: EpubAiReadingFetch }).fetch;
	return typeof fetcher === "function" ? fetcher.bind(globalThis) : null;
}

function getRuntimeRequire(): RuntimeRequire | null {
	try {
		const runtimeRequire = Function(
			"return typeof require === 'function' ? require : undefined"
		)() as unknown;
		return typeof runtimeRequire === "function" ? (runtimeRequire as RuntimeRequire) : null;
	} catch {
		return null;
	}
}

function getNodeHttpModule(url: URL): NodeHttpModule | null {
	const runtimeRequire = getRuntimeRequire();
	if (!runtimeRequire) {
		return null;
	}
	const moduleName = url.protocol === "http:" ? "http" : "https";
	try {
		const httpModule = runtimeRequire(moduleName) as Partial<NodeHttpModule> | null;
		return httpModule && typeof httpModule.request === "function"
			? (httpModule as NodeHttpModule)
			: null;
	} catch {
		return null;
	}
}

function buildStreamingChatCompletionRequest(
	config: EpubAiReadingConfig,
	messages: ReturnType<typeof buildEpubAiReadingMessages>
): EpubAiReadingStreamRequest {
	return {
		url: `${normalizeBaseUrl(config.baseUrl)}/chat/completions`,
		headers: {
			Authorization: `Bearer ${config.apiKey}`,
			"Content-Type": "application/json",
			Accept: "text/event-stream",
		},
		body: JSON.stringify(buildChatCompletionRequestBody(config, messages, { stream: true })),
	};
}

function readStreamingDeltaText(payload: unknown): string {
	if (!payload || typeof payload !== "object") {
		return "";
	}
	const choices = (payload as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		return "";
	}
	const firstChoice = choices[0] as {
		delta?: { content?: unknown };
		message?: { content?: unknown };
	};
	const deltaContent = firstChoice.delta?.content;
	if (typeof deltaContent === "string") {
		return deltaContent;
	}
	const messageContent = firstChoice.message?.content;
	if (typeof messageContent === "string") {
		return messageContent;
	}
	if (Array.isArray(messageContent)) {
		return messageContent.map(readContentPart).join("");
	}
	return "";
}

function emitPartialAiReadingContent(
	options: EpubAiReadingRequestOptions,
	content: string
): void {
	try {
		options.onPartialContent?.(content);
	} catch {
		/* Partial callbacks are UI-only and must not break generation. */
	}
}

function createStreamingChatState(): StreamingChatState {
	return {
		content: "",
		contentStarted: false,
		reasoningStarted: false,
	};
}

function readStreamingReasoningText(payload: unknown): string {
	if (!payload || typeof payload !== "object") {
		return "";
	}
	const choices = (payload as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		return "";
	}
	const delta = (choices[0] as { delta?: { reasoning_content?: unknown } }).delta;
	return typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "";
}

function consumeStreamingChatCompletionLine(
	line: string,
	state: StreamingChatState,
	options: EpubAiReadingRequestOptions
): boolean {
	const trimmed = line.trim();
	if (!trimmed.startsWith("data:")) {
		return false;
	}
	const data = trimmed.slice("data:".length).trim();
	if (!data) {
		return false;
	}
	if (data === "[DONE]") {
		return true;
	}
	try {
		const payload = JSON.parse(data);
		const delta = readStreamingDeltaText(payload);
		if (delta) {
			if (!state.contentStarted) {
				state.contentStarted = true;
				emitAiReadingStage(options, "\u6b63\u5728\u6d41\u5f0f\u8f93\u51fa AI \u9605\u8bfb\u7ed3\u679c");
			}
			state.content += delta;
			emitPartialAiReadingContent(options, state.content);
		} else if (!state.reasoningStarted && readStreamingReasoningText(payload)) {
			state.reasoningStarted = true;
			emitAiReadingStage(options, "AI \u6b63\u5728\u5206\u6790\u6b63\u6587\u548c\u7ae0\u8282\u5173\u7cfb");
		}
	} catch {
		/* Ignore malformed SSE frames and continue reading. */
	}
	return false;
}

function formatAiReadingErrorReason(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error || "");
	return normalizeConfigValue(message).slice(0, 160) || "\u672a\u77e5\u539f\u56e0";
}

async function readStreamingChatCompletionText(
	response: Response,
	options: EpubAiReadingRequestOptions
): Promise<string> {
	if (!response.ok) {
		throw new Error(`Kimi API 请求失败：HTTP ${response.status}`);
	}
	if (!response.body?.getReader) {
		throw new Error("当前环境不支持流式读取 Kimi 响应。");
	}
	const decoder = new TextDecoder();
	const reader = response.body.getReader();
	let buffer = "";
	const state = createStreamingChatState();

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split(/\r?\n/g);
		buffer = lines.pop() || "";
		for (const line of lines) {
			if (consumeStreamingChatCompletionLine(line, state, options)) {
				return state.content.trim();
			}
		}
	}
	buffer += decoder.decode();
	for (const line of buffer.split(/\r?\n/g)) {
		if (consumeStreamingChatCompletionLine(line, state, options)) {
			break;
		}
	}
	return state.content.trim();
}

async function requestNodeStreamingChatCompletionText(
	request: EpubAiReadingStreamRequest,
	options: EpubAiReadingRequestOptions
): Promise<string> {
	const url = new URL(request.url);
	const httpModule = getNodeHttpModule(url);
	if (!httpModule) {
		throw new Error("\u5f53\u524d Obsidian \u8fd0\u884c\u65f6\u6ca1\u6709\u53ef\u7528\u7684 Node \u7f51\u7edc\u6d41\u901a\u9053\u3002");
	}

	return await new Promise<string>((resolve, reject) => {
		const decoder = new TextDecoder();
		const state = createStreamingChatState();
		let buffer = "";
		let errorBody = "";
		let settled = false;

		const finish = (callback: () => void): void => {
			if (settled) {
				return;
			}
			settled = true;
			callback();
		};

		const requestHandle = httpModule.request(
			url,
			{ method: "POST", headers: request.headers },
			(response) => {
				response.setEncoding?.("utf8");
				response.on("data", (chunk) => {
					if (settled) {
						return;
					}
					const text =
						typeof chunk === "string"
							? chunk
							: decoder.decode(chunk as Uint8Array, { stream: true });
					if (response.statusCode && response.statusCode >= 400) {
						errorBody += text;
						return;
					}
					buffer += text;
					const lines = buffer.split(/\r?\n/g);
					buffer = lines.pop() || "";
					for (const line of lines) {
						if (consumeStreamingChatCompletionLine(line, state, options)) {
							finish(() => resolve(state.content.trim()));
							return;
						}
					}
				});
				response.on("end", () => {
					if (settled) {
						return;
					}
					if (response.statusCode && response.statusCode >= 400) {
						const details = normalizeConfigValue(errorBody).slice(0, 240);
						finish(() =>
							reject(
								new Error(
									`Kimi API \u8bf7\u6c42\u5931\u8d25\uff1aHTTP ${response.statusCode}${details ? ` - ${details}` : ""}`
								)
							)
						);
						return;
					}
					buffer += decoder.decode();
					for (const line of buffer.split(/\r?\n/g)) {
						if (consumeStreamingChatCompletionLine(line, state, options)) {
							break;
						}
					}
					finish(() => resolve(state.content.trim()));
				});
				response.on("error", (error) => {
					finish(() => reject(error instanceof Error ? error : new Error(String(error))));
				});
			}
		);

		requestHandle.on("error", (error) => {
			finish(() => reject(error));
		});
		requestHandle.write(request.body);
		requestHandle.end();
	});
}

async function requestStreamingChatCompletionText(
	config: EpubAiReadingConfig,
	messages: ReturnType<typeof buildEpubAiReadingMessages>,
	options: EpubAiReadingRequestOptions
): Promise<string> {
	const streamRequest = buildStreamingChatCompletionRequest(config, messages);
	if (options.streamRequester) {
		return await options.streamRequester(streamRequest);
	}
	if (!options.fetcher) {
		return await requestNodeStreamingChatCompletionText(streamRequest, options);
	}
	const fetcher = options.fetcher || getGlobalFetch();
	if (!fetcher) {
		throw new Error("当前环境没有可用的流式 fetch。");
	}
	const response = await fetcher(streamRequest.url, {
		method: "POST",
		headers: streamRequest.headers,
		body: streamRequest.body,
	});
	return await readStreamingChatCompletionText(response, options);
}

export async function requestEpubAiReading(
	input: EpubAiReadingInput,
	options: EpubAiReadingRequestOptions = {}
): Promise<EpubAiReadingResult> {
	emitAiReadingStage(options, "\u6b63\u5728\u8bfb\u53d6 AI \u914d\u7f6e");
	const runtimeEnv = {
		...(await loadEpubAiReadingRuntimeEnv(options.app, options.envPathCandidates)),
		...(options.runtimeEnv || {}),
	};
	const config = resolveEpubAiReadingConfig(
		{
			...resolveEpubAiReadingConfigFromHost(options.configHost),
			...(options.config || {}),
		},
		runtimeEnv
	);
	if (!config.apiKey) {
		throw new Error("\u7f3a\u5c11 Kimi API Key\u3002\u8bf7\u5728 .env \u4e2d\u914d\u7f6e KIMI_API_KEY \u6216 VITE_KIMI_API_KEY\u3002");
	}
	const chapterText = normalizeConfigValue(input.chapterText || input.chapterMarkdown);
	if (!chapterText) {
		throw new Error("\u5f53\u524d\u7ae0\u8282\u6ca1\u6709\u53ef\u53d1\u9001\u7ed9 AI \u7684\u6b63\u6587\u3002");
	}

	emitAiReadingStage(options, "\u6b63\u5728\u6574\u7406\u7ae0\u8282\u7ed3\u6784");
	const messages = buildEpubAiReadingMessages(input);
	const requester = options.requester || (requestUrl as unknown as EpubAiReadingRequester);
	emitAiReadingStage(options, "\u6b63\u5728\u6253\u5305\u53d1\u9001\u7ed9 AI");
	emitAiReadingStage(options, "AI \u6b63\u5728\u6574\u7406\u9605\u8bfb\u7ed3\u679c");

	let content = "";
	const canStream = options.enableStreaming !== false && Boolean(options.onPartialContent);
	if (canStream) {
		try {
			content = await requestStreamingChatCompletionText(config, messages, options);
		} catch (error) {
			emitAiReadingStage(
				options,
				`\u6d41\u5f0f\u751f\u6210\u4e0d\u53ef\u7528\uff08${formatAiReadingErrorReason(error)}\uff09\uff0c\u6b63\u5728\u5207\u6362\u666e\u901a\u751f\u6210`
			);
		}
	}

	if (!content) {
		const response = await requester({
			url: normalizeBaseUrl(config.baseUrl) + "/chat/completions",
			method: "POST",
			contentType: "application/json",
			headers: {
				Authorization: "Bearer " + config.apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(buildChatCompletionRequestBody(config, messages)),
			throw: false,
		});

		if (response.status && response.status >= 400) {
			throw new Error("Kimi API \u8bf7\u6c42\u5931\u8d25\uff1aHTTP " + response.status);
		}

		const parsed = response.json || (response.text ? JSON.parse(response.text) : null);
		content = extractKimiChatCompletionText(parsed);
	}
	if (!content) {
		throw new Error("Kimi API \u6ca1\u6709\u8fd4\u56de\u53ef\u663e\u793a\u7684\u9605\u8bfb\u7ed3\u679c\u3002");
	}

	const sourceBlocks = Array.isArray(input.sourceBlocks) ? input.sourceBlocks : [];
	const decoratedContent =
		sourceBlocks.length > 0
			? decorateEpubAiReadingSourceReferences(content, sourceBlocks)
			: content;

	return {
		bookTitle: input.bookTitle,
		author: input.author,
		filePath: normalizePath(input.filePath),
		chapterTitle: normalizeConfigValue(input.chapterTitle) || "\u5f53\u524d\u7ae0\u8282",
		chapterHref: normalizeConfigValue(input.chapterHref),
		sourceLink: input.sourceLink,
		sourceBlocks,
		content: decoratedContent,
		model: config.model,
		generatedAt: options.now?.() ?? Date.now(),
	};
}

function hashString(input: string): string {
	let hash = 5381;
	for (let index = 0; index < input.length; index += 1) {
		hash = (hash * 33) ^ input.charCodeAt(index);
	}
	return (hash >>> 0).toString(16);
}

function getSectionKey(result: Pick<EpubAiReadingResult, "filePath" | "chapterHref">): string {
	return hashString(`${normalizePath(result.filePath)}::${normalizeConfigValue(result.chapterHref)}`);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeNoteTitle(title: string | undefined, fallback: string): string {
	const normalized = sanitizeExportFileName(normalizeConfigValue(title) || fallback)
		.replace(/\s+/g, " ")
		.replace(/\.+$/g, "")
		.trim();
	return normalized || fallback;
}

function formatGeneratedAt(timestamp: number): string {
	const value = Number.isFinite(timestamp) ? timestamp : Date.now();
	return new Date(value).toISOString();
}

export function buildEpubAiReadingNoteSection(result: EpubAiReadingResult): string {
	const key = getSectionKey(result);
	const lines = [
		`<!-- weave-epub-ai-reading:start key="${key}" -->`,
		`## ${normalizeConfigValue(result.chapterTitle) || "当前章节"}`,
		"",
		`> 书籍：${normalizeConfigValue(result.bookTitle) || "未知书名"}`,
		result.author ? `> 作者：${normalizeConfigValue(result.author)}` : "",
		`> EPUB 文件：${normalizePath(result.filePath)}`,
		result.chapterHref ? `> 章节 href：${normalizeConfigValue(result.chapterHref)}` : "",
		result.sourceLink ? `> EPUB 跳转：${normalizeConfigValue(result.sourceLink)}` : "",
		`> 模型：${normalizeConfigValue(result.model) || DEFAULT_KIMI_MODEL}`,
		`> 生成时间：${formatGeneratedAt(result.generatedAt)}`,
		"",
		result.content.trim(),
		"",
		`<!-- weave-epub-ai-reading:end key="${key}" -->`,
	];
	return lines.filter((line) => line !== "").join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildEpubAiReadingNoteMarkdown(options: {
	bookTitle?: string;
	filePath: string;
	sectionsMarkdown: string;
}): string {
	const title = sanitizeNoteTitle(options.bookTitle, "EPUB");
	return [
		`# ${title} - AI阅读`,
		"",
		`> EPUB 文件：${normalizePath(options.filePath)}`,
		"> 本笔记由 Weave EPUB Reader 的 AI 阅读功能生成；重复生成同一章节会更新对应章节。",
		"",
		options.sectionsMarkdown.trim(),
		"",
	].join("\n").replace(/\n{3,}/g, "\n\n");
}

function upsertSection(existingContent: string, sectionMarkdown: string, key: string): string {
	const start = `<!-- weave-epub-ai-reading:start key="${key}" -->`;
	const end = `<!-- weave-epub-ai-reading:end key="${key}" -->`;
	const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
	if (pattern.test(existingContent)) {
		return existingContent.replace(pattern, sectionMarkdown);
	}
	const normalizedExisting = existingContent.trim();
	return `${normalizedExisting}${normalizedExisting ? "\n\n" : ""}${sectionMarkdown}\n`;
}

export function resolveEpubAiReadingNotePath(
	result: Pick<EpubAiReadingResult, "bookTitle" | "filePath">,
	options: EpubAiReadingNoteOptions = {}
): string {
	const folder = normalizePath(normalizeConfigValue(options.folderPath) || DEFAULT_NOTE_FOLDER);
	const fileFallback =
		normalizePath(result.filePath).split("/").pop()?.replace(/\.[^.]+$/g, "") || "EPUB";
	const title = sanitizeNoteTitle(result.bookTitle, fileFallback);
	return normalizePath(`${folder}/${title} - AI阅读.md`);
}

export async function upsertEpubAiReadingNote(
	app: App,
	result: EpubAiReadingResult,
	options: EpubAiReadingNoteOptions = {}
): Promise<TFile> {
	const targetPath = resolveEpubAiReadingNotePath(result, options);
	await DirectoryUtils.ensureDirForFile(app.vault.adapter, targetPath);
	const sectionMarkdown = buildEpubAiReadingNoteSection(result);
	const key = getSectionKey(result);
	const existing = app.vault.getAbstractFileByPath(targetPath);
	if (existing instanceof TFile) {
		const current = await app.vault.read(existing);
		await app.vault.modify(existing, upsertSection(current, sectionMarkdown, key));
		return existing;
	}
	return await app.vault.create(
		targetPath,
		buildEpubAiReadingNoteMarkdown({
			bookTitle: result.bookTitle,
			filePath: result.filePath,
			sectionsMarkdown: sectionMarkdown,
		})
	);
}
