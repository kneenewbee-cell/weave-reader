import type { App, DataAdapter } from "obsidian";
import { normalizePath } from "obsidian";
import JSZip from "jszip";
import { DirectoryUtils } from "../../utils/directory-utils";
import { generateUniqueVaultFilePath } from "./epub-markdown-path-resolver";
import {
	getEpubPortableDataRoot,
	materializeEpubSemanticProfileForVersion,
	readEpubSemanticJson,
	safeEpubSemanticBookId,
	writeEpubSemanticJson,
} from "./semantic/semantic-store";
import {
	ensureActiveEpubAnnotationVersion,
	listEpubAnnotationVersions,
	readActiveEpubAnnotationVersionAnnotations,
	safeEpubAnnotationVersionId,
	switchEpubAnnotationVersion,
} from "./epub-annotation-version-store";
import {
	computeAvailableEpubFingerprints,
	type PartialEpubFingerprints,
} from "./epub-fingerprints";
import { getBookExtensionFromPath, isSupportedBookPath } from "./book-format";
import {
	appendEpubImportDiagnostic,
	summarizeEpubImportResult,
} from "./epub-import-diagnostics";

export const EPUB_ANNOTATED_BOOK_PACKAGE_FORMAT =
	"weave-reader-annotated-book-package/v1";
const SEMANTIC_PROFILE_FORMAT = "weave-reader-semantic-profile/v1";

export interface CreateEpubAnnotatedBookPackageOptions {
	bookId: string;
	filePath: string;
	displayName?: string;
	includeBook?: boolean;
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
	requireBook?: boolean;
	activateImportedAnnotations?: boolean;
}

export interface ImportEpubAnnotatedBookPackageResult {
	bookId: string;
	bookPath: string;
	importedDataDir: string;
	matchedExistingBook: boolean;
	matchKind: EpubAnnotatedBookPackageMatchKind;
	usedPreferredTarget: boolean;
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
	fileFingerprint?: string;
	packageFingerprint?: string;
	contentFingerprint?: string;
	title?: string;
}

type EpubFingerprintMatchKind =
	| "fileFingerprint"
	| "packageFingerprint"
	| "contentFingerprint";

export type EpubAnnotatedBookPackageMatchKind =
	| EpubFingerprintMatchKind
	| "preferred-fallback"
	| "new-book";

interface ExistingPortableBookMatch {
	bookId: string;
	filePath?: string;
	fingerprints: PartialEpubFingerprints;
	matchKind: EpubAnnotatedBookPackageMatchKind;
}

interface PortableBookCandidate {
	bookId: string;
	filePath?: string;
	fingerprints: PartialEpubFingerprints;
}

const FINGERPRINT_MATCH_ORDER: EpubFingerprintMatchKind[] = [
	"fileFingerprint",
	"packageFingerprint",
	"contentFingerprint",
];

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

function cleanFingerprint(value: unknown): string {
	return cleanString(value).toLowerCase();
}

function readFingerprintsFromRecord(value: unknown): PartialEpubFingerprints {
	if (!isRecord(value)) {
		return {};
	}
	const fileFingerprint =
		cleanFingerprint(value.fileFingerprint) ||
		cleanFingerprint(value.sourceFingerprint);
	const packageFingerprint = cleanFingerprint(value.packageFingerprint);
	const contentFingerprint = cleanFingerprint(value.contentFingerprint);
	return {
		...(fileFingerprint ? { fileFingerprint } : {}),
		...(packageFingerprint ? { packageFingerprint } : {}),
		...(contentFingerprint ? { contentFingerprint } : {}),
	};
}

function mergeFingerprints(
	...fingerprintSets: PartialEpubFingerprints[]
): PartialEpubFingerprints {
	const merged: PartialEpubFingerprints = {};
	for (const fingerprints of fingerprintSets) {
		if (!merged.fileFingerprint && fingerprints.fileFingerprint) {
			merged.fileFingerprint = cleanFingerprint(fingerprints.fileFingerprint);
		}
		if (!merged.packageFingerprint && fingerprints.packageFingerprint) {
			merged.packageFingerprint = cleanFingerprint(fingerprints.packageFingerprint);
		}
		if (!merged.contentFingerprint && fingerprints.contentFingerprint) {
			merged.contentFingerprint = cleanFingerprint(fingerprints.contentFingerprint);
		}
	}
	return merged;
}

function hasAnyFingerprint(fingerprints: PartialEpubFingerprints): boolean {
	return Boolean(
		fingerprints.fileFingerprint ||
			fingerprints.packageFingerprint ||
			fingerprints.contentFingerprint
	);
}

function getFingerprintValue(
	fingerprints: PartialEpubFingerprints,
	matchKind: EpubFingerprintMatchKind
): string {
	return cleanFingerprint(fingerprints[matchKind]);
}

function hasMatchingFingerprint(
	left: PartialEpubFingerprints,
	right: PartialEpubFingerprints
): boolean {
	for (const matchKind of FINGERPRINT_MATCH_ORDER) {
		const leftValue = getFingerprintValue(left, matchKind);
		const rightValue = getFingerprintValue(right, matchKind);
		if (leftValue && rightValue && leftValue === rightValue) {
			return true;
		}
	}
	return false;
}

function applyFingerprintsToRecord(
	value: unknown,
	fingerprints: PartialEpubFingerprints
): unknown {
	if (!isRecord(value)) {
		return value;
	}
	const next: Record<string, unknown> = { ...value };
	if (fingerprints.fileFingerprint) {
		next.sourceFingerprint = fingerprints.fileFingerprint;
		next.fileFingerprint = fingerprints.fileFingerprint;
	}
	if (fingerprints.packageFingerprint) {
		next.packageFingerprint = fingerprints.packageFingerprint;
	}
	if (fingerprints.contentFingerprint) {
		next.contentFingerprint = fingerprints.contentFingerprint;
	}
	return next;
}

function sanitizeFileName(value: unknown, fallback: string): string {
	const raw = cleanString(value) || fallback;
	const sanitized = raw
		.replace(/[\\/:*?"<>|\r\n\t]+/g, "-")
		.replace(/\s+/g, " ")
		.replace(/^-+|-+$/g, "") || fallback;
	if (sanitized.length <= 120) {
		return sanitized;
	}
	const extension = getFileNameExtensionToPreserve(sanitized);
	if (!extension) {
		return sanitized.slice(0, 120) || fallback;
	}
	const maxBaseLength = Math.max(1, 120 - extension.length);
	const baseName =
		sanitized
			.slice(0, -extension.length)
			.slice(0, maxBaseLength)
			.replace(/[-.\s]+$/g, "") || "book";
	return `${baseName}${extension}`;
}

function getFileNameExtensionToPreserve(fileName: string): string {
	const normalized = String(fileName || "").trim();
	if (/\.fb2\.zip$/i.test(normalized)) {
		return normalized.slice(-".fb2.zip".length);
	}
	const match = normalized.match(/\.[A-Za-z0-9]{1,12}$/);
	return match?.[0] || "";
}

function getSupportedBookExtensionSuffixFromPath(filePath: unknown): string {
	const normalized = cleanString(filePath);
	if (!isSupportedBookPath(normalized)) {
		return "";
	}
	if (/\.fb2\.zip$/i.test(normalized)) {
		return ".fb2.zip";
	}
	const extension = getBookExtensionFromPath(normalized);
	return extension ? `.${extension}` : "";
}

function ensureBookFileNameExtension(fileName: string, ...extensionHints: unknown[]): string {
	const normalized = cleanString(fileName);
	if (!normalized || isSupportedBookPath(normalized)) {
		return normalized;
	}
	const extension = extensionHints
		.map((hint) => getSupportedBookExtensionSuffixFromPath(hint))
		.find(Boolean);
	return extension ? `${normalized}${extension}` : normalized;
}

function getReusableExistingBookPath(
	existingMatch: ExistingPortableBookMatch | null,
	hasEmbeddedBook: boolean
): string {
	const existingPath = existingMatch?.filePath ? normalizePath(existingMatch.filePath) : "";
	if (!existingPath) {
		return "";
	}
	if (!hasEmbeddedBook || isSupportedBookPath(existingPath)) {
		return existingPath;
	}
	return "";
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

async function computeVaultBookFingerprints(
	app: App,
	filePath: string
): Promise<PartialEpubFingerprints> {
	const binary = await readVaultBinary(app, filePath);
	if (!binary) {
		return {};
	}
	try {
		return await computeAvailableEpubFingerprints(binary);
	} catch {
		return {};
	}
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
	const fingerprints = readFingerprintsFromRecord(value);
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
		sourceFingerprint:
			fingerprints.fileFingerprint ||
			cleanFingerprint(value.sourceFingerprint) ||
			undefined,
		fileFingerprint: fingerprints.fileFingerprint,
		packageFingerprint: fingerprints.packageFingerprint,
		contentFingerprint: fingerprints.contentFingerprint,
		title: cleanString(value.title) || undefined,
	};
}

async function loadPortableBookCandidates(app: App): Promise<PortableBookCandidate[]> {
	const index = await readEpubSemanticJson(app, `${getEpubPortableDataRoot()}/index.json`);
	if (!isRecord(index) || !isRecord(index.books)) {
		return [];
	}
	const candidates: PortableBookCandidate[] = [];
	for (const [fallbackBookId, rawBook] of Object.entries(index.books)) {
		if (!isRecord(rawBook)) {
			continue;
		}
		const bookId = safeEpubSemanticBookId(rawBook.bookId || fallbackBookId);
		if (!bookId) {
			continue;
		}
		candidates.push({
			bookId,
			filePath: cleanString(rawBook.filePath) || undefined,
			fingerprints: readFingerprintsFromRecord(rawBook),
		});
	}
	return candidates;
}

function candidateMatchesFingerprint(
	candidate: PortableBookCandidate,
	packageFingerprints: PartialEpubFingerprints,
	matchKind: EpubFingerprintMatchKind
): boolean {
	const packageFingerprint = getFingerprintValue(packageFingerprints, matchKind);
	return Boolean(
		packageFingerprint &&
			getFingerprintValue(candidate.fingerprints, matchKind) === packageFingerprint
	);
}

function findPreferredBookMatch(
	candidates: PortableBookCandidate[],
	preferredBookId: string | undefined,
	packageFingerprints: PartialEpubFingerprints
): ExistingPortableBookMatch | null {
	const normalizedPreferredBookId = safeEpubSemanticBookId(preferredBookId || "");
	if (!normalizedPreferredBookId) {
		return null;
	}
	const candidate = candidates.find((entry) => entry.bookId === normalizedPreferredBookId);
	if (!candidate) {
		return null;
	}
	if (!hasAnyFingerprint(packageFingerprints)) {
		return {
			...candidate,
			matchKind: "preferred-fallback",
		};
	}
	for (const matchKind of FINGERPRINT_MATCH_ORDER) {
		if (candidateMatchesFingerprint(candidate, packageFingerprints, matchKind)) {
			return {
				...candidate,
				matchKind,
			};
		}
	}
	return null;
}

function findGlobalBookMatch(
	candidates: PortableBookCandidate[],
	packageFingerprints: PartialEpubFingerprints
): ExistingPortableBookMatch | null {
	for (const matchKind of FINGERPRINT_MATCH_ORDER) {
		for (const candidate of candidates) {
			if (candidateMatchesFingerprint(candidate, packageFingerprints, matchKind)) {
				return {
					...candidate,
					matchKind,
				};
			}
		}
	}
	return null;
}

async function findExistingBookMatchByFingerprints(
	app: App,
	packageFingerprints: PartialEpubFingerprints,
	preferredBookId?: string
): Promise<ExistingPortableBookMatch | null> {
	const candidates = await loadPortableBookCandidates(app);
	return (
		findPreferredBookMatch(candidates, preferredBookId, packageFingerprints) ||
		findGlobalBookMatch(candidates, packageFingerprints)
	);
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

function retargetSemanticProfileJson(
	value: unknown,
	bookId: string,
	versionId: string
): unknown {
	if (!isRecord(value)) {
		return value;
	}
	const next: Record<string, unknown> = { ...value, bookId };
	if (next.format !== SEMANTIC_PROFILE_FORMAT) {
		return next;
	}
	const safeVersionId = safeEpubAnnotationVersionId(versionId || "default");
	return {
		...next,
		scope: "version",
		versionId: safeVersionId,
		sourceVersionId: safeVersionId,
	};
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
	const fingerprints = mergeFingerprints(
		readFingerprintsFromRecord(book),
		readFingerprintsFromRecord(previous)
	);
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
				sourceFingerprint:
					fingerprints.fileFingerprint ||
					cleanFingerprint(book.sourceFingerprint || previous.sourceFingerprint) ||
					undefined,
				fileFingerprint:
					fingerprints.fileFingerprint ||
					cleanFingerprint(book.fileFingerprint || previous.fileFingerprint) ||
					undefined,
				packageFingerprint:
					fingerprints.packageFingerprint ||
					cleanFingerprint(book.packageFingerprint || previous.packageFingerprint) ||
					undefined,
				contentFingerprint:
					fingerprints.contentFingerprint ||
					cleanFingerprint(book.contentFingerprint || previous.contentFingerprint) ||
					undefined,
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
	for (const version of await listEpubAnnotationVersions(app, bookId)) {
		await materializeEpubSemanticProfileForVersion(app, bookId, version.versionId);
	}

	const bookJson = await readEpubSemanticJson(app, getBookDataPath(bookId, "book.json"));
	const bookFileName = sanitizeFileName(getFileNameFromPath(bookPath), "book.epub");
	const title = isRecord(bookJson) ? cleanString(bookJson.title || bookJson.displayTitle) : "";
	const bookBinary = await readVaultBinary(app, bookPath);
	const computedFingerprints = bookBinary
		? await computeAvailableEpubFingerprints(bookBinary)
		: {};
	const fingerprints = mergeFingerprints(
		computedFingerprints,
		readFingerprintsFromRecord(bookJson)
	);
	const sourceFingerprint = fingerprints.fileFingerprint;
	const zip = new JSZip();
	const manifest: EpubAnnotatedBookPackageManifest = {
		format: EPUB_ANNOTATED_BOOK_PACKAGE_FORMAT,
		version: 1,
		bookId,
		bookFileName,
		bookPath,
		exportedAt: Date.now(),
		...(sourceFingerprint ? { sourceFingerprint } : {}),
		...(fingerprints.fileFingerprint ? { fileFingerprint: fingerprints.fileFingerprint } : {}),
		...(fingerprints.packageFingerprint ? { packageFingerprint: fingerprints.packageFingerprint } : {}),
		...(fingerprints.contentFingerprint ? { contentFingerprint: fingerprints.contentFingerprint } : {}),
		...(title ? { title } : {}),
	};
	zip.file("manifest.json", JSON.stringify(manifest, null, 2));

	if (options.includeBook !== false && bookBinary) {
		zip.file(
			`book/${bookFileName}`,
			bookBinary instanceof Uint8Array ? bookBinary : new Uint8Array(bookBinary)
		);
	}

	for (const filePath of await collectVaultFilesRecursively(app, bookDir)) {
		const relativePath = relativize(bookDir, filePath);
		const content = await readVaultText(app, filePath);
		if (content !== null) {
			if (normalizePath(relativePath) === "book.json") {
				const parsed = parseJsonText(content);
				const withFingerprints = applyFingerprintsToRecord(parsed, fingerprints);
				zip.file(`data/${relativePath}`, JSON.stringify(withFingerprints, null, 2));
			} else {
				zip.file(`data/${relativePath}`, content);
			}
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
	await appendEpubImportDiagnostic(app, "service.import.start", {
		arrayBufferBytes: arrayBuffer.byteLength,
		options: {
			defaultBookFolder: options.defaultBookFolder,
			targetBookPath: options.targetBookPath ? normalizePath(options.targetBookPath) : options.targetBookPath,
			preferredBookId: options.preferredBookId,
			requireBook: options.requireBook,
			activateImportedAnnotations: options.activateImportedAnnotations,
		},
	});
	const zip = await JSZip.loadAsync(arrayBuffer);
	const manifest = normalizeManifest(parseJsonText(await zip.file("manifest.json")?.async("string") || null));
	if (!manifest) {
		throw new Error("invalid-weave-reader-package");
	}
	const packageBookJson = parseJsonText(await zip.file("data/book.json")?.async("string") || null);
	const packageFingerprints = mergeFingerprints(
		readFingerprintsFromRecord(manifest),
		readFingerprintsFromRecord(packageBookJson)
	);
	const bookEntry = Object.values(zip.files).find(
		(entry) => !entry.dir && normalizePath(entry.name).startsWith("book/")
	);
	if (options.requireBook === true && !bookEntry) {
		throw new Error("missing-book-in-weave-reader-package");
	}
	const preferredBookId = safeEpubSemanticBookId(options.preferredBookId || "");
	const preferredTargetFingerprints =
		preferredBookId && options.targetBookPath
			? await computeVaultBookFingerprints(app, options.targetBookPath)
			: {};
	const preferredTargetMatchesPackage = hasMatchingFingerprint(
		packageFingerprints,
		preferredTargetFingerprints
	);
	const canUsePreferredTarget =
		Boolean(preferredBookId) &&
		(hasAnyFingerprint(packageFingerprints)
			? preferredTargetMatchesPackage
			: !bookEntry && options.requireBook !== true);
	const existingMatch = await findExistingBookMatchByFingerprints(
		app,
		packageFingerprints,
		canUsePreferredTarget ? preferredBookId : undefined
	);
	const fallbackToPreferredBook = Boolean(canUsePreferredTarget && !existingMatch && !bookEntry);
	const targetBookId = safeEpubSemanticBookId(
		existingMatch?.bookId ||
			(fallbackToPreferredBook ? preferredBookId : "") ||
			manifest.bookId
	);
	const matchedExistingBook = Boolean(existingMatch?.bookId || fallbackToPreferredBook);
	const rawBookFileName = sanitizeFileName(
		bookEntry ? normalizePath(bookEntry.name).split("/").pop() : manifest.bookFileName,
		manifest.bookFileName || "book.epub"
	);
	const packageBookFilePath = isRecord(packageBookJson) ? packageBookJson.filePath : "";
	const bookFileName = ensureBookFileNameExtension(
		rawBookFileName,
		bookEntry ? normalizePath(bookEntry.name).split("/").pop() : "",
		manifest.bookPath,
		packageBookFilePath,
		manifest.bookFileName
	);
	const preferredTargetPath =
		canUsePreferredTarget && targetBookId === preferredBookId
			? normalizePath(options.targetBookPath || "")
			: "";
	const usedPreferredTarget = Boolean(preferredTargetPath);
	const reusableExistingBookPath = getReusableExistingBookPath(existingMatch, Boolean(bookEntry));
	const bookPath =
		preferredTargetPath ||
		(matchedExistingBook ? reusableExistingBookPath : "") ||
		(await generateUniqueVaultFilePath(app, options.defaultBookFolder || "/", bookFileName));
	const targetFingerprints =
		matchedExistingBook && existingMatch
			? mergeFingerprints(existingMatch.fingerprints, packageFingerprints)
			: packageFingerprints;

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
		existingAnnotationCount > 0;
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
		const rootSemanticProfileForSeparateVersion =
			importAsSeparateVersion && normalizedRelativePath === "semantic-profile.json";
		const mappedVersionId = sourceVersionId
			? versionMap.get(sourceVersionId) || sourceVersionId
			: rootSemanticProfileForSeparateVersion
				? mappedActiveVersionId
				: "";
		const relativePath = mappedVersionId
			? rootSemanticProfileForSeparateVersion
				? `versions/${mappedVersionId}/semantic-profile.json`
				: replaceVersionIdInRelativePath(normalizedRelativePath, mappedVersionId)
			: normalizedRelativePath;
		let retargeted = entry.parsed ? retargetPortableJson(entry.parsed, targetBookId, bookPath) : null;
		if (retargeted && normalizedRelativePath === "book.json") {
			retargeted = applyFingerprintsToRecord(retargeted, targetFingerprints);
		}
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
		if (
			retargeted &&
			(
				normalizedRelativePath === "semantic-profile.json" ||
				/^versions\/[^/]+\/semantic-profile\.json$/.test(normalizedRelativePath)
			)
		) {
			retargeted = retargetSemanticProfileJson(
				retargeted,
				targetBookId,
				mappedVersionId || sourceVersionId || packageActiveVersion || "default"
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
			sourceFingerprint: targetFingerprints.fileFingerprint || manifest.sourceFingerprint,
			fileFingerprint: targetFingerprints.fileFingerprint,
			packageFingerprint: targetFingerprints.packageFingerprint,
			contentFingerprint: targetFingerprints.contentFingerprint,
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
	const result = {
		bookId: targetBookId,
		bookPath,
		importedDataDir: bookDir,
		matchedExistingBook,
		matchKind: existingMatch?.matchKind || (fallbackToPreferredBook ? "preferred-fallback" : "new-book"),
		usedPreferredTarget,
		importedAnnotationVersionCount: importedVersionIds.length,
		importedAnnotationCount,
		importedVersionIds,
		activeVersionId: active.activeVersionId,
		activatedImportedVersion:
			options.activateImportedAnnotations === true &&
			Boolean(mappedActiveVersionId) &&
			active.activeVersionId === mappedActiveVersionId,
	};
	await appendEpubImportDiagnostic(app, "service.import.result", summarizeEpubImportResult(result));
	return result;
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

export function pickEpubAnnotatedBookPackageArrayBuffer(): Promise<ArrayBuffer | null> {
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
