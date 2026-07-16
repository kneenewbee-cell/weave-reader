import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
	findOpenAnnotationNoteLeaf,
	openAnnotationNoteFileInDualWindow,
	openAnnotationNoteFileWithExistingLeaf,
} from "../open-annotation-note-file";

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
	it("finds an already open annotations markdown leaf by note path", () => {
		const noteFile = createFile("weave/epub-data/books/book-1/annotations.md");
		const noteLeaf = {
			view: { file: noteFile },
		};
		const otherLeaf = {
			view: { file: createFile("weave/epub-data/books/book-2/annotations.md") },
		};
		const app = {
			workspace: {
				iterateAllLeaves: vi.fn((callback: (leaf: unknown) => void) => {
					callback(otherLeaf);
					callback(noteLeaf);
				}),
			},
		} as any;

		expect(findOpenAnnotationNoteLeaf(app, noteFile.path)).toBe(noteLeaf);
		expect(findOpenAnnotationNoteLeaf(app, "weave/epub-data/books/missing/annotations.md")).toBeNull();
	});

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

	it("reuses an open annotations leaf when Obsidian exposes a file-like view object", async () => {
		const noteFile = createFile("weave/epub-data/books/book-1/annotations.md");
		const existingLeaf = {
			view: { file: { path: noteFile.path } },
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

	it("opens the annotations note in a right split for dual-window mode", async () => {
		const noteFile = createFile("weave/epub-data/books/book-1/annotations.md");
		const splitLeaf = { openFile: vi.fn(async () => undefined) };
		const app = {
			workspace: {
				iterateAllLeaves: vi.fn(),
				getLeaf: vi.fn(() => splitLeaf),
				setActiveLeaf: vi.fn(),
				revealLeaf: vi.fn(),
			},
			vault: {
				getAbstractFileByPath: vi.fn(() => noteFile),
			},
		} as any;

		const result = await openAnnotationNoteFileWithExistingLeaf(app, noteFile, {
			openMode: "right-split",
			focus: false,
		});

		expect(result).toBe(splitLeaf);
		expect(app.workspace.getLeaf).toHaveBeenCalledWith("split", "vertical");
		expect(splitLeaf.openFile).toHaveBeenCalledWith(noteFile, {
			active: false,
			state: { mode: "preview" },
		});
		expect(app.workspace.setActiveLeaf).not.toHaveBeenCalled();
	});

	it("moves the current annotations leaf to the reader and opens the note in the split", async () => {
		const noteFile = createFile("weave/epub-data/books/book-1/annotations.md");
		const currentNoteLeaf = {
			view: { file: noteFile },
			setViewState: vi.fn(async () => undefined),
		};
		const splitLeaf = { openFile: vi.fn(async () => undefined) };
		const app = {
			workspace: {
				getMostRecentLeaf: vi.fn(() => currentNoteLeaf),
				iterateAllLeaves: vi.fn(),
				getLeaf: vi.fn(() => splitLeaf),
				revealLeaf: vi.fn(),
			},
		} as any;

		const result = await openAnnotationNoteFileInDualWindow(
			app,
			noteFile,
			{
				type: "weave-epub-reader",
				state: { filePath: "Books/demo.epub" },
			},
			{ focusNote: false }
		);

		expect(result.noteLeaf).toBe(splitLeaf);
		expect(result.readerLeaf).toBe(currentNoteLeaf);
		expect(app.workspace.getLeaf).toHaveBeenCalledWith("split", "vertical");
		expect(splitLeaf.openFile).toHaveBeenCalledWith(noteFile, {
			active: false,
			state: { mode: "preview" },
		});
		expect(currentNoteLeaf.setViewState).toHaveBeenCalledWith({
			type: "weave-epub-reader",
			active: true,
			state: { filePath: "Books/demo.epub" },
		});
		expect(app.workspace.revealLeaf).toHaveBeenCalledWith(currentNoteLeaf);
	});

	it("reuses an existing EPUB leaf instead of creating a duplicate reader from the current note", async () => {
		const noteFile = createFile("weave/epub-data/books/book-1/annotations.md");
		const currentNoteLeaf = {
			view: { file: noteFile },
			setViewState: vi.fn(async () => undefined),
			detach: vi.fn(),
		};
		const existingReaderLeaf = {
			view: { getCurrentFilePath: () => "Books/demo.epub" },
			getViewState: vi.fn(() => ({
				type: "weave-epub-reader",
				state: { filePath: "Books/demo.epub" },
			})),
		};
		const splitLeaf = { openFile: vi.fn(async () => undefined) };
		const app = {
			workspace: {
				getMostRecentLeaf: vi.fn(() => currentNoteLeaf),
				iterateAllLeaves: vi.fn(),
				getLeavesOfType: vi.fn((viewType: string) =>
					viewType === "weave-epub-reader" ? [existingReaderLeaf] : []
				),
				getLeaf: vi.fn(() => splitLeaf),
				revealLeaf: vi.fn(),
			},
			vault: {
				configDir: ".obsidian",
				getAbstractFileByPath: vi.fn(() => null),
				getFiles: vi.fn(() => []),
			},
		} as any;

		const result = await openAnnotationNoteFileInDualWindow(
			app,
			noteFile,
			{
				type: "weave-epub-reader",
				state: { filePath: "Books/demo.epub" },
			},
			{ focusNote: false }
		);

		expect(result.noteLeaf).toBe(splitLeaf);
		expect(result.readerLeaf).toBe(existingReaderLeaf);
		expect(splitLeaf.openFile).toHaveBeenCalledWith(noteFile, {
			active: false,
			state: { mode: "preview" },
		});
		expect(currentNoteLeaf.setViewState).not.toHaveBeenCalled();
		expect(currentNoteLeaf.detach).toHaveBeenCalled();
		expect(app.workspace.revealLeaf).toHaveBeenCalledWith(existingReaderLeaf);
	});

	it("does not move a background annotations leaf when the current leaf is not the note", async () => {
		const noteFile = createFile("weave/epub-data/books/book-1/annotations.md");
		const currentReaderLeaf = {
			view: { getViewType: () => "weave-epub-reader" },
			setViewState: vi.fn(async () => undefined),
		};
		const backgroundNoteLeaf = {
			view: { file: noteFile },
			setViewState: vi.fn(async () => undefined),
		};
		const splitLeaf = { openFile: vi.fn(async () => undefined) };
		const app = {
			workspace: {
				getMostRecentLeaf: vi.fn(() => currentReaderLeaf),
				iterateAllLeaves: vi.fn((callback: (leaf: unknown) => void) => callback(backgroundNoteLeaf)),
				getLeaf: vi.fn(() => splitLeaf),
				revealLeaf: vi.fn(),
			},
		} as any;

		const result = await openAnnotationNoteFileInDualWindow(
			app,
			noteFile,
			{
				type: "weave-epub-reader",
				state: { filePath: "Books/demo.epub" },
			},
			{ focusNote: false }
		);

		expect(result.noteLeaf).toBe(splitLeaf);
		expect(result.readerLeaf).toBeNull();
		expect(splitLeaf.openFile).toHaveBeenCalledWith(noteFile, {
			active: false,
			state: { mode: "preview" },
		});
		expect(backgroundNoteLeaf.setViewState).not.toHaveBeenCalled();
		expect(currentReaderLeaf.setViewState).not.toHaveBeenCalled();
		expect(app.workspace.revealLeaf).not.toHaveBeenCalledWith(backgroundNoteLeaf);
	});
});
