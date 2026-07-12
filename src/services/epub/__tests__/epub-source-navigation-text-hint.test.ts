import { resolveEpubSourceNavigationTextHint } from "../epub-source-navigation-text-hint";

describe("resolveEpubSourceNavigationTextHint", () => {
	it("prefers text embedded in the link metadata", () => {
		expect(
			resolveEpubSourceNavigationTextHint(
				{ cfi: "epubcfi(/6/2)", text: "Embedded quote" },
				"Edited callout quote"
			)
		).toBe("Embedded quote");
	});

	it("ignores editable callout quote text when a CFI locator exists", () => {
		expect(
			resolveEpubSourceNavigationTextHint(
				{ cfi: "epubcfi(/6/2)", text: "" },
				"User edited this excerpt body"
			)
		).toBe("");
	});

	it("ignores editable callout quote text when only an href locator exists", () => {
		expect(
			resolveEpubSourceNavigationTextHint(
				{ href: "OPS/text/chapter1.xhtml#sec-1", text: "" },
				"User edited this excerpt body"
			)
		).toBe("");
	});

	it("falls back to callout quote text only for legacy links without CFI", () => {
		expect(
			resolveEpubSourceNavigationTextHint({ cfi: "", text: "" }, "Legacy quote fallback")
		).toBe("Legacy quote fallback");
	});
});
