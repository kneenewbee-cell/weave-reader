import { describe, expect, it } from "vitest";
import { readEpubReaderStylesheet } from "./epub-reader-styles-test-utils";

describe("epub scrolled layout symmetry", () => {
	it("does not reserve side-nav space with asymmetric reader-view padding", () => {
		const stylesheet = readEpubReaderStylesheet();

		expect(stylesheet).not.toContain(
			'[data-scrolled-side-nav="visible"] .epub-reader-view'
		);
		expect(stylesheet).toContain(
			'.epub-reader-root[data-flow="scrolled"] .epub-reader-view.epub-width-edge'
		);
		expect(stylesheet).toMatch(
			/\.epub-reader-root\[data-flow="scrolled"\] \.epub-reader-view\.epub-width-edge\s*\{[^}]*padding-left:\s*clamp\(2px, 0\.5vw, 8px\);[^}]*padding-right:\s*clamp\(2px, 0\.5vw, 8px\);/s
		);
	});

	it("stabilizes foliate scrolled scrollbar gutter without shifting the text column", () => {
		const stylesheet = readEpubReaderStylesheet();

		expect(stylesheet).toContain("scrollbar-gutter: stable;");
	});
});
