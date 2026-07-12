import { describe, expect, it } from "vitest";
import type { TocItem } from "../types";
import {
	formatChapterLocationLabel,
	normalizeChapterLocationFormat,
	resolveChapterLocationLabel,
	resolveTocLabelPathBySpineIndex,
	resolveTocLabelPathForSectionHref,
	tocHrefMatchesSectionHref,
} from "../../../utils/epub-chapter-location-label";

const nestedToc: TocItem[] = [
	{
		id: "1",
		label: "第一部 出入世",
		href: "part1.xhtml",
		level: 1,
		subitems: [
			{
				id: "2",
				label: "第三章 出离",
				href: "part1.xhtml#chapter-3",
				level: 2,
				subitems: [
					{
						id: "3",
						label: "3.1 告别",
						href: "part1.xhtml#section-3-1",
						level: 3,
					},
				],
			},
		],
	},
];

describe("epub-chapter-location-label", () => {
	it("matches section hrefs with and without hash fragments", () => {
		expect(tocHrefMatchesSectionHref("part1.xhtml#section-3-1", "part1.xhtml")).toBe(true);
		expect(tocHrefMatchesSectionHref("part1.xhtml", "part1.xhtml#section-3-1")).toBe(true);
		expect(tocHrefMatchesSectionHref("other.xhtml", "part1.xhtml")).toBe(false);
	});

	it("resolves the deepest toc label path for a section href", () => {
		expect(resolveTocLabelPathForSectionHref(nestedToc, "part1.xhtml#section-3-1")).toEqual([
			"第一部 出入世",
			"第三章 出离",
			"3.1 告别",
		]);
	});

	it("formats chapter location labels by root, leaf, and full modes", () => {
		const labels = ["第一部 出入世", "第三章 出离", "3.1 告别"];
		expect(formatChapterLocationLabel(labels, "root")).toBe("第一部 出入世");
		expect(formatChapterLocationLabel(labels, "leaf")).toBe("3.1 告别");
		expect(formatChapterLocationLabel(labels, "full")).toBe("第一部 出入世/第三章 出离/3.1 告别");
	});

	it("falls back to section title when toc path is unavailable", () => {
		expect(
			resolveChapterLocationLabel([], "missing.xhtml", "3.1 告别", "full")
		).toBe("3.1 告别");
	});

	it("resolves split spine sections to parent toc chapter labels", () => {
		const splitToc: TocItem[] = [
			{
				id: "1",
				label: "第三章 复杂系统",
				href: "Text/part0011.xhtml",
				level: 1,
				subitems: [
					{
						id: "2",
						label: "3.1 小节",
						href: "Text/part0011.xhtml#section-1",
						level: 2,
					},
				],
			},
		];
		expect(
			resolveTocLabelPathForSectionHref(splitToc, "Text/part0011_split_009.xhtml")
		).toEqual(["第三章 复杂系统"]);
		expect(
			resolveChapterLocationLabel(
				splitToc,
				"Text/part0011_split_009.xhtml",
				"part0011 split 009",
				"leaf"
			)
		).toBe("第三章 复杂系统");
	});

	it("resolves later split sections via spine index when toc points at the first split", () => {
		const splitToc: TocItem[] = [
			{
				id: "1",
				label: "第二章 早期",
				href: "Text/part0010_split_000.xhtml",
				level: 1,
			},
			{
				id: "2",
				label: "在巨人的肩膀上",
				href: "Text/part0011_split_000.xhtml",
				level: 1,
			},
		];
		const resolveSpineIndex = (href: string): number => {
			const map: Record<string, number> = {
				"Text/part0010_split_000.xhtml": 50,
				"Text/part0011_split_000.xhtml": 60,
			};
			return map[href] ?? -1;
		};

		expect(
			resolveTocLabelPathBySpineIndex(splitToc, 72, resolveSpineIndex)
		).toEqual(["在巨人的肩膀上"]);
		expect(
			resolveChapterLocationLabel(
				splitToc,
				"Text/part0011_split_009.xhtml",
				"part0011 split 009",
				"leaf",
				{
					sectionIndex: 72,
					resolveSpineIndex,
				}
			)
		).toBe("在巨人的肩膀上");
	});

	it("normalizes unknown chapter location formats to leaf", () => {
		expect(normalizeChapterLocationFormat("full")).toBe("full");
		expect(normalizeChapterLocationFormat("root")).toBe("root");
		expect(normalizeChapterLocationFormat("invalid")).toBe("leaf");
	});
});
