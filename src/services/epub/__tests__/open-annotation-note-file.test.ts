import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { openAnnotationNoteFileWithExistingLeaf } from "../open-annotation-note-file";

function createFile(path: string): TFile {
	const name = path.split("/").pop() || path;
	return Object.assign(Object.create(TFile.prototype), {
		path,
		name,
		basename: name.replace(/\.[^.]+$/, ""),
		extension: name.split(".").pop() || "",
	});
}

describe("openAnnotationNoteFileWithExistingLeaf", () => {
	it("reuses an already open annotations markdown leaf", async () => {
		const noteFile = createFile("weave/epub-data/books/book-1/annotations.md");
		const existingLeaf = {
			view: { file: noteFile },
			openFile: vi.fn(),
		};
		const app = {
			workspace: {
				iterateAllLeaves: vi.fn((callback: (leaf: unknown) => void) => callback(existingLeaf)),
				getLeaf: vi.fn(),
				setActiveLeaf: vi.fn(),
				revealLeaf: vi.fn(),
			},
			vault: {
				getAbstractFileByPath: vi.fn(() => noteFile),
			},
		} as any;

		const result = await openAnnotationNoteFileWithExistingLeaf(app, noteFile);

		expect(result).toBe(existingLeaf);
		expect(existingLeaf.openFile).not.toHaveBeenCalled();
		expect(app.workspace.getLeaf).not.toHaveBeenCalled();
		expect(app.workspace.setActiveLeaf).toHaveBeenCalledWith(existingLeaf, { focus: true });
		expect(app.workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
	});

	it("opens the annotations note in preview when no existing leaf is open", async () => {
		const noteFile = createFile("weave/epub-data/books/book-1/annotations.md");
		const newLeaf = { openFile: vi.fn(async () => undefined) };
		const app = {
			workspace: {
				iterateAllLeaves: vi.fn(),
				getLeaf: vi.fn(() => newLeaf),
				setActiveLeaf: vi.fn(),
				revealLeaf: vi.fn(),
			},
			vault: {
				getAbstractFileByPath: vi.fn(() => noteFile),
			},
		} as any;

		const result = await openAnnotationNoteFileWithExistingLeaf(app, noteFile);

		expect(result).toBe(newLeaf);
		expect(app.workspace.getLeaf).toHaveBeenCalledWith(false);
		expect(newLeaf.openFile).toHaveBeenCalledWith(noteFile, {
			active: true,
			state: { mode: "preview" },
		});
		expect(app.workspace.setActiveLeaf).toHaveBeenCalledWith(newLeaf, { focus: true });
		expect(app.workspace.revealLeaf).toHaveBeenCalledWith(newLeaf);
	});
});
