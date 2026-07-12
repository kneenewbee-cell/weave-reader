import { describe, expect, it, vi } from "vitest";
import { ExcerptPipeline } from "../highlight/ExcerptPipeline";
import { HighlightIndex } from "../highlight/HighlightIndex";
import type { BacklinkHighlight } from "../EpubBacklinkHighlightService";

describe("ExcerptPipeline", () => {
	it("applies optimistic card sync without requesting reload when only the epub path is known", async () => {
		const index = new HighlightIndex();
		const pipeline = new ExcerptPipeline(index, { cardSyncDedupeMs: 600 });
		const requestReload = vi.fn();
		const applyReaderHighlights = vi.fn(() => true);

		await pipeline.handleCardSaved({
			card: { uuid: "card-1", sourceFile: "Books/demo.epub", content: "[!EPUB]" },
			extractFromCard: async () => [
				{
					cfiRange: "epubcfi(/6/2)",
					color: "yellow",
					text: "Hello",
					sourceFile: "Books/demo.epub",
				} satisfies BacklinkHighlight,
			],
			mergeFromSourcePath: async () => false,
			applyReaderHighlights,
			requestReload,
			rememberSourcePath: vi.fn(),
		});

		expect(applyReaderHighlights).toHaveBeenCalledTimes(1);
		expect(requestReload).not.toHaveBeenCalled();
		expect(index.getSnapshot()).toHaveLength(1);
	});

	it("schedules incremental reload after optimistic wdeck sync", async () => {
		const pipeline = new ExcerptPipeline(new HighlightIndex(), { cardSyncDedupeMs: 600 });
		const requestReload = vi.fn();

		await pipeline.handleCardSaved({
			card: {
				uuid: "card-wdeck",
				sourceFile: "Books/demo.epub",
				content: "[!EPUB]",
				customFields: {
					wdeck: { sourcePath: "weave/memory/deck-files/demo_01.wdeck" },
				},
			},
			extractFromCard: async () => [
				{
					cfiRange: "readium:alpha",
					color: "yellow",
					text: "Quote",
					sourceFile: "weave/memory/deck-files/demo_01.wdeck",
					sourceRef: "card:card-wdeck",
				} satisfies BacklinkHighlight,
			],
			mergeFromSourcePath: async () => false,
			applyReaderHighlights: () => true,
			requestReload,
			rememberSourcePath: vi.fn(),
		});

		expect(requestReload).toHaveBeenCalledWith({ incremental: true, delayMs: 450 });
	});

	it("falls back to incremental reload when optimistic sync is empty", async () => {
		const pipeline = new ExcerptPipeline(new HighlightIndex());
		const requestReload = vi.fn();

		await pipeline.handleCardSaved({
			card: { uuid: "card-2", sourceFile: "memory/cards/demo.json", content: "[!EPUB]" },
			extractFromCard: async () => [],
			mergeFromSourcePath: async () => false,
			applyReaderHighlights: () => false,
			requestReload,
			rememberSourcePath: vi.fn(),
		});

		expect(requestReload).toHaveBeenCalledWith({ incremental: true, delayMs: 300 });
	});
});
