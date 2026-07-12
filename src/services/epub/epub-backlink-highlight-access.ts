import type { App } from "obsidian";
import { EpubBacklinkHighlightService } from "./EpubBacklinkHighlightService";

const backlinkServiceByApp = new WeakMap<App, EpubBacklinkHighlightService>();

/**
 * Single app-scoped backlink / excerpt index service so disk + in-memory caches stay coherent
 * across the reader, bookshelf, and background warmup.
 */
export function getEpubBacklinkHighlightService(app: App): EpubBacklinkHighlightService {
	let service = backlinkServiceByApp.get(app);
	if (!service) {
		service = new EpubBacklinkHighlightService(app);
		backlinkServiceByApp.set(app, service);
	}
	return service;
}
