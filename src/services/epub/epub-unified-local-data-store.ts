import type { App, DataAdapter } from "obsidian";
import { isDestinationFileAlreadyExistsError } from "./epub-local-data-clone";

export const UNIFIED_LOCAL_DATA_PARSE_RETRY_DELAY_MS = 60;

type AdapterWithRename = DataAdapter & {
	rename?: (oldPath: string, newPath: string) => Promise<void>;
	remove?: (path: string) => Promise<void>;
};

export class EpubUnifiedLocalDataSessionCache<T> {
	private static cacheByApp = new WeakMap<App, Map<string, unknown>>();
	private static writeLockByApp = new WeakMap<App, Map<string, Promise<void>>>();

	constructor(
		private readonly app: App,
		private readonly cacheKey: string
	) {}

	getCached(): T | null {
		const cached = this.getCacheStore().get(this.cacheKey);
		return cached === undefined ? null : (cached as T);
	}

	setCached(data: T): void {
		this.getCacheStore().set(this.cacheKey, data);
	}

	getWriteLock(): Promise<void> {
		return this.getWriteLockStore().get(this.cacheKey) ?? Promise.resolve();
	}

	setWriteLock(lock: Promise<void>): void {
		this.getWriteLockStore().set(this.cacheKey, lock);
	}

	async runWithWriteLock(task: () => Promise<void>): Promise<void> {
		const nextLock = this.getWriteLock().then(task, task);
		this.setWriteLock(nextLock);
		await nextLock;
	}

	private getCacheStore(): Map<string, unknown> {
		let store = EpubUnifiedLocalDataSessionCache.cacheByApp.get(this.app);
		if (!store) {
			store = new Map<string, unknown>();
			EpubUnifiedLocalDataSessionCache.cacheByApp.set(this.app, store);
		}
		return store;
	}

	private getWriteLockStore(): Map<string, Promise<void>> {
		let store = EpubUnifiedLocalDataSessionCache.writeLockByApp.get(this.app);
		if (!store) {
			store = new Map<string, Promise<void>>();
			EpubUnifiedLocalDataSessionCache.writeLockByApp.set(this.app, store);
		}
		return store;
	}
}

export async function writeUnifiedLocalDataAtomically(
	adapter: AdapterWithRename,
	targetPath: string,
	serialized: string
): Promise<void> {
	const tempPath = `${targetPath}.tmp`;

	if (typeof adapter.rename === "function") {
		await adapter.write(tempPath, serialized);
		try {
			await adapter.rename(tempPath, targetPath);
		} catch (error) {
			if (!isDestinationFileAlreadyExistsError(error)) {
				throw error;
			}
			await adapter.write(targetPath, serialized);
			if (typeof adapter.remove === "function") {
				try {
					await adapter.remove(tempPath);
				} catch {
					// noop
				}
			}
		}
		return;
	}

	await adapter.write(targetPath, serialized);
}

export async function readWithTransientParseRetry<T>(
	attemptRead: () => Promise<T>,
	options?: { retries?: number; delayMs?: number }
): Promise<T | null> {
	const retries = options?.retries ?? 2;
	const delayMs = options?.delayMs ?? UNIFIED_LOCAL_DATA_PARSE_RETRY_DELAY_MS;

	for (let attempt = 0; attempt < retries; attempt += 1) {
		if (attempt > 0) {
			await new Promise((resolve) => window.setTimeout(resolve, delayMs));
		}
		try {
			return await attemptRead();
		} catch {
			// Retry once for transient partial-write reads during startup.
		}
	}

	return null;
}
