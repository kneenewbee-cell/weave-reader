import { describe, expect, it } from "vitest";
import {
	isBookCompleted,
	resolveBookshelfReadingStatus,
	resolveDisplayProgress,
} from "../book-progress";
import type { EpubBook } from "../types";

function createBook(overrides: Partial<EpubBook> = {}): EpubBook {
	return {
		id: "book-1",
		filePath: "Books/demo.epub",
		metadata: {
			title: "Demo",
			author: "Author",
			chapterCount: 10,
		},
		currentPosition: { chapterIndex: 0, cfi: "", percent: 42 },
		readingStats: {
			totalReadTime: 0,
			lastReadTime: 0,
			createdTime: 1,
		},
		...overrides,
	};
}

describe("book-progress", () => {
	it("returns 100% display progress when completedTime is set", () => {
		const book = createBook({
			currentPosition: { chapterIndex: 2, cfi: "cfi", percent: 35 },
			readingStats: {
				totalReadTime: 0,
				lastReadTime: 100,
				createdTime: 1,
				completedTime: 200,
			},
		});
		expect(resolveDisplayProgress(book)).toBe(100);
		expect(resolveDisplayProgress(book, 12)).toBe(100);
	});

	it("uses raw percent before completion", () => {
		const book = createBook({
			currentPosition: { chapterIndex: 0, cfi: "", percent: 67.4 },
		});
		expect(resolveDisplayProgress(book)).toBe(67);
		expect(resolveDisplayProgress(book, 88.2)).toBe(88);
	});

	it("derives bookshelf status from completion marker, not percent alone", () => {
		expect(
			resolveBookshelfReadingStatus(
				createBook({
					currentPosition: { chapterIndex: 9, cfi: "end", percent: 100 },
				})
			)
		).toBe("阅读中");

		expect(
			resolveBookshelfReadingStatus(
				createBook({
					currentPosition: { chapterIndex: 0, cfi: "", percent: 10 },
					readingStats: {
						totalReadTime: 0,
						lastReadTime: 1,
						createdTime: 1,
						completedTime: 99,
					},
				})
			)
		).toBe("已读完");
	});

	it("detects completion via completedTime", () => {
		expect(isBookCompleted({ completedTime: 0 })).toBe(false);
		expect(isBookCompleted({ completedTime: 10 })).toBe(true);
		expect(isBookCompleted(undefined)).toBe(false);
	});
});
