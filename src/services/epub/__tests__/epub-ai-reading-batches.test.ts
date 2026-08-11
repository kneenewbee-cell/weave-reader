import { describe, expect, it, vi } from "vitest";
import type { TocItem } from "../types";
import {
	buildEpubAiReadingMessages,
	planEpubAiReadingUnitBatches,
	requestEpubAiReading,
	validateEpubAiReadingUnitBatchContent,
} from "../epub-ai-reading";
import type { EpubAiReadingCloseReadingUnit } from "../epub-ai-reading-close-reading-units";
import type { EpubAiReadingSourceBlock } from "../epub-ai-reading-source-blocks";

const tocItems: TocItem[] = [
	{
		id: "chapter-5",
		label: "第五章：图像处理",
		href: "OEBPS/B21326_05.xhtml",
		level: 1,
	},
];

function createUnit(index: number): EpubAiReadingCloseReadingUnit {
	const id = `U${String(index).padStart(3, "0")}`;
	return {
		id,
		label: `小节 ${index}`,
		href: `OEBPS/B21326_05.xhtml#u${index}`,
		pathLabels: ["第五章：图像处理", `小节 ${index}`],
		flatIndex: index - 1,
		depth: 2,
		sourceBlockIds: [`${id}.P001`, `${id}.P002`],
	};
}

function createBlock(unitId: string, index: number): EpubAiReadingSourceBlock {
	return {
		id: `${unitId}.P${String(index).padStart(3, "0")}`,
		chapterHref: "OEBPS/B21326_05.xhtml",
		headingPath: ["第五章：图像处理", unitId],
		text: `${unitId} paragraph ${index}`,
		kind: "paragraph",
	};
}

function createInput(unitCount = 4) {
	const closeReadingUnits = Array.from({ length: unitCount }, (_, index) =>
		createUnit(index + 1),
	);
	const sourceBlocks = closeReadingUnits.flatMap((unit) => [
		createBlock(unit.id, 1),
		createBlock(unit.id, 2),
	]);
	return {
		bookTitle: "LaTeX Cookbook",
		filePath: "Books/latex.epub",
		chapterTitle: "第五章：图像处理",
		chapterHref: "OEBPS/B21326_05.xhtml",
		chapterText: "chapter body",
		tocItems,
		scope: {
			label: "第五章：图像处理 > 全部",
			pathLabels: ["第五章：图像处理", "全部"],
			includeDescendants: true,
			flatIndex: 0,
			endFlatIndex: unitCount - 1,
		},
		closeReadingUnits,
		sourceBlocks,
	};
}

function completeUnitMarkdown(unitId: string): string {
	return [
		`## ${unitId} 第五章：图像处理 > ${unitId}`,
		"### 小节摘要",
		`${unitId} 摘要。`,
		"### 核心结论",
		`- ${unitId} 结论 [${unitId}.P001]`,
		"### 关键知识点",
		`- ${unitId} 知识点 [${unitId}.P001]`,
		"### 重要原文与解读",
		`- [${unitId}.P001] 重要原文说明。`,
		"### 容易误解的点",
		`- ${unitId} 容易误解。`,
		"### 与上下文关系",
		`- ${unitId} 与上下文相关。`,
	].join("\n");
}

function unitIdsFromPrompt(prompt: string): string[] {
	return Array.from(new Set(prompt.match(/\bU\d{3}\b/g) || []));
}

describe("epub-ai-reading batches", () => {
	it("uses the tested b2c10 defaults for close reading batches", () => {
		const plan = planEpubAiReadingUnitBatches(createInput(5));

		expect(plan.batchSize).toBe(2);
		expect(plan.concurrency).toBe(10);
		expect(plan.batches.map((batch) => batch.units.map((unit) => unit.id))).toEqual([
			["U001", "U002"],
			["U003", "U004"],
			["U005"],
		]);
	});

	it("plans ordered b3 batches without requiring contiguous global U ids", () => {
		const input = createInput(4);
		input.closeReadingUnits = [
			createUnit(170),
			createUnit(171),
			createUnit(173),
			createUnit(175),
		];
		input.sourceBlocks = input.closeReadingUnits.flatMap((unit) => [
			createBlock(unit.id, 1),
			createBlock(unit.id, 2),
		]);

		const plan = planEpubAiReadingUnitBatches(input, {
			batchSize: 3,
			concurrency: 2,
		});

		expect(plan.concurrency).toBe(2);
		expect(plan.batches.map((batch) => batch.units.map((unit) => unit.id))).toEqual([
			["U170", "U171", "U173"],
			["U175"],
		]);
		expect(plan.batches[0].sourceBlocks.map((block) => block.id)).toEqual([
			"U170.P001",
			"U170.P002",
			"U171.P001",
			"U171.P002",
			"U173.P001",
			"U173.P002",
		]);
	});

	it("uses current unit source ids in unit-detail prompt examples", () => {
		const unit = createUnit(2);
		const input = createInput(2);
		const messages = buildEpubAiReadingMessages({
			...input,
			requestPurpose: "unit-detail",
			closeReadingUnits: [unit],
			sourceBlocks: [createBlock(unit.id, 1), createBlock(unit.id, 2)],
			chapterText: "U002 paragraph 1\n\nU002 paragraph 2",
			chapterMarkdown: "U002 paragraph 1\n\nU002 paragraph 2",
		});

		expect(messages.user).toContain("{{source:U002.P001}}");
		expect(messages.user).toContain("{{source-range:U002.P001-U002.P002}}");
		expect(messages.user).not.toContain("{{source:U001.P001}}");
		expect(messages.user).not.toContain("{{source-range:U001.P001-U001.P003}}");
	});

	it("detects missing unit sections, missing fields and missing source references", () => {
		const units = [createUnit(1), createUnit(2)];
		const issues = validateEpubAiReadingUnitBatchContent(
			[
				completeUnitMarkdown("U001"),
				"## U002 第五章：图像处理 > U002",
				"### 小节摘要",
				"U002 摘要。",
			].join("\n\n"),
			units,
		);

		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					unitId: "U002",
					type: "missing-field",
					field: "核心结论",
				}),
				expect.objectContaining({
					unitId: "U002",
					type: "missing-source-reference",
				}),
			]),
		);
	});

	it("tells unit-detail batches not to treat other scope units as missing正文", () => {
		const input = createInput(4);
		const messages = buildEpubAiReadingMessages({
			...input,
			requestPurpose: "unit-detail",
			closeReadingUnits: input.closeReadingUnits.slice(0, 3),
			sourceBlocks: input.sourceBlocks.filter((block) =>
				/^U00[1-3]\.P\d{3}$/.test(block.id),
			),
		});

		expect(messages.user).toContain("未出现在本批的 U 单元不代表不存在");
		expect(messages.user).toContain("不要写“某 U 未提供正文”");
	});

	it("requests b3c2 unit details and a separate range summary", async () => {
		const requester = vi.fn(async (request) => {
			const body = JSON.parse(String(request.body));
			const prompt = String(body.messages[1].content);
			if (prompt.includes("已完成的 U 单元精析结果")) {
				return {
					json: {
						choices: [
							{
								message: {
									content: "## 范围摘要\n第五章图像处理总览。",
								},
							},
						],
					},
				};
			}
			const ids = unitIdsFromPrompt(prompt).filter((id) =>
				/^U00[1-4]$/.test(id),
			);
			return {
				json: {
					choices: [
						{
							message: {
								content: ids.map(completeUnitMarkdown).join("\n\n"),
							},
						},
					],
				},
			};
		});

		const result = await requestEpubAiReading(createInput(4), {
			config: {
				apiKey: "test-key",
				baseUrl: "https://api.kimi.com/coding/v1",
				model: "k3",
			},
			requester,
			enableStreaming: false,
			batch: { batchSize: 3, concurrency: 2 },
			now: () => 1710000000000,
		});

		expect(requester).toHaveBeenCalledTimes(3);
		const firstPrompt = JSON.parse(
			String(requester.mock.calls[0][0].body),
		).messages[1].content;
		const secondPrompt = JSON.parse(
			String(requester.mock.calls[1][0].body),
		).messages[1].content;
		const summaryPrompt = JSON.parse(
			String(requester.mock.calls[2][0].body),
		).messages[1].content;
		expect(firstPrompt).toContain("U001");
		expect(firstPrompt).toContain("U003");
		expect(firstPrompt).not.toContain("U004");
		expect(secondPrompt).toContain("U004");
		expect(summaryPrompt).toContain("已完成的 U 单元精析结果");
		expect(result.content).toContain("## 范围摘要");
		expect(result.content).toContain("## 按小节精读");
		expect(result.content.indexOf("## 范围摘要")).toBeLessThan(
			result.content.indexOf("## 按小节精读"),
		);
		expect(result.content).toContain("U004 摘要");
	});

	it("fills only missing unit details when a batch omits one unit", async () => {
		const stages: string[] = [];
		const requester = vi.fn(async (request) => {
			const body = JSON.parse(String(request.body));
			const prompt = String(body.messages[1].content);
			if (prompt.includes("已完成的 U 单元精析结果")) {
				return {
					json: {
						choices: [
							{
								message: { content: "## 范围摘要\n回退后汇总。" },
							},
						],
					},
				};
			}
			const ids = unitIdsFromPrompt(prompt).filter((id) =>
				/^U00[1-2]$/.test(id),
			);
			if (ids.length > 1) {
				return {
					json: {
						choices: [
							{
								message: {
									content: completeUnitMarkdown("U001"),
								},
							},
						],
					},
				};
			}
			return {
				json: {
					choices: [
						{
							message: {
								content: completeUnitMarkdown(ids[0]),
							},
						},
					],
				},
			};
		});

		const result = await requestEpubAiReading(createInput(2), {
			config: {
				apiKey: "test-key",
				baseUrl: "https://api.kimi.com/coding/v1",
				model: "k3",
			},
			requester,
			enableStreaming: false,
			onStage: (stage) => stages.push(stage),
			batch: { batchSize: 2, concurrency: 2, retryAttempts: 0 },
		});

		expect(requester).toHaveBeenCalledTimes(3);
		expect(stages.some((stage) => stage.includes("拆成单元重试"))).toBe(true);
		expect(result.content).toContain("U001 摘要");
		expect(result.content).toContain("U002 摘要");
	});

	it("retries with lower concurrency when a batched request is rate limited", async () => {
		const stages: string[] = [];
		let rateLimited = false;
		const requester = vi.fn(async (request) => {
			const body = JSON.parse(String(request.body));
			const prompt = String(body.messages[1].content);
			if (!rateLimited && !prompt.includes("已完成的 U 单元精析结果")) {
				rateLimited = true;
				return { status: 429, text: "rate limit" };
			}
			if (prompt.includes("已完成的 U 单元精析结果")) {
				return {
					json: {
						choices: [
							{
								message: {
									content: "## 范围摘要\n降并发后汇总。",
								},
							},
						],
					},
				};
			}
			const ids = unitIdsFromPrompt(prompt).filter((id) =>
				/^U00[1-4]$/.test(id),
			);
			return {
				json: {
					choices: [
						{
							message: {
								content: ids.map(completeUnitMarkdown).join("\n\n"),
							},
						},
					],
				},
			};
		});

		const result = await requestEpubAiReading(createInput(4), {
			config: {
				apiKey: "test-key",
				baseUrl: "https://api.kimi.com/coding/v1",
				model: "k3",
			},
			requester,
			enableStreaming: false,
			onStage: (stage) => stages.push(stage),
			batch: { batchSize: 2, concurrency: 10, retryAttempts: 0 },
		});

		expect(requester.mock.calls.length).toBeGreaterThanOrEqual(4);
		expect(stages.some((stage) => stage.includes("降到并发 4"))).toBe(true);
		expect(result.content).toContain("U001 摘要");
		expect(result.content).toContain("U004 摘要");
	});
});
