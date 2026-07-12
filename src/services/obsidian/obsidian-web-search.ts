import type { App } from "obsidian";
import {
	buildWebUrlFromTemplate,
	getWebViewerPluginInstance,
	openObsidianWebUrl,
} from "./obsidian-open-web-url";

export { OBSIDIAN_WEB_VIEWER_PLUGIN_ID, OBSIDIAN_WEB_VIEWER_VIEW_TYPE } from "./obsidian-open-web-url";

/** Default when Web Viewer search engine URL builder is unavailable. */
export const DEFAULT_WEB_SEARCH_URL = "https://www.google.com/search?q={query}";

export function buildFallbackWebSearchUrl(
	query: string,
	template = DEFAULT_WEB_SEARCH_URL
): string {
	return buildWebUrlFromTemplate(template, query);
}

export function resolveObsidianWebSearchUrl(
	app: App,
	query: string,
	fallbackTemplate = DEFAULT_WEB_SEARCH_URL
): string {
	const trimmed = query.trim();
	if (!trimmed) {
		return "";
	}

	const instance = getWebViewerPluginInstance(app);
	if (instance?.getSearchEngineUrl) {
		try {
			const url = String(instance.getSearchEngineUrl(trimmed) || "").trim();
			if (url) {
				return url;
			}
		} catch {
			// Fall through to template URL.
		}
	}

	return buildFallbackWebSearchUrl(trimmed, fallbackTemplate);
}

export async function openObsidianWebSearch(app: App, query: string): Promise<boolean> {
	const url = resolveObsidianWebSearchUrl(app, query);
	if (!url) {
		return false;
	}
	return openObsidianWebUrl(app, url);
}
