import { TFile, type App, type WorkspaceLeaf } from "obsidian";

type LeafViewWithFile = {
	file?: TFile | { path?: unknown };
};

type WorkspaceWithIterate = App["workspace"] & {
	iterateAllLeaves?: (callback: (leaf: WorkspaceLeaf) => void) => void;
};

const FALLBACK_LEAF_VIEW_TYPES = [
	"markdown",
	"pdf",
	"canvas",
	"image",
	"audio",
	"video",
	"media",
] as const;

export function getLeafViewFile(leaf: WorkspaceLeaf): TFile | null {
	const file = (leaf.view as LeafViewWithFile | undefined)?.file;
	if (file instanceof TFile) {
		return file;
	}
	return file && typeof file.path === "string" ? (file as TFile) : null;
}

export function iterateAllWorkspaceLeaves(
	app: App,
	callback: (leaf: WorkspaceLeaf) => void
): void {
	const workspace = app.workspace as WorkspaceWithIterate;
	if (typeof workspace.iterateAllLeaves === "function") {
		workspace.iterateAllLeaves(callback);
		return;
	}

	const seen = new Set<WorkspaceLeaf>();
	for (const viewType of FALLBACK_LEAF_VIEW_TYPES) {
		for (const leaf of app.workspace.getLeavesOfType(viewType)) {
			if (seen.has(leaf)) {
				continue;
			}
			seen.add(leaf);
			callback(leaf);
		}
	}
}

export function focusWorkspaceLeaf(app: App, leaf: WorkspaceLeaf, focus = true): void {
	try {
		app.workspace.setActiveLeaf(leaf, { focus });
	} catch {
		/* ignore focus failures */
	}
	void app.workspace.revealLeaf(leaf);
}
