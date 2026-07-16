export const EPUB_DUAL_WINDOW_ANNOTATION_EVENT = "weave-epub-dual-window-annotation";
export const EPUB_DUAL_WINDOW_SESSION_EVENT = "weave-epub-dual-window-session";

export type EpubDualWindowMode = "book-annotation-note" | "annotation-compare" | "book-translation";

export type EpubDualWindowAnnotationPhase = "enter" | "leave" | "click";

export interface EpubDualWindowAnnotationDetail {
	mode: EpubDualWindowMode;
	phase: EpubDualWindowAnnotationPhase;
	bookId: string;
	filePath: string;
	cfiRange: string;
	annotationId?: string;
	semanticId?: string;
	text?: string;
}

export interface EpubDualWindowSessionDetail {
	mode: EpubDualWindowMode;
	bookId: string;
	filePath: string;
	notePath: string;
	active: boolean;
}

function cleanString(value: unknown): string {
	return String(value || "").trim();
}

export function createEpubDualWindowAnnotationDetail(
	input: Partial<EpubDualWindowAnnotationDetail>
): EpubDualWindowAnnotationDetail | null {
	const bookId = cleanString(input.bookId);
	const filePath = cleanString(input.filePath);
	const cfiRange = cleanString(input.cfiRange);
	const phase = cleanString(input.phase) as EpubDualWindowAnnotationPhase;
	if (!bookId || !filePath || !cfiRange || !["enter", "leave", "click"].includes(phase)) {
		return null;
	}
	return {
		mode: input.mode || "book-annotation-note",
		phase,
		bookId,
		filePath,
		cfiRange,
		...(cleanString(input.annotationId) ? { annotationId: cleanString(input.annotationId) } : {}),
		...(cleanString(input.semanticId) ? { semanticId: cleanString(input.semanticId) } : {}),
		...(cleanString(input.text) ? { text: cleanString(input.text) } : {}),
	};
}

export function dispatchEpubDualWindowAnnotationEvent(
	targetWindow: Window,
	input: Partial<EpubDualWindowAnnotationDetail>
): boolean {
	const detail = createEpubDualWindowAnnotationDetail(input);
	if (!detail) {
		return false;
	}
	targetWindow.dispatchEvent(new CustomEvent(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, { detail }));
	return true;
}

export function dispatchEpubDualWindowSessionEvent(
	targetWindow: Window,
	detail: EpubDualWindowSessionDetail
): void {
	targetWindow.dispatchEvent(new CustomEvent(EPUB_DUAL_WINDOW_SESSION_EVENT, { detail }));
}
