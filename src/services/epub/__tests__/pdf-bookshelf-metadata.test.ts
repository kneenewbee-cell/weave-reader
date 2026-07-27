import {
	loadPdfBookshelfInfo,
	buildPdfBookshelfInfoFromDocument,
	buildPdfBookshelfStatsParts,
	mergePdfBookshelfInfoIntoMeta,
	normalizePdfDocumentInfo,
} from "../pdf-bookshelf-metadata";
import { loadPdfJs, TFile, type App } from "obsidian";
import { vi } from "vitest";

describe("pdf-bookshelf-metadata", () => {
	it("builds PDF stats from page count before the format label", () => {
		expect(buildPdfBookshelfStatsParts({ pageCount: 27 })).toEqual(["27 页", "PDF"]);
	});

	it("falls back to the format label when page count is unavailable", () => {
		expect(buildPdfBookshelfStatsParts({})).toEqual(["PDF"]);
	});

	it("normalizes useful PDF document info and ignores suspicious mojibake titles", () => {
		expect(
			normalizePdfDocumentInfo({
				Title: "˙ 'Ñf_01.pdf",
				Author: "  ",
			})
		).toEqual({});

		expect(
			normalizePdfDocumentInfo({
				Title: "Linear Algebra Notes",
				Author: "Gilbert Strang",
			})
		).toEqual({
			title: "Linear Algebra Notes",
			author: "Gilbert Strang",
		});
	});

	it("merges PDF page count and thumbnail without replacing an existing shelf title with empty metadata", () => {
		const result = mergePdfBookshelfInfoIntoMeta(
			{
				title: "duboule-page",
				author: "",
				progress: 0,
				lastReadTime: 0,
				createdTime: 0,
				readingStatus: "鏈紑濮?",
			},
			{
				pageCount: 27,
				coverImage: "data:image/png;base64,AAAA",
			}
		);

		expect(result.changed).toBe(true);
		expect(result.metadata).toEqual({
			title: "duboule-page",
			author: "",
			pageCount: 27,
			coverImage: "data:image/png;base64,AAAA",
			progress: 0,
			lastReadTime: 0,
			createdTime: 0,
			readingStatus: "鏈紑濮?",
		});
	});

	it("keeps page count when first-page cover rendering fails", async () => {
		const result = await buildPdfBookshelfInfoFromDocument(
			{
				numPages: 27,
				getMetadata: async () => ({
					info: {
						Title: "",
						Author: "",
					},
				}),
			},
			{ renderCover: true },
			async () => {
				throw new Error("canvas unavailable");
			}
		);

		expect(result).toEqual({ pageCount: 27 });
	});

	it("renders the first-page cover through Obsidian PDF.js", async () => {
		const getDocument = vi.fn(() => ({
			promise: Promise.resolve({
				numPages: 1,
				destroy: vi.fn(async () => undefined),
				getPage: vi.fn(async () => ({
					getViewport: vi.fn(({ scale }: { scale: number }) => ({
						width: 200 * scale,
						height: 300 * scale,
					})),
					render: vi.fn(() => ({
						promise: Promise.resolve(),
					})),
				})),
			}),
		}));
		vi.mocked(loadPdfJs).mockResolvedValue({ getDocument });
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			fillStyle: "",
			fillRect: vi.fn(),
		} as unknown as CanvasRenderingContext2D);
		vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
			"data:image/jpeg;base64,cover"
		);

		const file = new TFile("sample.pdf");
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn(() => file),
				readBinary: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
			},
		} as unknown as App;

		const result = await loadPdfBookshelfInfo(app, "sample.pdf", {
			renderCover: true,
		});

		expect(loadPdfJs).toHaveBeenCalled();
		expect(getDocument).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.any(Uint8Array),
			})
		);
		expect(result.coverImage).toBe("data:image/jpeg;base64,cover");
	});
});
