import type { App, Workspace } from "obsidian";
import { getCompatiblePlugin } from "../../utils/plugin-access";
import { resolveEpubHost } from "./epub-host";

export type WeaveCardMutationPayload = {
	type: "cards";
	action: "update" | "delete";
	ids: string[];
	source: "epub-backlink-highlight";
	sourcePath: string;
};

type Callable = (...args: unknown[]) => unknown;

type WeaveCardMetadataCache = {
	invalidate: (uuid: string) => void;
	clear: () => void;
};

type WeaveCardIndexService = {
	removeCardIndex: (uuid: string) => void;
};

type WeaveClearableCache = {
	clearCache: () => void;
};

type WeaveWdeckService = {
	rebuildCache: () => Promise<void> | void;
};

type WeaveDataSyncService = {
	notifyChange: (payload: WeaveCardMutationPayload) => Promise<void> | void;
};

export type WeaveCacheHostServices = {
	cardMetadataCache: WeaveCardMetadataCache | null;
	cardIndexService: WeaveCardIndexService | null;
	deckAggregationService: WeaveClearableCache | null;
	analyticsService: WeaveClearableCache | null;
	wdeckService: WeaveWdeckService | null;
	dataSyncService: WeaveDataSyncService | null;
	workspace: Workspace;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function getCallable(value: unknown, method: string): Callable | null {
	if (!isRecord(value)) {
		return null;
	}
	const candidate = value[method];
	return typeof candidate === "function" ? (candidate as Callable) : null;
}

function bindCallable(value: unknown, method: string): Callable | null {
	const callable = getCallable(value, method);
	if (!callable || !isRecord(value)) {
		return null;
	}
	return callable.bind(value);
}

function readCardMetadataCache(host: unknown): WeaveCardMetadataCache | null {
	const cache = isRecord(host) ? host.cardMetadataCache : null;
	const invalidate = bindCallable(cache, "invalidate");
	const clear = bindCallable(cache, "clear");
	if (!invalidate && !clear) {
		return null;
	}
	return {
		invalidate: (uuid: string) => {
			invalidate?.(uuid);
		},
		clear: () => {
			clear?.();
		},
	};
}

function readCardIndexService(host: unknown): WeaveCardIndexService | null {
	const service = isRecord(host) ? host.cardIndexService : null;
	const removeCardIndex = bindCallable(service, "removeCardIndex");
	if (!removeCardIndex) {
		return null;
	}
	return {
		removeCardIndex: (uuid: string) => {
			removeCardIndex(uuid);
		},
	};
}

function readClearableCache(host: unknown, key: string): WeaveClearableCache | null {
	const service = isRecord(host) ? host[key] : null;
	const clearCache = bindCallable(service, "clearCache");
	if (!clearCache) {
		return null;
	}
	return {
		clearCache: () => {
			clearCache();
		},
	};
}

function readWdeckService(host: unknown): WeaveWdeckService | null {
	const service = isRecord(host) ? host.wdeckService : null;
	const rebuildCache = bindCallable(service, "rebuildCache");
	if (!rebuildCache) {
		return null;
	}
	return {
		rebuildCache: () => rebuildCache(),
	};
}

function readDataSyncService(host: unknown): WeaveDataSyncService | null {
	const service = isRecord(host) ? host.dataSyncService : null;
	const notifyChange = bindCallable(service, "notifyChange");
	if (!notifyChange) {
		return null;
	}
	return {
		notifyChange: (payload: WeaveCardMutationPayload) => notifyChange(payload),
	};
}

function pickFirstDefined<T>(values: Array<T | null | undefined>): T | null {
	for (const value of values) {
		if (value) {
			return value;
		}
	}
	return null;
}

function resolveHostWorkspace(app: App, host: unknown): Workspace {
	if (app.workspace) {
		return app.workspace;
	}
	if (isRecord(host) && isRecord(host.app) && isRecord(host.app.workspace)) {
		return host.app.workspace as Workspace;
	}
	return app.workspace;
}

export function resolveWeaveCacheHost(app: App): WeaveCacheHostServices {
	const hostCandidates = [resolveEpubHost(app), getCompatiblePlugin(app)].filter(
		(candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)
	);
	const primaryHost = hostCandidates[0] ?? null;

	return {
		cardMetadataCache: pickFirstDefined(
			hostCandidates.map((host) => readCardMetadataCache(host))
		),
		cardIndexService: pickFirstDefined(hostCandidates.map((host) => readCardIndexService(host))),
		deckAggregationService: pickFirstDefined(
			hostCandidates.map((host) => readClearableCache(host, "deckAggregationService"))
		),
		analyticsService: pickFirstDefined(
			hostCandidates.map((host) => readClearableCache(host, "analyticsService"))
		),
		wdeckService: pickFirstDefined(hostCandidates.map((host) => readWdeckService(host))),
		dataSyncService: pickFirstDefined(hostCandidates.map((host) => readDataSyncService(host))),
		workspace: resolveHostWorkspace(app, primaryHost),
	};
}

export function invalidateCardMetadataCache(
	cache: WeaveCardMetadataCache | null,
	cardUuids: string[]
): void {
	if (!cache) {
		return;
	}
	if (cardUuids.length > 0) {
		for (const uuid of cardUuids) {
			cache.invalidate(uuid);
		}
		return;
	}
	cache.clear();
}

export function removeCardIndexes(
	service: WeaveCardIndexService | null,
	cardUuids: string[]
): void {
	if (!service || cardUuids.length === 0) {
		return;
	}
	for (const uuid of cardUuids) {
		service.removeCardIndex(uuid);
	}
}

export function clearDeckAndAnalyticsCaches(services: WeaveCacheHostServices): void {
	services.deckAggregationService?.clearCache();
	services.analyticsService?.clearCache();
}

export async function rebuildWdeckCacheIfNeeded(
	wdeckService: WeaveWdeckService | null,
	sourcePath: string
): Promise<void> {
	const normalizedSourcePath = String(sourcePath || "").trim();
	if (!wdeckService || !normalizedSourcePath.toLowerCase().endsWith(".wdeck")) {
		return;
	}
	await wdeckService.rebuildCache();
}

export function triggerCardMutationEvents(
	workspace: Workspace,
	action: "update" | "delete",
	cardUuids: string[],
	sourcePath: string,
	includeDataChanged = false
): void {
	if (action === "delete") {
		for (const uuid of cardUuids) {
			workspace.trigger("Weave:card-deleted", uuid);
		}
	}
	workspace.trigger("Weave:card-updated", {
		type: "cards",
		action,
		ids: cardUuids,
		source: "epub-backlink-highlight",
		sourcePath,
	});
	if (includeDataChanged) {
		workspace.trigger("Weave:data-changed");
	}
}

export async function notifyWeaveDataSyncChange(
	dataSyncService: WeaveDataSyncService | null,
	payload: WeaveCardMutationPayload
): Promise<void> {
	if (!dataSyncService) {
		return;
	}
	await dataSyncService.notifyChange(payload);
}
