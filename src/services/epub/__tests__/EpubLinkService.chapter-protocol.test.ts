import { describe, expect, it, vi } from "vitest";
import { EPUB_RUNTIME } from "../epub-runtime";
import { EpubLinkService } from "../EpubLinkService";

describe("EpubLinkService chapter protocol", () => {
	it("builds href-only obsidian protocol links", () => {
		const service = new EpubLinkService({} as never);
		const href = service.buildObsidianProtocolHrefForChapter(
			"Books/demo.epub",
			"Text/chapter1.xhtml",
			{ sourceId: "epubsrc-demo", chapter: 3 }
		);

		expect(href.startsWith(`obsidian://${EPUB_RUNTIME.protocol.primaryName}?`)).toBe(true);
		expect(href).toContain("file=Books%2Fdemo.epub");
		expect(href).toContain("href=Text%2Fchapter1.xhtml");
		expect(href).toContain("chapter=3");
		expect(href).toContain("sid=epubsrc-demo");
		expect(href).not.toContain("cfi=");
	});

	it("parses href-only protocol params", () => {
		expect(
			EpubLinkService.parseProtocolParams({
				file: "Books/demo.epub",
				href: "Text/chapter1.xhtml",
				sid: "epubsrc-demo",
			})
		).toEqual({
			filePath: "Books/demo.epub",
			cfi: "",
			text: "",
			sourceId: "epubsrc-demo",
			tocHref: "Text/chapter1.xhtml",
			chapter: undefined,
		});
	});

	it("parses file-only return protocol params", () => {
		expect(
			EpubLinkService.parseProtocolParams({
				file: "Books/demo.epub",
				sid: "epubsrc-demo",
			})
		).toEqual({
			filePath: "Books/demo.epub",
			cfi: "",
			text: "",
			sourceId: "epubsrc-demo",
			tocHref: undefined,
			chapter: undefined,
		});
	});

	it("parses locate flash protocol params", () => {
		expect(
			EpubLinkService.parseProtocolParams({
				file: "Books/demo.epub",
				cfi: "epubcfi(/6/2)",
				flashStyle: "pulse",
				flashColor: "yellow",
				showLocateOverlay: "true",
			})
		).toEqual({
			filePath: "Books/demo.epub",
			cfi: "epubcfi(/6/2)",
			text: "",
			chapter: undefined,
			sourceId: undefined,
			tocHref: undefined,
			flashStyle: "pulse",
			flashColor: "yellow",
			showLocateOverlay: true,
		});
	});

	it("builds markdown chapter links", () => {
		const service = new EpubLinkService({} as never);
		const markdown = service.buildProtocolMarkdownLinkForChapter(
			"Books/demo.epub",
			"Text/chapter1.xhtml",
			"第一章",
			"epubsrc-demo"
		);

		expect(markdown).toMatch(/^\[[^\]]+\]\(obsidian:\/\//);
		expect(markdown).toContain("href=Text%2Fchapter1.xhtml");
	});
});
