import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { PdfTextAnnotation } from "../pdf-ink-annotation-store";
import {
	PDF_TEXT_ANNOTATIONS_FORMAT,
	PdfTextAnnotationStore,
	sortPdfTextAnnotationsByPosition,
} from "../pdf-text-annotation-store";
import {
	PDF_PORTABLE_BOOK_FORMAT,
	PDF_PORTABLE_INDEX_FORMAT,
	resolveLegacyPdfPortableBookDataLocation,
	resolvePdfPortableBookDataLocation,
} from "../pdf-portable-data-location";

function createMemoryApp(initialFiles: Record<string, unknown> = {}) {
	const app = new App();
	const files = new Map<string, string>(
		Object.entries(initialFiles).map(([path, value]) => [
			path,
			typeof value === "string" ? value : JSON.stringify(value),
		])
	);
	const folders = new Set<string>();
	const adapter = {
		exists: vi.fn(async (path: string) => files.has(path) || folders.has(path)),
		read: vi.fn(async (path: string) => files.get(path) ?? ""),
		write: vi.fn(async (path: string, data: string) => {
			files.set(path, data);
		}),
		mkdir: vi.fn(async (path: string) => {
			folders.add(path);
		}),
	};
	(app.vault as any).adapter = adapter;
	return { app, adapter, files, folders };
}

function textAnnotation(
	id: string,
	pageNumber: number,
	x: number,
	y: number,
	createdAt: number
): PdfTextAnnotation {
	return {
		id,
		pageNumber,
		kind: "highlight",
		color: "#ffd54a",
		text: id,
		rects: [{ x, y, width: 0.1, height: 0.02 }],
		createdAt,
	};
}

function getWrittenJson(adapter: ReturnType<typeof createMemoryApp>["adapter"], path: string) {
	const call = adapter.write.mock.calls.find(([writtenPath]) => writtenPath === path);
	expect(call).toBeTruthy();
	return JSON.parse(String(call?.[1] || "{}"));
}

describe("PdfTextAnnotationStore", () => {
	it("sorts text annotations by page and PDF position instead of creation time", () => {
		const sorted = sortPdfTextAnnotationsByPosition([
			textAnnotation("created-first-page-two", 2, 0.1, 0.1, 1),
			textAnnotation("lower-on-page-one", 1, 0.1, 0.6, 2),
			textAnnotation("right-same-line", 1, 0.6, 0.1, 3),
			textAnnotation("left-same-line", 1, 0.1, 0.1, 4),
		]);

		expect(sorted.map((annotation) => annotation.id)).toEqual([
			"left-same-line",
			"right-same-line",
			"lower-on-page-one",
			"created-first-page-two",
		]);
	});

	it("writes sorted PDF text annotations and PDF book metadata to weave/pdf-data", async () => {
		const { app, adapter } = createMemoryApp();
		const store = new PdfTextAnnotationStore(app);
		const location = resolvePdfPortableBookDataLocation("Books/demo.pdf");

		await store.save({
			version: 1,
			format: PDF_TEXT_ANNOTATIONS_FORMAT,
			bookId: location.bookId,
			sourcePath: "Books/demo.pdf",
			pageCount: 3,
			annotations: [
				textAnnotation("page-two", 2, 0.1, 0.1, 1),
				textAnnotation("page-one", 1, 0.1, 0.1, 2),
			],
			updatedAt: 1,
		});

		const payload = getWrittenJson(adapter, location.annotationsPath);
		expect(payload).toMatchObject({
			format: PDF_TEXT_ANNOTATIONS_FORMAT,
			version: 1,
			bookId: location.bookId,
			sourcePath: "Books/demo.pdf",
			pageCount: 3,
		});
		expect(payload.annotations.map((annotation: PdfTextAnnotation) => annotation.id)).toEqual([
			"page-one",
			"page-two",
		]);
		expect(getWrittenJson(adapter, location.bookMetadataPath)).toMatchObject({
			format: PDF_PORTABLE_BOOK_FORMAT,
			version: 1,
			bookId: location.bookId,
			sourcePath: "Books/demo.pdf",
			filePath: "Books/demo.pdf",
			fileName: "demo.pdf",
			title: "demo",
			pageCount: 3,
			dataPaths: {
				annotations: location.annotationsPath,
				ink: location.inkPath,
				annotationsMarkdown: location.annotationsMarkdownPath,
				readingState: location.readingStatePath,
			},
		});
		const index = getWrittenJson(adapter, location.indexPath);
		expect(index).toMatchObject({
			format: PDF_PORTABLE_INDEX_FORMAT,
			version: 1,
			books: {
				[location.bookId]: {
					bookId: location.bookId,
					sourcePath: "Books/demo.pdf",
					filePath: "Books/demo.pdf",
					knownPaths: ["Books/demo.pdf"],
					title: "demo",
					fileName: "demo.pdf",
					pageCount: 3,
				},
			},
		});
	});

	it("loads existing annotations.json as the authoritative text annotation source", async () => {
		const location = resolvePdfPortableBookDataLocation("Books/demo.pdf");
		const { app } = createMemoryApp({
			[location.annotationsPath]: {
				format: PDF_TEXT_ANNOTATIONS_FORMAT,
				version: 1,
				bookId: location.bookId,
				sourcePath: "Books/demo.pdf",
				pageCount: 2,
				annotations: [
					textAnnotation("second", 1, 0.3, 0.2, 1),
					textAnnotation("first", 1, 0.1, 0.1, 2),
				],
				updatedAt: 1,
			},
		});
		const store = new PdfTextAnnotationStore(app);

		const result = await store.load("Books/demo.pdf", 2);

		expect(result.exists).toBe(true);
		expect(result.document.annotations.map((annotation) => annotation.id)).toEqual([
			"first",
			"second",
		]);
	});

	it("loads and migrates annotations from the previous title-based PDF book directory", async () => {
		const location = resolvePdfPortableBookDataLocation("Books/demo.pdf");
		const legacyLocation = resolveLegacyPdfPortableBookDataLocation("Books/demo.pdf");
		const { app, adapter } = createMemoryApp({
			[legacyLocation.annotationsPath]: {
				format: PDF_TEXT_ANNOTATIONS_FORMAT,
				version: 1,
				bookId: legacyLocation.bookId,
				sourcePath: "Books/demo.pdf",
				pageCount: 2,
				annotations: [textAnnotation("legacy-text", 1, 0.1, 0.1, 1)],
				updatedAt: 1,
			},
		});
		const store = new PdfTextAnnotationStore(app);

		const result = await store.load("Books/demo.pdf", 2);

		expect(result.exists).toBe(true);
		expect(result.document.bookId).toBe(location.bookId);
		expect(result.document.annotations.map((annotation) => annotation.id)).toEqual([
			"legacy-text",
		]);
		expect(getWrittenJson(adapter, location.annotationsPath)).toMatchObject({
			bookId: location.bookId,
			annotations: [{ id: "legacy-text" }],
		});
		expect(getWrittenJson(adapter, location.bookMetadataPath)).toMatchObject({
			bookId: location.bookId,
			dataPaths: {
				annotations: location.annotationsPath,
				ink: location.inkPath,
			},
		});
	});

	it("backfills PDF book metadata when loading an existing annotations.json", async () => {
		const location = resolvePdfPortableBookDataLocation("Books/demo.pdf");
		const { app, adapter } = createMemoryApp({
			[location.annotationsPath]: {
				format: PDF_TEXT_ANNOTATIONS_FORMAT,
				version: 1,
				bookId: location.bookId,
				sourcePath: "Books/demo.pdf",
				pageCount: 2,
				annotations: [textAnnotation("existing", 1, 0.1, 0.1, 1)],
				updatedAt: 1,
			},
		});
		const store = new PdfTextAnnotationStore(app);

		await store.load("Books/demo.pdf", 2);

		expect(getWrittenJson(adapter, location.bookMetadataPath)).toMatchObject({
			bookId: location.bookId,
			sourcePath: "Books/demo.pdf",
			dataPaths: {
				annotations: location.annotationsPath,
				ink: location.inkPath,
			},
		});
		expect(getWrittenJson(adapter, location.indexPath).books[location.bookId]).toMatchObject({
			bookId: location.bookId,
			filePath: "Books/demo.pdf",
			knownPaths: ["Books/demo.pdf"],
		});
	});

	it("does not keep the vault root as a known PDF source path", async () => {
		const location = resolvePdfPortableBookDataLocation("Books/demo.pdf");
		const { app, adapter } = createMemoryApp({
			[location.indexPath]: {
				format: PDF_PORTABLE_INDEX_FORMAT,
				version: 1,
				books: {
					[location.bookId]: {
						bookId: location.bookId,
						sourcePath: "Books/demo.pdf",
						filePath: "Books/demo.pdf",
						knownPaths: ["/", "Books/old-demo.pdf"],
						fileName: "demo.pdf",
						title: "demo",
						pageCount: 2,
						createdAt: 1,
						updatedAt: 1,
					},
				},
			},
		});
		const store = new PdfTextAnnotationStore(app);

		await store.save(
			store.createDocument("Books/demo.pdf", 2, [textAnnotation("saved", 1, 0.1, 0.1, 1)])
		);

		expect(getWrittenJson(adapter, location.indexPath).books[location.bookId].knownPaths).toEqual([
			"Books/old-demo.pdf",
			"Books/demo.pdf",
		]);
	});
});
