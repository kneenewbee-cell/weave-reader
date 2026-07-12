import {
	mapHighlightViewportRectToDomRect,
	resolveReaderSourceLocateOverlayRect,
} from "../reader-source-locate-overlay-rect";

describe("resolveReaderSourceLocateOverlayRect", () => {
	it("prefers primary highlight geometry before navigation rects", () => {
		const navigationCalls: Array<{ cfi?: string; text?: string }> = [];
		const highlightCalls: Array<{ cfi: string; textHint?: string }> = [];
		const rect = resolveReaderSourceLocateOverlayRect({
			cfi: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
			text: "Embedded quote",
			currentCfi: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
			resolveNavigationRect: (options) => {
				navigationCalls.push(options);
				return new DOMRect(120, 240, 180, 24);
			},
			resolveHighlightRect: (cfiRange, textHint) => {
				highlightCalls.push({ cfi: cfiRange, textHint });
				return mapHighlightViewportRectToDomRect({ left: 88, top: 320, width: 96, height: 20 });
			},
		});

		expect(rect).toMatchObject({ left: 88, top: 320, width: 96, height: 20 });
		expect(highlightCalls[0]).toEqual({
			cfi: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
			textHint: "Embedded quote",
		});
		expect(navigationCalls).toEqual([]);
	});

	it("passes text hints to navigation rects when highlight geometry is unavailable", () => {
		const navigationCalls: Array<{ cfi?: string; text?: string }> = [];
		const rect = resolveReaderSourceLocateOverlayRect({
			cfi: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
			text: "Embedded quote",
			currentCfi: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
			resolveNavigationRect: (options) => {
				navigationCalls.push(options);
				if (options.cfi && options.text) {
					return new DOMRect(120, 240, 180, 24);
				}
				return null;
			},
			resolveHighlightRect: () => null,
		});

		expect(rect).toMatchObject({ left: 120, top: 240, width: 180, height: 24 });
		expect(navigationCalls[0]).toEqual({
			cfi: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
			href: undefined,
			text: "Embedded quote",
		});
	});

	it("falls back to temporary highlight geometry when navigation rects are unavailable", () => {
		const rect = resolveReaderSourceLocateOverlayRect({
			cfi: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
			temporaryHighlightCfis: ["epubcfi(/6/2!/4/2,/1:0,/1:9)"],
			resolveNavigationRect: () => null,
			resolveHighlightRect: (cfiRange, textHint) =>
				cfiRange.includes("/1:9") && !textHint
					? mapHighlightViewportRectToDomRect({ left: 88, top: 320, width: 96, height: 20 })
					: null,
		});

		expect(rect).toMatchObject({ left: 88, top: 320, width: 96, height: 20 });
	});

	it("falls back to saved highlight geometry without text hint when link text differs", () => {
		const highlightCalls: Array<{ cfi: string; textHint?: string }> = [];
		const rect = resolveReaderSourceLocateOverlayRect({
			cfi: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
			text: "Different link quote",
			resolveNavigationRect: () => null,
			resolveHighlightRect: (cfiRange, textHint) => {
				highlightCalls.push({ cfi: cfiRange, textHint });
				if (cfiRange.includes("/1:9") && !textHint) {
					return mapHighlightViewportRectToDomRect({ left: 88, top: 320, width: 96, height: 20 });
				}
				return null;
			},
		});

		expect(rect).toMatchObject({ left: 88, top: 320, width: 96, height: 20 });
		expect(highlightCalls).toEqual([
			{ cfi: "epubcfi(/6/2!/4/2,/1:0,/1:9)", textHint: "Different link quote" },
			{ cfi: "epubcfi(/6/2!/4/2,/1:0,/1:9)", textHint: undefined },
		]);
	});
});
