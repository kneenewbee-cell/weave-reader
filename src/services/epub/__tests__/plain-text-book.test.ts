import { describe, expect, it } from "vitest";
import * as EpubCfi from "../epub-cfi";
import { makePlainTextBook } from "../plain-text-book";

function buildRangeCfi(sectionIndex: number, doc: Document, element: Element): string {
	const range = doc.createRange();
	range.selectNodeContents(element);
	const inner = EpubCfi.fromRange(range).replace(/^epubcfi\(/, "").replace(/\)$/, "");
	return EpubCfi.joinIndir(EpubCfi.fake.fromIndex(sectionIndex), inner);
}

describe("makePlainTextBook", () => {
	it("exposes section cfis and resolveCFI for foliate highlight rendering", async () => {
		const book = makePlainTextBook({
			fileName: "novel.txt",
			text: "第一章 开端\n\n第一段摘录测试内容。\n\n第二段继续阅读。",
		});

		expect(book.sections).toHaveLength(1);
		expect(book.sections[0]?.cfi).toBe(EpubCfi.fake.fromIndex(0));
		expect(typeof book.resolveCFI).toBe("function");

		const sectionDoc = await book.sections[0]!.createDocument();
		const paragraph = Array.from(
			sectionDoc.querySelectorAll('[data-weave-txt-paragraph="true"]')
		).find((node) => (node.textContent || "").includes("第一段摘录测试内容"));
		expect(paragraph).toBeTruthy();

		const cfi = buildRangeCfi(0, sectionDoc, paragraph!);
		const resolved = book.resolveCFI(cfi);

		expect(resolved).toEqual(
			expect.objectContaining({
				index: 0,
			})
		);
		expect(resolved?.anchor(sectionDoc)).toBeTruthy();
	});

	it("maps section base cfis to section indexes", () => {
		const book = makePlainTextBook({
			fileName: "sample.txt",
			text: "Alpha\n\nBeta",
		});

		for (const [index, section] of book.sections.entries()) {
			const resolved = book.resolveCFI(section.cfi);
			expect(resolved?.index).toBe(index);
		}
	});
});
