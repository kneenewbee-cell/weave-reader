import { describe, expect, it } from "vitest";
import { DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_FOLDER } from "../../../config/epub-user-vault-folders";
import { resolveBookNotesExportTemplateFolder } from "../book-notes-export/template-folder";

describe("resolveBookNotesExportTemplateFolder", () => {
	it("uses stored custom folder when configured", () => {
		expect(
			resolveBookNotesExportTemplateFolder({
				bookNotesExportTemplateFolder: "Library/export-templates",
			})
		).toBe("Library/export-templates");
	});

	it("falls back to configured default only when settings are loaded but folder unset", () => {
		expect(resolveBookNotesExportTemplateFolder({ bookNotesExportTemplateFolder: null })).toBe(
			DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_FOLDER
		);
	});

	it("does not fall back before user settings are loaded", () => {
		expect(resolveBookNotesExportTemplateFolder(null, { allowDefaultFallback: false })).toBe("");
		expect(
			resolveBookNotesExportTemplateFolder(undefined, { allowDefaultFallback: false })
		).toBe("");
	});
});
