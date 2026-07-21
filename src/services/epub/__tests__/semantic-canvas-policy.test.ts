import { describe, expect, it } from "vitest";
import {
	shouldAutoAddSemanticToCanvas,
	shouldBackfillAutoCanvasHighlight,
	shouldInsertSelectionOutputToEditor,
	shouldRouteSelectionOutputToCanvas,
	shouldTreatHighlightAsCanvasAttached,
} from "../semantic-canvas-policy";

describe("semantic canvas policy", () => {
	it("only auto-adds semantics with explicit canvas opt-in", () => {
		expect(shouldAutoAddSemanticToCanvas({ autoAddToCanvas: true })).toBe(true);
		expect(shouldAutoAddSemanticToCanvas({ autoAddToCanvas: false })).toBe(false);
		expect(shouldAutoAddSemanticToCanvas({})).toBe(false);
		expect(shouldAutoAddSemanticToCanvas(null)).toBe(false);
	});

	it("routes selection output to canvas only when semantic and canvas state allow it", () => {
		const semantic = { autoAddToCanvas: true };

		expect(
			shouldRouteSelectionOutputToCanvas({
				semantic,
				canvasMode: true,
				canvasActive: true,
				canUseCanvas: true,
			})
		).toBe(true);
		expect(
			shouldRouteSelectionOutputToCanvas({
				semantic,
				canvasMode: false,
				canvasActive: true,
				canUseCanvas: true,
			})
		).toBe(false);
		expect(
			shouldRouteSelectionOutputToCanvas({
				semantic: { autoAddToCanvas: false },
				canvasMode: true,
				canvasActive: true,
				canUseCanvas: true,
			})
		).toBe(false);
	});

	it("does not insert or copy an excerpt when auto insert is off and semantic is not a canvas excerpt", () => {
		expect(
			shouldInsertSelectionOutputToEditor({
				autoInsert: false,
				semantic: { autoAddToCanvas: false },
				canvasMode: true,
				canvasActive: true,
				canUseCanvas: true,
			})
		).toBe(false);
		expect(
			shouldInsertSelectionOutputToEditor({
				autoInsert: true,
				semantic: { autoAddToCanvas: false },
				canvasMode: true,
				canvasActive: true,
				canUseCanvas: true,
			})
		).toBe(true);
		expect(
			shouldInsertSelectionOutputToEditor({
				autoInsert: true,
				semantic: { autoAddToCanvas: true },
				canvasMode: true,
				canvasActive: true,
				canUseCanvas: true,
			})
		).toBe(false);
	});

	it("treats auto canvas semantics as attached in the highlight toolbar", () => {
		expect(
			shouldTreatHighlightAsCanvasAttached({
				semantic: { autoAddToCanvas: true },
				canvasNodeAttached: false,
			})
		).toBe(true);
		expect(
			shouldTreatHighlightAsCanvasAttached({
				semantic: { autoAddToCanvas: true },
				canvasNodeAttached: false,
				manuallyDetached: true,
			})
		).toBe(false);
		expect(
			shouldTreatHighlightAsCanvasAttached({
				semantic: { autoAddToCanvas: false },
				canvasNodeAttached: true,
			})
		).toBe(true);
	});

	it("backfills missing canvas nodes only for active auto canvas highlights", () => {
		expect(
			shouldBackfillAutoCanvasHighlight({
				semantic: { autoAddToCanvas: true },
				canvasNodeAttached: false,
				canvasMode: true,
				canvasActive: true,
				canUseCanvas: true,
			})
		).toBe(true);
		expect(
			shouldBackfillAutoCanvasHighlight({
				semantic: { autoAddToCanvas: true },
				canvasNodeAttached: true,
				canvasMode: true,
				canvasActive: true,
				canUseCanvas: true,
			})
		).toBe(false);
		expect(
			shouldBackfillAutoCanvasHighlight({
				semantic: { autoAddToCanvas: true },
				canvasNodeAttached: false,
				canvasMode: true,
				canvasActive: true,
				canUseCanvas: true,
				manuallyDetached: true,
			})
		).toBe(false);
	});
});
