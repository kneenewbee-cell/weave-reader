import { normalizePath } from "obsidian";
import { getPluginPathsById } from "../../config/paths";

export function resolveEpubUnifiedLocalDataPath(app: unknown, localPluginId: string): string {
	return normalizePath(`${getPluginPathsById(app, localPluginId).state.epubLocalState}`);
}

export function resolveEpubLegacyUnifiedLocalDataPaths(
	app: unknown,
	localPluginId: string
): string[] {
	const targetPath = resolveEpubUnifiedLocalDataPath(app, localPluginId);
	return Array.from(
		new Set([
			normalizePath(
				`${getPluginPathsById(app, localPluginId).state.incrementalReading.epubReaderData}`
			),
		])
	).filter((path) => Boolean(path) && path !== targetPath);
}

export function listEpubUnifiedLocalDataCandidatePaths(
	app: unknown,
	localPluginId: string
): string[] {
	return [
		resolveEpubUnifiedLocalDataPath(app, localPluginId),
		...resolveEpubLegacyUnifiedLocalDataPaths(app, localPluginId),
	];
}
