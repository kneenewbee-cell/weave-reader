import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { App } from "obsidian";
import {
	BOOK_PACKAGE_V2_FORMAT,
	importReadingPackage,
	writeReadingPackageManifest,
} from "../../reading-package";
import { resolvePdfPortableBookDataLocation } from "../../pdf/pdf-portable-data-location";

function createWritableMockApp(files: Map<string, string | Uint8Array>): App {
	const normalize = (path: string) => String(path || "").replace(/\\/g, "/");
	const listChildren = (path: string) => {
		const root = normalize(path).replace(/\/+$/g, "");
		const filesInDir: string[] = [];
		const folderSet = new Set<string>();
		for (const filePath of files.keys()) {
			if (!filePath.startsWith(`${root}/`)) {
				continue;
			}
			const rest = filePath.slice(root.length + 1);
			const [firstPart] = rest.split("/");
			if (!firstPart) {
				continue;
			}
			if (rest.includes("/")) {
				folderSet.add(`${root}/${firstPart}`);
			} else {
				filesInDir.push(filePath);
			}
		}
		return { files: filesInDir, folders: Array.from(folderSet) };
	};
	return {
		vault: {
			adapter: {
				exists: async (path: string) => files.has(normalize(path)),
				read: async (path: string) => String(files.get(normalize(path)) || ""),
				write: async (path: string, data: string) => {
					files.set(normalize(path), data);
				},
				writeBinary: async (path: string, data: ArrayBuffer) => {
					files.set(normalize(path), new Uint8Array(data));
				},
				mkdir: async () => undefined,
				list: async (path: string) => listChildren(path),
			},
		},
	} as unknown as App;
}

describe("reading package import", () => {
	it("imports EPUB AI reading note by keeping local sections and retargeting source file", async () => {
		const zip = new JSZip();
		writeReadingPackageManifest(zip, {
			format: BOOK_PACKAGE_V2_FORMAT,
			version: 2,
			bookFormat: "epub",
			bookId: "epub-book-old",
			bookPath: "Old/demo.epub",
			title: "Demo",
			includeBook: false,
			modules: {
				book: false,
				annotationSystem: true,
				ink: false,
				navigationState: true,
				aiReadingNote: true,
			},
			exportedAt: 1785950000000,
		});
		zip.file("data/annotations.json", "{\"bookId\":\"epub-book-old\",\"filePath\":\"Old/demo.epub\",\"annotations\":[]}");
		zip.file("data/bookmarks.json", "{\"bookId\":\"epub-book-old\",\"filePath\":\"Old/demo.epub\",\"bookmarks\":[]}");
		zip.file("data/reading-state.json", "{\"bookId\":\"epub-book-old\",\"filePath\":\"Old/demo.epub\",\"progress\":0.8}");
		zip.file("data/ai-reading/meta.json", JSON.stringify({ notePath: "AI阅读笔记/Demo - AI阅读.md" }));
		zip.file(
			"data/ai-reading/note.md",
			[
				'<div data-source-file="Old/demo.epub"></div>',
				'<!-- weave-epub-ai-reading:start key="k2" -->',
				"导入段落",
				'<!-- weave-epub-ai-reading:end key="k2" -->',
			].join("\n"),
		);
		const files = new Map<string, string | Uint8Array>([
			[
				"AI阅读笔记/Demo - AI阅读.md",
				[
					'<div data-source-file="Books/demo.epub"></div>',
					'<!-- weave-epub-ai-reading:start key="k1" -->',
					"本地段落",
					'<!-- weave-epub-ai-reading:end key="k1" -->',
				].join("\n"),
			],
			["weave/epub-data/books/epub-book-1/book.json", "{\"bookId\":\"epub-book-1\",\"filePath\":\"Books/demo.epub\"}"],
		]);

		const result = await importReadingPackage(
			createWritableMockApp(files),
			await zip.generateAsync({ type: "arraybuffer" }),
			{
				preferredBookId: "epub-book-1",
				targetBookPath: "Books/demo.epub",
			},
		);

		const note = String(files.get("AI阅读笔记/Demo - AI阅读.md") || "");
		const bookJson = String(files.get("weave/epub-data/books/epub-book-1/book.json") || "");

		expect(result.importedModules).toEqual(
			expect.arrayContaining(["annotationSystem", "navigationState", "aiReadingNote"]),
		);
		expect(note).toContain("本地段落");
		expect(note).toContain("导入段落");
		expect(note).toContain('data-source-file="Books/demo.epub"');
		expect(note).not.toContain("Old/demo.epub");
		expect(bookJson).toContain("aiReadingNote");
		expect(Array.from(files.keys()).some((path) => path.includes("/.backup/"))).toBe(true);
	});

	it("imports PDF annotations and ink without creating AI reading note", async () => {
		const zip = new JSZip();
		writeReadingPackageManifest(zip, {
			format: BOOK_PACKAGE_V2_FORMAT,
			version: 2,
			bookFormat: "pdf",
			bookId: "pdf-book-old",
			bookPath: "Old/demo.pdf",
			title: "Demo PDF",
			includeBook: false,
			modules: {
				book: false,
				annotationSystem: true,
				ink: true,
				navigationState: false,
				aiReadingNote: false,
			},
			exportedAt: 1785950000000,
		});
		zip.file(
			"data/annotations.json",
			JSON.stringify({
				format: "weave-reader-pdf-annotations/v1",
				bookId: "pdf-book-old",
				sourcePath: "Old/demo.pdf",
				pageCount: 2,
				annotations: [
					{
						id: "a1",
						pageNumber: 1,
						kind: "highlight",
						color: "#ffd54a",
						text: "alpha",
						rects: [],
						createdAt: 1,
					},
				],
			}),
		);
		zip.file("data/ink.json", "{\"sourcePath\":\"Old/demo.pdf\",\"strokes\":[{\"id\":\"s1\"}]}");
		const files = new Map<string, string | Uint8Array>();

		const result = await importReadingPackage(
			createWritableMockApp(files),
			await zip.generateAsync({ type: "arraybuffer" }),
			{ targetBookPath: "Books/demo.pdf" },
		);

		expect(result.bookFormat).toBe("pdf");
		expect(result.importedModules).toEqual(expect.arrayContaining(["annotationSystem", "ink"]));
		expect(Array.from(files.keys()).some((path) => path.endsWith("/annotations.json"))).toBe(true);
		expect(Array.from(files.keys()).some((path) => path.endsWith("/annotations.md"))).toBe(true);
		expect(Array.from(files.keys()).some((path) => path.includes("AI阅读笔记"))).toBe(false);
	});

	it("does not regenerate PDF annotation markdown when the package has no annotation payload", async () => {
		const zip = new JSZip();
		writeReadingPackageManifest(zip, {
			format: BOOK_PACKAGE_V2_FORMAT,
			version: 2,
			bookFormat: "pdf",
			bookId: "pdf-book-old",
			bookPath: "Old/demo.pdf",
			title: "Demo PDF",
			includeBook: false,
			modules: {
				book: false,
				annotationSystem: true,
				ink: false,
				navigationState: false,
				aiReadingNote: false,
			},
			exportedAt: 1785950000000,
		});
		const location = resolvePdfPortableBookDataLocation("Books/demo.pdf");
		const files = new Map<string, string | Uint8Array>([
			[
				location.annotationsPath,
				JSON.stringify({
					format: "weave-reader-pdf-annotations/v1",
					bookId: location.bookId,
					sourcePath: "Books/demo.pdf",
					pageCount: 1,
					annotations: [{ id: "local-a1", pageNumber: 1, text: "local" }],
				}),
			],
			[location.annotationsMarkdownPath, "# Existing local note"],
		]);

		const result = await importReadingPackage(
			createWritableMockApp(files),
			await zip.generateAsync({ type: "arraybuffer" }),
			{ targetBookPath: "Books/demo.pdf" },
		);

		expect(result.importedModules).not.toContain("annotationSystem");
		expect(result.backupPaths).toHaveLength(0);
		expect(files.get(location.annotationsMarkdownPath)).toBe("# Existing local note");
	});

	it("imports PDF reading data into the path-derived data directory when the preferred id is stale", async () => {
		const zip = new JSZip();
		writeReadingPackageManifest(zip, {
			format: BOOK_PACKAGE_V2_FORMAT,
			version: 2,
			bookFormat: "pdf",
			bookId: "pdf-book-old",
			bookPath: "Old/demo.pdf",
			title: "Demo PDF",
			includeBook: false,
			modules: {
				book: false,
				annotationSystem: false,
				ink: true,
				navigationState: false,
				aiReadingNote: false,
			},
			exportedAt: 1785950000000,
		});
		zip.file("data/ink.json", "{\"sourcePath\":\"Old/demo.pdf\",\"strokes\":[{\"id\":\"s1\"}]}");
		const location = resolvePdfPortableBookDataLocation("Books/demo.pdf");
		const staleInkPath = "weave/pdf-data/books/epub-book-stale/ink.json";
		const files = new Map<string, string | Uint8Array>();

		const result = await importReadingPackage(
			createWritableMockApp(files),
			await zip.generateAsync({ type: "arraybuffer" }),
			{
				preferredBookId: "epub-book-stale",
				targetBookPath: "Books/demo.pdf",
			},
		);

		expect(result.bookId).toBe(location.bookId);
		expect(files.has(location.inkPath)).toBe(true);
		expect(files.has(staleInkPath)).toBe(false);
		expect(String(files.get(location.inkPath))).toContain("s1");
	});

	it("merges PDF ink strokes by keeping identical strokes once and preserving conflicting strokes", async () => {
		const zip = new JSZip();
		writeReadingPackageManifest(zip, {
			format: BOOK_PACKAGE_V2_FORMAT,
			version: 2,
			bookFormat: "pdf",
			bookId: "pdf-book-old",
			bookPath: "Old/demo.pdf",
			title: "Demo PDF",
			includeBook: false,
			modules: {
				book: false,
				annotationSystem: false,
				ink: true,
				navigationState: false,
				aiReadingNote: false,
			},
			exportedAt: 1785950000000,
		});
		const duplicateStroke = {
			id: "duplicate",
			pageNumber: 1,
			tool: "pen",
			color: "#111111",
			width: 2,
			points: [{ x: 0.1, y: 0.1, t: 1 }],
		};
		const localConflictStroke = {
			id: "conflict",
			pageNumber: 1,
			tool: "pen",
			color: "#222222",
			width: 2,
			points: [{ x: 0.2, y: 0.2, t: 2 }],
		};
		const importedConflictStroke = {
			id: "conflict",
			pageNumber: 1,
			tool: "pen",
			color: "#ff0000",
			width: 3,
			points: [{ x: 0.3, y: 0.3, t: 3 }],
		};
		zip.file(
			"data/ink.json",
			JSON.stringify({
				version: 1,
				sourcePath: "Old/demo.pdf",
				pageCount: 2,
				updatedAt: 2,
				strokes: [
					duplicateStroke,
					importedConflictStroke,
					{
						id: "imported-only",
						pageNumber: 2,
						tool: "highlighter",
						color: "#ffff00",
						width: 8,
						points: [{ x: 0.4, y: 0.4, t: 4 }],
					},
				],
			}),
		);
		const inkPath = resolvePdfPortableBookDataLocation("Books/demo.pdf").inkPath;
		const files = new Map<string, string | Uint8Array>([
			[
				inkPath,
				JSON.stringify({
					version: 1,
					sourcePath: "Books/demo.pdf",
					pageCount: 2,
					updatedAt: 1,
					strokes: [
						{
							id: "local-only",
							pageNumber: 1,
							tool: "pen",
							color: "#000000",
							width: 1,
							points: [{ x: 0, y: 0, t: 0 }],
						},
						duplicateStroke,
						localConflictStroke,
					],
				}),
			],
		]);

		const result = await importReadingPackage(
			createWritableMockApp(files),
			await zip.generateAsync({ type: "arraybuffer" }),
			{ targetBookPath: "Books/demo.pdf" },
		);

		const mergedInk = JSON.parse(String(files.get(inkPath) || "{}")) as {
			sourcePath?: string;
			strokes?: Array<Record<string, unknown>>;
		};
		const strokes = mergedInk.strokes || [];
		const conflictCopies = strokes.filter((stroke) => stroke.color === "#ff0000");

		expect(result.importedModules).toEqual(expect.arrayContaining(["ink"]));
		expect(mergedInk.sourcePath).toBe("Books/demo.pdf");
		expect(strokes).toHaveLength(5);
		expect(strokes.map((stroke) => stroke.id)).toEqual(
			expect.arrayContaining(["local-only", "duplicate", "conflict", "imported-only"]),
		);
		expect(strokes.filter((stroke) => stroke.id === "duplicate")).toHaveLength(1);
		expect(strokes.find((stroke) => stroke.id === "conflict")).toMatchObject({
			color: "#222222",
		});
		expect(conflictCopies).toHaveLength(1);
		expect(conflictCopies[0].id).not.toBe("conflict");
		expect(Array.from(files.keys()).some((path) => path.includes("/.backup/"))).toBe(true);
	});

	it("rejects a targetless data-only package when the original book is unavailable", async () => {
		const zip = new JSZip();
		writeReadingPackageManifest(zip, {
			format: BOOK_PACKAGE_V2_FORMAT,
			version: 2,
			bookFormat: "epub",
			bookId: "epub-book-old",
			bookPath: "Missing/demo.epub",
			title: "Demo",
			includeBook: false,
			modules: {
				book: false,
				annotationSystem: true,
				ink: false,
				navigationState: false,
				aiReadingNote: false,
			},
			exportedAt: 1785950000000,
		});
		zip.file("data/annotations.json", "{\"bookId\":\"epub-book-old\",\"filePath\":\"Missing/demo.epub\",\"annotations\":[]}");
		const files = new Map<string, string | Uint8Array>();

		await expect(
			importReadingPackage(
				createWritableMockApp(files),
				await zip.generateAsync({ type: "arraybuffer" }),
				{ defaultBookFolder: "Books" },
			),
		).rejects.toThrow("reading-package-target-book-required");
		expect(files.size).toBe(0);
	});

	it("imports a targetless data-only EPUB package into an existing book matched by fingerprint", async () => {
		const zip = new JSZip();
		writeReadingPackageManifest(zip, {
			format: BOOK_PACKAGE_V2_FORMAT,
			version: 2,
			bookFormat: "epub",
			bookId: "epub-book-old",
			bookPath: "Old/demo.epub",
			title: "Demo",
			includeBook: false,
			modules: {
				book: false,
				annotationSystem: true,
				ink: false,
				navigationState: false,
				aiReadingNote: false,
			},
			contentFingerprint: "content-demo",
			exportedAt: 1785950000000,
		});
		zip.file("data/annotations.json", "{\"bookId\":\"epub-book-old\",\"filePath\":\"Old/demo.epub\",\"annotations\":[]}");
		const files = new Map<string, string | Uint8Array>([
			[
				"weave/epub-data/index.json",
				JSON.stringify({
					format: "weave-reader-epub-data-index/v1",
					version: 1,
					books: {
						"epub-book-current": {
							bookId: "epub-book-current",
							filePath: "Books/current.epub",
							contentFingerprint: "content-demo",
						},
					},
				}),
			],
		]);

		const result = await importReadingPackage(
			createWritableMockApp(files),
			await zip.generateAsync({ type: "arraybuffer" }),
			{ defaultBookFolder: "Books" },
		);

		const annotations = JSON.parse(
			String(files.get("weave/epub-data/books/epub-book-current/annotations.json") || "{}"),
		) as Record<string, unknown>;

		expect(result.bookId).toBe("epub-book-current");
		expect(result.bookPath).toBe("Books/current.epub");
		expect(result.importMode).toBe("fingerprintMatch");
		expect(result.importedModules).toEqual(expect.arrayContaining(["annotationSystem"]));
		expect(annotations.bookId).toBe("epub-book-current");
		expect(annotations.filePath).toBe("Books/current.epub");
		expect(files.has("Books/demo.epub")).toBe(false);
	});

	it("imports EPUB annotation versions as separate versions when the matched book already has annotations", async () => {
		const zip = new JSZip();
		writeReadingPackageManifest(zip, {
			format: BOOK_PACKAGE_V2_FORMAT,
			version: 2,
			bookFormat: "epub",
			bookId: "epub-book-remote",
			bookPath: "Remote/demo.epub",
			title: "Demo",
			includeBook: false,
			modules: {
				book: false,
				annotationSystem: true,
				ink: false,
				navigationState: false,
				aiReadingNote: false,
			},
			sourceFingerprint: "same-fingerprint",
			exportedAt: 1785950000000,
		});
		zip.file(
			"data/active-version.json",
			JSON.stringify({
				format: "weave-reader-active-annotation-version/v1",
				version: 1,
				bookId: "epub-book-remote",
				activeVersionId: "default",
				updatedAt: 10,
			}),
		);
		zip.file(
			"data/versions/default/version.json",
			JSON.stringify({
				format: "weave-reader-annotation-version/v1",
				version: 1,
				bookId: "epub-book-remote",
				versionId: "default",
				name: "Default",
				createdAt: 10,
				updatedAt: 10,
			}),
		);
		zip.file(
			"data/versions/default/annotations.json",
			JSON.stringify({
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId: "epub-book-remote",
				updatedAt: 10,
				annotations: [{ semanticId: "remote" }],
			}),
		);
		zip.file(
			"data/versions/default/semantic-profile.json",
			JSON.stringify({
				format: "weave-reader-semantic-profile/v1",
				version: 1,
				scope: "version",
				bookId: "epub-book-remote",
				versionId: "default",
				sourceVersionId: "default",
				semantics: [{ id: "remote", label: "Remote" }],
			}),
		);
		const root = "weave/epub-data/books/epub-book-local";
		const files = new Map<string, string | Uint8Array>([
			[
				"weave/epub-data/index.json",
				JSON.stringify({
					format: "weave-reader-epub-data-index/v1",
					version: 1,
					books: {
						"epub-book-local": {
							bookId: "epub-book-local",
							filePath: "Books/demo.epub",
							sourceFingerprint: "same-fingerprint",
						},
					},
				}),
			],
			[
				`${root}/active-version.json`,
				JSON.stringify({
					format: "weave-reader-active-annotation-version/v1",
					version: 1,
					bookId: "epub-book-local",
					activeVersionId: "default",
					updatedAt: 1,
				}),
			],
			[
				`${root}/versions/default/annotations.json`,
				JSON.stringify({
					format: "weave-reader-annotations/v1",
					version: 1,
					bookId: "epub-book-local",
					updatedAt: 1,
					annotations: [{ semanticId: "local" }],
				}),
			],
		]);

		const result = await importReadingPackage(
			createWritableMockApp(files),
			await zip.generateAsync({ type: "arraybuffer" }),
			{ defaultBookFolder: "Books" },
		);

		expect(result.bookId).toBe("epub-book-local");
		expect(result.importMode).toBe("fingerprintMatch");
		expect(JSON.parse(String(files.get(`${root}/active-version.json`) || "{}"))).toMatchObject({
			bookId: "epub-book-local",
			activeVersionId: "default",
		});
		expect(JSON.parse(String(files.get(`${root}/versions/default/annotations.json`) || "{}"))).toMatchObject({
			bookId: "epub-book-local",
			annotations: [{ semanticId: "local" }],
		});
		expect(JSON.parse(String(files.get(`${root}/versions/imported-default/annotations.json`) || "{}"))).toMatchObject({
			bookId: "epub-book-local",
			annotations: [{ semanticId: "remote" }],
		});
		expect(JSON.parse(String(files.get(`${root}/versions/imported-default/semantic-profile.json`) || "{}"))).toMatchObject({
			bookId: "epub-book-local",
			versionId: "imported-default",
			sourceVersionId: "imported-default",
		});
	});

	it("imports a targetless EPUB package by writing its embedded original book", async () => {
		const zip = new JSZip();
		writeReadingPackageManifest(zip, {
			format: BOOK_PACKAGE_V2_FORMAT,
			version: 2,
			bookFormat: "epub",
			bookId: "epub-book-old",
			bookPath: "Old/demo.epub",
			bookFileName: "demo.epub",
			title: "Demo",
			includeBook: true,
			modules: {
				book: true,
				annotationSystem: true,
				ink: false,
				navigationState: false,
				aiReadingNote: false,
			},
			exportedAt: 1785950000000,
		});
		zip.file("book/demo.epub", new Uint8Array([1, 2, 3]));
		zip.file("data/annotations.json", "{\"bookId\":\"epub-book-old\",\"filePath\":\"Old/demo.epub\",\"annotations\":[]}");
		const files = new Map<string, string | Uint8Array>();

		const result = await importReadingPackage(
			createWritableMockApp(files),
			await zip.generateAsync({ type: "arraybuffer" }),
			{ defaultBookFolder: "Books" },
		);

		const annotationsPath = Array.from(files.keys()).find((path) => path.endsWith("/annotations.json")) || "";
		const annotations = JSON.parse(String(files.get(annotationsPath) || "{}")) as Record<string, unknown>;

		expect(result.bookPath).toBe("Books/demo.epub");
		expect(result.bookTitle).toBe("Demo");
		expect(result.sourceBookPath).toBe("Old/demo.epub");
		expect(result.importMode).toBe("embeddedBook");
		expect(result.importedModules).toEqual(expect.arrayContaining(["book", "annotationSystem"]));
		expect(files.get("Books/demo.epub")).toBeInstanceOf(Uint8Array);
		expect(annotations.filePath).toBe("Books/demo.epub");
	});

	it("treats a root target path as missing and imports the embedded EPUB book instead", async () => {
		const zip = new JSZip();
		writeReadingPackageManifest(zip, {
			format: BOOK_PACKAGE_V2_FORMAT,
			version: 2,
			bookFormat: "epub",
			bookId: "epub-book-old",
			bookPath: "Old/demo.epub",
			bookFileName: "demo.epub",
			title: "Demo",
			includeBook: true,
			modules: {
				book: true,
				annotationSystem: true,
				ink: false,
				navigationState: false,
				aiReadingNote: false,
			},
			exportedAt: 1785950000000,
		});
		zip.file("book/demo.epub", new Uint8Array([1, 2, 3]));
		zip.file("data/annotations.json", "{\"bookId\":\"epub-book-old\",\"filePath\":\"Old/demo.epub\",\"annotations\":[]}");
		const files = new Map<string, string | Uint8Array>();

		const result = await importReadingPackage(
			createWritableMockApp(files),
			await zip.generateAsync({ type: "arraybuffer" }),
			{ defaultBookFolder: "Books", targetBookPath: "/" },
		);

		expect(result.bookPath).toBe("Books/demo.epub");
		expect(result.importMode).toBe("embeddedBook");
		expect(result.importedModules).toEqual(expect.arrayContaining(["book", "annotationSystem"]));
		expect(files.get("Books/demo.epub")).toBeInstanceOf(Uint8Array);
	});

	it("rejects a data-only package when the target path is root", async () => {
		const zip = new JSZip();
		writeReadingPackageManifest(zip, {
			format: BOOK_PACKAGE_V2_FORMAT,
			version: 2,
			bookFormat: "epub",
			bookId: "epub-book-old",
			bookPath: "Missing/demo.epub",
			title: "Demo",
			includeBook: false,
			modules: {
				book: false,
				annotationSystem: true,
				ink: false,
				navigationState: false,
				aiReadingNote: false,
			},
			exportedAt: 1785950000000,
		});
		zip.file("data/annotations.json", "{\"bookId\":\"epub-book-old\",\"filePath\":\"Missing/demo.epub\",\"annotations\":[]}");
		const files = new Map<string, string | Uint8Array>();

		await expect(
			importReadingPackage(
				createWritableMockApp(files),
				await zip.generateAsync({ type: "arraybuffer" }),
				{ defaultBookFolder: "Books", targetBookPath: "/" },
			),
		).rejects.toThrow("reading-package-target-book-required");
		expect(files.size).toBe(0);
	});

	it("imports a targetless PDF package by writing its embedded original book", async () => {
		const zip = new JSZip();
		writeReadingPackageManifest(zip, {
			format: BOOK_PACKAGE_V2_FORMAT,
			version: 2,
			bookFormat: "pdf",
			bookId: "pdf-book-old",
			bookPath: "Old/demo.pdf",
			bookFileName: "demo.pdf",
			title: "Demo PDF",
			includeBook: true,
			modules: {
				book: true,
				annotationSystem: true,
				ink: true,
				navigationState: false,
				aiReadingNote: false,
			},
			exportedAt: 1785950000000,
		});
		zip.file("book/demo.pdf", new Uint8Array([4, 5, 6]));
		zip.file(
			"data/annotations.json",
			JSON.stringify({
				format: "weave-reader-pdf-annotations/v1",
				bookId: "pdf-book-old",
				sourcePath: "Old/demo.pdf",
				pageCount: 1,
				annotations: [],
			}),
		);
		zip.file("data/ink.json", "{\"sourcePath\":\"Old/demo.pdf\",\"strokes\":[]}");
		const files = new Map<string, string | Uint8Array>();

		const result = await importReadingPackage(
			createWritableMockApp(files),
			await zip.generateAsync({ type: "arraybuffer" }),
			{ defaultBookFolder: "Books" },
		);

		const annotationsPath = Array.from(files.keys()).find((path) => path.endsWith("/annotations.json")) || "";
		const annotations = JSON.parse(String(files.get(annotationsPath) || "{}")) as Record<string, unknown>;

		expect(result.bookPath).toBe("Books/demo.pdf");
		expect(result.bookTitle).toBe("Demo PDF");
		expect(result.sourceBookPath).toBe("Old/demo.pdf");
		expect(result.importMode).toBe("embeddedBook");
		expect(result.importedModules).toEqual(expect.arrayContaining(["book", "annotationSystem", "ink"]));
		expect(files.get("Books/demo.pdf")).toBeInstanceOf(Uint8Array);
		expect(annotations.sourcePath).toBe("Books/demo.pdf");
	});
});
