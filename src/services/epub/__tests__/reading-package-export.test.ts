import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { App } from "obsidian";
import {
	BOOK_PACKAGE_V2_FORMAT,
	createReadingPackage,
	readReadingPackageManifest,
} from "../../reading-package";

function createMockApp(files: Map<string, string | Uint8Array>): App {
	const normalize = (path: string) => String(path || "").replace(/\\/g, "/");
	return {
		vault: {
			adapter: {
				exists: async (path: string) => files.has(normalize(path)),
				read: async (path: string) => String(files.get(normalize(path)) || ""),
				readBinary: async (path: string) => files.get(normalize(path)) as Uint8Array,
				list: async (path: string) => {
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
				},
			},
		},
	} as unknown as App;
}

describe("reading package export", () => {
	it("exports grouped EPUB reading data and AI reading note", async () => {
		const files = new Map<string, string | Uint8Array>([
			["Books/demo.epub", new Uint8Array([1, 2, 3])],
			[
				"weave/epub-data/books/epub-book-1/book.json",
				JSON.stringify({
					bookId: "epub-book-1",
					title: "Demo",
					dataPaths: { aiReadingNote: "AI阅读笔记/Demo - AI阅读.md" },
				}),
			],
			["weave/epub-data/books/epub-book-1/annotations.json", "{\"annotations\":[]}"],
			["weave/epub-data/books/epub-book-1/annotations.md", "# Demo annotations"],
			["weave/epub-data/books/epub-book-1/semantic-profile.json", "{\"semantics\":[]}"],
			["weave/epub-data/books/epub-book-1/active-version.json", "{\"activeVersionId\":\"default\"}"],
			["weave/epub-data/books/epub-book-1/versions/default/version.json", "{\"versionId\":\"default\"}"],
			["weave/epub-data/books/epub-book-1/bookmarks.json", "{\"bookmarks\":[]}"],
			["weave/epub-data/books/epub-book-1/reading-state.json", "{\"progress\":0.5}"],
			["AI阅读笔记/Demo - AI阅读.md", '<div data-source-file="Books/demo.epub"></div>'],
		]);

		const result = await createReadingPackage(createMockApp(files), {
			bookFormat: "epub",
			bookId: "epub-book-1",
			filePath: "Books/demo.epub",
			displayName: "Demo",
			modules: {
				book: true,
				annotationSystem: true,
				ink: false,
				navigationState: true,
				aiReadingNote: true,
			},
		});

		const zip = await JSZip.loadAsync(result.arrayBuffer);
		const manifest = await readReadingPackageManifest(zip);

		expect(manifest).toMatchObject({
			format: BOOK_PACKAGE_V2_FORMAT,
			bookFormat: "epub",
			includeBook: true,
			modules: {
				annotationSystem: true,
				navigationState: true,
				aiReadingNote: true,
				ink: false,
			},
		});
		expect(await zip.file("book/demo.epub")?.async("uint8array")).toHaveLength(3);
		expect(await zip.file("data/annotations.json")?.async("string")).toContain("annotations");
		expect(await zip.file("data/active-version.json")?.async("string")).toContain("default");
		expect(await zip.file("data/versions/default/version.json")?.async("string")).toContain("versionId");
		expect(await zip.file("data/bookmarks.json")?.async("string")).toContain("bookmarks");
		expect(await zip.file("data/reading-state.json")?.async("string")).toContain("progress");
		expect(await zip.file("data/ai-reading/note.md")?.async("string")).toContain("Books/demo.epub");
	});

	it("ignores extra circular module properties when writing the package manifest", async () => {
		const files = new Map<string, string | Uint8Array>([
			["Books/demo.epub", new Uint8Array([1, 2, 3])],
			[
				"weave/epub-data/books/epub-book-1/book.json",
				JSON.stringify({ bookId: "epub-book-1", title: "Demo" }),
			],
		]);
		const circular: Record<string, unknown> = {};
		circular.window = circular;
		const modules = {
			book: false,
			annotationSystem: true,
			ink: false,
			navigationState: true,
			aiReadingNote: true,
			window: circular,
		};

		const result = await createReadingPackage(createMockApp(files), {
			bookFormat: "epub",
			bookId: "epub-book-1",
			filePath: "Books/demo.epub",
			displayName: "Demo",
			modules: modules as never,
		});

		const zip = await JSZip.loadAsync(result.arrayBuffer);
		const manifestText = await zip.file("manifest.json")?.async("string");

		expect(manifestText).toContain(BOOK_PACKAGE_V2_FORMAT);
		expect(manifestText).not.toContain("window");
	});

	it("exports grouped PDF reading data without AI reading note", async () => {
		const files = new Map<string, string | Uint8Array>([
			["Books/demo.pdf", new Uint8Array([9, 8, 7])],
			["weave/pdf-data/books/pdf-book-1/book.json", "{\"bookId\":\"pdf-book-1\"}"],
			["weave/pdf-data/books/pdf-book-1/annotations.json", "{\"annotations\":[{\"id\":\"a1\"}]}"],
			["weave/pdf-data/books/pdf-book-1/annotations.md", "# PDF annotations"],
			["weave/pdf-data/books/pdf-book-1/semantic-profile.json", "{\"semantics\":[]}"],
			["weave/pdf-data/books/pdf-book-1/ink.json", "{\"strokes\":[{\"id\":\"s1\"}]}"],
			["weave/pdf-data/books/pdf-book-1/bookmarks.json", "{\"bookmarks\":[]}"],
			["weave/pdf-data/books/pdf-book-1/reading-state.json", "{\"currentPage\":2}"],
		]);

		const result = await createReadingPackage(createMockApp(files), {
			bookFormat: "pdf",
			bookId: "pdf-book-1",
			filePath: "Books/demo.pdf",
			displayName: "Demo PDF",
			modules: {
				book: true,
				annotationSystem: true,
				ink: true,
				navigationState: true,
				aiReadingNote: true,
			},
		});

		const zip = await JSZip.loadAsync(result.arrayBuffer);
		const manifest = await readReadingPackageManifest(zip);

		expect(manifest).toMatchObject({
			bookFormat: "pdf",
			includeBook: true,
			modules: {
				annotationSystem: true,
				ink: true,
				navigationState: true,
				aiReadingNote: false,
			},
		});
		expect(await zip.file("book/demo.pdf")?.async("uint8array")).toHaveLength(3);
		expect(await zip.file("data/annotations.json")?.async("string")).toContain("a1");
		expect(await zip.file("data/ink.json")?.async("string")).toContain("s1");
		expect(await zip.file("data/reading-state.json")?.async("string")).toContain("currentPage");
		expect(zip.file("data/ai-reading/note.md")).toBeNull();
	});
});
