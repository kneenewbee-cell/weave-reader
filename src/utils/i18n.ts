import { getLanguage } from "obsidian";
import { logger } from "../utils/logger";
import { vaultStorage } from "../utils/vault-local-storage";
import {
	mergeTranslationTrees,
	translations,
	translationOverrides,
} from "./i18n/resources";
import type { I18nConfig, SupportedLanguage, TranslationKey } from "./i18n/types";
import {
	normalizeInterfaceLanguagePreference,
	resolveInterfaceLanguage,
	type InterfaceLanguagePreference,
} from "./i18n/locale-resolver";
import { derived, get, writable } from "svelte/store";

export type { I18nConfig, SupportedLanguage, TranslationKey } from "./i18n/types";
export type { InterfaceLanguagePreference } from "./i18n/locale-resolver";
export { normalizeInterfaceLanguagePreference } from "./i18n/locale-resolver";
export { flattenTranslationLeafKeys } from "./i18n/flat-locale";

export const translationCatalog: Record<SupportedLanguage, TranslationKey> = {
	"zh-CN": mergeTranslationTrees(translations["zh-CN"], translationOverrides["zh-CN"]),
	"zh-TW": mergeTranslationTrees(translations["zh-TW"], translationOverrides["zh-TW"]),
	"en-US": mergeTranslationTrees(translations["en-US"], translationOverrides["en-US"]),
	"ja-JP": mergeTranslationTrees(translations["ja-JP"], translationOverrides["ja-JP"]),
	"ko-KR": mergeTranslationTrees(translations["ko-KR"], translationOverrides["ko-KR"]),
	"ru-RU": mergeTranslationTrees(translations["ru-RU"], translationOverrides["ru-RU"]),
};

const defaultConfig: I18nConfig = {
	defaultLanguage: "zh-CN",
	fallbackLanguage: "en-US",
	supportedLanguages: ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR", "ru-RU"],
};

const translationKeyAliases: Record<string, string> = {};

const translationAliasSuffixes = [
	["Label", "label"],
	["Desc", "description"],
	["Description", "description"],
	["Placeholder", "placeholder"],
	["Title", "title"],
	["Button", "button"],
	["Help", "help"],
	["Error", "error"],
	["Success", "success"],
	["Warning", "warning"],
	["Info", "info"],
] as const;

function getTranslationAliasCandidates(key: string): string[] {
	const candidates = new Set<string>();
	const directAlias = translationKeyAliases[key];

	if (directAlias) {
		candidates.add(directAlias);
	}

	const parts = key.split(".");
	const lastSegment = parts.at(-1) ?? "";

	for (const [suffix, targetSegment] of translationAliasSuffixes) {
		if (!lastSegment.endsWith(suffix) || lastSegment.length <= suffix.length) {
			continue;
		}

		const baseSegment = lastSegment.slice(0, -suffix.length);
		const normalizedBase = `${baseSegment.charAt(0).toLowerCase()}${baseSegment.slice(1)}`;
		candidates.add([...parts.slice(0, -1), normalizedBase, targetSegment].join("."));
		candidates.add([...parts.slice(0, -1), normalizedBase].join("."));

		if (targetSegment === "description") {
			candidates.add([...parts.slice(0, -1), normalizedBase, "desc"].join("."));
		}
	}

	if (lastSegment === "connected" || lastSegment === "disconnected" || lastSegment === "testing") {
		candidates.add([...parts.slice(0, -1), "statusLabel", lastSegment].join("."));
		candidates.add([...parts.slice(0, -1), "status", lastSegment].join("."));
	}

	if (key.includes(".endpoint")) {
		candidates.add(key.replace(".endpoint", ".address"));
	}

	return [...candidates];
}

let interfaceLanguagePreference: InterfaceLanguagePreference = "auto";

export function setInterfaceLanguagePreference(
	preference: InterfaceLanguagePreference | null | undefined
): void {
	interfaceLanguagePreference = normalizeInterfaceLanguagePreference(preference);
}

export function getInterfaceLanguagePreference(): InterfaceLanguagePreference {
	return interfaceLanguagePreference;
}

function detectInterfaceLanguage(): SupportedLanguage {
	try {
		return resolveInterfaceLanguage({
			preference: interfaceLanguagePreference,
			obsidianLanguage: getLanguage(),
			persistedLanguage: vaultStorage.getItem("language"),
			browserLanguage:
				typeof window !== "undefined" ? window.navigator.language : null,
			fallback: defaultConfig.fallbackLanguage,
		});
	} catch {
		return defaultConfig.fallbackLanguage;
	}
}

// ============================================================================
// 状态管理
// ============================================================================

export const currentLanguage = writable<SupportedLanguage>(defaultConfig.defaultLanguage);

export function syncI18nLanguage(): SupportedLanguage {
	const detectedLang = detectInterfaceLanguage();
	if (get(currentLanguage) !== detectedLang) {
		currentLanguage.set(detectedLang);
	}
	return detectedLang;
}

/** @deprecated Use {@link syncI18nLanguage} */
export const syncI18nWithObsidianLanguage = syncI18nLanguage;

/**
 * 初始化国际化系统
 * 应在插件 onload、且 vault local storage 初始化后调用
 */
export function initI18n(preference?: InterfaceLanguagePreference): void {
	if (preference !== undefined) {
		setInterfaceLanguagePreference(preference);
	}
	syncI18nLanguage();
}
export const i18nConfig = writable<I18nConfig>(defaultConfig);

// ============================================================================
// 国际化服务类
// ============================================================================

export class I18nService {
	private static instance: I18nService;
	private currentLang: SupportedLanguage = defaultConfig.defaultLanguage;
	private config: I18nConfig = defaultConfig;
	private readonly missingKeyWarnings = new Set<string>();

	private constructor() {
		// 订阅语言变化
		currentLanguage.subscribe((_lang) => {
			this.currentLang = _lang;
		});

		// 订阅配置变化
		i18nConfig.subscribe((_config) => {
			this.config = _config;
		});
	}

	static getInstance(): I18nService {
		if (!I18nService.instance) {
			I18nService.instance = new I18nService();
		}
		return I18nService.instance;
	}

	/**
	 * 获取翻译文本
	 */
	t(key: string, params?: Record<string, string | number>): string {
		const translation = this.resolveTranslation(key, this.currentLang);

		if (!translation) {
			// 尝试回退语言
			const fallbackTranslation =
				this.currentLang === this.config.fallbackLanguage
					? null
					: this.resolveTranslation(key, this.config.fallbackLanguage);
			if (fallbackTranslation) {
				return this.interpolate(fallbackTranslation, params);
			}

			if (!this.missingKeyWarnings.has(key)) {
				this.missingKeyWarnings.add(key);
				logger.warn(
					`Translation not found for key: ${key} (lang: ${this.currentLang}, fallback: ${this.config.fallbackLanguage})`
				);
			}

			return key;
		}

		return this.interpolate(translation, params);
	}

	/**
	 * 检查当前语言或回退语言是否存在翻译（含兼容别名）
	 */
	hasTranslation(key: string): boolean {
		return Boolean(
			this.resolveTranslation(key, this.currentLang) ||
				(this.currentLang !== this.config.fallbackLanguage &&
					this.resolveTranslation(key, this.config.fallbackLanguage))
		);
	}

	/**
	 * 获取指定语言的翻译（含兼容别名）
	 */
	private resolveTranslation(key: string, language: SupportedLanguage): string | null {
		const directTranslation = this.getDirectTranslation(key, language);
		if (directTranslation) {
			return directTranslation;
		}

		for (const aliasKey of getTranslationAliasCandidates(key)) {
			const aliasTranslation = this.getDirectTranslation(aliasKey, language);
			if (aliasTranslation) {
				return aliasTranslation;
			}
		}

		return null;
	}

	/**
	 * 获取指定语言的直接翻译
	 */
	private getDirectTranslation(key: string, language: SupportedLanguage): string | null {
		const keys = key.split(".");
		let current: TranslationKey | string | undefined = translationCatalog[language];

		for (const k of keys) {
			if (typeof current === "object" && current !== null && k in current) {
				current = current[k];
			} else {
				return null;
			}
		}

		return typeof current === "string" ? current : null;
	}

	/**
	 * 插值处理
	 */
	private interpolate(text: string, params?: Record<string, string | number>): string {
		if (!params) return text;

		return text.replace(/\{(\w+)\}/g, (match, key: string) => {
			return params[key]?.toString() || match;
		});
	}

	/**
	 * 设置当前语言
	 */
	setLanguage(language: SupportedLanguage): void {
		if (this.config.supportedLanguages.includes(language)) {
			currentLanguage.set(language);
		} else {
			logger.warn(`Unsupported language: ${language}`);
		}
	}

	/**
	 * 获取当前语言
	 */
	getCurrentLanguage(): SupportedLanguage {
		return this.currentLang;
	}

	/**
	 * 获取支持的语言列表
	 */
	getSupportedLanguages(): SupportedLanguage[] {
		return this.config.supportedLanguages;
	}

	/**
	 * 检查是否支持指定语言
	 */
	isLanguageSupported(language: string): language is SupportedLanguage {
		return this.config.supportedLanguages.includes(language as SupportedLanguage);
	}
}

// ============================================================================
// 导出实例和工具函数
// ============================================================================

export const i18n = I18nService.getInstance();

// 便捷的翻译函数
export const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);

// Svelte store 用于响应式翻译
export const tr = derived(
	currentLanguage,
	(_$currentLanguage) => (key: string, params?: Record<string, string | number>) =>
		i18n.t(key, params)
);

// 用于渲染列表型文案（按换行拆分）。缺失翻译时返回空数组，避免渲染键名。
export const trArray = derived(currentLanguage, (_$currentLanguage) =>
	(key: string): string[] => {
		if (!i18n.hasTranslation(key)) return [];
		const text = i18n.t(key);
		if (!text) return [];
		return text
			.split("\n")
			.map((item) => item.trim())
			.filter(Boolean);
	});
