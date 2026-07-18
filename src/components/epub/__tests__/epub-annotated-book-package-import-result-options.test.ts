import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	normalizePath: (value: string) =>
		String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, ""),
}));

import {
	isEpubAnnotatedBookImportMatchedDifferentBook,
	shouldOfferOpenImportedBookAction,
} from "../../modals/epub-annotated-book-package-import-result-options";

describe("epub annotated book package import result options", () => {
	it("offers an open-book action only when the active book differs from the target book", () => {
		expect(
			shouldOfferOpenImportedBookAction({
				activeBookPath: "Books/Demo.epub",
				targetBookPath: "Books/Demo.epub",
			}),
		).toBe(false);

		expect(
			shouldOfferOpenImportedBookAction({
				activeBookPath: "Books/Other.epub",
				targetBookPath: "Books/Demo.epub",
			}),
		).toBe(true);
	});

	it("detects when a right-click import matched a different book", () => {
		expect(
			isEpubAnnotatedBookImportMatchedDifferentBook({
				requestedBookPath: "Books/RightClicked.epub",
				targetBookPath: "Books/Matched.epub",
			}),
		).toBe(true);

		expect(
			isEpubAnnotatedBookImportMatchedDifferentBook({
				requestedBookPath: "Books/Matched.epub",
				targetBookPath: "Books/Matched.epub",
			}),
		).toBe(false);
	});
});
