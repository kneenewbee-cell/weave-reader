import { describe, expect, it, vi, beforeEach } from "vitest";
import { EpubAnnotationIndexService } from "../epub-annotation-index";

vi.mock("../epub-premium", () => ({
	canUseEpubExcerptNotes: vi.fn(() => true),
}));

vi.mock("../epub-storage-access", () => ({
	getEpubStorageService: vi.fn(),
}));

vi.mock("../epub-backlink-highlight-access", () => ({
	getEpubBacklinkHighlightService: vi.fn(),
}));

vi.mock("../epub-highlight-view-snapshot-access", () => ({
	getEpubHighlightViewSnapshotService: vi.fn(),
}));

import { getEpubStorageService } from "../epub-storage-access";
import { getEpubBacklinkHighlightService } from "../epub-backlink-highlight-access";
import { getEpubHighlightViewSnapshotService } from "../epub-highlight-view-snapshot-access";

describe("EpubAnnotationIndexService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("marks readiness ready when a display snapshot is already cached", async () => {
		const app = { id: "cached-ready" } as any;
		const snapshotService = {
			buildContextKey: vi.fn(() => "book-1::Books/demo.epub::0"),
			getCachedSnapshot: vi.fn(() => ({
				highlights: [{ cfiRange: "epubcfi(/6/2)" }],
			})),
			hydrateFromDisk: vi.fn(async () => null),
			revalidateSnapshot: vi.fn(),
		};
		vi.mocked(getEpubHighlightViewSnapshotService).mockReturnValue(snapshotService as any);
		vi.mocked(getEpubStorageService).mockReturnValue({
			getCanvasBinding: vi.fn(async () => null),
		} as any);
		vi.mocked(getEpubBacklinkHighlightService).mockReturnValue({
			collectHighlights: vi.fn(async () => []),
		} as any);

		const service = EpubAnnotationIndexService.forApp(app);
		await service.prefetchBook({
			bookId: "book-1",
			filePath: "Books/demo.epub",
			showStrikethroughHighlights: false,
			priority: "background",
		});

		expect(service.getReadiness({
			bookId: "book-1",
			filePath: "Books/demo.epub",
			showStrikethroughHighlights: false,
		})).toBe("ready");
		expect(snapshotService.revalidateSnapshot).not.toHaveBeenCalled();
	});

	it("waits for in-flight prefetch before returning", async () => {
		const app = { id: "inflight-wait" } as any;
		let resolveCollect: (() => void) | undefined;
		const collectPromise = new Promise<unknown[]>((resolve) => {
			resolveCollect = () => resolve([]);
		});
		let cachedSnapshot: { highlights: { cfiRange: string }[] } | null = null;

		const snapshotService = {
			buildContextKey: vi.fn(() => "book-1::Books/demo.epub::0"),
			getCachedSnapshot: vi.fn(() => cachedSnapshot),
			hydrateFromDisk: vi.fn(async () => null),
			revalidateSnapshot: vi.fn(async () => {
				cachedSnapshot = { highlights: [{ cfiRange: "epubcfi(/6/4)" }] };
				return cachedSnapshot;
			}),
		};
		vi.mocked(getEpubHighlightViewSnapshotService).mockReturnValue(snapshotService as any);
		vi.mocked(getEpubStorageService).mockReturnValue({
			getCanvasBinding: vi.fn(async () => null),
			loadExcerptSettings: vi.fn(async () => ({ showStrikethroughInSidebar: false })),
		} as any);

		const service = EpubAnnotationIndexService.forApp(app);
		const context = {
			bookId: "book-1",
			filePath: "Books/demo.epub",
			showStrikethroughHighlights: false,
		};
		const annotationService = {
			collectAllHighlights: vi.fn(() => collectPromise),
		} as any;

		const prefetchPromise = service.prefetchBook({
			...context,
			annotationService,
			priority: "background",
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		const waitPromise = service.waitForReady(context);
		resolveCollect?.();
		await Promise.all([prefetchPromise, waitPromise]);

		expect(snapshotService.revalidateSnapshot).toHaveBeenCalled();
		expect(service.getReadiness(context)).toBe("ready");
	});

	it("does not report ready after backlink-only warmup without a display snapshot", async () => {
		const app = { id: "backlink-only" } as any;
		const snapshotService = {
			buildContextKey: vi.fn(() => "book-1::Books/demo.epub::0"),
			getCachedSnapshot: vi.fn(() => null),
			hydrateFromDisk: vi.fn(async () => null),
			revalidateSnapshot: vi.fn(),
		};
		vi.mocked(getEpubHighlightViewSnapshotService).mockReturnValue(snapshotService as any);
		vi.mocked(getEpubStorageService).mockReturnValue({
			getCanvasBinding: vi.fn(async () => null),
		} as any);
		vi.mocked(getEpubBacklinkHighlightService).mockReturnValue({
			collectHighlights: vi.fn(async () => []),
		} as any);

		const service = EpubAnnotationIndexService.forApp(app);
		const context = {
			bookId: "book-1",
			filePath: "Books/demo.epub",
			showStrikethroughHighlights: false,
		};

		await service.prefetchBook({
			...context,
			priority: "immediate",
		});

		expect(snapshotService.revalidateSnapshot).not.toHaveBeenCalled();
		expect(service.getReadiness(context)).toBe("unknown");
	});
});
