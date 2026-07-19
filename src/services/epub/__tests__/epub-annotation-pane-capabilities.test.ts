import { describe, expect, it } from "vitest";
import { resolveEpubAnnotationPaneCapabilities } from "../epub-annotation-pane-capabilities";
import { createEpubAnnotationCompareContexts } from "../epub-dual-window";

describe("resolveEpubAnnotationPaneCapabilities", () => {
	it("keeps readonly compare panes readable but not editable", () => {
		const contexts = createEpubAnnotationCompareContexts({
			sessionId: "compare-1",
			bookId: "book-1",
			filePath: "Books/demo.epub",
			editableVersionId: "default",
			readonlyVersionId: "imported",
		});

		expect(
			resolveEpubAnnotationPaneCapabilities({
				hasExcerptNotes: true,
				annotationCompare: contexts?.readonly,
			})
		).toEqual({
			canReadAnnotations: true,
			canEditAnnotations: false,
			canUseSelectionToolbar: false,
		});
	});

	it("allows normal and editable compare panes to edit when the feature is available", () => {
		const contexts = createEpubAnnotationCompareContexts({
			sessionId: "compare-1",
			bookId: "book-1",
			filePath: "Books/demo.epub",
			editableVersionId: "default",
			readonlyVersionId: "imported",
		});

		expect(
			resolveEpubAnnotationPaneCapabilities({
				hasExcerptNotes: true,
				annotationCompare: null,
			}).canEditAnnotations
		).toBe(true);
		expect(
			resolveEpubAnnotationPaneCapabilities({
				hasExcerptNotes: true,
				annotationCompare: contexts?.editable,
			})
		).toMatchObject({
			canEditAnnotations: true,
			canUseSelectionToolbar: true,
		});
	});
});
