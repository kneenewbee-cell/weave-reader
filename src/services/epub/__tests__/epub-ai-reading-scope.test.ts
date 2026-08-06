import { describe, expect, it } from "vitest";
import type { TocItem } from "../types";
import {
	EPUB_AI_READING_ALL_SCOPE_ID,
	buildEpubAiReadingScopeLevels,
	getEpubAiReadingScopeSessionKeyPart,
	resolveDefaultEpubAiReadingScopeIds,
	resolveEpubAiReadingScopeSelection,
} from "../epub-ai-reading-scope";

function tocItem(
	id: string,
	label: string,
	href: string,
	level: number,
	subitems: TocItem[] = []
): TocItem {
	return {
		id,
		label,
		href,
		level,
		subitems,
	};
}

const nestedToc: TocItem[] = [
	tocItem("chapter-1", "第一章", "text/ch1.xhtml", 1, [
		tocItem("tools", "准备你的 LaTeX 工具", "text/ch1.xhtml#tools", 2, [
			tocItem("setup", "准备工作", "text/ch1.xhtml#setup", 3),
			tocItem("read-more", "另请参阅", "text/ch1.xhtml#read-more", 3),
		]),
		tocItem("short-doc", "撰写短文", "text/ch1.xhtml#short-doc", 2, [
			tocItem("steps", "操作步骤", "text/ch1.xhtml#steps", 3),
		]),
	]),
	tocItem("chapter-2", "第二章", "text/ch2.xhtml", 1),
];

const fourLevelToc: TocItem[] = [
	tocItem("chapter-6", "第六章：图形创作", "text/ch6.xhtml", 1, [
		tocItem("drawing", "绘制图形", "text/ch6.xhtml#drawing", 2, [
			tocItem("shapes", "基本形状", "text/ch6.xhtml#shapes", 3, [
				tocItem("rectangles", "矩形", "text/ch6.xhtml#rectangles", 4),
			]),
		]),
	]),
];

describe("EPUB AI reading scope helper", () => {
	it("builds cascaded selector levels from nested TOC items", () => {
		const levels = buildEpubAiReadingScopeLevels(nestedToc, [
			"chapter-1",
			"tools",
			"setup",
		]);

		expect(levels).toHaveLength(3);
		expect(levels[0].selectedId).toBe("chapter-1");
		expect(levels[0].disabled).toBe(false);
		expect(levels[0].options.map((option) => option.label)).toEqual([
			"全部",
			"第一章",
			"第二章",
		]);
		expect(levels[1].selectedId).toBe("tools");
		expect(levels[1].options.map((option) => option.label)).toEqual([
			"全部",
			"准备你的 LaTeX 工具",
			"撰写短文",
		]);
		expect(levels[2].selectedId).toBe("setup");
		expect(levels[2].options.map((option) => option.label)).toEqual([
			"全部",
			"准备工作",
			"另请参阅",
		]);
	});

	it("keeps lower levels visible as disabled All after a parent level selects All", () => {
		const levels = buildEpubAiReadingScopeLevels(nestedToc, [
			"chapter-1",
			EPUB_AI_READING_ALL_SCOPE_ID,
		]);

		expect(levels).toHaveLength(3);
		expect(levels[1].selectedId).toBe(EPUB_AI_READING_ALL_SCOPE_ID);
		expect(levels[1].disabled).toBe(false);
		expect(levels[2].selectedId).toBe(EPUB_AI_READING_ALL_SCOPE_ID);
		expect(levels[2].disabled).toBe(true);
		expect(levels[2].options).toEqual([
			expect.objectContaining({
				id: EPUB_AI_READING_ALL_SCOPE_ID,
				label: "全部",
				isAll: true,
			}),
		]);
	});

	it("keeps all four TOC levels visible when a parent level selects All", () => {
		const levels = buildEpubAiReadingScopeLevels(fourLevelToc, [
			"chapter-6",
			EPUB_AI_READING_ALL_SCOPE_ID,
		]);

		expect(levels).toHaveLength(4);
		expect(levels.map((level) => level.depth)).toEqual([0, 1, 2, 3]);
		expect(levels[0].selectedId).toBe("chapter-6");
		expect(levels[1].selectedId).toBe(EPUB_AI_READING_ALL_SCOPE_ID);
		expect(levels[1].disabled).toBe(false);
		expect(levels[2].selectedId).toBe(EPUB_AI_READING_ALL_SCOPE_ID);
		expect(levels[2].disabled).toBe(true);
		expect(levels[3].selectedId).toBe(EPUB_AI_READING_ALL_SCOPE_ID);
		expect(levels[3].disabled).toBe(true);
	});

	it("keeps the book max depth visible when the selected top-level item is a leaf", () => {
		const levels = buildEpubAiReadingScopeLevels(nestedToc, ["chapter-2"]);

		expect(levels).toHaveLength(3);
		expect(levels[0].selectedId).toBe("chapter-2");
		expect(levels[0].disabled).toBe(false);
		expect(levels[1].selectedId).toBe(EPUB_AI_READING_ALL_SCOPE_ID);
		expect(levels[1].disabled).toBe(true);
		expect(levels[2].selectedId).toBe(EPUB_AI_READING_ALL_SCOPE_ID);
		expect(levels[2].disabled).toBe(true);
	});

	it("resolves top-level All as the disabled full-book placeholder", () => {
		const selection = resolveEpubAiReadingScopeSelection(nestedToc, [
			EPUB_AI_READING_ALL_SCOPE_ID,
		]);

		expect(selection).toEqual(
			expect.objectContaining({
				kind: "book-placeholder",
				canGenerate: false,
				label: "全部",
				pathLabels: ["全部"],
			})
		);
	});

	it("resolves parent plus child All to the parent TOC scope", () => {
		const selection = resolveEpubAiReadingScopeSelection(nestedToc, [
			"chapter-1",
			"tools",
			EPUB_AI_READING_ALL_SCOPE_ID,
		]);

		expect(selection).toEqual(
			expect.objectContaining({
				kind: "toc",
				canGenerate: true,
				label: "准备你的 LaTeX 工具",
				href: "text/ch1.xhtml#tools",
				flatIndex: 1,
				endFlatIndex: 3,
				includeDescendants: true,
				depth: 1,
				pathLabels: ["第一章", "准备你的 LaTeX 工具", "全部"],
			})
		);
	});

	it("resolves the default selection to the deepest matching TOC href", () => {
		expect(resolveDefaultEpubAiReadingScopeIds(nestedToc, "text/ch1.xhtml#setup")).toEqual([
			"chapter-1",
			"tools",
			"setup",
		]);
	});

	it("resolves an exact leaf scope without widening to siblings", () => {
		const selection = resolveEpubAiReadingScopeSelection(nestedToc, [
			"chapter-1",
			"tools",
			"setup",
		]);

		expect(selection).toEqual(
			expect.objectContaining({
				kind: "toc",
				canGenerate: true,
				href: "text/ch1.xhtml#setup",
				flatIndex: 2,
				endFlatIndex: 2,
				includeDescendants: false,
				depth: 2,
			})
		);
	});

	it("uses different session key parts for parent and leaf scopes", () => {
		const parentScope = resolveEpubAiReadingScopeSelection(nestedToc, [
			"chapter-1",
			"tools",
			EPUB_AI_READING_ALL_SCOPE_ID,
		]);
		const leafScope = resolveEpubAiReadingScopeSelection(nestedToc, [
			"chapter-1",
			"tools",
			"setup",
		]);

		expect(getEpubAiReadingScopeSessionKeyPart(parentScope)).not.toBe(
			getEpubAiReadingScopeSessionKeyPart(leafScope)
		);
	});
});
