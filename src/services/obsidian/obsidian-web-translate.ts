import type { App } from "obsidian";
import { Platform } from "obsidian";
import {
	findResolvedWebTranslationProvider,
	listResolvedDictionaryProviders,
	listResolvedTranslationProviders,
	listResolvedWebTranslationProviders,
	normalizeSelectionTranslationSettings,
	type ResolvedWebTranslationProvider,
	type SelectionTranslationSettings,
} from "../../config/selection-translation-settings";
import type { BuiltinWebTranslationProviderDefinition } from "../../config/web-translation-providers";
import { getBuiltinWebTranslationProvider } from "../../config/web-translation-providers";
import { getEpubRuntime } from "../epub/epub-runtime";
import { buildWebUrlFromTemplate, isHttpWebUrl, openObsidianWebUrl } from "./obsidian-open-web-url";

type PluginWithSelectionTranslation = {
	settings?: {
		selectionTranslation?: unknown;
	};
};

export interface SelectionLookupOpenInput {
	query: string;
	context?: string;
}

async function copySelectionToClipboard(text: string): Promise<boolean> {
	const trimmed = text.trim();
	if (!trimmed) {
		return false;
	}

	try {
		if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(trimmed);
			return true;
		}
	} catch {
		return false;
	}

	return false;
}

function resolveEffectiveProvider(
	provider: ResolvedWebTranslationProvider,
	settings: SelectionTranslationSettings
): ResolvedWebTranslationProvider {
	if (
		provider.id === "eudic-app" &&
		!Platform.isMobile &&
		!settings.preferNativeDictionaryApp
	) {
		const webBuiltin = getBuiltinWebTranslationProvider("eudic-dict");
		if (webBuiltin && !settings.disabledBuiltinIds.includes("eudic-dict")) {
			return {
				...provider,
				id: webBuiltin.id,
				urlTemplate: webBuiltin.urlTemplate,
				fallbackProviderId: webBuiltin.fallbackProviderId,
				supportsContext: webBuiltin.supportsContext,
				preferExternalOpen: webBuiltin.preferExternalOpen,
			};
		}
	}

	return provider;
}

export async function openWebTranslationProvider(
	app: App,
	provider: ResolvedWebTranslationProvider,
	query: string,
	options?: {
		context?: string;
		settings?: SelectionTranslationSettings;
		resolveBuiltinLabel?: (provider: BuiltinWebTranslationProviderDefinition) => string;
	}
): Promise<boolean> {
	const settings = options?.settings ?? readSelectionTranslationSettings(app);
	const effectiveProvider = resolveEffectiveProvider(provider, settings);
	const context = options?.context ?? query;
	const url = buildWebUrlFromTemplate(effectiveProvider.urlTemplate, query, context);
	if (!url) {
		return false;
	}

	const opened = await openObsidianWebUrl(app, url, {
		preferExternal: effectiveProvider.preferExternalOpen,
	});
	if (opened) {
		if (
			settings.clipboardFallbackOnSchemeOpen &&
			!isHttpWebUrl(url) &&
			provider.id === "eudic-app"
		) {
			void copySelectionToClipboard(query);
		}
		return true;
	}

	if (provider.fallbackProviderId && options?.resolveBuiltinLabel) {
		const fallbackProvider = findResolvedWebTranslationProvider({
			settings,
			resolveBuiltinLabel: options.resolveBuiltinLabel,
			providerId: provider.fallbackProviderId,
		});
		if (fallbackProvider && fallbackProvider.id !== effectiveProvider.id) {
			return openWebTranslationProvider(app, fallbackProvider, query, {
				...options,
				settings,
			});
		}
	}

	if (settings.clipboardFallbackOnSchemeOpen) {
		return copySelectionToClipboard(query);
	}

	return false;
}

export function readSelectionTranslationSettings(app: App): SelectionTranslationSettings {
	const pluginId = getEpubRuntime().pluginId;
	const plugin = (app as App & { plugins?: { getPlugin?: (id: string) => unknown } }).plugins
		?.getPlugin?.(pluginId) as PluginWithSelectionTranslation | null;
	return normalizeSelectionTranslationSettings(plugin?.settings?.selectionTranslation);
}

export function listActiveWebTranslationProviders(input: {
	app: App;
	resolveBuiltinLabel: (provider: BuiltinWebTranslationProviderDefinition) => string;
}): ResolvedWebTranslationProvider[] {
	return listActiveSelectionLookupProviders(input);
}

export function listActiveDictionaryProviders(input: {
	app: App;
	resolveBuiltinLabel: (provider: BuiltinWebTranslationProviderDefinition) => string;
}): ResolvedWebTranslationProvider[] {
	return listResolvedDictionaryProviders({
		settings: readSelectionTranslationSettings(input.app),
		resolveBuiltinLabel: input.resolveBuiltinLabel,
	});
}

export function listActiveTranslationProviders(input: {
	app: App;
	resolveBuiltinLabel: (provider: BuiltinWebTranslationProviderDefinition) => string;
}): ResolvedWebTranslationProvider[] {
	return listResolvedTranslationProviders({
		settings: readSelectionTranslationSettings(input.app),
		resolveBuiltinLabel: input.resolveBuiltinLabel,
	});
}

export function listActiveSelectionLookupProviders(input: {
	app: App;
	resolveBuiltinLabel: (provider: BuiltinWebTranslationProviderDefinition) => string;
}): ResolvedWebTranslationProvider[] {
	return listResolvedWebTranslationProviders({
		settings: readSelectionTranslationSettings(input.app),
		resolveBuiltinLabel: input.resolveBuiltinLabel,
	});
}

export type { SelectionTranslationSettings, ResolvedWebTranslationProvider };
