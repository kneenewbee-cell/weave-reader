import {
	collectBlobResourceUrls,
	getRegisteredBlob,
	installBlobUrlRegistry,
	readRegisteredBlobAsText,
	registerBlobUrl,
	resetBlobUrlRegistryForTests,
} from "../blob-url-registry";

describe("blob-url-registry", () => {
	afterEach(() => {
		resetBlobUrlRegistryForTests();
	});

	it("collects unique blob resource URLs from markup", () => {
		const urls = collectBlobResourceUrls(
			'<link href="blob:app://obsidian.md/a" /><style>@import "blob:app://obsidian.md/b";</style>'
		);
		expect(urls).toEqual(["blob:app://obsidian.md/a", "blob:app://obsidian.md/b"]);
	});

	it("registers blobs created through URL.createObjectURL", async () => {
		if (typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") {
			return;
		}
		installBlobUrlRegistry();
		const blob = new Blob(["body { margin: 0; }"], { type: "text/css" });
		const url = URL.createObjectURL(blob);

		expect(getRegisteredBlob(url)).toBe(blob);
		await expect(readRegisteredBlobAsText(url)).resolves.toBe("body { margin: 0; }");

		URL.revokeObjectURL(url);
		await expect(readRegisteredBlobAsText(url)).resolves.toBe("body { margin: 0; }");
	});

	it("supports manual registration for pre-existing blob URLs", async () => {
		const blob = new Blob(["p { color: inherit; }"], { type: "text/css" });
		const url = "blob:app://obsidian.md/manual-entry";
		registerBlobUrl(url, blob);

		expect(getRegisteredBlob(url)).toBe(blob);
		await expect(readRegisteredBlobAsText(url)).resolves.toBe("p { color: inherit; }");
	});
});
