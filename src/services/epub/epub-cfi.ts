export type {
	ParsedCfi,
	ParsedCfiPart,
	ParsedCfiPath,
	ParsedCfiRange,
	ParsedCfiSegment,
} from "weave-vendor/epubcfi";

export {
	collapse,
	compare,
	fake,
	fromCalibreHighlight,
	fromCalibrePos,
	fromElements,
	fromRange,
	isCFI,
	joinIndir,
	parse,
	toElement,
	toRange,
} from "weave-vendor/epubcfi";

import type { ParsedCfi, ParsedCfiPath, ParsedCfiRange } from "weave-vendor/epubcfi";

export function isParsedCfiRange(parsed: ParsedCfi): parsed is ParsedCfiRange {
	return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "parent" in parsed;
}

export function getCfiParentPath(parsed: ParsedCfi): ParsedCfiPath {
	if (isParsedCfiRange(parsed)) {
		return [...parsed.parent];
	}
	return [...parsed];
}
