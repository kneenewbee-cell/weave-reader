import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	normalizePath: (value: string) =>
		String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, ""),
}));

import {
	readEpubPortableBookmarks,
	readEpubPortableReadingState,
	writeEpubPortableBookmarks,
	writeEpubPortableReadingState,
} from "../epub-portable-book-data";

function normalizePath(value: string): string {
	return String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function createAppHarness(initialFiles: Record<string, unknown> = {}) {
	const files = new Map(
		Object.entries(initialFiles).map(([path, value]) => [
			normalizePath(path),
			typeof value === "string" ? value : JSON.stringify(value),
		]),
	);
	const folders = new Set<string>();
	const addParentFolders = (path: string) => {
		const parts = normalizePath(path).split("/");
		for (let index = 1; index < parts.length; index += 1) {
			folders.add(parts.slice(0, index).join("/"));
		}
	};
	for (const path of files.keys()) {
		addParentFolders(path);
	}
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
	const app = {
		vault: {
			adapter,
		},
	} as any;
	return { app, files, folders, adapter };
}

function readJson(files: Map<string, string>, path: string): any {
	const content = files.get(normalizePath(path));
	expect(content, `Expected ${path} to exist`).toBeTruthy();
	return JSON.parse(content || "{}");
}

describe("epub-portable-book-data", () => {
	it("reads portable reading state and bookmarks as the primary book data", async () => {
		const bookId = "epub-book-demo";
		const root = `weave/epub-data/books/${bookId}`;
		const { app } = createAppHarness({
			[`${root}/reading-state.json`]: {
				format: "weave-reader-reading-state/v1",
				version: 1,
				bookId,
				currentPosition: { cfi: "epubcfi(/6/2)", chapterIndex: 1, percent: 12 },
				readingStats: { totalReadTime: 5000, lastReadTime: 20, createdTime: 10 },
			},
			[`${root}/bookmarks.json`]: {
				format: "weave-reader-bookmarks/v1",
				version: 1,
				bookId,
				bookmarks: [{ id: "bm-1", cfi: "epubcfi(/6/4)", createdAt: 30 }],
			},
		});

		await expect(readEpubPortableReadingState(app, bookId)).resolves.toMatchObject({
			currentPosition: { cfi: "epubcfi(/6/2)" },
			readingStats: { totalReadTime: 5000 },
		});
		await expect(readEpubPortableBookmarks(app, bookId)).resolves.toEqual([
			expect.objectContaining({ id: "bm-1", cfi: "epubcfi(/6/4)" }),
		]);
	});

	it("writes reading state and bookmarks under epub-data/books/<bookId>", async () => {
		const bookId = "epub-book-demo";
		const { app, files } = createAppHarness();

		await writeEpubPortableReadingState(app, bookId, {
			currentPosition: { cfi: "epubcfi(/6/8)", chapterIndex: 2, percent: 45 },
			readingStats: { totalReadTime: 9000, lastReadTime: 30, createdTime: 10 },
		});
		await writeEpubPortableBookmarks(app, bookId, [
			{ id: "bm-1", cfi: "epubcfi(/6/4)", chapterIndex: 1, percent: 20, chapterTitle: "Chapter", createdAt: 30 },
		]);

		expect(readJson(files, `weave/epub-data/books/${bookId}/reading-state.json`)).toMatchObject({
			format: "weave-reader-reading-state/v1",
			bookId,
			currentPosition: { percent: 45 },
		});
		expect(readJson(files, `weave/epub-data/books/${bookId}/bookmarks.json`)).toMatchObject({
			format: "weave-reader-bookmarks/v1",
			bookId,
			bookmarks: [{ id: "bm-1" }],
		});
	});
});
