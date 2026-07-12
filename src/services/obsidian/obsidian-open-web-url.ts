import type { App } from "obsidian";
import { Platform } from "obsidian";

export const OBSIDIAN_WEB_VIEWER_PLUGIN_ID = "web-viewer";

export const OBSIDIAN_WEB_VIEWER_VIEW_TYPE = "webviewer";

interface WebViewerPluginInstance {
	getSearchEngineUrl?: (query: string) => string;
	openUrl?: (url: string, newLeaf?: boolean, active?: boolean) => void;
	openUrlExternally?: (url: string) => void;
}

interface InternalPluginsAccessor {
	getEnabledPluginById?: (id: string) => { instance?: WebViewerPluginInstance } | null;
	getPluginById?: (id: string) => { instance?: WebViewerPluginInstance } | null;
}

export function isHttpWebUrl(url: string): boolean {
	return /^https?:\/\//i.test(String(url || "").trim());
}

/** dict.eudic.net blocks in-app iframe embedding; must open externally for query URLs to work. */
export function shouldForceExternalWebOpen(url: string): boolean {
	const normalizedUrl = String(url || "").trim();
	if (!normalizedUrl) {
		return false;
	}
	try {
		const parsed = new URL(normalizedUrl);
		return parsed.hostname.toLowerCase() === "dict.eudic.net";
	} catch {
		return /^https:\/\/dict\.eudic\.net(?:[:/]|$)/i.test(normalizedUrl);
	}
}

/** Substitutes `{query}` and optional `{context}` with URL-encoded text. */
export function buildWebUrlFromTemplate(
	template: string,
	query: string,
	context?: string
): string {
	const trimmed = query.trim();
	if (!trimmed || !template.includes("{query}")) {
		return "";
	}

	const contextValue = String(context ?? trimmed).trim() || trimmed;
	let resolved = template;
	if (resolved.includes("{context}")) {
		resolved = resolved.split("{context}").join(encodeURIComponent(contextValue));
	}
	return resolved.split("{query}").join(encodeURIComponent(trimmed));
}

export function getWebViewerPluginInstance(app: App): WebViewerPluginInstance | null {
	const internalPlugins = (app as App & { internalPlugins?: InternalPluginsAccessor })
		.internalPlugins;
	if (!internalPlugins) {
		return null;
	}

	const plugin =
		internalPlugins.getEnabledPluginById?.(OBSIDIAN_WEB_VIEWER_PLUGIN_ID) ??
		internalPlugins.getPluginById?.(OBSIDIAN_WEB_VIEWER_PLUGIN_ID);
	return plugin?.instance ?? null;
}

async function openUrlInWebViewerTab(app: App, url: string): Promise<boolean> {
	if (!Platform.isDesktopApp) {
		return false;
	}

	try {
		const leaf = app.workspace.getLeaf(true);
		await leaf.setViewState({
			type: OBSIDIAN_WEB_VIEWER_VIEW_TYPE,
			state: {
				url,
				navigate: true,
			},
			active: true,
		});
		void app.workspace.revealLeaf(leaf);
		return true;
	} catch {
		return false;
	}
}

function openUrlViaWebViewerInstance(instance: WebViewerPluginInstance, url: string): boolean {
	if (typeof instance.openUrl !== "function") {
		return false;
	}

	try {
		instance.openUrl(url, true, true);
		return true;
	} catch {
		return false;
	}
}

function openUrlExternally(instance: WebViewerPluginInstance | null, url: string): boolean {
	if (instance && typeof instance.openUrlExternally === "function") {
		try {
			instance.openUrlExternally(url);
			return true;
		} catch {
			// Fall through.
		}
	}

	if (typeof window !== "undefined") {
		window.open(url, "_blank", "noopener,noreferrer");
		return true;
	}

	return false;
}

/**
 * Opens a URL in Obsidian Web Viewer when possible, with browser fallbacks.
 */
export async function openObsidianWebUrl(
	app: App,
	url: string,
	options?: {
		preferExternal?: boolean;
	}
): Promise<boolean> {
	const normalizedUrl = String(url || "").trim();
	if (!normalizedUrl) {
		return false;
	}

	const webViewerInstance = getWebViewerPluginInstance(app);
	const canUseWebViewer = isHttpWebUrl(normalizedUrl);
	const preferExternal =
		options?.preferExternal === true || shouldForceExternalWebOpen(normalizedUrl);

	if (
		!preferExternal &&
		canUseWebViewer &&
		webViewerInstance &&
		openUrlViaWebViewerInstance(webViewerInstance, normalizedUrl)
	) {
		return true;
	}

	if (!preferExternal && canUseWebViewer && (await openUrlInWebViewerTab(app, normalizedUrl))) {
		return true;
	}

	if (Platform.isDesktopApp && typeof window !== "undefined") {
		try {
			window.open(normalizedUrl, "_blank");
			return true;
		} catch {
			// Fall through.
		}
	}

	return openUrlExternally(webViewerInstance, normalizedUrl);
}
