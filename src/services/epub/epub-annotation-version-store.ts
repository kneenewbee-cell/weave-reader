import type { App, DataAdapter } from "obsidian";
import { normalizePath } from "obsidian";
import { DirectoryUtils } from "../../utils/directory-utils";

export const EPUB_ANNOTATION_ACTIVE_VERSION_FORMAT =
	"weave-reader-active-annotation-version/v1";
export const EPUB_ANNOTATION_VERSION_FORMAT = "weave-reader-annotation-version/v1";
export const EPUB_ANNOTATION_PAYLOAD_FORMAT = "weave-reader-annotations/v1";
export const EPUB_ANNOTATION_DEFAULT_VERSION_ID = "default";
export const EPUB_ANNOTATION_DEFAULT_VERSION_NAME = "默认标注";
export const EPUB_ANNOTATION_VERSION_CHANGED_EVENT =
	"weave-epub-annotation-version-changed";

export interface EpubAnnotationVersionChangedDetail {
	bookId: string;
	reason?: "switch" | "create" | "rename" | "delete" | "import" | "write";
	filePath?: string;
	versionId?: string;
}

export interface EpubAnnotationActiveVersionPayload {
	format: typeof EPUB_ANNOTATION_ACTIVE_VERSION_FORMAT;
	version: 1;
	bookId: string;
	activeVersionId: string;
	updatedAt: number;
}

export interface EpubAnnotationVersionMetadataPayload {
	format: typeof EPUB_ANNOTATION_VERSION_FORMAT;
	version: 1;
	bookId: string;
	versionId: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	source?: string;
}

export interface EpubAnnotationVersionSummary extends EpubAnnotationVersionMetadataPayload {
	active: boolean;
	annotationCount: number;
}

export interface EpubAnnotationVersionAnnotationsPayload {
	format: typeof EPUB_ANNOTATION_PAYLOAD_FORMAT;
	version: 1;
	bookId: string;
	updatedAt: number;
	authoritative?: boolean;
	annotations: unknown[];
}

export interface CreateEpubAnnotationVersionOptions {
	setActive?: boolean;
	copyFromActive?: boolean;
	initialAnnotations?: unknown[];
	source?: string;
}

export function notifyEpubAnnotationVersionChanged(
	bookId: unknown,
	detail: Omit<EpubAnnotationVersionChangedDetail, "bookId"> = {}
): void {
	const normalizedBookId = safeBookId(bookId);
	if (!normalizedBookId || typeof window === "undefined") {
		return;
	}
	window.dispatchEvent(
		new CustomEvent<EpubAnnotationVersionChangedDetail>(
			EPUB_ANNOTATION_VERSION_CHANGED_EVENT,
			{
				detail: {
					bookId: normalizedBookId,
					...detail,
				},
			}
		)
	);
}

const EPUB_PORTABLE_DATA_ROOT = "weave/epub-data";

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
	const normalizedId = cleanString(value)
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 96);
	return normalizedId || "epub-book";
}

export function safeEpubAnnotationVersionId(value: unknown): string {
	const normalized = cleanString(value)
		.replace(/[\\/:*?"<>|#^[\]\r\n\t]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^\.+|\.+$/g, "")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return normalized || `version-${now().toString(36)}`;
}

function getAdapter(app: App): (DataAdapter & {
	list?: (path: string) => Promise<{ files?: string[]; folders?: string[] }>;
	remove?: (path: string) => Promise<void>;
	rmdir?: (path: string, recursive?: boolean) => Promise<void>;
}) | null {
	return ((app as { vault?: { adapter?: DataAdapter } })?.vault?.adapter || null) as
		| (DataAdapter & {
				list?: (path: string) => Promise<{ files?: string[]; folders?: string[] }>;
				remove?: (path: string) => Promise<void>;
				rmdir?: (path: string, recursive?: boolean) => Promise<void>;
		  })
		| null;
}

function getBookDir(bookId: unknown): string {
	return normalizePath(`${EPUB_PORTABLE_DATA_ROOT}/books/${safeBookId(bookId)}`);
}

function getBookFilePath(bookId: unknown, fileName: string): string {
	return normalizePath(`${getBookDir(bookId)}/${fileName}`);
}

function getVersionsRoot(bookId: unknown): string {
	return getBookFilePath(bookId, "versions");
}

function getVersionDir(bookId: unknown, versionId: unknown): string {
	return normalizePath(`${getVersionsRoot(bookId)}/${safeEpubAnnotationVersionId(versionId)}`);
}

function getVersionFilePath(bookId: unknown, versionId: unknown, fileName: string): string {
	return normalizePath(`${getVersionDir(bookId, versionId)}/${fileName}`);
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

async function writeJson(app: App, filePath: string, value: unknown): Promise<void> {
	const adapter = getAdapter(app);
	if (!adapter || typeof adapter.write !== "function") {
		return;
	}
	const normalizedPath = normalizePath(filePath);
	await DirectoryUtils.ensureDirForFile(adapter, normalizedPath);
	await adapter.write(normalizedPath, JSON.stringify(value, null, 2));
}

function normalizeAnnotationsPayload(
	value: unknown,
	bookId: string
): EpubAnnotationVersionAnnotationsPayload | null {
	if (!isRecord(value) || value.format !== EPUB_ANNOTATION_PAYLOAD_FORMAT) {
		return null;
	}
	return {
		format: EPUB_ANNOTATION_PAYLOAD_FORMAT,
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

function createEmptyAnnotationsPayload(
	bookId: string,
	updatedAt = now()
): EpubAnnotationVersionAnnotationsPayload {
	return {
		format: EPUB_ANNOTATION_PAYLOAD_FORMAT,
		version: 1,
		bookId,
		updatedAt,
		authoritative: true,
		annotations: [],
	};
}

function normalizeActivePayload(
	value: unknown,
	bookId: string
): EpubAnnotationActiveVersionPayload | null {
	if (!isRecord(value) || value.format !== EPUB_ANNOTATION_ACTIVE_VERSION_FORMAT) {
		return null;
	}
	const activeVersionId = safeEpubAnnotationVersionId(value.activeVersionId);
	return {
		format: EPUB_ANNOTATION_ACTIVE_VERSION_FORMAT,
		version: 1,
		bookId,
		activeVersionId: activeVersionId || EPUB_ANNOTATION_DEFAULT_VERSION_ID,
		updatedAt:
			typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
				? value.updatedAt
				: 0,
	};
}

function normalizeVersionMetadata(
	value: unknown,
	bookId: string,
	versionId: string
): EpubAnnotationVersionMetadataPayload | null {
	if (!isRecord(value) || value.format !== EPUB_ANNOTATION_VERSION_FORMAT) {
		return null;
	}
	return {
		format: EPUB_ANNOTATION_VERSION_FORMAT,
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
		...(cleanString(value.source) ? { source: cleanString(value.source) } : {}),
	};
}

async function readVersionMetadata(
	app: App,
	bookId: string,
	versionId: string
): Promise<EpubAnnotationVersionMetadataPayload | null> {
	return normalizeVersionMetadata(
		await readJson(app, getVersionFilePath(bookId, versionId, "version.json")),
		bookId,
		versionId
	);
}

async function writeVersionMetadata(
	app: App,
	metadata: EpubAnnotationVersionMetadataPayload
): Promise<void> {
	await writeJson(
		app,
		getVersionFilePath(metadata.bookId, metadata.versionId, "version.json"),
		metadata
	);
}

async function readVersionAnnotations(
	app: App,
	bookId: string,
	versionId: string
): Promise<EpubAnnotationVersionAnnotationsPayload | null> {
	return normalizeAnnotationsPayload(
		await readJson(app, getVersionFilePath(bookId, versionId, "annotations.json")),
		bookId
	);
}

async function writeVersionAnnotations(
	app: App,
	bookId: string,
	versionId: string,
	payload: EpubAnnotationVersionAnnotationsPayload
): Promise<void> {
	await writeJson(
		app,
		getVersionFilePath(bookId, versionId, "annotations.json"),
		{ ...payload, bookId }
	);
}

async function writeRootAnnotationsMirror(
	app: App,
	bookId: string,
	payload: EpubAnnotationVersionAnnotationsPayload
): Promise<void> {
	await writeJson(app, getBookFilePath(bookId, "annotations.json"), { ...payload, bookId });
}

async function readRootAnnotations(
	app: App,
	bookId: string
): Promise<EpubAnnotationVersionAnnotationsPayload | null> {
	return normalizeAnnotationsPayload(await readJson(app, getBookFilePath(bookId, "annotations.json")), bookId);
}

async function ensureVersionMetadata(
	app: App,
	bookId: string,
	versionId: string,
	name?: string
): Promise<EpubAnnotationVersionMetadataPayload> {
	const existing = await readVersionMetadata(app, bookId, versionId);
	if (existing) {
		return existing;
	}
	const timestamp = now();
	const metadata: EpubAnnotationVersionMetadataPayload = {
		format: EPUB_ANNOTATION_VERSION_FORMAT,
		version: 1,
		bookId,
		versionId,
		name:
			cleanString(name) ||
			(versionId === EPUB_ANNOTATION_DEFAULT_VERSION_ID
				? EPUB_ANNOTATION_DEFAULT_VERSION_NAME
				: versionId),
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	await writeVersionMetadata(app, metadata);
	return metadata;
}

export async function ensureActiveEpubAnnotationVersion(
	app: App,
	bookId: unknown
): Promise<EpubAnnotationActiveVersionPayload> {
	const normalizedBookId = safeBookId(bookId);
	const activePath = getBookFilePath(normalizedBookId, "active-version.json");
	const currentActive = normalizeActivePayload(await readJson(app, activePath), normalizedBookId);
	const activeVersionId = currentActive?.activeVersionId || EPUB_ANNOTATION_DEFAULT_VERSION_ID;
	const timestamp = currentActive?.updatedAt || now();
	const activePayload: EpubAnnotationActiveVersionPayload = currentActive || {
		format: EPUB_ANNOTATION_ACTIVE_VERSION_FORMAT,
		version: 1,
		bookId: normalizedBookId,
		activeVersionId,
		updatedAt: timestamp,
	};

	await ensureVersionMetadata(app, normalizedBookId, activeVersionId);

	let versionPayload = await readVersionAnnotations(app, normalizedBookId, activeVersionId);
	const rootPayload = await readRootAnnotations(app, normalizedBookId);
	if (!versionPayload && rootPayload) {
		versionPayload = { ...rootPayload, bookId: normalizedBookId };
		await writeVersionAnnotations(app, normalizedBookId, activeVersionId, versionPayload);
	}
	if (!versionPayload) {
		versionPayload = createEmptyAnnotationsPayload(normalizedBookId, timestamp);
		await writeVersionAnnotations(app, normalizedBookId, activeVersionId, versionPayload);
	}

	await writeJson(app, activePath, activePayload);
	await writeRootAnnotationsMirror(app, normalizedBookId, versionPayload);
	return activePayload;
}

export async function readActiveEpubAnnotationVersionAnnotations(
	app: App,
	bookId: unknown
): Promise<EpubAnnotationVersionAnnotationsPayload | null> {
	const normalizedBookId = safeBookId(bookId);
	const active = normalizeActivePayload(
		await readJson(app, getBookFilePath(normalizedBookId, "active-version.json")),
		normalizedBookId
	);
	if (active) {
		const versionPayload = await readVersionAnnotations(app, normalizedBookId, active.activeVersionId);
		if (versionPayload) {
			return { ...versionPayload, bookId: normalizedBookId };
		}
	}
	const rootPayload = await readRootAnnotations(app, normalizedBookId);
	return rootPayload ? { ...rootPayload, bookId: normalizedBookId } : null;
}

export async function writeActiveEpubAnnotationVersionAnnotations(
	app: App,
	bookId: unknown,
	payload: EpubAnnotationVersionAnnotationsPayload
): Promise<EpubAnnotationVersionAnnotationsPayload> {
	const normalizedBookId = safeBookId(bookId);
	const active = await ensureActiveEpubAnnotationVersion(app, normalizedBookId);
	const normalizedPayload: EpubAnnotationVersionAnnotationsPayload = {
		format: EPUB_ANNOTATION_PAYLOAD_FORMAT,
		version: 1,
		bookId: normalizedBookId,
		updatedAt:
			typeof payload.updatedAt === "number" && Number.isFinite(payload.updatedAt)
				? payload.updatedAt
				: now(),
		...(payload.authoritative === true ? { authoritative: true } : {}),
		annotations: Array.isArray(payload.annotations) ? payload.annotations : [],
	};
	await writeVersionAnnotations(app, normalizedBookId, active.activeVersionId, normalizedPayload);
	await writeRootAnnotationsMirror(app, normalizedBookId, normalizedPayload);
	const metadata = await ensureVersionMetadata(app, normalizedBookId, active.activeVersionId);
	await writeVersionMetadata(app, { ...metadata, updatedAt: normalizedPayload.updatedAt });
	return normalizedPayload;
}

async function listVersionIds(app: App, bookId: string): Promise<string[]> {
	const adapter = getAdapter(app);
	if (!adapter || typeof adapter.list !== "function") {
		return [EPUB_ANNOTATION_DEFAULT_VERSION_ID];
	}
	const versionsRoot = getVersionsRoot(bookId);
	if (!(await adapter.exists(versionsRoot))) {
		return [EPUB_ANNOTATION_DEFAULT_VERSION_ID];
	}
	const listed = await adapter.list(versionsRoot);
	const ids = (listed.folders || [])
		.map((folder) => safeEpubAnnotationVersionId(String(folder || "").split("/").pop() || ""))
		.filter(Boolean);
	return Array.from(new Set([EPUB_ANNOTATION_DEFAULT_VERSION_ID, ...ids]));
}

export async function listEpubAnnotationVersions(
	app: App,
	bookId: unknown
): Promise<EpubAnnotationVersionSummary[]> {
	const normalizedBookId = safeBookId(bookId);
	const active = await ensureActiveEpubAnnotationVersion(app, normalizedBookId);
	const summaries: EpubAnnotationVersionSummary[] = [];
	for (const versionId of await listVersionIds(app, normalizedBookId)) {
		const metadata = await ensureVersionMetadata(app, normalizedBookId, versionId);
		const annotations = await readVersionAnnotations(app, normalizedBookId, versionId);
		summaries.push({
			...metadata,
			active: versionId === active.activeVersionId,
			annotationCount: annotations?.annotations.length || 0,
		});
	}
	return summaries.sort((left, right) => {
		if (left.active !== right.active) {
			return left.active ? -1 : 1;
		}
		return (left.createdAt || 0) - (right.createdAt || 0);
	});
}

async function getUniqueVersionId(app: App, bookId: string, name: string): Promise<string> {
	const baseId = safeEpubAnnotationVersionId(name);
	const adapter = getAdapter(app);
	if (!adapter) {
		return baseId;
	}
	let candidate = baseId;
	for (let index = 2; index <= 500; index += 1) {
		if (!(await adapter.exists(getVersionDir(bookId, candidate)))) {
			return candidate;
		}
		candidate = `${baseId}-${index}`;
	}
	return `${baseId}-${now().toString(36)}`;
}

export async function createEpubAnnotationVersion(
	app: App,
	bookId: unknown,
	name: string,
	options: CreateEpubAnnotationVersionOptions = {}
): Promise<EpubAnnotationVersionMetadataPayload> {
	const normalizedBookId = safeBookId(bookId);
	await ensureActiveEpubAnnotationVersion(app, normalizedBookId);
	const versionId = await getUniqueVersionId(app, normalizedBookId, name);
	const timestamp = now();
	const metadata: EpubAnnotationVersionMetadataPayload = {
		format: EPUB_ANNOTATION_VERSION_FORMAT,
		version: 1,
		bookId: normalizedBookId,
		versionId,
		name: cleanString(name) || versionId,
		createdAt: timestamp,
		updatedAt: timestamp,
		...(cleanString(options.source) ? { source: cleanString(options.source) } : {}),
	};
	const activeAnnotations = options.copyFromActive
		? await readActiveEpubAnnotationVersionAnnotations(app, normalizedBookId)
		: null;
	const annotationsPayload: EpubAnnotationVersionAnnotationsPayload = {
		format: EPUB_ANNOTATION_PAYLOAD_FORMAT,
		version: 1,
		bookId: normalizedBookId,
		updatedAt: timestamp,
		authoritative: true,
		annotations: Array.isArray(options.initialAnnotations)
			? options.initialAnnotations
			: activeAnnotations?.annotations || [],
	};

	await writeVersionMetadata(app, metadata);
	await writeVersionAnnotations(app, normalizedBookId, versionId, annotationsPayload);
	if (options.setActive) {
		await switchEpubAnnotationVersion(app, normalizedBookId, versionId);
	}
	return metadata;
}

export async function switchEpubAnnotationVersion(
	app: App,
	bookId: unknown,
	versionId: unknown
): Promise<EpubAnnotationActiveVersionPayload> {
	const normalizedBookId = safeBookId(bookId);
	const normalizedVersionId = safeEpubAnnotationVersionId(versionId);
	const timestamp = now();
	await ensureVersionMetadata(app, normalizedBookId, normalizedVersionId);
	const annotations =
		(await readVersionAnnotations(app, normalizedBookId, normalizedVersionId)) ||
		createEmptyAnnotationsPayload(normalizedBookId, timestamp);
	await writeVersionAnnotations(app, normalizedBookId, normalizedVersionId, annotations);
	await writeRootAnnotationsMirror(app, normalizedBookId, annotations);
	const activePayload: EpubAnnotationActiveVersionPayload = {
		format: EPUB_ANNOTATION_ACTIVE_VERSION_FORMAT,
		version: 1,
		bookId: normalizedBookId,
		activeVersionId: normalizedVersionId,
		updatedAt: timestamp,
	};
	await writeJson(app, getBookFilePath(normalizedBookId, "active-version.json"), activePayload);
	return activePayload;
}

export async function renameEpubAnnotationVersion(
	app: App,
	bookId: unknown,
	versionId: unknown,
	nextName: string
): Promise<EpubAnnotationVersionMetadataPayload> {
	const normalizedBookId = safeBookId(bookId);
	const normalizedVersionId = safeEpubAnnotationVersionId(versionId);
	const metadata = await ensureVersionMetadata(app, normalizedBookId, normalizedVersionId);
	const nextMetadata: EpubAnnotationVersionMetadataPayload = {
		...metadata,
		name: cleanString(nextName) || metadata.name,
		updatedAt: now(),
	};
	await writeVersionMetadata(app, nextMetadata);
	return nextMetadata;
}

export async function deleteEpubAnnotationVersion(
	app: App,
	bookId: unknown,
	versionId: unknown
): Promise<boolean> {
	const normalizedBookId = safeBookId(bookId);
	const normalizedVersionId = safeEpubAnnotationVersionId(versionId);
	if (!normalizedVersionId || normalizedVersionId === EPUB_ANNOTATION_DEFAULT_VERSION_ID) {
		return false;
	}
	const active = await ensureActiveEpubAnnotationVersion(app, normalizedBookId);
	if (active.activeVersionId === normalizedVersionId) {
		await switchEpubAnnotationVersion(app, normalizedBookId, EPUB_ANNOTATION_DEFAULT_VERSION_ID);
	}
	const adapter = getAdapter(app);
	if (!adapter) {
		return false;
	}
	const dir = getVersionDir(normalizedBookId, normalizedVersionId);
	if (!(await adapter.exists(dir))) {
		return false;
	}
	if (typeof adapter.rmdir === "function") {
		await adapter.rmdir(dir, true);
		return true;
	}
	if (typeof adapter.remove === "function") {
		await adapter.remove(dir);
		return true;
	}
	return false;
}
