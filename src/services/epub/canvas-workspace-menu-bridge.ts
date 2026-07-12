import type { Menu, Plugin } from "obsidian";

export const CANVAS_NODE_MENU_EVENT = "canvas:node-menu";
export const CANVAS_SELECTION_MENU_EVENT = "canvas:selection-menu";

export type CanvasNodeMenuHandler = (menu: Menu, node: { id?: string }) => void;
export type CanvasMenuHandler = (menu: Menu) => void;

export function registerCanvasWorkspaceMenuEvent(
	plugin: Plugin,
	eventName: string,
	handler: CanvasMenuHandler | CanvasNodeMenuHandler
): void {
	plugin.registerEvent(
		// @ts-expect-error Obsidian exposes canvas menu events at runtime.
		plugin.app.workspace.on(eventName, handler)
	);
}
