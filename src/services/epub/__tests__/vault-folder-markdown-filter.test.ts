import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import {
	buildMarkdownFileInFolderFilter,
	isFileWithinVaultFolder,
	isMarkdownFileWithinVaultFolder,
	normalizeVaultFolderPath,
} from "../../../utils/vault-folder-markdown-filter";

function createMarkdownFile(path: string): TFile {
	return { path, extension: "md", basename: path.split("/").pop() || path } as TFile;
}

describe("vault-folder-markdown-filter", () => {
	it("normalizes folder paths", () => {
		expect(normalizeVaultFolderPath(" Weave EPUB/Export templates/ ")).toBe(
			"Weave EPUB/Export templates"
		);
		expect(normalizeVaultFolderPath("")).toBe("");
	});

	it("matches files inside a folder", () => {
		const folder = "Weave EPUB/Export templates";
		expect(isFileWithinVaultFolder(`${folder}/excerpt-classic.md`, folder)).toBe(true);
		expect(isFileWithinVaultFolder("Books/demo.md", folder)).toBe(false);
	});

	it("filters markdown files to a folder", () => {
		const folder = "Weave EPUB/Export templates";
		const filter = buildMarkdownFileInFolderFilter(folder);
		expect(filter(createMarkdownFile(`${folder}/excerpt-classic.md`))).toBe(true);
		expect(filter(createMarkdownFile("Books/demo.md"))).toBe(false);
		expect(
			isMarkdownFileWithinVaultFolder(createMarkdownFile(`${folder}/excerpt-callout.md`), folder)
		).toBe(true);
	});
});
