import { beforeEach, describe, expect, it, vi } from "vitest";

const getCompatiblePlugin = vi.fn();

vi.mock("obsidian", async () => {
	const actual = await vi.importActual<typeof import("../../../tests/mocks/obsidian")>(
		"../../../tests/mocks/obsidian"
	);
	return actual;
});

vi.mock("../../../utils/plugin-access", () => ({
	getCompatiblePlugin,
}));

vi.mock("../epub-runtime", () => ({
	EPUB_RUNTIME: {
		pluginId: "weave-epub-reader",
		pluginDirName: "weave-epub-reader",
		viewTypes: {
			reader: "weave-epub-reader-standalone",
			sidebar: "weave-epub-sidebar-standalone",
			bookshelfSidebar: "weave-epub-bookshelf-sidebar-standalone",
		},
		protocol: {
			allNames: ["weave-epub-reader", "weave-epub"],
		},
		events: {
			bookshelfDataChanged: "test:bookshelf-data-changed",
			bookshelfRefreshRequest: "test:bookshelf-refresh-request",
			bookshelfDisplaySettingsChanged: "test:bookshelf-display-settings-changed",
			excerptSettingsChanged: "test:excerpt-settings-changed",
			navigate: "test:epub-navigate",
		},
		globals: {
			pendingNavigationKey: "__testPendingNav",
		},
	},
	getEpubRuntime: () => ({
		pluginId: "weave-epub-reader",
		pluginDirName: "weave-epub-reader",
		viewTypes: {
			reader: "weave-epub-reader-standalone",
			sidebar: "weave-epub-sidebar-standalone",
			bookshelfSidebar: "weave-epub-bookshelf-sidebar-standalone",
		},
		protocol: {
			allNames: ["weave-epub-reader", "weave-epub"],
		},
		events: {
			bookshelfDataChanged: "test:bookshelf-data-changed",
			bookshelfRefreshRequest: "test:bookshelf-refresh-request",
			bookshelfDisplaySettingsChanged: "test:bookshelf-display-settings-changed",
			excerptSettingsChanged: "test:excerpt-settings-changed",
			navigate: "test:epub-navigate",
		},
		globals: {
			pendingNavigationKey: "__testPendingNav",
		},
	}),
}));

describe("EpubBookmarkService", () => {
	beforeEach(() => {
		getCompatiblePlugin.mockReset();
	});

	it("buildEpubBookmarkFileName uses data_ prefix without book ids", async () => {
		const { buildEpubBookmarkFileName, buildEpubBookmarkFileNameCandidates } = await import(
			"../EpubBookmarkService"
		);

		expect(buildEpubBookmarkFileName("百年孤独")).toBe("data_百年孤独.md");
		expect(
			buildEpubBookmarkFileNameCandidates({ title: "百年孤独", author: "马尔克斯" }).slice(0, 4)
		).toEqual([
			"data_百年孤独.md",
			"data_百年孤独 - 马尔克斯.md",
			"data_百年孤独 2.md",
			"data_百年孤独 3.md",
		]);
	});

	it("buildEpubBookmarkStableKey shortens fingerprints and lists legacy filename suffixes", async () => {
		const {
			buildEpubBookmarkStableKey,
			buildLegacyEpubBookmarkStableKeySuffixes,
		} = await import("../EpubBookmarkService");

		expect(
			buildEpubBookmarkStableKey({
				sourceFingerprint: "353ab0d0ca49b9a2d636e1b64e0e43cbbd42ed1869f5e9de2b84afb5",
			})
		).toBe("epubsrc-353ab0d0ca49");

		expect(
			buildLegacyEpubBookmarkStableKeySuffixes({
				sourceFingerprint: "353ab0d0ca49b9a2d636e1b64e0e43cbbd42ed1869f5e9de2b84afb5",
				canonicalStableKey: "epubsrc-353ab0d0ca49",
			})
		).toEqual([
			"--353ab0d0ca49b9a2d636e1b64e0e43cbbd42ed1869f5e9de2b84afb5.md",
		]);
	});

	it("prefers the current runtime plugin settings when resolving bookmark folder", async () => {
		const { EpubBookmarkService } = await import("../EpubBookmarkService");
		const app = {
			plugins: {
				getPlugin: vi.fn((pluginId: string) =>
					pluginId === "weave-epub-reader"
						? { settings: { bookmarkFolder: "Bookmarks/EPUB" } }
						: null
				),
			},
		} as any;

		const service = new EpubBookmarkService(app);

		expect(service.getBookmarkFolder()).toBe("Bookmarks/EPUB");
		expect(app.plugins.getPlugin).toHaveBeenCalledWith("weave-epub-reader");
		expect(getCompatiblePlugin).not.toHaveBeenCalled();
	});

	it("falls back to a compatible plugin host when the runtime plugin is unavailable", async () => {
		const { EpubBookmarkService, DEFAULT_EPUB_BOOKMARK_FOLDER } = await import(
			"../EpubBookmarkService"
		);
		getCompatiblePlugin.mockReturnValue({
			settings: {
				bookmarkFolder: "Shared/Bookmarks",
			},
		});
		const app = {
			plugins: {
				getPlugin: vi.fn(() => null),
			},
		} as any;

		const service = new EpubBookmarkService(app);

		expect(service.getBookmarkFolder()).toBe("Shared/Bookmarks");
		expect(getCompatiblePlugin).toHaveBeenCalledWith(app);

		getCompatiblePlugin.mockReturnValue({ settings: {} });
		expect(new EpubBookmarkService(app).getBookmarkFolder()).toBe(DEFAULT_EPUB_BOOKMARK_FOLDER);
	});

	it("builds a short bookmark stableKey from sourceFingerprint before sourceId", async () => {
		const { EpubBookmarkService, buildEpubBookmarkStableKey } = await import(
			"../EpubBookmarkService"
		);
		const service = new EpubBookmarkService({ plugins: { getPlugin: vi.fn(() => null) } } as any);

		const stableKey = (service as any).buildStableKey({
			id: "epub-book-local",
			filePath: "Books/demo.epub",
			sourceId: "epubsrc-volatile",
			sourceFingerprint: "4a9ad58db18a2176c9c0f16335a0a7502a4f3a7eaab3af39",
			metadata: { title: "Demo" },
		});

		expect(stableKey).toBe(
			buildEpubBookmarkStableKey({
				sourceFingerprint: "4a9ad58db18a2176c9c0f16335a0a7502a4f3a7eaab3af39",
			})
		);
		expect(stableKey).toBe("epubsrc-4a9ad58db18a");
		expect(stableKey).not.toContain("epubsrc-volatile");
		expect(stableKey.length).toBeLessThan(24);
	});

	it("migrates legacy bookmark files onto the canonical stableKey path", async () => {
		const { EpubBookmarkService } = await import("../EpubBookmarkService");
		const app = {
			vault: {
				adapter: {
					exists: vi.fn(async () => false),
					remove: vi.fn(async () => undefined),
				},
				getFiles: vi.fn(() => [
					{
						path: "weave/epub-bookmarks/Demo--epubsrc-legacy.md",
						name: "Demo--epubsrc-legacy.md",
						extension: "md",
					},
				]),
			},
			plugins: {
				getPlugin: vi.fn(() => null),
			},
		} as any;
		const service = new EpubBookmarkService(app);
		const writeBookmarkFile = vi
			.spyOn(service as any, "writeBookmarkFile")
			.mockResolvedValue(undefined);
		vi.spyOn(service as any, "readBookmarkFileByPath").mockImplementation(
			async (...args: unknown[]) => {
				const [filePath] = args as [string];
			if (filePath !== "weave/epub-bookmarks/Demo--epubsrc-legacy.md") {
				return null;
			}
			return {
				format: "weave-epub-bookmarks/v1",
				weave_epub_bookmark_file: true,
				stableKey: "epubsrc-legacy",
				bookId: "epub-old-runtime",
				sourceId: "epubsrc-legacy",
				sourceFingerprint: undefined,
				bookPath: "Books/demo.epub",
				bookTitle: "Demo",
				bookAuthor: "Author",
				updatedAt: 1,
				bookmarks: [],
			};
			}
		);

		const result = await (service as any).migrateBookmarkFileForBook(
			{
				id: "epub-book-canonical",
				filePath: "Books/demo.epub",
				sourceId: "epubsrc-4a9ad58db18a2176c9c0f163",
				sourceFingerprint: "4a9ad58db18a2176c9c0f16335a0a7502a4f3a7eaab3af39",
				metadata: {
					title: "Demo",
					author: "Author",
				},
			},
			"weave/epub-bookmarks/Demo--epubsrc-legacy.md"
		);
		const expectedStableKey = "epubsrc-4a9ad58db18a";
		const expectedPath = "weave/epub-bookmarks/data_Demo.md";

		expect(result).toBe(expectedPath);
		expect(writeBookmarkFile).toHaveBeenCalledWith(
			expectedPath,
			expect.objectContaining({
				stableKey: expectedStableKey,
				bookId: "epub-book-canonical",
				sourceId: "epubsrc-4a9ad58db18a2176c9c0f163",
			})
		);
		expect(app.vault.adapter.remove).toHaveBeenCalledWith(
			"weave/epub-bookmarks/Demo--epubsrc-legacy.md"
		);
	});

	it("ignores ENOENT when removing a stale bookmark file during migration", async () => {
		const { EpubBookmarkService } = await import("../EpubBookmarkService");
		const app = {
			vault: {
				adapter: {
					exists: vi.fn(async (path: string) => path === "weave/epub-bookmarks/Demo--legacy.md"),
					remove: vi.fn(async () => {
						const error = new Error("ENOENT: no such file or directory") as Error & { code?: string };
						error.code = "ENOENT";
						throw error;
					}),
				},
				getFiles: vi.fn(() => []),
			},
			plugins: {
				getPlugin: vi.fn(() => null),
			},
		} as any;
		const service = new EpubBookmarkService(app);
		const writeBookmarkFile = vi.spyOn(service as any, "writeBookmarkFile").mockResolvedValue(undefined);
		vi.spyOn(service as any, "readBookmarkFileByPath").mockResolvedValue({
			format: "weave-epub-bookmarks/v1",
			weave_epub_bookmark_file: true,
			stableKey: "legacy",
			bookId: "epub-demo",
			bookPath: "Books/demo.epub",
			bookTitle: "Demo",
			updatedAt: 1,
			bookmarks: [],
		});

		await expect(
			(service as any).migrateBookmarkFileForBook(
				{
					id: "epub-demo",
					filePath: "Books/demo.epub",
					sourceFingerprint: "fp-demo-123",
					metadata: { title: "Demo", author: "Author" },
				},
				"weave/epub-bookmarks/Demo--legacy.md"
			)
		).resolves.toBe("weave/epub-bookmarks/data_Demo.md");

		expect(writeBookmarkFile).toHaveBeenCalled();
		expect(app.vault.adapter.remove).toHaveBeenCalledWith("weave/epub-bookmarks/Demo--legacy.md");
	});

	it("writes readingState into bookmark frontmatter with Obsidian warning callout", async () => {
		const { EpubBookmarkService, EPUB_BOOKMARK_AUTO_MAINTAINED_CALLOUT } = await import(
			"../EpubBookmarkService"
		);
		const written: string[] = [];
		const app = {
			vault: {
				adapter: {
					exists: vi.fn(async () => false),
				},
				getFiles: vi.fn(() => []),
			},
			plugins: {
				getPlugin: vi.fn(() => null),
			},
		} as any;
		const service = new EpubBookmarkService(app);
		vi.spyOn(service as any, "findCompatibleBookmarkFilePath").mockResolvedValue(
			"weave/epub-bookmarks/data_Demo.md"
		);
		vi.spyOn(service as any, "readBookmarkFileByPath").mockResolvedValue(null);
		vi.spyOn(service as any, "writeBookmarkFile").mockImplementation(
			(async (...args: any[]) => {
				const [, frontmatter] = args as [string, { readingState?: unknown }];
				written.push(
					(service as any).renderBookmarkFileContent(frontmatter)
				);
			}) as any
		);
		const book = {
			id: "epub-demo",
			filePath: "Books/demo.epub",
			sourceFingerprint: "fp-demo-123",
			metadata: { title: "Demo", author: "Author", chapterCount: 1 },
			currentPosition: { chapterIndex: 0, cfi: "epubcfi(/6/2!/4/2,/1:0,/1:4)", percent: 12 },
			readingStats: {
				totalReadTime: 120_000,
				lastReadTime: 1_700_000_000_000,
				createdTime: 1_699_000_000_000,
				bookWpm: 280,
				paceSampleCount: 8,
			},
		} as any;

		await service.writeReadingState(book, {
			currentPosition: book.currentPosition,
			readingStats: book.readingStats,
		});

		expect(written).toHaveLength(1);
		const content = written[0] || "";
		expect(content).toContain("readingState:");
		expect(content).toContain("totalReadTime: 120000");
		expect(content).toContain(EPUB_BOOKMARK_AUTO_MAINTAINED_CALLOUT);
		expect(content).toContain("> 📎");
		expect(content).toContain("weave-epub-bookmarks/v3");
		expect(content).toContain("## 📊 阅读进度");
		expect(content).toContain("reading-progress: 12");
	});

	it("falls back to adapter.write when vault.modify hits ENOENT for a stale TFile index", async () => {
		const { EpubBookmarkService } = await import("../EpubBookmarkService");
		const adapterWrite = vi.fn(async () => undefined);
		const app = {
			vault: {
				adapter: {
					exists: vi.fn(async () => true),
					write: adapterWrite,
					mkdir: vi.fn(async () => undefined),
				},
				getAbstractFileByPath: vi.fn(() => ({ path: "weave/epub-bookmarks/Demo--fp-demo-123.md" })),
				modify: vi.fn(async () => {
					const error = new Error("ENOENT: no such file or directory") as Error & { code?: string };
					error.code = "ENOENT";
					throw error;
				}),
				create: vi.fn(async () => {
					throw new Error("create should not run when adapter.write succeeds");
				}),
			},
		} as any;
		const service = new EpubBookmarkService(app);
		await (service as any).writeBookmarkFile("weave/epub-bookmarks/Demo--fp-demo-123.md", {
			format: "weave-epub-bookmarks/v1",
			weave_epub_bookmark_file: true,
			stableKey: "fp-demo-123",
			bookId: "epub-demo",
			bookPath: "Books/demo.epub",
			bookTitle: "Demo",
			updatedAt: 1,
			bookmarks: [],
		});

		expect(adapterWrite).toHaveBeenCalledWith(
			"weave/epub-bookmarks/Demo--fp-demo-123.md",
			expect.stringContaining("weave_epub_bookmark_file: true")
		);
		expect(app.vault.create).not.toHaveBeenCalled();
	});

	it("writes portable reading state to the indexed book id instead of the changed runtime id", async () => {
		const { EpubBookmarkService } = await import("../EpubBookmarkService");
		const writes: Record<string, unknown> = {};
		const indexedBookId = "epub-book-rv441q";
		const runtimeBookId = "epub-book-i6zqes";
		const sourceFingerprint = "2937234a35a2e33dff05bd005f6130eaaf24fcc5a82e4ac0d0225628e035215e";
		const sourceId = "epubsrc-2937234a35a2e33dff05bd00";
		const app = {
			vault: {
				adapter: {
					exists: vi.fn(async (path: string) => path === "weave/epub-data/index.json"),
					read: vi.fn(async () =>
						JSON.stringify({
							books: {
								[indexedBookId]: {
									bookId: indexedBookId,
									sourceId,
									sourceFingerprint,
									filePath: "Books/LaTeX.epub",
								},
							},
						})
					),
					write: vi.fn(async (path: string, content: string) => {
						writes[path] = JSON.parse(content);
					}),
					mkdir: vi.fn(async () => undefined),
				},
				getFiles: vi.fn(() => []),
			},
			plugins: {
				getPlugin: vi.fn(() => null),
			},
		} as any;
		const service = new EpubBookmarkService(app);
		vi.spyOn(service as any, "ensureCanonicalBookmarkFilePath").mockResolvedValue(
			"weave/epub-bookmarks/data_LaTeX.md"
		);
		vi.spyOn(service as any, "readBookmarkFileByPath").mockResolvedValue(null);
		vi.spyOn(service as any, "writeBookmarkFile").mockResolvedValue(undefined);

		await service.writeReadingState(
			{
				id: runtimeBookId,
				filePath: "Books/LaTeX.epub",
				sourceId,
				sourceFingerprint,
				metadata: { title: "LaTeX", author: "Author", chapterCount: 1 },
				currentPosition: { chapterIndex: 1, cfi: "epubcfi(/6/2)", percent: 13 },
				readingStats: { totalReadTime: 1, lastReadTime: 2, createdTime: 3 },
			} as any,
			{
				currentPosition: { chapterIndex: 1, cfi: "epubcfi(/6/2)", percent: 13 },
				readingStats: { totalReadTime: 1, lastReadTime: 2, createdTime: 3 },
			}
		);

		expect(writes[`weave/epub-data/books/${indexedBookId}/reading-state.json`]).toMatchObject({
			bookId: indexedBookId,
			currentPosition: { cfi: "epubcfi(/6/2)", percent: 13 },
		});
		expect(writes[`weave/epub-data/books/${runtimeBookId}/reading-state.json`]).toBeUndefined();
	});

	it("writes reading state to portable data without recreating a deleted legacy bookmark folder", async () => {
		const { EpubBookmarkService } = await import("../EpubBookmarkService");
		const writes: Record<string, unknown> = {};
		const createdMarkdown = vi.fn(async () => ({}));
		const app = {
			vault: {
				adapter: {
					exists: vi.fn(async () => false),
					read: vi.fn(async () => ""),
					write: vi.fn(async (path: string, content: string) => {
						writes[path] = JSON.parse(content);
					}),
					mkdir: vi.fn(async () => undefined),
				},
				getFiles: vi.fn(() => []),
				getAbstractFileByPath: vi.fn(() => null),
				create: createdMarkdown,
			},
			plugins: {
				getPlugin: vi.fn(() => null),
			},
		} as any;
		const service = new EpubBookmarkService(app);

		await service.writeReadingState(
			{
				id: "epub-book-demo",
				filePath: "Books/Demo.epub",
				sourceId: "epubsrc-demo",
				sourceFingerprint: "fingerprint-demo",
				metadata: { title: "Demo", author: "Author", chapterCount: 1 },
			} as any,
			{
				currentPosition: { chapterIndex: 2, cfi: "epubcfi(/6/4)", percent: 42 },
				readingStats: { totalReadTime: 1, lastReadTime: 2, createdTime: 3 },
			}
		);

		expect(writes["weave/epub-data/books/epub-book-demo/reading-state.json"]).toMatchObject({
			bookId: "epub-book-demo",
			currentPosition: { cfi: "epubcfi(/6/4)", percent: 42 },
		});
		expect(createdMarkdown).not.toHaveBeenCalled();
	});

	it("adds bookmarks to portable data without recreating a deleted legacy bookmark folder", async () => {
		const { EpubBookmarkService } = await import("../EpubBookmarkService");
		const writes: Record<string, unknown> = {};
		const createdMarkdown = vi.fn(async () => ({}));
		const app = {
			vault: {
				adapter: {
					exists: vi.fn(async () => false),
					read: vi.fn(async () => ""),
					write: vi.fn(async (path: string, content: string) => {
						writes[path] = JSON.parse(content);
					}),
					mkdir: vi.fn(async () => undefined),
				},
				getFiles: vi.fn(() => []),
				getAbstractFileByPath: vi.fn(() => null),
				create: createdMarkdown,
			},
			plugins: {
				getPlugin: vi.fn(() => null),
			},
		} as any;
		const service = new EpubBookmarkService(app);

		const result = await service.addBookmark(
			{
				id: "epub-book-demo",
				filePath: "Books/Demo.epub",
				sourceId: "epubsrc-demo",
				sourceFingerprint: "fingerprint-demo",
				metadata: { title: "Demo", author: "Author", chapterCount: 1 },
			} as any,
			{
				cfi: "epubcfi(/6/8)",
				chapterIndex: 3,
				percent: 55,
				chapterTitle: "Chapter",
				createdAt: 123,
			}
		);

		expect(result.filePath).toBe("weave/epub-data/books/epub-book-demo/bookmarks.json");
		expect(writes["weave/epub-data/books/epub-book-demo/bookmarks.json"]).toMatchObject({
			bookId: "epub-book-demo",
			bookmarks: [{ cfi: "epubcfi(/6/8)" }],
		});
		expect(createdMarkdown).not.toHaveBeenCalled();
	});

	it("keeps bookmark filenames stable and resolves existing files by stableKey suffix", async () => {
		const { EpubBookmarkService, normalizeBookmarkTitleForFileName } = await import(
			"../EpubBookmarkService"
		);
		expect(normalizeBookmarkTitleForFileName("史蒂夫•乔布斯传")).toBe("史蒂夫-乔布斯传");
		const service = new EpubBookmarkService({
			vault: {
				adapter: { exists: vi.fn(async () => false) },
				getFiles: vi.fn(() => [
					{
						path: "weave/epub-bookmarks/史蒂夫•乔布斯传(Steve Jobs_A Biography)--fp-demo-123.md",
						name: "史蒂夫•乔布斯传(Steve Jobs_A Biography)--fp-demo-123.md",
						extension: "md",
						stat: { mtime: 100 },
					},
				]),
			},
			plugins: { getPlugin: vi.fn(() => null) },
		} as any);
		vi.spyOn(service as any, "readBookmarkFileByPath").mockResolvedValue({
			format: "weave-epub-bookmarks/v1",
			weave_epub_bookmark_file: true,
			stableKey: "fp-demo-123",
			bookId: "epub-demo",
			bookPath: "Books/demo.epub",
			bookTitle: "Demo",
			updatedAt: 1,
			bookmarks: [],
		});

		await expect(
			(service as any).findExistingBookmarkFilePath({
				id: "epub-demo",
				sourceFingerprint: "fp-demo-123",
				metadata: { title: "史蒂夫•乔布斯传(Steve Jobs:A Biography)" },
			})
		).resolves.toBe("weave/epub-bookmarks/史蒂夫•乔布斯传(Steve Jobs_A Biography)--fp-demo-123.md");
	});
});
