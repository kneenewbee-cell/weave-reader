import { describe, expect, it } from "vitest";
import {
	BOOK_PACKAGE_V2_FORMAT,
	getReadingPackageExportModules,
	normalizeReadingPackageManifest,
} from "../../reading-package";

describe("reading package modules", () => {
	it("shows grouped EPUB export modules", () => {
		const modules = getReadingPackageExportModules("epub");

		expect(modules.map((module) => module.key)).toEqual([
			"book",
			"annotationSystem",
			"navigationState",
			"aiReadingNote",
		]);
		expect(modules.map((module) => module.label)).toEqual([
			"包含 EPUB 原书",
			"标注体系",
			"书签与进度",
			"AI 阅读笔记",
		]);
		expect(modules.find((module) => module.key === "book")?.defaultSelected).toBe(false);
	});

	it("shows grouped PDF export modules without AI reading notes", () => {
		const modules = getReadingPackageExportModules("pdf");

		expect(modules.map((module) => module.key)).toEqual([
			"book",
			"annotationSystem",
			"ink",
			"navigationState",
		]);
		expect(modules.map((module) => module.label)).toEqual([
			"包含 PDF 原书",
			"标注体系",
			"手写/墨迹",
			"书签与进度",
		]);
		expect(modules.some((module) => module.key === "aiReadingNote")).toBe(false);
	});

	it("normalizes a v2 manifest with grouped module selections", () => {
		const manifest = normalizeReadingPackageManifest({
			format: BOOK_PACKAGE_V2_FORMAT,
			version: 2,
			bookFormat: "epub",
			bookId: "epub-book-1",
			bookPath: "Books/demo.epub",
			includeBook: false,
			modules: {
				annotationSystem: true,
				navigationState: true,
				aiReadingNote: true,
			},
			exportedAt: 1785950000000,
		});

		expect(manifest).toMatchObject({
			format: BOOK_PACKAGE_V2_FORMAT,
			bookFormat: "epub",
			bookId: "epub-book-1",
			includeBook: false,
			modules: {
				book: false,
				annotationSystem: true,
				ink: false,
				navigationState: true,
				aiReadingNote: true,
			},
		});
	});
});
