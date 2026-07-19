import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
	EPUB_DUAL_WINDOW_ANNOTATION_EVENT,
	EPUB_ANNOTATION_COMPARE_CONTEXT_EVENT,
	EPUB_DUAL_WINDOW_READER_DISPLAY_EVENT,
	createEpubAnnotationCompareContexts,
	dispatchEpubAnnotationCompareContextEvent,
	createEpubDualWindowAnnotationDetail,
	dispatchEpubDualWindowAnnotationEvent,
	dispatchEpubDualWindowReaderDisplayEvent,
	normalizeEpubAnnotationCompareContextChangeDetail,
	normalizeEpubDualWindowReaderDisplayDetail,
	normalizeEpubAnnotationCompareContext,
	resolveEpubAnnotationCompareExitPlan,
	shouldRemountEpubReaderForStateChange,
	shouldShowEpubReaderPrimaryToolbar,
} from "../epub-dual-window";
import {
	getEpubDualWindowSession,
	cleanupStaleEpubDualWindowSessions,
	listOpenEpubDualWindowSessions,
	markEpubDualWindowNoteLeaf,
	markEpubDualWindowPaneRoles,
	registerEpubDualWindowSession,
	restoreEpubDualWindowSessionsFromWorkspace,
	resolveEpubDualWindowOpenGuard,
	resolveEpubDualWindowBoundaryPosition,
	resolveEpubDualWindowPanes,
	unregisterEpubDualWindowSession,
} from "../epub-dual-window-workspace";

function createMockLeaf(input: {
	type?: string;
	filePath?: string;
	viewFilePath?: string;
	state?: Record<string, unknown>;
} = {}) {
	let viewState = {
		type: input.type || "weave-epub-reader",
		active: false,
		state: {
			...(input.filePath ? { filePath: input.filePath } : {}),
			...(input.state || {}),
		},
	};
	const viewFilePath = input.viewFilePath || "";
	const file = viewFilePath ? Object.assign(new TFile(), { path: viewFilePath }) : null;
	return {
		view: {
			...(file ? { file } : {}),
			getCurrentFilePath: () => input.filePath || String(viewState.state.filePath || ""),
		},
		getViewState: vi.fn(() => viewState),
		setViewState: vi.fn(async (nextState) => {
			viewState = nextState;
		}),
		detach: vi.fn(async () => undefined),
	};
}

function createMockApp(input: {
	epubLeaves?: any[];
	markdownLeaves?: any[];
	files?: Record<string, unknown>;
} = {}) {
	const files = new Map(
		Object.entries(input.files || {}).map(([path, value]) => [
			path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, ""),
			JSON.stringify(value),
		])
	);
	return {
		workspace: {
			getLeavesOfType: vi.fn((viewType: string) => {
				if (viewType === "markdown") {
					return input.markdownLeaves || [];
				}
				return viewType.includes("epub") ? input.epubLeaves || [] : [];
			}),
			revealLeaf: vi.fn(),
		},
		vault: {
			configDir: ".obsidian",
			adapter: {
				exists: vi.fn(async (path: string) => {
					const normalizedPath = path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
					return files.has(normalizedPath);
				}),
				read: vi.fn(async (path: string) => {
					const normalizedPath = path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
					return files.get(normalizedPath) || "";
				}),
			},
			getAbstractFileByPath: vi.fn(() => null),
			getFiles: vi.fn(() => []),
		},
	} as any;
}

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

	it("does not require a reader remount when only annotation compare context changes", () => {
		expect(
			shouldRemountEpubReaderForStateChange({
				currentFilePath: "Books/demo.epub",
				incomingFilePath: "Books/demo.epub",
			})
		).toBe(false);
		expect(
			shouldRemountEpubReaderForStateChange({
				currentFilePath: "Books/demo.epub",
				incomingFilePath: "Books/other.epub",
			})
		).toBe(true);
	});

	it("normalizes and dispatches annotation compare context change events", () => {
		const context = createEpubAnnotationCompareContexts({
			sessionId: "session-1",
			bookId: "book-1",
			filePath: "Books/demo.epub",
			editableVersionId: "default",
			readonlyVersionId: "imported",
		})?.readonly;
		const events: Event[] = [];
		const targetWindow = {
			dispatchEvent: vi.fn((event: Event) => {
				events.push(event);
				return true;
			}),
		} as unknown as Window;

		expect(
			dispatchEpubAnnotationCompareContextEvent(targetWindow, {
				sourceId: "view-1",
				filePath: "Books/demo.epub",
				annotationCompare: context,
			})
		).toBe(true);
		expect(events[0]?.type).toBe(EPUB_ANNOTATION_COMPARE_CONTEXT_EVENT);
		expect(
			normalizeEpubAnnotationCompareContextChangeDetail((events[0] as CustomEvent).detail)
		).toMatchObject({
			sourceId: "view-1",
			filePath: "Books/demo.epub",
			annotationCompare: {
				sessionId: "session-1",
				versionId: "imported",
				paneRole: "readonly",
			},
		});
		expect(
			normalizeEpubAnnotationCompareContextChangeDetail({
				sourceId: "view-1",
				filePath: "Books/demo.epub",
				annotationCompare: null,
			})
		).toEqual({
			sourceId: "view-1",
			filePath: "Books/demo.epub",
			annotationCompare: null,
		});
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

	it("unregisters note dual-window sessions after the side pane is closed", () => {
		const app = createMockApp();
		registerEpubDualWindowSession(app, {
			mode: "book-annotation-note",
			bookId: "book-1",
			filePath: "demo.epub",
			notePath: "weave/epub-data/books/book-1/annotations.md",
		});

		unregisterEpubDualWindowSession(app, "demo.epub");

		expect(getEpubDualWindowSession(app, "demo.epub")).toBeNull();
	});

	it("lists annotation compare sessions from open epub leaf state", () => {
		const contexts = createEpubAnnotationCompareContexts({
			sessionId: "compare-1",
			bookId: "book-1",
			filePath: "demo.epub",
			editableVersionId: "default",
			readonlyVersionId: "imported",
		});
		const app = createMockApp({
			epubLeaves: [
				createMockLeaf({
					filePath: "demo.epub",
					state: { annotationCompare: contexts?.editable },
				}),
				createMockLeaf({
					filePath: "demo.epub",
					state: { annotationCompare: contexts?.readonly },
				}),
			],
		});

		const sessions = listOpenEpubDualWindowSessions(app, {
			filePath: "demo.epub",
			bookId: "book-1",
		});

		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({
			mode: "annotation-compare",
			bookId: "book-1",
			filePath: "demo.epub",
			sessionId: "compare-1",
			sideKind: "epub",
			complete: true,
		});
		expect(sessions[0].mainLeaf).toBeTruthy();
		expect(sessions[0].sideLeaf).toBeTruthy();
	});

	it("restores note dual-window sessions from Obsidian-restored leaves after restart", async () => {
		const epubLeaf = createMockLeaf({ filePath: "Books/demo.epub" });
		const noteLeaf = createMockLeaf({
			type: "markdown",
			viewFilePath: "weave/epub-data/books/book-1/annotations.md",
		});
		const app = createMockApp({
			epubLeaves: [epubLeaf],
			markdownLeaves: [noteLeaf],
			files: {
				"weave/epub-data/books/book-1/book.json": {
					bookId: "book-1",
					filePath: "Books/demo.epub",
				},
			},
		});

		await expect(restoreEpubDualWindowSessionsFromWorkspace(app)).resolves.toBe(1);

		expect(getEpubDualWindowSession(app, "Books/demo.epub")).toMatchObject({
			mode: "book-annotation-note",
			bookId: "book-1",
			filePath: "Books/demo.epub",
			notePath: "weave/epub-data/books/book-1/annotations.md",
		});
		expect(resolveEpubDualWindowPanes(app, "Books/demo.epub")).toMatchObject({
			epubLeaf,
			noteLeaf,
		});
		expect(
			resolveEpubDualWindowOpenGuard(app, {
				requestedMode: "annotation-compare",
				bookId: "book-1",
				filePath: "Books/demo.epub",
			})
		).toMatchObject({
			action: "replace-existing",
			existingSession: { mode: "book-annotation-note" },
		});
	});

	it("allows different books to keep independent dual-window sessions", () => {
		const app = createMockApp();
		registerEpubDualWindowSession(app, {
			mode: "book-annotation-note",
			bookId: "book-1",
			filePath: "book-one.epub",
			notePath: "weave/epub-data/books/book-1/annotations.md",
		});

		expect(
			resolveEpubDualWindowOpenGuard(app, {
				requestedMode: "annotation-compare",
				bookId: "book-2",
				filePath: "book-two.epub",
			})
		).toMatchObject({ action: "open" });
	});

	it("cleans stale note dual-window sessions when the markdown side pane was closed", () => {
		const app = createMockApp({
			epubLeaves: [createMockLeaf({ filePath: "demo.epub" })],
			markdownLeaves: [],
		});
		registerEpubDualWindowSession(app, {
			mode: "book-annotation-note",
			bookId: "book-1",
			filePath: "demo.epub",
			notePath: "weave/epub-data/books/book-1/annotations.md",
		});

		expect(
			resolveEpubDualWindowOpenGuard(app, {
				requestedMode: "book-annotation-note",
				bookId: "book-1",
				filePath: "demo.epub",
			})
		).toMatchObject({ action: "open" });
		expect(getEpubDualWindowSession(app, "demo.epub")).toBeNull();
	});

	it("asks to replace the current mode when the same book already has another dual-window mode", () => {
		const app = createMockApp({
			epubLeaves: [createMockLeaf({ filePath: "demo.epub" })],
			markdownLeaves: [
				createMockLeaf({
					type: "markdown",
					viewFilePath: "weave/epub-data/books/book-1/annotations.md",
				}),
			],
		});
		registerEpubDualWindowSession(app, {
			mode: "book-annotation-note",
			bookId: "book-1",
			filePath: "demo.epub",
			notePath: "weave/epub-data/books/book-1/annotations.md",
		});

		expect(
			resolveEpubDualWindowOpenGuard(app, {
				requestedMode: "annotation-compare",
				bookId: "book-1",
				filePath: "demo.epub",
			})
		).toMatchObject({
			action: "replace-existing",
			existingSession: { mode: "book-annotation-note" },
		});
	});

	it("routes duplicate annotation compare opens to changing the compared versions", () => {
		const contexts = createEpubAnnotationCompareContexts({
			sessionId: "compare-1",
			bookId: "book-1",
			filePath: "demo.epub",
			editableVersionId: "default",
			readonlyVersionId: "imported",
		});
		const app = createMockApp({
			epubLeaves: [
				createMockLeaf({
					filePath: "demo.epub",
					state: { annotationCompare: contexts?.editable },
				}),
				createMockLeaf({
					filePath: "demo.epub",
					state: { annotationCompare: contexts?.readonly },
				}),
			],
		});

		expect(
			resolveEpubDualWindowOpenGuard(app, {
				requestedMode: "annotation-compare",
				bookId: "book-1",
				filePath: "demo.epub",
				currentAnnotationCompare: contexts?.editable,
			})
		).toMatchObject({
			action: "change-annotation-compare-versions",
			existingSession: { mode: "annotation-compare", sessionId: "compare-1" },
		});
	});

	it("does not block new dual-window opens with an incomplete restored annotation compare session", () => {
		const contexts = createEpubAnnotationCompareContexts({
			sessionId: "compare-1",
			bookId: "book-1",
			filePath: "demo.epub",
			editableVersionId: "default",
			readonlyVersionId: "imported",
		});
		const app = createMockApp({
			epubLeaves: [
				createMockLeaf({
					filePath: "demo.epub",
					state: { annotationCompare: contexts?.editable },
				}),
			],
		});

		expect(
			resolveEpubDualWindowOpenGuard(app, {
				requestedMode: "book-annotation-note",
				bookId: "book-1",
				filePath: "demo.epub",
				currentAnnotationCompare: contexts?.editable,
			})
		).toMatchObject({ action: "open" });
	});

	it("keeps transient one-sided annotation compare state during immediate cleanup", async () => {
		const contexts = createEpubAnnotationCompareContexts({
			sessionId: "compare-1",
			bookId: "book-1",
			filePath: "demo.epub",
			editableVersionId: "default",
			readonlyVersionId: "imported",
		});
		const leaf = createMockLeaf({
			filePath: "demo.epub",
			state: { annotationCompare: contexts?.editable },
		});
		const app = createMockApp({ epubLeaves: [leaf] });

		await expect(cleanupStaleEpubDualWindowSessions(app)).resolves.toMatchObject({
			clearedAnnotationComparePanes: 0,
		});
		expect(leaf.getViewState().state.annotationCompare).toMatchObject({
			sessionId: "compare-1",
			paneRole: "editable",
			versionId: "default",
		});
	});

	it("clears one-sided annotation compare state after it remains stale", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
		try {
			const contexts = createEpubAnnotationCompareContexts({
				sessionId: "compare-1",
				bookId: "book-1",
				filePath: "demo.epub",
				editableVersionId: "default",
				readonlyVersionId: "imported",
			});
			const leaf = createMockLeaf({
				filePath: "demo.epub",
				state: { annotationCompare: contexts?.editable },
			});
			const app = createMockApp({ epubLeaves: [leaf] });

			await expect(cleanupStaleEpubDualWindowSessions(app)).resolves.toMatchObject({
				clearedAnnotationComparePanes: 0,
			});

			nowSpy.mockReturnValue(2601);

			await expect(cleanupStaleEpubDualWindowSessions(app)).resolves.toMatchObject({
				clearedAnnotationComparePanes: 1,
			});
			expect(leaf.getViewState().state.annotationCompare).toBeUndefined();
		} finally {
			nowSpy.mockRestore();
		}
	});

	it("blocks nested dual-window opens from readonly compare side panes", () => {
		const contexts = createEpubAnnotationCompareContexts({
			sessionId: "compare-1",
			bookId: "book-1",
			filePath: "demo.epub",
			editableVersionId: "default",
			readonlyVersionId: "imported",
		});
		const app = createMockApp();

		expect(
			resolveEpubDualWindowOpenGuard(app, {
				requestedMode: "book-annotation-note",
				bookId: "book-1",
				filePath: "demo.epub",
				currentAnnotationCompare: contexts?.readonly,
			})
		).toMatchObject({ action: "blocked-side-pane" });
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
