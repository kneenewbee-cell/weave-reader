import { describe, expect, it } from "vitest";
import { resolveSelectionSegments, shouldStoreSelectionSegments } from "../selection-segments";
import type { ReaderFrame } from "../reader-engine-types";

function createFrame(doc: Document): ReaderFrame {
	return {
		frameDocument: doc,
		window: doc.defaultView as Window,
		cfiFromRange: (range: Range) => `cfi:${range.toString()}`,
	};
}

function createSelection(range: Range): Selection {
	return {
		isCollapsed: false,
		rangeCount: 1,
		getRangeAt: () => range,
		toString: () => range.toString(),
	} as Selection;
}

describe("selection-segments", () => {
	it("keeps a single paragraph selection as one segment", () => {
		const doc = document.implementation.createHTMLDocument("single");
		doc.body.innerHTML = "<p>First paragraph has enough text.</p>";
		const text = doc.querySelector("p")?.firstChild as Text;
		const range = doc.createRange();
		range.setStart(text, 0);
		range.setEnd(text, text.textContent?.length || 0);
		const selection = createSelection(range);

		const segments = resolveSelectionSegments(selection, createFrame(doc));

		expect(segments).toEqual([
			{
				cfiRange: "cfi:First paragraph has enough text.",
				text: "First paragraph has enough text.",
			},
		]);
		expect(shouldStoreSelectionSegments(segments, selection.toString())).toBe(false);
	});

	it("splits a cross-paragraph selection into stored segments", () => {
		const doc = document.implementation.createHTMLDocument("multi");
		doc.body.innerHTML =
			"<section><p>First paragraph has enough text.</p><p>Second paragraph should stay highlighted.</p></section>";
		const first = doc.querySelectorAll("p")[0]?.firstChild as Text;
		const second = doc.querySelectorAll("p")[1]?.firstChild as Text;
		const range = doc.createRange();
		range.setStart(first, 0);
		range.setEnd(second, second.textContent?.length || 0);
		const selection = createSelection(range);

		const segments = resolveSelectionSegments(selection, createFrame(doc));

		expect(segments).toEqual([
			{
				cfiRange: "cfi:First paragraph has enough text.",
				text: "First paragraph has enough text.",
			},
			{
				cfiRange: "cfi:Second paragraph should stay highlighted.",
				text: "Second paragraph should stay highlighted.",
			},
		]);
		expect(shouldStoreSelectionSegments(segments, selection.toString())).toBe(true);
	});
});
