import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
	PdfInkAnnotationStore,
	type PdfInkAnnotationDocument,
	type PdfInkStroke,
} from "../pdf-ink-annotation-store";
import {
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

function stroke(id: string): PdfInkStroke {
	return {
		id,
		pageNumber: 1,
		tool: "pen",
		color: "#111111",
		width: 3,
		points: [
			{ x: 0.1, y: 0.1, t: 1 },
			{ x: 0.2, y: 0.2, t: 2 },
		],
	};
}

function document(strokes: PdfInkStroke[]): PdfInkAnnotationDocument {
	return {
		version: 1,
		sourcePath: "Books/demo.pdf",
		pageCount: 2,
		strokes,
		textAnnotations: [],
		updatedAt: 1,
	};
}

function readJson(files: Map<string, string>, path: string) {
	return JSON.parse(files.get(path) || "{}");
}

describe("PdfInkAnnotationStore", () => {
	it("writes PDF ink strokes beside the PDF text annotations in the portable book directory", async () => {
		const { app, files } = createMemoryApp();
		const store = new PdfInkAnnotationStore(app);
		const location = resolvePdfPortableBookDataLocation("Books/demo.pdf");

		await store.save(document([stroke("stroke-a")]));

		expect(readJson(files, location.inkPath)).toMatchObject({
			version: 1,
			sourcePath: "Books/demo.pdf",
			pageCount: 2,
			strokes: [{ id: "stroke-a" }],
		});
		expect(readJson(files, location.inkPath).textAnnotations).toBeUndefined();
		expect(readJson(files, location.bookMetadataPath)).toMatchObject({
			bookId: location.bookId,
			sourcePath: "Books/demo.pdf",
			dataPaths: {
				annotations: location.annotationsPath,
				ink: location.inkPath,
			},
		});
		expect(readJson(files, location.indexPath).books[location.bookId]).toMatchObject({
			bookId: location.bookId,
			filePath: "Books/demo.pdf",
			knownPaths: ["Books/demo.pdf"],
		});
	});

	it("loads legacy .ink.json files and migrates their strokes into the portable book directory", async () => {
		const app = new App();
		const storeForPath = new PdfInkAnnotationStore(app);
		const legacyPath = storeForPath.getLegacyAnnotationPath("Books/demo.pdf");
		const location = resolvePdfPortableBookDataLocation("Books/demo.pdf");
		const { app: memoryApp, files } = createMemoryApp({
			[legacyPath]: {
				...document([stroke("legacy-stroke")]),
				textAnnotations: [
					{
						id: "legacy-text",
						pageNumber: 1,
						kind: "highlight",
						color: "#ffd54a",
						text: "Legacy text",
						rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.03 }],
						createdAt: 1,
					},
				],
			},
		});
		const store = new PdfInkAnnotationStore(memoryApp);

		const loaded = await store.load("Books/demo.pdf", 2);

		expect(loaded.strokes.map((entry) => entry.id)).toEqual(["legacy-stroke"]);
		expect(loaded.textAnnotations?.map((entry) => entry.id)).toEqual(["legacy-text"]);
		expect(readJson(files, location.inkPath)).toMatchObject({
			sourcePath: "Books/demo.pdf",
			strokes: [{ id: "legacy-stroke" }],
		});
		expect(readJson(files, location.inkPath).textAnnotations).toBeUndefined();
	});

	it("loads previous title-based portable ink.json files and migrates them into the pdf-book directory", async () => {
		const location = resolvePdfPortableBookDataLocation("Books/demo.pdf");
		const legacyLocation = resolveLegacyPdfPortableBookDataLocation("Books/demo.pdf");
		const { app, files } = createMemoryApp({
			[legacyLocation.inkPath]: document([stroke("portable-legacy-stroke")]),
		});
		const store = new PdfInkAnnotationStore(app);

		const loaded = await store.load("Books/demo.pdf", 2);

		expect(loaded.strokes.map((entry) => entry.id)).toEqual(["portable-legacy-stroke"]);
		expect(readJson(files, location.inkPath)).toMatchObject({
			sourcePath: "Books/demo.pdf",
			strokes: [{ id: "portable-legacy-stroke" }],
		});
	});
});
