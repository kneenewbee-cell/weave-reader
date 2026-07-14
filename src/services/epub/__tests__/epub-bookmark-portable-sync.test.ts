import { describe, expect, it, vi } from "vitest";
import { syncEpubBookmarkFrontmatterToPortableData } from "../epub-bookmark-portable-sync";

function createAppHarness(initialFiles: Record<string, string> = {}) {
	const files = new Map(Object.entries(initialFiles));
	const folders = new Set<string>();
	const adapter = {
		exists: vi.fn(async (path: string) => files.has(path) || folders.has(path)),
		read: vi.fn(async (path: string) => files.get(path) ?? ""),
		write: vi.fn(async (path: string, content: string) => {
			files.set(path, content);
		}),
		mkdir: vi.fn(async (path: string) => {
			folders.add(path);
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
	const content = files.get(path);
	expect(content, `Expected ${path} to exist`).toBeTruthy();
	return JSON.parse(content || "{}");
}

describe("epub-bookmark-portable-sync", () => {
	it("splits legacy bookmark frontmatter into portable per-book JSON files", async () => {
		const { app, files } = createAppHarness();

		await syncEpubBookmarkFrontmatterToPortableData(
			app,
			{
				stableKey: "epubsrc-demo",
				bookId: "epub-book-demo",
				sourceFingerprint: "abc123",
				bookPath: "Books/Demo.epub",
				displayTitle: "Demo",
				bookTitle: "Demo Book",
				bookAuthor: "Author A",
				bookLanguage: "en",
				publisher: "Publisher",
				isbn: "978-demo",
				wordCount: 1234,
				chapterCount: 5,
				updatedAt: 1_800_000_000_000,
				bookmarks: [
					{
						id: "bm-1",
						cfi: "epubcfi(/6/2)",
						chapterIndex: 1,
						percent: 12,
						chapterTitle: "Chapter 1",
						createdAt: 1,
					},
				],
				readingState: {
					currentPosition: {
						chapterIndex: 2,
						cfi: "epubcfi(/6/4)",
						percent: 34,
					},
					readingStats: {
						totalReadTime: 60000,
						lastReadTime: 1_800_000_000_000,
						createdTime: 1_799_999_000_000,
					},
				},
				analytics: {
					highlightCount: 3,
					highlightsByColor: { yellow: 2, red: 1 },
				},
				user: {
					tags: ["study"],
					notes: "keep",
				},
			},
			{ bookmarkFilePath: "weave/epub-bookmarks/data_Demo.md" },
		);

		const root = "weave/epub-data/books/epub-book-demo";
		expect(readJson(files, `${root}/book.json`)).toMatchObject({
			format: "weave-reader-book/v1",
			bookId: "epub-book-demo",
			stableKey: "epubsrc-demo",
			filePath: "Books/Demo.epub",
			knownPaths: ["Books/Demo.epub"],
			bookmarkPagePath: "weave/epub-bookmarks/data_Demo.md",
			title: "Demo Book",
			author: "Author A",
			sourceFingerprint: "abc123",
		});
		expect(readJson(files, `${root}/reading-state.json`)).toMatchObject({
			format: "weave-reader-reading-state/v1",
			bookId: "epub-book-demo",
			currentPosition: {
				cfi: "epubcfi(/6/4)",
				percent: 34,
			},
		});
		expect(readJson(files, `${root}/bookmarks.json`)).toMatchObject({
			format: "weave-reader-bookmarks/v1",
			bookId: "epub-book-demo",
			bookmarks: [{ id: "bm-1" }],
		});
		expect(readJson(files, `${root}/stats.json`)).toMatchObject({
			format: "weave-reader-book-stats/v1",
			bookId: "epub-book-demo",
			analytics: {
				highlightCount: 3,
			},
		});
		expect(readJson(files, `${root}/user.json`)).toMatchObject({
			format: "weave-reader-book-user/v1",
			bookId: "epub-book-demo",
			tags: ["study"],
			notes: "keep",
		});
		expect(readJson(files, "weave/epub-data/index.json")).toMatchObject({
			format: "weave-reader-epub-data-index/v1",
			books: {
				"epub-book-demo": {
					bookId: "epub-book-demo",
					filePath: "Books/Demo.epub",
					knownPaths: ["Books/Demo.epub"],
					sourceFingerprint: "abc123",
				},
			},
		});
	});

	it("reuses an indexed portable book id when legacy frontmatter has an old book id", async () => {
		const { app, files } = createAppHarness({
			"weave/epub-data/index.json": JSON.stringify({
				format: "weave-reader-epub-data-index/v1",
				version: 1,
				books: {
					"epub-book-current": {
						bookId: "epub-book-current",
						filePath: "Books/Demo.epub",
						knownPaths: ["Books/Demo.epub"],
						sourceFingerprint: "fingerprint-demo",
						stableKey: "epubsrc-fingerprint",
					},
				},
			}),
			"weave/epub-data/books/epub-book-current/book.json": JSON.stringify({
				format: "weave-reader-book/v1",
				version: 1,
				bookId: "epub-book-current",
				stableKey: "epubsrc-fingerprint",
				filePath: "Books/Demo.epub",
			}),
		});

		await syncEpubBookmarkFrontmatterToPortableData(app, {
			stableKey: "epub-book-old",
			bookId: "epub-book-old",
			bookPath: "Books/Demo.epub",
			bookTitle: "Demo Book",
			updatedAt: 1_800_000_000_001,
			bookmarks: [],
			readingState: {
				currentPosition: {
					chapterIndex: 1,
					cfi: "epubcfi(/6/8)",
					percent: 56,
				},
				readingStats: {
					totalReadTime: 120000,
					lastReadTime: 1_800_000_000_001,
					createdTime: 1_799_999_000_000,
				},
			},
		});

		expect(files.has("weave/epub-data/books/epub-book-old/book.json")).toBe(
			false,
		);
		expect(
			readJson(files, "weave/epub-data/books/epub-book-current/book.json"),
		).toMatchObject({
			bookId: "epub-book-current",
			stableKey: "epubsrc-fingerprint",
			filePath: "Books/Demo.epub",
		});
		expect(
			readJson(
				files,
				"weave/epub-data/books/epub-book-current/reading-state.json",
			),
		).toMatchObject({
			bookId: "epub-book-current",
			currentPosition: {
				cfi: "epubcfi(/6/8)",
				percent: 56,
			},
		});
		expect(readJson(files, "weave/epub-data/index.json")).toMatchObject({
			books: {
				"epub-book-current": {
					bookId: "epub-book-current",
					stableKey: "epubsrc-fingerprint",
					filePath: "Books/Demo.epub",
				},
			},
		});
	});
});
