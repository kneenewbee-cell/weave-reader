import { describe, expect, it } from "vitest";
import { shouldClearAnnotationsForSemanticSchemeChange } from "./epub-semantic-settings-actions";

describe("epub semantic settings actions", () => {
	it("clears annotations only when replacing the current version semantic scheme", () => {
		expect(
			shouldClearAnnotationsForSemanticSchemeChange({
				scope: "book",
				bookId: "epub-book-demo",
				currentSchemeId: "academic-research",
				nextSchemeId: "study-exam",
			})
		).toBe(true);
		expect(
			shouldClearAnnotationsForSemanticSchemeChange({
				scope: "global",
				bookId: "epub-book-demo",
				currentSchemeId: "academic-research",
				nextSchemeId: "study-exam",
			})
		).toBe(false);
		expect(
			shouldClearAnnotationsForSemanticSchemeChange({
				scope: "book",
				bookId: "",
				currentSchemeId: "academic-research",
				nextSchemeId: "study-exam",
			})
		).toBe(false);
		expect(
			shouldClearAnnotationsForSemanticSchemeChange({
				scope: "book",
				bookId: "epub-book-demo",
				currentSchemeId: "academic-research",
				nextSchemeId: "academic-research",
			})
		).toBe(false);
		expect(
			shouldClearAnnotationsForSemanticSchemeChange({
				scope: "book",
				bookId: "epub-book-demo",
				currentSchemeId: "academic-research",
				nextSchemeId: "custom",
			})
		).toBe(false);
	});
});
