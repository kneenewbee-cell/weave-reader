import type { App } from "obsidian";
import { BookSessionManager } from "./BookSessionManager";

const managersByApp = new WeakMap<App, BookSessionManager>();

export function getBookSessionManager(
	app: App,
	options?: { cardSyncDedupeMs?: number; getEnableDebugMode?: () => boolean }
): BookSessionManager {
	let manager = managersByApp.get(app);
	if (!manager || options) {
		manager = new BookSessionManager(options);
		managersByApp.set(app, manager);
	}
	return manager;
}
