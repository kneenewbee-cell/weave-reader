import {
	isBlobResourceUrl,
	prefetchBlobUrlsFromText,
	readBlobUrlAsArrayBuffer,
	readBlobUrlAsText,
	readResourceUrlAsText,
	shouldPreferFetchForResourceUrl,
} from "../blob-url-text";
import {
	readRegisteredBlobAsText,
	registerBlobUrl,
	resetBlobUrlRegistryForTests,
} from "../blob-url-registry";

describe("blob-url-text", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		resetBlobUrlRegistryForTests();
	});

	it("detects blob resource URLs", () => {
		expect(isBlobResourceUrl("blob:abc-123")).toBe(true);
		expect(isBlobResourceUrl(" BLOB:abc-123 ")).toBe(true);
		expect(isBlobResourceUrl("https://example.com/a.css")).toBe(false);
	});

	it("never prefers fetch for blob resources", () => {
		expect(shouldPreferFetchForResourceUrl("blob:chapter.css")).toBe(false);
		expect(shouldPreferFetchForResourceUrl("app://local/resource")).toBe(true);
		expect(shouldPreferFetchForResourceUrl("https://example.com/a.css")).toBe(false);
	});

	it("reads blob text via xhr", async () => {
		const xhrInstances: Array<{
			open: ReturnType<typeof vi.fn>;
			send: ReturnType<typeof vi.fn>;
			onload: (() => void) | null;
			responseText: string;
			status: number;
		}> = [];

		class MockXMLHttpRequest {
			responseType = "";
			responseText = "";
			status = 0;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			open = vi.fn();
			send = vi.fn();
			getResponseHeader = vi.fn(() => null);

			constructor() {
				xhrInstances.push(this);
			}
		}

		vi.stubGlobal("XMLHttpRequest", MockXMLHttpRequest);

		const promise = readBlobUrlAsText("blob:weave-test-chapter.css");
		await Promise.resolve();
		const xhr = xhrInstances[0];
		expect(xhr).toBeTruthy();
		xhr.status = 0;
		xhr.responseText = "body { color: red; }";
		xhr.onload?.();

		await expect(promise).resolves.toBe("body { color: red; }");
		expect(xhr.open).toHaveBeenCalledWith("GET", "blob:weave-test-chapter.css");
		expect(xhr.responseType).toBe("text");
	});

	it("reads registered blob text without xhr after revoke", async () => {
		const blob = new Blob(["body { color: red; }"], { type: "text/css" });
		const url = "blob:app://obsidian.md/weave-revoked-text";
		registerBlobUrl(url, blob);

		await expect(readBlobUrlAsText(url)).resolves.toBe("body { color: red; }");
	});

	it("prefetches blob URLs referenced in markup", async () => {
		const blob = new Blob(["blockquote { margin: 0; }"], { type: "text/css" });
		const url = "blob:app://obsidian.md/weave-prefetch-text";
		registerBlobUrl(url, blob);
		const markup = `<html><head><link rel="stylesheet" href="${url}"/></head></html>`;

		await prefetchBlobUrlsFromText(markup);
		await expect(readRegisteredBlobAsText(url)).resolves.toBe("blockquote { margin: 0; }");
	});

	it("reads blob binary via xhr", async () => {
		const xhrInstances: Array<{
			open: ReturnType<typeof vi.fn>;
			send: ReturnType<typeof vi.fn>;
			onload: (() => void) | null;
			response: ArrayBuffer;
			status: number;
			getResponseHeader: ReturnType<typeof vi.fn>;
		}> = [];

		class MockXMLHttpRequest {
			responseType = "";
			response = new ArrayBuffer(0);
			status = 0;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			open = vi.fn();
			send = vi.fn();
			getResponseHeader = vi.fn(() => "image/png");

			constructor() {
				xhrInstances.push(this);
			}
		}

		vi.stubGlobal("XMLHttpRequest", MockXMLHttpRequest);

		const bytes = new Uint8Array([137, 80, 78, 71]);
		const promise = readBlobUrlAsArrayBuffer("blob:weave-test-image.png");
		await Promise.resolve();
		const xhr = xhrInstances[0];
		expect(xhr).toBeTruthy();
		xhr.status = 200;
		xhr.response = bytes.buffer;
		xhr.onload?.();

		await expect(promise).resolves.toEqual({
			bytes,
			mimeType: "image/png",
		});
		expect(xhr.open).toHaveBeenCalledWith("GET", "blob:weave-test-image.png");
		expect(xhr.responseType).toBe("arraybuffer");
	});

	it("reads non-blob resource URLs via xhr", async () => {
		const xhrInstances: Array<{
			open: ReturnType<typeof vi.fn>;
			send: ReturnType<typeof vi.fn>;
			onload: (() => void) | null;
			responseText: string;
			status: number;
		}> = [];

		class MockXMLHttpRequest {
			responseType = "";
			responseText = "";
			status = 0;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			open = vi.fn();
			send = vi.fn();
			getResponseHeader = vi.fn(() => "text/plain");

			constructor() {
				xhrInstances.push(this);
			}
		}

		vi.stubGlobal("XMLHttpRequest", MockXMLHttpRequest);

		const promise = readResourceUrlAsText("app://local/chapter.xhtml");
		const xhr = xhrInstances[0];
		xhr.status = 200;
		xhr.responseText = "<html></html>";
		xhr.onload?.();

		await expect(promise).resolves.toBe("<html></html>");
		expect(xhr.open).toHaveBeenCalledWith("GET", "app://local/chapter.xhtml", true);
	});
});
