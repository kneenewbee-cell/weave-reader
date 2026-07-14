import type { App, TFile, WorkspaceLeaf } from "obsidian";
import { openFileWithExistingLeaf } from "../../utils/workspace-navigation";

export async function openAnnotationNoteFileWithExistingLeaf(
	app: App,
	noteFile: TFile
): Promise<WorkspaceLeaf | null> {
	return await openFileWithExistingLeaf(app, noteFile, {
		focus: true,
		openState: { mode: "preview" },
	});
}
