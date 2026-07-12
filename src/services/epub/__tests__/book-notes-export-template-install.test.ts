import { describe, expect, it, vi } from "vitest";
import { ensureDefaultBookNotesExportTemplates } from "../book-notes-export/install-templates";
import { listBookNotesExportTemplateFiles } from "../book-notes-export/template-catalog";

describe("book notes export template install", () => {
	it("does not create vault folders before user settings are loaded", async () => {
		const createFolder = vi.fn(async () => undefined);
		const create = vi.fn(async () => undefined);
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn(() => null),
				createFolder,
				create,
			},
		};

		const result = await ensureDefaultBookNotesExportTemplates(app as never, null, {
			allowDefaultFallback: false,
		});

		expect(result.createdPaths).toEqual([]);
		expect(result.digestBTemplatePath).toBe("");
		expect(createFolder).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
	});

	it("lists no templates when folder is unresolved", async () => {
		const createFolder = vi.fn(async () => undefined);
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn(() => null),
				createFolder,
				create: vi.fn(async () => undefined),
			},
		};

		const templates = await listBookNotesExportTemplateFiles(app as never, null, {
			allowDefaultFallback: false,
		});

		expect(templates).toEqual([]);
		expect(createFolder).not.toHaveBeenCalled();
	});
});
