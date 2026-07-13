import { describe, expect, it } from "vitest";
import {
	findSameAnnotationRange,
	getAnnotationRangeKey,
	getAnnotationRangeRelation,
} from "../annotation-range-policy";
import type { ReaderHighlight } from "../reader-engine-types";

const base: ReaderHighlight = {
	cfiRange: " epubcfi(/6/2!/4/2) ",
	color: "yellow",
	text: "Marked   text",
	semanticId: "important",
	presentation: "highlight",
};

describe("annotation-range-policy", () => {
	it("treats normalized CFI and quote text as the same annotation range", () => {
		const incoming: ReaderHighlight = {
			...base,
			cfiRange: "epubcfi(/6/2!/4/2)",
			text: "Marked text",
			semanticId: "question",
		};

		expect(getAnnotationRangeRelation(base, incoming)).toBe("same-range");
		expect(getAnnotationRangeKey(base)).toBe(getAnnotationRangeKey(incoming));
	});

	it("does not treat different CFI ranges as the same annotation range", () => {
		const incoming: ReaderHighlight = {
			...base,
			cfiRange: "epubcfi(/6/4!/4/2)",
		};

		expect(getAnnotationRangeRelation(base, incoming)).toBe("different-range");
	});

	it("finds an existing highlight with the exact same range regardless of semantic id", () => {
		const existing = [
			base,
			{
				...base,
				cfiRange: "epubcfi(/6/4!/4/2)",
				text: "Other text",
				semanticId: "question",
			},
		];

		expect(findSameAnnotationRange(existing, {
			...base,
			semanticId: "definition",
		})?.semanticId).toBe("important");
	});
});
