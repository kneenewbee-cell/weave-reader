import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, Notice, TFile, WorkspaceLeaf, loadPdfJs } from "obsidian";
import { epubActiveDocumentStore } from "../stores/epub-active-document-store";
import { getEpubStorageService } from "../services/epub/epub-storage-access";
import { EPUB_DUAL_WINDOW_ANNOTATION_EVENT } from "../services/epub/epub-dual-window";
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
		const originalToBlob = HTMLCanvasElement.prototype.toBlob;
		HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
			save: vi.fn(),
			restore: vi.fn(),
			beginPath: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			quadraticCurveTo: vi.fn(),
			arc: vi.fn(),
			stroke: vi.fn(),
			fillStyle: "",
			strokeStyle: "",
			globalAlpha: 1,
			lineCap: "round",
			lineJoin: "round",
			lineWidth: 1,
			fillRect: vi.fn(),
			drawImage: vi.fn(),
		})) as any;
		HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,thumb") as any;
		HTMLCanvasElement.prototype.toBlob = vi.fn(
			(callback: BlobCallback, type?: string) => {
				callback(new Blob(["thumb"], { type: type || "image/png" }));
			}
		) as any;
		return () => {
			HTMLCanvasElement.prototype.getContext = originalGetContext;
			HTMLCanvasElement.prototype.toDataURL = originalToDataUrl;
			HTMLCanvasElement.prototype.toBlob = originalToBlob;
		};
	}

	function createPdfView(filePath = "Books/duboule-page.pdf") {
		const storage = createStorageMock();
		const app = new App();
		const file = new TFile(filePath);
		const files = new Map<string, string>();
		const createdFiles = new Map<string, TFile>();
		const noteLeaf = new WorkspaceLeaf(app);
		const adapter = {
			exists: vi.fn(async (path: string) => files.has(String(path))),
			read: vi.fn(async (path: string) => files.get(String(path)) ?? ""),
			write: vi.fn(async (path: string, data: string) => {
				files.set(String(path), String(data));
			}),
			writeBinary: vi.fn(async () => undefined),
			mkdir: vi.fn(async () => undefined),
		};
		(app.vault as any).adapter = adapter;
		(app.vault as any).getConfig = vi.fn(() => "");
		app.vault.getAbstractFileByPath = vi.fn((path: string) => {
			if (path === filePath) {
				return file;
			}
			const createdFile = createdFiles.get(path);
			if (createdFile) {
				return createdFile;
			}
			if (files.has(path) && path.endsWith(".md")) {
				const markdownFile = new TFile(path);
				createdFiles.set(path, markdownFile);
				return markdownFile;
			}
			return null;
		}) as any;
		app.vault.create = vi.fn(async (path: string, data: string) => {
			files.set(String(path), String(data));
			const createdFile = new TFile(path);
			createdFiles.set(path, createdFile);
			return createdFile;
		}) as any;
		app.vault.modify = vi.fn(async (targetFile: TFile, data: string) => {
			files.set(targetFile.path, String(data));
		}) as any;
		app.vault.getResourcePath = vi.fn(() => "app://vault/pdf") as any;
		app.vault.readBinary = vi.fn(async () => new ArrayBuffer(8)) as any;
		app.workspace.activeLeaf = null;
		app.workspace.on = vi.fn(() => ({ event: "active-leaf-change" }));
		app.workspace.getLeaf = vi.fn(() => noteLeaf) as any;

		const leaf = new WorkspaceLeaf(app);
		const view = new PdfView(leaf as any);
		leaf.view = view;
		app.workspace.activeLeaf = leaf;
		(view as any).filePath = filePath;
		return { app, leaf, view, storage, adapter, files, noteLeaf };
	}

	function getLastWrittenJson(
		adapter: ReturnType<typeof createPdfView>["adapter"],
		matchesPath: (path: string) => boolean
	) {
		const call = [...adapter.write.mock.calls]
			.reverse()
			.find(([path]) => matchesPath(String(path)));
		expect(call).toBeTruthy();
		const [path, json] = call ?? ["", "{}"];
		return {
			path: String(path),
			payload: JSON.parse(String(json || "{}")),
		};
	}

	function getLastPdfTextAnnotationsPayload(
		adapter: ReturnType<typeof createPdfView>["adapter"]
	) {
		return getLastWrittenJson(
			adapter,
			(path) => path.startsWith("weave/pdf-data/books/") && path.endsWith("/annotations.json")
		);
	}

	function getLastPdfInkAnnotationsPayload(
		adapter: ReturnType<typeof createPdfView>["adapter"]
	) {
		return getLastWrittenJson(
			adapter,
			(path) => path.startsWith("weave/pdf-data/books/") && path.endsWith("/ink.json")
		);
	}

	function getLastPdfAnnotationMarkdown(files: ReturnType<typeof createPdfView>["files"]) {
		const entry = [...files.entries()]
			.reverse()
			.find(([path]) => path.startsWith("weave/pdf-data/books/") && path.endsWith("/annotations.md"));
		expect(entry).toBeTruthy();
		const [path, markdown] = entry ?? ["", ""];
		return { path, markdown };
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

	function createSingleTextPdf(text = "Hello") {
		const textPage = {
			getViewport: vi.fn(({ scale }: { scale: number }) => ({
				width: 200 * scale,
				height: 280 * scale,
			})),
			render: vi.fn(() => ({ promise: Promise.resolve() })),
			getTextContent: vi.fn(async () => ({
				items: [
					{
						str: text,
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
		return {
			numPages: 1,
			getPage: vi.fn(async () => textPage),
			destroy: vi.fn(),
		};
	}

	function applyPdfSemanticPluginSettings(
		app: App,
		overrides: Record<string, unknown> = {}
	) {
		const settings = {
			readerUiMode: "expert",
			expertModeEnabled: true,
			annotationSemanticsEnabled: true,
			semanticSchemeId: "test",
			expertSemanticLimit: 3,
			standardSemanticIds: ["definition", "quote", "theme"],
			annotationSemantics: [
				{
					id: "definition",
					label: "瀹氫箟",
					color: "blue",
					style: "underline",
					group: "study",
					description: "",
					active: true,
				},
				{
					id: "quote",
					label: "寮曠敤",
					color: "teal",
					style: "highlight",
					group: "study",
					description: "",
					active: true,
				},
				{
					id: "question",
					label: "鐤戦棶",
					color: "purple",
					style: "wavy",
					group: "study",
					description: "",
					active: true,
				},
				{
					id: "mask",
					label: "遮盖",
					color: "orange",
					style: "strikethrough",
					group: "study",
					description: "",
					active: true,
				},
			],
			...overrides,
		};
		(app as any).plugins = {
			getPlugin: vi.fn((pluginId: string) =>
				pluginId === "weave-reader" ? { settings } : null
			),
		};
		return settings;
	}

	async function selectSinglePdfText(view: PdfView) {
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
		dispatchPointerEvent(textLayer!, "pointerdown", { clientX: 20, clientY: 30, pointerType: "mouse" });
		dispatchPointerEvent(textLayer!, "pointermove", { clientX: 52, clientY: 35, pointerType: "mouse" });
		dispatchPointerEvent(textLayer!, "pointerup", {
			clientX: 52,
			clientY: 35,
			buttons: 0,
			pointerType: "mouse",
		});
		return textLayer!;
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
		const { payload } = getLastPdfInkAnnotationsPayload(adapter);
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
		const { payload } = getLastPdfInkAnnotationsPayload(adapter);
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
		const { payload } = getLastPdfInkAnnotationsPayload(adapter);
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
		const { payload } = getLastPdfInkAnnotationsPayload(adapter);
		expect(payload.strokes).toHaveLength(2);
		expect(payload.strokes[0].id).not.toBe(payload.strokes[1].id);
		restoreCanvas();
	});

	it("keeps a capture selection and copies it as a real clipboard image", async () => {
		const restoreCanvas = installCanvasMock();
		const originalClipboard = navigator.clipboard;
		const originalClipboardItem = (globalThis as any).ClipboardItem;
		const clipboardItem = vi.fn((items: Record<string, Blob>) => ({ items }));
		const clipboard = {
			write: vi.fn(async () => undefined),
			writeText: vi.fn(async () => undefined),
		};
		Object.defineProperty(navigator, "clipboard", {
			value: clipboard,
			configurable: true,
		});
		Object.defineProperty(globalThis, "ClipboardItem", {
			value: clipboardItem,
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
		expect(view.contentEl.querySelector(".weave-pdf-capture-action-bar")).toBeTruthy();
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="copy-capture-image"]')
			?.click();

		await vi.waitFor(() => {
			expect(clipboard.write).toHaveBeenCalledTimes(1);
		});
		expect(clipboard.writeText).not.toHaveBeenCalledWith("data:image/png;base64,thumb");
		expect(clipboardItem).toHaveBeenCalledWith({
			"image/png": expect.any(Blob),
		});
		Object.defineProperty(navigator, "clipboard", {
			value: originalClipboard,
			configurable: true,
		});
		Object.defineProperty(globalThis, "ClipboardItem", {
			value: originalClipboardItem,
			configurable: true,
		});
		restoreCanvas();
	});

	it("saves a capture selection to the attachment folder and copies its embed link", async () => {
		const restoreCanvas = installCanvasMock();
		const originalClipboard = navigator.clipboard;
		const clipboard = {
			writeText: vi.fn(async () => undefined),
		};
		Object.defineProperty(navigator, "clipboard", {
			value: clipboard,
			configurable: true,
		});
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { app, view, adapter } = createPdfView();
		(app.vault as any).getConfig = vi.fn((key: string) =>
			key === "attachmentFolderPath" ? "Attachments/screens" : ""
		);

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

		const saveButton = view.contentEl.querySelector<HTMLButtonElement>(
			'[data-weave-pdf-action="save-capture-image"]'
		);
		expect(saveButton).toBeTruthy();
		saveButton?.click();

		await vi.waitFor(() => {
			expect(adapter.writeBinary).toHaveBeenCalled();
		});
		expect(adapter.mkdir).toHaveBeenCalledWith("Attachments");
		expect(adapter.mkdir).toHaveBeenCalledWith("Attachments/screens");
		const [imagePath, imageBytes] = adapter.writeBinary.mock.calls[0] ?? [];
		expect(imagePath).toMatch(/^Attachments\/screens\/pdf-duboule-page-p1-\d{8}-\d{6}\.png$/);
		expect(imageBytes).toBeInstanceOf(ArrayBuffer);
		expect(clipboard.writeText).toHaveBeenCalledWith(`![[${imagePath}]]`);
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
		expect(view.contentEl.querySelector(".weave-pdf-capture-action-bar")).toBeTruthy();

		view.contentEl.querySelector<HTMLButtonElement>('[data-weave-pdf-tool="pan"]')?.click();

		expect(layer!.querySelector(".weave-pdf-capture-box")).toBeNull();
		expect(view.contentEl.querySelector(".weave-pdf-capture-action-bar")).toBeNull();
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

	it("uses Chinese aria labels without native PDF tool button titles", async () => {
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
		).toBeNull();
		expect(
			view.contentEl
				.querySelector<HTMLButtonElement>('[data-weave-pdf-tool="stroke-select"]')
				?.getAttribute("aria-label")
		).toBe("选择笔迹");
		expect(
			view.contentEl
				.querySelector<HTMLButtonElement>('[data-weave-pdf-action="ink-tools"]')
				?.getAttribute("title")
		).toBeNull();
		expect(
			view.contentEl
				.querySelector<HTMLButtonElement>('[data-weave-pdf-action="ink-tools"]')
				?.getAttribute("aria-label")
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
		const { app, view } = createPdfView();
		applyPdfSemanticPluginSettings(app);

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
		const actionBar = view.contentEl.querySelector(".weave-pdf-text-action-bar");
		expect(actionBar).toBeTruthy();
		expect(actionBar).toHaveClass("epub-selection-toolbar", "visible");
		expect(actionBar?.hasAttribute("aria-label")).toBe(false);
		expect(actionBar?.querySelector(".selection-main-row")).toBeTruthy();
		expect(actionBar?.querySelector(".selection-actions-shell")).toBeTruthy();
		expect(actionBar?.querySelector(".weave-epub-expert-semantic-row")).toBeTruthy();
		expect(actionBar?.querySelector(".selection-actions-row")).toBeTruthy();
		expect(actionBar?.querySelector(".toolbar-arrow")).toBeTruthy();
		expect(
			actionBar?.querySelector(".weave-epub-expert-semantic-row")?.hasAttribute("aria-label")
		).toBe(false);
		const semanticButtons = Array.from(
			actionBar!.querySelectorAll<HTMLElement>('[data-weave-pdf-action="semantic-text-selection"]')
		);
		expect(semanticButtons.map((button) => button.getAttribute("data-semantic-id"))).toEqual([
			"definition",
			"quote",
			"question",
			"other",
		]);
		expect(semanticButtons.map((button) => button.getAttribute("data-semantic-style"))).toEqual([
			"underline",
			"highlight",
			"wavy",
			"wavy",
		]);
		expect(semanticButtons.map((button) => button.style.getPropertyValue("--weave-semantic-color"))).toEqual([
			"#0EA5E9",
			"#14B8A6",
			"#8B5CF6",
			"#111827",
		]);
		for (const button of semanticButtons) {
			expect(button).toHaveClass("action-item", "weave-epub-semantic-chip");
			expect(button.hasAttribute("title")).toBe(false);
			expect(button.getAttribute("aria-label")).toBeTruthy();
			expect(button.querySelector(".action-icon.weave-epub-semantic-dot")).toBeTruthy();
			expect(button.querySelector(".action-label.weave-epub-semantic-label")).toBeTruthy();
		}
		const noteAction = actionBar!.querySelector<HTMLElement>('[data-weave-pdf-action="note-text-selection"]');
		const cancelAction = actionBar!.querySelector<HTMLElement>('[data-weave-pdf-action="cancel-text-selection"]');
		expect(noteAction).toHaveTextContent("想法");
		expect(noteAction?.hasAttribute("title")).toBe(false);
		expect(noteAction?.getAttribute("aria-label")).toBe("想法");
		expect(cancelAction).toHaveTextContent("取消");
		expect(cancelAction?.hasAttribute("title")).toBe(false);
		expect(cancelAction?.getAttribute("aria-label")).toBe("取消");
		expect(
			view.contentEl.querySelector('[data-weave-pdf-action="copy-text-selection"]')
		).toBeNull();
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

	it("uses the EPUB dark floating panel colors for the PDF semantic text toolbar", () => {
		const css = readFileSync("src/styles/pdf/pdf-reader.css", "utf8");
		const source = readFileSync("src/views/PdfView.ts", "utf8");
		expect(css).toContain(
			".weave-pdf-text-action-bar.epub-selection-toolbar .selection-actions-shell"
		);
		expect(css).toContain("background: rgba(15, 23, 42, 0.92);");
		expect(css).toContain("border: 1px solid rgba(255, 255, 255, 0.06);");
		expect(css).toContain("border-top: 6px solid rgba(15, 23, 42, 0.92);");
		expect(css).toContain("border-bottom: 6px solid rgba(15, 23, 42, 0.92);");
		expect(css).toContain(
			".weave-pdf-text-action-bar.epub-selection-toolbar .weave-pdf-text-action-button.action-item"
		);
		expect(css).toContain("color: rgba(248, 250, 252, 0.86);");
		expect(css).toContain("color: rgba(255, 255, 255, 0.98);");
		expect(source).not.toContain('"aria-label": "璇箟鏍囨敞"');
		expect(source).not.toContain('"aria-label": "鏂囨湰鏍囨敞鎿嶄綔"');
	});

	it("creates and saves a PDF text highlight from the floating text menu", async () => {
		const restoreCanvas = installCanvasMock();
		const pdf = createSingleTextPdf();
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { app, view, adapter } = createPdfView();
		applyPdfSemanticPluginSettings(app);

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		await selectSinglePdfText(view);

		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="semantic-text-selection"][data-semantic-id="quote"]')
			?.click();

		expect(view.contentEl.querySelector(".weave-pdf-text-annotation")).toBeTruthy();
		expect(
			view.contentEl.querySelector(".weave-pdf-text-annotation")?.getAttribute("data-semantic-id")
		).toBe("quote");
		expect(view.contentEl.querySelector(".weave-pdf-text-action-bar")).toBeNull();
		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		const { path, payload } = getLastPdfTextAnnotationsPayload(adapter);
		expect(path).toMatch(/^weave\/pdf-data\/books\/pdf-book-[a-z0-9]+\/annotations\.json$/);
		expect(payload.annotations).toHaveLength(1);
		expect(payload.annotations[0]).toMatchObject({
			pageNumber: 1,
			color: "#14B8A6",
			text: "Hello",
			kind: "highlight",
			semanticId: "quote",
			semanticLabel: "寮曠敤",
			semanticStyle: "highlight",
		});
		restoreCanvas();
	});

	it("undoes and redoes a newly created PDF text annotation from the tools rail", async () => {
		const restoreCanvas = installCanvasMock();
		const pdf = createSingleTextPdf();
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { app, view, adapter } = createPdfView();
		applyPdfSemanticPluginSettings(app);

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		await selectSinglePdfText(view);
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="semantic-text-selection"][data-semantic-id="quote"]')
			?.click();

		await vi.waitFor(() => {
			expect(view.contentEl.querySelectorAll(".weave-pdf-text-annotation")).toHaveLength(1);
		});
		const undoButton = view.contentEl.querySelector<HTMLButtonElement>(
			'[data-weave-pdf-action="undo-annotation"]'
		);
		const redoButton = view.contentEl.querySelector<HTMLButtonElement>(
			'[data-weave-pdf-action="redo-annotation"]'
		);
		expect(undoButton).toBeTruthy();
		expect(redoButton).toBeTruthy();
		expect(undoButton!.disabled).toBe(false);
		expect(redoButton!.disabled).toBe(true);

		adapter.write.mockClear();
		undoButton!.click();

		await vi.waitFor(() => {
			expect(view.contentEl.querySelectorAll(".weave-pdf-text-annotation")).toHaveLength(0);
		});
		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		expect(undoButton!.disabled).toBe(true);
		expect(redoButton!.disabled).toBe(false);
		const undoPayload = getLastPdfTextAnnotationsPayload(adapter).payload;
		expect(undoPayload.annotations).toHaveLength(0);

		adapter.write.mockClear();
		redoButton!.click();

		await vi.waitFor(() => {
			expect(view.contentEl.querySelectorAll(".weave-pdf-text-annotation")).toHaveLength(1);
		});
		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		expect(undoButton!.disabled).toBe(false);
		expect(redoButton!.disabled).toBe(true);
		const redoPayload = getLastPdfTextAnnotationsPayload(adapter).payload;
		expect(redoPayload.annotations).toHaveLength(1);
		expect(redoPayload.annotations[0]).toMatchObject({
			text: "Hello",
			semanticId: "quote",
		});
		restoreCanvas();
	});

	it("writes and opens the PDF annotation markdown note from the tools rail", async () => {
		const restoreCanvas = installCanvasMock();
		const pdf = createSingleTextPdf();
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { app, view, files, noteLeaf } = createPdfView();
		applyPdfSemanticPluginSettings(app);

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		await selectSinglePdfText(view);
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="semantic-text-selection"][data-semantic-id="quote"]')
			?.click();
		await vi.waitFor(() => {
			expect(files.size).toBeGreaterThan(0);
		});

		const button = view.contentEl.querySelector<HTMLButtonElement>(
			'[data-weave-pdf-action="open-annotation-note"]'
		);
		expect(button).toBeTruthy();
		expect(button?.getAttribute("aria-label")).toBe("\u6807\u6ce8\u7b14\u8bb0");
		button?.click();

		await vi.waitFor(() => {
			expect(noteLeaf.openFile).toHaveBeenCalled();
		});
		const { path, markdown } = getLastPdfAnnotationMarkdown(files);
		expect(path).toMatch(/^weave\/pdf-data\/books\/pdf-book-[a-z0-9]+\/annotations\.md$/);
		expect(markdown).toContain("# duboule-page - PDF \u6807\u6ce8\u7b14\u8bb0");
		expect(markdown).toContain("Hello");
		expect(markdown).toContain('data-annotation-id="');
		expect(markdown).toContain('data-page-number="1"');
		expect(noteLeaf.openFile).toHaveBeenCalledWith(
			expect.objectContaining({ path }),
			{ active: true, state: { mode: "preview" } }
		);
		restoreCanvas();
	});

	it("syncs PDF text annotations for the sidebar and navigates to a selected annotation", async () => {
		const restoreCanvas = installCanvasMock();
		const pdf = createSingleTextPdf();
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { app, view } = createPdfView();
		applyPdfSemanticPluginSettings(app);

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		await selectSinglePdfText(view);

		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="semantic-text-selection"][data-semantic-id="quote"]')
			?.click();

		const state = epubActiveDocumentStore.getSharedState() as any;
		expect(state.pdf?.annotations).toHaveLength(1);
		expect(state.pdf.annotations[0]).toMatchObject({
			pageNumber: 1,
			kind: "highlight",
			text: "Hello",
			semanticId: "quote",
			semanticLabel: "寮曠敤",
			color: "#14B8A6",
		});
		expect(state.pdf.annotationCount).toBe(1);
		expect(state.pdf.onNavigateAnnotation).toEqual(expect.any(Function));

		state.pdf.onNavigateAnnotation(state.pdf.annotations[0].id);

		const annotationEl = view.contentEl.querySelector<HTMLElement>(".weave-pdf-text-annotation");
		expect(annotationEl).toBeTruthy();
		expect(annotationEl).not.toHaveClass("is-focused");
		const focusFrame = view.contentEl.querySelector<HTMLElement>(".weave-pdf-text-annotation-focus");
		expect(focusFrame).toBeTruthy();
		expect(focusFrame?.dataset.annotationId).toBe(state.pdf.annotations[0].id);
		restoreCanvas();
	});

	it("opens an EPUB-style edit toolbar for an existing PDF text annotation and changes its semantic", async () => {
		const restoreCanvas = installCanvasMock();
		const pdf = createSingleTextPdf();
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { app, view, adapter } = createPdfView();
		applyPdfSemanticPluginSettings(app);

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		await selectSinglePdfText(view);
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="semantic-text-selection"][data-semantic-id="quote"]')
			?.click();
		await vi.waitFor(() => {
			expect(view.contentEl.querySelectorAll(".weave-pdf-text-annotation")).toHaveLength(1);
		});
		adapter.write.mockClear();

		view.contentEl.querySelector<HTMLElement>(".weave-pdf-text-annotation")?.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true })
		);

		const editBar = view.contentEl.querySelector<HTMLElement>(".weave-pdf-text-action-bar");
		expect(editBar).toBeTruthy();
		expect(editBar?.dataset.editingAnnotationId).toBeTruthy();
		expect(view.contentEl.querySelector(".weave-pdf-text-annotation.is-editing")).toBeNull();
		expect(editBar?.querySelector('[data-weave-pdf-action="delete-text-annotation"]')).toBeTruthy();
		expect(
			editBar?.querySelector('[data-weave-pdf-action="semantic-text-annotation"][data-semantic-id="quote"]')
		).toHaveClass("is-active");

		editBar
			?.querySelector<HTMLButtonElement>('[data-weave-pdf-action="semantic-text-annotation"][data-semantic-id="definition"]')
			?.click();

		await vi.waitFor(() => {
			expect(view.contentEl.querySelector(".weave-pdf-text-annotation--underline")).toBeTruthy();
		});
		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		const { payload } = getLastPdfTextAnnotationsPayload(adapter);
		expect(payload.annotations).toHaveLength(1);
		expect(payload.annotations[0]).toMatchObject({
			text: "Hello",
			kind: "underline",
			color: "#0EA5E9",
			semanticId: "definition",
			semanticStyle: "underline",
		});
		restoreCanvas();
	});

	it("edits and deletes an existing PDF text annotation from the edit toolbar", async () => {
		const restoreCanvas = installCanvasMock();
		const pdf = createSingleTextPdf();
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { app, view, adapter } = createPdfView();
		applyPdfSemanticPluginSettings(app);

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		await selectSinglePdfText(view);
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="semantic-text-selection"][data-semantic-id="quote"]')
			?.click();
		await vi.waitFor(() => {
			expect(view.contentEl.querySelectorAll(".weave-pdf-text-annotation")).toHaveLength(1);
		});
		adapter.write.mockClear();

		view.contentEl.querySelector<HTMLElement>(".weave-pdf-text-annotation")?.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true })
		);
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="note-text-annotation"]')
			?.click();
		const noteInput = view.contentEl.querySelector<HTMLTextAreaElement>(".weave-pdf-text-note-input");
		expect(noteInput).toBeTruthy();
		noteInput!.value = "补充想法";
		noteInput!.dispatchEvent(new Event("input", { bubbles: true }));
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="save-text-annotation-note"]')
			?.click();

		await vi.waitFor(() => {
			expect(getLastPdfTextAnnotationsPayload(adapter).payload.annotations[0].note).toBe("补充想法");
		});
		adapter.write.mockClear();

		view.contentEl.querySelector<HTMLElement>(".weave-pdf-text-annotation")?.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true })
		);
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="delete-text-annotation"]')
			?.click();

		await vi.waitFor(() => {
			expect(view.contentEl.querySelectorAll(".weave-pdf-text-annotation")).toHaveLength(0);
		});
		await vi.waitFor(() => {
			expect(getLastPdfTextAnnotationsPayload(adapter).payload.annotations).toHaveLength(0);
		});
		expect(
			view.contentEl.querySelector<HTMLButtonElement>('[data-weave-pdf-action="undo-annotation"]')?.disabled
		).toBe(false);
		restoreCanvas();
	});

	it("navigates to a PDF text annotation when annotationId is provided in the view state", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view, adapter } = createPdfView();
		adapter.exists.mockImplementation(async (path: string) =>
			String(path).endsWith("/annotations.json")
		);
		adapter.read.mockResolvedValue(
			JSON.stringify({
				format: "weave-reader-pdf-annotations/v1",
				version: 1,
				bookId: "pdf-book-demo",
				sourcePath: "Books/duboule-page.pdf",
				pageCount: 1,
				annotations: [
					{
						id: "loaded-pdf-annotation",
						pageNumber: 1,
						kind: "highlight",
						color: "#14B8A6",
						text: "Loaded annotation",
						rects: [{ x: 0.1, y: 0.2, width: 0.25, height: 0.05 }],
						createdAt: 1,
					},
				],
				updatedAt: 1,
			})
		);

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		expect(view.contentEl.querySelector(".weave-pdf-text-annotation-focus")).toBeNull();

		await view.setState(
			{
				filePath: "Books/duboule-page.pdf",
				annotationId: "loaded-pdf-annotation",
				pageNumber: 1,
			},
			null
		);

		const focusFrame = view.contentEl.querySelector<HTMLElement>(".weave-pdf-text-annotation-focus");
		expect(focusFrame).toBeTruthy();
		expect(focusFrame?.dataset.annotationId).toBe("loaded-pdf-annotation");
		restoreCanvas();
	});

	it("focuses the matching PDF annotation from dual-window note events", async () => {
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view, adapter } = createPdfView();
		adapter.exists.mockImplementation(async (path: string) =>
			String(path).endsWith("/annotations.json")
		);
		adapter.read.mockResolvedValue(
			JSON.stringify({
				format: "weave-reader-pdf-annotations/v1",
				version: 1,
				bookId: "pdf-book-demo",
				sourcePath: "Books/duboule-page.pdf",
				pageCount: 1,
				annotations: [
					{
						id: "loaded-pdf-annotation",
						pageNumber: 1,
						kind: "highlight",
						color: "#14B8A6",
						text: "Loaded annotation",
						rects: [{ x: 0.1, y: 0.2, width: 0.25, height: 0.05 }],
						createdAt: 1,
					},
				],
				updatedAt: 1,
			})
		);

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();

		window.dispatchEvent(
			new CustomEvent(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, {
				detail: {
					mode: "book-annotation-note",
					phase: "enter",
					bookId: "pdf-book-demo",
					filePath: "Books/duboule-page.pdf",
					pageNumber: 1,
					annotationId: "loaded-pdf-annotation",
				},
			})
		);

		const focusFrame = view.contentEl.querySelector<HTMLElement>(".weave-pdf-text-annotation-focus");
		expect(focusFrame).toBeTruthy();
		expect(focusFrame?.dataset.annotationId).toBe("loaded-pdf-annotation");
		restoreCanvas();
	});

	it("shows a lightweight notice after clicking a PDF annotation note line in dual-window mode", async () => {
		const noticeMessages = (Notice as unknown as { messages: string[] }).messages;
		noticeMessages.length = 0;
		const restoreCanvas = installCanvasMock();
		const { pdf } = createMockPdfDocument(1);
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view, adapter } = createPdfView();
		adapter.exists.mockImplementation(async (path: string) =>
			String(path).endsWith("/annotations.json")
		);
		adapter.read.mockResolvedValue(
			JSON.stringify({
				format: "weave-reader-pdf-annotations/v1",
				version: 1,
				bookId: "pdf-book-demo",
				sourcePath: "Books/duboule-page.pdf",
				pageCount: 1,
				annotations: [
					{
						id: "loaded-pdf-annotation",
						pageNumber: 1,
						kind: "highlight",
						color: "#14B8A6",
						text: "Loaded annotation",
						rects: [{ x: 0.1, y: 0.2, width: 0.25, height: 0.05 }],
						createdAt: 1,
					},
				],
				updatedAt: 1,
			})
		);

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();

		window.dispatchEvent(
			new CustomEvent(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, {
				detail: {
					mode: "book-annotation-note",
					phase: "enter",
					bookId: "pdf-book-demo",
					filePath: "Books/duboule-page.pdf",
					pageNumber: 1,
					annotationId: "loaded-pdf-annotation",
				},
			})
		);
		expect(noticeMessages).toEqual([]);

		window.dispatchEvent(
			new CustomEvent(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, {
				detail: {
					mode: "book-annotation-note",
					phase: "click",
					bookId: "pdf-book-demo",
					filePath: "Books/duboule-page.pdf",
					pageNumber: 1,
					annotationId: "loaded-pdf-annotation",
				},
			})
		);

		expect(noticeMessages).toContain("已跳转到第 1 页");
		restoreCanvas();
	});

	it("shows one combined focus frame when navigating to a multi-rect PDF text annotation", async () => {
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
				strokes: [],
				textAnnotations: [
					{
						id: "multi-line-annotation",
						pageNumber: 1,
						kind: "highlight",
						color: "#8B5CF6",
						text: "video-note-producer Video Note Skill",
						rects: [
							{ x: 0.1, y: 0.12, width: 0.72, height: 0.05 },
							{ x: 0.1, y: 0.18, width: 0.48, height: 0.05 },
						],
						createdAt: 1,
					},
				],
				updatedAt: 1,
			})
		);

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();

		const state = epubActiveDocumentStore.getSharedState() as any;
		expect(state.pdf?.annotations).toHaveLength(1);
		await vi.waitFor(() => {
			const { payload } = getLastPdfTextAnnotationsPayload(adapter);
			expect(payload.annotations.map((annotation: any) => annotation.id)).toEqual([
				"multi-line-annotation",
			]);
		});
		state.pdf.onNavigateAnnotation("multi-line-annotation");

		const focusFrames = view.contentEl.querySelectorAll(".weave-pdf-text-annotation-focus");
		expect(focusFrames).toHaveLength(1);
		expect(view.contentEl.querySelectorAll(".weave-pdf-text-annotation.is-focused")).toHaveLength(0);
		const focusFrame = focusFrames[0] as HTMLElement;
		expect(focusFrame.style.left).toBe("9%");
		expect(focusFrame.style.top).toBe("11%");
		expect(focusFrame.style.width).toBe("74%");
		expect(focusFrame.style.height).toBe("13%");
		restoreCanvas();
	});

	it("creates and saves a PDF text underline from the floating text menu", async () => {
		const restoreCanvas = installCanvasMock();
		const pdf = createSingleTextPdf();
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { app, view, adapter } = createPdfView();
		applyPdfSemanticPluginSettings(app);

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		await selectSinglePdfText(view);

		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="semantic-text-selection"][data-semantic-id="definition"]')
			?.click();

		expect(view.contentEl.querySelector(".weave-pdf-text-annotation--underline")).toBeTruthy();
		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		const { payload } = getLastPdfTextAnnotationsPayload(adapter);
		expect(payload.annotations[0]).toMatchObject({
			pageNumber: 1,
			text: "Hello",
			kind: "underline",
			color: "#0EA5E9",
			semanticId: "definition",
			semanticLabel: "瀹氫箟",
			semanticStyle: "underline",
		});
		restoreCanvas();
	});

	it("creates and saves PDF text semantic wavy and strikethrough marks", async () => {
		const restoreCanvas = installCanvasMock();
		const pdf = createSingleTextPdf();
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { app, view, adapter } = createPdfView();
		applyPdfSemanticPluginSettings(app, { expertSemanticLimit: "all" });

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		await selectSinglePdfText(view);
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="semantic-text-selection"][data-semantic-id="question"]')
			?.click();
		await selectSinglePdfText(view);
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="semantic-text-selection"][data-semantic-id="mask"]')
			?.click();

		expect(view.contentEl.querySelector(".weave-pdf-text-annotation--wavy")).toBeTruthy();
		expect(view.contentEl.querySelector(".weave-pdf-text-annotation--strikethrough")).toBeTruthy();
		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		const { payload } = getLastPdfTextAnnotationsPayload(adapter);
		expect(payload.annotations.map((annotation: any) => annotation.kind)).toEqual([
			"wavy",
			"strikethrough",
		]);
		expect(payload.annotations[0]).toMatchObject({
			color: "#8B5CF6",
			semanticId: "question",
			semanticLabel: "鐤戦棶",
			semanticStyle: "wavy",
		});
		expect(payload.annotations[1]).toMatchObject({
			color: "#F97316",
			semanticId: "mask",
			semanticLabel: "遮盖",
			semanticStyle: "strikethrough",
		});
		restoreCanvas();
	});

	it("creates and saves a PDF text note from the floating text menu", async () => {
		const restoreCanvas = installCanvasMock();
		const pdf = createSingleTextPdf();
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { view, adapter } = createPdfView();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		await selectSinglePdfText(view);

		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="note-text-selection"]')
			?.click();
		const noteInput = view.contentEl.querySelector<HTMLTextAreaElement>(".weave-pdf-text-note-input");
		expect(noteInput).toBeTruthy();
		noteInput!.value = "需要回看";
		noteInput!.dispatchEvent(new Event("input", { bubbles: true }));
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="save-text-note"]')
			?.click();

		expect(view.contentEl.querySelector(".weave-pdf-text-annotation--note")).toBeTruthy();
		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		const { payload } = getLastPdfTextAnnotationsPayload(adapter);
		expect(payload.annotations[0]).toMatchObject({
			pageNumber: 1,
			text: "Hello",
			kind: "note",
			note: "需要回看",
		});
		restoreCanvas();
	});

	it("merges a PDF text note into a later semantic annotation on the same selection", async () => {
		const restoreCanvas = installCanvasMock();
		const pdf = createSingleTextPdf();
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { app, view, adapter, files } = createPdfView();
		applyPdfSemanticPluginSettings(app);

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		await selectSinglePdfText(view);
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="note-text-selection"]')
			?.click();
		const noteInput = view.contentEl.querySelector<HTMLTextAreaElement>(".weave-pdf-text-note-input");
		expect(noteInput).toBeTruthy();
		noteInput!.value = "先写的想法";
		noteInput!.dispatchEvent(new Event("input", { bubbles: true }));
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="save-text-note"]')
			?.click();
		await vi.waitFor(() => {
			expect(getLastPdfTextAnnotationsPayload(adapter).payload.annotations).toHaveLength(1);
		});
		adapter.write.mockClear();

		await selectSinglePdfText(view);
		view.contentEl
			.querySelector<HTMLButtonElement>('[data-weave-pdf-action="semantic-text-selection"][data-semantic-id="quote"]')
			?.click();

		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		const { payload } = getLastPdfTextAnnotationsPayload(adapter);
		expect(payload.annotations).toHaveLength(1);
		expect(payload.annotations[0]).toMatchObject({
			text: "Hello",
			kind: "highlight",
			note: "先写的想法",
			semanticId: "quote",
			semanticStyle: "highlight",
		});
		const { markdown } = getLastPdfAnnotationMarkdown(files);
		expect(markdown.match(/weave-pdf-annotation-note-line/g)).toHaveLength(1);
		expect(markdown).toContain("先写的想法");
		restoreCanvas();
	});

	it("does not merge a shifted PDF text note selection into a later semantic annotation", async () => {
		const restoreCanvas = installCanvasMock();
		const pdf = createSingleTextPdf("Repeated text");
		vi.mocked(loadPdfJs).mockResolvedValue({
			getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
		} as any);
		const { app, view, adapter } = createPdfView();
		const settings = applyPdfSemanticPluginSettings(app);
		const quoteSemantic = settings.annotationSemantics.find((semantic) => semantic.id === "quote");
		expect(quoteSemantic).toBeTruthy();

		await view.onOpen();
		await Promise.resolve();
		await Promise.resolve();
		(view as any).selectedPdfTextSelection = {
			pageNumber: 1,
			text: "Repeated text",
			rects: [{ x: 0.1, y: 0.2, width: 0.7, height: 0.04 }],
		};
		(view as any).createTextAnnotationFromSelection("note", "偏移前的想法");
		await vi.waitFor(() => {
			expect(getLastPdfTextAnnotationsPayload(adapter).payload.annotations).toHaveLength(1);
		});
		adapter.write.mockClear();

		(view as any).selectedPdfTextSelection = {
			pageNumber: 1,
			text: "Repeated text",
			rects: [{ x: 0.14, y: 0.2, width: 0.7, height: 0.04 }],
		};
		(view as any).createTextAnnotationFromSelection("highlight", "", quoteSemantic);

		await vi.waitFor(() => {
			expect(adapter.write).toHaveBeenCalled();
		});
		const { payload } = getLastPdfTextAnnotationsPayload(adapter);
		expect(payload.annotations).toHaveLength(2);
		expect(payload.annotations.map((annotation: any) => annotation.kind)).toEqual(["note", "highlight"]);
		restoreCanvas();
	});
});
