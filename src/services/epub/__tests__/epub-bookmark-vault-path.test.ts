import { describe, expect, it } from "vitest";
import {
	isEpubBookmarkManagedVaultPath,
	resolveEpubBookmarkFolderForApp,
} from "../epub-bookmark-vault-path";

describe("epub-bookmark-vault-path", () => {
	const app = {
		plugins: {
			getPlugin: () => ({
				settings: {
					bookmarkFolder: "Library/epub-data",
				},
			}),
		},
	} as any;

	it("resolves bookmark folder from plugin settings", () => {
		expect(resolveEpubBookmarkFolderForApp(app)).toBe("Library/epub-data");
	});

	it("treats bookmark data notes and cover assets as plugin-maintained paths", () => {
		expect(isEpubBookmarkManagedVaultPath(app, "Library/epub-data/data_Demo.md")).toBe(true);
		expect(isEpubBookmarkManagedVaultPath(app, "Library/epub-data/covers/demo.jpg")).toBe(
			true
		);
		expect(isEpubBookmarkManagedVaultPath(app, "Notes/demo.md")).toBe(false);
	});
});
