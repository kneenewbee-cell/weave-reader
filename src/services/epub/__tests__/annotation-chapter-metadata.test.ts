import { describe, expect, it } from "vitest";
import type { TocItem } from "../types";
import {
	resolveAnnotationChapterMetadata,
	applyAnnotationChapterMetadata,
} from "../annotation-chapter-metadata";

const latexToc: TocItem[] = [
	{
		id: "contributors",
		label: "贡献者",
		href: "Text/B17260_FM_ePub_RK.xhtml#_idParaDest-3",
		level: 1,
	},
	{
		id: "author",
		label: "关于作者",
		href: "Text/B17260_FM_ePub_RK.xhtml#_idParaDest-4",
		level: 1,
	},
	{
		id: "chapter-1",
		label: "第一章：LaTeX 入门指南",
		href: "Text/B17260_01_ePub_RK.xhtml",
		level: 1,
		subitems: [
			{
				id: "what-is-latex",
				label: "什么是 LaTeX？",
				href: "Text/B17260_01_ePub_RK.xhtml#what-is-latex",
				level: 2,
				subitems: [
					{
						id: "intro",
						label: "LaTeX 入门指南",
						href: "Text/B17260_01_ePub_RK.xhtml#intro",
						level: 3,
					},
				],
			},
		],
	},
];

describe("annotation-chapter-metadata", () => {
	it("stores only the top-level TOC title even when the CFI points at a nested TOC anchor", () => {
		const metadata = resolveAnnotationChapterMetadata({
			tocItems: [
				{
					label: "Chapter 2",
					href: "OEBPS/chapter-2.xhtml#chapter-2",
					subitems: [
						{
							label: "Logical formatting",
							href: "OEBPS/chapter-2.xhtml#logic",
						},
					],
				},
			] as TocItem[],
			cfiRange: "epubcfi(/6/12!/4[chapter-2]/2[logic]/4/2,/1:0,/1:7)",
			sectionHref: "OEBPS/chapter-2.xhtml",
			spineIndex: 5,
		});

		expect(metadata).toEqual({
			chapterRootTitle: "Chapter 2",
			chapterTitle: "Chapter 2",
			chapterPath: ["Chapter 2"],
			chapterHref: "OEBPS/chapter-2.xhtml#chapter-2",
			spineIndex: 5,
		});
	});

	it("falls back to the top-level TOC title when the CFI only identifies the EPUB content file", () => {
		const metadata = resolveAnnotationChapterMetadata({
			tocItems: [
				{
					label: "Chapter 2",
					href: "OEBPS/B17260_02_ePub_RK.xhtml#chapter-2",
					subitems: [
						{
							label: "Logical formatting",
							href: "OEBPS/B17260_02_ePub_RK.xhtml#logic",
						},
						{
							label: "Making titled documents",
							href: "OEBPS/B17260_02_ePub_RK.xhtml#title-doc",
						},
					],
				},
			] as TocItem[],
			cfiRange: "epubcfi(/6/12!/4[B17260_02_ePub_RK]/2/24/2/4/2,/1:3,/5:53)",
			sectionHref: "OEBPS/B17260_02_ePub_RK.xhtml",
			spineIndex: 5,
			fallbackChapterTitle: "Making titled documents",
		});

		expect(metadata).toEqual({
			chapterRootTitle: "Chapter 2",
			chapterTitle: "Chapter 2",
			chapterPath: ["Chapter 2"],
			chapterHref: "OEBPS/B17260_02_ePub_RK.xhtml#chapter-2",
			spineIndex: 5,
		});
	});

	it("resolves chapter metadata from the same TOC anchor used by the sidebar", () => {
		const metadata = resolveAnnotationChapterMetadata({
			tocItems: latexToc,
			cfiRange:
				"epubcfi(/6/4!/4[B17260_FM_ePub_RK]/2[_idContainer000]/70[_idParaDest-3]/4/4/2,/1:0,/1:3)",
			sectionHref: "Text/B17260_FM_ePub_RK.xhtml",
			spineIndex: 1,
		});

		expect(metadata).toEqual({
			chapterRootTitle: "贡献者",
			chapterTitle: "贡献者",
			chapterPath: ["贡献者"],
			chapterHref: "Text/B17260_FM_ePub_RK.xhtml#_idParaDest-3",
			spineIndex: 1,
		});
	});

	it("does not match duplicate labels across different EPUB content files", () => {
		const metadata = resolveAnnotationChapterMetadata({
			tocItems: latexToc,
			cfiRange:
				"epubcfi(/6/4!/4[B17260_FM_ePub_RK]/2[_idContainer000],/16[_idParaDest-2]/4/4/2/1:0,/18/2/4/2/1:28)",
			sectionHref: "Text/B17260_FM_ePub_RK.xhtml",
			spineIndex: 1,
			fallbackChapterTitle: "LaTeX 入门指南",
		});

		expect(metadata.chapterPath).toEqual([]);
		expect(metadata.chapterTitle).toBeUndefined();
		expect(metadata.chapterRootTitle).toBeUndefined();
		expect(metadata.spineIndex).toBe(1);
	});

	it("applies resolved metadata without removing existing annotation fields", () => {
		const annotation = applyAnnotationChapterMetadata(
			{
				cfiRange: "epubcfi(/6/4!/4[B17260_FM_ePub_RK]/2[_idContainer000]/70[_idParaDest-3])",
				semanticId: "related-work",
				text: "贡献者",
				chapterIndex: 1,
				chapterTitle: "LaTeX 入门指南",
			},
			{
				chapterRootTitle: "贡献者",
				chapterTitle: "贡献者",
				chapterPath: ["贡献者"],
				chapterHref: "Text/B17260_FM_ePub_RK.xhtml#_idParaDest-3",
				spineIndex: 1,
			}
		);

		expect(annotation).toMatchObject({
			semanticId: "related-work",
			text: "贡献者",
			chapterIndex: 1,
			chapterTitle: "贡献者",
			chapterRootTitle: "贡献者",
			chapterPath: ["贡献者"],
			chapterHref: "Text/B17260_FM_ePub_RK.xhtml#_idParaDest-3",
			spineIndex: 1,
		});
	});
});
