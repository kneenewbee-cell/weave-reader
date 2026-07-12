import { describe, expect, it } from "vitest";
import {
	applyHighlightSourceOptimisticSyncResult,
	computeHighlightSourceOptimisticSync,
} from "../highlight/highlight-source-optimistic-sync";
import type { ReaderHighlight } from "../reader-engine-types";

describe("highlight-source-optimistic-sync", () => {
	it("removes highlights that only existed in the changed source file", () => {
		const current: ReaderHighlight[] = [
			{
				cfiRange: "epubcfi(/6/4!/4/2,/1:0,/1:5)",
				color: "yellow",
				text: "摘录 A",
				sourceFile: "Notes/book-a.md",
				excerptId: "ex-a",
				presentation: "highlight",
			},
			{
				cfiRange: "epubcfi(/6/8!/4/2,/1:0,/1:5)",
				color: "green",
				text: "摘录 B",
				sourceFile: "Notes/other.md",
				excerptId: "ex-b",
				presentation: "highlight",
			},
		];

		const result = computeHighlightSourceOptimisticSync(current, "Notes/book-a.md", []);
		expect(result.removed).toHaveLength(1);
		expect(result.removed[0]?.excerptId).toBe("ex-a");
		expect(result.updated).toHaveLength(0);

		const next = applyHighlightSourceOptimisticSyncResult(current, result);
		expect(next).toHaveLength(1);
		expect(next[0]?.excerptId).toBe("ex-b");
	});

	it("keeps merged highlights when another source file still backs the same mark", () => {
		const current: ReaderHighlight[] = [
			{
				cfiRange: "readium:shared",
				color: "yellow",
				text: "Shared highlight",
				sourceFile: "Notes/demo.md",
				excerptId: "shared",
				sourceLocators: [
					{ sourceFile: "Notes/demo.md", excerptId: "shared" },
					{
						sourceFile: "weave/memory/deck-files/demo.wdeck",
						sourceRef: "card:card-a",
						excerptId: "shared",
					},
				],
				presentation: "highlight",
			},
		];

		const result = computeHighlightSourceOptimisticSync(current, "Notes/demo.md", []);
		expect(result.removed).toHaveLength(0);
		expect(result.updated).toHaveLength(1);
		expect(result.updated[0]?.sourceFile).toBe("weave/memory/deck-files/demo.wdeck");
		expect(result.updated[0]?.sourceLocators).toEqual([
			{
				sourceFile: "weave/memory/deck-files/demo.wdeck",
				sourceRef: "card:card-a",
				excerptId: "shared",
			},
		]);
	});

	it("does not remove highlights that still exist in the changed source file", () => {
		const current: ReaderHighlight[] = [
			{
				cfiRange: "epubcfi(/6/4!/4/2,/1:0,/1:5)",
				color: "yellow",
				text: "保留",
				sourceFile: "Notes/book-a.md",
				excerptId: "keep-me",
				presentation: "highlight",
			},
			{
				cfiRange: "epubcfi(/6/8!/4/2,/1:0,/1:5)",
				color: "green",
				text: "删除",
				sourceFile: "Notes/book-a.md",
				excerptId: "drop-me",
				presentation: "highlight",
			},
		];
		const remaining: ReaderHighlight[] = [
			{
				cfiRange: "epubcfi(/6/4!/4/2,/1:0,/1:5)",
				color: "yellow",
				text: "保留",
				sourceFile: "Notes/book-a.md",
				excerptId: "keep-me",
				presentation: "highlight",
			},
		];

		const result = computeHighlightSourceOptimisticSync(current, "Notes/book-a.md", remaining);
		expect(result.removed).toHaveLength(1);
		expect(result.removed[0]?.excerptId).toBe("drop-me");
	});

	it("applies locator-only updates without dropping unrelated highlights", () => {
		const current: ReaderHighlight[] = [
			{
				cfiRange: "readium:shared",
				color: "yellow",
				text: "Shared highlight",
				sourceFile: "Notes/demo.md",
				excerptId: "shared",
				sourceLocators: [
					{ sourceFile: "Notes/demo.md", excerptId: "shared" },
					{
						sourceFile: "weave/memory/deck-files/demo.wdeck",
						sourceRef: "card:card-a",
						excerptId: "shared",
					},
				],
				presentation: "highlight",
			},
		];
		const result = computeHighlightSourceOptimisticSync(current, "Notes/demo.md", []);
		const next = applyHighlightSourceOptimisticSyncResult(current, result);

		expect(next).toHaveLength(1);
		expect(next[0]?.sourceFile).toBe("weave/memory/deck-files/demo.wdeck");
	});
});
