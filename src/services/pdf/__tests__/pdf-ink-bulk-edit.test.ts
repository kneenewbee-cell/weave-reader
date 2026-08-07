import { describe, expect, it } from "vitest";
import type { PdfInkStroke } from "../pdf-ink-annotation-store";
import {
	applyPdfInkStylePatch,
	getPdfInkSelectionBounds,
	scalePdfInkSelectionFromBaseline,
} from "../pdf-ink-bulk-edit";

const strokeA: PdfInkStroke = {
	id: "a",
	pageNumber: 1,
	tool: "pen",
	color: "#111111",
	width: 2,
	points: [
		{ x: 0.2, y: 0.2, t: 1 },
		{ x: 0.4, y: 0.4, t: 2 },
	],
};

const strokeB: PdfInkStroke = {
	id: "b",
	pageNumber: 1,
	tool: "highlighter",
	color: "#ffd54a",
	width: 10,
	points: [
		{ x: 0.6, y: 0.3, t: 3 },
		{ x: 0.8, y: 0.5, t: 4 },
	],
};

describe("pdf ink bulk edit helpers", () => {
	it("computes the combined bounds and center for selected strokes", () => {
		expect(getPdfInkSelectionBounds([strokeA, strokeB])).toEqual({
			left: 0.2,
			top: 0.2,
			right: 0.8,
			bottom: 0.5,
			centerX: 0.5,
			centerY: 0.35,
		});
	});

	it("applies style changes only to selected strokes", () => {
		const result = applyPdfInkStylePatch([strokeA, strokeB], new Set(["b"]), {
			tool: "pen",
			color: "#ff0000",
			width: 3,
		});

		expect(result[0]).toEqual(strokeA);
		expect(result[1]).toMatchObject({
			id: "b",
			tool: "pen",
			color: "#ff0000",
			width: 3,
		});
		expect(result[1].points).toEqual(strokeB.points);
	});

	it("scales selected strokes around their group center and scales width", () => {
		const result = scalePdfInkSelectionFromBaseline(
			[strokeA, strokeB],
			[strokeA, strokeB],
			new Set(["a", "b"]),
			2,
		);

		expect(result[0].points).toEqual([
			{ x: 0, y: 0.05, t: 1 },
			{ x: 0.3, y: 0.45, t: 2 },
		]);
		expect(result[1].points).toEqual([
			{ x: 0.7, y: 0.25, t: 3 },
			{ x: 1, y: 0.65, t: 4 },
		]);
		expect(result[0].width).toBe(4);
		expect(result[1].width).toBe(20);
	});
});
