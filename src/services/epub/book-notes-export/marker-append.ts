import {
	BOOK_NOTES_EXPORT_MARKER_END,
	BOOK_NOTES_EXPORT_MARKER_START,
} from "./constants";

export function wrapBookNotesExportSection(body: string): string {
	const normalizedBody = String(body || "")
		.replace(/\r\n?/g, "\n")
		.trim();
	return [BOOK_NOTES_EXPORT_MARKER_START, normalizedBody, BOOK_NOTES_EXPORT_MARKER_END].join("\n");
}

export function hasBookNotesExportMarker(content: string): boolean {
	return (
		content.includes(BOOK_NOTES_EXPORT_MARKER_START) &&
		content.includes(BOOK_NOTES_EXPORT_MARKER_END)
	);
}

export function replaceBookNotesExportSection(content: string, body: string): string {
	const wrappedSection = wrapBookNotesExportSection(body);
	if (!hasBookNotesExportMarker(content)) {
		const normalizedContent = String(content || "")
			.replace(/\r\n?/g, "\n")
			.trimEnd();
		if (!normalizedContent) {
			return `${wrappedSection}\n`;
		}
		return `${normalizedContent}\n\n${wrappedSection}\n`;
	}

	const startIndex = content.indexOf(BOOK_NOTES_EXPORT_MARKER_START);
	const endIndex = content.indexOf(BOOK_NOTES_EXPORT_MARKER_END);
	if (startIndex < 0 || endIndex < startIndex) {
		const normalizedContent = String(content || "")
			.replace(/\r\n?/g, "\n")
			.trimEnd();
		return `${normalizedContent}\n\n${wrappedSection}\n`;
	}

	const before = content.slice(0, startIndex).replace(/\s+$/u, "");
	const after = content.slice(endIndex + BOOK_NOTES_EXPORT_MARKER_END.length).replace(/^\s+/u, "");
	const sections = [before, wrappedSection, after].filter((section) => section.length > 0);
	return `${sections.join("\n\n")}\n`;
}
