import { describe, expect, it } from "vitest";
import { EpubBacklinkHighlightService } from "../EpubBacklinkHighlightService";

function createService() {
	const app = {
		vault: {
			getAbstractFileByPath: () => null,
			getMarkdownFiles: () => [],
			getFiles: () => [],
			cachedRead: async () => "",
			adapter: { exists: async () => false, read: async () => "", write: async () => undefined },
			on: () => ({}) as any,
		},
		metadataCache: { resolvedLinks: {} },
		plugins: { getPlugin: () => null },
	} as any;
	return new EpubBacklinkHighlightService(app);
}

describe("EpubBacklinkHighlightService saved card helpers", () => {
	it("extracts highlights from a saved wdeck card using customFields.wdeck.sourcePath", async () => {
		const service = createService();
		const card = {
			uuid: "card-wdeck",
			sourceFile: "Books/demo.epub",
			customFields: {
				wdeck: {
					sourcePath: "weave/memory/deck-files/demo_01.wdeck",
				},
			},
			content: [
				"---",
				'we_source: "[[Books/demo.epub#weave-cfi=readium%3Awdeck-persist&sid=epubsrc-1|Demo]]"',
				"---",
				"WDeck persisted quote",
			].join("\n"),
		};

		const highlights = await service.extractHighlightsFromSavedCard(
			card,
			"Books/demo.epub",
			"epubsrc-1"
		);
		expect(highlights).toEqual([
			expect.objectContaining({
				cfiRange: "readium:wdeck-persist",
				text: "WDeck persisted quote",
				sourceFile: "weave/memory/deck-files/demo_01.wdeck",
				sourceRef: "card:card-wdeck",
			}),
		]);
	});

	it("extracts highlights from a saved card with EPUB callout", async () => {
		const service = createService();
		const card = {
			uuid: "card-1",
			content:
				'> [!EPUB|yellow] [[Books/demo.epub#weave-cfi=readium%3Aalpha&sid=epubsrc-1|Demo]]\n> Quote text\n---div---\n> Answer',
		};

		const references = await service.savedCardReferencesEpubFile(card, "Books/demo.epub", "epubsrc-1");
		expect(references).toBe(true);

		const highlights = await service.extractHighlightsFromSavedCard(
			card,
			"Books/demo.epub",
			"epubsrc-1"
		);
		expect(highlights).toHaveLength(1);
		expect(highlights[0]?.cfiRange).toContain("readium");
		expect(highlights[0]?.text).toContain("Quote text");
	});

	it("collectHighlightsFromSourcePath returns empty when the source file is missing", async () => {
		const service = createService();
		await expect(
			service.collectHighlightsFromSourcePath("Books/demo.epub", "memory/cards/missing.json")
		).resolves.toEqual([]);
	});
});
