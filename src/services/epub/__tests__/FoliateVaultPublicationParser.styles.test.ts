import * as blobUrlText from "../../../utils/blob-url-text";
import { inlineFoliateBlobMarkup } from "../foliate-blob-markup-normalizer";
import { FoliateVaultPublicationParser } from "../FoliateVaultPublicationParser";

describe("FoliateVaultPublicationParser stylesheet normalization", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("inlines blob stylesheets into style tags instead of data URLs", async () => {
		const parser = new FoliateVaultPublicationParser({} as any);
		vi.spyOn(blobUrlText, "readBlobUrlAsText").mockImplementation(async (href: string) => {
			if (href === "blob:chapter.css") {
				return '@import "blob:nested.css"; @import url("https://fonts.googleapis.com/css2?family=Noto+Sans"); body { color: red; }';
			}
			if (href === "blob:nested.css") {
				return "p { margin: 0; }";
			}
			throw new Error(`Unexpected blob read for ${href}`);
		});

		const transformed = await (parser as any).inlineFoliateBlobStylesheets(
			`<html xmlns="http://www.w3.org/1999/xhtml">
				<head>
					<link rel="stylesheet" href="blob:chapter.css" media="screen"/>
					<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"/>
				</head>
				<body><p>hello</p></body>
			</html>`,
			"application/xhtml+xml"
		);

		expect(transformed).not.toContain("data:text/css");
		expect(transformed).not.toContain("fonts.googleapis.com");

		const doc = new DOMParser().parseFromString(transformed, "application/xhtml+xml");
		expect(doc.querySelectorAll('link[rel~="stylesheet"]').length).toBe(0);

		const inlineStyle = doc.querySelector('style[data-weave-inline-stylesheet="true"]');
		expect(inlineStyle).toBeTruthy();
		expect(inlineStyle?.getAttribute("media")).toBe("screen");
		expect(inlineStyle?.textContent).not.toContain("color: red");
		expect(inlineStyle?.textContent).toContain("margin: 0");
		expect(inlineStyle?.textContent).not.toContain("@import");
	});

	it("strips remote font sources from existing style elements", async () => {
		const parser = new FoliateVaultPublicationParser({} as any);
		vi.spyOn(blobUrlText, "readBlobUrlAsText").mockImplementation(async (href: string) => {
			if (href === "blob:theme.css") {
				return "h1 { letter-spacing: 0.1em; }";
			}
			throw new Error(`Unexpected blob read for ${href}`);
		});

		const transformed = await (parser as any).inlineFoliateBlobStylesheets(
			`<html>
				<head>
					<style>
						@import url("blob:theme.css");
						@font-face {
							font-family: "RemoteFont";
							src: url("https://fonts.gstatic.com/s/remotefont.woff2") format("woff2"), local("Arial");
						}
						body { font-family: "RemoteFont", serif; }
					</style>
				</head>
				<body><h1>hello</h1></body>
			</html>`,
			"text/html"
		);

		expect(transformed).not.toContain("fonts.gstatic.com");

		const doc = new DOMParser().parseFromString(transformed, "text/html");
		const style = doc.querySelector("style");
		expect(style?.textContent).toContain('local("Arial")');
		expect(style?.textContent).toContain("letter-spacing: 0.1em");
		expect(style?.textContent).not.toContain("https://");
	});

	it("strips author color declarations from inline and linked stylesheets", async () => {
		const parser = new FoliateVaultPublicationParser({} as any);
		vi.spyOn(blobUrlText, "readBlobUrlAsText").mockImplementation(async (href: string) => {
			if (href === "blob:chapter.css") {
				return "body { color: #111 !important; background-color: #fff; }";
			}
			throw new Error(`Unexpected blob read for ${href}`);
		});

		const transformed = await (parser as any).inlineFoliateBlobStylesheets(
			`<html>
				<head>
					<link rel="stylesheet" href="blob:chapter.css"/>
				</head>
				<body>
					<p style="color: #222; margin: 1em;">hello</p>
					<p bgcolor="#ffffff" color="#000000">legacy</p>
				</body>
			</html>`,
			"text/html"
		);

		const doc = new DOMParser().parseFromString(transformed, "text/html");
		expect(doc.querySelector("style")?.textContent).not.toMatch(/\bcolor\s*:/);
		expect(doc.querySelector("style")?.textContent).not.toMatch(/\bbackground-color\s*:/);
		expect(doc.querySelector("p")?.getAttribute("style")).toBe("margin: 1em");
		expect(doc.querySelectorAll("p")[1]?.getAttribute("bgcolor")).toBeNull();
		expect(doc.querySelectorAll("p")[1]?.getAttribute("color")).toBeNull();
	});

	it("removes epub content-security-policy meta tags", async () => {
		const transformed = await inlineFoliateBlobMarkup(
			`<html>
				<head>
					<meta http-equiv="Content-Security-Policy" content="style-src 'unsafe-inline' 'self' https://fonts.googleapis.com">
					<style>body { margin: 0; }</style>
				</head>
				<body><p>hello</p></body>
			</html>`,
			"text/html"
		);

		const doc = new DOMParser().parseFromString(transformed, "text/html");
		expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')).toBeNull();
		expect(doc.querySelector("style")?.textContent).toContain("margin: 0");
	});

	it("drops unreadable blob stylesheet links instead of leaving blocked hrefs", async () => {
		vi.spyOn(blobUrlText, "readBlobUrlAsText").mockRejectedValue(new Error("revoked"));

		const transformed = await inlineFoliateBlobMarkup(
			`<html>
				<head>
					<link rel="stylesheet" href="blob:app://obsidian.md/missing.css"/>
				</head>
				<body><p>hello</p></body>
			</html>`,
			"text/html"
		);

		expect(transformed).not.toContain("blob:app://obsidian.md/missing.css");
		const doc = new DOMParser().parseFromString(transformed, "text/html");
		expect(doc.querySelectorAll('link[rel~="stylesheet"]').length).toBe(0);
	});

	it("removes scripted epub content while preserving readable markup", async () => {
		const parser = new FoliateVaultPublicationParser({} as any);

		const transformed = await (parser as any).inlineFoliateBlobStylesheets(
			`<html>
				<head>
					<meta http-equiv="refresh" content="0;url=javascript:alert('x')">
					<script>alert('x')</script>
				</head>
				<body onload="alert('x')">
					<a href="javascript:alert('x')" onclick="alert('x')">bad link</a>
					<iframe src="https://example.com/embed"></iframe>
					<object data="movie.swf"></object>
					<p>safe text</p>
				</body>
			</html>`,
			"text/html"
		);

		const doc = new DOMParser().parseFromString(transformed, "text/html");
		expect(doc.querySelector("script")).toBeNull();
		expect(doc.querySelector("iframe")).toBeNull();
		expect(doc.querySelector("object")).toBeNull();
		expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull();
		expect(doc.body.getAttribute("onload")).toBeNull();
		expect(doc.querySelector("a")?.getAttribute("href")).toBeNull();
		expect(doc.querySelector("a")?.getAttribute("onclick")).toBeNull();
		expect(doc.querySelector("p")?.textContent).toBe("safe text");
	});

	it("sanitizes loader-repaired HTML before Foliate renders sections", () => {
		const parser = new FoliateVaultPublicationParser({} as any);
		const repaired = (parser as any).repairMarkupText(
			`<html><body onload="alert('x')"><script>alert('x')</script><p>safe text</p></body></html>`,
			"application/xhtml+xml",
			"OEBPS/Text/chapter-1.xhtml"
		);
		const doc = new DOMParser().parseFromString(repaired, "application/xhtml+xml");
		expect(doc.querySelector("script")).toBeNull();
		expect(doc.querySelector("body")?.getAttribute("onload")).toBeNull();
		expect(doc.querySelector("p")?.textContent).toBe("safe text");
	});

	it("repairs document-like hrefs even when manifest media type is non-html", async () => {
		const parser = new FoliateVaultPublicationParser({} as any);
		const parserAny = parser as any;
		parserAny.findArchiveEntry = vi.fn(() => ({
			async: vi.fn(async () =>
				`<html><body onload="alert('x')"><script>alert('x')</script><p>safe text</p></body></html>`
			),
		}));
		parserAny.inferMimeType = vi.fn(() => "application/xml");
		parserAny.normalizeSectionHref = vi.fn((value: string) => value);
		const loader = parserAny.createFoliateLoader();
		const result = await loader.loadText("Text/chapter-1.xhtml");
		const doc = new DOMParser().parseFromString(String(result || ""), "application/xhtml+xml");
		expect(doc.querySelector("script")).toBeNull();
		expect(doc.querySelector("body")?.getAttribute("onload")).toBeNull();
		expect(doc.querySelector("p")?.textContent).toBe("safe text");
	});
});
