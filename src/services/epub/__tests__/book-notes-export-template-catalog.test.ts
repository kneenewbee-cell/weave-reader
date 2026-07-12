import { describe, expect, it } from "vitest";
import {
	bookNotesTemplateContentMatches,
	normalizeBookNotesTemplateContent,
} from "../book-notes-export/template-content";
import { getBuiltinBookNotesExportTemplate } from "../book-notes-export/builtin-templates";

describe("book-notes-export template content", () => {
	it("normalizes line endings and trailing whitespace", () => {
		expect(normalizeBookNotesTemplateContent("a\r\nb\n\n")).toBe("a\nb");
	});

	it("matches equivalent template bodies", () => {
		const left = getBuiltinBookNotesExportTemplate("digest-b");
		const right = `${left}\n`;
		expect(bookNotesTemplateContentMatches(left, right)).toBe(true);
	});
});

describe("openPresetBookNotesExportTemplate", () => {
	it("is exported from template catalog", async () => {
		const module = await import("../book-notes-export/template-catalog");
		expect(typeof module.openPresetBookNotesExportTemplate).toBe("function");
	});
});
