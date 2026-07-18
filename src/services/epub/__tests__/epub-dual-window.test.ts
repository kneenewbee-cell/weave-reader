import { describe, expect, it, vi } from "vitest";
import {
	EPUB_DUAL_WINDOW_ANNOTATION_EVENT,
	EPUB_DUAL_WINDOW_READER_DISPLAY_EVENT,
	createEpubAnnotationCompareContexts,
	createEpubDualWindowAnnotationDetail,
	dispatchEpubDualWindowAnnotationEvent,
	dispatchEpubDualWindowReaderDisplayEvent,
	normalizeEpubDualWindowReaderDisplayDetail,
	normalizeEpubAnnotationCompareContext,
	resolveEpubAnnotationCompareExitPlan,
	shouldShowEpubReaderPrimaryToolbar,
} from "../epub-dual-window";
import {
	getEpubDualWindowSession,
	markEpubDualWindowNoteLeaf,
	markEpubDualWindowPaneRoles,
	registerEpubDualWindowSession,
	resolveEpubDualWindowBoundaryPosition,
} from "../epub-dual-window-workspace";

describe("epub-dual-window", () => {
	it("creates paired annotation compare contexts with editable and readonly roles", () => {
		const contexts = createEpubAnnotationCompareContexts({
			sessionId: "session-1",
			bookId: " epub-book-demo ",
			filePath: " Books/demo.epub ",
			editableVersionId: " active ",
			editableVersionName: " 当前版本 ",
			readonlyVersionId: " draft ",
			readonlyVersionName: " 草稿版本 ",
		});

		expect(contexts?.editable).toEqual({
			mode: "annotation-compare",
			sessionId: "session-1",
			bookId: "epub-book-demo",
			filePath: "Books/demo.epub",
			versionId: "active",
			versionName: "当前版本",
			counterpartVersionId: "draft",
			counterpartVersionName: "草稿版本",
			paneRole: "editable",
			syncPosition: true,
		});
		expect(contexts?.readonly).toMatchObject({
			versionId: "draft",
			versionName: "草稿版本",
			counterpartVersionId: "active",
			counterpartVersionName: "当前版本",
			paneRole: "readonly",
			syncPosition: true,
		});
	});

	it("normalizes annotation compare contexts and rejects incomplete values", () => {
		expect(
			normalizeEpubAnnotationCompareContext({
				mode: "annotation-compare",
				sessionId: " session-1 ",
				bookId: " book-1 ",
				filePath: " demo.epub ",
				versionId: " version-a ",
				paneRole: "readonly",
				syncPosition: false,
			})
		).toMatchObject({
			sessionId: "session-1",
			bookId: "book-1",
			filePath: "demo.epub",
			versionId: "version-a",
			paneRole: "readonly",
			syncPosition: false,
		});
		expect(normalizeEpubAnnotationCompareContext({ mode: "annotation-compare" })).toBeNull();
	});

	it("hides the primary reader toolbar for readonly annotation compare panes", () => {
		const readonlyContext = createEpubAnnotationCompareContexts({
			sessionId: "session-1",
			bookId: "book-1",
			filePath: "Books/demo.epub",
			editableVersionId: "left",
			readonlyVersionId: "right",
		})?.readonly;

		expect(
			shouldShowEpubReaderPrimaryToolbar({
				filePath: "Books/demo.epub",
				isMobile: false,
				annotationCompare: readonlyContext,
			})
		).toBe(false);
		expect(
			shouldShowEpubReaderPrimaryToolbar({
				filePath: "Books/demo.epub",
				isMobile: false,
				annotationCompare: { ...readonlyContext, paneRole: "editable" },
			})
		).toBe(true);
	});

	it("normalizes and dispatches annotation compare reader display sync events", () => {
		expect(
			normalizeEpubDualWindowReaderDisplayDetail({
				mode: "annotation-compare",
				sessionId: " session-1 ",
				filePath: " Books/demo.epub ",
				sourceId: " view-a ",
				flowMode: "scrolled",
				layoutMode: "paginated",
			})
		).toEqual({
			mode: "annotation-compare",
			sessionId: "session-1",
			filePath: "Books/demo.epub",
			sourceId: "view-a",
			flowMode: "scrolled",
			layoutMode: "paginated",
		});
		expect(
			normalizeEpubDualWindowReaderDisplayDetail({
				mode: "annotation-compare",
				sessionId: "session-1",
				filePath: "Books/demo.epub",
				flowMode: "invalid",
			})
		).toBeNull();

		const events: Event[] = [];
		const targetWindow = {
			dispatchEvent: vi.fn((event: Event) => {
				events.push(event);
				return true;
			}),
		} as unknown as Window;

		expect(
			dispatchEpubDualWindowReaderDisplayEvent(targetWindow, {
				sessionId: "session-1",
				filePath: "Books/demo.epub",
				flowMode: "paginated",
				layoutMode: "double",
			})
		).toBe(true);
		expect(events[0]?.type).toBe(EPUB_DUAL_WINDOW_READER_DISPLAY_EVENT);
		expect((events[0] as CustomEvent).detail).toMatchObject({
			sessionId: "session-1",
			flowMode: "paginated",
			layoutMode: "double",
		});
	});

	it("plans annotation compare exit by keeping editable panes and closing readonly panes", () => {
		const contexts = createEpubAnnotationCompareContexts({
			sessionId: "session-1",
			bookId: "book-1",
			filePath: "Books/demo.epub",
			editableVersionId: "default",
			readonlyVersionId: "imported",
		});
		const entries = [
			{ id: "main", context: contexts?.editable },
			{ id: "side", context: contexts?.readonly },
			{ id: "ignored", context: null },
		];

		const plan = resolveEpubAnnotationCompareExitPlan(entries, (entry) => entry.context);

		expect(plan.keepEntries.map((entry) => entry.id)).toEqual(["main"]);
		expect(plan.closeEntries.map((entry) => entry.id)).toEqual(["side"]);
	});

	it("normalizes annotation hover details", () => {
		expect(
			createEpubDualWindowAnnotationDetail({
				phase: "enter",
				bookId: " epub-book-demo ",
				filePath: " Books/demo.epub ",
				cfiRange: " epubcfi(/6/2) ",
				annotationId: " anno-1 ",
				semanticId: " important ",
				text: " Demo text ",
			})
		).toEqual({
			mode: "book-annotation-note",
			phase: "enter",
			bookId: "epub-book-demo",
			filePath: "Books/demo.epub",
			cfiRange: "epubcfi(/6/2)",
			annotationId: "anno-1",
			semanticId: "important",
			text: "Demo text",
		});
	});

	it("does not dispatch incomplete annotation events", () => {
		const dispatchEvent = vi.fn();
		const targetWindow = { dispatchEvent } as unknown as Window;

		expect(
			dispatchEpubDualWindowAnnotationEvent(targetWindow, {
				phase: "enter",
				bookId: "book-1",
				filePath: "Books/demo.epub",
			})
		).toBe(false);
		expect(dispatchEvent).not.toHaveBeenCalled();
	});

	it("dispatches a CustomEvent for valid annotation details", () => {
		const events: Event[] = [];
		const targetWindow = {
			dispatchEvent: vi.fn((event: Event) => {
				events.push(event);
				return true;
			}),
		} as unknown as Window;

		expect(
			dispatchEpubDualWindowAnnotationEvent(targetWindow, {
				phase: "click",
				bookId: "book-1",
				filePath: "Books/demo.epub",
				cfiRange: "epubcfi(/6/2)",
			})
		).toBe(true);

		expect(events[0]?.type).toBe(EPUB_DUAL_WINDOW_ANNOTATION_EVENT);
		expect((events[0] as CustomEvent).detail).toMatchObject({
			phase: "click",
			bookId: "book-1",
			filePath: "Books/demo.epub",
			cfiRange: "epubcfi(/6/2)",
		});
	});

	it("marks and clears the dual-window note leaf class", () => {
		const containerEl = document.createElement("div");
		const leaf = { view: { containerEl } } as any;

		markEpubDualWindowNoteLeaf(leaf, true);
		expect(containerEl.classList.contains("weave-epub-annotation-note-dual-window-view")).toBe(true);

		markEpubDualWindowNoteLeaf(leaf, false);
		expect(containerEl.classList.contains("weave-epub-annotation-note-dual-window-view")).toBe(false);
	});

	it("marks all known Obsidian leaf containers for dual-window note views", () => {
		const leafContainerEl = document.createElement("div");
		const viewContainerEl = document.createElement("div");
		const contentEl = document.createElement("div");
		const leaf = {
			containerEl: leafContainerEl,
			view: { containerEl: viewContainerEl, contentEl },
		} as any;

		markEpubDualWindowNoteLeaf(leaf, true);

		expect(leafContainerEl.classList.contains("weave-epub-annotation-note-dual-window-view")).toBe(true);
		expect(viewContainerEl.classList.contains("weave-epub-annotation-note-dual-window-view")).toBe(true);
		expect(contentEl.classList.contains("weave-epub-annotation-note-dual-window-view")).toBe(true);
	});

	it("resolves sessions for equivalent vault paths, not only exact stored paths", () => {
		const app = { workspace: {} } as any;
		registerEpubDualWindowSession(app, {
			mode: "book-annotation-note",
			bookId: "book-1",
			filePath: "Books/demo.epub",
			notePath: "weave/epub-data/books/book-1/annotations.md",
		});

		expect(getEpubDualWindowSession(app, "demo.epub")?.bookId).toBe("book-1");
	});

	it("keeps only the markdown note pane marked as a dual-window note view", () => {
		const epubContainerEl = document.createElement("div");
		const noteContainerEl = document.createElement("div");
		const epubLeaf = { view: { containerEl: epubContainerEl } } as any;
		const noteLeaf = { view: { containerEl: noteContainerEl } } as any;

		markEpubDualWindowNoteLeaf(epubLeaf, true);
		markEpubDualWindowPaneRoles(epubLeaf, noteLeaf);

		expect(epubContainerEl.classList.contains("weave-epub-annotation-note-dual-window-view")).toBe(false);
		expect(noteContainerEl.classList.contains("weave-epub-annotation-note-dual-window-view")).toBe(true);
	});

	it("places the swap control on the boundary between two panes", () => {
		expect(
			resolveEpubDualWindowBoundaryPosition(
				{ left: 120, right: 520, top: 20, bottom: 820 },
				{ left: 520, right: 920, top: 20, bottom: 820 }
			)
		).toEqual({ left: 520, top: 420 });

		expect(
			resolveEpubDualWindowBoundaryPosition(
				{ left: 600, right: 1000, top: 40, bottom: 740 },
				{ left: 200, right: 600, top: 80, bottom: 680 }
			)
		).toEqual({ left: 600, top: 380 });
	});
});
