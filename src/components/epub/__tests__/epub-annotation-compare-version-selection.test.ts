import { describe, expect, it } from "vitest";
import {
	isCompleteEpubAnnotationCompareSelection,
	resolveEpubAnnotationCompareSelection,
	resolveDefaultEpubAnnotationCompareSelection,
	selectEpubAnnotationCompareVersionSlot,
} from "../epub-annotation-compare-version-selection";
import type { EpubAnnotationVersionSummary } from "../../../services/epub";

function version(
	versionId: string,
	input: Partial<EpubAnnotationVersionSummary> = {}
): EpubAnnotationVersionSummary {
	return {
		bookId: "epub-book-demo",
		versionId,
		name: versionId,
		createdAt: 1,
		updatedAt: 1,
		annotationCount: 0,
		active: false,
		...input,
	};
}

describe("epub annotation compare version selection", () => {
	it("defaults the main editable pane to the active version and the side readonly pane to the next different version", () => {
		expect(
			resolveDefaultEpubAnnotationCompareSelection([
				version("default", { active: true }),
				version("imported-default", { updatedAt: 30 }),
				version("older", { updatedAt: 20 }),
			])
		).toEqual({
			editableVersionId: "default",
			readonlyVersionId: "imported-default",
		});
	});

	it("uses an existing compare selection when both versions are still available", () => {
		expect(
			resolveEpubAnnotationCompareSelection(
				[
					version("default", { active: true }),
					version("imported-default"),
					version("review-copy"),
				],
				{
					editableVersionId: "review-copy",
					readonlyVersionId: "imported-default",
				}
			)
		).toEqual({
			editableVersionId: "review-copy",
			readonlyVersionId: "imported-default",
		});
	});

	it("keeps the main and side pane selections on different versions when users change choices", () => {
		const versions = [
			version("default", { active: true }),
			version("imported-default"),
			version("review-copy"),
		];
		const initial = resolveDefaultEpubAnnotationCompareSelection(versions);

		expect(
			selectEpubAnnotationCompareVersionSlot(versions, initial, "editable", "imported-default")
		).toEqual({
			editableVersionId: "imported-default",
			readonlyVersionId: "default",
		});

		expect(
			selectEpubAnnotationCompareVersionSlot(versions, initial, "readonly", "default")
		).toEqual({
			editableVersionId: "imported-default",
			readonlyVersionId: "default",
		});
	});

	it("requires two different selected versions before opening compare mode", () => {
		expect(
			isCompleteEpubAnnotationCompareSelection({
				editableVersionId: "default",
				readonlyVersionId: "imported-default",
			})
		).toBe(true);
		expect(
			isCompleteEpubAnnotationCompareSelection({
				editableVersionId: "default",
				readonlyVersionId: "default",
			})
		).toBe(false);
	});
});
