export function normalizeBookNotesTemplateContent(content: string): string {
	return String(content || "")
		.replace(/\r\n?/g, "\n")
		.trim();
}

export function bookNotesTemplateContentMatches(left: string, right: string): boolean {
	return normalizeBookNotesTemplateContent(left) === normalizeBookNotesTemplateContent(right);
}
