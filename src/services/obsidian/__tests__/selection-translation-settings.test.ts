import { describe, expect, it } from "vitest";
import {
	listResolvedDictionaryProviders,
	listResolvedTranslationProviders,
	normalizeSelectionTranslationSettings,
} from "../../../config/selection-translation-settings";
import {
	buildWebUrlFromTemplate,
	isHttpWebUrl,
	shouldForceExternalWebOpen,
} from "../obsidian-open-web-url";
import {
	extractSelectionContext,
	isDictionaryLookupCandidate,
} from "../selection-lookup-routing";

describe("selection-translation-settings", () => {
	it("enables all built-in providers by default", () => {
		const providers = listResolvedTranslationProviders({
			settings: normalizeSelectionTranslationSettings(undefined),
			resolveBuiltinLabel: (provider) => provider.nameKey,
		});
		expect(providers.length).toBeGreaterThanOrEqual(4);
		expect(providers.some((provider) => provider.id === "google-translate")).toBe(true);
		expect(providers.some((provider) => provider.id === "eudic-dict")).toBe(true);
	});

	it("does not expose removed dictionary-only providers", () => {
		const settings = normalizeSelectionTranslationSettings(undefined);
		const providers = listResolvedTranslationProviders({
			settings,
			resolveBuiltinLabel: (provider) => provider.nameKey,
		});
		expect(providers.some((provider) => provider.id === "collins")).toBe(false);
		expect(providers.some((provider) => provider.id === "cambridge")).toBe(false);
		expect(providers.some((provider) => provider.id === "reverso-context")).toBe(false);
	});

	it("lists eudic providers under translation", () => {
		const settings = normalizeSelectionTranslationSettings(undefined);
		const providers = listResolvedTranslationProviders({
			settings,
			resolveBuiltinLabel: (provider) => provider.nameKey,
		});
		expect(providers.some((provider) => provider.id === "eudic-dict")).toBe(true);
		expect(providers.some((provider) => provider.id === "eudic-app")).toBe(true);
		expect(providers.every((provider) => provider.category === "translation")).toBe(true);
	});

	it("respects disabled built-in ids", () => {
		const providers = listResolvedTranslationProviders({
			settings: {
				disabledBuiltinIds: ["google-translate"],
				customProviders: [],
				smartRoutingEnabled: false,
				preferNativeDictionaryApp: false,
				clipboardFallbackOnSchemeOpen: true,
			},
			resolveBuiltinLabel: (provider) => provider.nameKey,
		});
		expect(providers.some((provider) => provider.id === "google-translate")).toBe(false);
	});

	it("includes enabled custom providers with {query} template", () => {
		const providers = listResolvedTranslationProviders({
			settings: {
				disabledBuiltinIds: [
					"eudic-dict",
					"eudic-app",
					"youdao-dict",
					"google-translate",
					"deepl",
					"youdao-translate",
					"bing-translate",
					"baidu-translate",
				],
				customProviders: [
					{
						id: "custom-1",
						name: "My translator",
						urlTemplate: "https://example.com/?q={query}",
						enabled: true,
						category: "translation",
					},
				],
				smartRoutingEnabled: false,
				preferNativeDictionaryApp: false,
				clipboardFallbackOnSchemeOpen: true,
			},
			resolveBuiltinLabel: (provider) => provider.nameKey,
		});
		expect(providers).toEqual([
			expect.objectContaining({
				id: "custom-1",
				label: "My translator",
				builtin: false,
				category: "translation",
			}),
		]);
	});

	it("normalizes smart routing settings with defaults", () => {
		expect(normalizeSelectionTranslationSettings(undefined)).toEqual(
			expect.objectContaining({
				smartRoutingEnabled: false,
				preferNativeDictionaryApp: false,
				clipboardFallbackOnSchemeOpen: true,
			})
		);
	});

	it("keeps dictionary category filter empty for legacy callers", () => {
		const providers = listResolvedDictionaryProviders({
			settings: normalizeSelectionTranslationSettings(undefined),
			resolveBuiltinLabel: (provider) => provider.nameKey,
		});
		expect(providers).toEqual([]);
	});
});

describe("obsidian-open-web-url helpers", () => {
	it("builds urls with query and context placeholders", () => {
		expect(
			buildWebUrlFromTemplate(
				"eudic://dict/{query}?context={context}",
				"task",
				"This is a task."
			)
		).toBe("eudic://dict/task?context=This%20is%20a%20task.");
	});

	it("detects http urls", () => {
		expect(isHttpWebUrl("https://dict.eudic.net/dicts/en/test")).toBe(true);
		expect(isHttpWebUrl("eudic://dict/test")).toBe(false);
	});

	it("forces external open for dict.eudic.net", () => {
		expect(shouldForceExternalWebOpen("https://dict.eudic.net/dicts/en/hello")).toBe(true);
		expect(shouldForceExternalWebOpen("https://translate.google.com/?text=hello")).toBe(false);
	});
});

describe("selection-lookup-routing", () => {
	it("treats short words as dictionary candidates", () => {
		expect(isDictionaryLookupCandidate("ephemeral")).toBe(true);
		expect(isDictionaryLookupCandidate("look up")).toBe(true);
		expect(isDictionaryLookupCandidate("This is a longer sentence for translation.")).toBe(
			false
		);
	});

	it("falls back to selected text when iframe selection is unavailable", () => {
		expect(extractSelectionContext(null, "task")).toBe("task");
	});
});
