import type { App } from "obsidian";

interface GlobalSearchPluginInstance {
	openGlobalSearch?: (query: string) => void;
}

interface InternalPluginsAccessor {
	getPluginById?: (id: string) => { instance?: GlobalSearchPluginInstance } | null;
}

const GLOBAL_SEARCH_PLUGIN_ID = "global-search";

/**
 * Opens Obsidian core global search (vault full-text) with the given query.
 */
export function openObsidianVaultSearch(app: App, query: string): boolean {
	const trimmed = query.trim();
	if (!trimmed) {
		return false;
	}

	const internalPlugins = (app as App & { internalPlugins?: InternalPluginsAccessor })
		.internalPlugins;
	const searchPlugin = internalPlugins?.getPluginById?.(GLOBAL_SEARCH_PLUGIN_ID);
	if (typeof searchPlugin?.instance?.openGlobalSearch === "function") {
		searchPlugin.instance.openGlobalSearch(trimmed);
		return true;
	}

	return false;
}
