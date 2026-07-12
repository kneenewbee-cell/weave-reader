import { describe, expect, it } from "vitest";
import { EpubAnnotationUndoStack } from "../annotation-undo-stack";
import type { ReaderHighlight } from "../reader-engine-types";

const baseHighlight: ReaderHighlight = {
	cfiRange: "epubcfi(/6/2!/4/2)",
	color: "yellow",
	text: "Marked text",
	semanticId: "important",
	presentation: "highlight",
};

describe("EpubAnnotationUndoStack", () => {
	it("turns a created annotation into a delete undo patch", () => {
		const stack = new EpubAnnotationUndoStack();

		stack.pushCreate("book-1", baseHighlight);

		expect(stack.canUndo()).toBe(true);
		expect(stack.undo()).toEqual({
			kind: "delete",
			bookId: "book-1",
			highlight: baseHighlight,
		});
		expect(stack.canUndo()).toBe(false);
	});

	it("turns a deleted annotation into a restore undo patch", () => {
		const stack = new EpubAnnotationUndoStack();

		stack.pushDelete("book-1", baseHighlight);

		expect(stack.undo()).toEqual({
			kind: "restore",
			bookId: "book-1",
			highlight: baseHighlight,
		});
	});

	it("undoes consecutive annotation operations in stack order", () => {
		const stack = new EpubAnnotationUndoStack();
		const secondHighlight: ReaderHighlight = {
			...baseHighlight,
			cfiRange: "epubcfi(/6/4!/4/2)",
			text: "Second marked text",
			semanticId: "question",
		};

		stack.pushCreate("book-1", baseHighlight);
		stack.pushDelete("book-1", secondHighlight);

		expect(stack.undo()).toEqual({
			kind: "restore",
			bookId: "book-1",
			highlight: secondHighlight,
		});
		expect(stack.undo()).toEqual({
			kind: "delete",
			bookId: "book-1",
			highlight: baseHighlight,
		});
		expect(stack.undo()).toBeNull();
	});
});
