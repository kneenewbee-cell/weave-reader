import { describe, expect, it } from "vitest";
import { EpubReferenceStatsService } from "../EpubReferenceStatsService";

describe("EpubReferenceStatsService", () => {
	it("builds sorted reference summaries with source metadata", async () => {
		const highlights = [
			{
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:12)",
				text: "主动回忆比被动复习更能促进长期记忆的形成",
				color: "yellow",
				sourceFile: "notes/chapter-1.md",
				createdTime: Date.UTC(2026, 4, 10, 12, 0, 0),
				excerptId: "excerpt-md-1",
			},
			{
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:12)",
				text: "主动回忆比被动复习更能促进长期记忆的形成",
				color: "yellow",
				sourceFile: "maps/research.canvas",
				sourceRef: "canvas-file-node:node-123456",
				createdTime: Date.UTC(2026, 4, 12, 9, 0, 0),
				excerptId: "excerpt-canvas-1",
			},
			{
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:12)",
				text: "主动回忆比被动复习更能促进长期记忆的形成",
				color: "yellow",
				sourceFile: "cards/review.json",
				sourceRef: "card:card-abcdef",
				createdTime: Date.UTC(2026, 4, 13, 8, 30, 0),
				excerptId: "excerpt-card-1",
			},
		];

		const service = new EpubReferenceStatsService(
			{} as never,
			{
				collectHighlights: async () => highlights,
			} as never
		);

		const statsMap = await service.computeReferenceStats("books/learning.epub");
		const stats = statsMap.get("epubcfi(/6/2!/4/2,/1:0,/1:12)");

		expect(stats).toBeTruthy();
		expect(stats?.referenceCount).toBe(3);
		expect(stats?.summary.uniqueFileCount).toBe(3);
		expect(stats?.summary.timeSpanDays).toBe(3);
		expect(stats?.summary.typeCounts).toEqual({
			markdown: 1,
			canvas: 1,
			card: 1,
		});
		expect(stats?.sources.map((source) => source.type)).toEqual(["card", "canvas", "markdown"]);
		expect(stats?.sources[0]?.displayName).toBe("review.json");
		expect(stats?.sources[1]?.nodeId).toBe("node-123456");
		expect(stats?.sources[0]?.locateCandidates).toContain("__weave_epub_excerpt__=excerpt-card-1");
	});
});
