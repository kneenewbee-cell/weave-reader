import { afterEach, describe, expect, it, vi } from "vitest";
import { App, TFile, WorkspaceLeaf, loadPdfJs } from "obsidian";
import { epubActiveDocumentStore } from "../stores/epub-active-document-store";
import { getEpubStorageService } from "../services/epub/epub-storage-access";
import { PdfView } from "./PdfView";

vi.mock("../services/epub/epub-storage-access", () => ({
	getEpubStorageService: vi.fn(),
}));

function createStorageMock(book: any = null) {
	const storage = {
		findBookByFilePath: vi.fn(async () => book),
		saveProgress: vi.fn(async () => undefined),
		flushPendingProgress: vi.fn(async () => undefined),
	};
	vi.mocked(getEpubStorageService).mockReturnValue(storage as any);
	return storage;
}

describe("PdfView sidebar context", () => {
	afterEach(() => {
		epubActiveDocumentStore.clearActiveDocument();
		vi.restoreAllMocks();
	});

	function createPdfView(filePath = "Books/duboule-page.pdf") {
		createStorageMock();
		const app = new App();
		const file = new TFile(filePath);
		let activeLeafHandler: ((leaf: WorkspaceLeaf | null) => void) | null = null;

		app.vault.getAbstractFileByPath = vi.fn((path: string) =>
			path === filePath ? file : null
		) as any;
		app.vault.getResourcePath = vi.fn(() => "app://vault/pdf") as any;
		app.vault.readBinary = vi.fn(async () => new ArrayBuffer(8)) as any;
		app.workspace.activeLeaf = null;
		app.workspace.on = vi.fn((event: string, handler: (leaf: WorkspaceLeaf | null) => void) => {
			if (event === "active-leaf-change") {
				activeLeafHandler = handler;
			}
			return { event };
		});

		const leaf = new WorkspaceLeaf(app);
		const view = new PdfView(leaf as any);
		leaf.view = view;
		app.workspace.activeLeaf = leaf;
		(view as any).filePath = filePath;

		return {
			leaf,
			view,
			getActiveLeafHandler: () => activeLeafHandler,
		};
	}

	it("replaces stale EPUB sidebar state with PDF context when opened", async () => {
		epubActiveDocumentStore.setActiveDocument("Books/latex.epub");
		epubActiveDocumentStore.setSharedState({
			book: { id: "epub-book", metadata: { title: "LaTeX" } } as any,
			readerService: {} as any,
		});
		const { view } = createPdfView();

		await view.onOpen();

		const state = epubActiveDocumentStore.getSharedState() as any;
		expect(state.activeKind).toBe("pdf");
		expect(state.filePath).toBe("Books/duboule-page.pdf");
		expect(state.book).toBeNull();
		expect(state.pdf?.title).toBe("duboule-page");
	});

	it("restores PDF context when an existing PDF tab becomes active again", async () => {
		const { leaf, view, getActiveLeafHandler } = createPdfView();
		await view.onOpen();

		epubActiveDocumentStore.setActiveDocument("Books/latex.epub");
		epubActiveDocumentStore.setSharedState({
			book: { id: "epub-book", metadata: { title: "LaTeX" } } as any,
			readerService: {} as any,
		});
		const handler = getActiveLeafHandler();
		expect(handler).toEqual(expect.any(Function));

		handler?.(leaf);

		const state = epubActiveDocumentStore.getSharedState() as any;
		expect(state.activeKind).toBe("pdf");
		expect(state.filePath).toBe("Books/duboule-page.pdf");
		expect(state.book).toBeNull();
	});
});

describe("PdfView custom PDF reader", () => {
	afterEach(() => {
		epubActiveDocumentStore.clearActiveDocument();
		vi.restoreAllMocks();
	});

	function createMockPdfDocument(pageCount = 3) {
		const renderCalls: number[] = [];
		const pages = Array.from({ length: pageCount }, (_, index) => {
			const pageNumber = index + 1;
			return {
				pageNumber,
				getViewport: vi.fn(({ scale }: { scale: number }) => ({
					width: 200 * scale,
					height: 280 * scale,
				})),
				render: vi.fn(() => {
					renderCalls.push(pageNumber);
					return { promise: Promise.resolve() };
				}),
			};
		});

		return {
			pdf: {
				numPages: pageCount,
				getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1]),
				destroy: vi.fn(),
			},
			renderCalls,
		};
	}

	function installCanvasMock() {
		const originalGetContext = HTMLCanvasElement.prototype.getContext;
		const originalToDataUrl = HTMLCanvasElement.prototype.toDataURL;
		HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
			fillStyle: "",
			fillRect: vi.fn(),
			drawImage: vi.fn(),
		})) as any;
		HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,thumb") as any;
		return () => {
			HTMLCanvasElement.prototype.getContext = originalGetContext;
			HTMLCanvasElement.prototype.toDataURL = originalToDataUrl;
		};
	}

	function createPdfView(filePath = "Books/duboule-page.pdf") {
		const storage = createStorageMock();
		const app = new App();
		const file = new TFile(filePath);
		const adapter = {
			exists: vi.fn(async () => false),
			read: vi.fn(async () => ""),
			write: vi.fn(async () => undefined),
			mkdir: vi.fn(async () => undefined),
		};
		(app.vault as any).adapter = adapter;
		app.vault.getAbstractFileByPath = vi.fn((path: string) =>
			path === filePath ? file : null
		) as any;
		app.vault.getResourcePath = vi.fn(() => "app://vault/pdf") as any;
		app.vault.readBinary = vi.fn(async () => new ArrayBuffer(8)) as any;
		app.workspace.activeLeaf = null;
		app.workspace.on = vi.fn(() => ({ event: "active-leaf-change" }));

		const leaf = new WorkspaceLeaf(app);
		const view = new PdfView(leaf as any);
		leaf.view = view;
		app.workspace.activeLeaf = leaf;
		(view as any).filePath = filePath;
		return { app, leaf, view, storage, adapter };
	}

	function dispatchPointerEvent(
		target: EventTarget,
		type: string,
		options: {
			clientX: number;
			clientY: number;
			buttons?: number;
			pointerId?: number;
			pointerType?: string;
			pressure?: number;
		}
	) {
		const event = new MouseEvent(type, {
			bubbles: true,
			cancelable: true,
			clientX: options.clientX,
			clientY: options.clientY,
		}) as any;
		Object.defineProperties(event, {
			buttons: { value: options.buttons ?? 1 },
			pointerId: { value: options.pointerId ?? 1 },
			pointerType: { value: options.pointerType ?? "pen" },
			pressure: { value: options.pressure ?? 0.5 },
		});
		target.dispatchEvent(event);
	}

	function chooseInkMode(view: PdfView, mode: "pen" | "highlighter" = "pen") {
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="ink-tools"]')
			?.click();
		view.contentEl
			.querySelector<HTMLButtonElement>(`[data-weave-pdf-ink-mode="${mode}"]`)
			?.click();
	}

	it("renders pages and thumbnails with Obsidian pdf.js instead of an iframe", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(2);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();

		expect(view.contentEl.querySelector("iframe")).toBeNull();
		expect(view.contentEl.querySelectorAll(".weave-pdf-page")).toHaveLength(2);
		expect(view.contentEl.textContent).toContain("1 / 2");
		const state = epubActiveDocumentStore.getSharedState() as any;
		expect(state.pdf).toMatchObject({
			filePath: "Books/duboule-page.pdf",
			title: "duboule-page",
			currentPage: 1,
			pageCount: 2,
			progress: 50,
			visitedPageCount: 1,
		});
		expect(state.pdf?.thumbnails).toEqual([
			{ pageNumber: 1, image: "data:image/png;base64,thumb" },
			{ pageNumber: 2, image: "data:image/png;base64,thumb" },
		]);
		restoreCanvas();
	});

	it("tracks PDF reading progress by the furthest reached page when navigating pages", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(3);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();

		const nextButton = view.contentEl.querySelector<HTMLButtonElement>(
			'[data-weave-pdf-action="next-page"]'
		);
		nextButton?.click();

		const state = epubActiveDocumentStore.getSharedState() as any;
		expect(state.pdf).toMatchObject({
			currentPage: 2,
			pageCount: 3,
			furthestPage: 2,
			progress: 67,
			visitedPageCount: 2,
		});
		expect(view.contentEl.textContent).toContain("2 / 3");
		restoreCanvas();
	});

	it("updates shared PDF progress when sidebar thumbnail navigation runs while the PDF leaf is not active", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(4);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { app, view } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		app.workspace.activeLeaf = new WorkspaceLeaf(app);

		const before = epubActiveDocumentStore.getSharedState() as any;
		before.pdf.onNavigatePage(3);

		const state = epubActiveDocumentStore.getSharedState() as any;
		expect(state.pdf).toMatchObject({
			currentPage: 3,
			pageCount: 4,
			furthestPage: 3,
			progress: 75,
			visitedPageCount: 2,
		});
		restoreCanvas();
	});

	it("persists PDF bookshelf progress using the furthest reached page", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(3);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const book = {
			id: "pdf-book",
			filePath: "Books/duboule-page.pdf",
			currentPosition: { chapterIndex: 0, cfi: "", percent: 0 },
			readingStats: { totalReadTime: 0, lastReadTime: 0, createdTime: 1 },
		};
		const { view, storage } = createPdfView();
		storage.findBookByFilePath.mockResolvedValue(book);

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		storage.saveProgress.mockClear();
		storage.flushPendingProgress.mockClear();

		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="next-page"]')
			?.click();
		await vi.waitFor(() => {
			expect(storage.saveProgress).toHaveBeenCalled();
		});

		expect(storage.saveProgress).toHaveBeenLastCalledWith("pdf-book", {
			chapterIndex: 1,
			cfi: "pdf-page:2|visited:1-2",
			percent: 67,
		});
		expect(storage.flushPendingProgress).not.toHaveBeenCalled();

		await view.onClose();

		expect(storage.flushPendingProgress).toHaveBeenCalled();
		restoreCanvas();
	});

	it("counts every visible PDF page as read during scroll after a jump", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(5);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();

		const scrollEl = view.contentEl.querySelector<HTMLElement>(".weave-pdf-reader-pages");
		const pageEls = Array.from(view.contentEl.querySelectorAll<HTMLElement>(".weave-pdf-page"));
		expect(scrollEl).toBeTruthy();
		expect(pageEls).toHaveLength(5);

		scrollEl!.getBoundingClientRect = vi.fn(() => ({
			top: 0,
			bottom: 1000,
			height: 1000,
			left: 0,
			right: 600,
			width: 600,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect));
		const pageRects = [
			{ top: -1500, bottom: -1100, height: 400 },
			{ top: -1000, bottom: -600, height: 400 },
			{ top: -500, bottom: -100, height: 400 },
			{ top: 120, bottom: 520, height: 400 },
			{ top: 540, bottom: 940, height: 400 },
		];
		pageEls.forEach((pageEl, index) => {
			const rect = pageRects[index];
			pageEl.getBoundingClientRect = vi.fn(() => ({
				...rect,
				left: 0,
				right: 600,
				width: 600,
				x: 0,
				y: rect.top,
				toJSON: () => ({}),
			} as DOMRect));
		});

		scrollEl!.dispatchEvent(new Event("scroll"));

		const state = epubActiveDocumentStore.getSharedState() as any;
		expect(state.pdf).toMatchObject({
			currentPage: 4,
			pageCount: 5,
			furthestPage: 5,
			progress: 100,
			visitedPageCount: 3,
		});
		restoreCanvas();
	});

	it("shows PDF annotation tools and switches the active tool without leaving PDF mode", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();

		const root = view.contentEl.querySelector<HTMLElement>(".weave-pdf-reader");
		expect(root?.dataset.weavePdfTool).toBe("pan");
		expect(view.contentEl.querySelector('[data-weave-pdf-tool="pan"]')).toBeTruthy();
		expect(view.contentEl.querySelector('[data-weave-pdf-action="ink-tools"]')).toBeTruthy();
		expect(view.contentEl.querySelector('[data-weave-pdf-tool="pen"]')).toBeNull();
		expect(view.contentEl.querySelector('[data-weave-pdf-tool="highlighter"]')).toBeNull();
		expect(view.contentEl.querySelector('[data-weave-pdf-tool="eraser"]')).toBeTruthy();

		chooseInkMode(view, "pen");

		expect(root?.dataset.weavePdfTool).toBe("pen");
		expect(
			view.contentEl
				.querySelector<HTMLButtonElement>('[data-weave-pdf-ink-mode="pen"]')
				?.getAttribute("aria-pressed")
		).toBe("true");
		const state = epubActiveDocumentStore.getSharedState() as any;
		expect(state.activeKind).toBe("pdf");
		expect(state.pdf?.activeTool).toBe("pen");
		restoreCanvas();
	});

	it("places the full PDF tool mode set in a left rail while keeping the top bar for reading controls", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();

		const root = view.contentEl.querySelector<HTMLElement>(".weave-pdf-reader");
		const rail = view.contentEl.querySelector<HTMLElement>(".weave-pdf-reader-tools-rail");
		expect(rail).toBeTruthy();
		for (const tool of [
			"pan",
			"select",
			"stroke-select",
			"capture",
			"eraser",
		]) {
			expect(rail!.querySelector(`[data-weave-pdf-tool="${tool}"]`)).toBeTruthy();
		}
		expect(rail!.querySelector('[data-weave-pdf-action="ink-tools"]')).toBeTruthy();
		expect(rail!.querySelector('[data-weave-pdf-tool="pen"]')).toBeNull();
		expect(rail!.querySelector('[data-weave-pdf-tool="highlighter"]')).toBeNull();
		expect(
			view.contentEl.querySelector('.weave-pdf-reader-toolbar [data-weave-pdf-tool="pen"]')
		).toBeNull();

		rail!
			.querySelector<HTMLButtonElement>('[data-weave-pdf-tool="stroke-select"]')
			?.click();

		expect(root?.dataset.weavePdfTool).toBe("stroke-select");
		const state = epubActiveDocumentStore.getSharedState() as any;
		expect(state.activeKind).toBe("pdf");
		expect(state.pdf?.activeTool).toBe("stroke-select");
		restoreCanvas();
	});

	it("opens one ink selector for normal and transparent pen modes", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();

		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-tool="stroke-select"]')
			?.click();
		const inkButton = view.contentEl.querySelector<HTMLButtonElement>(
			'[data-weave-pdf-action="ink-tools"]'
		);
		expect(inkButton).toBeTruthy();
		inkButton!.click();

		const panel = view.contentEl.querySelector<HTMLElement>(
			".weave-pdf-reader-tool-settings-panel"
		);
		expect(panel?.hidden).toBe(false);
		expect(panel?.querySelector('[data-weave-pdf-ink-mode="pen"]')).toBeTruthy();
		expect(panel?.querySelector('[data-weave-pdf-ink-mode="highlighter"]')).toBeTruthy();
		expect(panel?.textContent).toContain("普通笔");
		expect(panel?.textContent).toContain("透明笔");
		const root = view.contentEl.querySelector<HTMLElement>(".weave-pdf-reader");
		expect(root?.dataset.weavePdfTool).toBe("pen");
		expect(inkButton!.getAttribute("aria-pressed")).toBe("true");
		expect(
			view.contentEl
				.querySelector<HTMLButtonElement>('[data-weave-pdf-tool="stroke-select"]')
				?.getAttribute("aria-pressed")
		).toBe("false");

		panel!.querySelector<HTMLButtonElement>('[data-weave-pdf-ink-mode="highlighter"]')?.click();

		expect(root?.dataset.weavePdfTool).toBe("highlighter");
		expect(
			panel!
				.querySelector<HTMLButtonElement>('[data-weave-pdf-ink-mode="highlighter"]')
				?.getAttribute("aria-pressed")
		).toBe("true");
		expect(
			panel!
				.querySelector<HTMLButtonElement>('[data-weave-pdf-ink-mode="pen"]')
				?.getAttribute("aria-pressed")
		).toBe("false");
		restoreCanvas();
	});

	it("dismisses ink settings when the ink button or reader surface is clicked", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();

		const inkButton = view.contentEl.querySelector<HTMLButtonElement>(
			'[data-weave-pdf-action="ink-tools"]'
		);
		const panel = view.contentEl.querySelector<HTMLElement>(
			".weave-pdf-reader-tool-settings-panel"
		);
		expect(inkButton).toBeTruthy();
		expect(panel).toBeTruthy();

		inkButton!.click();
		expect(panel!.hidden).toBe(false);
		inkButton!.click();
		expect(panel!.hidden).toBe(true);

		inkButton!.click();
		expect(panel!.hidden).toBe(false);
		view.contentEl
			.querySelector<HTMLElement>(".weave-pdf-reader-pages")
			?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(panel!.hidden).toBe(true);
		restoreCanvas();
	});

	it("uses the native color picker without replacing it with fixed swatches", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		chooseInkMode(view, "pen");

		expect(view.contentEl.querySelector("[data-weave-pdf-color-swatch]")).toBeNull();
		const colorInput = view.contentEl.querySelector<HTMLInputElement>(
			'[data-weave-pdf-setting="pen-color"]'
		);
		expect(colorInput).toBeTruthy();
		expect(colorInput?.type).toBe("color");
		restoreCanvas();
	});

	it("draws and saves a pen stroke on the current PDF page annotation layer", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view, adapter } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		chooseInkMode(view, "pen");

		const layer = view.contentEl.querySelector<SVGSVGElement>(
			".weave-pdf-annotation-layer"
		);
		expect(layer).toBeTruthy();
		layer!.getBoundingClientRect = vi.fn(() => ({
			top: 0,
			bottom: 280,
			height: 280,
			left: 0,
			right: 200,
			width: 200,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect));

		dispatchPointerEvent(layer!, "pointerdown", { clientX: 20, clientY: 28 });
		dispatchPointerEvent(layer!, "pointermove", { clientX: 80, clientY: 84 });
		dispatchPointerEvent(layer!, "pointerup", { clientX: 120, clientY: 140, buttons: 0 });

		expect(layer!.querySelectorAll("path")).toHaveLength(1);
		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		const [, writtenJson] = adapter.write.mock.calls.at(-1) ?? [];
		const payload = JSON.parse(String(writtenJson || "{}"));
		expect(payload).toMatchObject({
			version: 1,
			sourcePath: "Books/duboule-page.pdf",
			pageCount: 1,
		});
		expect(payload.strokes).toHaveLength(1);
		expect(payload.strokes[0]).toMatchObject({
			pageNumber: 1,
			tool: "pen",
			color: "#111111",
		});
		expect(payload.strokes[0].points[0]).toMatchObject({ x: 0.1, y: 0.1 });
		restoreCanvas();
	});

	it("renders the active pen stroke as a live path before the pointer is released", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view, adapter } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		chooseInkMode(view, "pen");

		const layer = view.contentEl.querySelector<SVGSVGElement>(
			".weave-pdf-annotation-layer"
		);
		expect(layer).toBeTruthy();
		layer!.getBoundingClientRect = vi.fn(() => ({
			top: 0,
			bottom: 280,
			height: 280,
			left: 0,
			right: 200,
			width: 200,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect));

		dispatchPointerEvent(layer!, "pointerdown", { clientX: 20, clientY: 28 });
		dispatchPointerEvent(layer!, "pointermove", { clientX: 80, clientY: 84 });

		const livePath = layer!.querySelector<SVGPathElement>(
			'path.weave-pdf-ink-stroke[data-weave-pdf-live-stroke="true"]'
		);
		expect(livePath).toBeTruthy();
		expect(livePath?.getAttribute("d")).toContain("L");
		expect(adapter.write).not.toHaveBeenCalled();
		restoreCanvas();
	});

	it("applies PDF pen color and width controls to new ink strokes", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view, adapter } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		chooseInkMode(view, "pen");

		const colorInput = view.contentEl.querySelector<HTMLInputElement>(
			'[data-weave-pdf-setting="pen-color"]'
		);
		const widthInput = view.contentEl.querySelector<HTMLInputElement>(
			'[data-weave-pdf-setting="pen-width"]'
		);
		const touchToggle = view.contentEl.querySelector<HTMLInputElement>(
			'[data-weave-pdf-setting="touch-input"]'
		);
		expect(colorInput).toBeTruthy();
		expect(widthInput).toBeTruthy();
		expect(touchToggle).toBeTruthy();

		colorInput!.value = "#e53935";
		colorInput!.dispatchEvent(new Event("input", { bubbles: true }));
		widthInput!.value = "9";
		widthInput!.dispatchEvent(new Event("input", { bubbles: true }));

		const layer = view.contentEl.querySelector<SVGSVGElement>(
			".weave-pdf-annotation-layer"
		);
		expect(layer).toBeTruthy();
		layer!.getBoundingClientRect = vi.fn(() => ({
			top: 0,
			bottom: 280,
			height: 280,
			left: 0,
			right: 200,
			width: 200,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect));
		dispatchPointerEvent(layer!, "pointerdown", { clientX: 20, clientY: 28 });
		dispatchPointerEvent(layer!, "pointermove", { clientX: 80, clientY: 84 });
		dispatchPointerEvent(layer!, "pointerup", { clientX: 120, clientY: 140, buttons: 0 });

		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		const [, writtenJson] = adapter.write.mock.calls.at(-1) ?? [];
		const payload = JSON.parse(String(writtenJson || "{}"));
		expect(payload.strokes[0]).toMatchObject({
			color: "#e53935",
			width: 9,
		});
		restoreCanvas();
	});

	it("selects and deletes an existing ink stroke in stroke select mode", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view, adapter } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="ink-tools"]')
			?.click();
		view.contentEl.querySelector<HTMLButtonElement>('[data-weave-pdf-ink-mode="pen"]')?.click();

		const layer = view.contentEl.querySelector<SVGSVGElement>(
			".weave-pdf-annotation-layer"
		);
		expect(layer).toBeTruthy();
		layer!.getBoundingClientRect = vi.fn(() => ({
			top: 0,
			bottom: 280,
			height: 280,
			left: 0,
			right: 200,
			width: 200,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect));

		dispatchPointerEvent(layer!, "pointerdown", { clientX: 20, clientY: 28 });
		dispatchPointerEvent(layer!, "pointermove", { clientX: 80, clientY: 84 });
		dispatchPointerEvent(layer!, "pointerup", { clientX: 120, clientY: 140, buttons: 0 });
		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		adapter.write.mockClear();

		view.contentEl
			.querySelector<HTMLButtonElement>(
				'.weave-pdf-reader-tools-rail [data-weave-pdf-tool="stroke-select"]'
			)
			?.click();
		dispatchPointerEvent(layer!, "pointerdown", { clientX: 80, clientY: 84, pointerType: "mouse" });
		dispatchPointerEvent(layer!, "pointerup", {
			clientX: 80,
			clientY: 84,
			buttons: 0,
			pointerType: "mouse",
		});

		const selectedStroke = layer!.querySelector(".weave-pdf-ink-stroke.selected");
		expect(selectedStroke).toBeTruthy();

		view.contentEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));

		expect(layer!.querySelectorAll(".weave-pdf-ink-stroke")).toHaveLength(0);
		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		const [, writtenJson] = adapter.write.mock.calls.at(-1) ?? [];
		const payload = JSON.parse(String(writtenJson || "{}"));
		expect(payload.strokes).toHaveLength(0);
		restoreCanvas();
	});

	it("copies and pastes selected ink strokes in stroke select mode", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view, adapter } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="ink-tools"]')
			?.click();
		view.contentEl.querySelector<HTMLButtonElement>('[data-weave-pdf-ink-mode="pen"]')?.click();

		const layer = view.contentEl.querySelector<SVGSVGElement>(
			".weave-pdf-annotation-layer"
		);
		expect(layer).toBeTruthy();
		layer!.getBoundingClientRect = vi.fn(() => ({
			top: 0,
			bottom: 280,
			height: 280,
			left: 0,
			right: 200,
			width: 200,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect));

		dispatchPointerEvent(layer!, "pointerdown", { clientX: 20, clientY: 28 });
		dispatchPointerEvent(layer!, "pointermove", { clientX: 80, clientY: 84 });
		dispatchPointerEvent(layer!, "pointerup", { clientX: 120, clientY: 140, buttons: 0 });
		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		adapter.write.mockClear();

		view.contentEl
			.querySelector<HTMLButtonElement>(
				'.weave-pdf-reader-tools-rail [data-weave-pdf-tool="stroke-select"]'
			)
			?.click();
		dispatchPointerEvent(layer!, "pointerdown", { clientX: 80, clientY: 84, pointerType: "mouse" });
		dispatchPointerEvent(layer!, "pointerup", {
			clientX: 80,
			clientY: 84,
			buttons: 0,
			pointerType: "mouse",
		});

		view.contentEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true })
		);
		view.contentEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true })
		);

		expect(layer!.querySelectorAll(".weave-pdf-ink-stroke")).toHaveLength(2);
		expect(layer!.querySelectorAll(".weave-pdf-ink-stroke.selected")).toHaveLength(1);
		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		const [, writtenJson] = adapter.write.mock.calls.at(-1) ?? [];
		const payload = JSON.parse(String(writtenJson || "{}"));
		expect(payload.strokes).toHaveLength(2);
		expect(payload.strokes[0].id).not.toBe(payload.strokes[1].id);
		restoreCanvas();
	});

	it("keeps a capture selection and copies it as image data", async () => {
		const restoreCanvas = installCanvasMock();
		const originalClipboard = navigator.clipboard;
		const clipboard = { writeText: vi.fn(async () => undefined) };
		Object.defineProperty(navigator, "clipboard", {
			value: clipboard,
			configurable: true,
		});
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		view.contentEl
			.querySelector<HTMLButtonElement>('.weave-pdf-reader-tool-button[data-weave-pdf-tool="capture"]')
			?.click();

		const layer = view.contentEl.querySelector<SVGSVGElement>(
			".weave-pdf-annotation-layer"
		);
		expect(layer).toBeTruthy();
		layer!.getBoundingClientRect = vi.fn(() => ({
			top: 0,
			bottom: 280,
			height: 280,
			left: 0,
			right: 200,
			width: 200,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect));

		dispatchPointerEvent(layer!, "pointerdown", { clientX: 20, clientY: 28 });
		dispatchPointerEvent(layer!, "pointermove", { clientX: 120, clientY: 168 });
		dispatchPointerEvent(layer!, "pointerup", { clientX: 120, clientY: 168, buttons: 0 });

		expect(layer!.querySelector(".weave-pdf-capture-box")).toBeTruthy();
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="copy-capture"]')
			?.click();

		await vi.waitFor(() => {
			expect(clipboard.writeText).toHaveBeenCalledWith("data:image/png;base64,thumb");
		});
		Object.defineProperty(navigator, "clipboard", {
			value: originalClipboard,
			configurable: true,
		});
		restoreCanvas();
	});

	it("clears the capture selection when switching to another PDF tool", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		view.contentEl
			.querySelector<HTMLButtonElement>('.weave-pdf-reader-tool-button[data-weave-pdf-tool="capture"]')
			?.click();

		const layer = view.contentEl.querySelector<SVGSVGElement>(
			".weave-pdf-annotation-layer"
		);
		expect(layer).toBeTruthy();
		layer!.getBoundingClientRect = vi.fn(() => ({
			top: 0,
			bottom: 280,
			height: 280,
			left: 0,
			right: 200,
			width: 200,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect));

		dispatchPointerEvent(layer!, "pointerdown", { clientX: 20, clientY: 28 });
		dispatchPointerEvent(layer!, "pointermove", { clientX: 120, clientY: 168 });
		dispatchPointerEvent(layer!, "pointerup", { clientX: 120, clientY: 168, buttons: 0 });
		expect(layer!.querySelector(".weave-pdf-capture-box")).toBeTruthy();

		view.contentEl.querySelector<HTMLButtonElement>('[data-weave-pdf-tool="pan"]')?.click();

		expect(layer!.querySelector(".weave-pdf-capture-box")).toBeNull();
		restoreCanvas();
	});

	it("renders visible halos for every ink stroke selected by a marquee", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view, adapter } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		chooseInkMode(view, "pen");

		const layer = view.contentEl.querySelector<SVGSVGElement>(
			".weave-pdf-annotation-layer"
		);
		expect(layer).toBeTruthy();
		layer!.getBoundingClientRect = vi.fn(() => ({
			top: 0,
			bottom: 280,
			height: 280,
			left: 0,
			right: 200,
			width: 200,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect));

		dispatchPointerEvent(layer!, "pointerdown", { clientX: 20, clientY: 28 });
		dispatchPointerEvent(layer!, "pointermove", { clientX: 50, clientY: 56 });
		dispatchPointerEvent(layer!, "pointerup", { clientX: 70, clientY: 84, buttons: 0 });
		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		dispatchPointerEvent(layer!, "pointerdown", { clientX: 120, clientY: 140 });
		dispatchPointerEvent(layer!, "pointermove", { clientX: 140, clientY: 168 });
		dispatchPointerEvent(layer!, "pointerup", { clientX: 160, clientY: 196, buttons: 0 });

		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-tool="stroke-select"]')
			?.click();
		dispatchPointerEvent(layer!, "pointerdown", { clientX: 10, clientY: 14, pointerType: "mouse" });
		dispatchPointerEvent(layer!, "pointermove", { clientX: 180, clientY: 224, pointerType: "mouse" });
		dispatchPointerEvent(layer!, "pointerup", {
			clientX: 180,
			clientY: 224,
			buttons: 0,
			pointerType: "mouse",
		});

		expect(layer!.querySelectorAll(".weave-pdf-ink-stroke.selected")).toHaveLength(2);
		expect(layer!.querySelectorAll(".weave-pdf-ink-selection-halo")).toHaveLength(2);
		restoreCanvas();
	});

	it("moves selected ink strokes as one drag group instead of repainting or updating every stroke", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view, adapter } = createPdfView();
		adapter.exists.mockImplementation(async (path: string) =>
			String(path).startsWith("weave/pdf-annotations/")
		);
		adapter.read.mockResolvedValue(
			JSON.stringify({
				version: 1,
				sourcePath: "Books/duboule-page.pdf",
				pageCount: 1,
				strokes: [
					{
						id: "stroke-a",
						pageNumber: 1,
						tool: "pen",
						color: "#111111",
						width: 5,
						points: [
							{ x: 0.1, y: 0.1, t: 1 },
							{ x: 0.22, y: 0.22, t: 2 },
						],
					},
					{
						id: "stroke-b",
						pageNumber: 1,
						tool: "pen",
						color: "#111111",
						width: 5,
						points: [
							{ x: 0.55, y: 0.55, t: 3 },
							{ x: 0.7, y: 0.7, t: 4 },
						],
					},
				],
				textAnnotations: [],
				updatedAt: 1,
			})
		);

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();

		const layer = view.contentEl.querySelector<SVGSVGElement>(
			".weave-pdf-annotation-layer"
		);
		expect(layer).toBeTruthy();
		layer!.getBoundingClientRect = vi.fn(() => ({
			top: 0,
			bottom: 280,
			height: 280,
			left: 0,
			right: 200,
			width: 200,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect));

		view.contentEl.querySelector<HTMLButtonElement>('[data-weave-pdf-tool="stroke-select"]')?.click();
		dispatchPointerEvent(layer!, "pointerdown", { clientX: 10, clientY: 14, pointerType: "mouse" });
		dispatchPointerEvent(layer!, "pointermove", { clientX: 180, clientY: 224, pointerType: "mouse" });
		dispatchPointerEvent(layer!, "pointerup", {
			clientX: 180,
			clientY: 224,
			buttons: 0,
			pointerType: "mouse",
		});
		expect(layer!.querySelectorAll(".weave-pdf-ink-stroke.selected")).toHaveLength(2);

		const replaceChildrenSpy = vi.spyOn(layer!, "replaceChildren");
		const querySelectorAllSpy = vi.spyOn(layer!, "querySelectorAll");
		dispatchPointerEvent(layer!, "pointerdown", { clientX: 20, clientY: 28, pointerType: "mouse" });
		dispatchPointerEvent(layer!, "pointermove", { clientX: 40, clientY: 56, pointerType: "mouse" });
		dispatchPointerEvent(layer!, "pointermove", { clientX: 60, clientY: 84, pointerType: "mouse" });
		dispatchPointerEvent(layer!, "pointermove", { clientX: 80, clientY: 112, pointerType: "mouse" });

		expect(replaceChildrenSpy).not.toHaveBeenCalled();
		expect(querySelectorAllSpy).toHaveBeenCalledTimes(1);
		expect(
			layer!
				.querySelector<SVGGElement>('[data-weave-pdf-ink-drag-group="true"]')
				?.getAttribute("transform")
		).toBe("translate(0.3 0.3)");
		expect(
			layer!
				.querySelector<SVGElement>('.weave-pdf-ink-stroke.selected[data-stroke-id="stroke-a"]')
				?.getAttribute("transform")
		).toBeNull();
		expect(
			layer!
				.querySelector<SVGElement>('.weave-pdf-ink-selection-halo[data-stroke-id="stroke-a"]')
				?.getAttribute("transform")
		).toBeNull();

		dispatchPointerEvent(layer!, "pointerup", {
			clientX: 80,
			clientY: 112,
			buttons: 0,
			pointerType: "mouse",
		});
		expect(replaceChildrenSpy).toHaveBeenCalledTimes(1);
		restoreCanvas();
	});

	it("uses Chinese labels for PDF tool button tooltips", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();

		expect(view.contentEl.querySelector('[title="Select ink"]')).toBeNull();
		expect(view.contentEl.querySelector('[aria-label="Select ink"]')).toBeNull();
		expect(
			view.contentEl
				.querySelector<HTMLButtonElement>('[data-weave-pdf-tool="stroke-select"]')
				?.getAttribute("title")
		).toBe("选择笔迹");
		expect(
			view.contentEl
				.querySelector<HTMLButtonElement>('[data-weave-pdf-action="ink-tools"]')
				?.getAttribute("title")
		).toBe("画笔工具");
		restoreCanvas();
	});

	it("renders a selectable PDF text layer for text selection mode", async () => {
		const restoreCanvas = installCanvasMock();
		const textPage = {
			getViewport: vi.fn(({ scale }: { scale: number }) => ({
				width: 200 * scale,
				height: 280 * scale,
			})),
			render: vi.fn(() => ({ promise: Promise.resolve() })),
			getTextContent: vi.fn(async () => ({
				items: [
					{
						str: "Hello",
						transform: [10, 0, 0, 10, 20, 240],
						width: 32,
						height: 10,
						fontName: "f1",
						dir: "ltr",
					},
					{
						str: "PDF",
						transform: [10, 0, 0, 10, 58, 240],
						width: 24,
						height: 10,
						fontName: "f1",
						dir: "ltr",
					},
				],
				styles: { f1: { ascent: 0.8 } },
			})),
		};
		const pdf = {
			numPages: 1,
			getPage: vi.fn(async () => textPage),
			destroy: vi.fn(),
		};
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();

		const textLayer = view.contentEl.querySelector<HTMLElement>(".weave-pdf-text-layer");
		expect(textLayer).toBeTruthy();
		expect(textLayer?.textContent).toContain("Hello");
		expect(textLayer?.textContent).toContain("PDF");

		view.contentEl.querySelector<HTMLButtonElement>('[data-weave-pdf-tool="select"]')?.click();

		const root = view.contentEl.querySelector<HTMLElement>(".weave-pdf-reader");
		expect(root?.dataset.weavePdfTool).toBe("select");
		restoreCanvas();
	});

	it("selects PDF text by text flow between drag anchors", async () => {
		const restoreCanvas = installCanvasMock();
		const originalClipboard = navigator.clipboard;
		const clipboard = { writeText: vi.fn(async () => undefined) };
		Object.defineProperty(navigator, "clipboard", {
			value: clipboard,
			configurable: true,
		});
		const textPage = {
			getViewport: vi.fn(({ scale }: { scale: number }) => ({
				width: 200 * scale,
				height: 280 * scale,
			})),
			render: vi.fn(() => ({ promise: Promise.resolve() })),
			getTextContent: vi.fn(async () => ({
				items: [
					{ str: "Header", transform: [10, 0, 0, 10, 20, 260], width: 44, height: 10, fontName: "f1", dir: "ltr" },
					{ str: "Line 1 left", transform: [10, 0, 0, 10, 20, 230], width: 70, height: 10, fontName: "f1", dir: "ltr" },
					{ str: "Line 1 right", transform: [10, 0, 0, 10, 112, 230], width: 78, height: 10, fontName: "f1", dir: "ltr" },
					{ str: "Line 2 full", transform: [10, 0, 0, 10, 20, 200], width: 78, height: 10, fontName: "f1", dir: "ltr" },
					{ str: "Line 3 left", transform: [10, 0, 0, 10, 20, 170], width: 70, height: 10, fontName: "f1", dir: "ltr" },
					{ str: "Line 3 right", transform: [10, 0, 0, 10, 112, 170], width: 78, height: 10, fontName: "f1", dir: "ltr" },
				],
				styles: { f1: { ascent: 0.8 } },
			})),
		};
		const pdf = {
			numPages: 1,
			getPage: vi.fn(async () => textPage),
			destroy: vi.fn(),
		};
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		view.contentEl.querySelector<HTMLButtonElement>('[data-weave-pdf-tool="select"]')?.click();

		const textLayer = view.contentEl.querySelector<HTMLElement>(".weave-pdf-text-layer");
		expect(textLayer).toBeTruthy();
		textLayer!.getBoundingClientRect = vi.fn(() => ({
			top: 0,
			bottom: 280,
			height: 280,
			left: 0,
			right: 200,
			width: 200,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect));

		dispatchPointerEvent(textLayer!, "pointerdown", { clientX: 18, clientY: 43, pointerType: "mouse" });
		dispatchPointerEvent(textLayer!, "pointermove", { clientX: 198, clientY: 103, pointerType: "mouse" });
		dispatchPointerEvent(textLayer!, "pointerup", {
			clientX: 198,
			clientY: 103,
			buttons: 0,
			pointerType: "mouse",
		});

		expect(textLayer!.querySelectorAll(".weave-pdf-text-selection-highlight").length).toBeGreaterThan(0);
		view.contentEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true })
		);
		expect(clipboard.writeText).toHaveBeenCalledWith(
			"Line 1 left Line 1 right\nLine 2 full\nLine 3 left Line 3 right"
		);
		expect(clipboard.writeText).not.toHaveBeenCalledWith(expect.stringContaining("Header"));

		Object.defineProperty(navigator, "clipboard", {
			value: originalClipboard,
			configurable: true,
		});
		restoreCanvas();
	});

	it("creates and saves a PDF text highlight from the current text selection", async () => {
		const restoreCanvas = installCanvasMock();
		const textPage = {
			getViewport: vi.fn(({ scale }: { scale: number }) => ({
				width: 200 * scale,
				height: 280 * scale,
			})),
			render: vi.fn(() => ({ promise: Promise.resolve() })),
			getTextContent: vi.fn(async () => ({
				items: [
					{
						str: "Hello",
						transform: [10, 0, 0, 10, 20, 240],
						width: 32,
						height: 10,
						fontName: "f1",
						dir: "ltr",
					},
				],
				styles: { f1: { ascent: 0.8 } },
			})),
		};
		const pdf = {
			numPages: 1,
			getPage: vi.fn(async () => textPage),
			destroy: vi.fn(),
		};
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view, adapter } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		view.contentEl.querySelector<HTMLButtonElement>('[data-weave-pdf-tool="select"]')?.click();

		const textLayer = view.contentEl.querySelector<HTMLElement>(".weave-pdf-text-layer");
		const span = textLayer?.querySelector("span");
		expect(textLayer).toBeTruthy();
		expect(span).toBeTruthy();
		textLayer!.getBoundingClientRect = vi.fn(() => ({
			top: 0,
			bottom: 280,
			height: 280,
			left: 0,
			right: 200,
			width: 200,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect));
		const removeAllRanges = vi.fn();
		vi.spyOn(document, "getSelection").mockReturnValue({
			isCollapsed: false,
			rangeCount: 1,
			toString: () => "Hello",
			removeAllRanges,
			getRangeAt: () => ({
				commonAncestorContainer: span!.firstChild ?? span!,
				getClientRects: () => [
					{
						top: 24,
						bottom: 40,
						height: 16,
						left: 20,
						right: 80,
						width: 60,
						x: 20,
						y: 24,
						toJSON: () => ({}),
					},
				],
			}),
		} as any);

		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="highlight-text"]')
			?.click();

		expect(view.contentEl.querySelector(".weave-pdf-text-annotation")).toBeTruthy();
		expect(removeAllRanges).toHaveBeenCalled();
		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		const [, writtenJson] = adapter.write.mock.calls.at(-1) ?? [];
		const payload = JSON.parse(String(writtenJson || "{}"));
		expect(payload.textAnnotations).toHaveLength(1);
		expect(payload.textAnnotations[0]).toMatchObject({
			pageNumber: 1,
			color: "#ffd54a",
			text: "Hello",
		});
		restoreCanvas();
	});
});
