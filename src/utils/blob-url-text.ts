/**
 * Read same-origin blob: URLs without fetch (restricted by Obsidian community lint).
 */

import {
	cacheBlobBinary,
	cacheBlobText,
	collectBlobResourceUrls,
	getCachedBlobBinary,
	getCachedBlobText,
	getRegisteredBlob,
	readRegisteredBlobAsArrayBuffer,
	readRegisteredBlobAsText,
} from "./blob-url-registry";

export { collectBlobResourceUrls } from "./blob-url-registry";

export async function prefetchBlobResourceUrls(urls: Iterable<string>): Promise<void> {
	const pending = Array.from(urls)
		.map((url) => String(url || "").trim())
		.filter((url) => isBlobResourceUrl(url))
		.filter((url) => getCachedBlobText(url) === null && getCachedBlobBinary(url) === null);

	if (pending.length === 0) {
		return;
	}

	await Promise.all(
		pending.map(async (url) => {
			if (getRegisteredBlob(url)) {
				await readRegisteredBlobAsText(url).catch(() => null);
				return;
			}
			await readBlobUrlAsText(url).catch(() => "");
		})
	);
}

export async function prefetchBlobUrlsFromText(source: string): Promise<void> {
	await prefetchBlobResourceUrls(collectBlobResourceUrls(source));
}

export function isBlobResourceUrl(url: string): boolean {
	return String(url || "").trim().toLowerCase().startsWith("blob:");
}

export function shouldPreferFetchForResourceUrl(resourceUrl: string): boolean {
	if (isBlobResourceUrl(resourceUrl)) {
		return false;
	}
	const protocolMatch = /^[a-z][a-z0-9+.-]*:/i.exec(String(resourceUrl || "").trim());
	if (!protocolMatch) {
		return false;
	}
	return !/^https?:$/i.test(protocolMatch[0]);
}

function isSuccessfulBlobXhrStatus(status: number): boolean {
	return status === 0 || (status >= 200 && status < 300);
}

export async function readBlobUrlAsText(url: string): Promise<string> {
	const normalizedUrl = String(url || "").trim();
	const cached = getCachedBlobText(normalizedUrl);
	if (cached !== null) {
		return cached;
	}

	const registered = await readRegisteredBlobAsText(normalizedUrl);
	if (registered !== null) {
		return registered;
	}

	const text = await readBlobUrlAsTextViaXhr(normalizedUrl);
	cacheBlobText(normalizedUrl, text);
	return text;
}

function readNonBlobResourceViaXhr(
	resourceUrl: string,
	responseType: "text" | "arraybuffer"
): Promise<{ data: string | ArrayBuffer; mimeType: string }> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("GET", resourceUrl, true);
		xhr.responseType = responseType;
		xhr.onload = () => {
			if (!isSuccessfulBlobXhrStatus(xhr.status)) {
				reject(
					new Error(`HTTP ${xhr.status} ${xhr.statusText || "Unknown error"}`)
				);
				return;
			}
			const mimeType = String(
				xhr.getResponseHeader("content-type") || "application/octet-stream"
			)
				.trim()
				.toLowerCase();
			if (responseType === "text") {
				resolve({ data: xhr.responseText || "", mimeType });
				return;
			}
			if (xhr.response instanceof ArrayBuffer) {
				resolve({ data: xhr.response, mimeType });
				return;
			}
			reject(new Error(`Failed to load resource: ${resourceUrl}`));
		};
		xhr.onerror = () => reject(new Error(`Failed to load resource: ${resourceUrl}`));
		xhr.send();
	});
}

/** Read vault `app://` and other same-origin resource URLs without fetch. */
export async function readResourceUrlAsText(resourceUrl: string): Promise<string> {
	if (isBlobResourceUrl(resourceUrl)) {
		return readBlobUrlAsText(resourceUrl);
	}
	const { data } = await readNonBlobResourceViaXhr(resourceUrl, "text");
	return data;
}

export async function readResourceUrlAsArrayBuffer(resourceUrl: string): Promise<ArrayBuffer> {
	if (isBlobResourceUrl(resourceUrl)) {
		const { bytes } = await readBlobUrlAsArrayBuffer(resourceUrl);
		return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	}
	const { data } = await readNonBlobResourceViaXhr(resourceUrl, "arraybuffer");
	return data as ArrayBuffer;
}

export async function readResourceUrlAsBinary(
	resourceUrl: string
): Promise<{ bytes: Uint8Array; mimeType: string }> {
	if (isBlobResourceUrl(resourceUrl)) {
		return readBlobUrlAsArrayBuffer(resourceUrl);
	}
	const { data, mimeType } = await readNonBlobResourceViaXhr(resourceUrl, "arraybuffer");
	return { bytes: new Uint8Array(data as ArrayBuffer), mimeType };
}

function readBlobUrlAsTextViaXhr(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("GET", url);
		xhr.responseType = "text";
		xhr.onload = () => {
			if (isSuccessfulBlobXhrStatus(xhr.status)) {
				resolve(xhr.responseText || "");
				return;
			}
			reject(new Error(`Failed to read blob URL (${xhr.status})`));
		};
		xhr.onerror = () => reject(new Error("Failed to read blob URL"));
		xhr.send();
	});
}

export async function readBlobUrlAsArrayBuffer(
	url: string
): Promise<{ bytes: Uint8Array; mimeType: string }> {
	const normalizedUrl = String(url || "").trim();
	const cached = getCachedBlobBinary(normalizedUrl);
	if (cached) {
		return cached;
	}

	const registered = await readRegisteredBlobAsArrayBuffer(normalizedUrl);
	if (registered) {
		return registered;
	}

	const value = await readBlobUrlAsArrayBufferViaXhr(normalizedUrl);
	cacheBlobBinary(normalizedUrl, value);
	return value;
}

function readBlobUrlAsArrayBufferViaXhr(
	url: string
): Promise<{ bytes: Uint8Array; mimeType: string }> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("GET", url);
		xhr.responseType = "arraybuffer";
		xhr.onload = () => {
			if (isSuccessfulBlobXhrStatus(xhr.status) && xhr.response instanceof ArrayBuffer) {
				const mimeType = String(xhr.getResponseHeader("content-type") || "application/octet-stream")
					.trim()
					.toLowerCase();
				resolve({
					bytes: new Uint8Array(xhr.response),
					mimeType,
				});
				return;
			}
			reject(new Error(`Failed to read blob URL (${xhr.status})`));
		};
		xhr.onerror = () => reject(new Error("Failed to read blob URL"));
		xhr.send();
	});
}
