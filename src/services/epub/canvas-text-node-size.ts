import {
	DEFAULT_NODE_HEIGHT,
	DEFAULT_NODE_WIDTH,
} from "./canvas-types";

export const CANVAS_TEXT_NODE_MIN_WIDTH = 260;
export const CANVAS_TEXT_NODE_MAX_WIDTH = 420;
export const CANVAS_TEXT_NODE_MIN_HEIGHT = 88;
export const CANVAS_TEXT_NODE_MAX_HEIGHT = 720;

const HORIZONTAL_PADDING = 24;
const VERTICAL_PADDING = 20;
const LINE_HEIGHT = 24;
const CHAR_UNIT_PX = 7.2;

export function stripCanvasMarkdownLinePrefix(line: string): string {
	return line.replace(/^>\s?/, "").trimEnd();
}

export function measureCanvasTextVisualLength(text: string): number {
	let units = 0;
	for (const char of text) {
		units += char.charCodeAt(0) > 255 ? 2 : 1;
	}
	return units;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function countWrappedLines(text: string, contentWidthPx: number): number {
	const unitsPerLine = Math.max(8, Math.floor(contentWidthPx / CHAR_UNIT_PX));
	const normalized = text.trim();
	if (!normalized) {
		return 1;
	}
	return Math.max(1, Math.ceil(measureCanvasTextVisualLength(normalized) / unitsPerLine));
}

export function estimateCanvasTextNodeSize(text: string): { width: number; height: number } {
	const raw = String(text ?? "");
	if (!raw.trim()) {
		return { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
	}

	const lines = raw.split(/\r?\n/);
	const strippedLines = lines.map(stripCanvasMarkdownLinePrefix);

	let maxVisualUnits = 0;
	for (const line of strippedLines) {
		maxVisualUnits = Math.max(maxVisualUnits, measureCanvasTextVisualLength(line));
	}

	const width = clamp(
		Math.ceil(maxVisualUnits * CHAR_UNIT_PX + HORIZONTAL_PADDING * 2),
		CANVAS_TEXT_NODE_MIN_WIDTH,
		CANVAS_TEXT_NODE_MAX_WIDTH
	);

	const contentWidth = width - HORIZONTAL_PADDING * 2;
	let wrappedLineCount = 0;
	for (const line of strippedLines) {
		if (!line && strippedLines.length > 1) {
			continue;
		}
		wrappedLineCount += countWrappedLines(line, contentWidth);
	}
	wrappedLineCount = Math.max(wrappedLineCount, 1);

	const height = clamp(
		Math.ceil(wrappedLineCount * LINE_HEIGHT + VERTICAL_PADDING * 2),
		CANVAS_TEXT_NODE_MIN_HEIGHT,
		CANVAS_TEXT_NODE_MAX_HEIGHT
	);

	return { width, height };
}
