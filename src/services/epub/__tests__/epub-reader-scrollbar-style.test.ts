import { describe, expect, it } from "vitest";
import { readEpubReaderStylesheet } from "./epub-reader-styles-test-utils";

describe("epub continuous scrollbar styling", () => {
	it("maps Obsidian styled scrollbars onto the foliate scrolled container part", () => {
		const stylesheet = readEpubReaderStylesheet();

		expect(stylesheet).toContain(
			'.epub-reader-root[data-flow="scrolled"] .epub-viewer-container > .weave-epub-reader-host::part(container)'
		);
		expect(stylesheet).toContain(
			"body.styled-scrollbars\n\t.epub-reader-root[data-flow=\"scrolled\"]\n\t.epub-viewer-container\n\t> .weave-epub-reader-host::part(container)::-webkit-scrollbar"
		);
		expect(stylesheet).toContain("width: var(--scrollbar-width);");
		expect(stylesheet).toContain("background-color: var(--scrollbar-thumb-bg);");
		expect(stylesheet).toContain("background-color: var(--scrollbar-active-thumb-bg);");
	});

	it("keeps standard scrollbar-color as a fallback instead of the primary Chromium path", () => {
		const stylesheet = readEpubReaderStylesheet();

		expect(stylesheet).toContain("@supports not selector(::-webkit-scrollbar)");
		expect(stylesheet).toContain("scrollbar-width: auto;");
		expect(stylesheet).toContain("scrollbar-color: var(--epub-scrollbar-thumb) var(--epub-scrollbar-track);");
	});
});
