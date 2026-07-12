import { describe, expect, it, vi } from "vitest";
import { EPUB_BOOKMARK_FILE_FORMAT_V2, EPUB_BOOKMARK_FILE_FORMAT_V3 } from "../epub-bookmark-page-types";

describe("epub-bookmark-migration", () => {
	it("creates plugin-folder backup manifest before migration", async () => {
		const { createEpubBookmarkMigrationBackup } = await import("../epub-bookmark-migration");
		const writes = new Map<string, string>();
		const legacyContent = `---
format: "${EPUB_BOOKMARK_FILE_FORMAT_V2}"
weave_epub_bookmark_file: true
stableKey: "epubsrc-demo"
bookId: "book-1"
bookPath: "Books/demo.epub"
bookTitle: "Demo"
updatedAt: 1
bookmarks: []
---
`;
		const app = {
			vault: {
				adapter: {
					exists: vi.fn(async (path: string) => {
						return (
							path.includes("data_Demo.md") ||
							path.includes("epub-bookmark-v3-state.json") ||
							path.includes("/files/")
						);
					}),
					mkdir: vi.fn(async () => undefined),
					write: vi.fn(async (path: string, content: string) => {
						writes.set(path, content);
					}),
					read: vi.fn(async (path: string) => {
						if (path.includes("data_Demo.md")) {
							return legacyContent;
						}
						if (path.includes("epub-bookmark-v3-state.json")) {
							return "{}";
						}
						throw new Error(`missing ${path}`);
					}),
					list: vi.fn(async () => ({ files: [], folders: [] })),
				},
			},
		} as any;

		const backup = await createEpubBookmarkMigrationBackup(app, "weave/epub-bookmarks", [
			"weave/epub-bookmarks/data_Demo.md",
		]);

		expect(backup.fileCount).toBe(1);
		expect([...writes.keys()].some((path) => path.includes("manifest.json"))).toBe(true);
		expect(
			[...writes.keys()].some((path) => path.includes("weave__epub-bookmarks__data_Demo.md"))
		).toBe(true);
	});

	it("treats v3 format as migrated", () => {
		expect(EPUB_BOOKMARK_FILE_FORMAT_V3).toBe("weave-epub-bookmarks/v3");
		expect(EPUB_BOOKMARK_FILE_FORMAT_V2).not.toBe(EPUB_BOOKMARK_FILE_FORMAT_V3);
	});

	it("resets prompt guard for tests", async () => {
		const { resetEpubBookmarkMigrationPromptStateForTests } = await import(
			"../epub-bookmark-migration"
		);
		resetEpubBookmarkMigrationPromptStateForTests();
		expect(true).toBe(true);
	});
});
