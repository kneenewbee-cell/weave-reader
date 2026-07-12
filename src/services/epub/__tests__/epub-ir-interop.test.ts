import { describe, expect, it, vi } from "vitest";
import { loadPublicationTocItems, navigateToPublicationChapter } from "../epub-ir-interop";

const loadMock = vi.fn();
const disposeMock = vi.fn();
const navigateToEpubChapterMock = vi.fn();

vi.mock("../FoliateVaultPublicationParser", () => ({
	FoliateVaultPublicationParser: class {
		load = loadMock;
		dispose = disposeMock;
	},
}));

vi.mock("../EpubLinkService", () => ({
	EpubLinkService: class {
		navigateToEpubChapter = navigateToEpubChapterMock;
	},
}));

describe("epub-ir-interop", () => {
	it("loads toc-only catalog and disposes parser", async () => {
		loadMock.mockResolvedValue({
			tocItems: [{ id: "1", label: "Chapter 1", href: "chapter1.xhtml", level: 1 }],
		});

		const items = await loadPublicationTocItems({} as never, "Books/demo.epub");

		expect(loadMock).toHaveBeenCalledWith("Books/demo.epub", { tocOnly: true });
		expect(disposeMock).toHaveBeenCalledTimes(1);
		expect(items).toEqual([
			{ id: "1", label: "Chapter 1", href: "chapter1.xhtml", level: 1 },
		]);
	});

	it("delegates chapter navigation to EpubLinkService", async () => {
		await navigateToPublicationChapter({} as never, "Books/demo.epub", "Text/ch1.xhtml", {
			sourceId: "epubsrc-demo",
		});

		expect(navigateToEpubChapterMock).toHaveBeenCalledWith(
			"Books/demo.epub",
			"Text/ch1.xhtml",
			{ sourceId: "epubsrc-demo" }
		);
	});
});
