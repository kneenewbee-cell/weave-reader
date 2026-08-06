import { describe, expect, it } from "vitest";
import type { FlatTocExportItem } from "../epub-toc-export-scope";
import {
	attachSourceBlockIdsToCloseReadingUnit,
	buildEpubAiReadingCloseReadingUnits,
	formatEpubAiReadingCloseReadingUnitsForPrompt,
	formatEpubAiReadingUnitId,
	formatEpubAiReadingUnitSourceBlockId,
} from "../epub-ai-reading-close-reading-units";

function tocItem(
	id: string,
	label: string,
	href: string,
	depth: number,
): FlatTocExportItem {
	return {
		id,
		label,
		href,
		depth,
		level: depth + 1,
	} as FlatTocExportItem;
}

describe("epub-ai-reading-close-reading-units", () => {
	it("formats stable unit and unit paragraph ids", () => {
		expect(formatEpubAiReadingUnitId(0)).toBe("U001");
		expect(formatEpubAiReadingUnitId(15)).toBe("U016");
		expect(formatEpubAiReadingUnitSourceBlockId("U016", 0)).toBe("U016.P001");
		expect(formatEpubAiReadingUnitSourceBlockId("U016", 7)).toBe("U016.P008");
	});

	it("extracts leaf units inside a selected chapter scope", () => {
		const flatItems: FlatTocExportItem[] = [
			tocItem("ch5", "第五章：图像处理", "OEBPS/B21326_05.xhtml#ch5", 0),
			tocItem("align", "图像对齐", "OEBPS/B21326_05.xhtml#align", 1),
			tocItem("align-how", "操作指南", "OEBPS/B21326_05.xhtml#how", 2),
			tocItem("align-why", "运行原理", "OEBPS/B21326_05.xhtml#why", 2),
			tocItem("grid", "以网格形式排列图片", "OEBPS/B21326_05.xhtml#grid", 1),
			tocItem("grid-how", "如何操作", "OEBPS/B21326_05.xhtml#grid-how", 2),
		];

		const units = buildEpubAiReadingCloseReadingUnits(flatItems, {
			label: "第五章：图像处理 > 全部",
			pathLabels: ["第五章：图像处理", "全部"],
			href: "OEBPS/B21326_05.xhtml#ch5",
			includeDescendants: true,
			flatIndex: 0,
			endFlatIndex: 5,
		});

		expect(units.map((unit) => [unit.id, unit.pathLabels.join(" > "), unit.href])).toEqual([
			["U003", "第五章：图像处理 > 图像对齐 > 操作指南", "OEBPS/B21326_05.xhtml#how"],
			["U004", "第五章：图像处理 > 图像对齐 > 运行原理", "OEBPS/B21326_05.xhtml#why"],
			["U006", "第五章：图像处理 > 以网格形式排列图片 > 如何操作", "OEBPS/B21326_05.xhtml#grid-how"],
		]);
	});

	it("uses the selected item as the only unit when the exact scope is already a leaf", () => {
		const flatItems: FlatTocExportItem[] = [
			tocItem("ch5", "第五章：图像处理", "OEBPS/B21326_05.xhtml#ch5", 0),
			tocItem("align", "图像对齐", "OEBPS/B21326_05.xhtml#align", 1),
			tocItem("align-how", "操作指南", "OEBPS/B21326_05.xhtml#how", 2),
		];

		const units = buildEpubAiReadingCloseReadingUnits(flatItems, {
			label: "操作指南",
			pathLabels: ["第五章：图像处理", "图像对齐", "操作指南"],
			href: "OEBPS/B21326_05.xhtml#how",
			includeDescendants: false,
			flatIndex: 2,
			endFlatIndex: 2,
		});

		expect(units).toEqual([
			expect.objectContaining({
				id: "U003",
				label: "操作指南",
				pathLabels: ["第五章：图像处理", "图像对齐", "操作指南"],
				href: "OEBPS/B21326_05.xhtml#how",
				flatIndex: 2,
				depth: 2,
			}),
		]);
	});

	it("keeps the same unit id for the same leaf across broad and exact scopes", () => {
		const flatItems: FlatTocExportItem[] = [
			tocItem("ch5", "第五章：图像处理", "OEBPS/B21326_05.xhtml#ch5", 0),
			tocItem("align", "图像对齐", "OEBPS/B21326_05.xhtml#align", 1),
			tocItem("align-how", "操作指南", "OEBPS/B21326_05.xhtml#how", 2),
			tocItem("align-why", "运行原理", "OEBPS/B21326_05.xhtml#why", 2),
		];

		const chapterUnits = buildEpubAiReadingCloseReadingUnits(flatItems, {
			label: "第五章：图像处理 > 全部",
			pathLabels: ["第五章：图像处理", "全部"],
			includeDescendants: true,
			flatIndex: 0,
			endFlatIndex: 3,
		});
		const exactUnits = buildEpubAiReadingCloseReadingUnits(flatItems, {
			label: "操作指南",
			pathLabels: ["第五章：图像处理", "图像对齐", "操作指南"],
			includeDescendants: false,
			flatIndex: 2,
			endFlatIndex: 2,
		});

		expect(chapterUnits[0]?.id).toBe("U003");
		expect(exactUnits[0]?.id).toBe("U003");
	});

	it("attaches contiguous unit paragraph ids to a close-reading unit", () => {
		const unit = {
			id: "U016",
			label: "操作指南",
			href: "OEBPS/B21326_05.xhtml#how",
			pathLabels: ["第五章：图像处理", "图像对齐", "操作指南"],
			flatIndex: 16,
			depth: 2,
		};

		expect(
			attachSourceBlockIdsToCloseReadingUnit(unit, ["U016.P001", "U016.P002"]),
		).toEqual({
			...unit,
			sourceBlockIds: ["U016.P001", "U016.P002"],
		});
	});

	it("formats units as a mandatory AI task list", () => {
		const prompt = formatEpubAiReadingCloseReadingUnitsForPrompt([
			{
				id: "U016",
				label: "操作指南",
				href: "OEBPS/B21326_05.xhtml#how",
				pathLabels: ["第五章：图像处理", "图像对齐", "操作指南"],
				flatIndex: 16,
				depth: 2,
				sourceBlockIds: ["U016.P001", "U016.P002"],
			},
		]);

		expect(prompt).toContain("U016");
		expect(prompt).toContain("第五章：图像处理 > 图像对齐 > 操作指南");
		expect(prompt).toContain("sourceBlocks=U016.P001-U016.P002");
	});
});
