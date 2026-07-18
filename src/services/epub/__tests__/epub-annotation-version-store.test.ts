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

	it("lists and renames annotation versions without changing their folder id", async () => {
		const bookId = "epub-book-demo";
		const { app } = createAppHarness();

		await createEpubAnnotationVersion(app, bookId, "课堂版", {
			initialAnnotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "important" }],
		});
		await renameEpubAnnotationVersion(app, bookId, "课堂版", "课堂版 v2");

		await expect(listEpubAnnotationVersions(app, bookId)).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ versionId: "default", name: "默认标注", active: true }),
				expect.objectContaining({
					versionId: "课堂版",
					name: "课堂版 v2",
					annotationCount: 1,
					active: false,
				}),
			]),
		);
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
});
