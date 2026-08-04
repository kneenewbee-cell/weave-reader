import { beforeEach, describe, expect, it, vi } from "vitest";
import { Vault } from "obsidian";
import { getReaderHighlightIdentityKey } from "../highlight/highlight-identity";
import {
	buildAnnotationRenderSignature,
	createReaderFoliateAnnotation,
	createRenderedFoliateAnnotation,
	isSameFoliateAnnotation,
} from "../reader-annotation-model";
import { ReaderAnnotationOverlayRenderer } from "../reader-annotation-overlayer";
import { FoliateReaderService } from "../FoliateReaderService";

vi.mock("obsidian", async () => {
	const actual = await vi.importActual<typeof import("obsidian")>("obsidian");

	class MockTFile {
		path: string;
		basename: string;
		extension: string;

		constructor(path: string) {
			this.path = path;
			const parts = path.split("/");
			const name = parts[parts.length - 1] || path;
			const dotIndex = name.lastIndexOf(".");
			this.basename = dotIndex >= 0 ? name.slice(0, dotIndex) : name;
			this.extension = dotIndex >= 0 ? name.slice(dotIndex + 1) : "";
		}
	}

	class MockVault {
		adapter = {
			readBinary: vi.fn(async () => new ArrayBuffer(0)),
		};
		getAbstractFileByPath(path: string) {
			return new MockTFile(path);
		}
	}

	return {
		...actual,
		TFile: MockTFile,
		Vault: MockVault,
		Platform: { isDesktopApp: true },
	};
});

function createMockApp(buffer: ArrayBuffer) {
	return {
		vault: {
			adapter: {
				readBinary: vi.fn(async () => buffer),
			},
			getAbstractFileByPath: vi.fn((path: string) => ({
				path,
				basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") || path,
				extension: path.split(".").pop() || "",
			})),
		} as unknown as Vault,
	} as any;
}

describe("FoliateReaderService comment marker layering", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("keeps a single foliate annotation for commented highlights so the shared overlayer key does not overwrite prior layers", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const highlight = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				style: "underline" as const,
				text: "Selection text for testing",
				hasCommentDivider: true,
				presentation: "highlight" as const,
			};

			const rendered = createRenderedFoliateAnnotation({
				persistentHighlight: highlight,
				currentStrikethroughPresentation: service.currentStrikethroughPresentation,
				colorScheme: service.getCurrentColorScheme(),
				temporarilyRevealedConcealmentKeys: (service as any).temporarilyRevealedConcealmentTimers,
			});

			expect(rendered.annotation).toMatchObject({
				style: "underline",
				hasCommentDivider: true,
			});
			expect(rendered.renderSignature).toContain("style:underline");
			expect(rendered.renderSignature).toContain("comment:visible");
		} finally {
			service.destroy();
		}
	});

	it("keeps multiple highlights that share a canonical CFI but have different excerpt ids", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const sharedCfi = "epubcfi(/6/26)";
			const highlights = [
				{
					cfiRange: sharedCfi,
					color: "yellow",
					text: "第一段摘录",
					excerptId: "excerpt-a",
					chapterIndex: 12,
					presentation: "highlight" as const,
				},
				{
					cfiRange: sharedCfi,
					color: "green",
					text: "第二段摘录",
					excerptId: "excerpt-b",
					chapterIndex: 12,
					presentation: "highlight" as const,
				},
			];

			vi.spyOn(service as any, "resolveHighlightAnchorCfi").mockImplementation(
				(async (...args: any[]) => {
					const [highlight] = args as [{ excerptId?: string; cfiRange: string }];
					if (highlight.excerptId === "excerpt-a") {
						return "epubcfi(/6/26!/4/2/1,/1:0,/1:4)";
					}
					if (highlight.excerptId === "excerpt-b") {
						return "epubcfi(/6/26!/4/2/2,/1:0,/1:4)";
					}
					return highlight.cfiRange;
				}) as any
			);
			vi.spyOn((service as any).parser, "getSectionIndexForCfi").mockReturnValue(12);
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([{ index: 12 }]);
			const view = {
				addAnnotation: vi.fn(async (..._args: any[]) => undefined),
				deleteAnnotation: vi.fn(async () => undefined),
				removeEventListener: vi.fn(),
				close: vi.fn(),
				remove: vi.fn(),
			};
			(service as any).foliateView = view;

			await service.applyHighlights(highlights);

			expect((service as any).highlightDataMap.size).toBe(2);
			expect(view.addAnnotation).toHaveBeenCalledTimes(2);
			const values = view.addAnnotation.mock.calls.map(
				(call) => (call[0] as unknown as { value?: string }).value
			);
			expect(new Set(values).size).toBe(2);
			const renderedValues = view.addAnnotation.mock.calls.map(
				(call) => (call[0] as unknown as { value?: string; excerptId?: string }).value
			);
			expect(renderedValues).toEqual(
				expect.arrayContaining([
					"epubcfi(/6/26!/4/2/1,/1:0,/1:4)",
					"epubcfi(/6/26!/4/2/2,/1:0,/1:4)",
				])
			);
		} finally {
			service.destroy();
		}
	});

	it("falls back to excerpt text when foliate supplies empty annotation rects", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const doc = document.implementation.createHTMLDocument("novel");
			const paragraph = doc.createElement("p");
			paragraph.textContent = "不能要太高悬赏";
			doc.body.appendChild(paragraph);

			const frame = {
				index: 12,
				href: "txt-section-13.xhtml",
				frameDocument: doc,
				frameElement: null,
				frame: {
					frameDocument: doc,
					window: doc.defaultView as Window,
					cfiFromRange: () => null,
				},
			};
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([frame]);
			vi.spyOn((service as any).parser, "resolveRangeInLoadedSection").mockImplementation(
				((...args: any[]) => {
					const [_cfi, document, index, textHint] = args as [string, Document, number, string?];
					if (index !== 12 || !textHint) {
						return null;
					}
					const range = document.createRange();
					range.selectNodeContents(paragraph);
					return range;
				}) as any
			);

			const annotation = createReaderFoliateAnnotation({
				cfiRange: "epubcfi(/6/26!/4/2/4,/17:15,/17:22)",
				color: "green",
				text: "不能要太高悬赏",
				chapterIndex: 12,
				presentation: "highlight",
			});
			vi.spyOn(service as any, "resolveHighlightOverlayRects").mockReturnValue([
				{ left: 10, top: 20, width: 120, height: 18 },
			]);
			const compositeSpy = vi.spyOn(service as any, "createCompositeAnnotationOverlay");
			const draw = vi.fn((factory: (rects: unknown[], options?: unknown) => SVGElement) => {
				factory([]);
			});

			await (service as any).drawAnnotation(annotation, draw);

			expect(compositeSpy).toHaveBeenCalledTimes(1);
			const overlayRects = compositeSpy.mock.calls[0]?.[1] as Array<{
				width: number;
				height: number;
			}>;
			expect(overlayRects).toEqual([{ left: 10, top: 20, width: 120, height: 18 }]);
		} finally {
			service.destroy();
		}
	});

	it("draws the base style and comment marker together inside one composite overlay", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const annotation = createReaderFoliateAnnotation(
				{
					cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
					color: "purple",
					style: "wavy",
					text: "Selection text for testing",
					hasCommentDivider: true,
					presentation: "highlight",
				},
				{
					focusColor: "blue",
				}
			);
			const renderer = (service as any).annotationOverlayRenderer;
			const markerSpy = vi.spyOn(renderer, "createCommentMarkerOverlay");
			const styleSpy = vi.spyOn(renderer, "createStyledAnnotationOverlay");
			const focusSpy = vi.spyOn(renderer, "createTemporaryFocusOverlay");
			const compositeSpy = vi.spyOn(service as any, "createCompositeAnnotationOverlay");
			const draw = vi.fn((factory: (rects: unknown[], options?: unknown) => SVGElement) => {
				factory([
					{
						left: 10,
						top: 10,
						width: 24,
						height: 12,
					},
				]);
			});

			await (service as any).drawAnnotation(annotation, draw);

			expect(draw).toHaveBeenCalledTimes(1);
			expect(compositeSpy).toHaveBeenCalledTimes(1);
			expect(markerSpy).toHaveBeenCalledTimes(1);
			expect(styleSpy).toHaveBeenCalledTimes(1);
			expect(focusSpy).toHaveBeenCalledTimes(1);
		} finally {
			service.destroy();
		}
	});

	it("draws standalone thoughts as a black comment marker without a base highlight overlay", () => {
		const highlightOverlay = vi.fn(() => document.createElementNS("http://www.w3.org/2000/svg", "g"));
		const renderer = new ReaderAnnotationOverlayRenderer({
			resolveHighlightTint: vi.fn((color?: string) => color || "rgb(250, 204, 21)"),
			getObsidianCSSVar: vi.fn((_name: string, fallback: string) => fallback),
			getConcealmentPalette: vi.fn(() => ({
				base: "#ffffff",
				border: "#111111",
				stripe: "#dddddd",
			})),
			onCommentMarkerClick: vi.fn(),
			onReferenceBadgeClick: vi.fn(),
		});

		const overlay = renderer.createCompositeAnnotationOverlay(
			createReaderFoliateAnnotation({
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Thought source",
				commentText: "Thought body",
				hasCommentDivider: true,
				presentation: "thought",
			}),
			[{ left: 10, top: 10, width: 84, height: 18 }],
			{ Overlayer: { highlight: highlightOverlay } }
		);

		expect(highlightOverlay).not.toHaveBeenCalled();
		expect(overlay.querySelector('[data-weave-comment-marker="bubble"]')).not.toBeNull();
		expect(
			overlay.querySelector('[data-weave-comment-marker="bubble"]')?.getAttribute("stroke")
		).toBe("#111111");
	});

	it("places standalone thought markers beside the final text rect instead of inside the text", () => {
		const renderer = new ReaderAnnotationOverlayRenderer({
			resolveHighlightTint: vi.fn((color?: string) => color || "rgb(250, 204, 21)"),
			getObsidianCSSVar: vi.fn((_name: string, fallback: string) => fallback),
			getConcealmentPalette: vi.fn(() => ({
				base: "#ffffff",
				border: "#111111",
				stripe: "#dddddd",
			})),
			onCommentMarkerClick: vi.fn(),
			onReferenceBadgeClick: vi.fn(),
		});

		const overlay = renderer.createCompositeAnnotationOverlay(
			createReaderFoliateAnnotation({
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Thought source",
				commentText: "Thought body",
				hasCommentDivider: true,
				presentation: "thought",
			}),
			[
				{ left: 10, top: 10, width: 64, height: 18 },
				{ left: 10, top: 32, width: 84, height: 18 },
			]
		);

		const bubble = overlay.querySelector('[data-weave-comment-marker="bubble"]');
		const hitArea = overlay.querySelector('[data-weave-comment-marker="hit-area"]');
		expect(bubble).not.toBeNull();
		expect(hitArea).not.toBeNull();
		expect(Number(bubble?.getAttribute("x"))).toBeGreaterThanOrEqual(96);
		expect(Number(hitArea?.getAttribute("x"))).toBeGreaterThanOrEqual(94);
	});

	it("draws source-locate focus as a visible outline box instead of a filled highlight", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const overlay = (service as any).createTemporaryFocusOverlay(
				[
					{
						left: 10,
						top: 20,
						width: 90,
						height: 18,
					},
				],
				"yellow"
			);
			const rects = Array.from(overlay.querySelectorAll("rect"));

			expect(rects).toHaveLength(1);
			expect(rects[0].getAttribute("data-weave-source-locate-focus")).toBe("outline");
			expect(rects[0].getAttribute("fill")).toBe("none");
			expect(rects[0].getAttribute("stroke")).not.toBe("none");
			expect(Number(rects[0].getAttribute("stroke-width"))).toBeGreaterThanOrEqual(3);
			expect(rects[0].getAttribute("stroke-opacity")).toBe("1");
		} finally {
			service.destroy();
		}
	});

	it("merges multi-line source-locate rects into one visible outline box", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const overlay = (service as any).createTemporaryFocusOverlay(
				[
					{ left: 20, top: 10, width: 180, height: 20 },
					{ left: 20, top: 34, width: 160, height: 20 },
					{ left: 20, top: 58, width: 60, height: 20 },
				],
				"yellow",
				"pulse"
			);
			const rects = Array.from(overlay.querySelectorAll('[data-weave-source-locate-focus="outline"]'));

			expect(rects).toHaveLength(1);
			expect(rects[0].getAttribute("x")).toBe("17");
			expect(rects[0].getAttribute("y")).toBe("7");
			expect(rects[0].getAttribute("width")).toBe("186");
			expect(rects[0].getAttribute("height")).toBe("74");
		} finally {
			service.destroy();
		}
	});

	it("splits source-locate range segments into independently rendered temporary highlights", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const highlights = (service as any).getHighlightsForSegmentedRender({
				cfiRange: "cfi:start",
				color: "yellow",
				text: "Source range",
				sourceFile: "",
				value: "cfi:start",
				temporary: true,
				flashStyle: "pulse",
				segments: [
					{ cfiRange: "cfi:start", text: "Source range" },
					{ cfiRange: "cfi:middle", text: "Source range" },
					{ cfiRange: "cfi:end", text: "Source range" },
				],
			});

			expect(highlights).toHaveLength(3);
			expect(highlights.map((highlight: { cfiRange: string }) => highlight.cfiRange)).toEqual([
				"cfi:start",
				"cfi:middle",
				"cfi:end",
			]);
			expect(highlights.every((highlight: { segments?: unknown }) => !highlight.segments)).toBe(true);
		} finally {
			service.destroy();
		}
	});

	it("resolves source-locate range segment rects together before drawing one outline", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			vi.spyOn(service as any, "resolveHighlightOverlayRects").mockReturnValue([]);
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([
				{
					index: 0,
					frameDocument: document.implementation.createHTMLDocument("chapter"),
					frameElement: null,
				},
			]);
			vi.spyOn((service as any).parser, "resolveRangeInLoadedSection").mockImplementation(
				(cfi: string) => ({ cfi }) as unknown as Range
			);
			vi.spyOn(service as any, "createViewportRectList").mockImplementation(
				(_frame: unknown, range: { cfi: string }) => {
					if (range.cfi === "cfi:start") {
						return [{ left: 20, top: 10, width: 180, height: 20 }];
					}
					if (range.cfi === "cfi:middle") {
						return [{ left: 20, top: 34, width: 160, height: 20 }];
					}
					if (range.cfi === "cfi:end") {
						return [{ left: 20, top: 58, width: 60, height: 20 }];
					}
					return null;
				}
			);

			const rects = (service as any).resolveAnnotationDrawRects(
				{
					cfiRange: "cfi:start",
					color: "yellow",
					text: "Source range",
					sourceFile: "",
					value: "cfi:start",
					temporary: true,
					flashStyle: "pulse",
					segments: [
						{ cfiRange: "cfi:start", text: "Source range" },
						{ cfiRange: "cfi:middle", text: "Source range" },
						{ cfiRange: "cfi:end", text: "Source range" },
					],
				},
				[{ left: 20, top: 10, width: 180, height: 20 }]
			);
			const overlay = (service as any).createTemporaryFocusOverlay(
				rects,
				"yellow",
				"pulse"
			);
			const outlines = Array.from(
				overlay.querySelectorAll('[data-weave-source-locate-focus="outline"]')
			);

			expect(rects).toHaveLength(3);
			expect(outlines).toHaveLength(1);
			expect(outlines[0].getAttribute("x")).toBe("17");
			expect(outlines[0].getAttribute("y")).toBe("7");
			expect(outlines[0].getAttribute("width")).toBe("186");
			expect(outlines[0].getAttribute("height")).toBe("74");
		} finally {
			service.destroy();
		}
	});

	it("marks pulse source-locate focus overlays for animation", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const overlay = (service as any).createTemporaryFocusOverlay(
				[
					{
						left: 10,
						top: 20,
						width: 90,
						height: 18,
					},
				],
				"yellow",
				"pulse"
			);

			expect(overlay.getAttribute("data-weave-source-locate-flash-style")).toBe("pulse");
			expect(overlay.classList.contains("weave-source-locate-focus-pulse")).toBe(true);
			expect(overlay.querySelector("animate")?.getAttribute("attributeName")).toBe("opacity");
		} finally {
			service.destroy();
		}
	});

	it("starts a runtime pulse animation on source-locate outline boxes", () => {
		const originalAnimateDescriptor = Object.getOwnPropertyDescriptor(
			SVGElement.prototype,
			"animate"
		);
		const originalRaf = window.requestAnimationFrame;
		const animateSpy = vi.fn(() => ({ cancel: vi.fn() }));
		Object.defineProperty(SVGElement.prototype, "animate", {
			configurable: true,
			value: animateSpy,
		});
		window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		}) as typeof window.requestAnimationFrame;

		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			(service as any).createTemporaryFocusOverlay(
				[
					{
						left: 10,
						top: 20,
						width: 90,
						height: 18,
					},
				],
				"yellow",
				"pulse"
			);

			expect(animateSpy).toHaveBeenCalledTimes(1);
			expect(animateSpy.mock.calls[0]?.[0]).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ opacity: 1 }),
					expect.objectContaining({ opacity: 0.12 }),
				])
			);
			expect(animateSpy.mock.calls[0]?.[1]).toMatchObject({
				duration: 560,
				iterations: 6,
			});
		} finally {
			service.destroy();
			window.requestAnimationFrame = originalRaf;
			if (originalAnimateDescriptor) {
				Object.defineProperty(SVGElement.prototype, "animate", originalAnimateDescriptor);
			} else {
				delete (SVGElement.prototype as { animate?: unknown }).animate;
			}
		}
	});

	it("draws pulse temporary source-locate annotations as an outline box instead of the default filled highlighter", () => {
		const highlightOverlay = vi.fn(() =>
			activeDocument.createElementNS("http://www.w3.org/2000/svg", "g")
		);
		const renderer = new ReaderAnnotationOverlayRenderer({
			resolveHighlightTint: () => "#ffe58a",
			getObsidianCSSVar: (_name, fallback) => fallback,
			getConcealmentPalette: () => ({ base: "#111", stripe: "#222", border: "#333" }),
			onCommentMarkerClick: vi.fn(),
			onReferenceBadgeClick: vi.fn(),
		});

		const overlay = renderer.createCompositeAnnotationOverlay(
			createReaderFoliateAnnotation({
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Temporary source",
				temporary: true,
				flashStyle: "pulse",
			}),
			[{ left: 10, top: 20, width: 90, height: 18 }],
			{
				Overlayer: {
					highlight: highlightOverlay,
				},
			}
		);

		expect(highlightOverlay).not.toHaveBeenCalled();
		expect(overlay.getAttribute("data-weave-source-locate-flash-style")).toBe("pulse");
		expect(overlay.classList.contains("weave-source-locate-focus-pulse")).toBe(true);
		expect(overlay.querySelector("animate")?.getAttribute("attributeName")).toBe("opacity");
		const outline = overlay.querySelector('[data-weave-source-locate-focus="outline"]');
		expect(outline).not.toBeNull();
		expect(outline?.getAttribute("fill")).toBe("none");
		expect(Number(outline?.getAttribute("stroke-width"))).toBeGreaterThanOrEqual(3);
	});

	it("draws a reference badge inside the composite overlay when a styled highlight has multiple references", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const annotation = createReaderFoliateAnnotation({
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				style: "underline",
				text: "Selection text for testing",
				referenceCount: 5,
				referenceHeat: 60,
				presentation: "highlight",
			});
			const renderer = (service as any).annotationOverlayRenderer;
			const badgeSpy = vi.spyOn(renderer, "createReferenceBadgeOverlay");
			const styleSpy = vi.spyOn(renderer, "createStyledAnnotationOverlay");
			const compositeSpy = vi.spyOn(service as any, "createCompositeAnnotationOverlay");
			const draw = vi.fn((factory: (rects: unknown[], options?: unknown) => SVGElement) => {
				factory([
					{
						left: 10,
						top: 10,
						width: 24,
						height: 12,
					},
				]);
			});

			await (service as any).drawAnnotation(annotation, draw);

			expect(draw).toHaveBeenCalledTimes(1);
			expect(compositeSpy).toHaveBeenCalledTimes(1);
			expect(styleSpy).toHaveBeenCalledTimes(1);
			expect(badgeSpy).toHaveBeenCalledTimes(1);
		} finally {
			service.destroy();
		}
	});

	it("keeps the reference badge geometry inside the highlight bounds so it is not clipped", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const annotation = createReaderFoliateAnnotation({
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				referenceCount: 5,
				referenceHeat: 60,
				presentation: "highlight",
			});

			const overlay = (service as any).createReferenceBadgeOverlay(annotation, [
				{
					left: 10,
					top: 10,
					width: 24,
					height: 12,
				},
			]) as SVGGElement;

			const background = overlay.querySelector('[data-weave-reference-badge="background"]');
			const hitArea = overlay.querySelector('[data-weave-reference-badge="hit-area"]');
			expect(background).toBeTruthy();
			expect(hitArea).toBeTruthy();

			const x = Number(background?.getAttribute("x"));
			const y = Number(background?.getAttribute("y"));
			const width = Number(background?.getAttribute("width"));
			const height = Number(background?.getAttribute("height"));

			expect(x).toBeGreaterThanOrEqual(10);
			expect(y).toBeGreaterThanOrEqual(10);
			expect(x + width).toBeLessThanOrEqual(34);
			expect(y + height).toBeLessThanOrEqual(22);
		} finally {
			service.destroy();
		}
	});

	it("treats reference count changes as an annotation render change", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const base = createReaderFoliateAnnotation({
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				referenceCount: 1,
				presentation: "highlight",
			});
			const updated = createReaderFoliateAnnotation({
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				referenceCount: 3,
				presentation: "highlight",
			});

			expect(isSameFoliateAnnotation(base, updated)).toBe(false);
			expect(
				buildAnnotationRenderSignature({
					annotation: base,
					currentStrikethroughPresentation: service.currentStrikethroughPresentation,
					colorScheme: service.getCurrentColorScheme(),
					temporarilyRevealedConcealmentKeys: (service as any).temporarilyRevealedConcealmentTimers,
				})
			).not.toBe(
				buildAnnotationRenderSignature({
					annotation: updated,
					currentStrikethroughPresentation: service.currentStrikethroughPresentation,
					colorScheme: service.getCurrentColorScheme(),
					temporarilyRevealedConcealmentKeys: (service as any).temporarilyRevealedConcealmentTimers,
				})
			);
		} finally {
			service.destroy();
		}
	});

	it("routes reference badge clicks through the highlight click callback chain when highlight geometry is available", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const notifySpy = vi.spyOn(service as any, "notifyHighlightClick");
			(service as any).foliateView = {
				addEventListener: vi.fn(),
				close: vi.fn(),
				dispatchEvent: vi.fn(),
				remove: vi.fn(),
				removeEventListener: vi.fn(),
			};
			const fallbackDispatchSpy = vi.spyOn((service as any).foliateView, "dispatchEvent");
			const info = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				sourceFile: "",
				interactionTarget: "reference-badge",
				rect: {
					top: 10,
					left: 10,
					bottom: 22,
					right: 34,
					width: 24,
					height: 12,
				},
			};
			vi.spyOn(service, "getHighlightClickInfo").mockReturnValue(info as any);

			(service as any).notifyReferenceBadgeClick(info.cfiRange);

			expect(notifySpy).toHaveBeenCalledWith(info);
			expect(fallbackDispatchSpy).toHaveBeenCalledTimes(1);
		} finally {
			service.destroy();
		}
	});

	it("notifies dedicated reference badge listeners from click-time badge geometry even when runtime lookup is unavailable", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			(service as any).foliateView = {
				addEventListener: vi.fn(),
				close: vi.fn(),
				dispatchEvent: vi.fn(),
				remove: vi.fn(),
				removeEventListener: vi.fn(),
			};
			const callback = vi.fn();
			service.onReferenceBadgeClick(callback);
			const highlight = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				sourceFile: "",
				presentation: "highlight",
			};
			(service as any).highlightDataMap.set("epubcfi(/6/2!/4/2,/1:0,/1:9)", highlight);
			vi.spyOn(service, "getHighlightClickInfo").mockReturnValue(null);

			(service as any).notifyReferenceBadgeClick("epubcfi(/6/2!/4/2,/1:0,/1:9)", {
				rect: {
					top: 11,
					left: 22,
					bottom: 19,
					right: 32,
					width: 10,
					height: 8,
				},
				rects: [
					{
						top: 10,
						left: 10,
						bottom: 22,
						right: 34,
						width: 24,
						height: 12,
					},
				],
				anchorPoint: {
					x: 27,
					y: 15,
				},
			});

			expect(callback).toHaveBeenCalledWith(
				expect.objectContaining({
					cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
					interactionTarget: "reference-badge",
					rect: expect.objectContaining({
						left: 22,
						top: 11,
					}),
					anchorPoint: expect.objectContaining({
						x: 27,
						y: 15,
					}),
				})
			);
			expect((service as any).foliateView.dispatchEvent).toHaveBeenCalledTimes(1);
		} finally {
			service.destroy();
		}
	});
});
