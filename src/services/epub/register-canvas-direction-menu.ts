import { Menu, type App, type Plugin } from "obsidian";
import { i18n } from "../../utils/i18n";
import type { CanvasLayoutDirection } from "./canvas-types";
import {
	readCanvasExcerptLayoutDirectionFromCache,
	resolveActiveCanvasFilePath,
	setCanvasExcerptLayoutDirection,
	warmCanvasExcerptAnchorCache,
} from "./canvas-excerpt-anchor";
import {
	CANVAS_NODE_MENU_EVENT,
	CANVAS_SELECTION_MENU_EVENT,
	registerCanvasWorkspaceMenuEvent,
} from "./canvas-workspace-menu-bridge";

function resolveMenuSubmenu(item: unknown): Menu {
	const candidate = item as { setSubmenu?: () => Menu };
	if (typeof candidate.setSubmenu === "function") {
		return candidate.setSubmenu();
	}
	throw new Error("Menu item does not support submenu");
}

const DIRECTION_OPTIONS: Array<{
	dir: CanvasLayoutDirection;
	icon: string;
	labelKey: string;
}> = [
	{ dir: "down", icon: "arrow-down", labelKey: "views.epubView.direction.down" },
	{ dir: "right", icon: "arrow-right", labelKey: "views.epubView.direction.right" },
	{ dir: "up", icon: "arrow-up", labelKey: "views.epubView.direction.up" },
	{ dir: "left", icon: "arrow-left", labelKey: "views.epubView.direction.left" },
];

function appendCanvasDirectionItems(
	app: App,
	menu: Menu,
	canvasPath: string,
	currentDirection: CanvasLayoutDirection
): void {
	menu.addSeparator();
	const currentIcon =
		DIRECTION_OPTIONS.find((option) => option.dir === currentDirection)?.icon ?? "arrow-down";
	menu.addItem((item) => {
		item.setTitle(i18n.t("epub.reader.canvasExcerptDirectionMenu")).setIcon(currentIcon);
		const subMenu = resolveMenuSubmenu(item);
		for (const { dir, icon, labelKey } of DIRECTION_OPTIONS) {
			subMenu.addItem((subItem) => {
				subItem
					.setTitle(i18n.t(labelKey))
					.setIcon(icon)
					.setChecked(currentDirection === dir)
					.onClick(() => {
						void setCanvasExcerptLayoutDirection(app, canvasPath, dir);
					});
			});
		}
	});
}

function enrichCanvasMenuWithDirection(app: App, menu: Menu): void {
	const canvasPath = resolveActiveCanvasFilePath(app);
	if (!canvasPath) {
		return;
	}

	const currentDirection = readCanvasExcerptLayoutDirectionFromCache(app, canvasPath);
	appendCanvasDirectionItems(app, menu, canvasPath, currentDirection);
	void warmCanvasExcerptAnchorCache(app, canvasPath);
}

export function registerCanvasDirectionMenu(plugin: Plugin): void {
	const app = plugin.app;
	const handler: (menu: Menu) => void = (menu) => {
		enrichCanvasMenuWithDirection(app, menu);
	};

	registerCanvasWorkspaceMenuEvent(plugin, CANVAS_NODE_MENU_EVENT, handler);
	registerCanvasWorkspaceMenuEvent(plugin, CANVAS_SELECTION_MENU_EVENT, handler);
}
