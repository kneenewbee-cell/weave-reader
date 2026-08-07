import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import JSZip from "jszip";
import { resolveEpubAiReadingNotePath } from "../epub/epub-ai-reading";
import { generateUniqueVaultFilePath } from "../epub/epub-markdown-path-resolver";
import { resolveEpubPortableBookDataLocation } from "../epub/epub-portable-data-location";
import {
	resolvePdfPortableBookDataLocation,
	type PdfPortableBookDataLocation,
} from "../pdf/pdf-portable-data-location";
import { renderPdfAnnotationNoteMarkdown } from "../pdf/pdf-annotation-note-markdown";
import {
	mergeAiReadingNoteMarkdown,
	retargetAiReadingNoteSourceFile,
} from "./reading-package-ai-note";
import {
	BOOK_PACKAGE_V2_FORMAT,
	type ReadingPackageBookFormat,
	type ReadingPackageManifestV2,
	type ReadingPackageModuleSelection,
} from "./reading-package-types";
import { hasSelectedReadingPackageModule } from "./reading-package-modules";
import {
	readReadingPackageManifest,
	writeReadingPackageManifest,
} from "./reading-package-zip";

type AdapterLike = {
	exists?: (path: string) => Promise<boolean>;
	list?: (path: string) => Promise<{ files?: string[]; folders?: string[] }>;
	read?: (path: string) => Promise<string>;
	readBinary?: (path: string) => Promise<ArrayBuffer | Uint8Array>;
	write?: (path: string, data: string) => Promise<void>;
	writeBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
	mkdir?: (path: string) => Promise<void>;
};

export interface CreateReadingPackageOptions {
	bookFormat: ReadingPackageBookFormat;
	bookId: string;
	filePath: string;
	displayName?: string;
	modules: ReadingPackageModuleSelection;
}

export interface ReadingPackageResult {
	arrayBuffer: ArrayBuffer;
	fileName: string;
	bookId: string;
	bookPath: string;
}

export interface ImportReadingPackageOptions {
	preferredBookId?: string;
	targetBookPath?: string;
	defaultBookFolder?: string;
}

export interface ReadingPackageImportResult {
	bookFormat: ReadingPackageBookFormat;
	bookId: string;
	bookPath: string;
	importedModules: string[];
	backupPaths: string[];
}

function getAdapter(app: App): AdapterLike {
	return ((app.vault as unknown as { adapter?: AdapterLike }).adapter || {});
}

function normalizeVaultPath(path: unknown): string {
	return normalizePath(String(path || "").trim());
}

function getFileName(path: string, fallback: string): string {
	return normalizeVaultPath(path).split("/").pop() || fallback;
}

function sanitizePackageFileName(value: unknown, fallback: string): string {
	const raw = String(value || "").trim() || fallback;
	return (
		raw
			.replace(/[\\/:*?"<>|\r\n\t]+/g, "-")
			.replace(/\s+/g, " ")
			.replace(/^-+|-+$/g, "")
			.slice(0, 120) || fallback
	);
}

async function readVaultText(app: App, path: string): Promise<string | null> {
	const adapter = getAdapter(app);
	const normalizedPath = normalizeVaultPath(path);
	if (!adapter.read) {
		return null;
	}
	if (adapter.exists && !(await adapter.exists(normalizedPath))) {
		return null;
	}
	try {
		return await adapter.read(normalizedPath);
	} catch {
		return null;
	}
}

async function readVaultBinary(app: App, path: string): Promise<ArrayBuffer | Uint8Array | null> {
	const adapter = getAdapter(app);
	const normalizedPath = normalizeVaultPath(path);
	if (!adapter.readBinary) {
		return null;
	}
	if (adapter.exists && !(await adapter.exists(normalizedPath))) {
		return null;
	}
	try {
		return await adapter.readBinary(normalizedPath);
	} catch {
		return null;
	}
}

async function collectVaultFilesRecursively(app: App, rootDir: string): Promise<string[]> {
	const adapter = getAdapter(app);
	if (!adapter.list) {
		return [];
	}
	const root = normalizeVaultPath(rootDir).replace(/\/+$/g, "");
	const result: string[] = [];
	const visit = async (folder: string) => {
		let listed: { files?: string[]; folders?: string[] };
		try {
			listed = await adapter.list?.(folder) || {};
		} catch {
			return;
		}
		for (const file of listed.files || []) {
			result.push(normalizeVaultPath(file));
		}
		for (const child of listed.folders || []) {
			await visit(normalizeVaultPath(child));
		}
	};
	await visit(root);
	return Array.from(new Set(result));
}

function relativeTo(rootDir: string, filePath: string): string {
	const root = normalizeVaultPath(rootDir).replace(/\/+$/g, "");
	const path = normalizeVaultPath(filePath);
	return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function parseJsonObject(text: string | null): Record<string, unknown> | null {
	if (!text) {
		return null;
	}
	try {
		const parsed = JSON.parse(text) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: null;
	} catch {
		return null;
	}
}

function parseJsonText(text: string | null): unknown | null {
	if (!text) {
		return null;
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}

function readDataPath(record: Record<string, unknown> | null, key: string): string {
	const dataPaths = record?.dataPaths;
	if (!dataPaths || typeof dataPaths !== "object" || Array.isArray(dataPaths)) {
		return "";
	}
	return normalizeVaultPath((dataPaths as Record<string, unknown>)[key]);
}

async function ensureFolderForFile(app: App, filePath: string): Promise<void> {
	const adapter = getAdapter(app);
	if (!adapter.mkdir) {
		return;
	}
	const folders = normalizeVaultPath(filePath).split("/").slice(0, -1).filter(Boolean);
	let current = "";
	for (const folder of folders) {
		current = current ? `${current}/${folder}` : folder;
		try {
			if (!adapter.exists || !(await adapter.exists(current))) {
				await adapter.mkdir(current);
			}
		} catch {
			return;
		}
	}
}

function buildBackupPath(filePath: string, timestamp = Date.now()): string {
	const normalized = normalizeVaultPath(filePath);
	const parts = normalized.split("/");
	const fileName = parts.pop() || "data.json";
	const folder = parts.join("/");
	return normalizeVaultPath(`${folder}/.backup/${timestamp}-${fileName}`);
}

async function writeVaultTextWithBackup(
	app: App,
	filePath: string,
	text: string,
	backupPaths: string[],
): Promise<void> {
	const adapter = getAdapter(app);
	if (!adapter.write) {
		throw new Error("vault-write-unavailable");
	}
	const normalizedPath = normalizeVaultPath(filePath);
	if (adapter.exists && adapter.read && (await adapter.exists(normalizedPath))) {
		const backupPath = buildBackupPath(normalizedPath);
		await ensureFolderForFile(app, backupPath);
		await adapter.write(backupPath, await adapter.read(normalizedPath));
		backupPaths.push(backupPath);
	}
	await ensureFolderForFile(app, normalizedPath);
	await adapter.write(normalizedPath, text);
}

async function writeVaultBinary(app: App, filePath: string, binary: ArrayBuffer): Promise<void> {
	const adapter = getAdapter(app);
	if (!adapter.writeBinary) {
		throw new Error("vault-binary-write-unavailable");
	}
	const normalizedPath = normalizeVaultPath(filePath);
	await ensureFolderForFile(app, normalizedPath);
	await adapter.writeBinary(normalizedPath, binary);
}

async function vaultPathExists(app: App, filePath: string): Promise<boolean> {
	const adapter = getAdapter(app);
	const normalizedPath = normalizeVaultPath(filePath);
	if (!normalizedPath || !adapter.exists) {
		return false;
	}
	try {
		return await adapter.exists(normalizedPath);
	} catch {
		return false;
	}
}

function retargetJsonDocument(value: unknown, bookId: string, bookPath: string): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return value;
	}
	const record = { ...(value as Record<string, unknown>) };
	if ("bookId" in record) {
		record.bookId = bookId;
	}
	if ("filePath" in record) {
		record.filePath = bookPath;
	}
	if ("sourcePath" in record) {
		record.sourcePath = bookPath;
	}
	return record;
}

async function importJsonFromZip(options: {
	app: App;
	zip: JSZip;
	zipPath: string;
	targetPath: string;
	bookId: string;
	bookPath: string;
	moduleKey: string;
	importedModules: string[];
	backupPaths: string[];
}): Promise<unknown | null> {
	const text = await options.zip.file(options.zipPath)?.async("string");
	if (!text) {
		return null;
	}
	const parsed = parseJsonText(text);
	const retargeted = retargetJsonDocument(parsed, options.bookId, options.bookPath);
	await writeVaultTextWithBackup(
		options.app,
		options.targetPath,
		JSON.stringify(retargeted ?? parsed ?? {}, null, 2),
		options.backupPaths,
	);
	if (!options.importedModules.includes(options.moduleKey)) {
		options.importedModules.push(options.moduleKey);
	}
	return retargeted;
}

function sanitizeNoteTitle(value: unknown, fallback: string): string {
	return (
		String(value || "").trim()
			.replace(/[\\/:*?"<>|\r\n\t]+/g, "-")
			.replace(/\s+/g, " ")
			.replace(/^-+|-+$/g, "") || fallback
	);
}

function readPackageMetaPath(value: unknown): string {
	const record =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	return normalizeVaultPath(record.notePath);
}

async function addTextFileIfPresent(
	app: App,
	zip: JSZip,
	sourcePath: string,
	zipPath: string,
): Promise<boolean> {
	const text = await readVaultText(app, sourcePath);
	if (text === null) {
		return false;
	}
	zip.file(zipPath, text);
	return true;
}

async function addBookFileIfRequested(
	app: App,
	zip: JSZip,
	includeBook: boolean,
	bookPath: string,
	fallbackName: string,
): Promise<boolean> {
	if (!includeBook) {
		return false;
	}
	const binary = await readVaultBinary(app, bookPath);
	if (!binary) {
		return false;
	}
	zip.file(
		`book/${getFileName(bookPath, fallbackName)}`,
		binary instanceof Uint8Array ? binary : new Uint8Array(binary),
	);
	return true;
}

async function addVersionsDirectory(app: App, zip: JSZip, bookDir: string): Promise<void> {
	const versionsRoot = normalizeVaultPath(`${bookDir}/versions`);
	for (const filePath of await collectVaultFilesRecursively(app, versionsRoot)) {
		const text = await readVaultText(app, filePath);
		if (text !== null) {
			zip.file(`data/versions/${relativeTo(versionsRoot, filePath)}`, text);
		}
	}
}

function createManifest(options: {
	bookFormat: ReadingPackageBookFormat;
	bookId: string;
	bookPath: string;
	displayName?: string;
	bookFileFallback: string;
	modules: ReadingPackageModuleSelection;
}): ReadingPackageManifestV2 {
	const modules = {
		book: options.modules.book === true,
		annotationSystem: options.modules.annotationSystem === true,
		navigationState: options.modules.navigationState === true,
		aiReadingNote:
			options.bookFormat === "epub" ? options.modules.aiReadingNote === true : false,
		ink: options.bookFormat === "pdf" ? options.modules.ink === true : false,
	};
	return {
		format: BOOK_PACKAGE_V2_FORMAT,
		version: 2,
		bookFormat: options.bookFormat,
		bookId: options.bookId,
		bookPath: options.bookPath,
		bookFileName: getFileName(options.bookPath, options.bookFileFallback),
		title: String(options.displayName || "").trim() || undefined,
		includeBook: modules.book === true,
		modules,
		exportedAt: Date.now(),
	};
}

function getPdfLocation(bookId: string, filePath: string): PdfPortableBookDataLocation {
	const resolved = resolvePdfPortableBookDataLocation(filePath);
	if (!bookId || resolved.bookId === bookId) {
		return resolved;
	}
	const bookDir = normalizeVaultPath(`weave/pdf-data/books/${bookId}`);
	return {
		...resolved,
		bookId,
		bookDir,
		bookMetadataPath: `${bookDir}/book.json`,
		annotationsPath: `${bookDir}/annotations.json`,
		inkPath: `${bookDir}/ink.json`,
		annotationsMarkdownPath: `${bookDir}/annotations.md`,
		semanticProfilePath: `${bookDir}/semantic-profile.json`,
		bookmarksPath: `${bookDir}/bookmarks.json`,
		readingStatePath: `${bookDir}/reading-state.json`,
	};
}

async function createEpubReadingPackage(
	app: App,
	options: CreateReadingPackageOptions,
): Promise<ReadingPackageResult> {
	const bookPath = normalizeVaultPath(options.filePath);
	const location = resolveEpubPortableBookDataLocation(options.bookId);
	const zip = new JSZip();
	const manifest = createManifest({
		bookFormat: "epub",
		bookId: location.bookId,
		bookPath,
		displayName: options.displayName,
		bookFileFallback: "book.epub",
		modules: options.modules,
	});
	writeReadingPackageManifest(zip, manifest);
	const includedBook = await addBookFileIfRequested(app, zip, manifest.includeBook, bookPath, "book.epub");
	if (manifest.includeBook && !includedBook) {
		throw new Error("reading-package-book-file-unavailable");
	}

	const bookJson = await readVaultText(app, location.bookMetadataPath);
	const bookRecord = parseJsonObject(bookJson);
	if (bookJson !== null) {
		zip.file("data/book.json", bookJson);
	}

	if (options.modules.annotationSystem) {
		await addTextFileIfPresent(app, zip, location.annotationsPath, "data/annotations.json");
		await addTextFileIfPresent(app, zip, location.annotationsMarkdownPath, "data/annotations.md");
		await addTextFileIfPresent(app, zip, location.semanticProfilePath, "data/semantic-profile.json");
		await addTextFileIfPresent(app, zip, `${location.bookDir}/active-version.json`, "data/active-version.json");
		await addVersionsDirectory(app, zip, location.bookDir);
	}
	if (options.modules.navigationState) {
		await addTextFileIfPresent(app, zip, location.bookmarksPath, "data/bookmarks.json");
		await addTextFileIfPresent(app, zip, location.readingStatePath, "data/reading-state.json");
	}
	if (options.modules.aiReadingNote) {
		const notePath =
			readDataPath(bookRecord, "aiReadingNote") ||
			resolveEpubAiReadingNotePath({
				bookTitle: options.displayName,
				filePath: bookPath,
			});
		const noteMarkdown = await readVaultText(app, notePath);
		if (noteMarkdown !== null) {
			zip.file("data/ai-reading/note.md", noteMarkdown);
			zip.file(
				"data/ai-reading/meta.json",
				JSON.stringify({ notePath, sourceFile: bookPath, updatedAt: Date.now() }, null, 2),
			);
		}
	}

	const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
	return {
		arrayBuffer,
		fileName: `${sanitizePackageFileName(
			options.displayName || getFileName(bookPath, "book.epub").replace(/\.[^.]+$/g, ""),
			"book",
		)}-weave-reader.zip`,
		bookId: location.bookId,
		bookPath,
	};
}

async function createPdfReadingPackage(
	app: App,
	options: CreateReadingPackageOptions,
): Promise<ReadingPackageResult> {
	const bookPath = normalizeVaultPath(options.filePath);
	const location = getPdfLocation(options.bookId, bookPath);
	const zip = new JSZip();
	const manifest = createManifest({
		bookFormat: "pdf",
		bookId: location.bookId,
		bookPath,
		displayName: options.displayName,
		bookFileFallback: "document.pdf",
		modules: options.modules,
	});
	writeReadingPackageManifest(zip, manifest);
	const includedBook = await addBookFileIfRequested(app, zip, manifest.includeBook, bookPath, "document.pdf");
	if (manifest.includeBook && !includedBook) {
		throw new Error("reading-package-book-file-unavailable");
	}

	await addTextFileIfPresent(app, zip, location.bookMetadataPath, "data/book.json");
	if (options.modules.annotationSystem) {
		await addTextFileIfPresent(app, zip, location.annotationsPath, "data/annotations.json");
		await addTextFileIfPresent(app, zip, location.annotationsMarkdownPath, "data/annotations.md");
		await addTextFileIfPresent(app, zip, location.semanticProfilePath, "data/semantic-profile.json");
	}
	if (options.modules.ink) {
		await addTextFileIfPresent(app, zip, location.inkPath, "data/ink.json");
	}
	if (options.modules.navigationState) {
		await addTextFileIfPresent(app, zip, location.bookmarksPath, "data/bookmarks.json");
		await addTextFileIfPresent(app, zip, location.readingStatePath, "data/reading-state.json");
	}

	const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
	return {
		arrayBuffer,
		fileName: `${sanitizePackageFileName(
			options.displayName || getFileName(bookPath, "document.pdf").replace(/\.[^.]+$/g, ""),
			"document",
		)}-weave-reader.zip`,
		bookId: location.bookId,
		bookPath,
	};
}

export async function createReadingPackage(
	app: App,
	options: CreateReadingPackageOptions,
): Promise<ReadingPackageResult> {
	if (!hasSelectedReadingPackageModule(options.modules)) {
		throw new Error("reading-package-empty-selection");
	}
	if (options.bookFormat === "pdf") {
		return createPdfReadingPackage(app, options);
	}
	return createEpubReadingPackage(app, options);
}

function getPackageBookEntry(zip: JSZip) {
	return Object.values(zip.files).find((entry) => {
		const entryName = normalizeVaultPath(entry.name);
		return !entry.dir && entryName.startsWith("book/");
	}) || null;
}

function getPackageBookImportFileName(
	entryName: string,
	manifest: ReadingPackageManifestV2,
	fallbackName: string,
): string {
	return sanitizePackageFileName(
		manifest.bookFileName || getFileName(entryName, fallbackName),
		fallbackName,
	);
}

async function resolveImportBookPath(options: {
	app: App;
	zip: JSZip;
	manifest: ReadingPackageManifestV2;
	importOptions: ImportReadingPackageOptions;
	fallbackName: string;
}): Promise<{ bookPath: string; importedBook: boolean }> {
	const targetBookPath = normalizeVaultPath(options.importOptions.targetBookPath);
	if (targetBookPath) {
		return { bookPath: targetBookPath, importedBook: false };
	}

	const bookEntry = getPackageBookEntry(options.zip);
	if (bookEntry) {
		const bookPath = await generateUniqueVaultFilePath(
			options.app,
			options.importOptions.defaultBookFolder || "/",
			getPackageBookImportFileName(bookEntry.name, options.manifest, options.fallbackName),
		);
		await writeVaultBinary(options.app, bookPath, await bookEntry.async("arraybuffer"));
		return { bookPath, importedBook: true };
	}

	const manifestBookPath = normalizeVaultPath(options.manifest.bookPath);
	if (manifestBookPath && await vaultPathExists(options.app, manifestBookPath)) {
		return { bookPath: manifestBookPath, importedBook: false };
	}

	throw new Error("reading-package-target-book-required");
}

async function importTextFromZip(options: {
	app: App;
	zip: JSZip;
	zipPath: string;
	targetPath: string;
	moduleKey: string;
	importedModules: string[];
	backupPaths: string[];
}): Promise<boolean> {
	const text = await options.zip.file(options.zipPath)?.async("string");
	if (text === undefined) {
		return false;
	}
	await writeVaultTextWithBackup(
		options.app,
		options.targetPath,
		text,
		options.backupPaths,
	);
	if (!options.importedModules.includes(options.moduleKey)) {
		options.importedModules.push(options.moduleKey);
	}
	return true;
}

async function importVersionFiles(options: {
	app: App;
	zip: JSZip;
	bookDir: string;
	bookId: string;
	bookPath: string;
	importedModules: string[];
	backupPaths: string[];
}): Promise<void> {
	for (const entry of Object.values(options.zip.files)) {
		if (entry.dir || !entry.name.startsWith("data/versions/")) {
			continue;
		}
		const text = await entry.async("string");
		const parsed = parseJsonText(text);
		const nextText = parsed
			? JSON.stringify(
					retargetJsonDocument(parsed, options.bookId, options.bookPath),
					null,
					2,
				)
			: text;
		await writeVaultTextWithBackup(
			options.app,
			normalizeVaultPath(`${options.bookDir}/${entry.name.slice("data/".length)}`),
			nextText,
			options.backupPaths,
		);
		if (!options.importedModules.includes("annotationSystem")) {
			options.importedModules.push("annotationSystem");
		}
	}
}

async function upsertEpubBookJsonAiNotePointer(options: {
	app: App;
	bookJsonPath: string;
	bookId: string;
	bookPath: string;
	notePath: string;
	backupPaths: string[];
}): Promise<void> {
	const current = parseJsonObject(await readVaultText(options.app, options.bookJsonPath)) || {};
	const dataPaths =
		current.dataPaths && typeof current.dataPaths === "object" && !Array.isArray(current.dataPaths)
			? { ...(current.dataPaths as Record<string, unknown>) }
			: {};
	dataPaths.aiReadingNote = options.notePath;
	const next = {
		...current,
		bookId: options.bookId,
		filePath: options.bookPath,
		dataPaths,
		aiReading: {
			...(current.aiReading && typeof current.aiReading === "object" && !Array.isArray(current.aiReading)
				? (current.aiReading as Record<string, unknown>)
				: {}),
			sourceFile: options.bookPath,
			updatedAt: Date.now(),
		},
	};
	await writeVaultTextWithBackup(
		options.app,
		options.bookJsonPath,
		JSON.stringify(next, null, 2),
		options.backupPaths,
	);
}

async function importEpubAiReadingNote(options: {
	app: App;
	zip: JSZip;
	manifest: ReadingPackageManifestV2;
	bookJsonPath: string;
	bookId: string;
	bookPath: string;
	importedModules: string[];
	backupPaths: string[];
}): Promise<void> {
	const noteMarkdown = await options.zip.file("data/ai-reading/note.md")?.async("string");
	if (noteMarkdown === undefined) {
		return;
	}
	const meta = parseJsonText(await options.zip.file("data/ai-reading/meta.json")?.async("string") || null);
	const fallbackTitle =
		options.manifest.title ||
		getFileName(options.bookPath, "EPUB").replace(/\.[^.]+$/g, "") ||
		"EPUB";
	const notePath =
		readPackageMetaPath(meta) ||
		normalizeVaultPath(`AI阅读笔记/${sanitizeNoteTitle(fallbackTitle, "EPUB")} - AI阅读.md`);
	const retargeted = retargetAiReadingNoteSourceFile(noteMarkdown, options.bookPath);
	const local = await readVaultText(options.app, notePath);
	const merged = mergeAiReadingNoteMarkdown(local || "", retargeted);
	await writeVaultTextWithBackup(options.app, notePath, merged, options.backupPaths);
	await upsertEpubBookJsonAiNotePointer({
		app: options.app,
		bookJsonPath: options.bookJsonPath,
		bookId: options.bookId,
		bookPath: options.bookPath,
		notePath,
		backupPaths: options.backupPaths,
	});
	if (!options.importedModules.includes("aiReadingNote")) {
		options.importedModules.push("aiReadingNote");
	}
}

async function importEpubReadingPackage(
	app: App,
	zip: JSZip,
	manifest: ReadingPackageManifestV2,
	options: ImportReadingPackageOptions,
): Promise<ReadingPackageImportResult> {
	const bookId = normalizeVaultPath(options.preferredBookId || manifest.bookId);
	const importTarget = await resolveImportBookPath({
		app,
		zip,
		manifest,
		importOptions: options,
		fallbackName: "book.epub",
	});
	const bookPath = importTarget.bookPath;
	const location = resolveEpubPortableBookDataLocation(bookId);
	const importedModules: string[] = importTarget.importedBook ? ["book"] : [];
	const backupPaths: string[] = [];

	if (manifest.modules.annotationSystem) {
		await importJsonFromZip({
			app,
			zip,
			zipPath: "data/annotations.json",
			targetPath: location.annotationsPath,
			bookId: location.bookId,
			bookPath,
			moduleKey: "annotationSystem",
			importedModules,
			backupPaths,
		});
		await importTextFromZip({
			app,
			zip,
			zipPath: "data/annotations.md",
			targetPath: location.annotationsMarkdownPath,
			moduleKey: "annotationSystem",
			importedModules,
			backupPaths,
		});
		await importJsonFromZip({
			app,
			zip,
			zipPath: "data/semantic-profile.json",
			targetPath: location.semanticProfilePath,
			bookId: location.bookId,
			bookPath,
			moduleKey: "annotationSystem",
			importedModules,
			backupPaths,
		});
		await importJsonFromZip({
			app,
			zip,
			zipPath: "data/active-version.json",
			targetPath: normalizeVaultPath(`${location.bookDir}/active-version.json`),
			bookId: location.bookId,
			bookPath,
			moduleKey: "annotationSystem",
			importedModules,
			backupPaths,
		});
		await importVersionFiles({
			app,
			zip,
			bookDir: location.bookDir,
			bookId: location.bookId,
			bookPath,
			importedModules,
			backupPaths,
		});
	}

	if (manifest.modules.navigationState) {
		await importJsonFromZip({
			app,
			zip,
			zipPath: "data/bookmarks.json",
			targetPath: location.bookmarksPath,
			bookId: location.bookId,
			bookPath,
			moduleKey: "navigationState",
			importedModules,
			backupPaths,
		});
		await importJsonFromZip({
			app,
			zip,
			zipPath: "data/reading-state.json",
			targetPath: location.readingStatePath,
			bookId: location.bookId,
			bookPath,
			moduleKey: "navigationState",
			importedModules,
			backupPaths,
		});
	}

	if (manifest.modules.aiReadingNote) {
		await importEpubAiReadingNote({
			app,
			zip,
			manifest,
			bookJsonPath: location.bookMetadataPath,
			bookId: location.bookId,
			bookPath,
			importedModules,
			backupPaths,
		});
	}

	return {
		bookFormat: "epub",
		bookId: location.bookId,
		bookPath,
		importedModules,
		backupPaths,
	};
}

async function regeneratePdfAnnotationsMarkdown(options: {
	app: App;
	location: PdfPortableBookDataLocation;
	bookPath: string;
	title?: string;
	backupPaths: string[];
}): Promise<void> {
	const annotationText = await readVaultText(options.app, options.location.annotationsPath);
	const parsed = parseJsonObject(annotationText);
	if (!parsed) {
		return;
	}
	const annotations = Array.isArray(parsed.annotations) ? parsed.annotations : [];
	const pageCount = Math.max(0, Math.floor(Number(parsed.pageCount) || 0));
	const markdown = renderPdfAnnotationNoteMarkdown({
		bookId: options.location.bookId,
		book: {
			title: options.title || getFileName(options.bookPath, "PDF").replace(/\.[^.]+$/g, ""),
			filePath: options.bookPath,
			pageCount,
		},
		annotations: annotations as Parameters<typeof renderPdfAnnotationNoteMarkdown>[0]["annotations"],
	});
	await writeVaultTextWithBackup(
		options.app,
		options.location.annotationsMarkdownPath,
		markdown,
		options.backupPaths,
	);
}

async function importPdfReadingPackage(
	app: App,
	zip: JSZip,
	manifest: ReadingPackageManifestV2,
	options: ImportReadingPackageOptions,
): Promise<ReadingPackageImportResult> {
	const importTarget = await resolveImportBookPath({
		app,
		zip,
		manifest,
		importOptions: options,
		fallbackName: "document.pdf",
	});
	const bookPath = importTarget.bookPath;
	const location = getPdfLocation(options.preferredBookId || "", bookPath);
	const importedModules: string[] = importTarget.importedBook ? ["book"] : [];
	const backupPaths: string[] = [];

	if (manifest.modules.annotationSystem) {
		await importJsonFromZip({
			app,
			zip,
			zipPath: "data/annotations.json",
			targetPath: location.annotationsPath,
			bookId: location.bookId,
			bookPath,
			moduleKey: "annotationSystem",
			importedModules,
			backupPaths,
		});
		await importJsonFromZip({
			app,
			zip,
			zipPath: "data/semantic-profile.json",
			targetPath: location.semanticProfilePath,
			bookId: location.bookId,
			bookPath,
			moduleKey: "annotationSystem",
			importedModules,
			backupPaths,
		});
		await regeneratePdfAnnotationsMarkdown({
			app,
			location,
			bookPath,
			title: manifest.title,
			backupPaths,
		});
	}

	if (manifest.modules.ink) {
		await importJsonFromZip({
			app,
			zip,
			zipPath: "data/ink.json",
			targetPath: location.inkPath,
			bookId: location.bookId,
			bookPath,
			moduleKey: "ink",
			importedModules,
			backupPaths,
		});
	}

	if (manifest.modules.navigationState) {
		await importJsonFromZip({
			app,
			zip,
			zipPath: "data/bookmarks.json",
			targetPath: location.bookmarksPath,
			bookId: location.bookId,
			bookPath,
			moduleKey: "navigationState",
			importedModules,
			backupPaths,
		});
		await importJsonFromZip({
			app,
			zip,
			zipPath: "data/reading-state.json",
			targetPath: location.readingStatePath,
			bookId: location.bookId,
			bookPath,
			moduleKey: "navigationState",
			importedModules,
			backupPaths,
		});
	}

	return {
		bookFormat: "pdf",
		bookId: location.bookId,
		bookPath,
		importedModules,
		backupPaths,
	};
}

export async function importReadingPackage(
	app: App,
	arrayBuffer: ArrayBuffer,
	options: ImportReadingPackageOptions = {},
): Promise<ReadingPackageImportResult> {
	const zip = await JSZip.loadAsync(arrayBuffer);
	const manifest = await readReadingPackageManifest(zip);
	if (!manifest) {
		throw new Error("invalid-weave-reader-package");
	}
	if (manifest.bookFormat === "pdf") {
		return importPdfReadingPackage(app, zip, manifest, options);
	}
	return importEpubReadingPackage(app, zip, manifest, options);
}

export function downloadReadingPackage(result: ReadingPackageResult): void {
	if (typeof document === "undefined") {
		return;
	}
	const blob = new Blob([result.arrayBuffer], { type: "application/zip" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = result.fileName;
	anchor.style.display = "none";
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickReadingPackageArrayBuffer(): Promise<ArrayBuffer | null> {
	if (typeof document === "undefined") {
		return Promise.resolve(null);
	}
	return new Promise((resolve) => {
		const input = document.createElement("input");
		let settled = false;
		const finish = (value: ArrayBuffer | null) => {
			if (settled) {
				return;
			}
			settled = true;
			input.remove();
			resolve(value);
		};
		input.type = "file";
		input.accept = ".zip,application/zip,application/x-zip-compressed";
		input.style.display = "none";
		input.addEventListener("change", () => {
			void (async () => {
				const file = input.files?.[0];
				if (!file) {
					finish(null);
					return;
				}
				try {
					finish(await file.arrayBuffer());
				} catch {
					finish(null);
				}
			})();
		});
		input.addEventListener("cancel", () => finish(null));
		document.body.appendChild(input);
		input.click();
	});
}
