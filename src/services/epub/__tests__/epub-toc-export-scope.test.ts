import {
	extractTocHrefFragment,
	resolveTocExportEndBoundary,
	type FlatTocExportItem,
} from "../epub-toc-export-scope";

function tocItem(
	id: string,
	label: string,
	href: string,
	depth: number
): FlatTocExportItem {
	return {
		id,
		label,
		href,
		level: depth,
		depth,
	};
}

describe("epub-toc-export-scope", () => {
	it("extracts href fragments", () => {
		expect(extractTocHrefFragment("Text/chapter.xhtml#section-c")).toBe("section-c");
		expect(extractTocHrefFragment("Text/chapter.xhtml")).toBe("");
	});

	it("uses the immediate next toc entry in the same section as the end boundary", () => {
		const flatItems = [
			tocItem("a", "A", "Text/chapter.xhtml#id-a", 0),
			tocItem("b", "B", "Text/chapter.xhtml#id-b", 1),
			tocItem("c", "C", "Text/chapter.xhtml#id-c", 2),
			tocItem("d", "D", "Text/chapter.xhtml#id-d", 2),
			tocItem("e", "E", "Text/chapter.xhtml#id-e", 1),
		];

		expect(resolveTocExportEndBoundary(flatItems, 2)?.id).toBe("d");
		expect(resolveTocExportEndBoundary(flatItems, 1)?.id).toBe("c");
		expect(resolveTocExportEndBoundary(flatItems, 0)?.id).toBe("b");
	});

	it("stops at section end when the next same-level item is in another file", () => {
		const flatItems = [
			tocItem("b", "B", "Text/chapter.xhtml#id-b", 1),
			tocItem("next", "Next", "Text/chapter2.xhtml", 0),
		];

		expect(resolveTocExportEndBoundary(flatItems, 0)).toBeNull();
	});
});
