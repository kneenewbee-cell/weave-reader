import { normalizePath, TFile, type App } from "obsidian";
import {
	getBuiltinBookNotesExportTemplate,
	getBuiltinBookNotesExportTemplateFileName,
	resolveBuiltinTemplateIdByFileName,
} from "./builtin-templates";
import {
	BOOK_NOTES_EXPORT_BUILTIN_TEMPLATE_IDS,
	DEFAULT_CALLOUT_TEMPLATE_FILE,
	DEFAULT_CITATION_G_TEMPLATE_FILE,
	DEFAULT_CLASSIC_TEMPLATE_FILE,
	DEFAULT_DIGEST_A_TEMPLATE_FILE,
	DEFAULT_DIGEST_B_TEMPLATE_FILE,
	DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_FILE,
	type BookNotesExportBuiltinTemplateId,
	type BookNotesExportLegacyTemplate,
} from "./constants";
import {
	resolveBookNotesExportTemplateFolder,
	type ResolveBookNotesExportTemplateFolderOptions,
} from "./template-folder";
import { isFileWithinVaultFolder } from "../../../utils/vault-folder-markdown-filter";

function buildEmptyEnsureDefaultBookNotesExportTemplatesResult(): EnsureDefaultBookNotesExportTemplatesResult {
	return {
		classicTemplatePath: "",
		calloutTemplatePath: "",
		digestATemplatePath: "",
		digestBTemplatePath: "",
		citationGTemplatePath: "",
		defaultTemplatePath: "",
		createdPaths: [],
	};
}

async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
	const normalizedFolder = normalizePath(String(folderPath || "").trim());
	if (!normalizedFolder || normalizedFolder === "/") {
		return;
	}

	const segments = normalizedFolder.split("/").filter(Boolean);
	let currentPath = "";
	for (const segment of segments) {
		currentPath = currentPath ? `${currentPath}/${segment}` : segment;
		const existing = app.vault.getAbstractFileByPath(currentPath);
		if (!existing) {
			await app.vault.createFolder(currentPath);
		}
	}
}

async function ensureTemplateFile(
	app: App,
	folderPath: string,
	fileName: string,
	content: string
): Promise<string> {
	await ensureFolderExists(app, folderPath);
	const targetPath = normalizePath(`${folderPath}/${fileName}`);
	const existing = app.vault.getAbstractFileByPath(targetPath);
	if (!(existing instanceof TFile)) {
		await app.vault.create(targetPath, content.endsWith("\n") ? content : `${content}\n`);
	}
	return targetPath;
}

export interface EnsureDefaultBookNotesExportTemplatesResult {
	classicTemplatePath: string;
	calloutTemplatePath: string;
	digestATemplatePath: string;
	digestBTemplatePath: string;
	citationGTemplatePath: string;
	defaultTemplatePath: string;
	createdPaths: string[];
}

export async function ensureDefaultBookNotesExportTemplates(
	app: App,
	templateFolder?: string | null,
	options: ResolveBookNotesExportTemplateFolderOptions = {}
): Promise<EnsureDefaultBookNotesExportTemplatesResult> {
	const createdPaths: string[] = [];
	const folderPath = resolveBookNotesExportTemplateFolder(
		{
			bookNotesExportTemplateFolder: templateFolder,
		},
		options
	);
	if (!folderPath) {
		return buildEmptyEnsureDefaultBookNotesExportTemplatesResult();
	}

	for (const templateId of BOOK_NOTES_EXPORT_BUILTIN_TEMPLATE_IDS) {
		const template = {
			fileName: getBuiltinBookNotesExportTemplateFileName(templateId),
			content: getBuiltinBookNotesExportTemplate(templateId),
		};
		const targetPath = normalizePath(`${folderPath}/${template.fileName}`);
		const existing = app.vault.getAbstractFileByPath(targetPath);
		if (!(existing instanceof TFile)) {
			await ensureTemplateFile(app, folderPath, template.fileName, template.content);
			createdPaths.push(targetPath);
		}
	}

	return {
		classicTemplatePath: normalizePath(`${folderPath}/${DEFAULT_CLASSIC_TEMPLATE_FILE}`),
		calloutTemplatePath: normalizePath(`${folderPath}/${DEFAULT_CALLOUT_TEMPLATE_FILE}`),
		digestATemplatePath: normalizePath(`${folderPath}/${DEFAULT_DIGEST_A_TEMPLATE_FILE}`),
		digestBTemplatePath: normalizePath(`${folderPath}/${DEFAULT_DIGEST_B_TEMPLATE_FILE}`),
		citationGTemplatePath: normalizePath(`${folderPath}/${DEFAULT_CITATION_G_TEMPLATE_FILE}`),
		defaultTemplatePath: normalizePath(`${folderPath}/${DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_FILE}`),
		createdPaths,
	};
}

export function resolveLegacyTemplatePath(
	legacyTemplate: BookNotesExportLegacyTemplate,
	templateFolder?: string | null
): string {
	const folderPath = resolveBookNotesExportTemplateFolder({
		bookNotesExportTemplateFolder: templateFolder,
	});
	const fileName =
		legacyTemplate === "callout" ? DEFAULT_CALLOUT_TEMPLATE_FILE : DEFAULT_CLASSIC_TEMPLATE_FILE;
	return normalizePath(`${folderPath}/${fileName}`);
}

export function resolveBuiltinTemplatePath(
	templateId: BookNotesExportBuiltinTemplateId,
	templateFolder?: string | null
): string {
	const folderPath = resolveBookNotesExportTemplateFolder({
		bookNotesExportTemplateFolder: templateFolder,
	});
	return normalizePath(`${folderPath}/${getBuiltinBookNotesExportTemplateFileName(templateId)}`);
}

export async function loadBookNotesExportTemplateSource(
	app: App,
	options: {
		templatePath?: string | null;
		templateFolder?: string | null;
		legacyTemplate?: BookNotesExportLegacyTemplate;
		builtinTemplateId?: BookNotesExportBuiltinTemplateId;
	}
): Promise<{ source: string; resolvedPath: string | null }> {
	const templatePath = normalizePath(String(options.templatePath || "").trim());
	if (templatePath) {
		const allowedFolder = resolveBookNotesExportTemplateFolder({
			bookNotesExportTemplateFolder: options.templateFolder,
		});
		if (!isFileWithinVaultFolder(templatePath, allowedFolder)) {
			throw new Error(
				`Export template must be inside template folder (${allowedFolder}): ${templatePath}`
			);
		}
		const file = app.vault.getAbstractFileByPath(templatePath);
		if (file instanceof TFile) {
			return {
				source: await app.vault.read(file),
				resolvedPath: file.path,
			};
		}
		throw new Error(`Export template not found: ${templatePath}`);
	}

	if (options.builtinTemplateId) {
		const builtinPath = resolveBuiltinTemplatePath(
			options.builtinTemplateId,
			options.templateFolder
		);
		const builtinFile = app.vault.getAbstractFileByPath(builtinPath);
		if (builtinFile instanceof TFile) {
			return {
				source: await app.vault.read(builtinFile),
				resolvedPath: builtinFile.path,
			};
		}
		return {
			source: getBuiltinBookNotesExportTemplate(options.builtinTemplateId),
			resolvedPath: null,
		};
	}

	const legacyTemplate = options.legacyTemplate || "classic";
	const legacyPath = resolveLegacyTemplatePath(legacyTemplate, options.templateFolder);
	const legacyFile = app.vault.getAbstractFileByPath(legacyPath);
	if (legacyFile instanceof TFile) {
		return {
			source: await app.vault.read(legacyFile),
			resolvedPath: legacyFile.path,
		};
	}

	return {
		source: getBuiltinBookNotesExportTemplate(legacyTemplate),
		resolvedPath: null,
	};
}

export function isMarkdownVaultFile(file: TFile): boolean {
	return file.extension.toLowerCase() === "md";
}

export function isBuiltinBookNotesExportTemplatePath(path: string): boolean {
	const fileName = normalizePath(String(path || "")).split("/").pop() || "";
	return resolveBuiltinTemplateIdByFileName(fileName) !== null;
}
