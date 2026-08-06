import {
	hasBookshelfDisplayDetails,
	mergeBookshelfDisplayMetadata,
	shouldParseBookshelfPublication,
} from "../bookshelf-metadata-loading";

describe("bookshelf-metadata-loading", () => {
	it("parses EPUB metadata even when the cover is already cached if display details are missing", () => {
		expect(
			shouldParseBookshelfPublication({
				isPdf: false,
				hasCachedCover: true,
				metadataParseAttempted: false,
				meta: {
					title: "Demo",
					author: "",
					chapterCount: undefined,
				},
			})
		).toBe(true);
	});

	it("does not keep reparsing a cached-cover EPUB after metadata was attempted", () => {
		expect(
			shouldParseBookshelfPublication({
				isPdf: false,
				hasCachedCover: true,
				metadataParseAttempted: true,
				meta: {
					title: "Demo",
					author: "",
					chapterCount: undefined,
				},
			})
		).toBe(false);
	});

	it("skips Foliate metadata parsing for PDF bookshelf entries", () => {
		expect(
			shouldParseBookshelfPublication({
				isPdf: true,
				hasCachedCover: false,
				metadataParseAttempted: false,
				meta: undefined,
			})
		).toBe(false);
	});

	it("recognizes byline and reading stats as complete display details", () => {
		expect(
			hasBookshelfDisplayDetails({
				publisher: "Packt Publishing",
				wordCount: 108000,
				chapterCount: 19,
			})
		).toBe(true);
	});

	it("merges parsed EPUB details into lightweight bookshelf metadata", () => {
		const result = mergeBookshelfDisplayMetadata(
			{
				title: "Demo",
				author: "",
				progress: 0,
				lastReadTime: 0,
				createdTime: 0,
				readingStatus: "鏈紑濮?",
			},
			{
				title: "Parsed title",
				author: "Stefan Kottwitz",
				publisher: "Packt Publishing",
				wordCount: 108000,
				chapterCount: 19,
			}
		);

		expect(result.changed).toBe(true);
		expect(result.metadata).toEqual({
			title: "Demo",
			author: "Stefan Kottwitz",
			publisher: "Packt Publishing",
			wordCount: 108000,
			chapterCount: 19,
			progress: 0,
			lastReadTime: 0,
			createdTime: 0,
			readingStatus: "鏈紑濮?",
		});
	});
});
