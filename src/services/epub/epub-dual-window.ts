export const EPUB_DUAL_WINDOW_ANNOTATION_EVENT = "weave-epub-dual-window-annotation";
export const EPUB_DUAL_WINDOW_SESSION_EVENT = "weave-epub-dual-window-session";
export const EPUB_DUAL_WINDOW_READER_DISPLAY_EVENT = "weave-epub-dual-window-reader-display";
export const EPUB_ANNOTATION_COMPARE_CONTEXT_EVENT = "weave-epub-annotation-compare-context";

export type EpubDualWindowMode = "book-annotation-note" | "annotation-compare" | "book-translation";
export type EpubAnnotationComparePaneRole = "editable" | "readonly";
export type EpubDualWindowReaderFlowMode = "paginated" | "scrolled";
export type EpubDualWindowReaderLayoutMode = "paginated" | "double";

export interface EpubAnnotationCompareContext {
	mode: "annotation-compare";
	sessionId: string;
	bookId: string;
	filePath: string;
	versionId: string;
	versionName?: string;
	counterpartVersionId?: string;
	counterpartVersionName?: string;
	paneRole: EpubAnnotationComparePaneRole;
	syncPosition?: boolean;
}

export interface EpubAnnotationCompareContextInput {
	sessionId: unknown;
	bookId: unknown;
	filePath: unknown;
	editableVersionId: unknown;
	editableVersionName?: unknown;
	readonlyVersionId: unknown;
	readonlyVersionName?: unknown;
	syncPosition?: boolean;
}

export interface EpubAnnotationCompareContextChangeDetail {
	sourceId: string;
	filePath: string;
	annotationCompare: EpubAnnotationCompareContext | null;
}

export interface EpubReaderStateChangeRemountInput {
	currentFilePath?: unknown;
	incomingFilePath?: unknown;
}

export interface EpubReaderPrimaryToolbarVisibilityInput {
	filePath?: unknown;
	isMobile?: boolean;
	annotationCompare?: unknown;
}

export type EpubDualWindowAnnotationPhase = "enter" | "leave" | "click";

export interface EpubDualWindowAnnotationDetail {
	mode: EpubDualWindowMode;
	phase: EpubDualWindowAnnotationPhase;
	bookId: string;
	filePath: string;
	cfiRange: string;
	chapterIndex?: number;
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

export interface EpubDualWindowReaderDisplayDetail {
	mode: "annotation-compare";
	sessionId: string;
	filePath: string;
	sourceId?: string;
	flowMode?: EpubDualWindowReaderFlowMode;
	layoutMode?: EpubDualWindowReaderLayoutMode;
}

export interface EpubAnnotationCompareExitPlan<T> {
	keepEntries: T[];
	closeEntries: T[];
}

function cleanString(value: unknown): string {
	return String(value || "").trim();
}

function cleanFiniteNumber(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	const stringValue = cleanString(value);
	if (!stringValue) {
		return null;
	}
	const numberValue = Number(stringValue);
	return Number.isFinite(numberValue) ? numberValue : null;
}

export function shouldRemountEpubReaderForStateChange(
	input: EpubReaderStateChangeRemountInput
): boolean {
	const currentFilePath = cleanString(input.currentFilePath);
	const incomingFilePath = cleanString(input.incomingFilePath);
	return Boolean(incomingFilePath && incomingFilePath !== currentFilePath);
}

export function createEpubAnnotationCompareContexts(
	input: EpubAnnotationCompareContextInput
): { editable: EpubAnnotationCompareContext; readonly: EpubAnnotationCompareContext } | null {
	const sessionId = cleanString(input.sessionId);
	const bookId = cleanString(input.bookId);
	const filePath = cleanString(input.filePath);
	const editableVersionId = cleanString(input.editableVersionId);
	const readonlyVersionId = cleanString(input.readonlyVersionId);
	if (!sessionId || !bookId || !filePath || !editableVersionId || !readonlyVersionId) {
		return null;
	}
	if (editableVersionId === readonlyVersionId) {
		return null;
	}
	const editableVersionName = cleanString(input.editableVersionName);
	const readonlyVersionName = cleanString(input.readonlyVersionName);
	const syncPosition = input.syncPosition !== false;
	return {
		editable: {
			mode: "annotation-compare",
			sessionId,
			bookId,
			filePath,
			versionId: editableVersionId,
			...(editableVersionName ? { versionName: editableVersionName } : {}),
			counterpartVersionId: readonlyVersionId,
			...(readonlyVersionName ? { counterpartVersionName: readonlyVersionName } : {}),
			paneRole: "editable",
			syncPosition,
		},
		readonly: {
			mode: "annotation-compare",
			sessionId,
			bookId,
			filePath,
			versionId: readonlyVersionId,
			...(readonlyVersionName ? { versionName: readonlyVersionName } : {}),
			counterpartVersionId: editableVersionId,
			...(editableVersionName ? { counterpartVersionName: editableVersionName } : {}),
			paneRole: "readonly",
			syncPosition,
		},
	};
}

export function normalizeEpubAnnotationCompareContext(
	value: unknown
): EpubAnnotationCompareContext | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	if (record.mode !== "annotation-compare") {
		return null;
	}
	const sessionId = cleanString(record.sessionId);
	const bookId = cleanString(record.bookId);
	const filePath = cleanString(record.filePath);
	const versionId = cleanString(record.versionId);
	const paneRole = cleanString(record.paneRole) as EpubAnnotationComparePaneRole;
	if (!sessionId || !bookId || !filePath || !versionId || !["editable", "readonly"].includes(paneRole)) {
		return null;
	}
	return {
		mode: "annotation-compare",
		sessionId,
		bookId,
		filePath,
		versionId,
		...(cleanString(record.versionName) ? { versionName: cleanString(record.versionName) } : {}),
		...(cleanString(record.counterpartVersionId)
			? { counterpartVersionId: cleanString(record.counterpartVersionId) }
			: {}),
		...(cleanString(record.counterpartVersionName)
			? { counterpartVersionName: cleanString(record.counterpartVersionName) }
			: {}),
		paneRole,
		...(record.syncPosition === false ? { syncPosition: false } : { syncPosition: true }),
	};
}

export function normalizeEpubAnnotationCompareContextChangeDetail(
	value: unknown
): EpubAnnotationCompareContextChangeDetail | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const sourceId = cleanString(record.sourceId);
	const filePath = cleanString(record.filePath);
	if (!sourceId || !filePath) {
		return null;
	}
	return {
		sourceId,
		filePath,
		annotationCompare: normalizeEpubAnnotationCompareContext(record.annotationCompare),
	};
}

export function dispatchEpubAnnotationCompareContextEvent(
	targetWindow: Window,
	detail: EpubAnnotationCompareContextChangeDetail
): boolean {
	const normalizedDetail = normalizeEpubAnnotationCompareContextChangeDetail(detail);
	if (!normalizedDetail) {
		return false;
	}
	return targetWindow.dispatchEvent(
		new CustomEvent(EPUB_ANNOTATION_COMPARE_CONTEXT_EVENT, {
			detail: normalizedDetail,
		})
	);
}

export function shouldShowEpubReaderPrimaryToolbar(
	input: EpubReaderPrimaryToolbarVisibilityInput
): boolean {
	if (input.isMobile || !cleanString(input.filePath)) {
		return false;
	}
	const annotationCompare = normalizeEpubAnnotationCompareContext(input.annotationCompare);
	return annotationCompare?.paneRole !== "readonly";
}

export function normalizeEpubDualWindowReaderDisplayDetail(
	value: unknown
): EpubDualWindowReaderDisplayDetail | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	if (record.mode !== "annotation-compare") {
		return null;
	}
	const sessionId = cleanString(record.sessionId);
	const filePath = cleanString(record.filePath);
	const flowMode = cleanString(record.flowMode) as EpubDualWindowReaderFlowMode;
	const layoutMode = cleanString(record.layoutMode) as EpubDualWindowReaderLayoutMode;
	const hasFlowMode = ["paginated", "scrolled"].includes(flowMode);
	const hasLayoutMode = ["paginated", "double"].includes(layoutMode);
	if (!sessionId || !filePath || (!hasFlowMode && !hasLayoutMode)) {
		return null;
	}
	return {
		mode: "annotation-compare",
		sessionId,
		filePath,
		...(cleanString(record.sourceId) ? { sourceId: cleanString(record.sourceId) } : {}),
		...(hasFlowMode ? { flowMode } : {}),
		...(hasLayoutMode ? { layoutMode } : {}),
	};
}

export function dispatchEpubDualWindowReaderDisplayEvent(
	targetWindow: Window,
	input: Partial<EpubDualWindowReaderDisplayDetail>
): boolean {
	const detail = normalizeEpubDualWindowReaderDisplayDetail({
		...input,
		mode: "annotation-compare",
	});
	if (!detail) {
		return false;
	}
	targetWindow.dispatchEvent(new CustomEvent(EPUB_DUAL_WINDOW_READER_DISPLAY_EVENT, { detail }));
	return true;
}

export function resolveEpubAnnotationCompareExitPlan<T>(
	entries: T[],
	getContext: (entry: T) => unknown
): EpubAnnotationCompareExitPlan<T> {
	const keepEntries: T[] = [];
	const closeEntries: T[] = [];
	for (const entry of entries) {
		const context = normalizeEpubAnnotationCompareContext(getContext(entry));
		if (!context) {
			continue;
		}
		if (context.paneRole === "readonly") {
			closeEntries.push(entry);
		} else {
			keepEntries.push(entry);
		}
	}
	return { keepEntries, closeEntries };
}

export function createEpubDualWindowAnnotationDetail(
	input: Partial<EpubDualWindowAnnotationDetail>
): EpubDualWindowAnnotationDetail | null {
	const bookId = cleanString(input.bookId);
	const filePath = cleanString(input.filePath);
	const cfiRange = cleanString(input.cfiRange);
	const phase = cleanString(input.phase) as EpubDualWindowAnnotationPhase;
	const chapterIndex = cleanFiniteNumber(input.chapterIndex);
	if (!bookId || !filePath || !cfiRange || !["enter", "leave", "click"].includes(phase)) {
		return null;
	}
	return {
		mode: input.mode || "book-annotation-note",
		phase,
		bookId,
		filePath,
		cfiRange,
		...(chapterIndex !== null ? { chapterIndex } : {}),
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
