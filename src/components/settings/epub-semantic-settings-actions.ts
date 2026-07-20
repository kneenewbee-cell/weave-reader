import type { EpubSemanticSettingsScope } from "../../services/epub";

export interface SemanticSchemeChangeInput {
	scope: EpubSemanticSettingsScope;
	bookId: string;
	currentSchemeId: string;
	nextSchemeId: string;
}

export function shouldClearAnnotationsForSemanticSchemeChange(
	input: SemanticSchemeChangeInput
): boolean {
	const scope = input.scope === "book" ? "book" : "global";
	const bookId = String(input.bookId || "").trim();
	const currentSchemeId = String(input.currentSchemeId || "").trim();
	const nextSchemeId = String(input.nextSchemeId || "").trim();
	return Boolean(
		scope === "book" &&
			bookId &&
			nextSchemeId &&
			nextSchemeId !== "custom" &&
			nextSchemeId !== currentSchemeId
	);
}
