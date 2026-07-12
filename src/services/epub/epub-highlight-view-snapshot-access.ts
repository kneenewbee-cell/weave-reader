import type { App } from "obsidian";
import { EpubHighlightViewSnapshotService } from "./EpubHighlightViewSnapshotService";

const snapshotServiceByApp = new WeakMap<App, EpubHighlightViewSnapshotService>();

/** App-scoped snapshot service so disk + memory caches stay coherent across reader panes. */
export function getEpubHighlightViewSnapshotService(app: App): EpubHighlightViewSnapshotService {
	let service = snapshotServiceByApp.get(app);
	if (!service) {
		service = new EpubHighlightViewSnapshotService(app);
		snapshotServiceByApp.set(app, service);
	}
	return service;
}
