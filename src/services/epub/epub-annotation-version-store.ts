import type { App, DataAdapter } from "obsidian";
import { normalizePath } from "obsidian";
import { DirectoryUtils } from "../../utils/directory-utils";

const EPUB_ANNOTATION_VERSION_DATA_ROOT = "weave/epub-data";
const ACTIVE_VERSION_FORMAT = "weave-reader-active-annotation-version/v1";
const ANNOTATION_VERSION_FORMAT = "weave-reader-annotation-version/v1";
const ANNOTATIONS_FORMAT = "weave-reader-annotations/v1";
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
	const safeId = safeBookId(bookId);
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
	return active;
}

export async function readActiveEpubAnnotationVersionAnnotations(
	app: App,
	bookId: unknown
): Promise<PortableAnnotationsPayload> {
	const safeId = safeBookId(bookId);
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

export async function readActiveEpubAnnotationVersionAnnotationsOrNull(
	app: App,
	bookId: unknown
): Promise<PortableAnnotationsPayload | null> {
	const safeId = safeBookId(bookId);
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
	const safeId = safeBookId(bookId);
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

export async function createEpubAnnotationVersion(
	app: App,
	bookId: unknown,
	name: string,
	options: {
		setActive?: boolean;
		copyFromActive?: boolean;
		initialAnnotations?: unknown[];
		source?: string;
	} = {}
): Promise<EpubAnnotationVersionSummary> {
	const safeId = safeBookId(bookId);
	await ensureActiveEpubAnnotationVersion(app, safeId);
	const versionId = await getUniqueVersionId(app, safeId, name || "version");
	const timestamp = now();
	const source = cleanString(options.source);
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
	const copied = options.copyFromActive
		? await readActiveEpubAnnotationVersionAnnotations(app, safeId)
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
	const safeId = safeBookId(bookId);
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
	return active;
}

export async function listEpubAnnotationVersions(
	app: App,
	bookId: unknown
): Promise<EpubAnnotationVersionSummary[]> {
	const safeId = safeBookId(bookId);
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
	const safeId = safeBookId(bookId);
	const safeVersionId = safeEpubAnnotationVersionId(versionId || DEFAULT_VERSION_ID);
	const metadata = await readVersionMetadata(app, safeId, safeVersionId);
	if (!metadata) {
		return false;
	}
	await writeVersionMetadata(app, {
		...metadata,
		name: cleanString(name) || metadata.name,
		updatedAt: now(),
	});
	return true;
}

export async function deleteEpubAnnotationVersion(
	app: App,
	bookId: unknown,
	versionId: unknown
): Promise<boolean> {
	const safeId = safeBookId(bookId);
	const safeVersionId = safeEpubAnnotationVersionId(versionId);
	if (!safeVersionId || safeVersionId === DEFAULT_VERSION_ID) {
		return false;
	}
	const adapter = getAdapter(app) as (DataAdapter & {
		remove?: (normalizedPath: string) => Promise<void>;
		rmdir?: (normalizedPath: string, recursive?: boolean) => Promise<void>;
	}) | null;
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
	if (typeof adapter.remove === "function") {
		await adapter.remove(targetDir);
	} else if (typeof adapter.rmdir === "function") {
		await adapter.rmdir(targetDir, true);
	} else {
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
