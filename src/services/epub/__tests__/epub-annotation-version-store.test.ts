import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	normalizePath: (value: string) =>
		String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, ""),
}));

import {
	createEpubAnnotationVersion,
	deleteEpubAnnotationVersion,
	ensureActiveEpubAnnotationVersion,
	EPUB_ANNOTATION_VERSION_CHANGED_EVENT,
	listEpubAnnotationVersions,
	notifyEpubAnnotationVersionChanged,
	readActiveEpubAnnotationVersionAnnotations,
	readEpubAnnotationVersionAnnotations,
	renameEpubAnnotationVersion,
	switchEpubAnnotationVersion,
	writeActiveEpubAnnotationVersionAnnotations,
} from "../epub-annotation-version-store";

function normalizePath(value: string): string {
	return String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function createAppHarness(initialFiles: Record<string, unknown> = {}) {
	const files = new Map(
		Object.entries(initialFiles).map(([path, value]) => [
			normalizePath(path),
			typeof value === "string" ? value : JSON.stringify(value),
		]),
	);
	const folders = new Set<string>();
	const addParentFolders = (path: string) => {
		const parts = normalizePath(path).split("/");
		for (let index = 1; index < parts.length; index += 1) {
			folders.add(parts.slice(0, index).join("/"));
		}
	};
	for (const path of files.keys()) {
		addParentFolders(path);
	}
	const adapter = {
		exists: vi.fn(async (path: string) => files.has(normalizePath(path)) || folders.has(normalizePath(path))),
		read: vi.fn(async (path: string) => files.get(normalizePath(path)) ?? ""),
		write: vi.fn(async (path: string, content: string) => {
			const normalized = normalizePath(path);
			files.set(normalized, content);
			addParentFolders(normalized);
		}),
		mkdir: vi.fn(async (path: string) => {
			folders.add(normalizePath(path));
		}),
		list: vi.fn(async (path: string) => {
			const root = normalizePath(path);
			const prefix = `${root}/`;
			const childFiles = Array.from(files.keys())
				.filter((file) => file.startsWith(prefix))
				.filter((file) => !file.slice(prefix.length).includes("/"));
			const childFolders = Array.from(folders)
				.filter((folder) => folder.startsWith(prefix))
				.filter((folder) => !folder.slice(prefix.length).includes("/"));
			return { files: childFiles, folders: childFolders };
		}),
		remove: vi.fn(async (path: string) => {
			const normalized = normalizePath(path);
			files.delete(normalized);
			for (const filePath of Array.from(files.keys())) {
				if (filePath.startsWith(`${normalized}/`)) {
					files.delete(filePath);
				}
			}
			for (const folderPath of Array.from(folders)) {
				if (folderPath === normalized || folderPath.startsWith(`${normalized}/`)) {
					folders.delete(folderPath);
				}
			}
		}),
		rmdir: vi.fn(async (path: string) => {
			await adapter.remove(path);
		}),
		rename: vi.fn(async (from: string, to: string) => {
			const normalizedFrom = normalizePath(from);
			const normalizedTo = normalizePath(to);
			for (const filePath of Array.from(files.keys())) {
				if (filePath === normalizedFrom || filePath.startsWith(`${normalizedFrom}/`)) {
					const nextPath = normalizePath(`${normalizedTo}${filePath.slice(normalizedFrom.length)}`);
					files.set(nextPath, files.get(filePath) ?? "");
					files.delete(filePath);
				}
			}
			for (const folderPath of Array.from(folders)) {
				if (folderPath === normalizedFrom || folderPath.startsWith(`${normalizedFrom}/`)) {
					const nextPath = normalizePath(`${normalizedTo}${folderPath.slice(normalizedFrom.length)}`);
					folders.add(nextPath);
					folders.delete(folderPath);
				}
			}
			folders.add(normalizedTo);
			addParentFolders(normalizedTo);
		}),
	};
	const app = {
		vault: {
			adapter,
		},
	} as any;
	return { app, files, folders, adapter };
}

function readJson(files: Map<string, string>, path: string): any {
	const content = files.get(normalizePath(path));
	expect(content, `Expected ${path} to exist`).toBeTruthy();
	return JSON.parse(content || "{}");
}

describe("epub-annotation-version-store", () => {
	it("dispatches a browser event when annotation versions change", () => {
		const seen: unknown[] = [];
		const listener = (event: Event) => {
			seen.push((event as CustomEvent).detail);
		};
		window.addEventListener(EPUB_ANNOTATION_VERSION_CHANGED_EVENT, listener);
		try {
			notifyEpubAnnotationVersionChanged("epub-book-demo", {
				reason: "import",
				filePath: "Books/Demo.epub",
			});
		} finally {
			window.removeEventListener(EPUB_ANNOTATION_VERSION_CHANGED_EVENT, listener);
		}

		expect(seen).toEqual([
			{
				bookId: "epub-book-demo",
				reason: "import",
				filePath: "Books/Demo.epub",
			},
		]);
	});

	it("materializes existing root annotations into the default active version", async () => {
		const bookId = "epub-book-demo";
		const root = `weave/epub-data/books/${bookId}`;
		const { app, files } = createAppHarness({
			[`${root}/annotations.json`]: {
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId,
				updatedAt: 10,
				authoritative: true,
				annotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "important" }],
			},
		});

		await expect(ensureActiveEpubAnnotationVersion(app, bookId)).resolves.toMatchObject({
			activeVersionId: "default",
		});

		expect(readJson(files, `${root}/active-version.json`)).toMatchObject({
			format: "weave-reader-active-annotation-version/v1",
			bookId,
			activeVersionId: "default",
		});
		expect(readJson(files, `${root}/versions/default/version.json`)).toMatchObject({
			format: "weave-reader-annotation-version/v1",
			bookId,
			versionId: "default",
			name: "默认标注",
		});
		expect(readJson(files, `${root}/versions/default/annotations.json`)).toMatchObject({
			bookId,
			annotations: [{ semanticId: "important" }],
		});
	});

	it("redirects legacy book ids to the canonical indexed book id before materializing versions", async () => {
		const canonicalBookId = "epub-book-rv441q";
		const legacyBookId = "epub-book-i6zqes";
		const canonicalRoot = `weave/epub-data/books/${canonicalBookId}`;
		const legacyRoot = `weave/epub-data/books/${legacyBookId}`;
		const { app, files } = createAppHarness({
			"weave/epub-data/index.json": {
				format: "weave-reader-epub-data-index/v1",
				version: 1,
				books: {
					[canonicalBookId]: {
						bookId: canonicalBookId,
						title: "LaTeX Beginner's Guide",
						legacyBookIds: [legacyBookId],
					},
				},
			},
			[`${canonicalRoot}/annotations.json`]: {
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId: canonicalBookId,
				updatedAt: 10,
				authoritative: true,
				annotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "canonical-note" }],
			},
		});

		await expect(ensureActiveEpubAnnotationVersion(app, legacyBookId)).resolves.toMatchObject({
			bookId: canonicalBookId,
			activeVersionId: "default",
		});

		expect(readJson(files, `${canonicalRoot}/active-version.json`)).toMatchObject({
			bookId: canonicalBookId,
			activeVersionId: "default",
		});
		expect(readJson(files, `${canonicalRoot}/versions/default/annotations.json`)).toMatchObject({
			bookId: canonicalBookId,
			annotations: [{ semanticId: "canonical-note" }],
		});
		expect(files.has(`${legacyRoot}/active-version.json`)).toBe(false);
		expect(files.has(`${legacyRoot}/annotations.json`)).toBe(false);
		expect(files.has(`${legacyRoot}/versions/default/annotations.json`)).toBe(false);
	});

	it("switches active versions and mirrors the active annotations to the legacy root file", async () => {
		const bookId = "epub-book-demo";
		const root = `weave/epub-data/books/${bookId}`;
		const { app, files } = createAppHarness({
			[`${root}/annotations.json`]: {
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId,
				updatedAt: 10,
				authoritative: true,
				annotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "important" }],
			},
		});

		const imported = await createEpubAnnotationVersion(app, bookId, "平板导入", {
			setActive: true,
			initialAnnotations: [{ cfiRange: "epubcfi(/6/4)", semanticId: "question" }],
		});

		expect(imported.versionId).toBe("平板导入");
		expect(readJson(files, `${root}/annotations.json`)).toMatchObject({
			annotations: [{ semanticId: "question" }],
		});

		await writeActiveEpubAnnotationVersionAnnotations(app, bookId, {
			format: "weave-reader-annotations/v1",
			version: 1,
			bookId,
			updatedAt: 20,
			authoritative: true,
			annotations: [{ cfiRange: "epubcfi(/6/6)", semanticId: "method" }],
		});
		expect(readJson(files, `${root}/versions/${imported.versionId}/annotations.json`)).toMatchObject({
			annotations: [{ semanticId: "method" }],
		});
		expect(readJson(files, `${root}/annotations.json`)).toMatchObject({
			annotations: [{ semanticId: "method" }],
		});

		await switchEpubAnnotationVersion(app, bookId, "default");
		expect(readJson(files, `${root}/annotations.json`)).toMatchObject({
			annotations: [{ semanticId: "important" }],
		});
		await expect(readActiveEpubAnnotationVersionAnnotations(app, bookId)).resolves.toMatchObject({
			annotations: [{ semanticId: "important" }],
		});
	});

	it("reads a specific non-active version without changing the active mirror", async () => {
		const bookId = "epub-book-demo";
		const root = `weave/epub-data/books/${bookId}`;
		const { app, files } = createAppHarness({
			[`${root}/annotations.json`]: {
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId,
				updatedAt: 10,
				authoritative: true,
				annotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "active-note" }],
			},
		});
		const readonlyVersion = await createEpubAnnotationVersion(app, bookId, "readonly-version", {
			setActive: true,
			initialAnnotations: [{ cfiRange: "epubcfi(/6/4)", semanticId: "readonly-note" }],
		});
		await switchEpubAnnotationVersion(app, bookId, "default");

		await expect(
			readEpubAnnotationVersionAnnotations(app, bookId, readonlyVersion.versionId)
		).resolves.toMatchObject({
			bookId,
			annotations: [{ semanticId: "readonly-note" }],
		});
		expect(readJson(files, `${root}/active-version.json`)).toMatchObject({
			activeVersionId: "default",
		});
		expect(readJson(files, `${root}/annotations.json`)).toMatchObject({
			annotations: [{ semanticId: "active-note" }],
		});
	});

	it("copies the active semantic profile when creating a version from the active annotations", async () => {
		const bookId = "epub-book-demo";
		const root = `weave/epub-data/books/${bookId}`;
		const { app, files } = createAppHarness({
			[`${root}/active-version.json`]: {
				format: "weave-reader-active-annotation-version/v1",
				version: 1,
				bookId,
				activeVersionId: "default",
				updatedAt: 10,
			},
			[`${root}/versions/default/annotations.json`]: {
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId,
				updatedAt: 10,
				annotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "important" }],
			},
			[`${root}/versions/default/semantic-profile.json`]: {
				format: "weave-reader-semantic-profile/v1",
				version: 1,
				scope: "version",
				bookId,
				versionId: "default",
				annotationSemanticsEnabled: true,
				semanticSchemeId: "custom",
				semantics: [
					{
						id: "important",
						label: "Important",
						color: "purple",
						style: "underline",
						group: "study",
						source: "custom",
						active: true,
					},
				],
				standardSemanticIds: ["important"],
			},
		});

		const copied = await createEpubAnnotationVersion(app, bookId, "copy", {
			copyFromActive: true,
			setActive: true,
		});

		expect(readJson(files, `${root}/versions/${copied.versionId}/semantic-profile.json`)).toMatchObject({
			format: "weave-reader-semantic-profile/v1",
			scope: "version",
			bookId,
			versionId: copied.versionId,
			semanticSchemeId: "custom",
			semantics: [expect.objectContaining({ id: "important", color: "purple", style: "underline" })],
		});
		expect(readJson(files, `${root}/semantic-profile.json`)).toMatchObject({
			format: "weave-reader-semantic-profile/v1",
			scope: "book",
			bookId,
			sourceVersionId: copied.versionId,
			semanticSchemeId: "custom",
		});
	});

	it("copies annotations and semantic profile from a requested existing version", async () => {
		const bookId = "epub-book-demo";
		const root = `weave/epub-data/books/${bookId}`;
		const { app, files } = createAppHarness({
			[`${root}/active-version.json`]: {
				format: "weave-reader-active-annotation-version/v1",
				version: 1,
				bookId,
				activeVersionId: "default",
				updatedAt: 10,
			},
			[`${root}/versions/default/version.json`]: {
				format: "weave-reader-annotation-version/v1",
				version: 1,
				bookId,
				versionId: "default",
				name: "默认标注",
				createdAt: 10,
				updatedAt: 10,
			},
			[`${root}/versions/default/annotations.json`]: {
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId,
				updatedAt: 10,
				annotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "active-note" }],
			},
			[`${root}/versions/review/version.json`]: {
				format: "weave-reader-annotation-version/v1",
				version: 1,
				bookId,
				versionId: "review",
				name: "复习版",
				createdAt: 20,
				updatedAt: 20,
			},
			[`${root}/versions/review/annotations.json`]: {
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId,
				updatedAt: 20,
				annotations: [{ cfiRange: "epubcfi(/6/4)", semanticId: "review-note" }],
			},
			[`${root}/versions/review/semantic-profile.json`]: {
				format: "weave-reader-semantic-profile/v1",
				version: 1,
				scope: "version",
				bookId,
				versionId: "review",
				annotationSemanticsEnabled: true,
				semanticSchemeId: "review-scheme",
				semantics: [
					{
						id: "review-note",
						label: "Review",
						color: "orange",
						style: "wavy",
						group: "study",
						source: "custom",
						active: true,
					},
				],
				standardSemanticIds: ["review-note"],
			},
		});

		const copied = await createEpubAnnotationVersion(app, bookId, "复习版副本", {
			copyFromVersionId: "review",
			setActive: true,
		});

		expect(readJson(files, `${root}/versions/${copied.versionId}/annotations.json`)).toMatchObject({
			annotations: [{ semanticId: "review-note" }],
		});
		expect(readJson(files, `${root}/versions/${copied.versionId}/semantic-profile.json`)).toMatchObject({
			format: "weave-reader-semantic-profile/v1",
			scope: "version",
			bookId,
			versionId: copied.versionId,
			semanticSchemeId: "review-scheme",
			semantics: [expect.objectContaining({ id: "review-note", color: "orange", style: "wavy" })],
		});
		expect(readJson(files, `${root}/annotations.json`)).toMatchObject({
			annotations: [{ semanticId: "review-note" }],
		});
	});

	it("renames annotation versions by moving their backend folder id", async () => {
		const bookId = "epub-book-demo";
		const root = `weave/epub-data/books/${bookId}`;
		const { app, files } = createAppHarness();

		await createEpubAnnotationVersion(app, bookId, "课堂版", {
			setActive: true,
			initialAnnotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "important" }],
		});
		files.set(`${root}/semantic-profile.json`, JSON.stringify({
			format: "weave-reader-semantic-profile/v1",
			version: 1,
			scope: "book",
			bookId,
			sourceVersionId: "课堂版",
			semanticSchemeId: "classroom",
		}));
		await renameEpubAnnotationVersion(app, bookId, "课堂版", "课堂版 v2");

		await expect(listEpubAnnotationVersions(app, bookId)).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ versionId: "default", name: "默认标注", active: false }),
				expect.objectContaining({
					versionId: "课堂版 v2",
					name: "课堂版 v2",
					annotationCount: 1,
					active: true,
				}),
			]),
		);
		expect(files.has(`${root}/versions/课堂版/version.json`)).toBe(false);
		expect(readJson(files, `${root}/versions/课堂版 v2/version.json`)).toMatchObject({
			versionId: "课堂版 v2",
			name: "课堂版 v2",
		});
		expect(readJson(files, `${root}/active-version.json`)).toMatchObject({
			activeVersionId: "课堂版 v2",
		});
		expect(readJson(files, `${root}/semantic-profile.json`)).toMatchObject({
			sourceVersionId: "课堂版 v2",
		});
	});

	it("keeps renaming stable when the adapter folder rename fails", async () => {
		const bookId = "epub-book-demo";
		const root = `weave/epub-data/books/${bookId}`;
		const { app, files, adapter } = createAppHarness();

		await createEpubAnnotationVersion(app, bookId, "review", {
			setActive: true,
			initialAnnotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "important" }],
		});
		files.set(`${root}/versions/review/semantic-profile.json`, JSON.stringify({
			format: "weave-reader-semantic-profile/v1",
			version: 1,
			scope: "version",
			bookId,
			versionId: "review",
			sourceVersionId: "review",
			semanticSchemeId: "review-scheme",
		}));
		adapter.rename.mockRejectedValueOnce(new Error("folder locked"));

		await expect(renameEpubAnnotationVersion(app, bookId, "review", "review v2")).resolves.toBe(true);

		expect(files.has(`${root}/versions/review/version.json`)).toBe(false);
		expect(files.has(`${root}/versions/review/annotations.json`)).toBe(false);
		expect(readJson(files, `${root}/versions/review v2/version.json`)).toMatchObject({
			versionId: "review v2",
			name: "review v2",
		});
		expect(readJson(files, `${root}/versions/review v2/annotations.json`)).toMatchObject({
			annotations: [{ semanticId: "important" }],
		});
		expect(readJson(files, `${root}/versions/review v2/semantic-profile.json`)).toMatchObject({
			versionId: "review v2",
			sourceVersionId: "review v2",
			semanticSchemeId: "review-scheme",
		});
		expect(readJson(files, `${root}/active-version.json`)).toMatchObject({
			activeVersionId: "review v2",
		});
	});

	it("falls back to default and refreshes the root mirror when deleting the active version", async () => {
		const bookId = "epub-book-demo";
		const root = `weave/epub-data/books/${bookId}`;
		const { app, files } = createAppHarness({
			[`${root}/annotations.json`]: {
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId,
				updatedAt: 10,
				authoritative: true,
				annotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "default-note" }],
			},
		});

		const temporary = await createEpubAnnotationVersion(app, bookId, "临时版本", {
			setActive: true,
			initialAnnotations: [{ cfiRange: "epubcfi(/6/4)", semanticId: "temporary-note" }],
		});
		expect(readJson(files, `${root}/active-version.json`)).toMatchObject({
			activeVersionId: temporary.versionId,
		});
		expect(readJson(files, `${root}/annotations.json`)).toMatchObject({
			annotations: [{ semanticId: "temporary-note" }],
		});

		await expect(deleteEpubAnnotationVersion(app, bookId, temporary.versionId)).resolves.toBe(true);

		expect(readJson(files, `${root}/active-version.json`)).toMatchObject({
			activeVersionId: "default",
		});
		expect(readJson(files, `${root}/annotations.json`)).toMatchObject({
			annotations: [{ semanticId: "default-note" }],
		});
		expect(files.has(`${root}/versions/${temporary.versionId}/annotations.json`)).toBe(false);
	});

	it("uses recursive directory removal when adapter remove leaves a version folder behind", async () => {
		const bookId = "epub-book-demo";
		const root = `weave/epub-data/books/${bookId}`;
		const { app, files, adapter } = createAppHarness();

		const temporary = await createEpubAnnotationVersion(app, bookId, "temporary", {
			initialAnnotations: [{ cfiRange: "epubcfi(/6/4)", semanticId: "temporary-note" }],
		});
		adapter.remove.mockImplementationOnce(async () => undefined);

		await expect(deleteEpubAnnotationVersion(app, bookId, temporary.versionId)).resolves.toBe(true);

		expect(adapter.rmdir).toHaveBeenCalledWith(`${root}/versions/${temporary.versionId}`, true);
		expect(files.has(`${root}/versions/${temporary.versionId}/version.json`)).toBe(false);
		expect(files.has(`${root}/versions/${temporary.versionId}/annotations.json`)).toBe(false);
	});

	it("resets the default version instead of deleting its backend folder", async () => {
		const bookId = "epub-book-demo";
		const root = `weave/epub-data/books/${bookId}`;
		const { app, files } = createAppHarness({
			[`${root}/active-version.json`]: {
				format: "weave-reader-active-annotation-version/v1",
				version: 1,
				bookId,
				activeVersionId: "default",
				updatedAt: 10,
			},
			[`${root}/versions/default/version.json`]: {
				format: "weave-reader-annotation-version/v1",
				version: 1,
				bookId,
				versionId: "default",
				name: "6",
				createdAt: 10,
				updatedAt: 20,
			},
			[`${root}/versions/default/annotations.json`]: {
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId,
				updatedAt: 20,
				authoritative: true,
				annotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "default-note" }],
			},
			[`${root}/annotations.json`]: {
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId,
				updatedAt: 20,
				authoritative: true,
				annotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "default-note" }],
			},
			[`${root}/versions/default/semantic-profile.json`]: {
				format: "weave-reader-semantic-profile/v1",
				version: 1,
				scope: "version",
				bookId,
				versionId: "default",
				sourceVersionId: "default",
				semanticSchemeId: "keep-me",
			},
		});

		await expect(deleteEpubAnnotationVersion(app, bookId, "default")).resolves.toBe(true);

		expect(readJson(files, `${root}/versions/default/version.json`)).toMatchObject({
			versionId: "default",
			name: "默认标注",
			createdAt: 10,
		});
		expect(readJson(files, `${root}/versions/default/annotations.json`)).toMatchObject({
			bookId,
			authoritative: true,
			annotations: [],
		});
		expect(readJson(files, `${root}/annotations.json`)).toMatchObject({
			bookId,
			authoritative: true,
			annotations: [],
		});
		expect(readJson(files, `${root}/versions/default/semantic-profile.json`)).toMatchObject({
			semanticSchemeId: "keep-me",
		});
	});
});
