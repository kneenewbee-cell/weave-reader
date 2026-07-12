import { describe, expect, it } from "vitest";
import {
	isEpubBookmarkMarkdownInFolder,
	isPathUnderEpubBookmarkFolder,
} from "../epub-bookmark-folder-path";

describe("epub-bookmark-folder-path", () => {
	it("matches bookmark folder descendants including nested data notes", () => {
		const folder = "weave/epub-bookmarks";
		expect(isPathUnderEpubBookmarkFolder("weave/epub-bookmarks", folder)).toBe(true);
		expect(isPathUnderEpubBookmarkFolder("weave/epub-bookmarks/data_Demo.md", folder)).toBe(
			true
		);
		expect(isPathUnderEpubBookmarkFolder("weave/epub-bookmarks/archive/data_Demo.md", folder)).toBe(
			true
		);
		expect(isPathUnderEpubBookmarkFolder("weave/epub-bookmarks/covers/demo.jpg", folder)).toBe(
			true
		);
		expect(isPathUnderEpubBookmarkFolder("Notes/demo.md", folder)).toBe(false);
	});

	it("treats markdown under bookmark folder as bookmark vault files", () => {
		const folder = "weave/epub-bookmarks";
		expect(isEpubBookmarkMarkdownInFolder("weave/epub-bookmarks/data_Demo.md", folder)).toBe(
			true
		);
		expect(isEpubBookmarkMarkdownInFolder("weave/epub-bookmarks/archive/data_Demo.md", folder)).toBe(
			true
		);
		expect(isEpubBookmarkMarkdownInFolder("weave/epub-bookmarks/covers/demo.jpg", folder)).toBe(
			false
		);
	});
});
