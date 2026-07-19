import type { EpubAnnotationVersionSummary } from "../../services/epub";

export type EpubAnnotationCompareVersionSlot = "editable" | "readonly";

export interface EpubAnnotationCompareVersionSelection {
	editableVersionId: string;
	readonlyVersionId: string;
}

function cleanVersionId(value: unknown): string {
	return String(value || "").trim();
}

function versionExists(versions: EpubAnnotationVersionSummary[], versionId: string): boolean {
	return versions.some((version) => cleanVersionId(version.versionId) === versionId);
}

function firstDifferentVersionId(
	versions: EpubAnnotationVersionSummary[],
	versionId: string
): string {
	return cleanVersionId(
		versions.find((version) => cleanVersionId(version.versionId) !== versionId)?.versionId
	);
}

export function resolveDefaultEpubAnnotationCompareSelection(
	versions: EpubAnnotationVersionSummary[]
): EpubAnnotationCompareVersionSelection {
	const editableVersionId = cleanVersionId(
		versions.find((version) => version.active)?.versionId || versions[0]?.versionId
	);
	return {
		editableVersionId,
		readonlyVersionId: firstDifferentVersionId(versions, editableVersionId),
	};
}

export function resolveEpubAnnotationCompareSelection(
	versions: EpubAnnotationVersionSummary[],
	preferredSelection?: Partial<EpubAnnotationCompareVersionSelection> | null
): EpubAnnotationCompareVersionSelection {
	const fallback = resolveDefaultEpubAnnotationCompareSelection(versions);
	if (!preferredSelection) {
		return fallback;
	}

	const editableVersionId = cleanVersionId(preferredSelection.editableVersionId);
	const readonlyVersionId = cleanVersionId(preferredSelection.readonlyVersionId);
	if (
		editableVersionId &&
		readonlyVersionId &&
		editableVersionId !== readonlyVersionId &&
		versionExists(versions, editableVersionId) &&
		versionExists(versions, readonlyVersionId)
	) {
		return { editableVersionId, readonlyVersionId };
	}

	let next = fallback;
	if (editableVersionId && versionExists(versions, editableVersionId)) {
		next = selectEpubAnnotationCompareVersionSlot(versions, next, "editable", editableVersionId);
	}
	if (readonlyVersionId && versionExists(versions, readonlyVersionId)) {
		next = selectEpubAnnotationCompareVersionSlot(versions, next, "readonly", readonlyVersionId);
	}
	return next;
}

export function isCompleteEpubAnnotationCompareSelection(
	selection: EpubAnnotationCompareVersionSelection
): boolean {
	const editableVersionId = cleanVersionId(selection.editableVersionId);
	const readonlyVersionId = cleanVersionId(selection.readonlyVersionId);
	return Boolean(editableVersionId && readonlyVersionId && editableVersionId !== readonlyVersionId);
}

export function selectEpubAnnotationCompareVersionSlot(
	versions: EpubAnnotationVersionSummary[],
	current: EpubAnnotationCompareVersionSelection,
	slot: EpubAnnotationCompareVersionSlot,
	versionId: unknown
): EpubAnnotationCompareVersionSelection {
	const selectedVersionId = cleanVersionId(versionId);
	if (!selectedVersionId || !versionExists(versions, selectedVersionId)) {
		return current;
	}
	const next = { ...current };
	if (slot === "editable") {
		next.editableVersionId = selectedVersionId;
		if (next.readonlyVersionId === selectedVersionId) {
			next.readonlyVersionId = firstDifferentVersionId(versions, selectedVersionId);
		}
		return next;
	}
	next.readonlyVersionId = selectedVersionId;
	if (next.editableVersionId === selectedVersionId) {
		next.editableVersionId = firstDifferentVersionId(versions, selectedVersionId);
	}
	return next;
}
