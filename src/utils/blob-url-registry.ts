/**
 * Retain Blob objects behind foliate `section.load()` URLs after revokeObjectURL.
 * Obsidian/Electron blob URLs (`blob:app://obsidian.md/<uuid>`) become unreadable
 * once foliate revokes them; direct Blob reads avoid ERR_FILE_NOT_FOUND.
 */

const PATCH_FLAG = "__weaveBlobUrlRegistryInstalled__";
const ORIGINAL_CREATE_KEY = "__weaveOriginalCreateObjectURL__";
const ORIGINAL_REVOKE_KEY = "__weaveOriginalRevokeObjectURL__";

type GuardedGlobal = typeof window & {
	[PATCH_FLAG]?: boolean;
	[ORIGINAL_CREATE_KEY]?: typeof URL.createObjectURL;
	[ORIGINAL_REVOKE_KEY]?: typeof URL.revokeObjectURL;
};

const blobByUrl = new Map<string, Blob>();
const textCache = new Map<string, string>();
const binaryCache = new Map<string, { bytes: Uint8Array; mimeType: string }>();

const BLOB_URL_PATTERN = /blob:[^\s"'<>)\]]+/gi;

export function collectBlobResourceUrls(source: string): string[] {
	const seen = new Set<string>();
	for (const match of String(source || "").matchAll(BLOB_URL_PATTERN)) {
		const url = String(match[0] || "").trim();
		if (url && isTrackedBlobUrl(url)) {
			seen.add(url);
		}
	}
	return Array.from(seen);
}

export function isTrackedBlobUrl(url: string): boolean {
	return String(url || "").trim().toLowerCase().startsWith("blob:");
}

export function registerBlobUrl(url: string, blob: Blob): void {
	const normalizedUrl = String(url || "").trim();
	if (!normalizedUrl || !isTrackedBlobUrl(normalizedUrl)) {
		return;
	}
	blobByUrl.set(normalizedUrl, blob);
}

export function getRegisteredBlob(url: string): Blob | null {
	const normalizedUrl = String(url || "").trim();
	return blobByUrl.get(normalizedUrl) ?? null;
}

export function getCachedBlobText(url: string): string | null {
	const normalizedUrl = String(url || "").trim();
	if (!textCache.has(normalizedUrl)) {
		return null;
	}
	return textCache.get(normalizedUrl) ?? "";
}

export function getCachedBlobBinary(
	url: string
): { bytes: Uint8Array; mimeType: string } | null {
	const normalizedUrl = String(url || "").trim();
	return binaryCache.get(normalizedUrl) ?? null;
}

export function cacheBlobText(url: string, text: string): void {
	const normalizedUrl = String(url || "").trim();
	if (!normalizedUrl) {
		return;
	}
	textCache.set(normalizedUrl, text);
}

export function cacheBlobBinary(
	url: string,
	value: { bytes: Uint8Array; mimeType: string }
): void {
	const normalizedUrl = String(url || "").trim();
	if (!normalizedUrl) {
		return;
	}
	binaryCache.set(normalizedUrl, value);
}

export async function readRegisteredBlobAsText(url: string): Promise<string | null> {
	const normalizedUrl = String(url || "").trim();
	const cached = getCachedBlobText(normalizedUrl);
	if (cached !== null) {
		return cached;
	}
	const blob = getRegisteredBlob(normalizedUrl);
	if (!blob) {
		return null;
	}
	const text = await readBlobObjectAsText(blob);
	cacheBlobText(normalizedUrl, text);
	return text;
}

export async function readRegisteredBlobAsArrayBuffer(
	url: string
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
	const normalizedUrl = String(url || "").trim();
	const cached = getCachedBlobBinary(normalizedUrl);
	if (cached) {
		return cached;
	}
	const blob = getRegisteredBlob(normalizedUrl);
	if (!blob) {
		return null;
	}
	const value = await readBlobObjectAsArrayBuffer(blob);
	cacheBlobBinary(normalizedUrl, value);
	return value;
}

async function readBlobObjectAsText(blob: Blob): Promise<string> {
	if (typeof blob.text === "function") {
		return blob.text();
	}
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result;
			resolve(typeof result === "string" ? result : "");
		};
		reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob text"));
		reader.readAsText(blob);
	});
}

async function readBlobObjectAsArrayBuffer(
	blob: Blob
): Promise<{ bytes: Uint8Array; mimeType: string }> {
	if (typeof blob.arrayBuffer === "function") {
		const buffer = await blob.arrayBuffer();
		return {
			bytes: new Uint8Array(buffer),
			mimeType: String(blob.type || "application/octet-stream").trim().toLowerCase(),
		};
	}
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			if (!(reader.result instanceof ArrayBuffer)) {
				reject(new Error("Failed to read blob binary"));
				return;
			}
			resolve({
				bytes: new Uint8Array(reader.result),
				mimeType: String(blob.type || "application/octet-stream").trim().toLowerCase(),
			});
		};
		reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob binary"));
		reader.readAsArrayBuffer(blob);
	});
}

export function installBlobUrlRegistry(urlApi: typeof URL = URL): void {
	const globalScope = window as GuardedGlobal;
	if (globalScope[PATCH_FLAG]) {
		return;
	}
	if (typeof urlApi.createObjectURL !== "function" || typeof urlApi.revokeObjectURL !== "function") {
		globalScope[PATCH_FLAG] = true;
		return;
	}

	const originalCreateObjectURL =
		globalScope[ORIGINAL_CREATE_KEY] || urlApi.createObjectURL.bind(urlApi);
	const originalRevokeObjectURL =
		globalScope[ORIGINAL_REVOKE_KEY] || urlApi.revokeObjectURL.bind(urlApi);
	globalScope[ORIGINAL_CREATE_KEY] = originalCreateObjectURL;
	globalScope[ORIGINAL_REVOKE_KEY] = originalRevokeObjectURL;

	urlApi.createObjectURL = function createObjectURLWithRegistry(blob: Blob): string {
		const objectUrl = originalCreateObjectURL(blob);
		registerBlobUrl(objectUrl, blob);
		return objectUrl;
	};

	urlApi.revokeObjectURL = function revokeObjectURLWithRegistry(url: string): void {
		// Keep the Blob for direct reads; still revoke the URL handle for the runtime.
		try {
			originalRevokeObjectURL(url);
		} catch {
			// Ignore revoke failures for URLs we never created.
		}
	};

	globalScope[PATCH_FLAG] = true;
}

export function resetBlobUrlRegistryForTests(): void {
	const globalScope = window as GuardedGlobal;
	const originalCreateObjectURL = globalScope[ORIGINAL_CREATE_KEY];
	const originalRevokeObjectURL = globalScope[ORIGINAL_REVOKE_KEY];
	if (originalCreateObjectURL && originalRevokeObjectURL) {
		URL.createObjectURL = originalCreateObjectURL;
		URL.revokeObjectURL = originalRevokeObjectURL;
	}
	delete globalScope[PATCH_FLAG];
	delete globalScope[ORIGINAL_CREATE_KEY];
	delete globalScope[ORIGINAL_REVOKE_KEY];
	blobByUrl.clear();
	textCache.clear();
	binaryCache.clear();
}

if (typeof window !== "undefined" && typeof URL !== "undefined") {
	installBlobUrlRegistry();
}
