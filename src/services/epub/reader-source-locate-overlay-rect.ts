export interface ReaderSourceLocateOverlayRectInput {
	cfi?: string;
	href?: string;
	text?: string;
	currentCfi?: string;
	temporaryHighlightCfis?: string[];
	resolveNavigationRect: (options: {
		cfi?: string;
		href?: string;
		text?: string;
	}) => DOMRect | null;
	resolveHighlightRect: (cfiRange: string, textHint?: string) => DOMRect | null;
}

function collectUniqueCfis(...values: Array<string | undefined>): string[] {
	const seen = new Set<string>();
	const results: string[] = [];
	for (const value of values) {
		const normalized = String(value || "").trim();
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		results.push(normalized);
	}
	return results;
}

function highlightRectToDomRect(rect: {
	left: number;
	top: number;
	width: number;
	height: number;
}): DOMRect | null {
	if (
		!Number.isFinite(rect.left) ||
		!Number.isFinite(rect.top) ||
		!Number.isFinite(rect.width) ||
		!Number.isFinite(rect.height)
	) {
		return null;
	}
	if (rect.width <= 0 && rect.height <= 0) {
		return null;
	}
	return new DOMRect(rect.left, rect.top, Math.max(0, rect.width), Math.max(0, rect.height));
}

export function resolveReaderSourceLocateOverlayRect(
	input: ReaderSourceLocateOverlayRectInput
): DOMRect | null {
	const embeddedText = String(input.text || "").trim();
	const primaryCfi = String(input.cfi || "").trim();

	if (primaryCfi) {
		const primaryHighlightRect = input.resolveHighlightRect(
			primaryCfi,
			embeddedText || undefined
		);
		if (primaryHighlightRect) {
			return primaryHighlightRect;
		}
		if (embeddedText) {
			const primaryHighlightRectWithoutText = input.resolveHighlightRect(primaryCfi);
			if (primaryHighlightRectWithoutText) {
				return primaryHighlightRectWithoutText;
			}
		}
	}

	const candidateCfis = collectUniqueCfis(
		input.cfi,
		input.currentCfi,
		...(input.temporaryHighlightCfis || [])
	);

	for (const cfi of candidateCfis) {
		const rect = input.resolveNavigationRect({
			cfi,
			href: input.href,
			text: embeddedText || undefined,
		});
		if (rect) {
			return rect;
		}
	}

	for (const cfi of candidateCfis) {
		const rect = input.resolveHighlightRect(cfi, embeddedText || undefined);
		if (rect) {
			return rect;
		}
		const rectWithoutText = input.resolveHighlightRect(cfi);
		if (rectWithoutText) {
			return rectWithoutText;
		}
	}

	if (embeddedText && input.cfi) {
		const rect = input.resolveNavigationRect({
			cfi: input.cfi,
			href: input.href,
			text: embeddedText,
		});
		if (rect) {
			return rect;
		}
	}

	return null;
}

export function mapHighlightViewportRectToDomRect(
	rect: { left: number; top: number; width: number; height: number } | null | undefined
): DOMRect | null {
	if (!rect) {
		return null;
	}
	return highlightRectToDomRect(rect);
}
