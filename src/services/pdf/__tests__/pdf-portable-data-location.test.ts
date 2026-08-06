import { describe, expect, it } from "vitest";
import {
	resolveLegacyPdfPortableBookDataLocation,
	resolvePdfPortableBookDataLocation,
} from "../pdf-portable-data-location";

describe("pdf portable data location", () => {
	it("resolves all PDF book data paths under one portable book directory", () => {
		const location = resolvePdfPortableBookDataLocation("Books/demo.pdf");

		expect(location.bookId).toMatch(/^pdf-book-[a-z0-9]+$/);
		expect(location).toEqual({
			bookId: location.bookId,
			bookDir: `weave/pdf-data/books/${location.bookId}`,
			bookMetadataPath: `weave/pdf-data/books/${location.bookId}/book.json`,
			annotationsPath: `weave/pdf-data/books/${location.bookId}/annotations.json`,
			inkPath: `weave/pdf-data/books/${location.bookId}/ink.json`,
			annotationsMarkdownPath: `weave/pdf-data/books/${location.bookId}/annotations.md`,
			semanticProfilePath: `weave/pdf-data/books/${location.bookId}/semantic-profile.json`,
			bookmarksPath: `weave/pdf-data/books/${location.bookId}/bookmarks.json`,
			readingStatePath: `weave/pdf-data/books/${location.bookId}/reading-state.json`,
			indexPath: "weave/pdf-data/index.json",
		});
	});

	it("can resolve the previous title-based PDF book directory for migration", () => {
		const legacyLocation = resolveLegacyPdfPortableBookDataLocation("Books/demo.pdf");

		expect(legacyLocation.bookId).toMatch(/^pdf-demo-[a-z0-9]+$/);
		expect(legacyLocation.annotationsPath).toBe(
			`weave/pdf-data/books/${legacyLocation.bookId}/annotations.json`
		);
		expect(legacyLocation.inkPath).toBe(
			`weave/pdf-data/books/${legacyLocation.bookId}/ink.json`
		);
	});
});
