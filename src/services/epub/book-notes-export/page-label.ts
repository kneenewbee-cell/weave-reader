export function formatBookNotesPrintPageLabel(pageNumber: number | undefined): string {
	if (typeof pageNumber !== "number" || !Number.isFinite(pageNumber) || pageNumber <= 0) {
		return "";
	}
	return `P.${Math.round(pageNumber)}`;
}
