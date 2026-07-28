import { TFile, normalizePath, requestUrl } from "obsidian";
import type { App } from "obsidian";
import { DirectoryUtils } from "../../utils/directory-utils";
import { sanitizeExportFileName } from "../../utils/sanitize-export-filename";
import type { AIConfig } from "../../types/plugin-settings";
import type { TocItem } from "./types";
import {
	decorateEpubAiReadingSourceReferences,
	formatEpubAiReadingSourceBlocksForPrompt,
	limitEpubAiReadingSourceReferencesPerLine,
	type EpubAiReadingSourceBlock,
} from "./epub-ai-reading-source-blocks";

export interface EpubAiReadingScopeInfo {
	label?: string;
	pathLabels?: string[];
	href?: string;
	includeDescendants?: boolean;
	flatIndex?: number;
	endFlatIndex?: number;
}

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
	scope?: EpubAiReadingScopeInfo;
	scopeContext?: string;
}

export interface EpubAiReadingConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	temperature: number;
	maxTokens?: number;
	maxCompletionTokens?: number;
}

export type EpubAiReadingOutputLevel = "leaf" | "section" | "chapter" | "book";

export interface EpubAiReadingOutputPlan {
	level: EpubAiReadingOutputLevel;
	label: string;
	maxCompletionTokens: number;
	promptLines: string[];
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
	scope?: EpubAiReadingScopeInfo;
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

type EpubAiReadingFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

type EpubAiReadingStreamRequest = {
	url: string;
	headers: Record<string, string>;
	body: string;
};

type EpubAiReadingStreamRequester = (
	request: EpubAiReadingStreamRequest,
) => Promise<string>;

type RuntimeRequire = (id: string) => unknown;

type NodeStreamingResponse = {
	statusCode?: number;
	setEncoding?: (encoding: string) => void;
	on: (
		event: "data" | "end" | "error",
		callback: (chunkOrError?: unknown) => void,
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
		callback: (response: NodeStreamingResponse) => void,
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
const EPUB_AI_READING_LEAF_MAX_COMPLETION_TOKENS = 16000;
const EPUB_AI_READING_SECTION_MAX_COMPLETION_TOKENS = 48000;
const EPUB_AI_READING_CHAPTER_MAX_COMPLETION_TOKENS = 131072;
const EPUB_AI_READING_BOOK_MAX_COMPLETION_TOKENS = 131072;
const DEFAULT_NOTE_FOLDER = "AI阅读笔记";

function normalizeConfigValue(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(values: unknown): string[] {
	return Array.isArray(values)
		? values
				.map((value) => normalizeConfigValue(value))
				.filter((value) => value.length > 0)
		: [];
}

function normalizeOptionalNumber(value: unknown): number | undefined {
	const parsed = typeof value === "number" ? value : Number.NaN;
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeEpubAiReadingScopeInfo(
	scope?: EpubAiReadingScopeInfo | null,
): EpubAiReadingScopeInfo | undefined {
	if (!scope) {
		return undefined;
	}
	const pathLabels = normalizeStringList(scope.pathLabels);
	const label = normalizeConfigValue(scope.label);
	const href = normalizeConfigValue(scope.href);
	const flatIndex = normalizeOptionalNumber(scope.flatIndex);
	const endFlatIndex = normalizeOptionalNumber(scope.endFlatIndex);
	const normalized: EpubAiReadingScopeInfo = {
		...(label ? { label } : {}),
		...(pathLabels.length > 0 ? { pathLabels } : {}),
		...(href ? { href } : {}),
		...(typeof scope.includeDescendants === "boolean"
			? { includeDescendants: scope.includeDescendants }
			: {}),
		...(typeof flatIndex === "number" ? { flatIndex } : {}),
		...(typeof endFlatIndex === "number" ? { endFlatIndex } : {}),
	};
	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function formatEpubAiReadingScopePath(
	scope: EpubAiReadingScopeInfo | undefined,
	fallback: string,
): string {
	const pathLabels = normalizeStringList(scope?.pathLabels);
	if (pathLabels.length > 0) {
		return pathLabels.join(" > ");
	}
	return (
		normalizeConfigValue(scope?.label) ||
		normalizeConfigValue(fallback) ||
		"当前章节"
	);
}

function formatEpubAiReadingScopeStrategy(
	scope?: EpubAiReadingScopeInfo,
): string {
	if (!scope) {
		return "当前章节正文";
	}
	return scope.includeDescendants
		? "包含该目录项及其下级目录正文"
		: "只精读当前目录项正文";
}

function formatEpubAiReadingSourceBlockSummary(
	blocks: EpubAiReadingSourceBlock[],
): string {
	const sourceBlocks = (blocks || []).filter((block) =>
		normalizeConfigValue(block.id),
	);
	if (sourceBlocks.length === 0) {
		return "";
	}
	const firstId = normalizeConfigValue(sourceBlocks[0]?.id);
	const lastId = normalizeConfigValue(
		sourceBlocks[sourceBlocks.length - 1]?.id,
	);
	const range =
		firstId && lastId && firstId !== lastId
			? `${firstId}-${lastId}`
			: firstId || lastId;
	return `${range}，共 ${sourceBlocks.length} 段`;
}

function isEpubAiReadingAllLabel(label: string): boolean {
	const normalized = normalizeConfigValue(label);
	return normalized === "全部" || normalized === "全书";
}

function getEpubAiReadingScopeDepth(scope?: EpubAiReadingScopeInfo): number {
	const pathLabels = normalizeStringList(scope?.pathLabels).filter(
		(label) => !isEpubAiReadingAllLabel(label),
	);
	return pathLabels.length || (normalizeConfigValue(scope?.label) ? 1 : 0);
}

function isBookLevelScope(scope?: EpubAiReadingScopeInfo): boolean {
	const pathLabels = normalizeStringList(scope?.pathLabels);
	return pathLabels.length === 1 && isEpubAiReadingAllLabel(pathLabels[0]);
}

function getEpubAiReadingOutputPromptLines(
	level: EpubAiReadingOutputLevel,
	maxCompletionTokens: number,
): string[] {
	const common = [
		`- 本次最大输出预算：${maxCompletionTokens} tokens；这是上限，不是必须用满。`,
		"- 不需要填满输出上限；内容少的范围要简洁，不要硬凑条目。",
	];
	const baseDetailContract = [
		"- 基础精析层：无论用户选择最低级小节、中级目录、一级章节，最低级小节的精析标准必须一致。",
		"- 每个最低级小节都必须按最低级小节/精读范围的同一标准输出：小节摘要、核心结论、关键知识点、重要原文与解读、容易误解的点。",
		"- 不得因为选择的是高级范围就压缩、跳过或只概括下级小节；高级范围只能额外增加总览、摘要、主线、关系和全局观。",
	];
	if (level === "book") {
		return [
			"- 阅读层级：全书汇总。",
			"- 全书功能仍是占位阶段；如收到全书内容，请按一级章节分批统筹，并保留每章关键位置。",
			"- 高级层数量不包含下级小节数据；全书主线、跨章关系和章节地图要另行输出。",
			...common,
		];
	}
	if (level === "chapter") {
		return [
			"- 阅读层级：一级章节。",
			"- 按最低级标题逐项精读，每个最低级小节都要保留摘要、重点和重要原文索引。",
			"- 先理解最低级小节细节，再汇总一级章节的整体摘要、章节主线、知识结构和跨小节关系。",
			...baseDetailContract,
			"- 高级层数量不包含下级小节数据。",
			"- 全局总结层：章节总览 4-8 句，章节核心结论 8-15 条，章节级重要原文 10-25 处；这些数量只约束章节级总览，不约束每个小节的基础精析。",
			...common,
		];
	}
	if (level === "section") {
		return [
			"- 阅读层级：中级目录范围。",
			"- 按下级标题逐项精读，保留下级小节的局部细节，再汇总当前范围的二级总览和小节关系。",
			...baseDetailContract,
			"- 高级层数量不包含下级小节数据。",
			"- 全局总结层：范围总览 3-5 句，范围核心结论 4-8 条，范围级重要原文 5-12 处；这些数量只约束范围级总览，不约束每个小节的基础精析。",
			...common,
		];
	}
	return [
		"- 阅读层级：最低级小节/精读范围。",
		"- 直接围绕本范围正文精读；范围摘要 2-4 句，核心结论 2-4 条，重要原文 2-5 处。",
		"- 不需要额外拆成上层汇总，重点放在概念、操作、限制和容易误解的位置。",
		"- 这是基础精析层的单节形态；高级范围中的每个最低级小节也应使用这个精析标准。",
		...common,
	];
}

export function resolveEpubAiReadingOutputPlan(
	input: Pick<EpubAiReadingInput, "scope" | "sourceBlocks">,
): EpubAiReadingOutputPlan {
	const scope = normalizeEpubAiReadingScopeInfo(input.scope);
	const depth = getEpubAiReadingScopeDepth(scope);
	const level: EpubAiReadingOutputLevel = isBookLevelScope(scope)
		? "book"
		: scope?.includeDescendants && depth <= 1
		? "chapter"
		: scope?.includeDescendants
		? "section"
		: "leaf";
	const maxCompletionTokens =
		level === "book"
			? EPUB_AI_READING_BOOK_MAX_COMPLETION_TOKENS
			: level === "chapter"
			? EPUB_AI_READING_CHAPTER_MAX_COMPLETION_TOKENS
			: level === "section"
			? EPUB_AI_READING_SECTION_MAX_COMPLETION_TOKENS
			: EPUB_AI_READING_LEAF_MAX_COMPLETION_TOKENS;
	const label =
		level === "book"
			? "全书汇总"
			: level === "chapter"
			? "一级章节"
			: level === "section"
			? "中级目录范围"
			: "最低级小节";
	return {
		level,
		label,
		maxCompletionTokens,
		promptLines: getEpubAiReadingOutputPromptLines(level, maxCompletionTokens),
	};
}

function getProcessEnv(): Record<string, string | undefined> {
	return (
		(
			globalThis as typeof globalThis & {
				process?: { env?: Record<string, string | undefined> };
			}
		).process?.env || {}
	);
}

function readEnvValue(
	env: Record<string, string | undefined>,
	keys: string[],
): string {
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
	keys: string[],
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
		const normalized = line.startsWith("export ")
			? line.slice("export ".length).trim()
			: line;
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

function getEpubAiReadingEnvPathCandidates(
	app?: App,
	extraPaths: string[] = [],
): string[] {
	const configDir = normalizePath(
		normalizeConfigValue(app?.vault?.configDir) || ".obsidian",
	);
	const candidates = [
		...extraPaths,
		`${configDir}/plugins/weave-reader/.env`,
		`${configDir}/plugins/weave-reader-epub/.env`,
		".env",
	];
	return Array.from(
		new Set(candidates.map((path) => normalizePath(path)).filter(Boolean)),
	);
}

export async function loadEpubAiReadingRuntimeEnv(
	app?: App,
	envPathCandidates: string[] = [],
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
	for (const path of getEpubAiReadingEnvPathCandidates(
		app,
		envPathCandidates,
	)) {
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
	const apiKeys = (aiConfig?.apiKeys || {}) as Record<
		string,
		AIProviderConfig | undefined
	>;
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
	host?: EpubAiReadingConfigHost | null,
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
	runtimeEnv: Record<string, string | undefined> = {},
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
	const maxCompletionTokens =
		normalizeNumberValue(overrides.maxCompletionTokens) ??
		readEnvNumberValue(env, [
			"KIMI_MAX_COMPLETION_TOKENS",
			"MOONSHOT_MAX_COMPLETION_TOKENS",
			"VITE_KIMI_MAX_COMPLETION_TOKENS",
			"VITE_MOONSHOT_MAX_COMPLETION_TOKENS",
		]) ??
		normalizeNumberValue(overrides.maxTokens);

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
		...(typeof maxCompletionTokens === "number" ? { maxCompletionTokens } : {}),
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

function getDefaultEpubAiReadingTemperature(
	baseUrl: string,
	model: string,
): number {
	return isKimiCodeConfig(baseUrl, model)
		? DEFAULT_KIMI_CODE_TEMPERATURE
		: DEFAULT_KIMI_TEMPERATURE;
}

function flattenTocItems(
	items: TocItem[],
	ancestors: string[] = [],
	lines: string[] = [],
): string[] {
	for (const item of items || []) {
		const label = normalizeConfigValue(item.label) || "未命名章节";
		const path = [...ancestors, label];
		const href = normalizeConfigValue(item.href);
		lines.push(
			`${"  ".repeat(Math.max(item.level - 1, 0))}- ${path.join(" > ")}${
				href ? ` (${href})` : ""
			}`,
		);
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
	ancestors: string[] = [],
): string[] | null {
	const target = normalizeHrefForCompare(chapterHref);
	for (const item of items || []) {
		const label = normalizeConfigValue(item.label) || "未命名章节";
		const currentPath = [...ancestors, label];
		const itemHref = normalizeHrefForCompare(item.href);
		if (target && itemHref && target === itemHref) {
			return currentPath;
		}
		const childPath = findTocPath(
			item.subitems || [],
			chapterHref,
			currentPath,
		);
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
	const tocPath =
		findTocPath(input.tocItems, input.chapterHref)?.join(" > ") ||
		input.chapterTitle;
	const chapterText =
		normalizeConfigValue(input.chapterMarkdown) || input.chapterText;
	const sourceLink = normalizeConfigValue(input.sourceLink);
	const sourceBlocks = Array.isArray(input.sourceBlocks)
		? input.sourceBlocks
		: [];
	const sourceBlockText =
		formatEpubAiReadingSourceBlocksForPrompt(sourceBlocks);
	const scope = normalizeEpubAiReadingScopeInfo(input.scope);
	const scopePath = formatEpubAiReadingScopePath(scope, tocPath);
	const scopeHref =
		normalizeConfigValue(scope?.href) ||
		normalizeConfigValue(input.chapterHref) ||
		"未知";
	const sourceBlockSummary =
		formatEpubAiReadingSourceBlockSummary(sourceBlocks);
	const scopeContext = normalizeConfigValue(input.scopeContext);
	const outputPlan = resolveEpubAiReadingOutputPlan({
		scope,
		sourceBlocks,
	});
	const sourceReferenceRule = sourceBlockText
		? "请引用 [段001] 这种段落编号；每条最多 2 个段落编号。不要生成 EPUB CFI、内部锚点或 URL。"
		: "\u63d0\u53d6\u91cd\u8981\u539f\u6587\u65f6\uff0c\u7528\u201c\u4f4d\u7f6e\u8bf4\u660e + \u4e3a\u4ec0\u4e48\u91cd\u8981\u201d\u63cf\u8ff0\uff0c\u4e0d\u8981\u4f2a\u9020\u4e0d\u53ef\u70b9\u51fb\u7684\u951a\u70b9\u3002";
	const system = [
		"你是 EPUB AI 阅读助手。",
		"你帮助用户理解当前章节，但不能替代原文阅读。",
		"只基于用户提供的 EPUB 正文、章节标题和目录结构回答；不要编造书中没有的信息。",
		"输出中文 Markdown，结构清晰，保留可回到原文的线索。",
		"严格区分精读范围正文和范围外目录线索：摘要、核心结论、知识点和重要原文只能来自精读范围正文。",
	].join("\n");
	const user = [
		"# 任务",
		"请基于“精读范围正文”生成 EPUB AI 阅读笔记：总结范围内容，提取核心结论、关键知识点、重要原文与解读，并说明它和前后目录的关系。",
		"摘要、核心结论、知识点和重要原文只能来自精读范围正文；范围外目录或线索只允许用于“章节关系”和“建议精读位置”。",
		"",
		"# 阅读策略",
		...outputPlan.promptLines,
		"",
		"# 输出格式",
		"不要输出 H1；必须按下面这些二级标题输出。",
		"## 范围摘要",
		"- 2-4 句说明这个范围解决什么问题、讲了哪些内容、读完应获得什么能力。",
		"## 核心结论",
		"- 3-6 条可复习的结论；每条尽量带 1 个来源编号，每条最多 2 个段落编号。",
		"## 关键知识点",
		"- 提取概念、操作、规则、限制和容易遗漏的前提；不要简单复述目录。",
		outputPlan.level === "leaf" ? "" : "## 按小节精读",
		outputPlan.level === "leaf"
			? ""
			: "- 仅在选择了包含下级的范围时输出。这里是基础精析层，不是简短目录摘要；必须按最低级/下级标题逐项输出，且每个小节建议包含：小节摘要、核心结论、关键知识点、重要原文与解读、容易误解的点、与上下文关系。范围摘要、核心结论、章节关系属于全局总结层，不得替代这里的小节精析。",
		"## 重要原文与解读",
		"- 格式：`原文/位置：短摘录或位置说明 [段001]`；`为什么重要：...`；`读法：...`。",
		"- 不要整段搬运原文；优先选择对理解本范围最关键的 3-8 处。",
		"## 概念/术语",
		"- 解释本范围中的术语，并指出它和具体操作或后续章节的关系。",
		"## 容易误解的点",
		"- 写读者可能误解、跳过或机械照做的地方，并给出正确理解。",
		"## 章节关系",
		"- 区分“从正文可见”和“从目录推断”；范围外内容只能作为关系线索，不要当成本范围正文事实。",
		"## 建议精读位置",
		"- 给出建议回到 EPUB 精读的顺序；有来源编号时优先使用 [段001] 这种编号。",
		"",
		"# 书籍信息",
		`- 书名：${normalizeConfigValue(input.bookTitle) || "未知书名"}`,
		`- 作者：${normalizeConfigValue(input.author) || "未知作者"}`,
		`- EPUB 文件：${normalizePath(input.filePath)}`,
		`- 当前标题：${normalizeConfigValue(input.chapterTitle) || "当前章节"}`,
		`- 阅读范围：${scopePath}`,
		`- 范围 href：${scopeHref}`,
		`- 范围策略：${formatEpubAiReadingScopeStrategy(scope)}`,
		sourceBlockSummary ? `- 来源块：${sourceBlockSummary}` : "",
		sourceLink ? `- EPUB 跳转：${sourceLink}` : "",
		"",
		"# \u5b9a\u4f4d\u89c4\u5219",
		"\u53ef\u70b9\u51fb\u8df3\u8f6c\u7531\u9605\u8bfb\u5668\u754c\u9762\u63d0\u4f9b\uff1b\u4f60\u4e0d\u8981\u628a EPUB \u5185\u90e8\u951a\u70b9\uff08\u5982 #id\u3001#_idParaDest\uff09\u5199\u6210\u9700\u8981\u7528\u6237\u70b9\u51fb\u7684\u94fe\u63a5\u3002",
		sourceReferenceRule,
		scopeContext ? "" : "",
		scopeContext
			? "# \u9605\u8bfb\u8303\u56f4\u4e0e\u5916\u90e8\u7ed3\u6784\u7ebf\u7d22"
			: "",
		scopeContext
			? "外部线索只用于理解章节关系、跨章引用和建议精读位置；摘要、核心结论、知识点和重要原文必须以下方“精读范围正文”为主。"
			: "",
		scopeContext,
		sourceBlockText
			? "摘要可以综合多个段落，但关键知识点、核心结论和重要原文应尽量带来源编号，例如 [段001]。插件会把段落编号转换成可点击链接。"
			: "",
		"",
		"# 全书目录",
		tocLines,
		"",
		sourceBlockText ? "# 精读范围正文块" : "# 精读范围正文",
		sourceBlockText || chapterText,
	]
		.filter(Boolean)
		.join("\n");

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
	message: string,
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
	input: EpubAiReadingInput,
	options: { stream?: boolean } = {},
): Record<string, unknown> {
	const outputPlan = resolveEpubAiReadingOutputPlan(input);
	const maxCompletionTokens =
		normalizeNumberValue(config.maxCompletionTokens) ||
		outputPlan.maxCompletionTokens;
	return {
		model: config.model,
		messages: [
			{ role: "system", content: messages.system },
			{ role: "user", content: messages.user },
		],
		temperature: config.temperature,
		max_completion_tokens: maxCompletionTokens,
		...(options.stream ? { stream: true } : {}),
	};
}

function getGlobalFetch(): EpubAiReadingFetch | null {
	const fetcher = (
		globalThis as typeof globalThis & { fetch?: EpubAiReadingFetch }
	).fetch;
	return typeof fetcher === "function" ? fetcher.bind(globalThis) : null;
}

function getRuntimeRequire(): RuntimeRequire | null {
	try {
		const runtimeRequire = Function(
			"return typeof require === 'function' ? require : undefined",
		)() as unknown;
		return typeof runtimeRequire === "function"
			? (runtimeRequire as RuntimeRequire)
			: null;
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
		const httpModule = runtimeRequire(
			moduleName,
		) as Partial<NodeHttpModule> | null;
		return httpModule && typeof httpModule.request === "function"
			? (httpModule as NodeHttpModule)
			: null;
	} catch {
		return null;
	}
}

function buildStreamingChatCompletionRequest(
	config: EpubAiReadingConfig,
	messages: ReturnType<typeof buildEpubAiReadingMessages>,
	input: EpubAiReadingInput,
): EpubAiReadingStreamRequest {
	return {
		url: `${normalizeBaseUrl(config.baseUrl)}/chat/completions`,
		headers: {
			Authorization: `Bearer ${config.apiKey}`,
			"Content-Type": "application/json",
			Accept: "text/event-stream",
		},
		body: JSON.stringify(
			buildChatCompletionRequestBody(config, messages, input, { stream: true }),
		),
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
	content: string,
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
	const delta = (choices[0] as { delta?: { reasoning_content?: unknown } })
		.delta;
	return typeof delta?.reasoning_content === "string"
		? delta.reasoning_content
		: "";
}

function consumeStreamingChatCompletionLine(
	line: string,
	state: StreamingChatState,
	options: EpubAiReadingRequestOptions,
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
				emitAiReadingStage(
					options,
					"\u6b63\u5728\u6d41\u5f0f\u8f93\u51fa AI \u9605\u8bfb\u7ed3\u679c",
				);
			}
			state.content += delta;
			emitPartialAiReadingContent(options, state.content);
		} else if (!state.reasoningStarted && readStreamingReasoningText(payload)) {
			state.reasoningStarted = true;
			emitAiReadingStage(
				options,
				"AI \u6b63\u5728\u5206\u6790\u6b63\u6587\u548c\u7ae0\u8282\u5173\u7cfb",
			);
		}
	} catch {
		/* Ignore malformed SSE frames and continue reading. */
	}
	return false;
}

function formatAiReadingErrorReason(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error || "");
	return (
		normalizeConfigValue(message).slice(0, 160) || "\u672a\u77e5\u539f\u56e0"
	);
}

async function readStreamingChatCompletionText(
	response: Response,
	options: EpubAiReadingRequestOptions,
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
	options: EpubAiReadingRequestOptions,
): Promise<string> {
	const url = new URL(request.url);
	const httpModule = getNodeHttpModule(url);
	if (!httpModule) {
		throw new Error(
			"\u5f53\u524d Obsidian \u8fd0\u884c\u65f6\u6ca1\u6709\u53ef\u7528\u7684 Node \u7f51\u7edc\u6d41\u901a\u9053\u3002",
		);
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
									`Kimi API \u8bf7\u6c42\u5931\u8d25\uff1aHTTP ${
										response.statusCode
									}${details ? ` - ${details}` : ""}`,
								),
							),
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
					finish(() =>
						reject(error instanceof Error ? error : new Error(String(error))),
					);
				});
			},
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
	input: EpubAiReadingInput,
	options: EpubAiReadingRequestOptions,
): Promise<string> {
	const streamRequest = buildStreamingChatCompletionRequest(
		config,
		messages,
		input,
	);
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
	options: EpubAiReadingRequestOptions = {},
): Promise<EpubAiReadingResult> {
	emitAiReadingStage(options, "\u6b63\u5728\u8bfb\u53d6 AI \u914d\u7f6e");
	const runtimeEnv = {
		...(await loadEpubAiReadingRuntimeEnv(
			options.app,
			options.envPathCandidates,
		)),
		...(options.runtimeEnv || {}),
	};
	const config = resolveEpubAiReadingConfig(
		{
			...resolveEpubAiReadingConfigFromHost(options.configHost),
			...(options.config || {}),
		},
		runtimeEnv,
	);
	if (!config.apiKey) {
		throw new Error(
			"\u7f3a\u5c11 Kimi API Key\u3002\u8bf7\u5728 .env \u4e2d\u914d\u7f6e KIMI_API_KEY \u6216 VITE_KIMI_API_KEY\u3002",
		);
	}
	const chapterText = normalizeConfigValue(
		input.chapterText || input.chapterMarkdown,
	);
	if (!chapterText) {
		throw new Error(
			"\u5f53\u524d\u7ae0\u8282\u6ca1\u6709\u53ef\u53d1\u9001\u7ed9 AI \u7684\u6b63\u6587\u3002",
		);
	}

	emitAiReadingStage(
		options,
		"\u6b63\u5728\u6574\u7406\u7ae0\u8282\u7ed3\u6784",
	);
	const messages = buildEpubAiReadingMessages(input);
	const requester =
		options.requester || (requestUrl as unknown as EpubAiReadingRequester);
	emitAiReadingStage(options, "\u6b63\u5728\u6253\u5305\u53d1\u9001\u7ed9 AI");
	emitAiReadingStage(
		options,
		"AI \u6b63\u5728\u6574\u7406\u9605\u8bfb\u7ed3\u679c",
	);

	let content = "";
	const canStream =
		options.enableStreaming !== false && Boolean(options.onPartialContent);
	if (canStream) {
		try {
			content = await requestStreamingChatCompletionText(
				config,
				messages,
				input,
				options,
			);
		} catch (error) {
			emitAiReadingStage(
				options,
				`\u6d41\u5f0f\u751f\u6210\u4e0d\u53ef\u7528\uff08${formatAiReadingErrorReason(
					error,
				)}\uff09\uff0c\u6b63\u5728\u5207\u6362\u666e\u901a\u751f\u6210`,
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
			body: JSON.stringify(
				buildChatCompletionRequestBody(config, messages, input),
			),
			throw: false,
		});

		if (response.status && response.status >= 400) {
			throw new Error(
				"Kimi API \u8bf7\u6c42\u5931\u8d25\uff1aHTTP " + response.status,
			);
		}

		const parsed =
			response.json || (response.text ? JSON.parse(response.text) : null);
		content = extractKimiChatCompletionText(parsed);
	}
	if (!content) {
		throw new Error(
			"Kimi API \u6ca1\u6709\u8fd4\u56de\u53ef\u663e\u793a\u7684\u9605\u8bfb\u7ed3\u679c\u3002",
		);
	}

	const sourceBlocks = Array.isArray(input.sourceBlocks)
		? input.sourceBlocks
		: [];
	const limitedContent =
		sourceBlocks.length > 0
			? limitEpubAiReadingSourceReferencesPerLine(content)
			: content;
	const decoratedContent =
		sourceBlocks.length > 0
			? decorateEpubAiReadingSourceReferences(limitedContent, sourceBlocks)
			: limitedContent;

	return {
		bookTitle: input.bookTitle,
		author: input.author,
		filePath: normalizePath(input.filePath),
		chapterTitle:
			normalizeConfigValue(input.chapterTitle) || "\u5f53\u524d\u7ae0\u8282",
		chapterHref: normalizeConfigValue(input.chapterHref),
		sourceLink: input.sourceLink,
		sourceBlocks,
		scope: normalizeEpubAiReadingScopeInfo(input.scope),
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

function getScopeKeyPart(scope?: EpubAiReadingScopeInfo): string {
	const normalized = normalizeEpubAiReadingScopeInfo(scope);
	if (!normalized) {
		return "";
	}
	return [
		formatEpubAiReadingScopePath(normalized, ""),
		normalizeConfigValue(normalized.href),
		normalized.includeDescendants ? "desc" : "exact",
		String(normalized.flatIndex ?? ""),
		String(normalized.endFlatIndex ?? ""),
	].join("::");
}

function getSectionKey(
	result: Pick<EpubAiReadingResult, "filePath" | "chapterHref" | "scope">,
): string {
	const baseKey = `${normalizePath(result.filePath)}::${normalizeConfigValue(
		result.chapterHref,
	)}`;
	const scopeKey = getScopeKeyPart(result.scope);
	return hashString(scopeKey ? `${baseKey}::${scopeKey}` : baseKey);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeNoteTitle(
	title: string | undefined,
	fallback: string,
): string {
	const normalized = sanitizeExportFileName(
		normalizeConfigValue(title) || fallback,
	)
		.replace(/\s+/g, " ")
		.replace(/\.+$/g, "")
		.trim();
	return normalized || fallback;
}

function formatGeneratedAt(timestamp: number): string {
	const value = Number.isFinite(timestamp) ? timestamp : Date.now();
	return new Date(value).toISOString();
}

function escapeHtmlAttribute(value: unknown): string {
	return String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export function buildEpubAiReadingNoteSection(
	result: EpubAiReadingResult,
): string {
	const key = getSectionKey(result);
	const scope = normalizeEpubAiReadingScopeInfo(result.scope);
	const scopePath = scope
		? formatEpubAiReadingScopePath(scope, result.chapterTitle)
		: "";
	const sourceBlockSummary = formatEpubAiReadingSourceBlockSummary(
		result.sourceBlocks || [],
	);
	const outputPlan = resolveEpubAiReadingOutputPlan({
		scope,
		sourceBlocks: result.sourceBlocks || [],
	});
	const scopeLabel =
		scopePath || normalizeConfigValue(result.chapterTitle) || "当前章节";
	const lines = [
		`<!-- weave-epub-ai-reading:start key="${key}" -->`,
		`## ${normalizeConfigValue(result.chapterTitle) || "当前章节"}`,
		"",
		`> 书籍：${normalizeConfigValue(result.bookTitle) || "未知书名"}`,
		result.author ? `> 作者：${normalizeConfigValue(result.author)}` : "",
		`> EPUB 文件：${normalizePath(result.filePath)}`,
		result.chapterHref
			? `> 章节 href：${normalizeConfigValue(result.chapterHref)}`
			: "",
		scopePath ? `> 阅读范围：${scopePath}` : "",
		scope?.href ? `> 范围 href：${normalizeConfigValue(scope.href)}` : "",
		scope ? `> 范围策略：${formatEpubAiReadingScopeStrategy(scope)}` : "",
		sourceBlockSummary ? `> 来源块：${sourceBlockSummary}` : "",
		result.sourceLink
			? `> EPUB 跳转：${normalizeConfigValue(result.sourceLink)}`
			: "",
		`> 阅读层级：${outputPlan.label}`,
		`> 模型：${normalizeConfigValue(result.model) || DEFAULT_KIMI_MODEL}`,
		`> 生成时间：${formatGeneratedAt(result.generatedAt)}`,
		"",
		`<div class="weave-epub-ai-reading-note-root" data-source-file="${escapeHtmlAttribute(
			normalizePath(result.filePath),
		)}" data-scope-level="${
			outputPlan.level
		}" data-scope-label="${escapeHtmlAttribute(scopeLabel)}"></div>`,
		"",
		result.content.trim(),
		"",
		`<!-- weave-epub-ai-reading:end key="${key}" -->`,
	];
	return lines
		.filter((line) => line !== "")
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
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
		"> 本笔记由 Weave EPUB Reader 的 AI 阅读功能生成；重复生成同一阅读范围会更新对应段落。",
		"",
		options.sectionsMarkdown.trim(),
		"",
	]
		.join("\n")
		.replace(/\n{3,}/g, "\n\n");
}

function upsertSection(
	existingContent: string,
	sectionMarkdown: string,
	key: string,
): string {
	const start = `<!-- weave-epub-ai-reading:start key="${key}" -->`;
	const end = `<!-- weave-epub-ai-reading:end key="${key}" -->`;
	const pattern = new RegExp(
		`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`,
	);
	if (pattern.test(existingContent)) {
		return existingContent.replace(pattern, sectionMarkdown);
	}
	const normalizedExisting = existingContent.trim();
	return `${normalizedExisting}${
		normalizedExisting ? "\n\n" : ""
	}${sectionMarkdown}\n`;
}

export function resolveEpubAiReadingNotePath(
	result: Pick<EpubAiReadingResult, "bookTitle" | "filePath">,
	options: EpubAiReadingNoteOptions = {},
): string {
	const folder = normalizePath(
		normalizeConfigValue(options.folderPath) || DEFAULT_NOTE_FOLDER,
	);
	const fileFallback =
		normalizePath(result.filePath)
			.split("/")
			.pop()
			?.replace(/\.[^.]+$/g, "") || "EPUB";
	const title = sanitizeNoteTitle(result.bookTitle, fileFallback);
	return normalizePath(`${folder}/${title} - AI阅读.md`);
}

export async function upsertEpubAiReadingNote(
	app: App,
	result: EpubAiReadingResult,
	options: EpubAiReadingNoteOptions = {},
): Promise<TFile> {
	const targetPath = resolveEpubAiReadingNotePath(result, options);
	await DirectoryUtils.ensureDirForFile(app.vault.adapter, targetPath);
	const sectionMarkdown = buildEpubAiReadingNoteSection(result);
	const key = getSectionKey(result);
	const existing = app.vault.getAbstractFileByPath(targetPath);
	if (existing instanceof TFile) {
		const current = await app.vault.read(existing);
		await app.vault.modify(
			existing,
			upsertSection(current, sectionMarkdown, key),
		);
		return existing;
	}
	return await app.vault.create(
		targetPath,
		buildEpubAiReadingNoteMarkdown({
			bookTitle: result.bookTitle,
			filePath: result.filePath,
			sectionsMarkdown: sectionMarkdown,
		}),
	);
}
