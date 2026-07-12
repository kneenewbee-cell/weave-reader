import type { App } from "obsidian";
import { EpubStorageService, flushEpubStoragePendingProgress } from "./EpubStorageService";
import { resolveEpubHost } from "./epub-host";

const fallbackStorageServiceByApp = new WeakMap<App, EpubStorageService>();

export async function flushEpubPendingProgress(storageService: EpubStorageService): Promise<void> {
	if (!storageService || typeof storageService !== "object") {
		return;
	}
	await flushEpubStoragePendingProgress(storageService);
}

export function resetEpubStorageServiceCache(app: App): void {
	fallbackStorageServiceByApp.delete(app);
}

export function getEpubStorageService(app: App): EpubStorageService {
	const host = resolveEpubHost(app);
	if (typeof host?.getEpubStorageService === "function") {
		const hostedService = host.getEpubStorageService();
		if (hostedService) {
			return hostedService;
		}
	}

	let service = fallbackStorageServiceByApp.get(app);
	if (!service) {
		service = new EpubStorageService(app);
		fallbackStorageServiceByApp.set(app, service);
	}
	return service;
}
