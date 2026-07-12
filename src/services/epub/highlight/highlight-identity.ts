import { EpubLinkService } from "../EpubLinkService";
import type { HighlightSourceLocator, ReaderHighlight } from "../reader-engine-types";

export type HighlightIdentityFields = Pick<
	ReaderHighlight,
	"cfiRange" | "excerptId" | "sourceFile" | "sourceRef" | "createdTime" | "text" | "semanticId"
>;

/** Normalizes excerpt quote text for stable identity comparison. */
export function normalizeHighlightQuoteText(text: string | undefined): string {
	return String(text || "")
		.replace(/^>\s?/gm, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

/** Normalizes quote punctuation differences for range-vs-saved-text coverage checks. */
export function normalizeHighlightQuoteCoverageText(text: string | undefined): string {
	return normalizeHighlightQuoteText(text)
		.replace(/[\u201c\u201d\u2018\u2019「」『』""'']/g, "")
		.replace(/[•·・]/g, "");
}

/** Collapses excerpt quote text for coverage checks across line/block boundaries. */
export function compactHighlightQuoteText(text: string | undefined): string {
	return normalizeHighlightQuoteCoverageText(text).replace(/\s+/g, "");
}

/** Whether a resolved DOM range covers the saved excerpt quote (not a truncated prefix). */
export function resolvedRangeCoversHighlightText(
	range: Range | null | undefined,
	highlightText: string | undefined,
	minCoverageRatio = 0.85
): boolean {
	const expected = normalizeHighlightQuoteCoverageText(highlightText);
	if (!expected) {
		return true;
	}
	if (!range) {
		return false;
	}
	const actual = normalizeHighlightQuoteCoverageText(range.toString());
	if (!actual) {
		return false;
	}
	if (actual === expected) {
		return true;
	}
	const compactActual = compactHighlightQuoteText(range.toString());
	const compactExpected = compactHighlightQuoteText(highlightText);
	if (compactActual === compactExpected) {
		return true;
	}
	const shorter = compactActual.length <= compactExpected.length ? compactActual : compactExpected;
	const longer = compactActual.length <= compactExpected.length ? compactExpected : compactActual;
	if (!longer.includes(shorter)) {
		return false;
	}
	return shorter.length / longer.length >= minCoverageRatio;
}

/**
 * Stable identity for one in-book highlight mark.
 * Same CFI + different excerpt or quote text => different keys.
 * Same CFI + same quote + multiple source files => one key (merged locators).
 */
export function getReaderHighlightIdentityKey(highlight: HighlightIdentityFields): string {
	const cfiKey = EpubLinkService.normalizeCfi(highlight.cfiRange);
	if (!cfiKey) {
		return "";
	}

	const excerptId = String(highlight.excerptId || "").trim();
	if (excerptId) {
		return `${cfiKey}\0eid:${excerptId}`;
	}

	const semanticId = String(highlight.semanticId || "").trim();
	const textKey = normalizeHighlightQuoteText(highlight.text);
	if (textKey) {
		if (semanticId) {
			return `${cfiKey}\0semantic:${semanticId}\0text:${textKey}`;
		}
		return `${cfiKey}\0text:${textKey}`;
	}

	const sourceFile = String(highlight.sourceFile || "").trim();
	const sourceRef = String(highlight.sourceRef || "").trim();
	if (semanticId) {
		return `${cfiKey}\0semantic:${semanticId}\0src:${sourceFile}\0${sourceRef}\0${highlight.createdTime ?? ""}`;
	}
	return `${cfiKey}\0src:${sourceFile}\0${sourceRef}\0${highlight.createdTime ?? ""}`;
}

function mergeHighlightSourceLocators(
	existing: HighlightSourceLocator[],
	incoming: HighlightSourceLocator[]
): HighlightSourceLocator[] {
	const merged = new Map<string, HighlightSourceLocator>();
	for (const locator of [...existing, ...incoming]) {
		const sourceFile = String(locator?.sourceFile || "").trim();
		if (!sourceFile) {
			continue;
		}
		const sourceRef = String(locator?.sourceRef || "").trim();
		const excerptId = String(locator?.excerptId || "").trim();
		const key = `${sourceFile}\0${sourceRef}\0${excerptId}`;
		if (!merged.has(key)) {
			merged.set(key, {
				sourceFile,
				...(sourceRef ? { sourceRef } : {}),
				...(excerptId ? { excerptId } : {}),
			});
		}
	}
	return Array.from(merged.values());
}

export function collectHighlightSourceLocators(highlight: ReaderHighlight): HighlightSourceLocator[] {
	const locators: HighlightSourceLocator[] = [];
	const sourceFile = String(highlight.sourceFile || "").trim();
	if (sourceFile) {
		locators.push({
			sourceFile,
			sourceRef: highlight.sourceRef,
			...(highlight.excerptId ? { excerptId: highlight.excerptId } : {}),
		});
	}
	for (const locator of highlight.sourceLocators || []) {
		const path = String(locator?.sourceFile || "").trim();
		if (!path) {
			continue;
		}
		locators.push({
			sourceFile: path,
			sourceRef: locator.sourceRef,
			...(locator.excerptId ? { excerptId: locator.excerptId } : {}),
		});
	}
	return mergeHighlightSourceLocators([], locators);
}

function mergeReaderHighlightRecords(
	prior: ReaderHighlight,
	later: ReaderHighlight
): ReaderHighlight {
	const sourceLocators = mergeHighlightSourceLocators(
		collectHighlightSourceLocators(prior),
		collectHighlightSourceLocators(later)
	);
	return {
		...later,
		...prior,
		sourceLocators,
		sourceFile: prior.sourceFile || later.sourceFile,
		sourceRef: prior.sourceRef ?? later.sourceRef,
		excerptId: prior.excerptId || later.excerptId,
		commentText: prior.commentText ?? later.commentText,
		hasCommentDivider: prior.hasCommentDivider ?? later.hasCommentDivider,
		chapterIndex: prior.chapterIndex ?? later.chapterIndex,
		chapterTitle: prior.chapterTitle || later.chapterTitle,
		style: prior.style ?? later.style,
		semanticId: prior.semanticId || later.semanticId,
		semanticLabel: prior.semanticLabel || later.semanticLabel,
		semanticGroup: prior.semanticGroup || later.semanticGroup,
		semanticDescription: prior.semanticDescription || later.semanticDescription,
		semanticSource: prior.semanticSource || later.semanticSource,
		createdTime: prior.createdTime ?? later.createdTime,
	};
}

/** Whether reader-visible highlight fields changed after an excerpt sync. */
export function hasReaderHighlightPresentationChanged(
	previous: ReaderHighlight,
	next: ReaderHighlight
): boolean {
	return (
		previous.commentText !== next.commentText ||
		previous.hasCommentDivider !== next.hasCommentDivider ||
		previous.text !== next.text ||
		previous.color !== next.color ||
		previous.style !== next.style ||
		previous.semanticId !== next.semanticId ||
		previous.semanticLabel !== next.semanticLabel ||
		previous.presentation !== next.presentation
	);
}

export function mergeReaderHighlightsByIdentity(
	existing: ReaderHighlight[],
	incoming: ReaderHighlight[]
): ReaderHighlight[] {
	const merged = new Map<string, ReaderHighlight>();
	for (const highlight of [...existing, ...incoming]) {
		const key = getReaderHighlightIdentityKey(highlight);
		if (!key) {
			continue;
		}
		const prior = merged.get(key);
		merged.set(key, prior ? mergeReaderHighlightRecords(prior, highlight) : { ...highlight });
	}
	return Array.from(merged.values());
}
