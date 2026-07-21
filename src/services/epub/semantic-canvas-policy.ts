export interface SemanticCanvasRoutingInput {
	autoInsert?: boolean;
	canvasMode?: boolean;
	canvasActive?: boolean;
	canUseCanvas?: boolean;
	semantic?: { autoAddToCanvas?: boolean } | null;
}

export interface SemanticCanvasAttachmentInput {
	semantic?: { autoAddToCanvas?: boolean } | null;
	canvasNodeAttached?: boolean;
	manuallyDetached?: boolean;
}

export interface SemanticCanvasBackfillInput extends SemanticCanvasAttachmentInput {
	canvasMode?: boolean;
	canvasActive?: boolean;
	canUseCanvas?: boolean;
}

export function shouldAutoAddSemanticToCanvas(
	semantic?: { autoAddToCanvas?: boolean } | null
): boolean {
	return semantic?.autoAddToCanvas === true;
}

export function shouldRouteSelectionOutputToCanvas(input: SemanticCanvasRoutingInput): boolean {
	return (
		shouldAutoAddSemanticToCanvas(input.semantic) &&
		input.canvasMode === true &&
		input.canvasActive === true &&
		input.canUseCanvas === true
	);
}

export function shouldInsertSelectionOutputToEditor(input: SemanticCanvasRoutingInput): boolean {
	return input.autoInsert === true && !shouldRouteSelectionOutputToCanvas(input);
}

export function shouldTreatHighlightAsCanvasAttached(
	input: SemanticCanvasAttachmentInput
): boolean {
	if (input.manuallyDetached === true) {
		return false;
	}
	return input.canvasNodeAttached === true || shouldAutoAddSemanticToCanvas(input.semantic);
}

export function shouldBackfillAutoCanvasHighlight(input: SemanticCanvasBackfillInput): boolean {
	return (
		input.manuallyDetached !== true &&
		input.canvasNodeAttached !== true &&
		shouldRouteSelectionOutputToCanvas({
			semantic: input.semantic,
			canvasMode: input.canvasMode,
			canvasActive: input.canvasActive,
			canUseCanvas: input.canUseCanvas,
		})
	);
}
