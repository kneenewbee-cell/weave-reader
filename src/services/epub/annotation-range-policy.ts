import { EpubLinkService } from "./EpubLinkService";
import { normalizeHighlightQuoteText } from "./highlight/highlight-identity";
import type { ReaderHighlight } from "./reader-engine-types";

export type AnnotationRangeRelation = "same-range" | "different-range";

export function getAnnotationRangeKey(highlight: Pick<ReaderHighlight, "cfiRange" | "text">): string {
	const cfi = EpubLinkService.normalizeCfi(String(highlight.cfiRange || "").trim());
	const text = normalizeHighlightQuoteText(highlight.text);
	return cfi && text ? `${cfi}\0text:${text}` : "";
}

export function getAnnotationSemanticKey(highlight: Pick<ReaderHighlight, "semanticId">): string {
	return String(highlight.semanticId || "").trim();
}

export function getAnnotationRangeRelation(
	a: Pick<ReaderHighlight, "cfiRange" | "text">,
	b: Pick<ReaderHighlight, "cfiRange" | "text">
): AnnotationRangeRelation {
	const left = getAnnotationRangeKey(a);
	const right = getAnnotationRangeKey(b);
	return left && left === right ? "same-range" : "different-range";
}

export function findSameAnnotationRange<T extends Pick<ReaderHighlight, "cfiRange" | "text">>(
	highlights: T[],
	target: Pick<ReaderHighlight, "cfiRange" | "text">
): T | null {
	const targetKey = getAnnotationRangeKey(target);
	if (!targetKey) {
		return null;
	}
	return highlights.find((highlight) => getAnnotationRangeKey(highlight) === targetKey) || null;
}
