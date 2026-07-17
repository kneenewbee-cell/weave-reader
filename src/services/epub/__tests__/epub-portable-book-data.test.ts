import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	normalizePath: (value: string) =>
		String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, ""),
}));

import {
	hasEpubPortableBookmarksData,
	hasEpubPortableReadingStateData,
	readEpubPortableBookmarks,
	readEpubPortableReadingState,
	writeEpubPortableBookmarks,
	writeEpubPortableReadingState,
} from "../epub-portable-book-data";

function normalizePath(value: string): string {
	return String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function createAppHarness() {
	const files = new Map<string, string>();
	const folders = new Set<string>();
	const addParentFolders = (path: string) => {
		const parts = normalizePath(path).split("/");
		for (let index = 1; index < parts.length; index += 1) {
			folders.add(parts.slice(0, index).join("/"));
		}
	};
	const adapter = {
		exists: vi.fn(async (path: string) => files.has(normalizePath(path)) || folders.has(normalizePath(path))),
		read: vi.fn(async (path: string) => files.get(normalizePath(path)) ?? ""),
		write: vi.fn(async (path: string, content: string) => {
			const normalized = normalizePath(path);
			files.set(normalized, content);
			addParentFolders(normalized);
		}),
		mkdir: vi.fn(async (path: string) => {
			folders.add(normalizePath(path));
		}),
	};
	return {
		app: {
			vault: {
				adapter,
			},
		} as any,
		files,
	};
}

describe("epub-portable-book-data", () => {
	it("writes and reads portable reading state", async () => {
		const { app, files } = createAppHarness();

		await writeEpubPortableReadingState(app, "book one", {
			currentPosition: {
				chapterIndex: 2,
				cfi: "epubcfi(/6/4)",
				percent: 35.5,
			},
			readingStats: {
				totalReadTime: 1200,
				lastReadTime: 1784000000000,
				createdTime: 1783990000000,
				bookWpm: 260,
			},
		});

		expect(await hasEpubPortableReadingStateData(app, "book one")).toBe(true);
		expect(JSON.parse(files.get("weave/epub-data/books/book-one/reading-state.json") || "{}")).toMatchObject({
			format: "weave-reader-reading-state/v1",
			bookId: "book-one",
			currentPosition: {
				chapterIndex: 2,
				cfi: "epubcfi(/6/4)",
				percent: 35.5,
			},
		});
		await expect(readEpubPortableReadingState(app, "book one")).resolves.toMatchObject({
			currentPosition: {
				chapterIndex: 2,
				cfi: "epubcfi(/6/4)",
				percent: 35.5,
			},
			readingStats: {
				totalReadTime: 1200,
				lastReadTime: 1784000000000,
				createdTime: 1783990000000,
				bookWpm: 260,
			},
		});
	});

	it("writes and reads portable bookmarks sorted newest first", async () => {
		const { app, files } = createAppHarness();

		await writeEpubPortableBookmarks(app, "book one", [
			{
				id: "older",
				cfi: "epubcfi(/6/2)",
				chapterIndex: 1,
				percent: 10,
				chapterTitle: "Intro",
				createdAt: 100,
			},
			{
				id: "newer",
				cfi: "epubcfi(/6/8)",
				chapterIndex: 3,
				percent: 55,
				chapterTitle: "Later",
				createdAt: 200,
				preview: "Preview text",
			},
		]);

		expect(await hasEpubPortableBookmarksData(app, "book one")).toBe(true);
		expect(JSON.parse(files.get("weave/epub-data/books/book-one/bookmarks.json") || "{}")).toMatchObject({
			format: "weave-reader-bookmarks/v1",
			bookId: "book-one",
			bookmarks: [
				{ id: "older", cfi: "epubcfi(/6/2)" },
				{ id: "newer", cfi: "epubcfi(/6/8)" },
			],
		});
		await expect(readEpubPortableBookmarks(app, "book one")).resolves.toEqual([
			expect.objectContaining({ id: "newer", preview: "Preview text" }),
			expect.objectContaining({ id: "older" }),
		]);
	});
});
