import { afterEach, describe, expect, it } from "vitest";
import { epubActiveDocumentStore } from "../../../stores/epub-active-document-store";

describe("epubActiveDocumentStore reader context", () => {
	afterEach(() => {
		epubActiveDocumentStore.clearActiveDocument();
	});

	it("clears stale EPUB sidebar details when a PDF becomes the active reader document", () => {
		epubActiveDocumentStore.setActiveDocument("Books/latex.epub");
		epubActiveDocumentStore.setSharedState({
			book: {
				id: "epub-book",
				filePath: "Books/latex.epub",
				metadata: { title: "LaTeX", author: "Someone" },
			} as any,
			readerService: {} as any,
		});

		epubActiveDocumentStore.setActivePdfDocument({
			filePath: "Books/duboule-page.pdf",
			title: "duboule-page",
		});

		const state = epubActiveDocumentStore.getSharedState();
		expect(state.activeKind).toBe("pdf");
		expect(state.filePath).toBe("Books/duboule-page.pdf");
		expect(state.book).toBeNull();
		expect(state.readerService).toBeNull();
		expect(state.pdf).toEqual({
			filePath: "Books/duboule-page.pdf",
			title: "duboule-page",
		});
	});
});
