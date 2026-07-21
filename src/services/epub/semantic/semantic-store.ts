import type { App, DataAdapter } from "obsidian";
import { normalizePath } from "obsidian";
import { DirectoryUtils } from "../../../utils/directory-utils";
import {
	ensureActiveEpubAnnotationVersion,
	readActiveEpubAnnotationVersionAnnotationsOrNull,
	readEpubAnnotationVersionAnnotations,
	safeEpubAnnotationVersionId,
	writeActiveEpubAnnotationVersionAnnotations,
} from "../epub-annotation-version-store";
import * as semanticProfiles from "./profiles";
import { createSemanticProfileStore } from "./profile-store";

export interface EpubAnnotationSemantic {
	id: string;
	label: string;
	color: string;
	style: "highlight" | "underline" | "strikethrough" | "wavy";
	group: string;
	description: string;
	showInStandard?: boolean;
	autoAddToCanvas?: boolean;
	source?: string;
	active?: boolean;
}

export interface EpubSemanticSettings {
	annotationSemanticsEnabled: boolean;
	semanticSchemeId: string;
	annotationSemantics: EpubAnnotationSemantic[];
	standardSemanticIds: string[];
}

export interface EpubPortableAnnotationsPayload {
	format: "weave-reader-annotations/v1";
	version: 1;
	bookId: string;
	updatedAt: number;
	authoritative?: boolean;
	annotations: unknown[];
}

export type EpubSemanticSettingsScope = "global" | "book";

export const EPUB_PORTABLE_DATA_ROOT = "weave/epub-data";
export const EPUB_SEMANTIC_PROFILE_CHANGED_EVENT =
	"weave-epub-semantic-profile-changed";

function now(): number {
	return Date.now();
}

export function normalizeEpubSemanticSettings(value?: unknown): EpubSemanticSettings {
	return semanticProfiles.normalizeSemanticSettings(value || {}) as EpubSemanticSettings;
}

export function safeEpubSemanticBookId(value: unknown): string {
	const normalizedId = String(value || "")
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 96);
	return normalizedId || "epub-book";
}

export function getEpubPortableDataRoot(): string {
	return normalizePath(EPUB_PORTABLE_DATA_ROOT);
}

export function getEpubPortableBookPath(bookId: unknown, fileName: string): string {
	return normalizePath(
		`${getEpubPortableDataRoot()}/books/${safeEpubSemanticBookId(bookId)}/${fileName}`
	);
}

export function getEpubPortableBookVersionPath(
	bookId: unknown,
	versionId: unknown,
	fileName: string
): string {
	return normalizePath(
		`${getEpubPortableDataRoot()}/books/${safeEpubSemanticBookId(bookId)}/versions/${safeEpubAnnotationVersionId(versionId || "default")}/${fileName}`
	);
}

function isNotFoundError(error: unknown): boolean {
	const message = String((error as { message?: string })?.message || error || "").toLowerCase();
	return message.includes("not found") || message.includes("enoent");
}

function getSemanticDataAdapter(app: App | null | undefined): DataAdapter | null {
	const adapter = (app as { vault?: { adapter?: DataAdapter } } | null | undefined)?.vault?.adapter;
	if (
		!adapter ||
		typeof (adapter as { exists?: unknown }).exists !== "function" ||
		typeof (adapter as { read?: unknown }).read !== "function"
	) {
		return null;
	}
	return adapter;
}

function normalizePortableAnnotationsPayload(
	value: unknown,
	bookId: string
): EpubPortableAnnotationsPayload | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const payload = value as {
		format?: unknown;
		version?: unknown;
		bookId?: unknown;
		updatedAt?: unknown;
		annotations?: unknown;
	};
	if (payload.format !== "weave-reader-annotations/v1") {
		return null;
	}
	return {
		format: "weave-reader-annotations/v1",
		version: 1,
		bookId: safeEpubSemanticBookId(payload.bookId || bookId),
		updatedAt:
			typeof payload.updatedAt === "number" && Number.isFinite(payload.updatedAt)
				? payload.updatedAt
				: 0,
		...((payload as { authoritative?: unknown }).authoritative === true
			? { authoritative: true }
			: {}),
		annotations: Array.isArray(payload.annotations) ? payload.annotations : [],
	};
}

export async function readEpubSemanticJson(app: App, filePath: string): Promise<unknown | null> {
	try {
		const adapter = getSemanticDataAdapter(app);
		if (!adapter) {
			return null;
		}
		const normalizedPath = normalizePath(filePath);
		if (!(await adapter.exists(normalizedPath))) {
			return null;
		}
		return JSON.parse(await adapter.read(normalizedPath)) as unknown;
	} catch (error) {
		if (!isNotFoundError(error)) {
			console.warn("[WeaveReaderSemantic] Failed to read JSON:", filePath, error);
		}
		return null;
	}
}

export async function writeEpubSemanticJson(
	app: App,
	filePath: string,
	value: unknown
): Promise<void> {
	const adapter = getSemanticDataAdapter(app);
	if (!adapter || typeof (adapter as { write?: unknown }).write !== "function") {
		return;
	}
	const normalizedPath = normalizePath(filePath);
	await DirectoryUtils.ensureDirForFile(adapter, normalizedPath);
	await adapter.write(normalizedPath, JSON.stringify(value, null, 2));
}

export function createEpubSemanticProfileStore() {
	return createSemanticProfileStore({
		semanticProfiles,
		normalizeSettings: normalizeEpubSemanticSettings,
		normalizePath,
		portableDataRoot: getEpubPortableDataRoot,
		portableBookPath: getEpubPortableBookPath,
		safeBookId: safeEpubSemanticBookId,
		readJson: readEpubSemanticJson,
		writeJson: writeEpubSemanticJson,
		now,
	});
}

const semanticProfileStore = createEpubSemanticProfileStore();

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
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

async function writeEpubSemanticProfileJsonIfChanged(
	app: App,
	filePath: string,
	profile: Record<string, unknown>
): Promise<void> {
	const existing = await readEpubSemanticJson(app, filePath);
	if (semanticProfilesEqual(existing, profile)) {
		return;
	}
	await writeEpubSemanticJson(app, filePath, profile);
}

function normalizeVersionSemanticProfile(
	value: unknown,
	bookId: string,
	versionId: string
): Record<string, unknown> | null {
	if (!isRecord(value) || value.format !== semanticProfiles.PROFILE_FORMAT) {
		return null;
	}
	const safeVersionId = safeEpubAnnotationVersionId(versionId || "default");
	return {
		...value,
		scope: "version",
		bookId,
		versionId: safeVersionId,
		sourceVersionId: safeVersionId,
	};
}

async function readActiveAnnotationVersionId(app: App, bookId: string): Promise<string> {
	const active = await readEpubSemanticJson(
		app,
		getEpubPortableBookPath(bookId, "active-version.json")
	);
	if (isRecord(active)) {
		return safeEpubAnnotationVersionId(active.activeVersionId || "default");
	}
	return "default";
}

async function readVersionEpubSemanticProfile(
	app: App,
	bookId: unknown,
	versionId: unknown
): Promise<Record<string, unknown> | null> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const safeVersionId = safeEpubAnnotationVersionId(versionId || "default");
	const storedProfile = await readEpubSemanticJson(
		app,
		getEpubPortableBookVersionPath(safeBookId, safeVersionId, "semantic-profile.json")
	);
	return normalizeVersionSemanticProfile(storedProfile, safeBookId, safeVersionId);
}

async function readRootEpubSemanticProfileMirrorForVersion(
	app: App,
	bookId: unknown,
	versionId: unknown
): Promise<Record<string, unknown> | null> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const safeVersionId = safeEpubAnnotationVersionId(versionId || "default");
	const rootProfile = await semanticProfileStore.readBookProfile(app, safeBookId);
	if (!rootProfile) {
		return null;
	}
	const rootSourceVersionId = isRecord(rootProfile) && rootProfile.sourceVersionId
		? safeEpubAnnotationVersionId(rootProfile.sourceVersionId)
		: safeVersionId;
	if (rootSourceVersionId !== safeVersionId) {
		return null;
	}
	return normalizeVersionSemanticProfile(rootProfile, safeBookId, safeVersionId);
}

async function readActiveVersionEpubSemanticProfile(
	app: App,
	bookId: unknown
): Promise<Record<string, unknown> | null> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const activeVersionId = await readActiveAnnotationVersionId(app, safeBookId);
	return readVersionEpubSemanticProfile(app, safeBookId, activeVersionId);
}

async function writeActiveVersionEpubSemanticProfile(
	app: App,
	bookId: unknown,
	settings: unknown
): Promise<Record<string, unknown>> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const active = await ensureActiveEpubAnnotationVersion(app, safeBookId);
	const activeVersionId = safeEpubAnnotationVersionId(active.activeVersionId || "default");
	const normalizedSettings = normalizeEpubSemanticSettings(settings);
	const rootProfile = {
		...semanticProfileStore.profilePayload("book", safeBookId, normalizedSettings),
		sourceVersionId: activeVersionId,
	};
	const versionProfile = {
		...rootProfile,
		scope: "version",
		versionId: activeVersionId,
	};
	await writeEpubSemanticProfileJsonIfChanged(
		app,
		getEpubPortableBookVersionPath(safeBookId, activeVersionId, "semantic-profile.json"),
		versionProfile
	);
	await writeEpubSemanticProfileJsonIfChanged(
		app,
		getEpubPortableBookPath(safeBookId, "semantic-profile.json"),
		rootProfile
	);
	return versionProfile;
}

function versionSemanticProfilePayload(
	bookId: string,
	versionId: string,
	settings: unknown
): Record<string, unknown> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const safeVersionId = safeEpubAnnotationVersionId(versionId || "default");
	return {
		...semanticProfileStore.profilePayload(
			"book",
			safeBookId,
			normalizeEpubSemanticSettings(settings)
		),
		scope: "version",
		bookId: safeBookId,
		versionId: safeVersionId,
		sourceVersionId: safeVersionId,
	};
}

function rootSemanticProfileMirrorPayload(
	bookId: string,
	versionId: string,
	settings: unknown
): Record<string, unknown> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const safeVersionId = safeEpubAnnotationVersionId(versionId || "default");
	return {
		...semanticProfileStore.profilePayload(
			"book",
			safeBookId,
			normalizeEpubSemanticSettings(settings)
		),
		scope: "book",
		bookId: safeBookId,
		sourceVersionId: safeVersionId,
	};
}

export async function readEpubSemanticProfileForVersion(
	app: App,
	bookId: unknown,
	versionId: unknown
): Promise<Record<string, unknown> | null> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const safeVersionId = safeEpubAnnotationVersionId(versionId || "default");
	return (
		(await readVersionEpubSemanticProfile(app, safeBookId, safeVersionId)) ||
		(await readRootEpubSemanticProfileMirrorForVersion(app, safeBookId, safeVersionId))
	);
}

export async function loadEffectiveEpubSemanticProfileForVersion(
	app: App,
	bookId: unknown,
	versionId: unknown,
	fallbackSettings?: unknown
) {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const safeVersionId = safeEpubAnnotationVersionId(versionId || "default");
	const globalProfile = await semanticProfileStore.readGlobalProfile(
		app,
		normalizeEpubSemanticSettings(fallbackSettings)
	);
	const bookProfile = await readEpubSemanticProfileForVersion(app, safeBookId, safeVersionId);
	const effectiveProfile = semanticProfiles.mergeProfiles(globalProfile, bookProfile);
	return {
		bookId: safeBookId,
		versionId: safeVersionId,
		globalProfile,
		bookProfile,
		effectiveProfile,
		settings: semanticProfileStore.profileToSettings(effectiveProfile),
	};
}

export async function materializeEpubSemanticProfileForVersion(
	app: App,
	bookId: unknown,
	versionId: unknown,
	fallbackSettings?: unknown
): Promise<Record<string, unknown>> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const safeVersionId = safeEpubAnnotationVersionId(versionId || "default");
	const result = await loadEffectiveEpubSemanticProfileForVersion(
		app,
		safeBookId,
		safeVersionId,
		fallbackSettings
	);
	const versionProfile = versionSemanticProfilePayload(safeBookId, safeVersionId, result.settings);
	await writeEpubSemanticProfileJsonIfChanged(
		app,
		getEpubPortableBookVersionPath(safeBookId, safeVersionId, "semantic-profile.json"),
		versionProfile
	);
	const activeVersionId = await readActiveAnnotationVersionId(app, safeBookId);
	if (activeVersionId === safeVersionId) {
		await writeEpubSemanticProfileJsonIfChanged(
			app,
			getEpubPortableBookPath(safeBookId, "semantic-profile.json"),
			rootSemanticProfileMirrorPayload(safeBookId, safeVersionId, result.settings)
		);
	}
	return versionProfile;
}

export async function ensureActiveEpubSemanticProfile(
	app: App,
	bookId: unknown,
	fallbackSettings?: unknown
): Promise<Record<string, unknown>> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const active = await ensureActiveEpubAnnotationVersion(app, safeBookId);
	return materializeEpubSemanticProfileForVersion(
		app,
		safeBookId,
		active.activeVersionId,
		fallbackSettings
	);
}

function getFallbackSemanticSettingsBookId(value: unknown): string {
	if (!value || typeof value !== "object") {
		return "";
	}
	const rawBookId = String((value as { semanticSettingsBookId?: unknown }).semanticSettingsBookId || "").trim();
	return rawBookId ? safeEpubSemanticBookId(rawBookId) : "";
}

async function readOnlyIndexedSemanticBookId(app: App): Promise<string> {
	const index = await readEpubSemanticJson(app, `${getEpubPortableDataRoot()}/index.json`);
	if (!index || typeof index !== "object" || Array.isArray(index)) {
		return "";
	}
	const books = (index as { books?: Record<string, unknown> }).books || {};
	const bookIds = Array.from(
		new Set(
			Object.entries(books)
				.map(([rawBookId, rawBook]) => {
					const book = rawBook && typeof rawBook === "object" ? rawBook as { bookId?: unknown } : {};
					const rawId = String(book.bookId || rawBookId || "").trim();
					return rawId ? safeEpubSemanticBookId(rawId) : "";
				})
				.filter(Boolean)
		)
	);
	return bookIds.length === 1 ? bookIds[0] : "";
}

async function listPortableAnnotationBookIds(app: App): Promise<string[]> {
	try {
		const adapter = getSemanticDataAdapter(app) as (DataAdapter & {
			list?: (normalizedPath: string) => Promise<{ files: string[]; folders: string[] }>;
		}) | null;
		if (!adapter) {
			return [];
		}
		if (typeof adapter.list !== "function") {
			return [];
		}
		const root = normalizePath(`${getEpubPortableDataRoot()}/books`);
		if (!(await adapter.exists(root))) {
			return [];
		}
		const listed = await adapter.list(root);
		return (listed.folders || [])
			.map((folder) => String(folder || "").split("/").pop() || "")
			.map((folder) => safeEpubSemanticBookId(folder))
			.filter(Boolean);
	} catch (error) {
		if (!isNotFoundError(error)) {
			console.warn("[WeaveReaderSemantic] Failed to list annotation books:", error);
		}
		return [];
	}
}

export async function readBookEpubPortableAnnotations(
	app: App,
	bookId: unknown
): Promise<EpubPortableAnnotationsPayload | null> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const payload = await readActiveEpubAnnotationVersionAnnotationsOrNull(app, safeBookId);
	return normalizePortableAnnotationsPayload(payload, safeBookId);
}

export async function readEffectiveEpubPortableAnnotations(
	app: App,
	bookId: unknown
): Promise<EpubPortableAnnotationsPayload> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const emptyPayload: EpubPortableAnnotationsPayload = {
		format: "weave-reader-annotations/v1",
		version: 1,
		bookId: safeBookId,
		updatedAt: 0,
		annotations: [],
	};
	const current = await readBookEpubPortableAnnotations(app, safeBookId);
	if (current && (current.annotations.length > 0 || current.authoritative === true)) {
		return { ...current, bookId: safeBookId };
	}

	const onlyIndexedBookId = await readOnlyIndexedSemanticBookId(app);
	if (!onlyIndexedBookId) {
		return current ? { ...current, bookId: safeBookId } : emptyPayload;
	}

	const candidateIds = new Set<string>();
	if (onlyIndexedBookId !== safeBookId) {
		candidateIds.add(onlyIndexedBookId);
	}
	for (const candidateId of await listPortableAnnotationBookIds(app)) {
		if (candidateId !== safeBookId) {
			candidateIds.add(candidateId);
		}
	}

	const candidates: EpubPortableAnnotationsPayload[] = [];
	for (const candidateId of candidateIds) {
		const candidate = await readBookEpubPortableAnnotations(app, candidateId);
		if (candidate && candidate.annotations.length > 0) {
			candidates.push(candidate);
		}
	}

	return candidates.length === 1
		? { ...candidates[0], bookId: safeBookId }
		: current
			? { ...current, bookId: safeBookId }
			: emptyPayload;
}

export async function readEpubPortableAnnotationsForVersion(
	app: App,
	bookId: unknown,
	versionId: unknown
): Promise<EpubPortableAnnotationsPayload> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const payload = await readEpubAnnotationVersionAnnotations(app, safeBookId, versionId);
	return normalizePortableAnnotationsPayload(payload, safeBookId) || {
		format: "weave-reader-annotations/v1",
		version: 1,
		bookId: safeBookId,
		updatedAt: 0,
		annotations: [],
	};
}

export async function readAndMaterializeEffectiveEpubPortableAnnotations(
	app: App,
	bookId: unknown
): Promise<EpubPortableAnnotationsPayload> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const current = await readBookEpubPortableAnnotations(app, safeBookId);
	if (current && (current.annotations.length > 0 || current.authoritative === true)) {
		return { ...current, bookId: safeBookId };
	}

	const effective = await readEffectiveEpubPortableAnnotations(app, safeBookId);
	if (effective.annotations.length === 0) {
		return effective;
	}

	return writeBookEpubPortableAnnotations(app, safeBookId, effective.annotations);
}

export async function writeBookEpubPortableAnnotations(
	app: App,
	bookId: unknown,
	annotations: unknown[]
): Promise<EpubPortableAnnotationsPayload> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const payload: EpubPortableAnnotationsPayload = {
		format: "weave-reader-annotations/v1",
		version: 1,
		bookId: safeBookId,
		updatedAt: now(),
		authoritative: true,
		annotations: Array.isArray(annotations)
			? annotations
					.map((annotation) => semanticProfiles.toStoredAnnotation(annotation) || annotation)
					.filter(Boolean)
			: [],
	};
	return normalizePortableAnnotationsPayload(
		await writeActiveEpubAnnotationVersionAnnotations(app, safeBookId, payload),
		safeBookId
	) || payload;
}

export async function clearBookEpubPortableSemanticAnnotations(
	app: App,
	bookId: unknown
): Promise<number> {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const payload = await readEffectiveEpubPortableAnnotations(app, safeBookId);
	const annotations = Array.isArray(payload.annotations) ? payload.annotations : [];
	const removedCount = annotations.length;
	await writeBookEpubPortableAnnotations(app, safeBookId, []);
	return removedCount;
}

export async function loadEffectiveEpubSemanticProfile(
	app: App,
	bookId: unknown,
	fallbackSettings?: unknown
) {
	const safeBookId = safeEpubSemanticBookId(bookId);
	const activeVersionId = await readActiveAnnotationVersionId(app, safeBookId);
	const result = await semanticProfileStore.loadEffectiveProfile(
		app,
		safeBookId,
		normalizeEpubSemanticSettings(fallbackSettings)
	);
	const versionProfile = await readVersionEpubSemanticProfile(app, safeBookId, activeVersionId);
	if (versionProfile) {
		const effectiveProfile = semanticProfiles.mergeProfiles(result.globalProfile, versionProfile);
		return {
			...result,
			bookProfile: versionProfile,
			effectiveProfile,
			settings: semanticProfileStore.profileToSettings(effectiveProfile),
		};
	}
	if (result.bookProfile) {
		const mirrorVersionId = isRecord(result.bookProfile) && result.bookProfile.sourceVersionId
			? safeEpubAnnotationVersionId(result.bookProfile.sourceVersionId)
			: "";
		if (mirrorVersionId && mirrorVersionId !== activeVersionId) {
			return {
				...result,
				bookProfile: null,
				effectiveProfile: result.globalProfile,
				settings: semanticProfileStore.profileToSettings(result.globalProfile),
			};
		}
		return result;
	}

	const legacyBookId = getFallbackSemanticSettingsBookId(fallbackSettings);
	const onlyIndexedBookId = await readOnlyIndexedSemanticBookId(app);
	if (!onlyIndexedBookId) {
		return result;
	}
	const candidateBookIds = Array.from(
		new Set([legacyBookId, onlyIndexedBookId].filter((id) => id && id !== safeBookId))
	);
	for (const candidateBookId of candidateBookIds) {
		if (candidateBookId !== onlyIndexedBookId && safeBookId !== onlyIndexedBookId) {
			continue;
		}
		const candidateProfile = await semanticProfileStore.readBookProfile(app, candidateBookId);
		if (!candidateProfile) {
			continue;
		}
		const bookProfile = { ...candidateProfile, scope: "book", bookId: safeBookId };
		const effectiveProfile = semanticProfiles.mergeProfiles(result.globalProfile, bookProfile);
		return {
			...result,
			bookProfile,
			effectiveProfile,
			settings: semanticProfileStore.profileToSettings(effectiveProfile),
		};
	}
	return result;
}

export async function readGlobalEpubSemanticProfile(app: App, fallbackSettings?: unknown) {
	return semanticProfileStore.readGlobalProfile(
		app,
		normalizeEpubSemanticSettings(fallbackSettings)
	);
}

export async function readBookEpubSemanticProfile(app: App, bookId: unknown) {
	const safeBookId = safeEpubSemanticBookId(bookId);
	return (
		(await readActiveVersionEpubSemanticProfile(app, safeBookId)) ||
		(await semanticProfileStore.readBookProfile(app, safeBookId))
	);
}

export async function writeGlobalEpubSemanticProfile(app: App, settings: unknown) {
	return semanticProfileStore.writeGlobalProfile(app, normalizeEpubSemanticSettings(settings));
}

export async function writeBookEpubSemanticProfile(
	app: App,
	bookId: unknown,
	settings: unknown
) {
	return writeActiveVersionEpubSemanticProfile(app, bookId, settings);
}

export async function deleteBookEpubSemanticProfile(app: App, bookId: unknown): Promise<boolean> {
	return semanticProfileStore.deleteBookProfile(app, safeEpubSemanticBookId(bookId));
}

export function notifyEpubSemanticProfileChanged(
	scope: EpubSemanticSettingsScope,
	bookId = ""
): void {
	if (typeof window === "undefined") {
		return;
	}
	window.dispatchEvent(
		new CustomEvent(EPUB_SEMANTIC_PROFILE_CHANGED_EVENT, {
			detail: {
				scope: scope === "book" ? "book" : "global",
				bookId: bookId ? safeEpubSemanticBookId(bookId) : "",
			},
		})
	);
}
