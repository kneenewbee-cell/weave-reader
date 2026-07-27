import { TFile, loadPdfJs } from "obsidian";
import type { App } from "obsidian";

export interface PdfBookshelfInfo {
	title?: string;
	author?: string;
	pageCount?: number;
	coverImage?: string;
}

export interface PdfBookshelfMetadata {
	title?: string;
	author?: string;
	coverImage?: string;
	pageCount?: number;
}

export interface LoadPdfBookshelfInfoOptions {
	renderCover?: boolean;
	coverMaxWidth?: number;
	coverMaxHeight?: number;
}

export interface PdfDocumentLike {
	numPages: number;
	getMetadata?: () => Promise<{ info?: unknown } | null>;
	getPage?: (pageNumber: number) => Promise<any>;
	destroy?: () => Promise<void> | void;
}

export type PdfCoverRenderer = (
	pdf: PdfDocumentLike,
	options: LoadPdfBookshelfInfoOptions
) => Promise<string | undefined>;

function normalizeText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readInfoText(info: Record<string, unknown>, key: string): string {
	return normalizeText(info[key] ?? info[`/${key}`]);
}

function isDescriptivePdfTitle(value: string): boolean {
	const normalized = normalizeText(value);
	if (!normalized) {
		return false;
	}

	return !/\.pdf$/i.test(normalized);
}

function normalizePositiveInteger(value: unknown): number | undefined {
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) {
		return undefined;
	}

	return Math.floor(numeric);
}

export function normalizePdfDocumentInfo(info: unknown): Pick<PdfBookshelfInfo, "title" | "author"> {
	if (!info || typeof info !== "object") {
		return {};
	}

	const record = info as Record<string, unknown>;
	const title = readInfoText(record, "Title");
	const author = readInfoText(record, "Author");
	const normalized: Pick<PdfBookshelfInfo, "title" | "author"> = {};

	if (isDescriptivePdfTitle(title)) {
		normalized.title = title;
	}
	if (author) {
		normalized.author = author;
	}

	return normalized;
}

export function buildPdfBookshelfStatsParts(info: Pick<PdfBookshelfInfo, "pageCount">): string[] {
	const pageCount = normalizePositiveInteger(info.pageCount);
	return [
		pageCount ? `${pageCount} 页` : "",
		"PDF",
	].filter(Boolean);
}

export function mergePdfBookshelfInfoIntoMeta<T extends PdfBookshelfMetadata>(
	existing: T,
	info: PdfBookshelfInfo
): { metadata: T; changed: boolean } {
	const next: T = { ...existing };
	let changed = false;

	const title = normalizeText(info.title);
	if (!normalizeText(existing.title) && title) {
		next.title = title;
		changed = true;
	}

	const author = normalizeText(info.author);
	if (author && author !== normalizeText(existing.author)) {
		next.author = author;
		changed = true;
	}

	const pageCount = normalizePositiveInteger(info.pageCount);
	if (pageCount && pageCount !== existing.pageCount) {
		next.pageCount = pageCount;
		changed = true;
	}

	const coverImage = normalizeText(info.coverImage);
	if (coverImage && coverImage !== normalizeText(existing.coverImage)) {
		next.coverImage = coverImage;
		changed = true;
	}

	return { metadata: next, changed };
}

async function renderPdfFirstPageCover(
	pdf: PdfDocumentLike,
	options: LoadPdfBookshelfInfoOptions
): Promise<string | undefined> {
	if (typeof document === "undefined") {
		return undefined;
	}
	if (typeof pdf.getPage !== "function") {
		return undefined;
	}

	const page = await pdf.getPage(1);
	const baseViewport = page.getViewport({ scale: 1 });
	const maxWidth = options.coverMaxWidth ?? 360;
	const maxHeight = options.coverMaxHeight ?? 520;
	const scale = Math.max(
		0.2,
		Math.min(maxWidth / baseViewport.width, maxHeight / baseViewport.height, 1.6)
	);
	const outputScale = Math.max(
		1,
		Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1)
	);
	const viewport = page.getViewport({ scale: scale * outputScale });
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.ceil(viewport.width));
	canvas.height = Math.max(1, Math.ceil(viewport.height));

	const context = canvas.getContext("2d", { alpha: false });
	if (!context) {
		return undefined;
	}

	context.fillStyle = "#ffffff";
	context.fillRect(0, 0, canvas.width, canvas.height);
	await page.render({ canvasContext: context, viewport }).promise;

	return canvas.toDataURL("image/jpeg", 0.82);
}

export async function buildPdfBookshelfInfoFromDocument(
	pdf: PdfDocumentLike,
	options: LoadPdfBookshelfInfoOptions = {},
	renderCover: PdfCoverRenderer = renderPdfFirstPageCover
): Promise<PdfBookshelfInfo> {
	const metadata = await pdf.getMetadata?.().catch(() => null);
	const info: PdfBookshelfInfo = {
		...normalizePdfDocumentInfo(metadata?.info),
		pageCount: normalizePositiveInteger(pdf.numPages),
	};

	if (options.renderCover !== false && pdf.numPages > 0) {
		info.coverImage = await renderCover(pdf, options).catch(() => undefined);
	}

	return info;
}

async function loadPdfSummaryFromBytes(data: Uint8Array): Promise<PdfBookshelfInfo> {
	const { PDFDocument } = await import("pdf-lib");
	const pdf = await PDFDocument.load(data.slice(), {
		ignoreEncryption: true,
		updateMetadata: false,
	});
	return {
		...normalizePdfDocumentInfo({
			Title: pdf.getTitle() || "",
			Author: pdf.getAuthor() || "",
		}),
		pageCount: normalizePositiveInteger(pdf.getPageCount()),
	};
}

async function renderPdfCoverFromBytes(
	data: Uint8Array,
	options: LoadPdfBookshelfInfoOptions
): Promise<string | undefined> {
	const pdfjs = await loadPdfJs();
	const loadingTask = pdfjs.getDocument({
		data: data.slice(),
	});
	const pdf = await loadingTask.promise;

	try {
		return await renderPdfFirstPageCover(pdf, options);
	} finally {
		if (typeof pdf.destroy === "function") {
			await pdf.destroy();
		}
	}
}

export async function loadPdfBookshelfInfo(
	app: App,
	filePath: string,
	options: LoadPdfBookshelfInfoOptions = {}
): Promise<PdfBookshelfInfo> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) {
		return {};
	}

	const data = new Uint8Array(await app.vault.readBinary(file));
	const info = await loadPdfSummaryFromBytes(data).catch(() => ({}));

	if (options.renderCover !== false) {
		const coverImage = await renderPdfCoverFromBytes(data, options).catch(() => undefined);
		if (coverImage) {
			info.coverImage = coverImage;
		}
	}

	return info;
}
