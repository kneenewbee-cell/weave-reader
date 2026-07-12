import { describe, expect, it } from "vitest";
import { HighlightIndex } from "../highlight/HighlightIndex";
import type { BacklinkHighlight } from "../EpubBacklinkHighlightService";

function createHighlight(cfiRange: string, sourceFile: string): BacklinkHighlight {
	return {
		cfiRange,
		color: "yellow",
		text: "demo",
		sourceFile,
	};
}

describe("HighlightIndex", () => {
	it("indexes highlights by cfi and source path", () => {
		const index = new HighlightIndex();
		index.buildFrom([
			createHighlight("epubcfi(/6/2)", "Notes/a.md"),
			createHighlight("epubcfi(/6/4)", "Notes/b.md"),
		]);

		expect(index.getByCfi("epubcfi(/6/2)")).toHaveLength(1);
		expect(index.getBySource("Notes/a.md")).toHaveLength(1);
		expect(index.getSnapshot()).toHaveLength(2);
	});

	it("upserts highlights without dropping other cfis", () => {
		const index = new HighlightIndex();
		index.buildFrom([createHighlight("epubcfi(/6/2)", "Notes/a.md")]);
		index.upsert(createHighlight("epubcfi(/6/4)", "Notes/a.md"));

		expect(index.getSnapshot()).toHaveLength(2);
		expect(index.getRevision()).toBeGreaterThan(0);
	});
});
