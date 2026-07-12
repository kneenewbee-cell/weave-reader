import type { HighlightClickInfo } from "./reader-engine-types";
import { createViewportRectFromRawRect } from "./reader-highlight-geometry";

export function mapRawRectToViewport(
	frameElement: HTMLElement | null | undefined,
	rawRect: {
		left: number;
		top: number;
		width: number;
		height: number;
	}
): HighlightClickInfo["rect"] | null {
	if (!frameElement) {
		return createViewportRectFromRawRect(rawRect);
	}
	const iframeRect = frameElement.getBoundingClientRect();
	return createViewportRectFromRawRect({
		left: rawRect.left + iframeRect.left,
		top: rawRect.top + iframeRect.top,
		width: rawRect.width,
		height: rawRect.height,
	});
}
