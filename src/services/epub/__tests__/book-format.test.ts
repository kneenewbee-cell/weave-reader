import { createSupportedBookWikilinkRegex } from "../book-link-patterns";
import {
	getBookExtensionFromPath,
	isFreeBookFormat,
	isSupportedBookLocatorHref,
	isSupportedBookPath,
	isSupportedBookWikilinkMarkup,
	splitSupportedBookLocatorHref,
	stripSupportedBookExtension,
	usesFoliateGenericBookLoader,
} from "../book-format";

describe("book-format", () => {
	it("treats epub and txt as free book formats", () => {
		expect(isFreeBookFormat("Books/demo.epub")).toBe(true);
		expect(isFreeBookFormat("Books/novel.txt")).toBe(true);
		expect(isFreeBookFormat("txt")).toBe(true);
		expect(isFreeBookFormat("Books/demo.mobi")).toBe(false);
	});

	it("recognizes cbz as a supported foliate generic book format", () => {
		expect(getBookExtensionFromPath("Books/demo.cbz")).toBe("cbz");
		expect(isSupportedBookPath("Books/demo.cbz")).toBe(true);
		expect(usesFoliateGenericBookLoader("Books/demo.cbz")).toBe(true);
		expect(stripSupportedBookExtension("demo.cbz")).toBe("demo");
	});

	it("matches supported book wikilinks across extensions", () => {
		const txtMarkup =
			"[[Books/novel.txt#weave-cfi=epubcfi(/6/2)&text=Hello|novel]]";
		expect(createSupportedBookWikilinkRegex("i").test(txtMarkup)).toBe(true);
		expect(isSupportedBookWikilinkMarkup(txtMarkup)).toBe(true);
		expect(isSupportedBookWikilinkMarkup("[[Books/novel.txt|novel]]")).toBe(false);
	});

	it("detects supported locator hrefs for non-epub book extensions", () => {
		const href =
			"附件/demo.mobi#weave-cfi=epubcfi(/6/62!/4/12,/1:0,/1:136)";

		expect(isSupportedBookLocatorHref(href)).toBe(true);
		expect(splitSupportedBookLocatorHref(href)).toEqual({
			filePath: "附件/demo.mobi",
			subpath: "#weave-cfi=epubcfi(/6/62!/4/12,/1:0,/1:136)",
		});
		expect(isSupportedBookLocatorHref("Books/demo.epub")).toBe(false);
	});
});
