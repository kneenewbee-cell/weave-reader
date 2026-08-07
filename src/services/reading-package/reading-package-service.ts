import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import JSZip from "jszip";
import { resolveEpubAiReadingNotePath } from "../epub/epub-ai-reading";
import {
	applyFingerprintsToRecord as applyEpubFingerprintsToRecord,
	findExistingBookMatchByFingerprints as findExistingEpubBookMatchByFingerprints,
	hasAnyFingerprint as hasAnyEpubFingerprint,
	hasMatchingFingerprint as hasMatchingEpubFingerprint,
	mergeFingerprints as mergeEpubFingerprints,
	readFingerprintsFromRecord as readEpubFingerprintsFromRecord,
	type ExistingPortableBookMatch,
} from "../epub/epub-portable-book-package";
import {
	ensureActiveEpubAnnotationVersion,
	listEpubAnnotationVersions,
	readActiveEpubAnnotationVersionAnnotations,
	safeEpubAnnotationVersionId,
} from "../epub/epub-annotation-version-store";
import { generateUniqueVaultFilePath } from "../epub/epub-markdown-path-resolver";
import { resolveEpubPortableBookDataLocation } from "../epub/epub-portable-data-location";
import {
	computeAvailableEpubFingerprints,
	type PartialEpubFingerprints,
} from "../epub/epub-fingerprints";
import { materializeEpubSemanticProfileForVersion } from "../epub/semantic/semantic-store";
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

export type ReadingPackageImportMode =
	| "fingerprintMatch"
	| "specifiedTarget"
	| "embeddedBook"
	| "existingBookPath";

export interface ReadingPackageImportResult {
	bookFormat: ReadingPackageBookFormat;
	bookId: string;
	bookPath: string;
	bookTitle?: string;
	sourceBookPath?: string;
	importMode: ReadingPackageImportMode;
	importedModules: string[];
	backupPaths: string[];
}

function getAdapter(app: App): AdapterLike {
	return ((app.vault as unknown as { adapter?: AdapterLike }).adapter || {});
}

function normalizeVaultPath(path: unknown): string {
	return normalizePath(String(path || "").trim());
}

function normalizeOptionalVaultPath(path: unknown): string {
	const raw = String(path || "").trim();
	if (!raw) {
		return "";
	}
	const normalizedPath = normalizeVaultPath(raw);
	return normalizedPath && normalizedPath !== "/" && normalizedPath !== "."
		? normalizedPath
		: "";
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

async function computeEpubVaultBookFingerprints(
	app: App,
	bookPath: string,
): Promise<PartialEpubFingerprints> {
	const binary = await readVaultBinary(app, bookPath);
	if (!binary) {
		return {};
	}
	try {
		return await computeAvailableEpubFingerprints(binary);
	} catch {
		return {};
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

type PackageDataEntry = {
	relativePath: string;
	text: string;
	parsed: unknown | null;
};

const EPUB_DEFAULT_ANNOTATION_VERSION_ID = "default";
const EPUB_SEMANTIC_PROFILE_FORMAT = "weave-reader-semantic-profile/v1";

function cleanText(value: unknown): string {
	return String(value || "").trim();
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function countPortableAnnotations(value: unknown): number {
	return isObjectRecord(value) && Array.isArray(value.annotations)
		? value.annotations.length
		: 0;
}

function getVersionIdFromPackageRelativePath(relativePath: string): string {
	const match = normalizeVaultPath(relativePath).match(/^versions\/([^/]+)\//);
	return match ? safeEpubAnnotationVersionId(match[1]) : "";
}

function replaceVersionIdInPackageRelativePath(relativePath: string, nextVersionId: string): string {
	return normalizeVaultPath(relativePath).replace(
		/^versions\/([^/]+)\//,
		`versions/${nextVersionId}/`,
	);
}

function isEpubAnnotationPackageEntry(relativePath: string): boolean {
	const normalizedPath = normalizeVaultPath(relativePath);
	return (
		normalizedPath === "annotations.json" ||
		normalizedPath === "annotations.md" ||
		normalizedPath === "semantic-profile.json" ||
		normalizedPath === "active-version.json" ||
		normalizedPath.startsWith("versions/")
	);
}

function isDerivedEpubAnnotationEntry(relativePath: string): boolean {
	return normalizeVaultPath(relativePath) === "annotations.md";
}

async function readPackageDataEntries(zip: JSZip): Promise<PackageDataEntry[]> {
	const entries: PackageDataEntry[] = [];
	for (const entry of Object.values(zip.files)) {
		const normalizedEntryName = normalizeVaultPath(entry.name);
		if (entry.dir || !normalizedEntryName.startsWith("data/")) {
			continue;
		}
		const relativePath = normalizedEntryName.slice("data/".length);
		const text = await entry.async("string");
		entries.push({
			relativePath,
			text,
			parsed: parseJsonText(text),
		});
	}
	return entries;
}

function getPackageAnnotationVersionIds(entries: PackageDataEntry[]): string[] {
	const versionIds = Array.from(
		new Set(
			entries
				.map((entry) => getVersionIdFromPackageRelativePath(entry.relativePath))
				.filter(Boolean),
		),
	);
	if (versionIds.length) {
		return versionIds;
	}
	const hasRootAnnotationData = entries.some((entry) =>
		["annotations.json", "semantic-profile.json", "active-version.json"].includes(
			normalizeVaultPath(entry.relativePath),
		),
	);
	return hasRootAnnotationData ? [EPUB_DEFAULT_ANNOTATION_VERSION_ID] : [];
}

async function getUniqueImportedEpubVersionId(
	app: App,
	bookId: string,
	originalVersionId: string,
): Promise<string> {
	const adapter = getAdapter(app);
	const baseId = safeEpubAnnotationVersionId(
		`imported-${originalVersionId || EPUB_DEFAULT_ANNOTATION_VERSION_ID}`,
	);
	if (!adapter.exists) {
		return baseId;
	}
	for (let index = 1; index <= 500; index += 1) {
		const candidate = index === 1 ? baseId : `${baseId}-${index}`;
		const candidateDir = normalizeVaultPath(`${resolveEpubPortableBookDataLocation(bookId).bookDir}/versions/${candidate}`);
		const candidateExists =
			(await adapter.exists(candidateDir)) ||
			(await adapter.exists(`${candidateDir}/version.json`)) ||
			(await adapter.exists(`${candidateDir}/annotations.json`)) ||
			(await adapter.exists(`${candidateDir}/semantic-profile.json`));
		if (!candidateExists) {
			return candidate;
		}
	}
	return `${baseId}-${Date.now().toString(36)}`;
}

function retargetEpubAnnotationVersionJson(
	value: unknown,
	bookId: string,
	versionId: string,
	importAsSeparateVersion: boolean,
): unknown {
	if (!isObjectRecord(value)) {
		return value;
	}
	const next: Record<string, unknown> = { ...value, bookId, versionId };
	if (importAsSeparateVersion) {
		const name = cleanText(next.name) || versionId;
		next.name = name.includes("import") ? name : `${name} (imported)`;
		next.source = cleanText(next.source) || "imported-reading-package";
		next.updatedAt = Date.now();
	}
	return next;
}

function retargetEpubSemanticProfileJson(value: unknown, bookId: string, versionId: string): unknown {
	if (!isObjectRecord(value)) {
		return value;
	}
	const next: Record<string, unknown> = { ...value, bookId };
	if (next.format !== EPUB_SEMANTIC_PROFILE_FORMAT) {
		return next;
	}
	const safeVersionId = safeEpubAnnotationVersionId(versionId || EPUB_DEFAULT_ANNOTATION_VERSION_ID);
	return {
		...next,
		scope: "version",
		versionId: safeVersionId,
		sourceVersionId: safeVersionId,
	};
}

function readPackageActiveVersionId(entries: PackageDataEntry[]): string {
	const activeEntry = entries.find(
		(entry) => normalizeVaultPath(entry.relativePath) === "active-version.json",
	);
	return safeEpubAnnotationVersionId(
		isObjectRecord(activeEntry?.parsed)
			? activeEntry?.parsed.activeVersionId
			: EPUB_DEFAULT_ANNOTATION_VERSION_ID,
	);
}

async function importEpubAnnotationSystemAsSeparateVersions(options: {
	app: App;
	entries: PackageDataEntry[];
	bookDir: string;
	bookId: string;
	bookPath: string;
	importedModules: string[];
	backupPaths: string[];
}): Promise<string[]> {
	const packageVersionIds = getPackageAnnotationVersionIds(options.entries);
	const versionMap = new Map<string, string>();
	for (const versionId of packageVersionIds) {
		versionMap.set(
			versionId,
			await getUniqueImportedEpubVersionId(options.app, options.bookId, versionId),
		);
	}
	const packageActiveVersionId = readPackageActiveVersionId(options.entries);
	const mappedActiveVersionId =
		versionMap.get(packageActiveVersionId) ||
		Array.from(versionMap.values())[0] ||
		"";

	for (const entry of options.entries) {
		const normalizedRelativePath = normalizeVaultPath(entry.relativePath);
		if (!isEpubAnnotationPackageEntry(normalizedRelativePath) || isDerivedEpubAnnotationEntry(normalizedRelativePath)) {
			continue;
		}
		if (normalizedRelativePath === "active-version.json") {
			continue;
		}

		const sourceVersionId = getVersionIdFromPackageRelativePath(normalizedRelativePath);
		const mappedVersionId =
			sourceVersionId
				? versionMap.get(sourceVersionId) || sourceVersionId
				: mappedActiveVersionId;
		if (!mappedVersionId) {
			continue;
		}

		let targetRelativePath = normalizedRelativePath;
		if (normalizedRelativePath === "annotations.json") {
			targetRelativePath = `versions/${mappedVersionId}/annotations.json`;
		} else if (normalizedRelativePath === "semantic-profile.json") {
			targetRelativePath = `versions/${mappedVersionId}/semantic-profile.json`;
		} else if (sourceVersionId) {
			targetRelativePath = replaceVersionIdInPackageRelativePath(
				normalizedRelativePath,
				mappedVersionId,
			);
		}

		let retargeted = entry.parsed
			? retargetJsonDocument(entry.parsed, options.bookId, options.bookPath)
			: null;
		if (retargeted && /^versions\/[^/]+\/version\.json$/.test(normalizedRelativePath)) {
			retargeted = retargetEpubAnnotationVersionJson(
				retargeted,
				options.bookId,
				mappedVersionId,
				true,
			);
		}
		if (
			retargeted &&
			(
				normalizedRelativePath === "semantic-profile.json" ||
				/^versions\/[^/]+\/semantic-profile\.json$/.test(normalizedRelativePath)
			)
		) {
			retargeted = retargetEpubSemanticProfileJson(
				retargeted,
				options.bookId,
				mappedVersionId,
			);
		}

		await writeVaultTextWithBackup(
			options.app,
			normalizeVaultPath(`${options.bookDir}/${targetRelativePath}`),
			retargeted ? JSON.stringify(retargeted, null, 2) : entry.text,
			options.backupPaths,
		);
	}

	await ensureActiveEpubAnnotationVersion(options.app, options.bookId);
	if (!options.importedModules.includes("annotationSystem")) {
		options.importedModules.push("annotationSystem");
	}
	return Array.from(new Set(Array.from(versionMap.values())));
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

function canonicalizeForCompare(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonicalizeForCompare);
	}
	if (!isObjectRecord(value)) {
		return value;
	}
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		result[key] = canonicalizeForCompare(value[key]);
	}
	return result;
}

function pdfInkStrokeSignature(value: unknown): string {
	return JSON.stringify(canonicalizeForCompare(value));
}

function readPdfInkStrokes(value: unknown): Record<string, unknown>[] {
	if (!isObjectRecord(value) || !Array.isArray(value.strokes)) {
		return [];
	}
	return value.strokes.filter((stroke): stroke is Record<string, unknown> =>
		isObjectRecord(stroke),
	);
}

function clonePdfInkStroke(
	stroke: Record<string, unknown>,
	nextId?: string,
): Record<string, unknown> {
	return JSON.parse(JSON.stringify({
		...stroke,
		...(nextId ? { id: nextId } : {}),
	})) as Record<string, unknown>;
}

function createImportedPdfInkStrokeId(
	originalId: string,
	usedIds: Set<string>,
): string {
	const base = cleanText(originalId)
		? `${cleanText(originalId)}-imported`
		: "imported-pdf-ink";
	for (let index = 1; index <= 500; index += 1) {
		const candidate = index === 1 ? base : `${base}-${index}`;
		if (!usedIds.has(candidate)) {
			return candidate;
		}
	}
	return `${base}-${Date.now().toString(36)}`;
}

function normalizePdfInkPageCount(...values: unknown[]): number {
	let pageCount = 0;
	for (const value of values) {
		const next = Math.floor(Number(value) || 0);
		if (Number.isFinite(next) && next > pageCount) {
			pageCount = next;
		}
	}
	return pageCount;
}

function mergePdfInkDocuments(options: {
	local: unknown;
	imported: unknown;
	bookPath: string;
}): Record<string, unknown> {
	const local = isObjectRecord(options.local) ? options.local : {};
	const imported = isObjectRecord(options.imported) ? options.imported : {};
	const mergedStrokes = readPdfInkStrokes(local).map((stroke) =>
		clonePdfInkStroke(stroke),
	);
	const byId = new Map<string, string>();
	const usedIds = new Set<string>();
	for (const stroke of mergedStrokes) {
		const id = cleanText(stroke.id);
		if (id) {
			usedIds.add(id);
			if (!byId.has(id)) {
				byId.set(id, pdfInkStrokeSignature(stroke));
			}
		}
	}

	for (const stroke of readPdfInkStrokes(imported)) {
		const id = cleanText(stroke.id);
		if (!id) {
			const nextId = createImportedPdfInkStrokeId("", usedIds);
			usedIds.add(nextId);
			mergedStrokes.push(clonePdfInkStroke(stroke, nextId));
			continue;
		}
		const existingSignature = byId.get(id);
		if (!existingSignature) {
			usedIds.add(id);
			byId.set(id, pdfInkStrokeSignature(stroke));
			mergedStrokes.push(clonePdfInkStroke(stroke));
			continue;
		}
		if (existingSignature === pdfInkStrokeSignature(stroke)) {
			continue;
		}
		const nextId = createImportedPdfInkStrokeId(id, usedIds);
		usedIds.add(nextId);
		mergedStrokes.push(clonePdfInkStroke(stroke, nextId));
	}

	return {
		...local,
		...imported,
		version: 1,
		sourcePath: options.bookPath,
		pageCount: normalizePdfInkPageCount(local.pageCount, imported.pageCount),
		strokes: mergedStrokes,
		updatedAt: Date.now(),
	};
}

async function importPdfInkFromZip(options: {
	app: App;
	zip: JSZip;
	zipPath: string;
	targetPath: string;
	bookId: string;
	bookPath: string;
	importedModules: string[];
	backupPaths: string[];
}): Promise<boolean> {
	const text = await options.zip.file(options.zipPath)?.async("string");
	if (text === undefined) {
		return false;
	}
	const imported = retargetJsonDocument(
		parseJsonText(text),
		options.bookId,
		options.bookPath,
	);
	const local = parseJsonText(await readVaultText(options.app, options.targetPath));
	const merged = mergePdfInkDocuments({
		local,
		imported,
		bookPath: options.bookPath,
	});
	await writeVaultTextWithBackup(
		options.app,
		options.targetPath,
		JSON.stringify(merged, null, 2),
		options.backupPaths,
	);
	if (!options.importedModules.includes("ink")) {
		options.importedModules.push("ink");
	}
	return true;
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

async function addVersionsDirectory(app: App, zip: JSZip, bookDir: string): Promise<boolean> {
	const versionsRoot = normalizeVaultPath(`${bookDir}/versions`);
	let added = false;
	for (const filePath of await collectVaultFilesRecursively(app, versionsRoot)) {
		const text = await readVaultText(app, filePath);
		if (text !== null) {
			zip.file(`data/versions/${relativeTo(versionsRoot, filePath)}`, text);
			added = true;
		}
	}
	return added;
}

function createManifest(options: {
	bookFormat: ReadingPackageBookFormat;
	bookId: string;
	bookPath: string;
	displayName?: string;
	bookFileFallback: string;
	modules: ReadingPackageModuleSelection;
	fingerprints?: PartialEpubFingerprints;
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
		sourceFingerprint: options.fingerprints?.fileFingerprint || undefined,
		fileFingerprint: options.fingerprints?.fileFingerprint || undefined,
		packageFingerprint: options.fingerprints?.packageFingerprint || undefined,
		contentFingerprint: options.fingerprints?.contentFingerprint || undefined,
		includeBook: modules.book === true,
		modules,
		exportedAt: Date.now(),
	};
}

function createEmptyReadingPackageModuleSelection(): ReadingPackageModuleSelection {
	return {
		book: false,
		annotationSystem: false,
		ink: false,
		navigationState: false,
		aiReadingNote: false,
	};
}

function assertReadingPackageHasActualContent(modules: ReadingPackageModuleSelection): void {
	if (!hasSelectedReadingPackageModule(modules)) {
		throw new Error("reading-package-empty-content");
	}
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
	const actualModules = createEmptyReadingPackageModuleSelection();
	const bookJson = await readVaultText(app, location.bookMetadataPath);
	const bookRecord = parseJsonObject(bookJson);
	const bookBinary = await readVaultBinary(app, bookPath);
	const computedFingerprints = bookBinary
		? await computeAvailableEpubFingerprints(bookBinary)
		: {};
	const fingerprints = mergeEpubFingerprints(
		computedFingerprints,
		readEpubFingerprintsFromRecord(bookRecord),
	);
	if (options.modules.book) {
		if (!bookBinary) {
			throw new Error("reading-package-book-file-unavailable");
		}
		zip.file(
			`book/${getFileName(bookPath, "book.epub")}`,
			bookBinary instanceof Uint8Array ? bookBinary : new Uint8Array(bookBinary),
		);
		actualModules.book = true;
	}

	if (bookJson !== null) {
		const withFingerprints = bookRecord
			? applyEpubFingerprintsToRecord(bookRecord, fingerprints)
			: null;
		zip.file(
			"data/book.json",
			withFingerprints ? JSON.stringify(withFingerprints, null, 2) : bookJson,
		);
	}

	if (options.modules.annotationSystem) {
		await ensureActiveEpubAnnotationVersion(app, location.bookId);
		for (const version of await listEpubAnnotationVersions(app, location.bookId)) {
			await materializeEpubSemanticProfileForVersion(app, location.bookId, version.versionId);
		}
		const includedAnnotations = await addTextFileIfPresent(app, zip, location.annotationsPath, "data/annotations.json");
		const includedMarkdown = await addTextFileIfPresent(app, zip, location.annotationsMarkdownPath, "data/annotations.md");
		const includedSemantic = await addTextFileIfPresent(app, zip, location.semanticProfilePath, "data/semantic-profile.json");
		const includedActiveVersion = await addTextFileIfPresent(app, zip, `${location.bookDir}/active-version.json`, "data/active-version.json");
		const includedVersions = await addVersionsDirectory(app, zip, location.bookDir);
		actualModules.annotationSystem =
			includedAnnotations ||
			includedMarkdown ||
			includedSemantic ||
			includedActiveVersion ||
			includedVersions;
	}
	if (options.modules.navigationState) {
		const includedBookmarks = await addTextFileIfPresent(app, zip, location.bookmarksPath, "data/bookmarks.json");
		const includedReadingState = await addTextFileIfPresent(app, zip, location.readingStatePath, "data/reading-state.json");
		actualModules.navigationState = includedBookmarks || includedReadingState;
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
			actualModules.aiReadingNote = true;
		}
	}

	assertReadingPackageHasActualContent(actualModules);
	writeReadingPackageManifest(zip, createManifest({
		bookFormat: "epub",
		bookId: location.bookId,
		bookPath,
		displayName: options.displayName,
		bookFileFallback: "book.epub",
		modules: actualModules,
		fingerprints,
	}));

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
	const actualModules = createEmptyReadingPackageModuleSelection();
	const includedBook = await addBookFileIfRequested(app, zip, options.modules.book, bookPath, "document.pdf");
	if (options.modules.book && !includedBook) {
		throw new Error("reading-package-book-file-unavailable");
	}
	actualModules.book = includedBook;

	await addTextFileIfPresent(app, zip, location.bookMetadataPath, "data/book.json");
	if (options.modules.annotationSystem) {
		const includedAnnotations = await addTextFileIfPresent(app, zip, location.annotationsPath, "data/annotations.json");
		if (includedAnnotations) {
			await addTextFileIfPresent(app, zip, location.annotationsMarkdownPath, "data/annotations.md");
		}
		const includedSemantic = await addTextFileIfPresent(app, zip, location.semanticProfilePath, "data/semantic-profile.json");
		actualModules.annotationSystem = includedAnnotations || includedSemantic;
	}
	if (options.modules.ink) {
		actualModules.ink = await addTextFileIfPresent(app, zip, location.inkPath, "data/ink.json");
	}
	if (options.modules.navigationState) {
		const includedBookmarks = await addTextFileIfPresent(app, zip, location.bookmarksPath, "data/bookmarks.json");
		const includedReadingState = await addTextFileIfPresent(app, zip, location.readingStatePath, "data/reading-state.json");
		actualModules.navigationState = includedBookmarks || includedReadingState;
	}

	assertReadingPackageHasActualContent(actualModules);
	writeReadingPackageManifest(zip, createManifest({
		bookFormat: "pdf",
		bookId: location.bookId,
		bookPath,
		displayName: options.displayName,
		bookFileFallback: "document.pdf",
		modules: actualModules,
	}));

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
	targetBookPath?: string;
	matchedExistingBook?: ExistingPortableBookMatch | null;
}): Promise<{ bookPath: string; importedBook: boolean; importMode: ReadingPackageImportMode }> {
	const targetBookPath = normalizeOptionalVaultPath(
		options.targetBookPath || options.importOptions.targetBookPath,
	);
	if (targetBookPath) {
		return { bookPath: targetBookPath, importedBook: false, importMode: "specifiedTarget" };
	}

	const matchedBookPath = normalizeOptionalVaultPath(options.matchedExistingBook?.filePath);
	if (matchedBookPath) {
		return { bookPath: matchedBookPath, importedBook: false, importMode: "fingerprintMatch" };
	}

	const bookEntry = getPackageBookEntry(options.zip);
	if (bookEntry) {
		const bookPath = await generateUniqueVaultFilePath(
			options.app,
			options.importOptions.defaultBookFolder || "/",
			getPackageBookImportFileName(bookEntry.name, options.manifest, options.fallbackName),
		);
		await writeVaultBinary(options.app, bookPath, await bookEntry.async("arraybuffer"));
		return { bookPath, importedBook: true, importMode: "embeddedBook" };
	}

	const manifestBookPath = normalizeOptionalVaultPath(options.manifest.bookPath);
	if (manifestBookPath && await vaultPathExists(options.app, manifestBookPath)) {
		return { bookPath: manifestBookPath, importedBook: false, importMode: "existingBookPath" };
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
	const packageBookJson = parseJsonText(await zip.file("data/book.json")?.async("string") || null);
	const packageFingerprints = mergeEpubFingerprints(
		readEpubFingerprintsFromRecord(manifest),
		readEpubFingerprintsFromRecord(packageBookJson),
	);
	const bookEntry = getPackageBookEntry(zip);
	const preferredBookId = normalizeVaultPath(options.preferredBookId || "");
	const preferredTargetPath = normalizeOptionalVaultPath(options.targetBookPath);
	const preferredTargetFingerprints =
		preferredBookId && preferredTargetPath
			? await computeEpubVaultBookFingerprints(app, preferredTargetPath)
			: {};
	const preferredTargetMatchesPackage = hasMatchingEpubFingerprint(
		packageFingerprints,
		preferredTargetFingerprints,
	);
	const canUsePreferredTarget = Boolean(
		preferredBookId &&
			preferredTargetPath &&
			(hasAnyEpubFingerprint(packageFingerprints)
				? preferredTargetMatchesPackage
				: !bookEntry),
	);
	const existingMatch = await findExistingEpubBookMatchByFingerprints(
		app,
		packageFingerprints,
		canUsePreferredTarget ? preferredBookId : undefined,
	);
	const fallbackToPreferredBook = Boolean(canUsePreferredTarget && !existingMatch && !bookEntry);
	const bookId = normalizeVaultPath(
		existingMatch?.bookId ||
			(fallbackToPreferredBook ? preferredBookId : "") ||
			manifest.bookId,
	);
	const importTarget = await resolveImportBookPath({
		app,
		zip,
		manifest,
		importOptions: options,
		fallbackName: "book.epub",
		targetBookPath:
			canUsePreferredTarget && bookId === preferredBookId
				? preferredTargetPath
				: undefined,
		matchedExistingBook: existingMatch,
	});
	const bookPath = importTarget.bookPath;
	const location = resolveEpubPortableBookDataLocation(bookId);
	const importedModules: string[] = importTarget.importedBook ? ["book"] : [];
	const backupPaths: string[] = [];
	const matchedExistingBook = Boolean(existingMatch?.bookId || fallbackToPreferredBook);
	const annotationDataEntries = manifest.modules.annotationSystem
		? (await readPackageDataEntries(zip)).filter((entry) =>
				isEpubAnnotationPackageEntry(entry.relativePath),
			)
		: [];
	const existingActiveAnnotations = matchedExistingBook
		? await readActiveEpubAnnotationVersionAnnotations(app, location.bookId)
		: null;
	const importAnnotationSystemAsSeparateVersions =
		matchedExistingBook &&
		countPortableAnnotations(existingActiveAnnotations) > 0 &&
		annotationDataEntries.length > 0;

	if (manifest.modules.annotationSystem) {
		if (importAnnotationSystemAsSeparateVersions) {
			await importEpubAnnotationSystemAsSeparateVersions({
				app,
				entries: annotationDataEntries,
				bookDir: location.bookDir,
				bookId: location.bookId,
				bookPath,
				importedModules,
				backupPaths,
			});
		} else {
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
		bookTitle: manifest.title,
		sourceBookPath: normalizeOptionalVaultPath(manifest.bookPath) || undefined,
		importMode: importTarget.importMode,
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
		const importedAnnotations = await importJsonFromZip({
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
		if (importedAnnotations !== null) {
			await regeneratePdfAnnotationsMarkdown({
				app,
				location,
				bookPath,
				title: manifest.title,
				backupPaths,
			});
		}
	}

	if (manifest.modules.ink) {
		await importPdfInkFromZip({
			app,
			zip,
			zipPath: "data/ink.json",
			targetPath: location.inkPath,
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

	return {
		bookFormat: "pdf",
		bookId: location.bookId,
		bookPath,
		bookTitle: manifest.title,
		sourceBookPath: normalizeOptionalVaultPath(manifest.bookPath) || undefined,
		importMode: importTarget.importMode,
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
