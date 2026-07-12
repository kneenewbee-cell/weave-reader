export function setSvgInteractionAttributes(
	element: SVGElement,
	options: {
		pointerEvents?: "none" | "auto";
		cursor?: "pointer";
	}
): void {
	if (options.pointerEvents) {
		element.setAttribute("pointer-events", options.pointerEvents);
	}
	if (options.cursor) {
		element.setAttribute("cursor", options.cursor);
	}
}
