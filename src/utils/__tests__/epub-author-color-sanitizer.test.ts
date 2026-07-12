import {
	sanitizeLegacyAuthorColorAttributes,
	stripAuthorColorDeclarations,
	stripInlineAuthorColorStyles,
} from "../epub-author-color-sanitizer";

describe("epub-author-color-sanitizer", () => {
	it("strips inline author color declarations while preserving layout styles", () => {
		expect(
			stripInlineAuthorColorStyles(
				"margin: 1em; color: #111 !important; background-color: white; padding: 2px;"
			)
		).toBe("margin: 1em; padding: 2px");
	});

	it("strips author color declarations from flat css rules", () => {
		const css = "body { color: #000; margin: 0; background-color: #fff; } p { color: red !important; }";
		const stripped = stripAuthorColorDeclarations(css);
		expect(stripped).toContain("margin: 0");
		expect(stripped).not.toMatch(/\bcolor\s*:/);
		expect(stripped).not.toMatch(/\bbackground-color\s*:/);
	});

	it("strips author color declarations inside media queries", () => {
		const css = `@media (prefers-color-scheme: dark) {
			body { color: #111; background: #fff; }
			p { margin: 1em; color: black !important; }
		}`;
		const stripped = stripAuthorColorDeclarations(css);
		expect(stripped).toContain("margin: 1em");
		expect(stripped).not.toMatch(/\bcolor\s*:/);
		expect(stripped).not.toMatch(/\bbackground\s*:\s*#/);
	});

	it("removes legacy bgcolor and color attributes", () => {
		const doc = document.implementation.createHTMLDocument("chapter");
		doc.body.innerHTML =
			'<p bgcolor="#ffffff" color="#000000">text</p><font color="#ff0000">red</font>';
		sanitizeLegacyAuthorColorAttributes(doc);
		expect(doc.querySelector("p")?.getAttribute("bgcolor")).toBeNull();
		expect(doc.querySelector("p")?.getAttribute("color")).toBeNull();
		expect(doc.querySelector("font")?.getAttribute("color")).toBeNull();
	});
});
