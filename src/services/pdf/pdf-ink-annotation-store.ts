import { type App, normalizePath } from "obsidian";

export type PdfInkDrawingTool = "pen" | "highlighter";
export type PdfAnnotationTool =
	| "pan"
	| "select"
	| "stroke-select"
	| "capture"
	| PdfInkDrawingTool
	| "eraser";

export interface PdfInkPoint {
	x: number;
	y: number;
	t: number;
	pressure?: number;
}

export interface PdfInkStroke {
	id: string;
	pageNumber: number;
	tool: PdfInkDrawingTool;
	color: string;
	width: number;
	points: PdfInkPoint[];
}

export interface PdfTextAnnotationRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface PdfTextAnnotation {
	id: string;
	pageNumber: number;
	color: string;
	text: string;
	rects: PdfTextAnnotationRect[];
	createdAt: number;
}

export interface PdfInkAnnotationDocument {
	version: 1;
	sourcePath: string;
	pageCount: number;
	strokes: PdfInkStroke[];
	textAnnotations?: PdfTextAnnotation[];
	updatedAt: number;
}

interface VaultAdapterLike {
	exists?: (path: string) => Promise<boolean>;
	read?: (path: string) => Promise<string>;
	write?: (path: string, data: string) => Promise<void>;
	mkdir?: (path: string) => Promise<void>;
}

const DEFAULT_BASE_DIR = "weave/pdf-annotations";

export class PdfInkAnnotationStore {
	constructor(
		private readonly app: App,
		private readonly baseDir = DEFAULT_BASE_DIR
	) {}

	async load(sourcePath: string, pageCount: number): Promise<PdfInkAnnotationDocument> {
		const normalizedSourcePath = normalizePath(sourcePath);
		const path = this.getAnnotationPath(normalizedSourcePath);
		const adapter = this.getAdapter();
		if (!adapter || typeof adapter.exists !== "function" || !(await adapter.exists(path))) {
			return this.createEmpty(normalizedSourcePath, pageCount);
		}

		try {
			const parsed = JSON.parse(await adapter.read?.(path)) as Partial<PdfInkAnnotationDocument>;
			return {
				version: 1,
				sourcePath: normalizedSourcePath,
				pageCount: normalizePageCount(parsed.pageCount, pageCount),
				strokes: normalizeStrokes(parsed.strokes, pageCount),
				textAnnotations: normalizeTextAnnotations(parsed.textAnnotations, pageCount),
				updatedAt: normalizeTimestamp(parsed.updatedAt),
			};
		} catch {
			return this.createEmpty(normalizedSourcePath, pageCount);
		}
	}

	async save(document: PdfInkAnnotationDocument): Promise<void> {
		const adapter = this.getAdapter();
		if (!adapter || typeof adapter.write !== "function") {
			throw new Error("Vault adapter is unavailable");
		}
		await this.ensureFolder(this.baseDir);
		const normalizedSourcePath = normalizePath(document.sourcePath);
		const payload: PdfInkAnnotationDocument = {
			version: 1,
			sourcePath: normalizedSourcePath,
			pageCount: Math.max(0, Math.floor(Number(document.pageCount) || 0)),
			strokes: normalizeStrokes(document.strokes, document.pageCount),
			textAnnotations: normalizeTextAnnotations(document.textAnnotations, document.pageCount),
			updatedAt: Date.now(),
		};
		await adapter.write(this.getAnnotationPath(normalizedSourcePath), JSON.stringify(payload, null, 2));
	}

	getAnnotationPath(sourcePath: string): string {
		const normalizedSourcePath = normalizePath(sourcePath);
		const fileName = normalizedSourcePath.split("/").pop() || "document.pdf";
		const safeName = fileName.replace(/[^\w\-.\u4e00-\u9fa5]/g, "_") || "document.pdf";
		return `${this.baseDir}/${safeName}.${hashString(normalizedSourcePath)}.ink.json`;
	}

	private createEmpty(sourcePath: string, pageCount: number): PdfInkAnnotationDocument {
		return {
			version: 1,
			sourcePath,
			pageCount: Math.max(0, Math.floor(Number(pageCount) || 0)),
			strokes: [],
			textAnnotations: [],
			updatedAt: Date.now(),
		};
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		const adapter = this.getAdapter();
		if (!adapter || typeof adapter.mkdir !== "function") {
			return;
		}

		const parts = normalizePath(folderPath).split("/").filter(Boolean);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (typeof adapter.exists === "function" && (await adapter.exists(current))) {
				continue;
			}
			await adapter.mkdir(current);
		}
	}

	private getAdapter(): VaultAdapterLike | null {
		return ((this.app.vault as unknown as { adapter?: VaultAdapterLike }).adapter ?? null);
	}
}

export function clonePdfInkStrokes(strokes: PdfInkStroke[]): PdfInkStroke[] {
	return strokes.map((stroke) => ({
		...stroke,
		points: stroke.points.map((point) => ({ ...point })),
	}));
}

function normalizeStrokes(value: unknown, pageCount: number): PdfInkStroke[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((entry) => normalizeStroke(entry, pageCount))
		.filter((entry): entry is PdfInkStroke => Boolean(entry));
}

function normalizeTextAnnotations(value: unknown, pageCount: number): PdfTextAnnotation[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((entry) => normalizeTextAnnotation(entry, pageCount))
		.filter((entry): entry is PdfTextAnnotation => Boolean(entry));
}

function normalizeTextAnnotation(value: unknown, pageCount: number): PdfTextAnnotation | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	const rects = Array.isArray(record.rects)
		? record.rects
				.map(normalizeTextRect)
				.filter((entry): entry is PdfTextAnnotationRect => Boolean(entry))
		: [];
	if (rects.length === 0) {
		return null;
	}
	return {
		id: typeof record.id === "string" && record.id ? record.id : createId(),
		pageNumber: Math.max(
			1,
			Math.min(Math.max(1, Math.floor(Number(pageCount) || 1)), Math.floor(Number(record.pageNumber) || 1))
		),
		color: normalizeColor(record.color, "#ffd54a"),
		text: typeof record.text === "string" ? record.text : "",
		rects,
		createdAt: normalizeTimestamp(record.createdAt),
	};
}

function normalizeTextRect(value: unknown): PdfTextAnnotationRect | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	const x = Number(record.x);
	const y = Number(record.y);
	const width = Number(record.width);
	const height = Number(record.height);
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
		return null;
	}
	const left = Math.max(0, Math.min(1, x));
	const top = Math.max(0, Math.min(1, y));
	return {
		x: left,
		y: top,
		width: Math.max(0.001, Math.min(1 - left, width)),
		height: Math.max(0.001, Math.min(1 - top, height)),
	};
}

function normalizeStroke(value: unknown, pageCount: number): PdfInkStroke | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	const pageNumber = Math.max(
		1,
		Math.min(Math.max(1, Math.floor(Number(pageCount) || 1)), Math.floor(Number(record.pageNumber) || 1))
	);
	const points = Array.isArray(record.points)
		? record.points
				.map(normalizePoint)
				.filter((entry): entry is PdfInkPoint => Boolean(entry))
		: [];
	if (points.length === 0) {
		return null;
	}
	return {
		id: typeof record.id === "string" && record.id ? record.id : createId(),
		pageNumber,
		tool: record.tool === "highlighter" ? "highlighter" : "pen",
		color: normalizeColor(record.color, record.tool === "highlighter" ? "#ffd54a" : "#111111"),
		width: normalizeWidth(record.width, record.tool === "highlighter" ? 14 : 2),
		points,
	};
}

function normalizePoint(value: unknown): PdfInkPoint | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	const x = Number(record.x);
	const y = Number(record.y);
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return null;
	}
	return {
		x: Math.max(0, Math.min(1, x)),
		y: Math.max(0, Math.min(1, y)),
		t: Number.isFinite(Number(record.t)) ? Number(record.t) : Date.now(),
		pressure: Number.isFinite(Number(record.pressure)) ? Number(record.pressure) : undefined,
	};
}

function normalizeColor(value: unknown, fallback: string): string {
	const text = typeof value === "string" ? value.trim() : "";
	return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function normalizeWidth(value: unknown, fallback: number): number {
	const width = Number(value);
	return Number.isFinite(width) ? Math.max(1, Math.min(64, width)) : fallback;
}

function normalizePageCount(value: unknown, fallback: number): number {
	const pageCount = Number(value);
	return Number.isFinite(pageCount) && pageCount > 0
		? Math.floor(pageCount)
		: Math.max(0, Math.floor(Number(fallback) || 0));
}

function normalizeTimestamp(value: unknown): number {
	const timestamp = Number(value);
	return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}

function hashString(input: string): string {
	let hash = 2166136261;
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function createId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `pdf-ink-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
