import type { SupportedLanguage } from "./types";

export type InterfaceLanguagePreference = "auto" | SupportedLanguage;

const PLUGIN_LANGUAGE_VALUES = new Set<SupportedLanguage>([
	"zh-CN",
	"zh-TW",
	"en-US",
	"ja-JP",
	"ko-KR",
	"ru-RU",
]);

export function normalizeInterfaceLanguagePreference(
	value: unknown
): InterfaceLanguagePreference {
	if (value === "auto") {
		return "auto";
	}

	if (typeof value === "string" && PLUGIN_LANGUAGE_VALUES.has(value as SupportedLanguage)) {
		return value as SupportedLanguage;
	}

	return "auto";
}

export function normalizeLocaleTag(input: string | null | undefined): string {
	return String(input || "")
		.trim()
		.toLowerCase()
		.replace(/_/g, "-");
}

/**
 * Map Obsidian / browser locale tags to a plugin-supported language.
 * Returns null when the tag is empty or not mapped yet (for example `ru` before ru-RU ships).
 */
export function mapObsidianLocaleToPluginLanguage(
	input: string | null | undefined
): SupportedLanguage | null {
	const tag = normalizeLocaleTag(input);
	if (!tag) {
		return null;
	}

	if (tag === "zh-tw" || tag === "zh-hk" || tag === "zh-hant") {
		return "zh-TW";
	}

	if (tag === "zh" || tag === "zh-cn" || tag === "zh-hans" || tag.startsWith("zh-")) {
		return "zh-CN";
	}

	if (tag === "ja" || tag.startsWith("ja-")) {
		return "ja-JP";
	}

	if (tag === "ko" || tag.startsWith("ko-")) {
		return "ko-KR";
	}

	if (tag === "en" || tag.startsWith("en-")) {
		return "en-US";
	}

	if (tag === "ru" || tag.startsWith("ru-")) {
		return "ru-RU";
	}

	return null;
}

export function resolveInterfaceLanguage(options: {
	preference?: InterfaceLanguagePreference | null;
	obsidianLanguage?: string | null;
	persistedLanguage?: string | null;
	browserLanguage?: string | null;
	fallback?: SupportedLanguage;
}): SupportedLanguage {
	const fallback = options.fallback ?? "en-US";
	const preference = normalizeInterfaceLanguagePreference(options.preference ?? "auto");

	if (preference !== "auto") {
		return preference;
	}

	for (const candidate of [
		options.obsidianLanguage,
		options.persistedLanguage,
		options.browserLanguage,
	]) {
		const mapped = mapObsidianLocaleToPluginLanguage(candidate);
		if (mapped) {
			return mapped;
		}
	}

	return fallback;
}
