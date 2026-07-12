export interface ReaderNavigationResolvedTarget {
	index: number;
	cfi?: string;
	href?: string;
	textHint?: string;
}

export interface ReaderSourceNavigationViewTargetsInput {
	resolved: ReaderNavigationResolvedTarget | null;
	rawCfi: string;
	rawHref: string;
	canonical: string | null;
	rawTarget: string;
	text?: string;
	usesGenericBookLoader: boolean;
	sectionEntryCfi?: string | null;
	sectionHref?: string | null;
	fallbackTarget: string;
}

export function resolveReaderSourceNavigationViewTargets(
	input: ReaderSourceNavigationViewTargetsInput
): { viewTarget: string; fallbackTarget: string } {
	const {
		resolved,
		rawCfi,
		rawHref,
		canonical,
		rawTarget,
		text,
		usesGenericBookLoader,
		sectionEntryCfi,
		sectionHref,
		fallbackTarget,
	} = input;

	const defaultViewTarget = rawHref && !rawCfi ? rawHref : canonical || rawTarget;
	const defaultFallbackTarget = fallbackTarget;

	if (!resolved || !usesGenericBookLoader || !String(text || "").trim()) {
		return {
			viewTarget: defaultViewTarget,
			fallbackTarget: defaultFallbackTarget,
		};
	}

	const entryCfi = sectionEntryCfi || "";
	const href = sectionHref || "";
	const sectionTarget = href || entryCfi || defaultViewTarget;
	return {
		viewTarget: sectionTarget,
		fallbackTarget: href || entryCfi || defaultFallbackTarget,
	};
}

export function buildReaderNavigationRectTargets(options: {
	cfi?: string;
	href?: string;
	currentCfi?: string;
	currentHref?: string;
}): string[] {
	const targets = new Set<string>();
	const primaryTarget = String(options.cfi || options.href || "").trim();
	if (primaryTarget) {
		targets.add(primaryTarget);
	}

	const currentCfi = String(options.currentCfi || "").trim();
	if (currentCfi) {
		targets.add(currentCfi);
	}

	const currentHref = String(options.currentHref || "").trim();
	if (currentHref) {
		targets.add(currentHref);
	}

	return Array.from(targets);
}
