import { describe, expect, it } from "vitest";
import {
	isEpubBookmarkVaultFrontmatter,
	parseEpubBookmarkVaultYamlBlock,
} from "../epub-bookmark-vault-parse";
import { buildReaderHostSurfaceCss } from "../reader-host-surface-css";

describe("epub-bookmark-vault-parse", () => {
	it("parses bookmark vault frontmatter blocks", () => {
		const frontmatter = parseEpubBookmarkVaultYamlBlock(`---
weave_epub_bookmark_file: true
stableKey: demo
bookPath: Books/demo.epub
---`);

		expect(frontmatter).toMatchObject({
			weave_epub_bookmark_file: true,
			stableKey: "demo",
			bookPath: "Books/demo.epub",
		});
		expect(isEpubBookmarkVaultFrontmatter(frontmatter!)).toBe(true);
	});

	it("rejects notes without the bookmark marker", () => {
		const frontmatter = parseEpubBookmarkVaultYamlBlock(`---
title: Regular note
---`);

		expect(frontmatter).toEqual({ title: "Regular note" });
		expect(isEpubBookmarkVaultFrontmatter(frontmatter!)).toBe(false);
	});
});

describe("buildReaderHostSurfaceCss", () => {
	it("injects host surface colors through stylesheet text", () => {
		expect(buildReaderHostSurfaceCss("rgb(1, 2, 3)", "rgb(4, 5, 6)", "dark")).toContain(
			"background-color: rgb(1, 2, 3)"
		);
		expect(buildReaderHostSurfaceCss("rgb(1, 2, 3)", "rgb(4, 5, 6)", "dark")).toContain(
			"color-scheme: dark"
		);
	});
});
