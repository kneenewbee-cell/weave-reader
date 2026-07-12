import { describe, expect, it, vi } from "vitest";
import {
	buildEpubHighlightSyncSnapshot,
	cardContentMayContainEpubLocator,
	dispatchEpubHighlightSyncRequested,
} from "../epub-card-highlight-sync";
import { EPUB_RUNTIME } from "../epub-runtime";

describe("epub-card-highlight-sync", () => {
	it("detects EPUB locator markers in card content", () => {
		expect(
			cardContentMayContainEpubLocator(
				'> [!EPUB|yellow] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]\n> Quote'
			)
		).toBe(true);
		expect(cardContentMayContainEpubLocator("plain question only")).toBe(false);
	});

	it("keeps semantic sourceFile and adds persistenceSourcePath for wdeck cards", () => {
		expect(
			buildEpubHighlightSyncSnapshot({
				uuid: "card-a",
				sourceFile: "Books/demo.epub",
				content:
					'---\nwe_source: "[[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]"\n---\nQuote',
				customFields: {
					wdeck: {
						sourcePath: "weave/memory/deck-files/demo_01.wdeck",
					},
				},
			})
		).toMatchObject({
			sourceFile: "Books/demo.epub",
			persistenceSourcePath: "weave/memory/deck-files/demo_01.wdeck",
		});
	});

	it("dispatches highlight sync requested event", () => {
		const listener = vi.fn();
		window.addEventListener(EPUB_RUNTIME.events.highlightSyncRequested, listener);
		dispatchEpubHighlightSyncRequested({ reloadOnly: true, delayMs: 120 });
		expect(listener).toHaveBeenCalledTimes(1);
		window.removeEventListener(EPUB_RUNTIME.events.highlightSyncRequested, listener);
	});
});
