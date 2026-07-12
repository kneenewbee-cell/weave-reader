/**
 * AI 配置响应式 Store。
 * 负责统一读取、更新并持久化 AI 配置。
 */

import { derived, get, writable } from "svelte/store";
import { OFFICIAL_FORMAT_ACTIONS } from "../constants/official-format-actions";
import {
	hasPersistableActionIdentity,
	isActionContentReadyForMenu,
	normalizePersistedCustomActions,
} from "../services/ai/ai-action-config";
import type { AIConfigHost } from "../services/ai/ai-host";
import type { AIAction, AIProvider } from "../types/ai-types";
import { logger } from "../utils/logger";

interface AIConfigStoreHost extends AIConfigHost {
	saveSettings(): Promise<void>;
}

type PersistedAIConfig = NonNullable<AIConfigStoreHost["settings"]["aiConfig"]>;

const AI_PROVIDERS: AIProvider[] = [
	"openai",
	"gemini",
	"anthropic",
	"deepseek",
	"zhipu",
	"siliconflow",
	"xai",
];

function normalizeDefaultProvider(value: string | undefined): AIProvider {
	return AI_PROVIDERS.includes(value as AIProvider) ? (value as AIProvider) : "zhipu";
}

function createDefaultPersistedAIConfig(): PersistedAIConfig {
	return {
		apiKeys: {},
		defaultProvider: "zhipu",
		customFormatActions: [],
		customSplitActions: [],
	};
}

// ============================================================================
// Type Definitions
// ============================================================================

export interface AIConfigState {
	// 自定义功能列表
	customFormatActions: AIAction[];
	customSplitActions: AIAction[];

	// 默认配置
	defaultProvider: AIProvider;
	apiKeys: Record<string, { apiKey: string; model?: string }>;

	// 元数据
	lastModified: number;
	version: number; // 用于追踪变更
}

// ============================================================================
// Core Store Class
// ============================================================================

class AIConfigStore {
	private plugin: AIConfigStoreHost | null = null;
	private store = writable<AIConfigState>(this.getInitialState());
	private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly SAVE_DEBOUNCE_MS = 1000; // 1秒防抖

	// ============================================================================
	// Initialization
	// ============================================================================

	initialize(plugin: AIConfigStoreHost) {
		this.plugin = plugin;
		this.loadFromPlugin();
		logger.info("[AIConfigStore] Store已初始化");
	}

	reloadFromPlugin() {
		this.loadFromPlugin();
	}

	private getInitialState(): AIConfigState {
		return {
			customFormatActions: [],
			customSplitActions: [],
			defaultProvider: "zhipu",
			apiKeys: {},
			lastModified: Date.now(),
			version: 0,
		};
	}

	private loadFromPlugin() {
		if (!this.plugin) {
			logger.warn("[AIConfigStore] Plugin未初始化，跳过加载");
			return;
		}

		const aiConfig = this.plugin.settings.aiConfig;
		if (!aiConfig) {
			this.plugin.settings.aiConfig = createDefaultPersistedAIConfig();
			logger.info("[AIConfigStore] aiConfig不存在，已初始化默认值");
			return;
		}

		try {
			this.store.set({
				customFormatActions: structuredClone(
					normalizePersistedCustomActions(aiConfig.customFormatActions, "format")
				),
				customSplitActions: structuredClone(
					normalizePersistedCustomActions(aiConfig.customSplitActions, "split")
				),
				defaultProvider: normalizeDefaultProvider(aiConfig.defaultProvider),
				apiKeys: structuredClone(aiConfig.apiKeys || {}),
				lastModified: Date.now(),
				version: 0,
			});
		} catch (error) {
			logger.warn("[AIConfigStore] 加载时structuredClone失败，使用浅拷贝 fallback:", error);
			this.store.set({
				customFormatActions: [
					...normalizePersistedCustomActions(aiConfig.customFormatActions, "format"),
				],
				customSplitActions: [
					...normalizePersistedCustomActions(aiConfig.customSplitActions, "split"),
				],
				defaultProvider: normalizeDefaultProvider(aiConfig.defaultProvider),
				apiKeys: { ...(aiConfig.apiKeys || {}) },
				lastModified: Date.now(),
				version: 0,
			});
		}

		logger.info("[AIConfigStore] 配置已从plugin加载", {
			formatActions: aiConfig.customFormatActions?.length || 0,
			splitActions: aiConfig.customSplitActions?.length || 0,
		});
	}

	// ============================================================================
	// Read Operations
	// ============================================================================

	subscribe = this.store.subscribe;

	getState(): AIConfigState {
		return get(this.store);
	}

	// ============================================================================
	// Update Operations (Immutable)
	// ============================================================================

	/**
	 * 更新格式化功能列表
	 */
	updateFormatActions(actions: AIAction[]) {
		this.store.update((state) => ({
			...state,
			customFormatActions: this.validateAndClone(actions, "format"),
			lastModified: Date.now(),
			version: state.version + 1,
		}));
		this.scheduleSave();
		logger.debug("[AIConfigStore] 格式化功能已更新", { count: actions.length });
	}

	/**
	 * 更新AI拆分功能列表
	 */
	updateSplitActions(actions: AIAction[]) {
		this.store.update((state) => ({
			...state,
			customSplitActions: this.validateAndClone(actions, "split"),
			lastModified: Date.now(),
			version: state.version + 1,
		}));
		this.scheduleSave();
		logger.debug("[AIConfigStore] 拆分功能已更新", { count: actions.length });
	}

	/**
	 * 批量更新所有功能
	 */
	updateAllActions(formatActions: AIAction[], splitActions: AIAction[]) {
		this.store.update((state) => ({
			...state,
			customFormatActions: this.validateAndClone(formatActions, "format"),
			customSplitActions: this.validateAndClone(splitActions, "split"),
			lastModified: Date.now(),
			version: state.version + 1,
		}));
		this.scheduleSave();
		logger.debug("[AIConfigStore] 所有功能已批量更新");
	}

	// ============================================================================
	// Validation & Deep Clone
	// ============================================================================

	private validateAndClone(actions: AIAction[], expectedType: string): AIAction[] {
		const normalizedActions = normalizePersistedCustomActions(
			actions,
			expectedType === "split" ? "split" : "format"
		);
		return normalizedActions
			.filter((a) => hasPersistableActionIdentity(a, expectedType))
			.map((a) => this.deepCloneAction(a));
	}

	private deepCloneAction(action: AIAction): AIAction {
		try {
			const cloned = structuredClone(action);
			return {
				...cloned,
				provider: action.provider,
				model: action.model,
				splitConfig: action.splitConfig,
			};
		} catch (error) {
			logger.warn("[AIConfigStore] structuredClone失败，使用JSON fallback:", error);
			const cloned = JSON.parse(JSON.stringify(action)) as Partial<AIAction>;
			return {
				...cloned,
				id: action.id,
				name: action.name,
				type: action.type,
				category: action.category,
				systemPrompt: action.systemPrompt,
				userPromptTemplate: action.userPromptTemplate,
				provider: action.provider,
				model: action.model,
				splitConfig: action.splitConfig,
				description: action.description,
				icon: action.icon,
				enabled: action.enabled,
				createdAt: action.createdAt,
				updatedAt: action.updatedAt,
			};
		}
	}

	private ensurePluginAIConfig(): PersistedAIConfig {
		if (!this.plugin) {
			throw new Error("Plugin未初始化");
		}

		if (!this.plugin.settings.aiConfig) {
			this.plugin.settings.aiConfig = createDefaultPersistedAIConfig();
		}

		return this.plugin.settings.aiConfig;
	}

	// ============================================================================
	// Persistence (Debounced)
	// ============================================================================

	private scheduleSave() {
		if (this.saveDebounceTimer) {
			window.clearTimeout(this.saveDebounceTimer);
		}

		this.saveDebounceTimer = window.setTimeout(() => {
			void this.saveToPlugin();
		}, this.SAVE_DEBOUNCE_MS);
	}

	async saveToPlugin() {
		if (!this.plugin) {
			logger.error("[AIConfigStore] Plugin未初始化，无法保存");
			return;
		}

		const state = this.getState();
		const aiConfig = this.ensurePluginAIConfig();

		try {
			aiConfig.customFormatActions = structuredClone(state.customFormatActions);
			aiConfig.customSplitActions = structuredClone(state.customSplitActions);
		} catch (error) {
			logger.warn("[AIConfigStore] 保存时structuredClone失败，使用JSON fallback:", error);
			aiConfig.customFormatActions = JSON.parse(
				JSON.stringify(state.customFormatActions)
			) as AIAction[];
			aiConfig.customSplitActions = JSON.parse(
				JSON.stringify(state.customSplitActions)
			) as AIAction[];
		}

		try {
			await this.plugin.saveSettings();
			logger.info("[AIConfigStore] 配置已保存到磁盘", {
				version: state.version,
				formatActions: state.customFormatActions.length,
				splitActions: state.customSplitActions.length,
			});
		} catch (error) {
			logger.error("[AIConfigStore] 保存失败:", error);
			throw error;
		}
	}

	/**
	 * 强制立即保存（用于关闭时）
	 */
	async forceSave() {
		if (this.saveDebounceTimer) {
			window.clearTimeout(this.saveDebounceTimer);
			this.saveDebounceTimer = null;
		}
		await this.saveToPlugin();
	}

	/**
	 * 清理资源
	 */
	destroy() {
		if (this.saveDebounceTimer) {
			window.clearTimeout(this.saveDebounceTimer);
			this.saveDebounceTimer = null;
		}
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const aiConfigStore = new AIConfigStore();

// ============================================================================
// Derived Stores (Auto-computed)
// ============================================================================

/**
 * 所有格式化功能（官方 + 自定义）
 */
export const allFormatActions = derived(aiConfigStore, ($state) => {
	const official = OFFICIAL_FORMAT_ACTIONS.map((officialAction) => {
		return {
			...officialAction,
			type: "format" as const,
			category: "official" as const,
		};
	});

	const custom = $state.customFormatActions.map((customAction) => {
		return {
			...customAction,
			type: "format" as const,
			category: "custom" as const,
		};
	});

	return [...official, ...custom] as AIAction[];
});

/**
 * 所有可在菜单中显示的 AI 拆分功能（仅用户自定义）
 */
export const splitActionsForMenu = derived(aiConfigStore, ($state) => {
	return $state.customSplitActions.filter(
		(action) => hasPersistableActionIdentity(action, "split") && isActionContentReadyForMenu(action, "split")
	);
});

/**
 * 仅自定义功能（用于AI助手菜单）
 */
export const customActionsForMenu = derived(aiConfigStore, ($state) => ({
	format: $state.customFormatActions.filter(
		(a) => hasPersistableActionIdentity(a, "format") && isActionContentReadyForMenu(a, "format")
	),
	split: $state.customSplitActions.filter(
		(a) => hasPersistableActionIdentity(a, "split") && isActionContentReadyForMenu(a, "split")
	),
}));
