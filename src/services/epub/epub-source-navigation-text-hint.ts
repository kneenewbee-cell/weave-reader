export interface EpubSourceNavigationTextHintInput {
	cfi?: string;
	href?: string;
	text?: string;
}

/**
 * Resolve the text hint used for EPUB source navigation and locate overlays.
 * When a structural locator (CFI/href) is present, editable callout quote text must not
 * participate — only text embedded in the link metadata may be used as a hint.
 */
export function resolveEpubSourceNavigationTextHint(
	parsed: EpubSourceNavigationTextHintInput,
	calloutQuoteText?: string
): string {
	const embeddedText = String(parsed.text || "").trim();
	if (embeddedText) {
		return embeddedText;
	}

	const hasStructuralLocator = Boolean(
		String(parsed.cfi || "").trim() || String(parsed.href || "").trim()
	);
	if (hasStructuralLocator) {
		return "";
	}

	return String(calloutQuoteText || "").trim();
}

export function normalizeBookLocateText(nav: {
	cfi?: string;
	href?: string;
	text?: string;
}): string {
	return resolveEpubSourceNavigationTextHint({
		cfi: nav.cfi,
		href: nav.href,
		text: nav.text,
	});
}
