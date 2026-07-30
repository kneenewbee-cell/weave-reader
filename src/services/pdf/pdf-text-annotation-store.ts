import { type App, normalizePath } from "obsidian";
import type {
	PdfTextAnnotation,
	PdfTextAnnotationKind,
	PdfTextAnnotationRect,
} from "./pdf-ink-annotation-store";

export const PDF_PORTABLE_DATA_ROOT = "weave/pdf-data";
export const PDF_TEXT_ANNOTATIONS_FORMAT = "weave-reader-pdf-annotations/v1";

export interface PdfPortableBookDataLocation {
	bookId: string;
	bookDir: string;
	annotationsPath: string;
	annotationsMarkdownPath: string;
	indexPath: string;
}

export interface PdfTextAnnotationDocument {
	format: typeof PDF_TEXT_ANNOTATIONS_FORMAT;
	version: 1;
	bookId: string;
	sourcePath: string;
	pageCount: number;
	annotations: PdfTextAnnotation[];
	updatedAt: number;
}

export interface PdfTextAnnotationLoadResult {
	exists: boolean;
	document: PdfTextAnnotationDocument;
}

interface VaultAdapterLike {
	exists?: (path: string) => Promise<boolean>;
	read?: (path: string) => Promise<string>;
	write?: (path: string, data: string) => Promise<void>;
	mkdir?: (path: string) => Promise<void>;
}

const SORT_LINE_TOLERANCE = 0.012;

export function resolvePdfPortableBookDataLocation(sourcePath: unknown): PdfPortableBookDataLocation {
	const bookId = createPdfPortableBookId(sourcePath);
	const bookDir = normalizePath(`${PDF_PORTABLE_DATA_ROOT}/books/${bookId}`);
	return {
		bookId,
		bookDir,
		annotationsPath: normalizePath(`${bookDir}/annotations.json`),
		annotationsMarkdownPath: normalizePath(`${bookDir}/annotations.md`),
		indexPath: normalizePath(`${PDF_PORTABLE_DATA_ROOT}/index.json`),
	};
}

export function sortPdfTextAnnotationsByPosition(
	annotations: PdfTextAnnotation[]
): PdfTextAnnotation[] {
	return [...annotations].sort((left, right) => {
		const leftAnchor = getAnnotationSortAnchor(left);
		const rightAnchor = getAnnotationSortAnchor(right);
		if (leftAnchor.pageNumber !== rightAnchor.pageNumber) {
			return leftAnchor.pageNumber - rightAnchor.pageNumber;
		}
		if (Math.abs(leftAnchor.top - rightAnchor.top) > SORT_LINE_TOLERANCE) {
			return leftAnchor.top - rightAnchor.top;
		}
		if (leftAnchor.left !== rightAnchor.left) {
			return leftAnchor.left - rightAnchor.left;
		}
		if (leftAnchor.createdAt !== rightAnchor.createdAt) {
			return leftAnchor.createdAt - rightAnchor.createdAt;
		}
		return leftAnchor.id.localeCompare(rightAnchor.id);
	});
}

export class PdfTextAnnotationStore {
	constructor(private readonly app: App) {}

	async load(sourcePath: string, pageCount: number): Promise<PdfTextAnnotationLoadResult> {
		const normalizedSourcePath = normalizePath(sourcePath);
		const location = resolvePdfPortableBookDataLocation(normalizedSourcePath);
		const adapter = this.getAdapter();
		if (!adapter || typeof adapter.exists !== "function" || !(await adapter.exists(location.annotationsPath))) {
			return {
				exists: false,
				document: this.createEmpty(normalizedSourcePath, pageCount),
			};
		}

		try {
			const parsed = JSON.parse(await adapter.read?.(location.annotationsPath)) as unknown;
			return {
				exists: true,
				document: this.normalizeDocument(parsed, normalizedSourcePath, pageCount),
			};
		} catch {
			return {
				exists: true,
				document: this.createEmpty(normalizedSourcePath, pageCount),
			};
		}
	}

	async save(document: PdfTextAnnotationDocument): Promise<void> {
		const adapter = this.getAdapter();
		if (!adapter || typeof adapter.write !== "function") {
			throw new Error("Vault adapter is unavailable");
		}
		const normalizedSourcePath = normalizePath(document.sourcePath);
		const location = resolvePdfPortableBookDataLocation(normalizedSourcePath);
		await this.ensureFolder(location.bookDir);
		const payload: PdfTextAnnotationDocument = {
			format: PDF_TEXT_ANNOTATIONS_FORMAT,
			version: 1,
			bookId: location.bookId,
			sourcePath: normalizedSourcePath,
			pageCount: normalizePageCount(document.pageCount, 0),
			annotations: sortPdfTextAnnotationsByPosition(
				normalizeTextAnnotations(document.annotations, document.pageCount)
			),
			updatedAt: Date.now(),
		};
		await adapter.write(location.annotationsPath, JSON.stringify(payload, null, 2));
	}

	createDocument(
		sourcePath: string,
		pageCount: number,
		annotations: PdfTextAnnotation[]
	): PdfTextAnnotationDocument {
		const normalizedSourcePath = normalizePath(sourcePath);
		const location = resolvePdfPortableBookDataLocation(normalizedSourcePath);
		return {
			format: PDF_TEXT_ANNOTATIONS_FORMAT,
			version: 1,
			bookId: location.bookId,
			sourcePath: normalizedSourcePath,
			pageCount: normalizePageCount(pageCount, 0),
			annotations: sortPdfTextAnnotationsByPosition(
				normalizeTextAnnotations(annotations, pageCount)
			),
			updatedAt: Date.now(),
		};
	}

	private normalizeDocument(
		value: unknown,
		sourcePath: string,
		pageCount: number
	): PdfTextAnnotationDocument {
		const record = isRecord(value) ? value : {};
		const normalizedSourcePath = normalizePath(
			typeof record.sourcePath === "string" && record.sourcePath.trim()
				? record.sourcePath
				: sourcePath
		);
		const location = resolvePdfPortableBookDataLocation(normalizedSourcePath);
		const normalizedPageCount = normalizePageCount(record.pageCount, pageCount);
		return {
			format: PDF_TEXT_ANNOTATIONS_FORMAT,
			version: 1,
			bookId: location.bookId,
			sourcePath: normalizedSourcePath,
			pageCount: normalizedPageCount,
			annotations: sortPdfTextAnnotationsByPosition(
				normalizeTextAnnotations(record.annotations, normalizedPageCount)
			),
			updatedAt: normalizeTimestamp(record.updatedAt),
		};
	}

	private createEmpty(sourcePath: string, pageCount: number): PdfTextAnnotationDocument {
		const location = resolvePdfPortableBookDataLocation(sourcePath);
		return {
			format: PDF_TEXT_ANNOTATIONS_FORMAT,
			version: 1,
			bookId: location.bookId,
			sourcePath,
			pageCount: normalizePageCount(pageCount, 0),
			annotations: [],
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

function createPdfPortableBookId(sourcePath: unknown): string {
	const normalizedSourcePath = normalizePath(String(sourcePath || "").trim());
	const fileName = normalizedSourcePath.split("/").pop() || "document.pdf";
	const stem = fileName.replace(/\.[^/.]+$/, "");
	const safeStem =
		stem
			.trim()
			.replace(/[^A-Za-z0-9._-]+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "document";
	return `pdf-${safeStem}-${hashString(normalizedSourcePath)}`;
}

function getAnnotationSortAnchor(annotation: PdfTextAnnotation): {
	id: string;
	pageNumber: number;
	top: number;
	left: number;
	createdAt: number;
} {
	const rects = annotation.rects.length ? annotation.rects : [{ x: 1, y: 1, width: 0, height: 0 }];
	return {
		id: annotation.id,
		pageNumber: annotation.pageNumber,
		top: Math.min(...rects.map((rect) => rect.y)),
		left: Math.min(...rects.map((rect) => rect.x)),
		createdAt: annotation.createdAt,
	};
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
	if (!isRecord(value)) {
		return null;
	}
	const rects = Array.isArray(value.rects)
		? value.rects
				.map(normalizeTextRect)
				.filter((entry): entry is PdfTextAnnotationRect => Boolean(entry))
		: [];
	if (rects.length === 0) {
		return null;
	}
	return {
		id: typeof value.id === "string" && value.id ? value.id : createId(),
		pageNumber: normalizePageNumber(value.pageNumber, pageCount),
		kind: normalizeTextAnnotationKind(value.kind),
		color: normalizeColor(value.color, "#ffd54a"),
		text: typeof value.text === "string" ? value.text : "",
		note: normalizeOptionalText(value.note),
		semanticId: normalizeOptionalText(value.semanticId),
		semanticLabel: normalizeOptionalText(value.semanticLabel),
		semanticColor: normalizeOptionalText(value.semanticColor),
		semanticStyle: normalizeOptionalText(value.semanticStyle),
		rects,
		createdAt: normalizeTimestamp(value.createdAt),
	};
}

function normalizeTextRect(value: unknown): PdfTextAnnotationRect | null {
	if (!isRecord(value)) {
		return null;
	}
	const x = Number(value.x);
	const y = Number(value.y);
	const width = Number(value.width);
	const height = Number(value.height);
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

function normalizeTextAnnotationKind(value: unknown): PdfTextAnnotationKind {
	return value === "underline" || value === "wavy" || value === "strikethrough" || value === "note"
		? value
		: "highlight";
}

function normalizeOptionalText(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeColor(value: unknown, fallback: string): string {
	const text = typeof value === "string" ? value.trim() : "";
	return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function normalizePageCount(value: unknown, fallback: number): number {
	const pageCount = Number(value);
	return Number.isFinite(pageCount) && pageCount > 0
		? Math.floor(pageCount)
		: Math.max(0, Math.floor(Number(fallback) || 0));
}

function normalizePageNumber(value: unknown, pageCount: number): number {
	return Math.max(
		1,
		Math.min(Math.max(1, Math.floor(Number(pageCount) || 1)), Math.floor(Number(value) || 1))
	);
}

function normalizeTimestamp(value: unknown): number {
	const timestamp = Number(value);
	return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
	return `pdf-text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
