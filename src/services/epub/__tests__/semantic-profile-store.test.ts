import { describe, expect, it, vi } from "vitest";
import {
	activeSemanticEntries,
	applySemanticScheme,
	DEFAULT_EPUB_SEMANTIC_SCHEME_ID,
	mergeProfiles,
	PROFILE_FORMAT,
	PROFILE_VERSION,
	profileToSettings,
	type EpubSemanticSettings,
} from "../semantic/profiles";
import { loadEffectiveEpubSemanticProfile } from "../semantic/semantic-store";

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
	return {
		vault: {
			adapter: {
				exists: vi.fn(async (path: string) => serialized.has(path)),
				read: vi.fn(async (path: string) => serialized.get(path) ?? ""),
				write: vi.fn(async (path: string, value: string) => {
					serialized.set(path, value);
				}),
				remove: vi.fn(async (path: string) => {
					serialized.delete(path);
				}),
			},
		},
	} as never;
}

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
});
