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
import { computeAvailableEpubFingerprints } from "../epub-fingerprints";

function normalizePath(value: string): string {
	return String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function toArrayBuffer(value: string): ArrayBuffer {
	return new TextEncoder().encode(value).buffer;
}

async function createValidEpubBinary(options: {
	title?: string;
	chapterHtml?: string;
	styleCss?: string;
} = {}): Promise<ArrayBuffer> {
	const zip = new JSZip();
	zip.file(
		"META-INF/container.xml",
		`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
	);
	zip.file(
		"OPS/content.opf",
		`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${options.title || "Demo"}</dc:title>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
	);
	zip.file(
		"OPS/chapter.xhtml",
		options.chapterHtml ||
			`<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hello world.</p></body></html>`,
	);
	zip.file("OPS/style.css", options.styleCss || "body { color: black; }");
	return zip.generateAsync({ type: "arraybuffer" });
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
		await expect(zip.file("data/book.json")?.async("string")).resolves.toContain("weave-reader-book/v1");
		await expect(zip.file("data/versions/default/annotations.json")?.async("string")).resolves.toContain("important");
		expect(result.fileName).toMatch(/^Demo.*\.zip$/);
	});

	it("exports a version semantic profile when only the active root mirror exists", async () => {
		const bookId = "epub-book-semantic-export";
		const root = `weave/epub-data/books/${bookId}`;
		const { app } = createAppHarness({
			binaries: {
				"Books/Semantic.epub": toArrayBuffer("semantic-export-epub"),
			},
			files: {
				[`${root}/book.json`]: JSON.stringify({
					format: "weave-reader-book/v1",
					version: 1,
					bookId,
					filePath: "Books/Semantic.epub",
					title: "Semantic Export",
				}),
				[`${root}/active-version.json`]: JSON.stringify({
					format: "weave-reader-active-annotation-version/v1",
					version: 1,
					bookId,
					activeVersionId: "default",
					updatedAt: 10,
				}),
				[`${root}/semantic-profile.json`]: JSON.stringify({
					format: "weave-reader-semantic-profile/v1",
					version: 1,
					scope: "book",
					bookId,
					sourceVersionId: "default",
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
				}),
				[`${root}/versions/default/annotations.json`]: JSON.stringify({
					format: "weave-reader-annotations/v1",
					version: 1,
					bookId,
					updatedAt: 10,
					annotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "important" }],
				}),
			},
		});

		const result = await createEpubAnnotatedBookPackage(app, {
			bookId,
			filePath: "Books/Semantic.epub",
		});

		const zip = await JSZip.loadAsync(result.arrayBuffer);
		const profile = JSON.parse(
			(await zip.file("data/versions/default/semantic-profile.json")?.async("string")) || "{}",
		);
		expect(profile).toMatchObject({
			format: "weave-reader-semantic-profile/v1",
			scope: "version",
			bookId,
			versionId: "default",
			semanticSchemeId: "custom",
			semantics: [expect.objectContaining({ id: "important", color: "purple", style: "underline" })],
		});
	});

	it("exports an effective global semantic profile for a version without a saved profile", async () => {
		const bookId = "epub-book-global-semantic-export";
		const root = `weave/epub-data/books/${bookId}`;
		const { app } = createAppHarness({
			binaries: {
				"Books/GlobalSemantic.epub": toArrayBuffer("global-semantic-export-epub"),
			},
			files: {
				"weave/epub-data/semantic-profiles/default.json": JSON.stringify({
					format: "weave-reader-semantic-profile/v1",
					version: 1,
					scope: "global",
					annotationSemanticsEnabled: true,
					semanticSchemeId: "custom",
					semantics: [
						{
							id: "global-note",
							label: "Global Note",
							color: "cyan",
							style: "underline",
							group: "study",
							source: "custom",
							active: true,
						},
					],
					standardSemanticIds: ["global-note"],
				}),
				[`${root}/book.json`]: JSON.stringify({
					format: "weave-reader-book/v1",
					version: 1,
					bookId,
					filePath: "Books/GlobalSemantic.epub",
					title: "Global Semantic Export",
				}),
				[`${root}/active-version.json`]: JSON.stringify({
					format: "weave-reader-active-annotation-version/v1",
					version: 1,
					bookId,
					activeVersionId: "default",
					updatedAt: 10,
				}),
				[`${root}/versions/default/annotations.json`]: JSON.stringify({
					format: "weave-reader-annotations/v1",
					version: 1,
					bookId,
					updatedAt: 10,
					annotations: [{ cfiRange: "epubcfi(/6/2)", semanticId: "global-note" }],
				}),
			},
		});

		const result = await createEpubAnnotatedBookPackage(app, {
			bookId,
			filePath: "Books/GlobalSemantic.epub",
		});

		const zip = await JSZip.loadAsync(result.arrayBuffer);
		const profile = JSON.parse(
			(await zip.file("data/versions/default/semantic-profile.json")?.async("string")) || "{}",
		);
		expect(profile).toMatchObject({
			format: "weave-reader-semantic-profile/v1",
			scope: "version",
			bookId,
			versionId: "default",
			semanticSchemeId: "custom",
			semantics: [expect.objectContaining({ id: "global-note", color: "cyan", style: "underline" })],
		});
	});

	it("preserves the EPUB extension when exporting a package for a long book filename", async () => {
		const bookId = "epub-book-long-export";
		const longBookFileName = `${"Long Practical LaTeX Cookbook ".repeat(8)}Second Edition.epub`;
		const root = `weave/epub-data/books/${bookId}`;
		const { app } = createAppHarness({
			binaries: {
				[longBookFileName]: toArrayBuffer("long-export-epub"),
			},
			files: {
				[`${root}/book.json`]: JSON.stringify({
					format: "weave-reader-book/v1",
					version: 1,
					bookId,
					filePath: longBookFileName,
					title: "Long Export",
				}),
			},
		});

		const result = await createEpubAnnotatedBookPackage(app, {
			bookId,
			filePath: longBookFileName,
		});
		const zip = await JSZip.loadAsync(result.arrayBuffer);
		const bookEntryName = Object.keys(zip.files).find((path) => normalizePath(path).startsWith("book/"));
		const manifest = JSON.parse((await zip.file("manifest.json")?.async("string")) || "{}");

		expect(bookEntryName).toMatch(/\.epub$/);
		expect(manifest.bookFileName).toMatch(/\.epub$/);
		await expect(zip.file(bookEntryName || "")?.async("string")).resolves.toBe("long-export-epub");
	});

	it("exports computed file, package, and content fingerprints into the package manifest and book metadata", async () => {
		const bookId = "epub-book-fingerprinted";
		const root = `weave/epub-data/books/${bookId}`;
		const epubBinary = await createValidEpubBinary();
		const { app } = createAppHarness({
			binaries: {
				"Books/Fingerprinted.epub": epubBinary,
			},
			files: {
				[`${root}/book.json`]: JSON.stringify({
					format: "weave-reader-book/v1",
					version: 1,
					bookId,
					filePath: "Books/Fingerprinted.epub",
					title: "Fingerprinted",
					sourceFingerprint: "legacy-fingerprint",
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
					annotations: [],
				}),
			},
		});

		const result = await createEpubAnnotatedBookPackage(app, {
			bookId,
			filePath: "Books/Fingerprinted.epub",
		});

		const zip = await JSZip.loadAsync(result.arrayBuffer);
		const manifest = JSON.parse((await zip.file("manifest.json")?.async("string")) || "{}");
		const bookJson = JSON.parse((await zip.file("data/book.json")?.async("string")) || "{}");

		expect(manifest.fileFingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(manifest.packageFingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(manifest.contentFingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(manifest.sourceFingerprint).toBe(manifest.fileFingerprint);
		expect(bookJson).toMatchObject({
			sourceFingerprint: manifest.fileFingerprint,
			fileFingerprint: manifest.fileFingerprint,
			packageFingerprint: manifest.packageFingerprint,
			contentFingerprint: manifest.contentFingerprint,
		});
	});

	it("can export an annotations-only package without embedding the EPUB file", async () => {
		const bookId = "epub-book-annotations-only";
		const root = `weave/epub-data/books/${bookId}`;
		const epubBinary = await createValidEpubBinary();
		const { app } = createAppHarness({
			binaries: {
				"Books/AnnotationsOnly.epub": epubBinary,
			},
			files: {
				[`${root}/book.json`]: JSON.stringify({
					format: "weave-reader-book/v1",
					version: 1,
					bookId,
					filePath: "Books/AnnotationsOnly.epub",
					title: "Annotations Only",
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
					annotations: [{ semanticId: "note" }],
				}),
			},
		});

		const result = await createEpubAnnotatedBookPackage(app, {
			bookId,
			filePath: "Books/AnnotationsOnly.epub",
			includeBook: false,
		});

		const zip = await JSZip.loadAsync(result.arrayBuffer);
		const manifest = JSON.parse((await zip.file("manifest.json")?.async("string")) || "{}");

		expect(Object.keys(zip.files).some((path) => normalizePath(path).startsWith("book/"))).toBe(false);
		expect(manifest.fileFingerprint).toMatch(/^[a-f0-9]{64}$/);
		await expect(zip.file("data/versions/default/annotations.json")?.async("string")).resolves.toContain("note");
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

	it("imports an embedded book package into the vault root by default and preserves the extension", async () => {
		const bookId = "epub-book-root-import";
		const longBookFileName = `${"Long Practical LaTeX Cookbook ".repeat(8)}Second Edition.epub`;
		const zip = new JSZip();
		zip.file(
			"manifest.json",
			JSON.stringify({
				format: "weave-reader-annotated-book-package/v1",
				version: 1,
				bookId,
				bookFileName: longBookFileName,
				exportedAt: 1,
				fileFingerprint: "root-import-file",
			}),
		);
		zip.file(`book/${longBookFileName}`, "root-import-epub");
		zip.file(
			"data/book.json",
			JSON.stringify({
				format: "weave-reader-book/v1",
				version: 1,
				bookId,
				filePath: `Books/${longBookFileName}`,
				title: "Root Import",
				fileFingerprint: "root-import-file",
			}),
		);
		const packageBuffer = await zip.generateAsync({ type: "arraybuffer" });
		const { app, files, binaries } = createAppHarness({});

		const result = await importEpubAnnotatedBookPackage(app, packageBuffer, {
			requireBook: true,
		});

		expect(result.bookPath).not.toMatch(/^Books\//);
		expect(result.bookPath).toMatch(/\.epub$/);
		expect(result.bookPath).not.toContain("/");
		expect(new TextDecoder().decode(binaries.get(result.bookPath))).toBe("root-import-epub");
		expect(readJson(files, `weave/epub-data/books/${bookId}/book.json`)).toMatchObject({
			bookId,
			filePath: result.bookPath,
		});
		expect(readJson(files, "weave/epub-data/index.json").books[bookId]).toMatchObject({
			bookId,
			filePath: result.bookPath,
		});
	});

	it("infers the embedded book extension from manifest paths when the zip entry name was truncated", async () => {
		const bookId = "epub-book-truncated-entry";
		const truncatedBookFileName = "LaTeX Cookbook _ Over 100 Practical, Ready-to-use LaTeX -- Packt Pub";
		const originalBookPath = `${truncatedBookFileName}lishing Limited.epub`;
		const zip = new JSZip();
		zip.file(
			"manifest.json",
			JSON.stringify({
				format: "weave-reader-annotated-book-package/v1",
				version: 1,
				bookId,
				bookFileName: truncatedBookFileName,
				bookPath: originalBookPath,
				exportedAt: 1,
				fileFingerprint: "truncated-entry-file",
			}),
		);
		zip.file(`book/${truncatedBookFileName}`, "truncated-entry-epub");
		zip.file(
			"data/book.json",
			JSON.stringify({
				format: "weave-reader-book/v1",
				version: 1,
				bookId,
				filePath: originalBookPath,
				title: "Truncated Entry",
				fileFingerprint: "truncated-entry-file",
			}),
		);
		const packageBuffer = await zip.generateAsync({ type: "arraybuffer" });
		const { app, files, binaries } = createAppHarness({});

		const result = await importEpubAnnotatedBookPackage(app, packageBuffer, {
			requireBook: true,
		});

		expect(result.bookPath).toBe(`${truncatedBookFileName}.epub`);
		expect(new TextDecoder().decode(binaries.get(result.bookPath))).toBe("truncated-entry-epub");
		expect(readJson(files, `weave/epub-data/books/${bookId}/book.json`)).toMatchObject({
			bookId,
			filePath: result.bookPath,
		});
	});

	it("replaces a stale extensionless Books path when importing an embedded book package", async () => {
		const bookId = "epub-book-stale-path";
		const badPath = "Books/Long Practical LaTeX Cookbook Without Extension";
		const longBookFileName = `${"Long Practical LaTeX Cookbook ".repeat(8)}Second Edition.epub`;
		const zip = new JSZip();
		zip.file(
			"manifest.json",
			JSON.stringify({
				format: "weave-reader-annotated-book-package/v1",
				version: 1,
				bookId,
				bookFileName: longBookFileName,
				exportedAt: 1,
				fileFingerprint: "same-stale-file",
			}),
		);
		zip.file(`book/${longBookFileName}`, "stale-path-epub");
		zip.file(
			"data/book.json",
			JSON.stringify({
				format: "weave-reader-book/v1",
				version: 1,
				bookId,
				filePath: badPath,
				title: "Stale Path",
				fileFingerprint: "same-stale-file",
			}),
		);
		const packageBuffer = await zip.generateAsync({ type: "arraybuffer" });
		const { app, files, binaries } = createAppHarness({
			files: {
				"weave/epub-data/index.json": JSON.stringify({
					format: "weave-reader-epub-data-index/v1",
					version: 1,
					books: {
						[bookId]: {
							bookId,
							filePath: badPath,
							knownPaths: [badPath],
							fileFingerprint: "same-stale-file",
						},
					},
				}),
			},
		});

		const result = await importEpubAnnotatedBookPackage(app, packageBuffer, {
			requireBook: true,
		});

		expect(result.bookId).toBe(bookId);
		expect(result.matchedExistingBook).toBe(true);
		expect(result.bookPath).not.toBe(badPath);
		expect(result.bookPath).not.toMatch(/^Books\//);
		expect(result.bookPath).toMatch(/\.epub$/);
		expect(new TextDecoder().decode(binaries.get(result.bookPath))).toBe("stale-path-epub");
		expect(readJson(files, `weave/epub-data/books/${bookId}/book.json`)).toMatchObject({
			bookId,
			filePath: result.bookPath,
		});
		expect(readJson(files, "weave/epub-data/index.json").books[bookId]).toMatchObject({
			bookId,
			filePath: result.bookPath,
		});
	});

	it("rejects a package without an embedded EPUB when a book file is required", async () => {
		const bookId = "epub-book-annotations-only-import";
		const zip = new JSZip();
		zip.file(
			"manifest.json",
			JSON.stringify({
				format: "weave-reader-annotated-book-package/v1",
				version: 1,
				bookId,
				bookFileName: "AnnotationsOnly.epub",
				exportedAt: 1,
			}),
		);
		zip.file(
			"data/versions/default/annotations.json",
			JSON.stringify({
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId,
				annotations: [{ semanticId: "note" }],
			}),
		);
		const packageBuffer = await zip.generateAsync({ type: "arraybuffer" });
		const { app } = createAppHarness({});

		await expect(
			importEpubAnnotatedBookPackage(app, packageBuffer, {
				defaultBookFolder: "Books",
				requireBook: true,
			}),
		).rejects.toThrow("missing-book-in-weave-reader-package");
	});

	it("matches an existing book by package fingerprint after file fingerprint misses", async () => {
		const localBookId = "epub-book-local";
		const importedBookId = "epub-book-imported";
		const zip = new JSZip();
		zip.file(
			"manifest.json",
			JSON.stringify({
				format: "weave-reader-annotated-book-package/v1",
				version: 1,
				bookId: importedBookId,
				bookFileName: "Imported.epub",
				exportedAt: 1,
				sourceFingerprint: "remote-file",
				fileFingerprint: "remote-file",
				packageFingerprint: "same-package",
				contentFingerprint: "same-content",
				title: "Imported",
			}),
		);
		zip.file("book/Imported.epub", "imported-epub");
		zip.file(
			"data/book.json",
			JSON.stringify({
				format: "weave-reader-book/v1",
				version: 1,
				bookId: importedBookId,
				filePath: "Remote/Imported.epub",
				title: "Imported",
				sourceFingerprint: "remote-file-from-book",
				fileFingerprint: "remote-file-from-book",
				packageFingerprint: "same-package",
				contentFingerprint: "same-content",
			}),
		);
		zip.file(
			"data/active-version.json",
			JSON.stringify({
				format: "weave-reader-active-annotation-version/v1",
				version: 1,
				bookId: importedBookId,
				activeVersionId: "default",
			}),
		);
		zip.file(
			"data/versions/default/annotations.json",
			JSON.stringify({
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId: importedBookId,
				annotations: [{ semanticId: "imported" }],
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
							filePath: "Books/Local.epub",
							sourceFingerprint: "local-file",
							fileFingerprint: "local-file",
							packageFingerprint: "same-package",
							contentFingerprint: "same-content",
						},
					},
				}),
			},
		});

		const result = await importEpubAnnotatedBookPackage(app, packageBuffer, {
			defaultBookFolder: "Books",
		});

		expect(result.bookId).toBe(localBookId);
		expect(result.matchedExistingBook).toBe(true);
		expect(readJson(files, `weave/epub-data/books/${localBookId}/book.json`)).toMatchObject({
			bookId: localBookId,
			filePath: "Books/Local.epub",
			sourceFingerprint: "local-file",
			fileFingerprint: "local-file",
			packageFingerprint: "same-package",
			contentFingerprint: "same-content",
		});
		expect(readJson(files, "weave/epub-data/index.json")).toMatchObject({
			books: {
				[localBookId]: {
					bookId: localBookId,
					sourceFingerprint: "local-file",
					fileFingerprint: "local-file",
					packageFingerprint: "same-package",
					contentFingerprint: "same-content",
				},
			},
		});
		expect(files.has(`weave/epub-data/books/${importedBookId}/book.json`)).toBe(false);
	});

	it("uses global file fingerprint matches before package fingerprint matches", async () => {
		const packageBookId = "epub-book-package-match";
		const fileBookId = "epub-book-file-match";
		const importedBookId = "epub-book-imported";
		const zip = new JSZip();
		zip.file(
			"manifest.json",
			JSON.stringify({
				format: "weave-reader-annotated-book-package/v1",
				version: 1,
				bookId: importedBookId,
				bookFileName: "Imported.epub",
				exportedAt: 1,
				fileFingerprint: "same-file",
				packageFingerprint: "same-package",
				contentFingerprint: "same-content",
			}),
		);
		zip.file("book/Imported.epub", "imported-epub");
		zip.file(
			"data/book.json",
			JSON.stringify({
				format: "weave-reader-book/v1",
				version: 1,
				bookId: importedBookId,
				filePath: "Remote/Imported.epub",
				title: "Imported",
				fileFingerprint: "same-file",
				packageFingerprint: "same-package",
				contentFingerprint: "same-content",
			}),
		);
		zip.file(
			"data/active-version.json",
			JSON.stringify({
				format: "weave-reader-active-annotation-version/v1",
				version: 1,
				bookId: importedBookId,
				activeVersionId: "default",
			}),
		);
		zip.file(
			"data/versions/default/annotations.json",
			JSON.stringify({
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId: importedBookId,
				annotations: [{ semanticId: "imported" }],
			}),
		);
		const packageBuffer = await zip.generateAsync({ type: "arraybuffer" });
		const { app } = createAppHarness({
			files: {
				"weave/epub-data/index.json": JSON.stringify({
					format: "weave-reader-epub-data-index/v1",
					version: 1,
					books: {
						[packageBookId]: {
							bookId: packageBookId,
							filePath: "Books/Package.epub",
							fileFingerprint: "other-file",
							packageFingerprint: "same-package",
						},
						[fileBookId]: {
							bookId: fileBookId,
							filePath: "Books/File.epub",
							sourceFingerprint: "same-file",
							fileFingerprint: "same-file",
						},
					},
				}),
			},
		});

		const result = await importEpubAnnotatedBookPackage(app, packageBuffer, {
			defaultBookFolder: "Books",
		});

		expect(result.bookId).toBe(fileBookId);
		expect(result.bookPath).toBe("Books/File.epub");
		expect(result.matchedExistingBook).toBe(true);
	});

	it("prioritizes the right-clicked book fingerprints before global matches", async () => {
		const preferredBookId = "epub-book-preferred";
		const fileBookId = "epub-book-file-match";
		const importedBookId = "epub-book-imported";
		const preferredBinary = await createValidEpubBinary({
			title: "Preferred",
			chapterHtml:
				`<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Preferred same content.</p></body></html>`,
		});
		const preferredFingerprints = await computeAvailableEpubFingerprints(preferredBinary);
		const zip = new JSZip();
		zip.file(
			"manifest.json",
			JSON.stringify({
				format: "weave-reader-annotated-book-package/v1",
				version: 1,
				bookId: importedBookId,
				bookFileName: "Imported.epub",
				exportedAt: 1,
				fileFingerprint: "same-file",
				packageFingerprint: "same-package",
				contentFingerprint: preferredFingerprints.contentFingerprint,
			}),
		);
		zip.file("book/Imported.epub", "imported-epub");
		zip.file(
			"data/book.json",
			JSON.stringify({
				format: "weave-reader-book/v1",
				version: 1,
				bookId: importedBookId,
				filePath: "Remote/Imported.epub",
				title: "Imported",
				fileFingerprint: "same-file",
				packageFingerprint: "same-package",
				contentFingerprint: preferredFingerprints.contentFingerprint,
			}),
		);
		zip.file(
			"data/active-version.json",
			JSON.stringify({
				format: "weave-reader-active-annotation-version/v1",
				version: 1,
				bookId: importedBookId,
				activeVersionId: "default",
			}),
		);
		zip.file(
			"data/versions/default/annotations.json",
			JSON.stringify({
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId: importedBookId,
				annotations: [{ semanticId: "imported" }],
			}),
		);
		const packageBuffer = await zip.generateAsync({ type: "arraybuffer" });
		const { app } = createAppHarness({
			binaries: {
				"Books/Preferred.epub": preferredBinary,
			},
			files: {
				"weave/epub-data/index.json": JSON.stringify({
					format: "weave-reader-epub-data-index/v1",
					version: 1,
					books: {
						[preferredBookId]: {
							bookId: preferredBookId,
							filePath: "Books/Preferred.epub",
							fileFingerprint: "preferred-file",
							packageFingerprint: "preferred-package",
							contentFingerprint: preferredFingerprints.contentFingerprint,
						},
						[fileBookId]: {
							bookId: fileBookId,
							filePath: "Books/File.epub",
							sourceFingerprint: "same-file",
							fileFingerprint: "same-file",
						},
					},
				}),
			},
		});

		const result = await importEpubAnnotatedBookPackage(app, packageBuffer, {
			defaultBookFolder: "Books",
			preferredBookId,
			targetBookPath: "Books/Preferred.epub",
		});

		expect(result.bookId).toBe(preferredBookId);
		expect(result.bookPath).toBe("Books/Preferred.epub");
		expect(result.matchedExistingBook).toBe(true);
		expect(result.matchKind).toBe("contentFingerprint");
		expect(result.usedPreferredTarget).toBe(true);
	});

	it("does not attach a mismatched right-clicked path to a fingerprint-matched book", async () => {
		const preferredBookId = "epub-book-preferred";
		const importedBookId = "epub-book-imported";
		const zip = new JSZip();
		zip.file(
			"manifest.json",
			JSON.stringify({
				format: "weave-reader-annotated-book-package/v1",
				version: 1,
				bookId: importedBookId,
				bookFileName: "Imported.epub",
				exportedAt: 1,
				sourceFingerprint: "same-file",
				fileFingerprint: "same-file",
			}),
		);
		zip.file("book/Imported.epub", "imported-epub");
		zip.file(
			"data/book.json",
			JSON.stringify({
				format: "weave-reader-book/v1",
				version: 1,
				bookId: importedBookId,
				filePath: "Remote/Imported.epub",
				title: "Imported",
				sourceFingerprint: "same-file",
				fileFingerprint: "same-file",
			}),
		);
		zip.file(
			"data/active-version.json",
			JSON.stringify({
				format: "weave-reader-active-annotation-version/v1",
				version: 1,
				bookId: importedBookId,
				activeVersionId: "default",
			}),
		);
		zip.file(
			"data/versions/default/annotations.json",
			JSON.stringify({
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId: importedBookId,
				annotations: [{ semanticId: "imported" }],
			}),
		);
		const packageBuffer = await zip.generateAsync({ type: "arraybuffer" });
		const { app, files } = createAppHarness({
			binaries: {
				"Books/Mismatched.epub": toArrayBuffer("different-right-clicked-book"),
			},
			files: {
				"weave/epub-data/index.json": JSON.stringify({
					format: "weave-reader-epub-data-index/v1",
					version: 1,
					books: {
						[preferredBookId]: {
							bookId: preferredBookId,
							filePath: "Books/Imported.epub",
							knownPaths: ["Books/Imported.epub"],
							sourceFingerprint: "same-file",
							fileFingerprint: "same-file",
						},
					},
				}),
			},
		});

		const result = await importEpubAnnotatedBookPackage(app, packageBuffer, {
			defaultBookFolder: "Books",
			preferredBookId,
			targetBookPath: "Books/Mismatched.epub",
			requireBook: true,
		});

		expect(result.bookId).toBe(preferredBookId);
		expect(result.bookPath).toBe("Books/Imported.epub");
		expect(result.matchKind).toBe("fileFingerprint");
		expect(result.usedPreferredTarget).toBe(false);
		expect(readJson(files, "weave/epub-data/index.json").books[preferredBookId]).toMatchObject({
			filePath: "Books/Imported.epub",
			knownPaths: ["Books/Imported.epub"],
		});
	});

	it("falls back to global matching when the right-clicked book fingerprints do not match", async () => {
		const preferredBookId = "epub-book-preferred";
		const fileBookId = "epub-book-file-match";
		const importedBookId = "epub-book-imported";
		const zip = new JSZip();
		zip.file(
			"manifest.json",
			JSON.stringify({
				format: "weave-reader-annotated-book-package/v1",
				version: 1,
				bookId: importedBookId,
				bookFileName: "Imported.epub",
				exportedAt: 1,
				fileFingerprint: "same-file",
				packageFingerprint: "same-package",
				contentFingerprint: "same-content",
			}),
		);
		zip.file("book/Imported.epub", "imported-epub");
		zip.file(
			"data/book.json",
			JSON.stringify({
				format: "weave-reader-book/v1",
				version: 1,
				bookId: importedBookId,
				filePath: "Remote/Imported.epub",
				title: "Imported",
				fileFingerprint: "same-file",
				packageFingerprint: "same-package",
				contentFingerprint: "same-content",
			}),
		);
		zip.file(
			"data/active-version.json",
			JSON.stringify({
				format: "weave-reader-active-annotation-version/v1",
				version: 1,
				bookId: importedBookId,
				activeVersionId: "default",
			}),
		);
		zip.file(
			"data/versions/default/annotations.json",
			JSON.stringify({
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId: importedBookId,
				annotations: [{ semanticId: "imported" }],
			}),
		);
		const packageBuffer = await zip.generateAsync({ type: "arraybuffer" });
		const { app } = createAppHarness({
			files: {
				"weave/epub-data/index.json": JSON.stringify({
					format: "weave-reader-epub-data-index/v1",
					version: 1,
					books: {
						[preferredBookId]: {
							bookId: preferredBookId,
							filePath: "Books/Preferred.epub",
							fileFingerprint: "preferred-file",
							packageFingerprint: "preferred-package",
							contentFingerprint: "preferred-content",
						},
						[fileBookId]: {
							bookId: fileBookId,
							filePath: "Books/File.epub",
							sourceFingerprint: "same-file",
							fileFingerprint: "same-file",
						},
					},
				}),
			},
		});

		const result = await importEpubAnnotatedBookPackage(app, packageBuffer, {
			defaultBookFolder: "Books",
			preferredBookId,
			targetBookPath: "Books/Preferred.epub",
		});

		expect(result.bookId).toBe(fileBookId);
		expect(result.bookPath).toBe("Books/File.epub");
		expect(result.matchedExistingBook).toBe(true);
		expect(result.matchKind).toBe("fileFingerprint");
		expect(result.usedPreferredTarget).toBe(false);
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

	it("retargets imported version semantic profiles when importing as a separate version", async () => {
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
			"data/versions/default/annotations.json",
			JSON.stringify({
				format: "weave-reader-annotations/v1",
				version: 1,
				bookId: remoteBookId,
				updatedAt: 10,
				annotations: [{ cfiRange: "epubcfi(/6/4)", semanticId: "remote" }],
			}),
		);
		zip.file(
			"data/versions/default/semantic-profile.json",
			JSON.stringify({
				format: "weave-reader-semantic-profile/v1",
				version: 1,
				scope: "version",
				bookId: remoteBookId,
				versionId: "default",
				sourceVersionId: "default",
				annotationSemanticsEnabled: true,
				semanticSchemeId: "custom",
				semantics: [
					{
						id: "remote",
						label: "Remote",
						color: "red",
						style: "wavy",
						group: "study",
						source: "custom",
						active: true,
					},
				],
				standardSemanticIds: ["remote"],
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

		expect(result.importedVersionIds).toEqual(["imported-default"]);
		expect(readJson(files, `${root}/versions/imported-default/semantic-profile.json`)).toMatchObject({
			format: "weave-reader-semantic-profile/v1",
			scope: "version",
			bookId: localBookId,
			versionId: "imported-default",
			sourceVersionId: "imported-default",
			semanticSchemeId: "custom",
			semantics: [expect.objectContaining({ id: "remote", color: "red", style: "wavy" })],
		});
	});

	it("can activate an imported annotation version for an existing same-fingerprint book", async () => {
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
			activateImportedAnnotations: true,
		});

		expect(result.bookId).toBe(localBookId);
		expect(result.activatedImportedVersion).toBe(true);
		expect(result.activeVersionId).toBe("imported-default");
		expect(readJson(files, `${root}/active-version.json`)).toMatchObject({
			bookId: localBookId,
			activeVersionId: "imported-default",
		});
		expect(readJson(files, `${root}/annotations.json`)).toMatchObject({
			bookId: localBookId,
			annotations: [{ semanticId: "remote" }],
		});
		expect(readJson(files, `${root}/versions/default/annotations.json`)).toMatchObject({
			bookId: localBookId,
			annotations: [{ semanticId: "local" }],
		});
	});
});
