import { describe, expect, it } from "vitest";
import {
	getReaderHighlightIdentityKey,
	hasReaderHighlightPresentationChanged,
	mergeReaderHighlightsByIdentity,
	normalizeHighlightQuoteText,
	resolvedRangeCoversHighlightText,
} from "../highlight/highlight-identity";
import type { ReaderHighlight } from "../reader-engine-types";

describe("highlight-identity", () => {
	it("uses excerpt id as the primary identity discriminator", () => {
		const base = {
			cfiRange: "epubcfi(/6/26)",
			text: "same quote",
		};
		expect(getReaderHighlightIdentityKey({ ...base, excerptId: "a" })).not.toBe(
			getReaderHighlightIdentityKey({ ...base, excerptId: "b" })
		);
	});

	it("keeps same quote at same cfi separate when semantic ids differ", () => {
		const base = {
			cfiRange: "epubcfi(/6/26)",
			text: "same quote",
			color: "yellow",
		} as const;
		expect(getReaderHighlightIdentityKey({ ...base, semanticId: "important" })).not.toBe(
			getReaderHighlightIdentityKey({ ...base, semanticId: "question" })
		);

		const merged = mergeReaderHighlightsByIdentity([], [
			{ ...base, semanticId: "important", semanticLabel: "重点" },
			{ ...base, semanticId: "question", semanticLabel: "疑问", color: "purple" },
		] as ReaderHighlight[]);
		expect(merged).toHaveLength(2);
	});

	it("prefers the first merged highlight's comment text over stale in-memory data", () => {
		const merged = mergeReaderHighlightsByIdentity(
			[
				{
					cfiRange: "epubcfi(/6/26)",
					color: "yellow",
					text: "Quote",
					commentText: "Updated thought",
					hasCommentDivider: true,
				},
			],
			[
				{
					cfiRange: "epubcfi(/6/26)",
					color: "yellow",
					text: "Quote",
					commentText: "Old thought",
					hasCommentDivider: true,
				},
			]
		);

		expect(merged).toHaveLength(1);
		expect(merged[0]?.commentText).toBe("Updated thought");
	});

	it("detects reader-visible highlight presentation changes", () => {
		const base = {
			cfiRange: "epubcfi(/6/26)",
			color: "yellow" as const,
			text: "Quote",
			commentText: "Same",
			hasCommentDivider: true,
		};
		expect(hasReaderHighlightPresentationChanged(base, { ...base })).toBe(false);
		expect(
			hasReaderHighlightPresentationChanged(base, {
				...base,
				commentText: "Changed",
			})
		).toBe(true);
	});

	it("merges same quote at same cfi from different source files", () => {
		const merged = mergeReaderHighlightsByIdentity(
			[
				{
					cfiRange: "readium:shared",
					color: "green",
					text: "Shared highlight",
					sourceFile: "Notes/demo.md",
				},
			],
			[
				{
					cfiRange: "readium:shared",
					color: "green",
					text: "Shared highlight",
					sourceFile: "weave/memory/deck-files/demo.wdeck",
					sourceRef: "card:card-a",
				},
			]
		);

		expect(merged).toHaveLength(1);
		expect(merged[0]?.sourceLocators).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ sourceFile: "Notes/demo.md" }),
				expect.objectContaining({
					sourceFile: "weave/memory/deck-files/demo.wdeck",
					sourceRef: "card:card-a",
				}),
			])
		);
	});

	it("keeps distinct highlights when quote text differs at the same cfi", () => {
		const merged = mergeReaderHighlightsByIdentity([], [
			{
				cfiRange: "epubcfi(/6/26)",
				color: "yellow",
				text: "第一段",
			},
			{
				cfiRange: "epubcfi(/6/26)",
				color: "green",
				text: "第二段",
			},
		] as ReaderHighlight[]);

		expect(merged).toHaveLength(2);
	});

	it("detects when a resolved range only covers a prefix of the saved quote", () => {
		const range = document.createRange();
		const paragraph = document.createElement("p");
		paragraph.textContent = "第一段文字第二段文字";
		document.body.appendChild(paragraph);
		range.setStart(paragraph.firstChild as Text, 0);
		range.setEnd(paragraph.firstChild as Text, 5);

		expect(
			resolvedRangeCoversHighlightText(range, "第一段文字\n第二段文字")
		).toBe(false);
		expect(normalizeHighlightQuoteText("第一段文字\n第二段文字")).toBe(
			"第一段文字 第二段文字"
		);

		range.setEnd(paragraph.firstChild as Text, paragraph.textContent?.length || 0);
		expect(
			resolvedRangeCoversHighlightText(range, "第一段文字\n第二段文字")
		).toBe(true);

		document.body.removeChild(paragraph);
	});

	it("treats curly and straight quotation marks as equivalent for coverage", () => {
		const range = document.createRange();
		const paragraph = document.createElement("p");
		paragraph.textContent = "“别生气，”乔布斯向他保证，";
		document.body.appendChild(paragraph);
		range.selectNodeContents(paragraph);

		expect(
			resolvedRangeCoversHighlightText(range, '"别生气，"乔布斯向他保证，')
		).toBe(true);

		document.body.removeChild(paragraph);
	});
});
