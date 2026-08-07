import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { App } from "obsidian";
import {
	BOOK_PACKAGE_V2_FORMAT,
	importReadingPackage,
	writeReadingPackageManifest,
} from "../../reading-package";

function createWritableMockApp(files: Map<string, string | Uint8Array>): App {
	const normalize = (path: string) => String(path || "").replace(/\\/g, "/");
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
