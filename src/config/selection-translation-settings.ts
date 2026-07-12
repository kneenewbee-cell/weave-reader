import {
	BUILTIN_WEB_TRANSLATION_PROVIDERS,
	BUILTIN_WEB_TRANSLATION_PROVIDER_IDS,
	type BuiltinWebTranslationProviderDefinition,
	type SelectionLookupCategory,
} from "./web-translation-providers";

export type CustomSelectionLookupCategory = SelectionLookupCategory;

export interface CustomWebTranslationProvider {
	id: string;
	name: string;
	urlTemplate: string;
	enabled: boolean;
	category: CustomSelectionLookupCategory;
}

export interface SelectionTranslationSettings {
	disabledBuiltinIds: string[];
	customProviders: CustomWebTranslationProvider[];
	smartRoutingEnabled: boolean;
	preferNativeDictionaryApp: boolean;
	clipboardFallbackOnSchemeOpen: boolean;
}

export interface ResolvedWebTranslationProvider {
	id: string;
	label: string;
	urlTemplate: string;
	icon: string;
	builtin: boolean;
	category: SelectionLookupCategory;
	fallbackProviderId?: string;
	supportsContext?: boolean;
	preferExternalOpen?: boolean;
}

export const DEFAULT_SELECTION_TRANSLATION_SETTINGS: SelectionTranslationSettings = {
	disabledBuiltinIds: [],
	customProviders: [],
	smartRoutingEnabled: false,
	preferNativeDictionaryApp: false,
	clipboardFallbackOnSchemeOpen: true,
};

export function normalizeSelectionTranslationSettings(
	value: unknown
): SelectionTranslationSettings {
	if (!value || typeof value !== "object") {
		return { ...DEFAULT_SELECTION_TRANSLATION_SETTINGS };
	}

	const record = value as Partial<SelectionTranslationSettings>;
	const disabledBuiltinIds = Array.isArray(record.disabledBuiltinIds)
		? record.disabledBuiltinIds
				.map((id) => String(id || "").trim())
				.filter((id) => BUILTIN_WEB_TRANSLATION_PROVIDER_IDS.has(id))
		: [];

	const customProviders: CustomWebTranslationProvider[] = [];
	if (Array.isArray(record.customProviders)) {
		for (const entry of record.customProviders) {
			if (!entry || typeof entry !== "object") {
				continue;
			}
			const item = entry as Partial<CustomWebTranslationProvider>;
			const id = String(item.id || "").trim() || `custom-${customProviders.length + 1}`;
			const name = String(item.name || "").trim();
			const urlTemplate = String(item.urlTemplate || "").trim();
			if (!name || !urlTemplate.includes("{query}")) {
				continue;
			}
			const category =
				item.category === "dictionary" || item.category === "translation"
					? item.category
					: "translation";
			customProviders.push({
				id,
				name,
				urlTemplate,
				enabled: item.enabled !== false,
				category,
			});
		}
	}

	return {
		disabledBuiltinIds,
		customProviders,
		smartRoutingEnabled: record.smartRoutingEnabled === true,
		preferNativeDictionaryApp: record.preferNativeDictionaryApp === true,
		clipboardFallbackOnSchemeOpen: record.clipboardFallbackOnSchemeOpen !== false,
	};
}

export function isBuiltinTranslationEnabled(
	settings: SelectionTranslationSettings,
	providerId: string
): boolean {
	if (!BUILTIN_WEB_TRANSLATION_PROVIDER_IDS.has(providerId)) {
		return false;
	}
	return !settings.disabledBuiltinIds.includes(providerId);
}

export function createCustomTranslationProvider(input?: {
	name?: string;
	urlTemplate?: string;
	category?: CustomSelectionLookupCategory;
}): CustomWebTranslationProvider {
	return {
		id: `custom-${Date.now()}`,
		name: String(input?.name || "").trim() || "Custom",
		urlTemplate:
			String(input?.urlTemplate || "").trim() ||
			"https://translate.google.com/?sl=auto&tl=zh-CN&text={query}",
		enabled: true,
		category: input?.category === "dictionary" ? "dictionary" : "translation",
	};
}

function resolveBuiltinProvider(
	builtin: BuiltinWebTranslationProviderDefinition,
	resolveBuiltinLabel: (provider: BuiltinWebTranslationProviderDefinition) => string
): ResolvedWebTranslationProvider {
	return {
		id: builtin.id,
		label: resolveBuiltinLabel(builtin),
		urlTemplate: builtin.urlTemplate,
		icon: builtin.icon || "languages",
		builtin: true,
		category: builtin.category,
		fallbackProviderId: builtin.fallbackProviderId,
		supportsContext: builtin.supportsContext,
		preferExternalOpen: builtin.preferExternalOpen,
	};
}

export function listResolvedWebTranslationProviders(input: {
	settings: SelectionTranslationSettings;
	resolveBuiltinLabel: (provider: BuiltinWebTranslationProviderDefinition) => string;
	category?: SelectionLookupCategory;
}): ResolvedWebTranslationProvider[] {
	const providers: ResolvedWebTranslationProvider[] = [];

	for (const builtin of BUILTIN_WEB_TRANSLATION_PROVIDERS) {
		if (input.category && builtin.category !== input.category) {
			continue;
		}
		if (!isBuiltinTranslationEnabled(input.settings, builtin.id)) {
			continue;
		}
		providers.push(resolveBuiltinProvider(builtin, input.resolveBuiltinLabel));
	}

	for (const custom of input.settings.customProviders) {
		if (!custom.enabled) {
			continue;
		}
		if (input.category && custom.category !== input.category) {
			continue;
		}
		const name = String(custom.name || "").trim();
		const urlTemplate = String(custom.urlTemplate || "").trim();
		if (!name || !urlTemplate.includes("{query}")) {
			continue;
		}
		providers.push({
			id: custom.id,
			label: name,
			urlTemplate,
			icon: custom.category === "dictionary" ? "book-open" : "globe",
			builtin: false,
			category: custom.category,
		});
	}

	return providers;
}

export function listResolvedDictionaryProviders(input: {
	settings: SelectionTranslationSettings;
	resolveBuiltinLabel: (provider: BuiltinWebTranslationProviderDefinition) => string;
}): ResolvedWebTranslationProvider[] {
	return listResolvedWebTranslationProviders({ ...input, category: "dictionary" });
}

export function listResolvedTranslationProviders(input: {
	settings: SelectionTranslationSettings;
	resolveBuiltinLabel: (provider: BuiltinWebTranslationProviderDefinition) => string;
}): ResolvedWebTranslationProvider[] {
	return listResolvedWebTranslationProviders({ ...input, category: "translation" });
}

export function findResolvedWebTranslationProvider(input: {
	settings: SelectionTranslationSettings;
	resolveBuiltinLabel: (provider: BuiltinWebTranslationProviderDefinition) => string;
	providerId: string;
}): ResolvedWebTranslationProvider | null {
	return (
		listResolvedWebTranslationProviders({
			settings: input.settings,
			resolveBuiltinLabel: input.resolveBuiltinLabel,
		}).find((provider) => provider.id === input.providerId) ?? null
	);
}
