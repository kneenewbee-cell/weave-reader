import { Notice, type App, type Plugin } from "obsidian";
import { i18n } from "../../utils/i18n";
import {
	getCanvasExcerptAnchorState,
	readCanvasExcerptAnchorStateFromCache,
	resolveActiveCanvasFilePath,
	setCanvasExcerptAnchorLock,
	warmCanvasExcerptAnchorCache,
} from "./canvas-excerpt-anchor";
import {
	CANVAS_NODE_MENU_EVENT,
	registerCanvasWorkspaceMenuEvent,
} from "./canvas-workspace-menu-bridge";

async function toggleCanvasExcerptAnchorLock(
	app: App,
	canvasPath: string,
	nodeId: string
): Promise<void> {
	const normalizedNodeId = String(nodeId || "").trim();
	if (!normalizedNodeId) {
		new Notice(i18n.t("epub.reader.canvasExcerptAnchorSelectOne"));
		return;
	}

	const current = await getCanvasExcerptAnchorState(app, canvasPath);
	const isLocked = String(current.lockedNodeId || "").trim() === normalizedNodeId;
	const nextLock = isLocked ? null : normalizedNodeId;
	await setCanvasExcerptAnchorLock(app, canvasPath, nextLock);
	new Notice(
		i18n.t(
			nextLock
				? "epub.reader.canvasExcerptAnchorLocked"
				: "epub.reader.canvasExcerptAnchorUnlocked"
		)
	);
}

function registerCanvasNodePinMenu(app: App, plugin: Plugin): void {
	registerCanvasWorkspaceMenuEvent(plugin, CANVAS_NODE_MENU_EVENT, (menu, node) => {
		const canvasPath = resolveActiveCanvasFilePath(app);
		const nodeId = String(node?.id || "").trim();
		if (!canvasPath || !nodeId) {
			return;
		}

		const state = readCanvasExcerptAnchorStateFromCache(app, canvasPath);
		const isLocked = String(state.lockedNodeId || "").trim() === nodeId;
		menu.addItem((item) => {
			item
				.setTitle(
					i18n.t(
						isLocked
							? "epub.reader.canvasExcerptAnchorUnlock"
							: "epub.reader.canvasExcerptAnchorLock"
					)
				)
				.setIcon("pin")
				.setChecked(isLocked)
				.onClick(() => {
					void toggleCanvasExcerptAnchorLock(app, canvasPath, nodeId);
				});
		});
		void warmCanvasExcerptAnchorCache(app, canvasPath);
	});
}

export function registerCanvasExcerptAnchorMenu(plugin: Plugin): void {
	registerCanvasNodePinMenu(plugin.app, plugin);
}
