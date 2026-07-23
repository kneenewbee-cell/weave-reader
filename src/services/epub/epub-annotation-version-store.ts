import type { App, DataAdapter } from "obsidian";
import { normalizePath } from "obsidian";
import { DirectoryUtils } from "../../utils/directory-utils";

const EPUB_ANNOTATION_VERSION_DATA_ROOT = "weave/epub-data";
const ACTIVE_VERSION_FORMAT = "weave-reader-active-annotation-version/v1";
const ANNOTATION_VERSION_FORMAT = "weave-reader-annotation-version/v1";
const ANNOTATIONS_FORMAT = "weave-reader-annotations/v1";
const SEMANTIC_PROFILE_FORMAT = "weave-reader-semantic-profile/v1";
const DEFAULT_VERSION_ID = "default";
const DEFAULT_VERSION_NAME = "默认标注";

export const EPUB_ANNOTATION_VERSION_CHANGED_EVENT =
	"weave-epub-annotation-version-changed";

export interface EpubAnnotationVersionSummary {
	bookId: string;
	versionId: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	annotationCount: number;
	active: boolean;
	source?: string;
}

interface ActiveAnnotationVersionPayload {
	format: typeof ACTIVE_VERSION_FORMAT;
	version: 1;
	bookId: string;
	activeVersionId: string;
	updatedAt: number;
}

interface AnnotationVersionPayload {
	format: typeof ANNOTATION_VERSION_FORMAT;
	version: 1;
	bookId: string;
	versionId: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	source?: string;
}

interface PortableAnnotationsPayload {
	format: typeof ANNOTATIONS_FORMAT;
	version: 1;
	bookId: string;
	updatedAt: number;
	authoritative?: boolean;
	annotations: unknown[];
}

function now(): number {
	return Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanString(value: unknown): string {
	return String(value || "").trim();
}

function safeBookId(value: unknown): string {
	return cleanString(value)
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 96) || "epub-book";
}

export function safeEpubAnnotationVersionId(value: unknown): string {
	return cleanString(value)
		.replace(/[\\/:*?"<>|#^[\]\r\n\t]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^\.+|\.+$/g, "")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80) || `version-${now().toString(36)}`;
}

function getAdapter(app: App): DataAdapter | null {
	return app?.vault?.adapter || null;
}

function bookDir(bookId: unknown): string {
	return normalizePath(`${EPUB_ANNOTATION_VERSION_DATA_ROOT}/books/${safeBookId(bookId)}`);
}

function bookPath(bookId: unknown, fileName: string): string {
	return normalizePath(`${bookDir(bookId)}/${fileName}`);
}

function versionsDir(bookId: unknown): string {
	return bookPath(bookId, "versions");
}

function versionDir(bookId: unknown, versionId: unknown): string {
	return normalizePath(`${versionsDir(bookId)}/${safeEpubAnnotationVersionId(versionId)}`);
}

function versionPath(bookId: unknown, versionId: unknown, fileName: string): string {
	return normalizePath(`${versionDir(bookId, versionId)}/${fileName}`);
}

async function readJson(app: App, filePath: string): Promise<unknown | null> {
	const adapter = getAdapter(app);
	if (!adapter || typeof adapter.exists !== "function" || typeof adapter.read !== "function") {
		return null;
	}
	const normalizedPath = normalizePath(filePath);
	try {
		if (!(await adapter.exists(normalizedPath))) {
			return null;
		}
		return JSON.parse(await adapter.read(normalizedPath)) as unknown;
	} catch {
		return null;
	}
}

async function resolveCanonicalEpubAnnotationBookId(app: App, bookId: unknown): Promise<string> {
	const safeId = safeBookId(bookId);
	const index = await readJson(app, normalizePath(`${EPUB_ANNOTATION_VERSION_DATA_ROOT}/index.json`));
	if (!isRecord(index) || !isRecord(index.books)) {
		return safeId;
	}

	for (const [rawBookId, rawBook] of Object.entries(index.books)) {
		if (!isRecord(rawBook)) {
			continue;
		}
		const canonicalId = safeBookId(rawBook.bookId || rawBookId);
		const indexedId = safeBookId(rawBookId);
		if (safeId === canonicalId || safeId === indexedId) {
			return canonicalId;
		}
		const legacyBookIds = Array.isArray(rawBook.legacyBookIds)
			? rawBook.legacyBookIds.map((value) => safeBookId(value))
			: [];
		if (legacyBookIds.includes(safeId)) {
			return canonicalId;
		}
	}

	return safeId;
}

async function writeJson(app: App, filePath: string, value: unknown): Promise<void> {
	const adapter = getAdapter(app);
	if (!adapter || typeof adapter.write !== "function") {
		return;
	}
	const normalizedPath = normalizePath(filePath);
	await DirectoryUtils.ensureDirForFile(adapter, normalizedPath);
	await adapter.write(normalizedPath, JSON.stringify(value, null, 2));
}

async function removeJsonIfExists(app: App, filePath: string): Promise<void> {
	const adapter = getAdapter(app);
	if (
		!adapter ||
		typeof adapter.exists !== "function" ||
		typeof (adapter as { remove?: unknown }).remove !== "function"
	) {
		return;
	}
	const normalizedPath = normalizePath(filePath);
	if (await adapter.exists(normalizedPath)) {
		await (adapter as { remove: (path: string) => Promise<void> }).remove(normalizedPath);
	}
}

function semanticProfileComparable(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => semanticProfileComparable(item));
	}
	if (!isRecord(value)) {
		return value;
	}
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		if (key === "updatedAt") {
			continue;
		}
		result[key] = semanticProfileComparable(value[key]);
	}
	return result;
}

function semanticProfilesEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(semanticProfileComparable(left)) === JSON.stringify(semanticProfileComparable(right));
}

async function syncRootSemanticProfileMirror(
	app: App,
	bookId: string,
	versionId: string
): Promise<void> {
	const safeId = safeBookId(bookId);
	const safeVersionId = safeEpubAnnotationVersionId(versionId || DEFAULT_VERSION_ID);
	const versionProfile = await readJson(
		app,
		versionPath(safeId, safeVersionId, "semantic-profile.json")
	);
	const rootProfilePath = bookPath(safeId, "semantic-profile.json");
	if (isRecord(versionProfile) && versionProfile.format === SEMANTIC_PROFILE_FORMAT) {
		const rootProfile = {
			...versionProfile,
			scope: "book",
			bookId: safeId,
			sourceVersionId: safeVersionId,
		};
		delete (rootProfile as Record<string, unknown>).versionId;
		const existingRootProfile = await readJson(app, rootProfilePath);
		if (semanticProfilesEqual(existingRootProfile, rootProfile)) {
			return;
		}
		await writeJson(app, rootProfilePath, rootProfile);
		return;
	}

	const rootProfile = await readJson(app, rootProfilePath);
	const rootSourceVersionId = isRecord(rootProfile) && rootProfile.sourceVersionId
		? safeEpubAnnotationVersionId(rootProfile.sourceVersionId)
		: "";
	if (rootSourceVersionId && rootSourceVersionId !== safeVersionId) {
		await removeJsonIfExists(app, rootProfilePath);
	}
}

function normalizeAnnotationsPayload(
	value: unknown,
	bookId: string
): PortableAnnotationsPayload | null {
	if (!isRecord(value) || value.format !== ANNOTATIONS_FORMAT) {
		return null;
	}
	return {
		format: ANNOTATIONS_FORMAT,
		version: 1,
		bookId: safeBookId(value.bookId || bookId),
		updatedAt:
			typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
				? value.updatedAt
				: 0,
		...(value.authoritative === true ? { authoritative: true } : {}),
		annotations: Array.isArray(value.annotations) ? value.annotations : [],
	};
}

function createEmptyAnnotationsPayload(bookId: string, updatedAt = now()): PortableAnnotationsPayload {
	return {
		format: ANNOTATIONS_FORMAT,
		version: 1,
		bookId,
		updatedAt,
		authoritative: true,
		annotations: [],
	};
}

function normalizeActiveVersionPayload(
	value: unknown,
	bookId: string
): ActiveAnnotationVersionPayload | null {
	if (!isRecord(value) || value.format !== ACTIVE_VERSION_FORMAT) {
		return null;
	}
	const activeVersionId = safeEpubAnnotationVersionId(value.activeVersionId);
	return {
		format: ACTIVE_VERSION_FORMAT,
		version: 1,
		bookId,
		activeVersionId: activeVersionId || DEFAULT_VERSION_ID,
		updatedAt:
			typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
				? value.updatedAt
				: 0,
	};
}

function normalizeVersionPayload(
	value: unknown,
	bookId: string,
	versionId: string
): AnnotationVersionPayload | null {
	if (!isRecord(value) || value.format !== ANNOTATION_VERSION_FORMAT) {
		return null;
	}
	const source = cleanString(value.source);
	return {
		format: ANNOTATION_VERSION_FORMAT,
		version: 1,
		bookId,
		versionId,
		name: cleanString(value.name) || versionId,
		createdAt:
			typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
				? value.createdAt
				: 0,
		updatedAt:
			typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
				? value.updatedAt
				: 0,
		...(source ? { source } : {}),
	};
}

async function readVersionMetadata(
	app: App,
	bookId: string,
	versionId: string
): Promise<AnnotationVersionPayload | null> {
	return normalizeVersionPayload(
		await readJson(app, versionPath(bookId, versionId, "version.json")),
		bookId,
		versionId
	);
}

async function writeVersionMetadata(app: App, value: AnnotationVersionPayload): Promise<void> {
	await writeJson(app, versionPath(value.bookId, value.versionId, "version.json"), value);
}

async function readVersionAnnotations(
	app: App,
	bookId: string,
	versionId: string
): Promise<PortableAnnotationsPayload | null> {
	return normalizeAnnotationsPayload(
		await readJson(app, versionPath(bookId, versionId, "annotations.json")),
		bookId
	);
}

async function writeVersionAnnotations(
	app: App,
	bookId: string,
	versionId: string,
	payload: PortableAnnotationsPayload
): Promise<void> {
	await writeJson(app, versionPath(bookId, versionId, "annotations.json"), {
		...payload,
		bookId,
	});
}

async function readRootAnnotations(
	app: App,
	bookId: string
): Promise<PortableAnnotationsPayload | null> {
	return normalizeAnnotationsPayload(await readJson(app, bookPath(bookId, "annotations.json")), bookId);
}

async function writeRootAnnotations(
	app: App,
	bookId: string,
	payload: PortableAnnotationsPayload
): Promise<void> {
	await writeJson(app, bookPath(bookId, "annotations.json"), {
		...payload,
		bookId,
	});
}

function normalizeSemanticProfilePayload(
	value: unknown,
	bookId: string,
	versionId: string
): Record<string, unknown> | null {
	if (!isRecord(value) || value.format !== SEMANTIC_PROFILE_FORMAT) {
		return null;
	}
	const safeId = safeBookId(bookId);
	const safeVersionId = safeEpubAnnotationVersionId(versionId || DEFAULT_VERSION_ID);
	return {
		...value,
		scope: "version",
		bookId: safeId,
		versionId: safeVersionId,
		sourceVersionId: safeVersionId,
	};
}

async function readVersionSemanticProfile(
	app: App,
	bookId: string,
	versionId: string
): Promise<Record<string, unknown> | null> {
	return normalizeSemanticProfilePayload(
		await readJson(app, versionPath(bookId, versionId, "semantic-profile.json")),
		bookId,
		versionId
	);
}

async function readRootSemanticProfileForVersion(
	app: App,
	bookId: string,
	versionId: string
): Promise<Record<string, unknown> | null> {
	const rootProfile = await readJson(app, bookPath(bookId, "semantic-profile.json"));
	if (!isRecord(rootProfile) || rootProfile.format !== SEMANTIC_PROFILE_FORMAT) {
		return null;
	}
	const rootSourceVersionId = rootProfile.sourceVersionId
		? safeEpubAnnotationVersionId(rootProfile.sourceVersionId)
		: safeEpubAnnotationVersionId(versionId || DEFAULT_VERSION_ID);
	const safeVersionId = safeEpubAnnotationVersionId(versionId || DEFAULT_VERSION_ID);
	if (rootSourceVersionId !== safeVersionId) {
		return null;
	}
	return normalizeSemanticProfilePayload(rootProfile, bookId, safeVersionId);
}

async function writeVersionSemanticProfile(
	app: App,
	bookId: string,
	versionId: string,
	profile: Record<string, unknown>
): Promise<void> {
	const normalized = normalizeSemanticProfilePayload(profile, bookId, versionId);
	if (!normalized) {
		return;
	}
	await writeJson(app, versionPath(bookId, versionId, "semantic-profile.json"), normalized);
}

async function ensureVersionSemanticProfileFromRootMirror(
	app: App,
	bookId: string,
	versionId: string
): Promise<void> {
	const existing = await readVersionSemanticProfile(app, bookId, versionId);
	if (existing) {
		return;
	}
	const rootMirror = await readRootSemanticProfileForVersion(app, bookId, versionId);
	if (rootMirror) {
		await writeVersionSemanticProfile(app, bookId, versionId, rootMirror);
	}
}

async function copySemanticProfileToVersion(
	app: App,
	bookId: string,
	sourceVersionId: string,
	nextVersionId: string
): Promise<void> {
	const source =
		(await readVersionSemanticProfile(app, bookId, sourceVersionId)) ||
		(await readRootSemanticProfileForVersion(app, bookId, sourceVersionId));
	if (source) {
		await writeVersionSemanticProfile(app, bookId, nextVersionId, source);
	}
}

async function ensureVersionMetadata(
	app: App,
	bookId: string,
	versionId: string,
	name?: string
): Promise<AnnotationVersionPayload> {
	const existing = await readVersionMetadata(app, bookId, versionId);
	if (existing) {
		return existing;
	}
	const timestamp = now();
	const metadata: AnnotationVersionPayload = {
		format: ANNOTATION_VERSION_FORMAT,
		version: 1,
		bookId,
		versionId,
		name: cleanString(name) || (versionId === DEFAULT_VERSION_ID ? DEFAULT_VERSION_NAME : versionId),
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	await writeVersionMetadata(app, metadata);
	return metadata;
}

export async function ensureActiveEpubAnnotationVersion(
	app: App,
	bookId: unknown
): Promise<ActiveAnnotationVersionPayload> {
	const safeId = await resolveCanonicalEpubAnnotationBookId(app, bookId);
	const activePath = bookPath(safeId, "active-version.json");
	const existingActive = normalizeActiveVersionPayload(await readJson(app, activePath), safeId);
	const activeVersionId = existingActive?.activeVersionId || DEFAULT_VERSION_ID;
	const activeUpdatedAt = existingActive?.updatedAt || now();
	const active: ActiveAnnotationVersionPayload = existingActive || {
		format: ACTIVE_VERSION_FORMAT,
		version: 1,
		bookId: safeId,
		activeVersionId,
		updatedAt: activeUpdatedAt,
	};

	await ensureVersionMetadata(app, safeId, activeVersionId);
	let activeAnnotations = await readVersionAnnotations(app, safeId, activeVersionId);
	const rootAnnotations = await readRootAnnotations(app, safeId);
	if (!activeAnnotations && rootAnnotations) {
		activeAnnotations = { ...rootAnnotations, bookId: safeId };
		await writeVersionAnnotations(app, safeId, activeVersionId, activeAnnotations);
	}
	if (!activeAnnotations) {
		activeAnnotations = createEmptyAnnotationsPayload(safeId, activeUpdatedAt);
		await writeVersionAnnotations(app, safeId, activeVersionId, activeAnnotations);
	}

	await writeJson(app, activePath, active);
	await writeRootAnnotations(app, safeId, activeAnnotations);
	await ensureVersionSemanticProfileFromRootMirror(app, safeId, activeVersionId);
	await syncRootSemanticProfileMirror(app, safeId, activeVersionId);
	return active;
}

export async function readActiveEpubAnnotationVersionAnnotations(
	app: App,
	bookId: unknown
): Promise<PortableAnnotationsPayload> {
	const safeId = await resolveCanonicalEpubAnnotationBookId(app, bookId);
	const active = normalizeActiveVersionPayload(
		await readJson(app, bookPath(safeId, "active-version.json")),
		safeId
	);
	if (active) {
		const payload = await readVersionAnnotations(app, safeId, active.activeVersionId);
		if (payload) {
			return { ...payload, bookId: safeId };
		}
	}
	const rootPayload = await readRootAnnotations(app, safeId);
	if (rootPayload) {
		return { ...rootPayload, bookId: safeId };
	}
	return createEmptyAnnotationsPayload(safeId, 0);
}

export async function readEpubAnnotationVersionAnnotations(
	app: App,
	bookId: unknown,
	versionId: unknown
): Promise<PortableAnnotationsPayload> {
	const safeId = await resolveCanonicalEpubAnnotationBookId(app, bookId);
	const safeVersionId = safeEpubAnnotationVersionId(versionId || DEFAULT_VERSION_ID);
	const payload = await readVersionAnnotations(app, safeId, safeVersionId);
	if (payload) {
		return { ...payload, bookId: safeId };
	}
	return createEmptyAnnotationsPayload(safeId, 0);
}

export async function readActiveEpubAnnotationVersionAnnotationsOrNull(
	app: App,
	bookId: unknown
): Promise<PortableAnnotationsPayload | null> {
	const safeId = await resolveCanonicalEpubAnnotationBookId(app, bookId);
	const active = normalizeActiveVersionPayload(
		await readJson(app, bookPath(safeId, "active-version.json")),
		safeId
	);
	if (active) {
		const payload = await readVersionAnnotations(app, safeId, active.activeVersionId);
		if (payload) {
			return { ...payload, bookId: safeId };
		}
	}
	const payload = await readRootAnnotations(app, safeId);
	if (payload) {
		return { ...payload, bookId: safeId };
	}
	return null;
}

export async function writeActiveEpubAnnotationVersionAnnotations(
	app: App,
	bookId: unknown,
	payload: PortableAnnotationsPayload
): Promise<PortableAnnotationsPayload> {
	const safeId = await resolveCanonicalEpubAnnotationBookId(app, bookId);
	const active = await ensureActiveEpubAnnotationVersion(app, safeId);
	const next: PortableAnnotationsPayload = {
		format: ANNOTATIONS_FORMAT,
		version: 1,
		bookId: safeId,
		updatedAt:
			typeof payload.updatedAt === "number" && Number.isFinite(payload.updatedAt)
				? payload.updatedAt
				: now(),
		...(payload.authoritative === true ? { authoritative: true } : {}),
		annotations: Array.isArray(payload.annotations) ? payload.annotations : [],
	};
	await writeVersionAnnotations(app, safeId, active.activeVersionId, next);
	await writeRootAnnotations(app, safeId, next);
	const metadata = await ensureVersionMetadata(app, safeId, active.activeVersionId);
	await writeVersionMetadata(app, {
		...metadata,
		updatedAt: next.updatedAt,
	});
	return next;
}

async function listVersionIds(app: App, bookId: string): Promise<string[]> {
	const adapter = getAdapter(app) as (DataAdapter & {
		list?: (normalizedPath: string) => Promise<{ files: string[]; folders: string[] }>;
	}) | null;
	if (!adapter || typeof adapter.list !== "function" || typeof adapter.exists !== "function") {
		return [DEFAULT_VERSION_ID];
	}
	const root = versionsDir(bookId);
	if (!(await adapter.exists(root))) {
		return [DEFAULT_VERSION_ID];
	}
	const listed = await adapter.list(root);
	const versionIds = (listed.folders || [])
		.map((folder) => safeEpubAnnotationVersionId(String(folder || "").split("/").pop() || ""))
		.filter(Boolean);
	return Array.from(new Set([DEFAULT_VERSION_ID, ...versionIds]));
}

async function getUniqueVersionId(app: App, bookId: string, baseName: string): Promise<string> {
	const adapter = getAdapter(app);
	const baseId = safeEpubAnnotationVersionId(baseName);
	if (!adapter || typeof adapter.exists !== "function") {
		return baseId;
	}
	for (let index = 0; index < 500; index += 1) {
		const candidate = index === 0 ? baseId : `${baseId}-${index + 1}`;
		if (!(await adapter.exists(versionDir(bookId, candidate)))) {
			return candidate;
		}
	}
	return `${baseId}-${now().toString(36)}`;
}

async function getUniqueRenamedVersionId(
	app: App,
	bookId: string,
	currentVersionId: string,
	nextName: string
): Promise<string> {
	const adapter = getAdapter(app);
	const baseId = safeEpubAnnotationVersionId(nextName || currentVersionId);
	if (baseId === currentVersionId) {
		return currentVersionId;
	}
	if (!adapter || typeof adapter.exists !== "function") {
		return baseId;
	}
	for (let index = 0; index < 500; index += 1) {
		const candidate = index === 0 ? baseId : `${baseId}-${index + 1}`;
		if (candidate === currentVersionId || !(await adapter.exists(versionDir(bookId, candidate)))) {
			return candidate;
		}
	}
	return `${baseId}-${now().toString(36)}`;
}

async function updateActiveVersionIdReference(
	app: App,
	bookId: string,
	fromVersionId: string,
	toVersionId: string,
	timestamp: number
): Promise<void> {
	const activePath = bookPath(bookId, "active-version.json");
	const active = normalizeActiveVersionPayload(await readJson(app, activePath), bookId);
	if (active?.activeVersionId !== fromVersionId) {
		return;
	}
	await writeJson(app, activePath, {
		...active,
		activeVersionId: toVersionId,
		updatedAt: timestamp,
	});
}

async function updateRootSemanticProfileSourceVersionId(
	app: App,
	bookId: string,
	fromVersionId: string,
	toVersionId: string
): Promise<void> {
	const rootProfilePath = bookPath(bookId, "semantic-profile.json");
	const rootProfile = await readJson(app, rootProfilePath);
	if (!isRecord(rootProfile) || rootProfile.format !== SEMANTIC_PROFILE_FORMAT) {
		return;
	}
	const sourceVersionId = rootProfile.sourceVersionId
		? safeEpubAnnotationVersionId(rootProfile.sourceVersionId)
		: "";
	if (sourceVersionId !== fromVersionId) {
		return;
	}
	await writeJson(app, rootProfilePath, {
		...rootProfile,
		sourceVersionId: toVersionId,
	});
}

type VersionDirectoryAdapter = DataAdapter & {
	list?: (normalizedPath: string) => Promise<{ files?: string[]; folders?: string[] }>;
	rename?: (normalizedPath: string, normalizedNewPath: string) => Promise<void>;
	remove?: (normalizedPath: string) => Promise<void>;
	rmdir?: (normalizedPath: string, recursive?: boolean) => Promise<void>;
};

async function adapterPathExists(adapter: VersionDirectoryAdapter, filePath: string): Promise<boolean> {
	try {
		return typeof adapter.exists === "function" ? await adapter.exists(normalizePath(filePath)) : false;
	} catch {
		return false;
	}
}

function relativeChildPath(parentPath: string, childPath: string): string {
	const parent = normalizePath(parentPath);
	const child = normalizePath(childPath);
	const prefix = `${parent}/`;
	if (child.startsWith(prefix)) {
		return child.slice(prefix.length);
	}
	return child.split("/").pop() || "";
}

async function copyVersionDirectoryFile(
	adapter: VersionDirectoryAdapter,
	sourceFile: string,
	targetFile: string
): Promise<boolean> {
	const normalizedSource = normalizePath(sourceFile);
	if (!(await adapterPathExists(adapter, normalizedSource))) {
		return false;
	}
	const normalizedTarget = normalizePath(targetFile);
	await DirectoryUtils.ensureDirForFile(adapter, normalizedTarget);
	await adapter.write(normalizedTarget, await adapter.read(normalizedSource));
	return true;
}

async function copyKnownVersionFiles(
	adapter: VersionDirectoryAdapter,
	sourceDir: string,
	targetDir: string
): Promise<boolean> {
	let copied = 0;
	for (const fileName of ["version.json", "annotations.json", "semantic-profile.json"]) {
		if (await copyVersionDirectoryFile(
			adapter,
			normalizePath(`${sourceDir}/${fileName}`),
			normalizePath(`${targetDir}/${fileName}`)
		)) {
			copied += 1;
		}
	}
	return copied > 0;
}

async function copyVersionDirectoryContents(
	adapter: VersionDirectoryAdapter,
	sourceDir: string,
	targetDir: string
): Promise<boolean> {
	const normalizedSource = normalizePath(sourceDir);
	const normalizedTarget = normalizePath(targetDir);
	if (!(await adapterPathExists(adapter, normalizedSource))) {
		return false;
	}
	await DirectoryUtils.ensureDirRecursive(adapter, normalizedTarget);
	if (typeof adapter.list !== "function") {
		return copyKnownVersionFiles(adapter, normalizedSource, normalizedTarget);
	}

	const listing = await adapter.list(normalizedSource);
	for (const filePath of Array.isArray(listing.files) ? listing.files : []) {
		const relative = relativeChildPath(normalizedSource, filePath);
		if (relative) {
			await copyVersionDirectoryFile(
				adapter,
				filePath,
				normalizePath(`${normalizedTarget}/${relative}`)
			);
		}
	}
	for (const folderPath of Array.isArray(listing.folders) ? listing.folders : []) {
		const relative = relativeChildPath(normalizedSource, folderPath);
		if (relative) {
			await copyVersionDirectoryContents(
				adapter,
				folderPath,
				normalizePath(`${normalizedTarget}/${relative}`)
			);
		}
	}
	return true;
}

async function removeVersionDirectory(
	adapter: VersionDirectoryAdapter,
	targetDir: string
): Promise<boolean> {
	const normalizedTarget = normalizePath(targetDir);
	if (!(await adapterPathExists(adapter, normalizedTarget))) {
		return true;
	}
	if (typeof adapter.remove === "function") {
		try {
			await adapter.remove(normalizedTarget);
			if (!(await adapterPathExists(adapter, normalizedTarget))) {
				return true;
			}
		} catch {
			// Try rmdir below when remove cannot delete folders.
		}
	}
	if (typeof adapter.rmdir === "function") {
		try {
			await adapter.rmdir(normalizedTarget, true);
			if (!(await adapterPathExists(adapter, normalizedTarget))) {
				return true;
			}
		} catch {
			return false;
		}
	}
	return !(await adapterPathExists(adapter, normalizedTarget));
}

async function moveVersionDirectory(
	app: App,
	bookId: string,
	fromVersionId: string,
	toVersionId: string
): Promise<boolean> {
	const adapter = getAdapter(app) as VersionDirectoryAdapter | null;
	if (!adapter) {
		return false;
	}
	const sourceDir = versionDir(bookId, fromVersionId);
	const targetDir = versionDir(bookId, toVersionId);
	if (await adapterPathExists(adapter, targetDir)) {
		return false;
	}
	if (typeof adapter.rename === "function") {
		try {
			await adapter.rename(sourceDir, targetDir);
			return true;
		} catch {
			// Fall back to copy + remove. Some Windows vault adapters fail on folder rename.
		}
	}

	try {
		if (!(await copyVersionDirectoryContents(adapter, sourceDir, targetDir))) {
			return false;
		}
		if (await removeVersionDirectory(adapter, sourceDir)) {
			return true;
		}
		await removeVersionDirectory(adapter, targetDir);
		return false;
	} catch {
		await removeVersionDirectory(adapter, targetDir);
		return false;
	}
}

export async function createEpubAnnotationVersion(
	app: App,
	bookId: unknown,
	name: string,
	options: {
		setActive?: boolean;
		copyFromActive?: boolean;
		copyFromVersionId?: unknown;
		initialAnnotations?: unknown[];
		source?: string;
	} = {}
): Promise<EpubAnnotationVersionSummary> {
	const safeId = await resolveCanonicalEpubAnnotationBookId(app, bookId);
	const active = await ensureActiveEpubAnnotationVersion(app, safeId);
	const versionId = await getUniqueVersionId(app, safeId, name || "version");
	const timestamp = now();
	const source = cleanString(options.source);
	const copyFromVersionId = cleanString(options.copyFromVersionId)
		? safeEpubAnnotationVersionId(options.copyFromVersionId)
		: "";
	const sourceVersionId = copyFromVersionId || (options.copyFromActive ? active.activeVersionId : "");
	const metadata: AnnotationVersionPayload = {
		format: ANNOTATION_VERSION_FORMAT,
		version: 1,
		bookId: safeId,
		versionId,
		name: cleanString(name) || versionId,
		createdAt: timestamp,
		updatedAt: timestamp,
		...(source ? { source } : {}),
	};
	const copied = sourceVersionId
		? await readVersionAnnotations(app, safeId, sourceVersionId)
		: null;
	const payload: PortableAnnotationsPayload = {
		format: ANNOTATIONS_FORMAT,
		version: 1,
		bookId: safeId,
		updatedAt: timestamp,
		authoritative: true,
		annotations: Array.isArray(options.initialAnnotations)
			? options.initialAnnotations
			: copied?.annotations || [],
	};

	await writeVersionMetadata(app, metadata);
	await writeVersionAnnotations(app, safeId, versionId, payload);
	if (sourceVersionId) {
		await copySemanticProfileToVersion(app, safeId, sourceVersionId, versionId);
	}
	if (options.setActive) {
		await switchEpubAnnotationVersion(app, safeId, versionId);
	}
	return {
		...metadata,
		annotationCount: payload.annotations.length,
		active: options.setActive === true,
	};
}

export async function switchEpubAnnotationVersion(
	app: App,
	bookId: unknown,
	versionId: unknown
): Promise<ActiveAnnotationVersionPayload> {
	const safeId = await resolveCanonicalEpubAnnotationBookId(app, bookId);
	const safeVersionId = safeEpubAnnotationVersionId(versionId || DEFAULT_VERSION_ID);
	await ensureVersionMetadata(app, safeId, safeVersionId);
	let payload = await readVersionAnnotations(app, safeId, safeVersionId);
	if (!payload) {
		payload = createEmptyAnnotationsPayload(safeId);
		await writeVersionAnnotations(app, safeId, safeVersionId, payload);
	}
	const active: ActiveAnnotationVersionPayload = {
		format: ACTIVE_VERSION_FORMAT,
		version: 1,
		bookId: safeId,
		activeVersionId: safeVersionId,
		updatedAt: now(),
	};
	await writeJson(app, bookPath(safeId, "active-version.json"), active);
	await writeRootAnnotations(app, safeId, payload);
	await syncRootSemanticProfileMirror(app, safeId, safeVersionId);
	return active;
}

export async function listEpubAnnotationVersions(
	app: App,
	bookId: unknown
): Promise<EpubAnnotationVersionSummary[]> {
	const safeId = await resolveCanonicalEpubAnnotationBookId(app, bookId);
	const active = await ensureActiveEpubAnnotationVersion(app, safeId);
	const versions: EpubAnnotationVersionSummary[] = [];
	for (const versionId of await listVersionIds(app, safeId)) {
		const metadata = await ensureVersionMetadata(app, safeId, versionId);
		const payload = await readVersionAnnotations(app, safeId, versionId);
		versions.push({
			...metadata,
			annotationCount: payload?.annotations.length || 0,
			active: versionId === active.activeVersionId,
		});
	}
	return versions.sort((left, right) => {
		if (left.active !== right.active) {
			return left.active ? -1 : 1;
		}
		if (left.versionId === DEFAULT_VERSION_ID) {
			return -1;
		}
		if (right.versionId === DEFAULT_VERSION_ID) {
			return 1;
		}
		return right.updatedAt - left.updatedAt || left.name.localeCompare(right.name, "zh-CN");
	});
}

export async function renameEpubAnnotationVersion(
	app: App,
	bookId: unknown,
	versionId: unknown,
	name: string
): Promise<boolean> {
	const safeId = await resolveCanonicalEpubAnnotationBookId(app, bookId);
	const safeVersionId = safeEpubAnnotationVersionId(versionId || DEFAULT_VERSION_ID);
	const metadata = await readVersionMetadata(app, safeId, safeVersionId);
	if (!metadata) {
		return false;
	}
	const timestamp = now();
	const nextName = cleanString(name) || metadata.name;
	let targetVersionId = safeVersionId === DEFAULT_VERSION_ID
		? safeVersionId
		: await getUniqueRenamedVersionId(app, safeId, safeVersionId, nextName);
	if (targetVersionId !== safeVersionId) {
		if (!(await moveVersionDirectory(app, safeId, safeVersionId, targetVersionId))) {
			return false;
		}
		await updateActiveVersionIdReference(app, safeId, safeVersionId, targetVersionId, timestamp);
		await updateRootSemanticProfileSourceVersionId(app, safeId, safeVersionId, targetVersionId);
		const semanticProfile = await readVersionSemanticProfile(app, safeId, targetVersionId);
		if (semanticProfile) {
			await writeVersionSemanticProfile(app, safeId, targetVersionId, semanticProfile);
		}
	}
	await writeVersionMetadata(app, {
		...metadata,
		versionId: targetVersionId,
		name: nextName,
		updatedAt: timestamp,
	});
	return true;
}

async function resetDefaultEpubAnnotationVersion(app: App, bookId: string): Promise<boolean> {
	const timestamp = now();
	const metadata = await ensureVersionMetadata(app, bookId, DEFAULT_VERSION_ID, DEFAULT_VERSION_NAME);
	const emptyAnnotations = createEmptyAnnotationsPayload(bookId, timestamp);

	await writeVersionMetadata(app, {
		...metadata,
		versionId: DEFAULT_VERSION_ID,
		name: DEFAULT_VERSION_NAME,
		updatedAt: timestamp,
	});
	await writeVersionAnnotations(app, bookId, DEFAULT_VERSION_ID, emptyAnnotations);

	const active = normalizeActiveVersionPayload(
		await readJson(app, bookPath(bookId, "active-version.json")),
		bookId
	);
	if (!active || active.activeVersionId === DEFAULT_VERSION_ID) {
		await writeJson(app, bookPath(bookId, "active-version.json"), {
			...(active || {
				format: ACTIVE_VERSION_FORMAT,
				version: 1,
				bookId,
				activeVersionId: DEFAULT_VERSION_ID,
			}),
			activeVersionId: DEFAULT_VERSION_ID,
			updatedAt: timestamp,
		});
		await writeRootAnnotations(app, bookId, emptyAnnotations);
	}
	return true;
}

export async function deleteEpubAnnotationVersion(
	app: App,
	bookId: unknown,
	versionId: unknown
): Promise<boolean> {
	const safeId = await resolveCanonicalEpubAnnotationBookId(app, bookId);
	const safeVersionId = safeEpubAnnotationVersionId(versionId);
	if (!safeVersionId) {
		return false;
	}
	if (safeVersionId === DEFAULT_VERSION_ID) {
		return resetDefaultEpubAnnotationVersion(app, safeId);
	}
	const adapter = getAdapter(app) as VersionDirectoryAdapter | null;
	if (!adapter) {
		return false;
	}
	const targetDir = versionDir(safeId, safeVersionId);
	const active = normalizeActiveVersionPayload(
		await readJson(app, bookPath(safeId, "active-version.json")),
		safeId
	);
	const exists =
		typeof adapter.exists === "function" ? await adapter.exists(targetDir) : true;
	if (!exists) {
		return false;
	}
	if (!(await removeVersionDirectory(adapter, targetDir))) {
		return false;
	}
	if (active?.activeVersionId === safeVersionId) {
		await switchEpubAnnotationVersion(app, safeId, DEFAULT_VERSION_ID);
	}
	return true;
}

export function notifyEpubAnnotationVersionChanged(
	bookId: unknown,
	detail: Record<string, unknown> = {}
): void {
	if (typeof window === "undefined") {
		return;
	}
	window.dispatchEvent(
		new CustomEvent(EPUB_ANNOTATION_VERSION_CHANGED_EVENT, {
			detail: {
				bookId: safeBookId(bookId),
				...detail,
			},
		})
	);
}
