import { describe, expect, it, vi } from "vitest";
import {
	activeSemanticEntries,
	applySemanticScheme,
	DEFAULT_EPUB_SEMANTIC_SCHEME_ID,
	mergeProfiles,
	PROFILE_FORMAT,
	PROFILE_VERSION,
	profileToSettings,
	SEMANTIC_COLOR_HEX,
	type EpubSemanticSettings,
} from "../semantic/profiles";
import {
	ensureActiveEpubSemanticProfile,
	loadEffectiveEpubSemanticProfile,
	loadEffectiveEpubSemanticProfileForVersion,
} from "../semantic/semantic-store";
import {
	readBookEpubSemanticProfile,
	writeBookEpubSemanticProfile,
} from "../semantic/semantic-store";

function profilePayload(scope: "global" | "book", settings: EpubSemanticSettings, bookId?: string) {
	return {
		format: PROFILE_FORMAT,
		version: PROFILE_VERSION,
		scope,
		...(bookId ? { bookId } : {}),
		annotationSemanticsEnabled: settings.annotationSemanticsEnabled,
		semanticSchemeId: settings.semanticSchemeId,
		semantics: settings.annotationSemantics.map((semantic) => ({ ...semantic })),
		standardSemanticIds: [...settings.standardSemanticIds],
		updatedAt: 1,
	};
}

function createMockApp(files: Record<string, unknown>) {
	const serialized = new Map(
		Object.entries(files).map(([path, value]) => [path, JSON.stringify(value)])
	);
	const directories = new Set<string>();
	return {
		vault: {
			adapter: {
				exists: vi.fn(async (path: string) => serialized.has(path) || directories.has(path)),
				read: vi.fn(async (path: string) => serialized.get(path) ?? ""),
				write: vi.fn(async (path: string, value: string) => {
					serialized.set(path, value);
				}),
				mkdir: vi.fn(async (path: string) => {
					directories.add(path);
				}),
				remove: vi.fn(async (path: string) => {
					serialized.delete(path);
				}),
			},
		},
		__files: serialized,
	} as never;
}

describe("semantic color palette", () => {
	it("exposes ten high-contrast colors in a two-row palette order", () => {
		expect(Object.keys(SEMANTIC_COLOR_HEX)).toEqual([
			"yellow",
			"orange",
			"red",
			"magenta",
			"purple",
			"indigo",
			"blue",
			"teal",
			"green",
			"slate",
		]);
	});

	it("keeps newly added palette colors when normalizing semantic settings", () => {
		const settings = profileToSettings({
			annotationSemantics: [
				{
					id: "mind-map",
					label: "脑图",
					color: "indigo",
					style: "highlight",
					group: "study",
				},
			],
			standardSemanticIds: ["mind-map"],
		});

		expect(settings.annotationSemantics[0]?.color).toBe("indigo");
	});

	it("normalizes legacy color tokens to the new palette", () => {
		const settings = profileToSettings({
			annotationSemantics: [
				{ id: "quote", label: "摘句", color: "cyan", style: "underline" },
				{ id: "person", label: "人物", color: "pink", style: "highlight" },
				{ id: "review", label: "待回看", color: "gray", style: "wavy" },
			],
			standardSemanticIds: ["quote", "person", "review"],
		});

		expect(settings.annotationSemantics.map((semantic) => semantic.color)).toEqual([
			"teal",
			"magenta",
			"slate",
		]);
	});

	it("defaults semantic canvas auto-add to false and preserves explicit opt-in", () => {
		const settings = applySemanticScheme({}, "literature-humanities");

		expect(settings.annotationSemantics.every((semantic) => semantic.autoAddToCanvas === false)).toBe(true);

		const custom = profileToSettings({
			annotationSemantics: [
				{
					id: "quote",
					label: "摘句",
					color: "teal",
					style: "highlight",
					autoAddToCanvas: true,
				},
			],
			standardSemanticIds: ["quote"],
		});

		expect(custom.annotationSemantics[0]?.autoAddToCanvas).toBe(true);
	});
});

describe("loadEffectiveEpubSemanticProfile", () => {
	it("does not append global active semantics when a book profile exists", () => {
		const globalProfile = profilePayload(
			"global",
			applySemanticScheme({}, "literature-humanities")
		);
		const bookProfile = profilePayload(
			"book",
			applySemanticScheme({}, "medical-life-science"),
			"epub-book-current"
		);

		const effective = profileToSettings(mergeProfiles(globalProfile, bookProfile));

		expect(effective.semanticSchemeId).toBe("medical-life-science");
		expect(activeSemanticEntries(effective).map((semantic) => semantic.id)).toEqual([
			"diagnosis",
			"symptom",
			"mechanism",
			"evidence",
			"treatment",
			"drug-dose",
			"contraindication",
			"question",
		]);
	});

	it("uses a remembered legacy book profile for the only indexed book", async () => {
		const currentBookId = "epub-book-current";
		const legacyBookId = "epub-book-legacy";
		const globalSettings = applySemanticScheme({}, DEFAULT_EPUB_SEMANTIC_SCHEME_ID);
		const legacySettings = applySemanticScheme({}, "law-policy");
		const app = createMockApp({
			"weave/epub-data/index.json": {
				books: {
					[currentBookId]: { bookId: currentBookId },
				},
			},
			"weave/epub-data/semantic-profiles/default.json": profilePayload("global", globalSettings),
			[`weave/epub-data/books/${legacyBookId}/semantic-profile.json`]: profilePayload(
				"book",
				legacySettings,
				legacyBookId
			),
		});

		const result = await loadEffectiveEpubSemanticProfile(app, currentBookId, {
			semanticSettingsBookId: legacyBookId,
			semanticSchemeId: DEFAULT_EPUB_SEMANTIC_SCHEME_ID,
		});

		expect(result.bookProfile?.bookId).toBe(currentBookId);
		expect(result.settings.semanticSchemeId).toBe("law-policy");
		expect(activeSemanticEntries(result.settings).map((semantic) => semantic.id)).toEqual([
			"rule",
			"element",
			"case-evidence",
			"exception",
			"reasoning",
			"conclusion",
			"issue",
		]);
	});

	it("maps an old runtime book id to the only indexed book profile", async () => {
		const runtimeBookId = "epub-book-181ck3o";
		const indexedBookId = "epub-book-rv441q";
		const globalSettings = applySemanticScheme({}, "medical-life-science");
		const bookSettings = applySemanticScheme({}, "study-exam");
		const app = createMockApp({
			"weave/epub-data/index.json": {
				books: {
					[indexedBookId]: { bookId: indexedBookId },
				},
			},
			"weave/epub-data/semantic-profiles/default.json": profilePayload("global", globalSettings),
			[`weave/epub-data/books/${indexedBookId}/semantic-profile.json`]: profilePayload(
				"book",
				bookSettings,
				indexedBookId
			),
		});

		const result = await loadEffectiveEpubSemanticProfile(app, runtimeBookId, {
			semanticSettingsBookId: indexedBookId,
			semanticSchemeId: "medical-life-science",
		});

		expect(result.bookProfile?.bookId).toBe(runtimeBookId);
		expect(result.settings.semanticSchemeId).toBe("study-exam");
		expect(activeSemanticEntries(result.settings).map((semantic) => semantic.id)).toEqual([
			"important",
			"definition",
			"example",
			"method",
			"mistake",
			"exam",
			"question",
		]);
	});

	it("does not apply a legacy book profile when multiple indexed books exist", async () => {
		const currentBookId = "epub-book-current";
		const legacyBookId = "epub-book-legacy";
		const globalSettings = applySemanticScheme({}, DEFAULT_EPUB_SEMANTIC_SCHEME_ID);
		const legacySettings = applySemanticScheme({}, "law-policy");
		const app = createMockApp({
			"weave/epub-data/index.json": {
				books: {
					[currentBookId]: { bookId: currentBookId },
					"epub-book-other": { bookId: "epub-book-other" },
				},
			},
			"weave/epub-data/semantic-profiles/default.json": profilePayload("global", globalSettings),
			[`weave/epub-data/books/${legacyBookId}/semantic-profile.json`]: profilePayload(
				"book",
				legacySettings,
				legacyBookId
			),
		});

		const result = await loadEffectiveEpubSemanticProfile(app, currentBookId, {
			semanticSettingsBookId: legacyBookId,
			semanticSchemeId: DEFAULT_EPUB_SEMANTIC_SCHEME_ID,
		});

		expect(result.bookProfile).toBeNull();
		expect(result.settings.semanticSchemeId).toBe(DEFAULT_EPUB_SEMANTIC_SCHEME_ID);
	});

	it("uses the active annotation version semantic profile before the root mirror", async () => {
		const bookId = "epub-book-current";
		const globalSettings = applySemanticScheme({}, DEFAULT_EPUB_SEMANTIC_SCHEME_ID);
		const rootSettings = applySemanticScheme({}, "law-policy");
		const versionSettings = applySemanticScheme({}, "study-exam");
		const app = createMockApp({
			"weave/epub-data/semantic-profiles/default.json": profilePayload("global", globalSettings),
			[`weave/epub-data/books/${bookId}/active-version.json`]: {
				format: "weave-reader-active-annotation-version/v1",
				version: 1,
				bookId,
				activeVersionId: "imported-default",
				updatedAt: 10,
			},
			[`weave/epub-data/books/${bookId}/semantic-profile.json`]: profilePayload(
				"book",
				rootSettings,
				bookId
			),
			[`weave/epub-data/books/${bookId}/versions/imported-default/semantic-profile.json`]: {
				...profilePayload("book", versionSettings, bookId),
				scope: "version",
				versionId: "imported-default",
			},
		});

		const result = await loadEffectiveEpubSemanticProfile(app, bookId, {
			semanticSchemeId: DEFAULT_EPUB_SEMANTIC_SCHEME_ID,
		});

		expect(result.bookProfile?.versionId).toBe("imported-default");
		expect(result.settings.semanticSchemeId).toBe("study-exam");
	});

	it("does not use a stale root semantic mirror for a different active annotation version", async () => {
		const bookId = "epub-book-current";
		const globalSettings = applySemanticScheme({}, DEFAULT_EPUB_SEMANTIC_SCHEME_ID);
		const staleRootSettings = applySemanticScheme({}, "law-policy");
		const app = createMockApp({
			"weave/epub-data/semantic-profiles/default.json": profilePayload("global", globalSettings),
			[`weave/epub-data/books/${bookId}/active-version.json`]: {
				format: "weave-reader-active-annotation-version/v1",
				version: 1,
				bookId,
				activeVersionId: "imported-default",
				updatedAt: 10,
			},
			[`weave/epub-data/books/${bookId}/semantic-profile.json`]: {
				...profilePayload("book", staleRootSettings, bookId),
				sourceVersionId: "default",
			},
		});

		const result = await loadEffectiveEpubSemanticProfile(app, bookId, {
			semanticSchemeId: DEFAULT_EPUB_SEMANTIC_SCHEME_ID,
		});

		expect(result.bookProfile).toBeNull();
		expect(result.settings.semanticSchemeId).toBe(DEFAULT_EPUB_SEMANTIC_SCHEME_ID);
	});

	it("writes the selected book semantic profile to the active version and root mirror", async () => {
		const bookId = "epub-book-current";
		const settings = applySemanticScheme({}, "law-policy");
		const app = createMockApp({
			[`weave/epub-data/books/${bookId}/active-version.json`]: {
				format: "weave-reader-active-annotation-version/v1",
				version: 1,
				bookId,
				activeVersionId: "default",
				updatedAt: 10,
			},
			[`weave/epub-data/books/${bookId}/versions/default/version.json`]: {
				format: "weave-reader-annotation-version/v1",
				version: 1,
				bookId,
				versionId: "default",
				name: "默认标注",
				createdAt: 1,
				updatedAt: 1,
			},
			[`weave/epub-data/books/${bookId}/versions/default/annotations.json`]: {
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId,
				updatedAt: 1,
				authoritative: true,
				annotations: [],
			},
		});

		await writeBookEpubSemanticProfile(app, bookId, settings);

		const files = (app as unknown as { __files: Map<string, string> }).__files;
		const rootProfile = JSON.parse(files.get(`weave/epub-data/books/${bookId}/semantic-profile.json`) || "{}");
		const versionProfile = JSON.parse(
			files.get(`weave/epub-data/books/${bookId}/versions/default/semantic-profile.json`) || "{}"
		);
		expect(rootProfile).toMatchObject({
			format: PROFILE_FORMAT,
			scope: "book",
			bookId,
			sourceVersionId: "default",
			semanticSchemeId: "law-policy",
		});
		expect(versionProfile).toMatchObject({
			format: PROFILE_FORMAT,
			scope: "version",
			bookId,
			versionId: "default",
			semanticSchemeId: "law-policy",
		});

		await expect(readBookEpubSemanticProfile(app, bookId)).resolves.toMatchObject({
			scope: "version",
			bookId,
			versionId: "default",
			semanticSchemeId: "law-policy",
		});
	});

	it("materializes the initial active version semantic profile from the effective settings", async () => {
		const bookId = "epub-book-initial-profile";
		const settings = applySemanticScheme({}, "study-exam");
		const app = createMockApp({});

		await expect(ensureActiveEpubSemanticProfile(app, bookId, settings)).resolves.toMatchObject({
			format: PROFILE_FORMAT,
			scope: "version",
			bookId,
			versionId: "default",
			sourceVersionId: "default",
			semanticSchemeId: "study-exam",
		});

		const files = (app as unknown as { __files: Map<string, string> }).__files;
		const rootProfile = JSON.parse(files.get(`weave/epub-data/books/${bookId}/semantic-profile.json`) || "{}");
		const versionProfile = JSON.parse(
			files.get(`weave/epub-data/books/${bookId}/versions/default/semantic-profile.json`) || "{}"
		);
		expect(rootProfile).toMatchObject({
			format: PROFILE_FORMAT,
			scope: "book",
			bookId,
			sourceVersionId: "default",
			semanticSchemeId: "study-exam",
		});
		expect(versionProfile).toMatchObject({
			format: PROFILE_FORMAT,
			scope: "version",
			bookId,
			versionId: "default",
			sourceVersionId: "default",
			semanticSchemeId: "study-exam",
		});
	});

	it("does not rewrite unchanged active semantic profile files while ensuring them", async () => {
		const bookId = "epub-book-stable-profile";
		const settings = applySemanticScheme({}, "study-exam");
		const rootProfile = {
			...profilePayload("book", settings, bookId),
			sourceVersionId: "default",
		};
		const versionProfile = {
			...rootProfile,
			scope: "version",
			versionId: "default",
		};
		const app = createMockApp({
			"weave/epub-data/semantic-profiles/default.json": profilePayload("global", settings),
			[`weave/epub-data/books/${bookId}/active-version.json`]: {
				format: "weave-reader-active-annotation-version/v1",
				version: 1,
				bookId,
				activeVersionId: "default",
				updatedAt: 10,
			},
			[`weave/epub-data/books/${bookId}/versions/default/version.json`]: {
				format: "weave-reader-annotation-version/v1",
				version: 1,
				bookId,
				versionId: "default",
				name: "默认标注",
				createdAt: 1,
				updatedAt: 1,
			},
			[`weave/epub-data/books/${bookId}/annotations.json`]: {
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId,
				updatedAt: 1,
				authoritative: true,
				annotations: [],
			},
			[`weave/epub-data/books/${bookId}/versions/default/annotations.json`]: {
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId,
				updatedAt: 1,
				authoritative: true,
				annotations: [],
			},
			[`weave/epub-data/books/${bookId}/semantic-profile.json`]: rootProfile,
			[`weave/epub-data/books/${bookId}/versions/default/semantic-profile.json`]: versionProfile,
		});
		const adapter = (app as any).vault.adapter;
		adapter.write.mockClear();

		await ensureActiveEpubSemanticProfile(app, bookId, settings);

		const semanticProfileWrites = adapter.write.mock.calls
			.map(([path]: [string]) => path)
			.filter((path: string) => path.endsWith("semantic-profile.json"));
		expect(semanticProfileWrites).toEqual([]);
	});

	it("loads a requested annotation version semantic profile without using a stale root mirror", async () => {
		const bookId = "epub-book-current";
		const globalSettings = applySemanticScheme({}, DEFAULT_EPUB_SEMANTIC_SCHEME_ID);
		const rootSettings = applySemanticScheme({}, "law-policy");
		const readonlySettings = applySemanticScheme({}, "study-exam");
		const app = createMockApp({
			"weave/epub-data/semantic-profiles/default.json": profilePayload("global", globalSettings),
			[`weave/epub-data/books/${bookId}/semantic-profile.json`]: {
				...profilePayload("book", rootSettings, bookId),
				sourceVersionId: "default",
			},
			[`weave/epub-data/books/${bookId}/versions/readonly/semantic-profile.json`]: {
				...profilePayload("book", readonlySettings, bookId),
				scope: "version",
				versionId: "readonly",
			},
		});

		const result = await loadEffectiveEpubSemanticProfileForVersion(app, bookId, "readonly", {
			semanticSchemeId: DEFAULT_EPUB_SEMANTIC_SCHEME_ID,
		});

		expect(result.bookProfile).toMatchObject({
			scope: "version",
			bookId,
			versionId: "readonly",
			semanticSchemeId: "study-exam",
		});
		expect(result.settings.semanticSchemeId).toBe("study-exam");
	});

	it("falls back to global settings for a requested version when only another version root mirror exists", async () => {
		const bookId = "epub-book-current";
		const globalSettings = applySemanticScheme({}, DEFAULT_EPUB_SEMANTIC_SCHEME_ID);
		const rootSettings = applySemanticScheme({}, "law-policy");
		const app = createMockApp({
			"weave/epub-data/semantic-profiles/default.json": profilePayload("global", globalSettings),
			[`weave/epub-data/books/${bookId}/semantic-profile.json`]: {
				...profilePayload("book", rootSettings, bookId),
				sourceVersionId: "default",
			},
		});

		const result = await loadEffectiveEpubSemanticProfileForVersion(app, bookId, "readonly", {
			semanticSchemeId: DEFAULT_EPUB_SEMANTIC_SCHEME_ID,
		});

		expect(result.bookProfile).toBeNull();
		expect(result.settings.semanticSchemeId).toBe(DEFAULT_EPUB_SEMANTIC_SCHEME_ID);
	});
});
