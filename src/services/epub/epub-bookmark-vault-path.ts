import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import {
	DEFAULT_EPUB_BOOKMARK_FOLDER,
	isPathUnderEpubBookmarkFolder,
	normalizeEpubBookmarkFolderPath,
} from "./epub-bookmark-folder-path";
import { getEpubRuntime } from "./epub-runtime";
import { getCompatiblePlugin } from "../../utils/plugin-access";

export function resolveEpubBookmarkFolderForApp(app: App): string {
	const runtimePluginId = getEpubRuntime().pluginId;
	const pluginLookup = app as App & {
		plugins?: {
			getPlugin?: (id: string) => { settings?: { bookmarkFolder?: string } } | null;
		};
	};
	const plugin =
		pluginLookup.plugins?.getPlugin?.(runtimePluginId) ??
		(getCompatiblePlugin(pluginLookup as unknown) as { settings?: { bookmarkFolder?: string } } | null);
	return (
		normalizeEpubBookmarkFolderPath(plugin?.settings?.bookmarkFolder) ||
		DEFAULT_EPUB_BOOKMARK_FOLDER
	);
}

/**
 * Paths maintained by the EPUB bookmark page (data notes, covers). Vault writes here
 * must not re-trigger reader highlight aggregation — otherwise syncAnalytics loops.
 */
export function isEpubBookmarkManagedVaultPath(app: App, path?: string | null): boolean {
	const normalizedPath = normalizePath(String(path || "").trim());
	if (!normalizedPath) {
		return false;
	}

	const bookmarkFolder = resolveEpubBookmarkFolderForApp(app);
	return isPathUnderEpubBookmarkFolder(normalizedPath, bookmarkFolder);
}
