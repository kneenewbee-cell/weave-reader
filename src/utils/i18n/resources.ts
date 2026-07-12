import type { SupportedLanguage, TranslationKey } from './types';
import {
	appShellEpubTranslations,
	appShellEpubTranslationOverrides,
} from './resources/app-shell-epub';
import { epubTranslations, epubTranslationOverrides } from './resources/epub';
import { mergeFlatLocaleOverlay, mergeTranslationTrees } from './flat-locale';
import jaJpCuratedOverlay from './overlays/ja-JP.json';
import koKrCuratedOverlay from './overlays/ko-KR.json';
import ruRuCuratedOverlay from './overlays/ru-RU.json';
import zhTwCuratedOverlay from './overlays/zh-TW.json';

const zhCNCatalog: TranslationKey = {
	...appShellEpubTranslations['zh-CN'],
	...epubTranslations['zh-CN'],
};

const enUSCatalog: TranslationKey = {
	...appShellEpubTranslations['en-US'],
	...epubTranslations['en-US'],
};

function buildLocalizedCatalog(
	base: TranslationKey,
	flatOverlay: Record<string, string>
): TranslationKey {
	if (Object.keys(flatOverlay).length === 0) {
		return base;
	}
	return mergeFlatLocaleOverlay(base, flatOverlay);
}

export const translations: Record<SupportedLanguage, TranslationKey> = {
	'zh-CN': zhCNCatalog,
	'zh-TW': buildLocalizedCatalog(zhCNCatalog, zhTwCuratedOverlay as Record<string, string>),
	'en-US': enUSCatalog,
	'ja-JP': buildLocalizedCatalog(enUSCatalog, jaJpCuratedOverlay as Record<string, string>),
	'ko-KR': buildLocalizedCatalog(enUSCatalog, koKrCuratedOverlay as Record<string, string>),
	'ru-RU': buildLocalizedCatalog(enUSCatalog, ruRuCuratedOverlay as Record<string, string>),
};

export const translationOverrides: Partial<Record<SupportedLanguage, TranslationKey>> = {
	'zh-CN': {
		...appShellEpubTranslationOverrides['zh-CN'],
		...epubTranslationOverrides['zh-CN'],
	},
	'en-US': {
		...appShellEpubTranslationOverrides['en-US'],
		...epubTranslationOverrides['en-US'],
	},
	'zh-TW': {},
	'ja-JP': {},
	'ko-KR': {},
	'ru-RU': {},
};

export { mergeTranslationTrees };
