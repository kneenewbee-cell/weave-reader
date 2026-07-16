import type { App, TFile, WorkspaceLeaf } from "obsidian";
import { findOpenEpubLeaf } from "../../utils/epub-leaf-utils";
import { openFileWithExistingLeaf } from "../../utils/workspace-navigation";
import { getLeafViewFile, iterateAllWorkspaceLeaves } from "../../utils/obsidian-workspace-utils";

export interface AnnotationNoteDualWindowReaderViewState {
	type: string;
	active?: boolean;
	state?: Record<string, unknown>;
}

function findCurrentLeafForFile(app: App, file: TFile): WorkspaceLeaf | null {
	const recentLeaf = app.workspace.getMostRecentLeaf?.() ?? null;
	if (recentLeaf && getLeafViewFile(recentLeaf)?.path === file.path) {
		return recentLeaf;
	}
	return null;
}

export function findOpenAnnotationNoteLeaf(app: App, notePath: string): WorkspaceLeaf | null {
	const normalizedPath = String(notePath || "").trim();
	if (!normalizedPath) {
		return null;
	}
	let found: WorkspaceLeaf | null = null;
	iterateAllWorkspaceLeaves(app, (leaf) => {
		if (found) {
			return;
		}
		if (getLeafViewFile(leaf)?.path === normalizedPath) {
			found = leaf;
		}
	});
	return found;
}

function readReaderFilePath(state: AnnotationNoteDualWindowReaderViewState): string {
	const viewState = state.state || {};
	const filePath = viewState.filePath || viewState.file;
	return typeof filePath === "string" ? filePath.trim() : "";
}

function findExistingReaderLeaf(
	app: App,
	state: AnnotationNoteDualWindowReaderViewState
): WorkspaceLeaf | null {
	const readerFilePath = readReaderFilePath(state);
	const workspace = app.workspace as { getLeavesOfType?: unknown };
	if (!readerFilePath || typeof workspace.getLeavesOfType !== "function") {
		return null;
	}
	return findOpenEpubLeaf(app, readerFilePath);
}

export async function openAnnotationNoteFileWithExistingLeaf(
	app: App,
	noteFile: TFile,
	options: {
		openMode?: "existing" | "right-split";
		focus?: boolean;
	} = {}
): Promise<WorkspaceLeaf | null> {
	const { openMode = "existing", focus = true } = options;
	if (openMode === "right-split") {
		const leaf = app.workspace.getLeaf("split", "vertical");
		await leaf.openFile(noteFile, {
			active: focus,
			state: { mode: "preview" },
		});
		if (focus) {
			void app.workspace.revealLeaf(leaf);
		}
		return leaf;
	}
	return await openFileWithExistingLeaf(app, noteFile, {
		focus,
		openState: { mode: "preview" },
	});
}

export async function openAnnotationNoteFileInDualWindow(
	app: App,
	noteFile: TFile,
	readerViewState: AnnotationNoteDualWindowReaderViewState,
	options: {
		focusNote?: boolean;
	} = {}
): Promise<{ noteLeaf: WorkspaceLeaf | null; readerLeaf: WorkspaceLeaf | null }> {
	const { focusNote = false } = options;
	const currentNoteLeaf = findCurrentLeafForFile(app, noteFile);
	const existingReaderLeaf = findExistingReaderLeaf(app, readerViewState);
	const noteLeaf = app.workspace.getLeaf("split", "vertical");
	await noteLeaf.openFile(noteFile, {
		active: focusNote,
		state: { mode: "preview" },
	});

	let readerLeaf: WorkspaceLeaf | null = null;
	if (existingReaderLeaf && existingReaderLeaf !== noteLeaf) {
		readerLeaf = existingReaderLeaf;
		if (
			currentNoteLeaf &&
			currentNoteLeaf !== noteLeaf &&
			currentNoteLeaf !== existingReaderLeaf
		) {
			currentNoteLeaf.detach();
		}
		void app.workspace.revealLeaf(existingReaderLeaf);
		return { noteLeaf, readerLeaf };
	}
	if (currentNoteLeaf && currentNoteLeaf !== noteLeaf) {
		await currentNoteLeaf.setViewState({
			...readerViewState,
			active: true,
		});
		void app.workspace.revealLeaf(currentNoteLeaf);
		readerLeaf = currentNoteLeaf;
	}
	return { noteLeaf, readerLeaf };
}
