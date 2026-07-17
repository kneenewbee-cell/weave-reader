import { describe, expect, it } from "vitest";
import {
	findEpubPortableBookIdInIndex,
	resolveEpubPortableBookDataLocation,
} from "../epub-portable-data-location";

describe("epub portable data location", () => {
	it("resolves the user-visible data paths for a portable book id", () => {
		const location = resolveEpubPortableBookDataLocation("epub-book-rv441q");

		expect(location).toEqual({
			bookId: "epub-book-rv441q",
			bookDir: "weave/epub-data/books/epub-book-rv441q",
			bookMetadataPath: "weave/epub-data/books/epub-book-rv441q/book.json",
			annotationsPath: "weave/epub-data/books/epub-book-rv441q/annotations.json",
			semanticProfilePath: "weave/epub-data/books/epub-book-rv441q/semantic-profile.json",
			bookmarksPath: "weave/epub-data/books/epub-book-rv441q/bookmarks.json",
			readingStatePath: "weave/epub-data/books/epub-book-rv441q/reading-state.json",
			indexPath: "weave/epub-data/index.json",
		});
	});

	it("sanitizes unsafe book ids before building data paths", () => {
		const location = resolveEpubPortableBookDataLocation(" demo book / 01 ");

		expect(location.bookId).toBe("demo-book-01");
		expect(location.annotationsPath).toBe("weave/epub-data/books/demo-book-01/annotations.json");
	});

	it("finds a portable book id by current or known file path in the data index", () => {
		const index = {
			books: {
				"epub-book-a": {
					bookId: "epub-book-a",
					filePath: "Books/Old Name.epub",
					knownPaths: ["Books/Old Name.epub", "Books/New Name.epub"],
				},
				"epub-book-b": {
					bookId: "epub-book-b",
					filePath: "Books/Other.epub",
				},
			},
		};

		expect(findEpubPortableBookIdInIndex(index, "Books/New Name.epub")).toBe("epub-book-a");
		expect(findEpubPortableBookIdInIndex(index, "Books/Other.epub")).toBe("epub-book-b");
		expect(findEpubPortableBookIdInIndex(index, "Books/Missing.epub")).toBe("");
	});
});
