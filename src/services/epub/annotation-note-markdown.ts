import { EPUB_RUNTIME } from "./epub-runtime";
import type { EpubHighlightStyle } from "./types";
import { resolveAnnotationPresentation } from "./semantic/profiles";

export interface EpubAnnotationNoteBookInput {
	title?: string;
	author?: string;
	filePath: string;
	sourceId?: string;
	currentCfi?: string;
	currentChapterIndex?: number;
}

export interface EpubAnnotationNoteAnnotationInput {
	id?: string;
	cfiRange?: string;
	text?: string;
	segments?: Array<{ cfiRange?: string; text?: string }>;
	semanticId?: string;
	semanticLabel?: string;
	color?: string;
	style?: EpubHighlightStyle | string;
	commentText?: string;
	chapterIndex?: number;
	chapterTitle?: string;
	chapterRootTitle?: string;
	chapterRootHref?: string;
	chapterPath?: string[];
	chapterHref?: string;
	spineIndex?: number;
	createdTime?: number;
	updatedAt?: number;
	presentation?: string;
}

export interface RenderEpubAnnotationNoteMarkdownInput {
	book: EpubAnnotationNoteBookInput;
	bookId: string;
	annotations: EpubAnnotationNoteAnnotationInput[];
	semanticProfile?: unknown | null;
	now?: Date;
	dualWindowMode?: boolean;
}

interface EpubAnnotationNoteChapter {
	key: string;
	title: string;
	index?: number;
	sortIndex: number;
}

type ResolvedEpubAnnotationNoteAnnotation = EpubAnnotationNoteAnnotationInput & {
	noteChapter: EpubAnnotationNoteChapter;
};

const COLOR_STYLES: Record<string, { highlight: string; line: string }> = {
	yellow: { highlight: "rgba(255, 224, 102, 0.62)", line: "#f2b705" },
	blue: { highlight: "rgba(158, 216, 255, 0.42)", line: "#60a5fa" },
	red: { highlight: "rgba(255, 154, 154, 0.42)", line: "#f87171" },
	purple: { highlight: "rgba(167, 139, 250, 0.35)", line: "#a78bfa" },
	green: { highlight: "rgba(167, 232, 179, 0.45)", line: "#34d399" },
	orange: { highlight: "rgba(255, 201, 120, 0.46)", line: "#f59e0b" },
	cyan: { highlight: "rgba(139, 227, 231, 0.42)", line: "#22d3ee" },
	pink: { highlight: "rgba(255, 179, 209, 0.42)", line: "#fb7185" },
	gray: { highlight: "rgba(201, 205, 212, 0.42)", line: "#94a3b8" },
};

const MASK_STYLE =
	"background-image: repeating-linear-gradient(135deg, rgba(180, 83, 9, 0.34) 0 5px, rgba(245, 158, 11, 0.10) 5px 10px); color: var(--text-normal); border-radius: 4px; padding: 0 3px;";

const TEXT = {
	untitledBook: "\u672a\u547d\u540d\u4e66\u7c4d",
	noteTitle: "\u6807\u6ce8\u7b14\u8bb0",
	returnToBook: "\u8fd4\u56de\u9605\u8bfb\u672c\u4e66",
	readonlyNotice:
		"\u8fd9\u662f\u7531 Weave Reader \u6839\u636e `annotations.json` \u81ea\u52a8\u751f\u6210\u7684\u53ea\u8bfb\u6d3e\u751f\u6587\u4ef6\u3002\u91cd\u65b0\u6253\u5f00\u6807\u6ce8\u7b14\u8bb0\u65f6\uff0c\u672c\u6587\u4ef6\u53ef\u80fd\u88ab\u8986\u76d6\u3002",
	dataId: "\u6570\u636e ID",
	generatedAt: "\u751f\u6210\u65f6\u95f4",
	author: "\u4f5c\u8005",
	noAnnotations: "\u6682\u65e0\u6807\u6ce8\u3002",
	unlocatedChapter: "\u672a\u5b9a\u4f4d\u7ae0\u8282",
	unsemantic: "\u672a\u6807\u6ce8\u8bed\u4e49",
	comment: "\u5907\u6ce8",
	dualWindow: "\u53cc\u7a97\u6a21\u5f0f",
};

function escapeHtml(value: unknown): string {
	return String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function normalizeInlineAnnotationText(value: unknown): string {
	return String(value || "")
		.replace(/\s+/g, " ")
		.trim();
}

function getAnnotationDisplayText(annotation: EpubAnnotationNoteAnnotationInput): string {
	const segments = Array.isArray(annotation.segments)
		? annotation.segments
				.map((segment) => String(segment?.text || "").trim())
				.filter(Boolean)
		: [];
	return segments.length > 1 ? segments.join("\n") : String(annotation.text || "").trim();
}

function escapeAnnotationDisplayText(value: unknown): string {
	return escapeHtml(String(value || "").trim())
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\n+/g, "<br>");
}

function encodeQueryValue(value: unknown): string {
	return encodeURIComponent(String(value || "").trim());
}

function normalizeColorToken(value: unknown): string {
	const token = String(value || "").trim().toLowerCase();
	return COLOR_STYLES[token] ? token : "yellow";
}

function normalizeStyle(value: unknown): "highlight" | "underline" | "strikethrough" | "wavy" {
	const token = String(value || "").trim().toLowerCase();
	return token === "underline" || token === "strikethrough" || token === "wavy"
		? token
		: "highlight";
}

function buildProtocolHref(input: {
	filePath: string;
	cfi?: string;
	text?: string;
	chapterIndex?: number;
	sourceId?: string;
	flashStyle?: "pulse" | "highlight" | "none";
	flashColor?: string;
	showLocateOverlay?: boolean;
}): string {
	const parts = [`file=${encodeQueryValue(input.filePath)}`];
	const cfi = String(input.cfi || "").trim();
	if (cfi) {
		parts.push(`cfi=${cfi}`);
	}
	const text = String(input.text || "").trim();
	if (text) {
		parts.push(`text=${encodeQueryValue(text)}`);
	}
	if (typeof input.chapterIndex === "number" && Number.isFinite(input.chapterIndex)) {
		parts.push(`chapter=${input.chapterIndex}`);
	}
	const sourceId = String(input.sourceId || "").trim();
	if (sourceId) {
		parts.push(`sid=${encodeQueryValue(sourceId)}`);
	}
	const flashStyle = String(input.flashStyle || "").trim();
	if (flashStyle) {
		parts.push(`flashStyle=${encodeQueryValue(flashStyle)}`);
	}
	const flashColor = String(input.flashColor || "").trim();
	if (flashColor) {
		parts.push(`flashColor=${encodeQueryValue(flashColor)}`);
	}
	if (typeof input.showLocateOverlay === "boolean") {
		parts.push(`showLocateOverlay=${input.showLocateOverlay ? "true" : "false"}`);
	}
	return `obsidian://${EPUB_RUNTIME.protocol.primaryName}?${parts.join("&")}`;
}

function getCfiSortKey(cfi: unknown): number[] {
	const text = String(cfi || "");
	const structuralText = text.replace(/\[[^\]]*]/g, "");
	return Array.from(structuralText.matchAll(/\d+/g)).map((match) => Number(match[0]));
}

function compareNumberArrays(left: number[], right: number[]): number {
	const max = Math.max(left.length, right.length);
	for (let index = 0; index < max; index += 1) {
		const diff = (left[index] ?? -1) - (right[index] ?? -1);
		if (diff !== 0) {
			return diff;
		}
	}
	return 0;
}

function normalizeChapterPath(value: unknown): string[] {
	return Array.isArray(value)
		? value.map((entry) => String(entry || "").trim()).filter(Boolean)
		: [];
}

function normalizeSortIndex(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.floor(value))
		: Number.MAX_SAFE_INTEGER;
}

function getChapterDisplayTitle(annotation: EpubAnnotationNoteAnnotationInput): string {
	const storedPath = normalizeChapterPath(annotation.chapterPath);
	const rootTitle = String(annotation.chapterRootTitle || "").trim();
	if (rootTitle) {
		return rootTitle;
	}
	if (storedPath.length > 0) {
		return storedPath[0] || TEXT.unlocatedChapter;
	}
	const leafTitle = String(annotation.chapterTitle || "").trim();
	if (leafTitle) {
		return leafTitle;
	}
	if (typeof annotation.chapterIndex === "number" && Number.isFinite(annotation.chapterIndex)) {
		return `\u7b2c ${annotation.chapterIndex + 1} \u7ae0`;
	}
	return TEXT.unlocatedChapter;
}

function getStoredChapter(annotation: EpubAnnotationNoteAnnotationInput): EpubAnnotationNoteChapter {
	const title = getChapterDisplayTitle(annotation);
	const storedPath = normalizeChapterPath(annotation.chapterPath);
	const rootTitle = String(annotation.chapterRootTitle || storedPath[0] || "").trim();
	const rootHref = String(annotation.chapterRootHref || "").trim();
	const chapterHref = String(annotation.chapterHref || "").trim();
	const chapterIndex =
		typeof annotation.chapterIndex === "number" && Number.isFinite(annotation.chapterIndex)
			? annotation.chapterIndex
			: undefined;
	const chapterHrefLooksRoot =
		Boolean(chapterHref) &&
		(storedPath.length <= 1 || (rootTitle && String(annotation.chapterTitle || "").trim() === rootTitle));
	const key =
		rootHref ||
		(chapterHrefLooksRoot ? chapterHref : "") ||
		(typeof chapterIndex === "number" ? `chapter-${chapterIndex}` : `title-${title}`);
	return {
		key,
		title,
		index: chapterIndex,
		sortIndex: normalizeSortIndex(annotation.spineIndex),
	};
}

function resolveAnnotationChapters(
	annotations: EpubAnnotationNoteAnnotationInput[]
): ResolvedEpubAnnotationNoteAnnotation[] {
	return annotations.map((annotation) => ({
		...annotation,
		noteChapter: getStoredChapter(annotation),
	}));
}

function getSemanticId(annotation: EpubAnnotationNoteAnnotationInput): string {
	return String(annotation.semanticId || "").trim() || "unsemantic";
}

function getSemanticLabel(annotation: EpubAnnotationNoteAnnotationInput): string {
	return (
		String(annotation.semanticLabel || "").trim() ||
		String(annotation.semanticId || "").trim() ||
		TEXT.unsemantic
	);
}

function sortAnnotations(
	annotations: ResolvedEpubAnnotationNoteAnnotation[]
): ResolvedEpubAnnotationNoteAnnotation[] {
	return [...annotations].sort((left, right) => {
		const leftHasSpine = left.noteChapter.sortIndex !== Number.MAX_SAFE_INTEGER;
		const rightHasSpine = right.noteChapter.sortIndex !== Number.MAX_SAFE_INTEGER;
		if (leftHasSpine && rightHasSpine) {
			const spineDiff = left.noteChapter.sortIndex - right.noteChapter.sortIndex;
			if (spineDiff !== 0) {
				return spineDiff;
			}
		}
		const cfiDiff = compareNumberArrays(getCfiSortKey(left.cfiRange), getCfiSortKey(right.cfiRange));
		if (cfiDiff !== 0) {
			return cfiDiff;
		}
		return (left.createdTime || 0) - (right.createdTime || 0);
	});
}

function renderStyledText(annotation: EpubAnnotationNoteAnnotationInput): string {
	const color = normalizeColorToken(annotation.color);
	const style = normalizeStyle(annotation.style);
	const palette = COLOR_STYLES[color] || COLOR_STYLES.yellow;
	const text = escapeAnnotationDisplayText(getAnnotationDisplayText(annotation));
	const semanticLabel = escapeHtml(annotation.semanticLabel || annotation.semanticId || "");
	const semanticAttr = semanticLabel ? ` data-semantic="${semanticLabel}"` : "";

	if (style === "strikethrough") {
		return `<span${semanticAttr} style="${MASK_STYLE}">${text}</span>`;
	}
	if (style === "underline" || style === "wavy") {
		const wavy = style === "wavy" ? " text-decoration-style: wavy;" : "";
		return `<span${semanticAttr} style="text-decoration-line: underline;${wavy} text-decoration-color: ${palette.line}; text-decoration-thickness: ${style === "wavy" ? "1.6px" : "2px"}; text-underline-offset: 4px; color: var(--text-normal);">${text}</span>`;
	}
	return `<mark${semanticAttr} style="background: ${palette.highlight}; color: var(--text-normal); border-radius: 4px; padding: 0 2px;">${text}</mark>`;
}

function renderAnnotationLine(
	annotation: ResolvedEpubAnnotationNoteAnnotation,
	bookId: string,
	book: EpubAnnotationNoteBookInput
): string {
	const chapterIndex = annotation.noteChapter.index;
	const chapterTitle = annotation.noteChapter.title;
	const semanticId = getSemanticId(annotation);
	const semanticLabel = getSemanticLabel(annotation);
	const cfiRange = String(annotation.cfiRange || "").trim();
	const annotationText = normalizeInlineAnnotationText(getAnnotationDisplayText(annotation));
	const href = buildProtocolHref({
		filePath: book.filePath,
		cfi: cfiRange,
		text: annotationText,
		chapterIndex: annotation.chapterIndex,
		sourceId: book.sourceId,
		flashStyle: "highlight",
		flashColor: "yellow",
		showLocateOverlay: true,
	});
	const styledText = renderStyledText(annotation);
	const lines = [
		`<div class="weave-annotation-note-line" data-book-id="${escapeHtml(bookId)}" data-source-file="${escapeHtml(book.filePath)}" data-annotation-id="${escapeHtml(annotation.id || "")}" data-cfi-range="${escapeHtml(cfiRange)}" data-chapter-key="${escapeHtml(annotation.noteChapter.key)}" data-chapter-index="${typeof chapterIndex === "number" ? chapterIndex : ""}" data-chapter-title="${escapeHtml(chapterTitle)}" data-semantic-id="${escapeHtml(semanticId)}" data-semantic-label="${escapeHtml(semanticLabel)}" data-annotation-text="${escapeHtml(annotationText)}"><a href="${escapeHtml(href)}" style="text-decoration: none; color: var(--text-normal);">${styledText}</a>`,
	];
	const comment = String(annotation.commentText || "").trim();
	if (comment) {
		lines.push(`<div class="weave-annotation-note-comment">${TEXT.comment}: ${escapeHtml(comment)}</div>`);
	}
	lines.push("</div>");
	return lines.join("\n");
}

function renderChapterHeading(annotation: ResolvedEpubAnnotationNoteAnnotation): string {
	const chapterIndex = annotation.noteChapter.index;
	const chapterTitle = annotation.noteChapter.title;
	return `<h2 class="weave-annotation-note-chapter" data-chapter-key="${escapeHtml(annotation.noteChapter.key)}" data-chapter-index="${typeof chapterIndex === "number" ? chapterIndex : ""}" data-chapter-title="${escapeHtml(chapterTitle)}">${escapeHtml(chapterTitle)}</h2>`;
}

function resolveAnnotation(
	annotation: EpubAnnotationNoteAnnotationInput,
	profile: unknown
): EpubAnnotationNoteAnnotationInput {
	return resolveAnnotationPresentation(annotation, profile) as EpubAnnotationNoteAnnotationInput;
}

export function renderEpubAnnotationNoteMarkdown(
	input: RenderEpubAnnotationNoteMarkdownInput
): string {
	const bookTitle = String(input.book.title || "").trim() || TEXT.untitledBook;
	const author = String(input.book.author || "").trim();
	const generatedAt = (input.now || new Date()).toLocaleString("zh-CN", { hour12: false });
	const dualWindowMode = input.dualWindowMode === true;
	const annotations = sortAnnotations(
		resolveAnnotationChapters(
			(input.annotations || [])
				.map((annotation) => resolveAnnotation(annotation, input.semanticProfile))
				.filter((annotation) => String(annotation.text || "").trim())
		)
	);

	const lines: string[] = [
		`# ${bookTitle} - ${TEXT.noteTitle}`,
		"",
		`<a class="weave-annotation-note-return" href="${escapeHtml(buildProtocolHref({
			filePath: input.book.filePath,
			cfi: input.book.currentCfi,
			chapterIndex: input.book.currentChapterIndex,
			sourceId: input.book.sourceId,
			flashStyle: input.book.currentCfi ? "pulse" : undefined,
			showLocateOverlay: Boolean(input.book.currentCfi),
		}))}">${TEXT.returnToBook}</a>`,
		...(dualWindowMode
			? []
			: [
					`<button class="weave-annotation-note-dual-window" type="button" data-weave-dual-window-action="open" data-book-id="${escapeHtml(input.bookId)}" data-source-file="${escapeHtml(input.book.filePath)}">${TEXT.dualWindow}</button>`,
				]),
		`<div class="weave-annotation-note-root" data-book-id="${escapeHtml(input.bookId)}" data-source-file="${escapeHtml(input.book.filePath)}" data-dual-window-mode="${dualWindowMode ? "true" : "false"}"></div>`,
		"",
		`> ${TEXT.readonlyNotice}`,
		"",
		`- ${TEXT.dataId}: \`${escapeHtml(input.bookId)}\``,
		`- ${TEXT.generatedAt}: ${escapeHtml(generatedAt)}`,
	];
	if (author) {
		lines.push(`- ${TEXT.author}: ${escapeHtml(author)}`);
	}
	lines.push("");

	if (annotations.length === 0) {
		lines.push(`> ${TEXT.noAnnotations}`);
		return `${lines.join("\n").trim()}\n`;
	}

	let currentChapter = "";
	for (const annotation of annotations) {
		const chapterTitle = annotation.noteChapter.title;
		if (chapterTitle !== currentChapter) {
			currentChapter = chapterTitle;
			lines.push(renderChapterHeading(annotation), "");
		}
		lines.push(renderAnnotationLine(annotation, input.bookId, input.book), "");
	}

	return `${lines.join("\n").trim()}\n`;
}
