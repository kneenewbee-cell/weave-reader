import type { App } from "obsidian";
import { getLegacyWeavePlugin } from "./plugin-access";

export const WEAVE_MAIN_PLUGIN_ID = "weave";

export type WeaveSelectedTextAISplitHost = {
	openSelectedTextAIPanelFromEpub?: (options: {
		filePath: string;
		selectedText: string;
		actionId: string;
		sourceLink?: string;
	}) => Promise<void>;
	closeSelectedTextAIPanelFromEpub?: (filePath: string) => Promise<void>;
	openSelectedTextAISplitMenu?: (options: {
		event: MouseEvent | KeyboardEvent;
		selectedText: string;
		onSelectAction: (actionId: string) => void;
	}) => void;
};

function isWeaveSelectedTextAISplitHost(value: unknown): value is WeaveSelectedTextAISplitHost {
	return value !== null && typeof value === "object";
}

export function getWeaveMainPlugin(app: App): WeaveSelectedTextAISplitHost | null {
	const plugin = getLegacyWeavePlugin(app);
	return isWeaveSelectedTextAISplitHost(plugin) ? plugin : null;
}

export function isWeaveMainPluginEnabled(app: App): boolean {
	return Boolean(getWeaveMainPlugin(app));
}

export function requireWeaveMainPlugin(app: App): WeaveSelectedTextAISplitHost | null {
	return getWeaveMainPlugin(app);
}
