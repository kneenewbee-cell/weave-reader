import { beforeEach, describe, expect, it, vi } from "vitest";

const CACHE_PATH =
	".obsidian/plugins/weave-epub-reader/cache/incremental-reading/epub-annotation-view-snapshots-cache.json";

vi.mock("../../../config/paths", () => ({
	getPluginPathsById: vi.fn(() => ({
		cache: {
			incrementalReading: {
				epubAnnotationViewSnapshotsCache: CACHE_PATH,
			},
		},
	})),
}));

vi.mock("../../../utils/directory-utils", () => ({
	DirectoryUtils: {
		ensureDirForFile: vi.fn(async () => undefined),
	},
}));

import { EpubHighlightViewSnapshotService } from "../EpubHighlightViewSnapshotService";

describe("EpubHighlightViewSnapshotService disk persistence", () => {
	let files: Map<string, string>;
	let app: any;

	beforeEach(() => {
		files = new Map<string, string>();
		app = {
			vault: {
				adapter: {
					exists: vi.fn(async (path: string) => files.has(path)),
					read: vi.fn(async (path: string) => files.get(path) || ""),
					write: vi.fn(async (path: string, content: string) => {
						files.set(path, content);
					}),
				},
			},
		};
	});

	it("hydrates memory cache from persisted snapshots", async () => {
		const contextKey = "book-1::Books/demo.epub::0";
		files.set(
			CACHE_PATH,
			JSON.stringify({
				version: "1.0.0",
				lastUpdated: new Date().toISOString(),
				entries: {
					[contextKey]: {
						contextKey,
						bookId: "book-1",
						filePath: "Books/demo.epub",
						showStrikethroughHighlights: false,
						revision: 3,
						updatedAt: Date.now(),
						pageLabelsResolved: true,
						highlights: [
							{
								cfiRange: "epubcfi(/6/8)",
								text: "磁盘摘录",
								hasCommentDivider: false,
								commentStateLabel: "无想法",
								color: "yellow",
								colorLabel: "黄色",
								noteType: "高亮",
								noteTypeKey: "highlight",
								tags: [],
								createdTime: 4,
								searchableValues: ["磁盘摘录"],
							},
						],
					},
				},
			})
		);

		const service = new EpubHighlightViewSnapshotService(app);
		const hydrated = await service.hydrateFromDisk({
			bookId: "book-1",
			filePath: "Books/demo.epub",
			showStrikethroughHighlights: false,
		});

		expect(hydrated?.highlights[0]?.text).toBe("磁盘摘录");
	});

	it("persists revalidated snapshots to disk", async () => {
		const service = new EpubHighlightViewSnapshotService(app);
		const annotationService = {
			collectAllHighlights: vi.fn(async () => [
				{
					cfiRange: "epubcfi(/6/2)",
					color: "yellow",
					text: "写入磁盘",
					presentation: "highlight",
					createdTime: 1,
				},
			]),
		} as any;

		await service.revalidateSnapshot({
			bookId: "book-1",
			filePath: "Books/demo.epub",
			showStrikethroughHighlights: false,
			annotationService,
			backlinkService: {} as any,
			readerService: null,
			highlightRevision: 1,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(files.has(CACHE_PATH)).toBe(true);
		const persisted = JSON.parse(files.get(CACHE_PATH) || "{}");
		const contextKey = "book-1::Books/demo.epub::0";
		expect(persisted.entries[contextKey]?.highlights[0]?.text).toBe("写入磁盘");
	});
});
