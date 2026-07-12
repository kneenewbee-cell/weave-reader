import { normalizePath, TFile, TFolder, type App } from "obsidian";
import {
	getBuiltinBookNotesExportTemplate,
	getBuiltinBookNotesExportTemplateFileName,
	resolveBuiltinTemplateIdByFileName,
} from "./builtin-templates";
import type { BookNotesExportBuiltinTemplateId } from "./constants";
import {
	ensureDefaultBookNotesExportTemplates,
	isBuiltinBookNotesExportTemplatePath,
	isMarkdownVaultFile,
	resolveBuiltinTemplatePath,
} from "./install-templates";
import {
	resolveBookNotesExportTemplateFolder,
	type ResolveBookNotesExportTemplateFolderOptions,
} from "./template-folder";
import { bookNotesTemplateContentMatches } from "./template-content";

export interface BookNotesExportTemplateListItem {
	path: string;
	fileName: string;
	isBuiltin: boolean;
	builtinId: BookNotesExportBuiltinTemplateId | null;
}

export async function listBookNotesExportTemplateFiles(
	app: App,
	templateFolder?: string | null,
	options: ResolveBookNotesExportTemplateFolderOptions = {}
): Promise<BookNotesExportTemplateListItem[]> {
	const folderPath = resolveBookNotesExportTemplateFolder(
		{
			bookNotesExportTemplateFolder: templateFolder,
		},
		options
	);
	if (!folderPath) {
		return [];
	}
	await ensureDefaultBookNotesExportTemplates(app, folderPath, options);

	const folder = app.vault.getAbstractFileByPath(folderPath);
	if (!(folder instanceof TFolder)) {
		return [];
	}

	const items: BookNotesExportTemplateListItem[] = [];
	for (const child of folder.children) {
		if (!(child instanceof TFile) || !isMarkdownVaultFile(child)) {
			continue;
		}
		items.push({
			path: child.path,
			fileName: child.name,
			isBuiltin: isBuiltinBookNotesExportTemplatePath(child.path),
			builtinId: resolveBuiltinTemplateIdByFileName(child.name),
		});
	}

	return items.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

export async function readBookNotesExportTemplateFile(
	app: App,
	templatePath: string
): Promise<string> {
	const file = app.vault.getAbstractFileByPath(normalizePath(templatePath));
	if (!(file instanceof TFile)) {
		throw new Error(`Export template not found: ${templatePath}`);
	}
	return await app.vault.read(file);
}

export async function saveBookNotesExportTemplateFile(
	app: App,
	templatePath: string,
	content: string
): Promise<void> {
	const normalizedPath = normalizePath(templatePath);
	const file = app.vault.getAbstractFileByPath(normalizedPath);
	if (!(file instanceof TFile)) {
		throw new Error(`Export template not found: ${templatePath}`);
	}
	const normalizedContent = content.endsWith("\n") ? content : `${content}\n`;
	await app.vault.modify(file, normalizedContent);
}

export async function createBookNotesExportTemplateFile(
	app: App,
	options: {
		templateFolder?: string | null;
		fileName: string;
		content?: string;
		builtinTemplateId?: BookNotesExportBuiltinTemplateId;
		resolveFolderOptions?: ResolveBookNotesExportTemplateFolderOptions;
	}
): Promise<string> {
	const folderPath = resolveBookNotesExportTemplateFolder(
		{
			bookNotesExportTemplateFolder: options.templateFolder,
		},
		options.resolveFolderOptions
	);
	if (!folderPath) {
		throw new Error("Export template folder is not configured");
	}
	await ensureDefaultBookNotesExportTemplates(app, folderPath, options.resolveFolderOptions);

	const fileName = String(options.fileName || "").trim();
	if (!fileName.toLowerCase().endsWith(".md")) {
		throw new Error("Template file name must end with .md");
	}

	const targetPath = normalizePath(`${folderPath}/${fileName}`);
	if (app.vault.getAbstractFileByPath(targetPath)) {
		throw new Error(`Template already exists: ${targetPath}`);
	}

	const content =
		options.content ??
		(options.builtinTemplateId
			? getBuiltinBookNotesExportTemplate(options.builtinTemplateId)
			: "# {{ export.notesTitle }}\n\n");

	await app.vault.create(targetPath, content.endsWith("\n") ? content : `${content}\n`);
	return targetPath;
}

export async function duplicateBookNotesExportTemplateFile(
	app: App,
	sourcePath: string,
	targetFileName: string,
	templateFolder?: string | null
): Promise<string> {
	const source = await readBookNotesExportTemplateFile(app, sourcePath);
	return await createBookNotesExportTemplateFile(app, {
		templateFolder,
		fileName: targetFileName,
		content: source,
	});
}

export async function resetBookNotesExportTemplateToBuiltin(
	app: App,
	templatePath: string
): Promise<void> {
	const builtinId = resolveBuiltinTemplateIdByFileName(
		normalizePath(templatePath).split("/").pop() || ""
	);
	if (!builtinId) {
		throw new Error("Only built-in template files can be reset");
	}
	await saveBookNotesExportTemplateFile(
		app,
		templatePath,
		getBuiltinBookNotesExportTemplate(builtinId)
	);
}

export async function deleteBookNotesExportTemplateFile(
	app: App,
	templatePath: string
): Promise<void> {
	const normalizedPath = normalizePath(templatePath);
	const file = app.vault.getAbstractFileByPath(normalizedPath);
	if (!(file instanceof TFile)) {
		return;
	}
	await app.fileManager.trashFile(file);
}

export function resolveDefaultBookNotesExportTemplatePath(
	templateFolder?: string | null
): string {
	return resolveBuiltinTemplatePath("digest-b", templateFolder);
}

export function openBookNotesExportTemplateInEditor(app: App, templatePath: string): void {
	const file = app.vault.getAbstractFileByPath(normalizePath(templatePath));
	if (!(file instanceof TFile)) {
		return;
	}
	void app.workspace.getLeaf(false).openFile(file);
}

export function suggestUniqueTemplateFileName(
	existingFileNames: string[],
	baseName: string
): string {
	const normalizedBase = String(baseName || "custom-template").replace(/\.md$/i, "");
	let candidate = `${normalizedBase}.md`;
	let index = 2;
	const existing = new Set(existingFileNames.map((name) => name.toLowerCase()));
	while (existing.has(candidate.toLowerCase())) {
		candidate = `${normalizedBase}-${index}.md`;
		index += 1;
	}
	return candidate;
}

export function getBuiltinTemplatePathById(
	templateId: BookNotesExportBuiltinTemplateId,
	templateFolder?: string | null
): string {
	return resolveBuiltinTemplatePath(templateId, templateFolder);
}

export type OpenPresetBookNotesExportTemplateOutcome = "opened" | "created";

export interface OpenPresetBookNotesExportTemplateResult {
	path: string;
	outcome: OpenPresetBookNotesExportTemplateOutcome;
	fileName: string;
}

export async function findPresetBookNotesExportTemplatePath(
	app: App,
	presetId: BookNotesExportBuiltinTemplateId,
	templateFolder?: string | null,
	options: ResolveBookNotesExportTemplateFolderOptions = {}
): Promise<string | null> {
	const folderPath = resolveBookNotesExportTemplateFolder(
		{
			bookNotesExportTemplateFolder: templateFolder,
		},
		options
	);
	if (!folderPath) {
		return null;
	}
	await ensureDefaultBookNotesExportTemplates(app, folderPath, options);

	const expectedContent = getBuiltinBookNotesExportTemplate(presetId);
	const canonicalFileName = getBuiltinBookNotesExportTemplateFileName(presetId);
	const canonicalPath = normalizePath(`${folderPath}/${canonicalFileName}`);
	const canonicalFile = app.vault.getAbstractFileByPath(canonicalPath);

	if (canonicalFile instanceof TFile) {
		return canonicalPath;
	}

	const templates = await listBookNotesExportTemplateFiles(app, templateFolder, options);
	for (const item of templates) {
		const content = await readBookNotesExportTemplateFile(app, item.path);
		if (bookNotesTemplateContentMatches(content, expectedContent)) {
			return item.path;
		}
	}

	return null;
}

export async function openPresetBookNotesExportTemplate(
	app: App,
	presetId: BookNotesExportBuiltinTemplateId,
	templateFolder?: string | null
): Promise<OpenPresetBookNotesExportTemplateResult> {
	const existingPath = await findPresetBookNotesExportTemplatePath(app, presetId, templateFolder);
	if (existingPath) {
		return {
			path: existingPath,
			outcome: "opened",
			fileName: existingPath.split("/").pop() || existingPath,
		};
	}

	const canonicalFileName = getBuiltinBookNotesExportTemplateFileName(presetId);
	const createdPath = await createBookNotesExportTemplateFile(app, {
		templateFolder,
		fileName: canonicalFileName,
		builtinTemplateId: presetId,
	});

	return {
		path: createdPath,
		outcome: "created",
		fileName: canonicalFileName,
	};
}

export {
	getBuiltinBookNotesExportTemplateFileName,
	resolveBuiltinTemplateIdByFileName,
};
