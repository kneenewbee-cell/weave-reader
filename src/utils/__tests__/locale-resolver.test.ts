import { describe, expect, it } from "vitest";
import {
	mapObsidianLocaleToPluginLanguage,
	normalizeInterfaceLanguagePreference,
	resolveInterfaceLanguage,
} from "../i18n/locale-resolver";

describe("locale-resolver", () => {
	it("maps Obsidian locale tags to plugin languages", () => {
		expect(mapObsidianLocaleToPluginLanguage("zh")).toBe("zh-CN");
		expect(mapObsidianLocaleToPluginLanguage("zh-cn")).toBe("zh-CN");
		expect(mapObsidianLocaleToPluginLanguage("zh_TW")).toBe("zh-TW");
		expect(mapObsidianLocaleToPluginLanguage("zh-hk")).toBe("zh-TW");
		expect(mapObsidianLocaleToPluginLanguage("ja")).toBe("ja-JP");
		expect(mapObsidianLocaleToPluginLanguage("ja-JP")).toBe("ja-JP");
		expect(mapObsidianLocaleToPluginLanguage("ko")).toBe("ko-KR");
		expect(mapObsidianLocaleToPluginLanguage("en")).toBe("en-US");
		expect(mapObsidianLocaleToPluginLanguage("en-gb")).toBe("en-US");
		expect(mapObsidianLocaleToPluginLanguage("ru")).toBe("ru-RU");
		expect(mapObsidianLocaleToPluginLanguage("ru-RU")).toBe("ru-RU");
	});

	it("returns null for unsupported locales instead of forcing English", () => {
		expect(mapObsidianLocaleToPluginLanguage("de")).toBeNull();
		expect(mapObsidianLocaleToPluginLanguage("")).toBeNull();
	});

	it("honors explicit plugin preference over Obsidian locale", () => {
		expect(
			resolveInterfaceLanguage({
				preference: "zh-CN",
				obsidianLanguage: "en",
			})
		).toBe("zh-CN");
	});

	it("follows Obsidian locale in auto mode", () => {
		expect(
			resolveInterfaceLanguage({
				preference: "auto",
				obsidianLanguage: "ja",
			})
		).toBe("ja-JP");
	});

	it("follows Russian Obsidian locale in auto mode", () => {
		expect(
			resolveInterfaceLanguage({
				preference: "auto",
				obsidianLanguage: "ru",
			})
		).toBe("ru-RU");
	});

	it("falls back to persisted and browser locales in auto mode", () => {
		expect(
			resolveInterfaceLanguage({
				preference: "auto",
				obsidianLanguage: "de",
				persistedLanguage: "ko",
			})
		).toBe("ko-KR");

		expect(
			resolveInterfaceLanguage({
				preference: "auto",
				obsidianLanguage: "de",
				persistedLanguage: "fr",
				browserLanguage: "zh-CN",
			})
		).toBe("zh-CN");
	});

	it("normalizes stored interface language preference", () => {
		expect(normalizeInterfaceLanguagePreference("zh-TW")).toBe("zh-TW");
		expect(normalizeInterfaceLanguagePreference("ja-JP")).toBe("ja-JP");
		expect(normalizeInterfaceLanguagePreference("auto")).toBe("auto");
		expect(normalizeInterfaceLanguagePreference("ru-RU")).toBe("ru-RU");
		expect(normalizeInterfaceLanguagePreference(undefined)).toBe("auto");
	});
});
