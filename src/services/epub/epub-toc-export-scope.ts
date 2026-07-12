import type { FlatTocItem } from "../../utils/epub-toc-reading-position";
import { normalizeTocHref } from "../../utils/epub-toc-reading-position";

export type FlatTocExportItem = FlatTocItem;

export function extractTocHrefFragment(href: string): string {
	const trimmed = String(href || "").trim();
	const hashIndex = trimmed.indexOf("#");
	return hashIndex >= 0 ? trimmed.slice(hashIndex + 1).trim() : "";
}

export function resolveTocExportEndBoundary(
	flatItems: FlatTocExportItem[],
	currentIndex: number
): FlatTocExportItem | null {
	const current = flatItems[currentIndex];
	if (!current) {
		return null;
	}

	const currentSection = normalizeTocHref(current.href);
	if (!currentSection) {
		return null;
	}

	const immediateNext = flatItems[currentIndex + 1];
	if (immediateNext && normalizeTocHref(immediateNext.href) === currentSection) {
		return immediateNext;
	}

	for (let index = currentIndex + 1; index < flatItems.length; index += 1) {
		const candidate = flatItems[index];
		if (normalizeTocHref(candidate.href) !== currentSection) {
			if (candidate.depth <= current.depth) {
				break;
			}
			continue;
		}
		if (candidate.depth <= current.depth) {
			return candidate;
		}
	}

	return null;
}
