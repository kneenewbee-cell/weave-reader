/**
 * Built-in web dictionary and translation providers for the selection toolbar.
 * URL templates must include `{query}` (URL-encoded on open).
 * Templates may also include `{context}` for surrounding sentence context.
 */
export type SelectionLookupCategory = "dictionary" | "translation";

export interface BuiltinWebTranslationProviderDefinition {
	id: string;
	/** i18n key under epub.translationProviders.* */
	nameKey: string;
	urlTemplate: string;
	icon?: string;
	category: SelectionLookupCategory;
	/** Built-in provider id to try when the primary open fails. */
	fallbackProviderId?: string;
	supportsContext?: boolean;
	/** Open in the system browser instead of Obsidian Web Viewer (required for dict.eudic.net). */
	preferExternalOpen?: boolean;
}

export const BUILTIN_WEB_TRANSLATION_PROVIDERS: BuiltinWebTranslationProviderDefinition[] = [
	{
		id: "eudic-dict",
		nameKey: "eudicDict",
		urlTemplate: "https://dict.eudic.net/dicts/en/{query}",
		icon: "book-open",
		category: "translation",
		preferExternalOpen: true,
	},
	{
		id: "eudic-app",
		nameKey: "eudicApp",
		urlTemplate: "eudic://dict/{query}?context={context}",
		icon: "book-open",
		category: "translation",
		fallbackProviderId: "eudic-dict",
		supportsContext: true,
		preferExternalOpen: true,
	},
	{
		id: "youdao-dict",
		nameKey: "youdaoDict",
		urlTemplate: "https://dict.youdao.com/result?word={query}&lang=en",
		icon: "book-open",
		category: "translation",
	},
	{
		id: "google-translate",
		nameKey: "googleTranslate",
		urlTemplate: "https://translate.google.com/?sl=auto&tl=zh-CN&op=translate&text={query}",
		icon: "languages",
		category: "translation",
	},
	{
		id: "deepl",
		nameKey: "deepl",
		urlTemplate: "https://www.deepl.com/translator#auto/zh/{query}",
		icon: "languages",
		category: "translation",
	},
	{
		id: "youdao-translate",
		nameKey: "youdaoTranslate",
		urlTemplate: "https://fanyi.youdao.com/index.html#/?query={query}",
		icon: "languages",
		category: "translation",
	},
	{
		id: "bing-translate",
		nameKey: "bingTranslate",
		urlTemplate: "https://www.bing.com/translator?text={query}",
		icon: "languages",
		category: "translation",
	},
	{
		id: "baidu-translate",
		nameKey: "baiduTranslate",
		urlTemplate: "https://fanyi.baidu.com/mtpe-individual/transText?query={query}&from=auto&to=zh",
		icon: "languages",
		category: "translation",
	},
];

export const BUILTIN_WEB_TRANSLATION_PROVIDER_IDS = new Set(
	BUILTIN_WEB_TRANSLATION_PROVIDERS.map((provider) => provider.id)
);

export const BUILTIN_DICTIONARY_PROVIDER_IDS = BUILTIN_WEB_TRANSLATION_PROVIDERS.filter(
	(provider) => provider.category === "dictionary"
).map((provider) => provider.id);

export const BUILTIN_TRANSLATION_PROVIDER_IDS = BUILTIN_WEB_TRANSLATION_PROVIDERS.filter(
	(provider) => provider.category === "translation"
).map((provider) => provider.id);

export function getBuiltinWebTranslationProvider(
	providerId: string
): BuiltinWebTranslationProviderDefinition | null {
	return BUILTIN_WEB_TRANSLATION_PROVIDERS.find((provider) => provider.id === providerId) ?? null;
}
