import type { App } from "obsidian";
import { NavigationHub, type NavigationHubOptions } from "./NavigationHub";

const hubByApp = new WeakMap<App, NavigationHub>();

export function getNavigationHub(app: App, options?: NavigationHubOptions): NavigationHub {
	let hub = hubByApp.get(app);
	if (!hub || options) {
		hub = new NavigationHub(app, options);
		hubByApp.set(app, hub);
	}
	return hub;
}

export function configureNavigationHub(app: App, options: NavigationHubOptions): NavigationHub {
	const hub = new NavigationHub(app, options);
	hubByApp.set(app, hub);
	return hub;
}
