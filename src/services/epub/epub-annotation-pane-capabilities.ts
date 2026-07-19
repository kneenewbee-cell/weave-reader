import {
	normalizeEpubAnnotationCompareContext,
	type EpubAnnotationCompareContext,
} from "./epub-dual-window";

export interface EpubAnnotationPaneCapabilitiesInput {
	hasExcerptNotes: boolean;
	annotationCompare?: EpubAnnotationCompareContext | null;
}

export interface EpubAnnotationPaneCapabilities {
	canReadAnnotations: boolean;
	canEditAnnotations: boolean;
	canUseSelectionToolbar: boolean;
}

export function resolveEpubAnnotationPaneCapabilities(
	input: EpubAnnotationPaneCapabilitiesInput
): EpubAnnotationPaneCapabilities {
	const canReadAnnotations = input.hasExcerptNotes === true;
	const annotationCompare = normalizeEpubAnnotationCompareContext(input.annotationCompare);
	const canEditAnnotations = canReadAnnotations && annotationCompare?.paneRole !== "readonly";
	return {
		canReadAnnotations,
		canEditAnnotations,
		canUseSelectionToolbar: canEditAnnotations,
	};
}
