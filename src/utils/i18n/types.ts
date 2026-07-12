export type SupportedLanguage = "zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "ko-KR" | "ru-RU";

export interface TranslationKey {
	[key: string]: string | TranslationKey;
}

export interface I18nConfig {
	defaultLanguage: SupportedLanguage;
	fallbackLanguage: SupportedLanguage;
	supportedLanguages: SupportedLanguage[];
}
