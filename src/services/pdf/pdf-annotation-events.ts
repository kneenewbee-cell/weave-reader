import { normalizePath } from "obsidian";

export const PDF_ANNOTATIONS_CHANGED_EVENT = "weave-reader:pdf-annotations-changed";

export interface PdfAnnotationsChangedDetail {
	filePath: string;
	bookId?: string;
	reason?: string;
	modules?: string[];
}

export function normalizePdfAnnotationsChangedDetail(
	value: unknown,
): PdfAnnotationsChangedDetail | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const filePath = normalizePath(String(record.filePath || "").trim());
	if (!filePath) {
		return null;
	}
	return {
		filePath,
		bookId: String(record.bookId || "").trim() || undefined,
		reason: String(record.reason || "").trim() || undefined,
		modules: Array.isArray(record.modules)
			? record.modules.map((entry) => String(entry || "").trim()).filter(Boolean)
			: undefined,
	};
}

export function dispatchPdfAnnotationsChanged(
	detail: PdfAnnotationsChangedDetail,
	target: Pick<Window, "dispatchEvent"> = window,
): void {
	const normalizedDetail = normalizePdfAnnotationsChangedDetail(detail);
	if (!normalizedDetail) {
		return;
	}
	target.dispatchEvent(
		new CustomEvent(PDF_ANNOTATIONS_CHANGED_EVENT, { detail: normalizedDetail }),
	);
}
