import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import {
	epubVaultPathsReferToSameBook,
	isVisibleVaultBookPath,
	joinListedVaultPath,
	resolveComparableBookVaultPath,
	resolveEpubVaultPath,
	resolveRelativeVaultPath,
	resolveSupportedBookFile,
} from "../epub-vault-path";

function createEpubFile(path: string) {
	return Object.assign(new TFile(), {
		path,
		name: path.split("/").pop() || path,
		extension: "epub",
	});
}

function createFb2File(path: string) {
	return Object.assign(new TFile(), {
		path,
		name: path.split("/").pop() || path,
		extension: "fb2",
	});
}

describe("epub-vault-path", () => {
	it("resolves shortest wikilink paths using the source markdown context", () => {
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => {
					if (path === "Books/demo.epub") {
						return createEpubFile("Books/demo.epub");
					}
					return null;
				}),
				getFiles: vi.fn(() => []),
			},
			metadataCache: {
				getFirstLinkpathDest: vi.fn((linkpath: string, sourcePath: string) => {
					if (linkpath === "demo.epub" && sourcePath === "Notes/demo.md") {
						return createEpubFile("Books/demo.epub");
					}
					return null;
				}),
			},
		} as any;

		expect(resolveEpubVaultPath(app, "demo.epub", "Notes/demo.md")).toBe("Books/demo.epub");
		expect(resolveEpubVaultPath(app, "Books/demo.epub", "Notes/demo.md")).toBe("Books/demo.epub");
	});

	it("matches nested and exact vault paths for the same book", () => {
		expect(epubVaultPathsReferToSameBook("Books/demo.epub", "Books/demo.epub")).toBe(true);
		expect(epubVaultPathsReferToSameBook("demo.epub", "Books/demo.epub")).toBe(true);
		expect(epubVaultPathsReferToSameBook("Books/demo.epub", "Archive/demo.epub")).toBe(false);
	});

	it("treats trash and dot-folders as non-visible vault book paths", () => {
		const configDir = ".obsidian";
		expect(isVisibleVaultBookPath("Books/demo.epub", configDir)).toBe(true);
		expect(isVisibleVaultBookPath(".trash/demo.epub", configDir)).toBe(false);
		expect(isVisibleVaultBookPath(".obsidian/plugins/demo.epub", configDir)).toBe(false);
		expect(isVisibleVaultBookPath("Books/.hidden/demo.epub", configDir)).toBe(false);
	});

	it("joins adapter.list entries under the current folder", () => {
		expect(joinListedVaultPath("Books", "demo.epub")).toBe("Books/demo.epub");
		expect(joinListedVaultPath("", "Books/demo.epub")).toBe("Books/demo.epub");
		expect(joinListedVaultPath("Books", "Nested/demo.epub")).toBe("Nested/demo.epub");
	});

	it("returns null when basename-only path matches multiple books", () => {
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn(() => null),
				getFiles: vi.fn(() => [
					createEpubFile("Books/demo.epub"),
					createEpubFile("Archive/demo.epub"),
				]),
			},
			metadataCache: {
				getFirstLinkpathDest: vi.fn(() => null),
			},
		} as any;

		expect(resolveSupportedBookFile(app, "demo.epub")).toBeNull();
		expect(resolveSupportedBookFile(app, "Books/demo.epub")?.path).toBe("Books/demo.epub");
	});

	it("resolves relative wikilink paths from markdown source context", () => {
		const bookPath =
			"附件/史蒂夫 · 乔布斯传 (修订版) = Steve Jobs A Biography ([美] 沃尔特 · 艾萨克森 (Walter Isaacson) 著 管延圻 etc.) (z-library.sk, 1lib.sk, z-lib.sk).fb2";
		const notePath = "笔记/乔布斯摘录.md";
		const relativeLink = `../../${bookPath}`;
		expect(resolveRelativeVaultPath(notePath, relativeLink)).toBe(bookPath);

		const app = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => {
					if (path === bookPath) {
						return createFb2File(bookPath);
					}
					return null;
				}),
				getFiles: vi.fn(() => [createFb2File(bookPath)]),
			},
			metadataCache: {
				getFirstLinkpathDest: vi.fn(() => null),
			},
		} as any;

		expect(resolveEpubVaultPath(app, relativeLink, notePath)).toBe(bookPath);
		expect(resolveComparableBookVaultPath(app, relativeLink, notePath)).toBe(bookPath);
		expect(
			epubVaultPathsReferToSameBook(
				resolveComparableBookVaultPath(app, relativeLink, notePath),
				bookPath
			)
		).toBe(true);
	});

	it("resolves basename-only stored paths via vault.getFiles()", () => {
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn(() => null),
				getFiles: vi.fn(() => [createEpubFile("Books/demo.epub")]),
			},
			metadataCache: {
				getFirstLinkpathDest: vi.fn(() => null),
			},
		} as any;

		expect(resolveSupportedBookFile(app, "demo.epub")?.path).toBe("Books/demo.epub");
	});
});
