import type { PdfInkDrawingTool, PdfInkStroke } from "./pdf-ink-annotation-store";
import { clonePdfInkStrokes } from "./pdf-ink-annotation-store";

export const PDF_INK_BULK_SCALE_MIN = 0.5;
export const PDF_INK_BULK_SCALE_MAX = 2;
export const PDF_INK_BULK_WIDTH_MIN = 1;
export const PDF_INK_BULK_WIDTH_MAX = 40;

export interface PdfInkBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
	centerX: number;
	centerY: number;
}

export interface PdfInkStylePatch {
	tool?: PdfInkDrawingTool;
	color?: string;
	width?: number;
}

function clampUnit(value: number): number {
	return roundInkNumber(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)));
}

function clampWidth(value: number): number {
	return roundInkNumber(Math.max(
		PDF_INK_BULK_WIDTH_MIN,
		Math.min(
			PDF_INK_BULK_WIDTH_MAX,
			Number.isFinite(value) ? value : PDF_INK_BULK_WIDTH_MIN,
		),
	));
}

function clampScale(value: number): number {
	return Math.max(
		PDF_INK_BULK_SCALE_MIN,
		Math.min(PDF_INK_BULK_SCALE_MAX, Number.isFinite(value) ? value : 1),
	);
}

function roundInkNumber(value: number): number {
	return Math.round(value * 100000) / 100000;
}

export function getPdfInkSelectionBounds(strokes: PdfInkStroke[]): PdfInkBounds | null {
	const points = strokes.flatMap((stroke) => stroke.points || []);
	if (points.length === 0) {
		return null;
	}
	const left = Math.min(...points.map((point) => point.x));
	const right = Math.max(...points.map((point) => point.x));
	const top = Math.min(...points.map((point) => point.y));
	const bottom = Math.max(...points.map((point) => point.y));
	return {
		left,
		top,
		right,
		bottom,
		centerX: (left + right) / 2,
		centerY: (top + bottom) / 2,
	};
}

export function applyPdfInkStylePatch(
	strokes: PdfInkStroke[],
	selectedIds: Set<string>,
	patch: PdfInkStylePatch,
): PdfInkStroke[] {
	return strokes.map((stroke) => {
		if (!selectedIds.has(stroke.id)) {
			return clonePdfInkStrokes([stroke])[0];
		}
		return {
			...clonePdfInkStrokes([stroke])[0],
			...(patch.tool ? { tool: patch.tool } : {}),
			...(patch.color ? { color: patch.color } : {}),
			...(typeof patch.width === "number" ? { width: clampWidth(patch.width) } : {}),
		};
	});
}

export function scalePdfInkSelectionFromBaseline(
	currentStrokes: PdfInkStroke[],
	baselineSelectedStrokes: PdfInkStroke[],
	selectedIds: Set<string>,
	scale: number,
): PdfInkStroke[] {
	const clampedScale = clampScale(scale);
	const bounds = getPdfInkSelectionBounds(baselineSelectedStrokes);
	if (!bounds) {
		return clonePdfInkStrokes(currentStrokes);
	}
	const baselineById = new Map(
		baselineSelectedStrokes.map((stroke) => [stroke.id, stroke] as const),
	);
	return currentStrokes.map((stroke) => {
		const baseline = selectedIds.has(stroke.id) ? baselineById.get(stroke.id) : null;
		if (!baseline) {
			return clonePdfInkStrokes([stroke])[0];
		}
		return {
			...clonePdfInkStrokes([baseline])[0],
			width: clampWidth(baseline.width * clampedScale),
			points: baseline.points.map((point) => ({
				...point,
				x: clampUnit(bounds.centerX + (point.x - bounds.centerX) * clampedScale),
				y: clampUnit(bounds.centerY + (point.y - bounds.centerY) * clampedScale),
			})),
		};
	});
}
