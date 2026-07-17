import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

vi.mock("obsidian", () => ({
	normalizePath: (value: string) =>
		String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, ""),
}));

import {
	createEpubAnnotatedBookPackage,
	importEpubAnnotatedBookPackage,
} from "../epub-portable-book-package";

function normalizePath(value: string): string {
	return String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function toArrayBuffer(value: string): ArrayBuffer {
	return new TextEncoder().encode(value).buffer;
}

function createAppHarness(options: {
	files?: Record<string, string>;
	binaries?: Record<string, ArrayBuffer>;
}) {
	const files = new Map(Object.entries(options.files || {}).map(([path, value]) => [normalizePath(path), value]));
	const binaries = new Map(
		Object.entries(options.binaries || {}).map(([path, value]) => [normalizePath(path), value]),
	);
	const folders = new Set<string>();
	const addParentFolders = (path: string) => {
		const parts = normalizePath(path).split("/");
		for (let index = 1; index < parts.length; index += 1) {
			folders.add(parts.slice(0, index).join("/"));
		}
	};
	for (const path of [...files.keys(), ...binaries.keys()]) {
		addParentFolders(path);
	}
	const adapter = {
		exists: vi.fn(async (path: string) => {
			const normalized = normalizePath(path);
			return files.has(normalized) || binaries.has(normalized) || folders.has(normalized);
		}),
		read: vi.fn(async (path: string) => files.get(normalizePath(path)) ?? ""),
		write: vi.fn(async (path: string, content: string) => {
			const normalized = normalizePath(path);
			files.set(normalized, content);
			addParentFolders(normalized);
		}),
		readBinary: vi.fn(async (path: string) => binaries.get(normalizePath(path)) ?? toArrayBuffer("")),
		writeBinary: vi.fn(async (path: string, content: ArrayBuffer) => {
			const normalized = normalizePath(path);
			binaries.set(normalized, content);
			addParentFolders(normalized);
		}),
		mkdir: vi.fn(async (path: string) => {
			folders.add(normalizePath(path));
		}),
		list: vi.fn(async (path: string) => {
			const root = normalizePath(path);
			const prefix = `${root}/`;
			const childFiles = Array.from(files.keys())
				.concat(Array.from(binaries.keys()))
				.filter((file) => file.startsWith(prefix))
				.filter((file) => !file.slice(prefix.length).includes("/"));
			const childFolders = Array.from(folders)
				.filter((folder) => folder.startsWith(prefix))
				.filter((folder) => !folder.slice(prefix.length).includes("/"));
			return { files: childFiles, folders: childFolders };
		}),
	};
	const app = {
		vault: {
			adapter,
		},
	} as any;
	return { app, files, binaries, folders, adapter };
}

function readJson(files: Map<string, string>, path: string): any {
	const content = files.get(normalizePath(path));
	expect(content, `Expected ${path} to exist`).toBeTruthy();
	return JSON.parse(content || "{}");
}

describe("epub-portable-book-package", () => {
	it("exports the EPUB file and the whole portable data directory into one zip", async () => {
		const bookId = "epub-book-demo";
		const root = `weave/epub-data/books/${bookId}`;
		const { app } = createAppHarness({
			binaries: {
				"Books/Demo.epub": toArrayBuffer("epub-binary"),
			},
			files: {
				[`${root}/book.json`]: JSON.stringify({
					format: "weave-reader-book/v1",
					version: 1,
					bookId,
					filePath: "Books/Demo.epub",
					title: "Demo",
					sourceFingerprint: "fingerprint-demo",
				}),
				[`${root}/reading-state.json`]: JSON.stringify({
					format: "weave-reader-reading-state/v1",
					version: 1,
					bookId,
					currentPosition: { cfi: "epubcfi(/6/2)", chapterIndex: 1, percent: 12 },
				}),
				[`${root}/active-version.json`]: JSON.stringify({
					format: "weave-reader-active-annotation-version/v1",
					version: 1,
					bookId,
					activeVersionId: "default",
				}),
				[`${root}/versions/default/annotations.json`]: JSON.stringify({
					format: "weave-reader-annotations/v1",
					version: 1,
					bookId,
					annotations: [{ semanticId: "important" }],
				}),
			},
		});

		const result = await createEpubAnnotatedBookPackage(app, {
			bookId,
			filePath: "Books/Demo.epub",
		});

		const zip = await JSZip.loadAsync(result.arrayBuffer);
		await expect(zip.file("manifest.json")?.async("string")).resolves.toContain(
			"weave-reader-annotated-book-package/v1",
		);
		await expect(zip.file("book/Demo.epub")?.async("string")).resolves.toBe("epub-binary");
		await expect(zip.file("data/book.json")?.async("string")).resolves.toContain("fingerprint-demo");
		await expect(zip.file("data/versions/default/annotations.json")?.async("string")).resolves.toContain("important");
		expect(result.fileName).toMatch(/^Demo.*\.zip$/);
	});

	it("imports a zip package into a vault book file and matching portable data directory", async () => {
		const bookId = "epub-book-imported";
		const zip = new JSZip();
		zip.file(
			"manifest.json",
			JSON.stringify({
				format: "weave-reader-annotated-book-package/v1",
				version: 1,
				bookId,
				bookFileName: "Imported.epub",
				exportedAt: 1,
			}),
		);
		zip.file("book/Imported.epub", "imported-epub");
		zip.file(
			"data/book.json",
			JSON.stringify({
				format: "weave-reader-book/v1",
				version: 1,
				bookId,
				filePath: "Old/Imported.epub",
				title: "Imported",
				sourceFingerprint: "fingerprint-imported",
			}),
		);
		zip.file(
			"data/active-version.json",
			JSON.stringify({
				format: "weave-reader-active-annotation-version/v1",
				version: 1,
				bookId,
				activeVersionId: "default",
			}),
		);
		zip.file(
			"data/versions/default/annotations.json",
			JSON.stringify({
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId,
				annotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "important" }],
			}),
		);
		zip.file("data/annotations.md", "# stale generated note from another device");
		const packageBuffer = await zip.generateAsync({ type: "arraybuffer" });
		const { app, files, binaries } = createAppHarness({});

		const result = await importEpubAnnotatedBookPackage(app, packageBuffer, {
			defaultBookFolder: "Books",
		});

		expect(result.bookId).toBe(bookId);
		expect(result.bookPath).toBe("Books/Imported.epub");
		expect(result.importedAnnotationVersionCount).toBe(1);
		expect(result.importedAnnotationCount).toBe(1);
		expect(result.activeVersionId).toBe("default");
		expect(new TextDecoder().decode(binaries.get("Books/Imported.epub"))).toBe("imported-epub");
		expect(readJson(files, `weave/epub-data/books/${bookId}/book.json`)).toMatchObject({
			bookId,
			filePath: "Books/Imported.epub",
			sourceFingerprint: "fingerprint-imported",
		});
		expect(readJson(files, `weave/epub-data/books/${bookId}/versions/default/annotations.json`)).toMatchObject({
			annotations: [{ semanticId: "important" }],
		});
		expect(files.has(`weave/epub-data/books/${bookId}/annotations.md`)).toBe(false);
		expect(readJson(files, "weave/epub-data/index.json")).toMatchObject({
			books: {
				[bookId]: {
					bookId,
					filePath: "Books/Imported.epub",
					sourceFingerprint: "fingerprint-imported",
				},
			},
		});
	});

	it("imports annotations for an existing same-fingerprint book as a new version without clobbering current annotations", async () => {
		const localBookId = "epub-book-local";
		const remoteBookId = "epub-book-remote";
		const root = `weave/epub-data/books/${localBookId}`;
		const zip = new JSZip();
		zip.file(
			"manifest.json",
			JSON.stringify({
				format: "weave-reader-annotated-book-package/v1",
				version: 1,
				bookId: remoteBookId,
				bookFileName: "Demo.epub",
				exportedAt: 1,
				sourceFingerprint: "same-fingerprint",
				title: "Demo",
			}),
		);
		zip.file("book/Demo.epub", "remote-epub");
		zip.file(
			"data/book.json",
			JSON.stringify({
				format: "weave-reader-book/v1",
				version: 1,
				bookId: remoteBookId,
				filePath: "Remote/Demo.epub",
				title: "Demo",
				sourceFingerprint: "same-fingerprint",
			}),
		);
		zip.file(
			"data/active-version.json",
			JSON.stringify({
				format: "weave-reader-active-annotation-version/v1",
				version: 1,
				bookId: remoteBookId,
				activeVersionId: "default",
				updatedAt: 10,
			}),
		);
		zip.file(
			"data/versions/default/version.json",
			JSON.stringify({
				format: "weave-reader-annotation-version/v1",
				version: 1,
				bookId: remoteBookId,
				versionId: "default",
				name: "远端默认",
				createdAt: 10,
				updatedAt: 10,
			}),
		);
		zip.file(
			"data/versions/default/annotations.json",
			JSON.stringify({
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId: remoteBookId,
				updatedAt: 10,
				annotations: [{ cfiRange: "epubcfi(/6/4)", semanticId: "remote" }],
			}),
		);
		const packageBuffer = await zip.generateAsync({ type: "arraybuffer" });
		const { app, files } = createAppHarness({
			files: {
				"weave/epub-data/index.json": JSON.stringify({
					format: "weave-reader-epub-data-index/v1",
					version: 1,
					books: {
						[localBookId]: {
							bookId: localBookId,
							filePath: "Books/Demo.epub",
							sourceFingerprint: "same-fingerprint",
						},
					},
				}),
				[`${root}/active-version.json`]: JSON.stringify({
					format: "weave-reader-active-annotation-version/v1",
					version: 1,
					bookId: localBookId,
					activeVersionId: "default",
					updatedAt: 1,
				}),
				[`${root}/versions/default/annotations.json`]: JSON.stringify({
					format: "weave-reader-annotations/v1",
					version: 1,
					bookId: localBookId,
					updatedAt: 1,
					annotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "local" }],
				}),
			},
		});

		const result = await importEpubAnnotatedBookPackage(app, packageBuffer, {
			defaultBookFolder: "Books",
		});

		expect(result.bookId).toBe(localBookId);
		expect(result.matchedExistingBook).toBe(true);
		expect(result.importedAnnotationVersionCount).toBe(1);
		expect(result.importedAnnotationCount).toBe(1);
		expect(readJson(files, `${root}/active-version.json`)).toMatchObject({
			bookId: localBookId,
			activeVersionId: "default",
		});
		expect(readJson(files, `${root}/versions/default/annotations.json`)).toMatchObject({
			bookId: localBookId,
			annotations: [{ semanticId: "local" }],
		});
		expect(readJson(files, `${root}/versions/imported-default/annotations.json`)).toMatchObject({
			bookId: localBookId,
			annotations: [{ semanticId: "remote" }],
		});
		expect(files.has(`weave/epub-data/books/${remoteBookId}/book.json`)).toBe(false);
	});
});
