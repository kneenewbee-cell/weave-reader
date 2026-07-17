import type { App, DataAdapter } from "obsidian";
import { normalizePath } from "obsidian";
import JSZip from "jszip";
import { DirectoryUtils } from "../../utils/directory-utils";
import { generateUniqueVaultFilePath } from "./epub-markdown-path-resolver";
import {
	getEpubPortableDataRoot,
	readEpubSemanticJson,
	safeEpubSemanticBookId,
	writeEpubSemanticJson,
} from "./semantic/semantic-store";
import {
	ensureActiveEpubAnnotationVersion,
	readActiveEpubAnnotationVersionAnnotations,
	safeEpubAnnotationVersionId,
	switchEpubAnnotationVersion,
} from "./epub-annotation-version-store";

export const EPUB_ANNOTATED_BOOK_PACKAGE_FORMAT =
	"weave-reader-annotated-book-package/v1";

export interface CreateEpubAnnotatedBookPackageOptions {
	bookId: string;
	filePath: string;
	displayName?: string;
}

export interface EpubAnnotatedBookPackageResult {
	arrayBuffer: ArrayBuffer;
	fileName: string;
	bookId: string;
	bookPath: string;
}

export interface ImportEpubAnnotatedBookPackageOptions {
	defaultBookFolder?: string;
	targetBookPath?: string;
	preferredBookId?: string;
	activateImportedAnnotations?: boolean;
}

export interface ImportEpubAnnotatedBookPackageResult {
	bookId: string;
	bookPath: string;
	importedDataDir: string;
	matchedExistingBook: boolean;
	importedAnnotationVersionCount: number;
	importedAnnotationCount: number;
	importedVersionIds: string[];
	activeVersionId: string;
	activatedImportedVersion: boolean;
}

interface EpubAnnotatedBookPackageManifest {
	format: typeof EPUB_ANNOTATED_BOOK_PACKAGE_FORMAT;
	version: 1;
	bookId: string;
	bookFileName: string;
	bookPath?: string;
	exportedAt: number;
	sourceFingerprint?: string;
	title?: string;
}

interface ExistingPortableBookMatch {
	bookId: string;
	filePath?: string;
}

interface PackageDataEntry {
	relativePath: string;
	text: string;
	parsed: unknown | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanString(value: unknown): string {
	return String(value || "").trim();
}

function sanitizeFileName(value: unknown, fallback: string): string {
	const raw = cleanString(value) || fallback;
	return raw
		.replace(/[\\/:*?"<>|\r\n\t]+/g, "-")
		.replace(/\s+/g, " ")
		.replace(/^-+|-+$/g, "")
		.slice(0, 120) || fallback;
}

function getFileNameFromPath(filePath: string): string {
	return normalizePath(filePath).split("/").pop() || "book.epub";
}

function getBookDir(bookId: string): string {
	return normalizePath(`${getEpubPortableDataRoot()}/books/${safeEpubSemanticBookId(bookId)}`);
}

function getBookDataPath(bookId: string, relativePath: string): string {
	return normalizePath(`${getBookDir(bookId)}/${relativePath}`);
}

function getAdapter(app: App): (DataAdapter & {
	list?: (path: string) => Promise<{ files?: string[]; folders?: string[] }>;
	readBinary?: (path: string) => Promise<ArrayBuffer | Uint8Array>;
	writeBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
}) | null {
	return ((app as { vault?: { adapter?: DataAdapter } })?.vault?.adapter || null) as
		| (DataAdapter & {
				list?: (path: string) => Promise<{ files?: string[]; folders?: string[] }>;
				readBinary?: (path: string) => Promise<ArrayBuffer | Uint8Array>;
				writeBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
		  })
		| null;
}

async function readVaultText(app: App, filePath: string): Promise<string | null> {
	const adapter = getAdapter(app);
	if (!adapter || typeof adapter.exists !== "function" || typeof adapter.read !== "function") {
		return null;
	}
	const normalizedPath = normalizePath(filePath);
	if (!(await adapter.exists(normalizedPath))) {
		return null;
	}
	return await adapter.read(normalizedPath);
}

async function readVaultBinary(app: App, filePath: string): Promise<ArrayBuffer | Uint8Array | null> {
	const adapter = getAdapter(app);
	if (!adapter || typeof adapter.exists !== "function" || typeof adapter.readBinary !== "function") {
		return null;
	}
	const normalizedPath = normalizePath(filePath);
	if (!(await adapter.exists(normalizedPath))) {
		return null;
	}
	return await adapter.readBinary(normalizedPath);
}

async function writeVaultBinary(app: App, filePath: string, binary: ArrayBuffer): Promise<void> {
	const adapter = getAdapter(app);
	if (!adapter || typeof adapter.writeBinary !== "function") {
		throw new Error("vault-binary-write-unavailable");
	}
	const normalizedPath = normalizePath(filePath);
	await DirectoryUtils.ensureDirForFile(adapter, normalizedPath);
	await adapter.writeBinary(normalizedPath, binary);
}

async function writeVaultText(app: App, filePath: string, text: string): Promise<void> {
	const adapter = getAdapter(app);
	if (!adapter || typeof adapter.write !== "function") {
		throw new Error("vault-text-write-unavailable");
	}
	const normalizedPath = normalizePath(filePath);
	await DirectoryUtils.ensureDirForFile(adapter, normalizedPath);
	await adapter.write(normalizedPath, text);
}

async function collectVaultFilesRecursively(app: App, rootDir: string): Promise<string[]> {
	const adapter = getAdapter(app);
	if (!adapter || typeof adapter.exists !== "function" || typeof adapter.list !== "function") {
		return [];
	}
	const normalizedRoot = normalizePath(rootDir);
	if (!(await adapter.exists(normalizedRoot))) {
		return [];
	}
	const result: string[] = [];
	const visit = async (dir: string) => {
		const listed = await adapter.list?.(dir);
		for (const filePath of listed?.files || []) {
			result.push(normalizePath(filePath));
		}
		for (const folderPath of listed?.folders || []) {
			await visit(normalizePath(folderPath));
		}
	};
	await visit(normalizedRoot);
	return result.sort();
}

function relativize(rootDir: string, filePath: string): string {
	const root = normalizePath(rootDir);
	const file = normalizePath(filePath);
	return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
}

function parseJsonText(value: string | null): unknown | null {
	if (!value) {
		return null;
	}
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function normalizeManifest(value: unknown): EpubAnnotatedBookPackageManifest | null {
	if (!isRecord(value) || value.format !== EPUB_ANNOTATED_BOOK_PACKAGE_FORMAT) {
		return null;
	}
	const bookId = safeEpubSemanticBookId(value.bookId);
	const bookFileName = sanitizeFileName(value.bookFileName, "book.epub");
	return {
		format: EPUB_ANNOTATED_BOOK_PACKAGE_FORMAT,
		version: 1,
		bookId,
		bookFileName,
		bookPath: cleanString(value.bookPath) || undefined,
		exportedAt:
			typeof value.exportedAt === "number" && Number.isFinite(value.exportedAt)
				? value.exportedAt
				: Date.now(),
		sourceFingerprint: cleanString(value.sourceFingerprint) || undefined,
		title: cleanString(value.title) || undefined,
	};
}

async function findExistingBookMatchByFingerprint(
	app: App,
	sourceFingerprint: string
): Promise<ExistingPortableBookMatch | null> {
	const normalizedFingerprint = cleanString(sourceFingerprint).toLowerCase();
	if (!normalizedFingerprint) {
		return null;
	}
	const index = await readEpubSemanticJson(app, `${getEpubPortableDataRoot()}/index.json`);
	if (!isRecord(index) || !isRecord(index.books)) {
		return null;
	}
	for (const [fallbackBookId, rawBook] of Object.entries(index.books)) {
		if (!isRecord(rawBook)) {
			continue;
		}
		if (cleanString(rawBook.sourceFingerprint).toLowerCase() === normalizedFingerprint) {
			return {
				bookId: safeEpubSemanticBookId(rawBook.bookId || fallbackBookId),
				filePath: cleanString(rawBook.filePath) || undefined,
			};
		}
	}
	return null;
}

function retargetPortableJson(value: unknown, bookId: string, bookPath: string): unknown {
	if (!isRecord(value)) {
		return value;
	}
	const next: Record<string, unknown> = { ...value };
	if (Object.prototype.hasOwnProperty.call(next, "bookId")) {
		next.bookId = bookId;
	}
	if (next.format === "weave-reader-book/v1") {
		const knownPaths = Array.isArray(next.knownPaths) ? next.knownPaths : [];
		next.filePath = bookPath;
		next.knownPaths = Array.from(new Set([...knownPaths, bookPath].map(cleanString).filter(Boolean)));
		next.updatedAt = Date.now();
	}
	if (next.format === "weave-reader-epub-data-index/v1" && isRecord(next.books)) {
		next.books = {
			[bookId]: {
				...(isRecord(next.books[bookId]) ? next.books[bookId] : {}),
				bookId,
				filePath: bookPath,
				knownPaths: [bookPath],
			},
		};
	}
	return next;
}

function getVersionIdFromRelativePath(relativePath: string): string {
	const match = normalizePath(relativePath).match(/^versions\/([^/]+)\//);
	return match ? safeEpubAnnotationVersionId(match[1]) : "";
}

function replaceVersionIdInRelativePath(relativePath: string, nextVersionId: string): string {
	const normalizedPath = normalizePath(relativePath);
	return normalizedPath.replace(/^versions\/([^/]+)\//, `versions/${nextVersionId}/`);
}

function countAnnotations(value: unknown): number {
	return isRecord(value) && Array.isArray(value.annotations) ? value.annotations.length : 0;
}

function isDerivedPortableDataEntry(relativePath: string): boolean {
	const normalizedPath = normalizePath(relativePath);
	return normalizedPath === "annotations.md";
}

async function getUniqueImportedVersionId(
	app: App,
	bookId: string,
	originalVersionId: string
): Promise<string> {
	const adapter = getAdapter(app);
	const baseId = safeEpubAnnotationVersionId(`imported-${originalVersionId || "default"}`);
	if (!adapter || typeof adapter.exists !== "function") {
		return baseId;
	}
	for (let index = 1; index <= 500; index += 1) {
		const candidate = index === 1 ? baseId : `${baseId}-${index}`;
		if (!(await adapter.exists(getBookDataPath(bookId, `versions/${candidate}`)))) {
			return candidate;
		}
	}
	return `${baseId}-${Date.now().toString(36)}`;
}

function retargetVersionJson(
	value: unknown,
	bookId: string,
	versionId: string,
	importAsSeparateVersion: boolean
): unknown {
	if (!isRecord(value)) {
		return value;
	}
	const next: Record<string, unknown> = { ...value, bookId, versionId };
	if (importAsSeparateVersion) {
		const name = cleanString(next.name) || versionId;
		next.name = name.includes("导入") ? name : `${name}（导入）`;
		next.source = cleanString(next.source) || "imported-package";
		next.updatedAt = Date.now();
	}
	return next;
}

function retargetActiveVersionJson(value: unknown, bookId: string, versionMap: Map<string, string>): unknown {
	if (!isRecord(value)) {
		return value;
	}
	const activeVersionId = safeEpubAnnotationVersionId(value.activeVersionId || "default");
	return {
		...value,
		bookId,
		activeVersionId: versionMap.get(activeVersionId) || activeVersionId,
		updatedAt: Date.now(),
	};
}

async function updatePortableIndexForImportedBook(
	app: App,
	bookId: string,
	bookPath: string,
	bookJson: unknown
): Promise<void> {
	const indexPath = `${getEpubPortableDataRoot()}/index.json`;
	const current = await readEpubSemanticJson(app, indexPath);
	const currentIndex = isRecord(current) ? current : {};
	const currentBooks = isRecord(currentIndex.books) ? currentIndex.books : {};
	const book = isRecord(bookJson) ? bookJson : {};
	const previous = isRecord(currentBooks[bookId]) ? currentBooks[bookId] : {};
	const knownPaths = Array.from(
		new Set([
			...(Array.isArray(previous.knownPaths) ? previous.knownPaths : []),
			previous.filePath,
			bookPath,
		].map(cleanString).filter(Boolean))
	);
	await writeEpubSemanticJson(app, indexPath, {
		...currentIndex,
		format: "weave-reader-epub-data-index/v1",
		version: 1,
		updatedAt: Date.now(),
		books: {
			...currentBooks,
			[bookId]: {
				...previous,
				bookId,
				filePath: bookPath,
				knownPaths,
				sourceFingerprint: cleanString(book.sourceFingerprint || previous.sourceFingerprint) || undefined,
				sourceId: cleanString(book.sourceId || previous.sourceId) || undefined,
				title: cleanString(book.title || previous.title) || undefined,
				displayTitle: cleanString(book.displayTitle || previous.displayTitle) || undefined,
				updatedAt: Date.now(),
			},
		},
	});
}

export async function createEpubAnnotatedBookPackage(
	app: App,
	options: CreateEpubAnnotatedBookPackageOptions
): Promise<EpubAnnotatedBookPackageResult> {
	const bookId = safeEpubSemanticBookId(options.bookId);
	const bookPath = normalizePath(options.filePath);
	const bookDir = getBookDir(bookId);
	await ensureActiveEpubAnnotationVersion(app, bookId);

	const bookJson = await readEpubSemanticJson(app, getBookDataPath(bookId, "book.json"));
	const bookFileName = sanitizeFileName(getFileNameFromPath(bookPath), "book.epub");
	const title = isRecord(bookJson) ? cleanString(bookJson.title || bookJson.displayTitle) : "";
	const sourceFingerprint = isRecord(bookJson) ? cleanString(bookJson.sourceFingerprint) : "";
	const zip = new JSZip();
	const manifest: EpubAnnotatedBookPackageManifest = {
		format: EPUB_ANNOTATED_BOOK_PACKAGE_FORMAT,
		version: 1,
		bookId,
		bookFileName,
		bookPath,
		exportedAt: Date.now(),
		...(sourceFingerprint ? { sourceFingerprint } : {}),
		...(title ? { title } : {}),
	};
	zip.file("manifest.json", JSON.stringify(manifest, null, 2));

	const bookBinary = await readVaultBinary(app, bookPath);
	if (bookBinary) {
		zip.file(
			`book/${bookFileName}`,
			bookBinary instanceof Uint8Array ? bookBinary : new Uint8Array(bookBinary)
		);
	}

	for (const filePath of await collectVaultFilesRecursively(app, bookDir)) {
		const relativePath = relativize(bookDir, filePath);
		const content = await readVaultText(app, filePath);
		if (content !== null) {
			zip.file(`data/${relativePath}`, content);
		}
	}

	const fileNameBase = sanitizeFileName(options.displayName || title || bookFileName.replace(/\.[^.]+$/, ""), "book");
	const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
	return {
		arrayBuffer,
		fileName: `${fileNameBase}-weave-reader.zip`,
		bookId,
		bookPath,
	};
}

export async function importEpubAnnotatedBookPackage(
	app: App,
	arrayBuffer: ArrayBuffer,
	options: ImportEpubAnnotatedBookPackageOptions = {}
): Promise<ImportEpubAnnotatedBookPackageResult> {
	const zip = await JSZip.loadAsync(arrayBuffer);
	const manifest = normalizeManifest(parseJsonText(await zip.file("manifest.json")?.async("string") || null));
	if (!manifest) {
		throw new Error("invalid-weave-reader-package");
	}
	const packageBookJson = parseJsonText(await zip.file("data/book.json")?.async("string") || null);
	const fingerprintFromBook = isRecord(packageBookJson) ? cleanString(packageBookJson.sourceFingerprint) : "";
	const existingMatch = await findExistingBookMatchByFingerprint(
		app,
		manifest.sourceFingerprint || fingerprintFromBook
	);
	const targetBookId = safeEpubSemanticBookId(
		options.preferredBookId ||
			existingMatch?.bookId ||
			manifest.bookId
	);
	const matchedExistingBook = Boolean(existingMatch?.bookId && existingMatch.bookId === targetBookId);
	const bookEntry = Object.values(zip.files).find(
		(entry) => !entry.dir && normalizePath(entry.name).startsWith("book/")
	);
	const bookFileName = sanitizeFileName(
		bookEntry ? normalizePath(bookEntry.name).split("/").pop() : manifest.bookFileName,
		manifest.bookFileName || "book.epub"
	);
	const bookPath =
		options.targetBookPath ||
		(matchedExistingBook && existingMatch?.filePath ? normalizePath(existingMatch.filePath) : "") ||
		(await generateUniqueVaultFilePath(app, options.defaultBookFolder || "Books", bookFileName));

	const adapter = getAdapter(app);
	const shouldWriteBookBinary =
		Boolean(bookEntry) &&
		(!matchedExistingBook ||
			!adapter ||
			typeof adapter.exists !== "function" ||
			!(await adapter.exists(bookPath)));
	if (bookEntry && shouldWriteBookBinary) {
		await writeVaultBinary(app, bookPath, await bookEntry.async("arraybuffer"));
	}

	const bookDir = getBookDir(targetBookId);
	const existingActiveAnnotations = matchedExistingBook
		? await readActiveEpubAnnotationVersionAnnotations(app, targetBookId)
		: null;
	const existingAnnotationCount = countAnnotations(existingActiveAnnotations);
	const importAsSeparateVersion =
		matchedExistingBook &&
		existingAnnotationCount > 0 &&
		options.activateImportedAnnotations !== true;
	const dataEntries: PackageDataEntry[] = [];
	for (const entry of Object.values(zip.files)) {
		const normalizedEntryName = normalizePath(entry.name);
		if (entry.dir || !normalizedEntryName.startsWith("data/")) {
			continue;
		}
		const relativePath = normalizedEntryName.slice("data/".length);
		const text = await entry.async("string");
		dataEntries.push({
			relativePath,
			text,
			parsed: parseJsonText(text),
		});
	}
	const packageVersionIds = Array.from(
		new Set(dataEntries.map((entry) => getVersionIdFromRelativePath(entry.relativePath)).filter(Boolean))
	);
	const versionMap = new Map<string, string>();
	for (const versionId of packageVersionIds.length ? packageVersionIds : ["default"]) {
		versionMap.set(
			versionId,
			importAsSeparateVersion
				? await getUniqueImportedVersionId(app, targetBookId, versionId)
				: safeEpubAnnotationVersionId(versionId)
		);
	}
	const importedVersionIds = Array.from(new Set(Array.from(versionMap.values())));
	let importedAnnotationCount = 0;
	for (const entry of dataEntries) {
		if (/^versions\/[^/]+\/annotations\.json$/.test(normalizePath(entry.relativePath))) {
			importedAnnotationCount += countAnnotations(entry.parsed);
		}
	}
	const packageActivePayload = parseJsonText(await zip.file("data/active-version.json")?.async("string") || null);
	const packageActiveVersion = safeEpubAnnotationVersionId(
		isRecord(packageActivePayload)
			? packageActivePayload.activeVersionId
			: "default"
	);
	const mappedActiveVersionId =
		versionMap.get(packageActiveVersion) ||
		importedVersionIds[0] ||
		"";
	let importedBookJson: unknown = null;
	for (const entry of dataEntries) {
		const normalizedRelativePath = normalizePath(entry.relativePath);
		if (isDerivedPortableDataEntry(normalizedRelativePath)) {
			continue;
		}
		if (importAsSeparateVersion && (normalizedRelativePath === "active-version.json" || normalizedRelativePath === "annotations.json")) {
			continue;
		}
		const sourceVersionId = getVersionIdFromRelativePath(normalizedRelativePath);
		const mappedVersionId = sourceVersionId ? versionMap.get(sourceVersionId) || sourceVersionId : "";
		const relativePath = mappedVersionId
			? replaceVersionIdInRelativePath(normalizedRelativePath, mappedVersionId)
			: normalizedRelativePath;
		let retargeted = entry.parsed ? retargetPortableJson(entry.parsed, targetBookId, bookPath) : null;
		if (retargeted && normalizedRelativePath === "active-version.json") {
			retargeted = retargetActiveVersionJson(retargeted, targetBookId, versionMap);
		}
		if (retargeted && /^versions\/[^/]+\/version\.json$/.test(normalizedRelativePath)) {
			retargeted = retargetVersionJson(
				retargeted,
				targetBookId,
				mappedVersionId || sourceVersionId || "default",
				importAsSeparateVersion
			);
		}
		const nextContent = retargeted ? JSON.stringify(retargeted, null, 2) : entry.text;
		if (relativePath === "book.json") {
			importedBookJson = retargeted;
		}
		if (retargeted) {
			await writeEpubSemanticJson(app, normalizePath(`${bookDir}/${relativePath}`), retargeted);
		} else {
			await writeVaultText(app, normalizePath(`${bookDir}/${relativePath}`), nextContent);
		}
	}

	if (!importedBookJson) {
		importedBookJson = {
			format: "weave-reader-book/v1",
			version: 1,
			bookId: targetBookId,
			filePath: bookPath,
			knownPaths: [bookPath],
			title: manifest.title || bookFileName.replace(/\.[^.]+$/, ""),
			sourceFingerprint: manifest.sourceFingerprint,
			updatedAt: Date.now(),
		};
		await writeEpubSemanticJson(app, getBookDataPath(targetBookId, "book.json"), importedBookJson);
	}

	await updatePortableIndexForImportedBook(app, targetBookId, bookPath, importedBookJson);
	if (options.activateImportedAnnotations === true && mappedActiveVersionId) {
		await switchEpubAnnotationVersion(app, targetBookId, mappedActiveVersionId);
	} else {
		await ensureActiveEpubAnnotationVersion(app, targetBookId);
	}
	const active = await ensureActiveEpubAnnotationVersion(app, targetBookId);
	return {
		bookId: targetBookId,
		bookPath,
		importedDataDir: bookDir,
		matchedExistingBook,
		importedAnnotationVersionCount: importedVersionIds.length,
		importedAnnotationCount,
		importedVersionIds,
		activeVersionId: active.activeVersionId,
		activatedImportedVersion:
			options.activateImportedAnnotations === true &&
			Boolean(mappedActiveVersionId) &&
			active.activeVersionId === mappedActiveVersionId,
	};
}

export function downloadEpubAnnotatedBookPackage(result: EpubAnnotatedBookPackageResult): void {
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
