import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { PdfTextAnnotation } from "../pdf-ink-annotation-store";
import {
	PDF_TEXT_ANNOTATIONS_FORMAT,
	PdfTextAnnotationStore,
	resolvePdfPortableBookDataLocation,
	sortPdfTextAnnotationsByPosition,
} from "../pdf-text-annotation-store";

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

	it("writes sorted PDF text annotations to weave/pdf-data annotations.json", async () => {
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

		expect(adapter.write).toHaveBeenCalledTimes(1);
		const [path, json] = adapter.write.mock.calls[0];
		expect(path).toBe(location.annotationsPath);
		const payload = JSON.parse(String(json));
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
});
