vi.mock("obsidian", () => ({
	App: class MockApp {},
	TFile: class MockTFile {},
	ItemView: class MockItemView {},
	WorkspaceLeaf: class MockWorkspaceLeaf {},
	MarkdownView: class MockMarkdownView {},
	Notice: class MockNotice {
		constructor(_message?: string) {}
	},
	Menu: class MockMenu {},
	Modal: class MockModal {},
	Plugin: class MockPlugin {},
	PluginSettingTab: class MockPluginSettingTab {},
	Platform: { isMobile: false },
	MarkdownPostProcessorContext: class MarkdownPostProcessorContext {},
	MarkdownRenderer: {
		render: vi.fn(
			async (
				_app: unknown,
				markdown: string,
				el: HTMLElement,
				_sourcePath: string,
			) => {
				el.textContent = markdown;
			},
		),
	},
	Component: class MockComponent {},
	setIcon: vi.fn(),
	normalizePath: (value: string) =>
		String(value || "")
			.replace(/\\/g, "/")
			.replace(/\/+/g, "/")
			.replace(/\/$/, ""),
}));

import { createEpubLinkPostProcessor } from "../EpubLinkPostProcessor";
import { EpubLinkService } from "../EpubLinkService";
import { EPUB_DUAL_WINDOW_ANNOTATION_EVENT } from "../epub-dual-window";
import { EPUB_AI_READING_ALL_SCOPE_ID } from "../epub-ai-reading-scope";
import { registerEpubHost, unregisterEpubHost } from "../epub-host";
import { MarkdownRenderer, TFile } from "obsidian";

beforeAll(() => {
	Object.defineProperty(HTMLElement.prototype, "addClass", {
		configurable: true,
		value(this: HTMLElement, className: string) {
			this.classList.add(className);
		},
	});
	Object.defineProperty(HTMLElement.prototype, "removeClass", {
		configurable: true,
		value(this: HTMLElement, className: string) {
			this.classList.remove(className);
		},
	});
	Object.defineProperty(HTMLElement.prototype, "empty", {
		configurable: true,
		value(this: HTMLElement) {
			this.replaceChildren();
		},
	});
	Object.defineProperty(HTMLElement.prototype, "createSpan", {
		configurable: true,
		value(this: HTMLElement, options?: { cls?: string; text?: string }) {
			const span = document.createElement("span");
			if (options?.cls) {
				span.className = options.cls;
			}
			if (options?.text) {
				span.textContent = options.text;
			}
			this.appendChild(span);
			return span;
		},
	});
});

describe("EpubLinkPostProcessor", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("applies derived EPUB callout color and style attributes for combined metadata", () => {
		const container = document.createElement("div");
		container.innerHTML = [
			'<div class="callout" data-callout="epub" data-callout-metadata="purple+wavy"></div>',
			'<div class="callout" data-callout="epub" data-callout-metadata="underline red"></div>',
			'<div class="callout" data-callout="epub"></div>',
		].join("");

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, {} as any);

		const callouts = Array.from(
			container.querySelectorAll<HTMLElement>('.callout[data-callout="epub"]'),
		);
		expect(callouts[0]?.getAttribute("data-weave-epub-color")).toBe("purple");
		expect(callouts[0]?.getAttribute("data-weave-epub-style")).toBe("wavy");
		expect(callouts[1]?.getAttribute("data-weave-epub-color")).toBe("red");
		expect(callouts[1]?.getAttribute("data-weave-epub-style")).toBe(
			"underline",
		);
		expect(callouts[2]?.hasAttribute("data-weave-epub-color")).toBe(false);
		expect(callouts[2]?.hasAttribute("data-weave-epub-style")).toBe(false);
	});

	it("does not double-bind EPUB link click handlers when the same element is processed repeatedly", async () => {
		const navigateSpy = vi
			.spyOn(EpubLinkService.prototype, "navigateToEpubLocation")
			.mockResolvedValue(undefined);

		const container = document.createElement("div");
		container.innerHTML =
			'<a class="internal-link" href="Books/demo.epub#weave-cfi=readium%3Aabc&text=Hello%20world">Demo</a>';

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, {} as any);
		processor(container, {} as any);

		const link = container.querySelector("a");
		expect(link).not.toBeNull();

		link!.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);

		expect(navigateSpy).toHaveBeenCalledTimes(1);
		expect(navigateSpy).toHaveBeenCalledWith(
			"Books/demo.epub",
			"readium:abc",
			"Hello world",
			undefined,
			undefined,
		);
	});

	it("binds MOBI excerpt source links and routes clicks through navigateToEpubLocation", async () => {
		const navigateSpy = vi
			.spyOn(EpubLinkService.prototype, "navigateToEpubLocation")
			.mockResolvedValue(undefined);

		const container = document.createElement("div");
		container.innerHTML = [
			'<div class="callout" data-callout="epub" data-callout-metadata="red">',
			'  <div class="callout-title">',
			'    <a class="internal-link" href="附件/demo.mobi#weave-cfi=epubcfi(/6/62!/4/12,/1:0,/1:136)">Jobs</a>',
			"  </div>",
			'  <div class="callout-content">',
			"    <blockquote><p>七月，李·克劳接到史蒂夫·乔布斯的电话。</p></blockquote>",
			"  </div>",
			"</div>",
		].join("");

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, {} as any);

		const link = container.querySelector("a");
		expect(link).not.toBeNull();

		link!.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);

		expect(navigateSpy).toHaveBeenCalledTimes(1);
		expect(navigateSpy).toHaveBeenCalledWith(
			"附件/demo.mobi",
			"epubcfi(/6/62!/4/12,/1:0,/1:136)",
			"",
			undefined,
			undefined,
		);
	});

	it("ignores edited callout quote text for weave-loc links and navigates by CFI only", async () => {
		const navigateSpy = vi
			.spyOn(EpubLinkService.prototype, "navigateToEpubLocation")
			.mockResolvedValue(undefined);

		const container = document.createElement("div");
		container.innerHTML = [
			'<div class="callout" data-callout="epub" data-callout-metadata="blue">',
			'  <div class="callout-title">',
			'    <a class="internal-link" href="附件/demo.epub#weave-loc=compact-locator&eid=excerpt-fixed&sid=epubsrc-demo">Demo</a>',
			"  </div>",
			'  <div class="callout-content">',
			"    <blockquote><p>User edited excerpt body that no longer matches the book.</p></blockquote>",
			"  </div>",
			"</div>",
		].join("");

		vi.spyOn(EpubLinkService, "parseEpubLink").mockReturnValue({
			filePath: "",
			cfi: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
			text: "",
			sourceId: "epubsrc-demo",
			excerptId: "excerpt-fixed",
		});

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, {} as any);

		const link = container.querySelector("a");
		expect(link).not.toBeNull();

		link!.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);

		expect(navigateSpy).toHaveBeenCalledTimes(1);
		expect(navigateSpy).toHaveBeenCalledWith(
			"附件/demo.epub",
			"epubcfi(/6/2!/4/2,/1:0,/1:9)",
			"",
			"epubsrc-demo",
			undefined,
		);
	});

	it("rewrites protocol markdown links to internal locator hrefs before navigation", async () => {
		const navigateSpy = vi
			.spyOn(EpubLinkService.prototype, "navigateToEpubLocation")
			.mockResolvedValue(undefined);

		const container = document.createElement("div");
		container.innerHTML =
			'<a class="external-link" href="obsidian://weave-epub?file=Books%2Fdemo.epub&cfi=epubcfi(/6/2)&chapter=3&sid=epubsrc-demo">Demo</a>';

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, {} as any);

		const link = container.querySelector("a");
		expect(link).not.toBeNull();
		expect(link!.getAttribute("href")).toBe(
			"Books/demo.epub#weave-cfi=epubcfi(/6/2)&chapter=3&sid=epubsrc-demo",
		);
		expect(link!.classList.contains("internal-link")).toBe(true);

		link!.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);

		expect(navigateSpy).toHaveBeenCalledTimes(1);
		expect(navigateSpy).toHaveBeenCalledWith(
			"Books/demo.epub",
			"epubcfi(/6/2)",
			"",
			"epubsrc-demo",
			undefined,
		);
	});

	it("preserves annotation note styled snippet links for native protocol handling", async () => {
		const navigateSpy = vi
			.spyOn(EpubLinkService.prototype, "navigateToEpubLocation")
			.mockResolvedValue(undefined);

		const container = document.createElement("div");
		container.innerHTML = [
			'<div class="weave-annotation-note-line">',
			'  <a href="obsidian://weave-epub?file=Books%2Fdemo.epub&cfi=epubcfi(/6/2)&chapter=3&sid=epubsrc-demo">',
			'    <mark style="background: rgba(255, 224, 102, 0.62);">Styled text</mark>',
			"  </a>",
			"</div>",
		].join("");

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, {} as any);

		const link = container.querySelector("a");
		expect(link).not.toBeNull();
		expect(link!.getAttribute("href")).toContain("obsidian://weave-epub");
		expect(link!.classList.contains("weave-epub-link")).toBe(false);
		expect(container.querySelector("mark")?.textContent).toBe("Styled text");
		expect(navigateSpy).not.toHaveBeenCalled();
	});

	it("adds chapter and semantic filters to annotation notes", () => {
		const container = document.createElement("div");
		container.className = "markdown-rendered";
		container.innerHTML = [
			'<div class="weave-annotation-note-root" data-book-id="book-1"></div>',
			'<h2 class="weave-annotation-note-chapter" data-chapter-key="chapter-0">第一章</h2>',
			'<div class="weave-annotation-note-line" data-chapter-key="chapter-0" data-chapter-title="第一章" data-semantic-id="theorem" data-semantic-label="定理" data-annotation-text="alpha theorem">alpha</div>',
			'<div class="weave-annotation-note-line" data-chapter-key="chapter-0" data-chapter-title="第一章" data-semantic-id="mistake" data-semantic-label="易错" data-annotation-text="beta mistake">beta</div>',
			'<h2 class="weave-annotation-note-chapter" data-chapter-key="chapter-1">第二章</h2>',
			'<div class="weave-annotation-note-line" data-chapter-key="chapter-1" data-chapter-title="第二章" data-semantic-id="theorem" data-semantic-label="定理" data-annotation-text="gamma theorem">gamma</div>',
		].join("");

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, {
			sourcePath: "weave/epub-data/books/book-1/annotations.md",
		} as any);

		const toolbar = container.querySelector<HTMLElement>(
			".weave-annotation-note-filter",
		);
		expect(toolbar).not.toBeNull();
		expect(
			toolbar?.querySelector(".weave-annotation-note-filter-style"),
		).toBeNull();

		const chapterSelect = toolbar!.querySelector<HTMLSelectElement>(
			".weave-annotation-note-filter-chapter",
		);
		const semanticSelect = toolbar!.querySelector<HTMLSelectElement>(
			".weave-annotation-note-filter-semantic",
		);
		const searchInput = toolbar!.querySelector<HTMLInputElement>(
			".weave-annotation-note-filter-search",
		);
		const count = toolbar!.querySelector<HTMLElement>(
			".weave-annotation-note-filter-count",
		);
		expect(chapterSelect?.options.length).toBe(3);
		expect(semanticSelect?.options.length).toBe(3);
		expect(count?.textContent).toBe("3 / 3");

		semanticSelect!.value = "mistake";
		semanticSelect!.dispatchEvent(new Event("change"));
		expect(
			container.querySelectorAll(".weave-annotation-note-line:not(.is-hidden)")
				.length,
		).toBe(1);
		expect(count?.textContent).toBe("1 / 3");

		semanticSelect!.value = "";
		chapterSelect!.value = "chapter-1";
		chapterSelect!.dispatchEvent(new Event("change"));
		expect(
			container.querySelectorAll(".weave-annotation-note-line:not(.is-hidden)")
				.length,
		).toBe(1);
		expect(
			container
				.querySelector<HTMLElement>(
					'.weave-annotation-note-chapter[data-chapter-key="chapter-0"]',
				)
				?.classList.contains("is-hidden"),
		).toBe(true);

		searchInput!.value = "alpha";
		searchInput!.dispatchEvent(new Event("input"));
		expect(
			container.querySelectorAll(".weave-annotation-note-line:not(.is-hidden)")
				.length,
		).toBe(0);
		expect(count?.textContent).toBe("0 / 3");
	});

	it("uses the source markdown index when sourcePath is unavailable and a selected AI leaf range is not rendered", async () => {
		const notePath = "AI Reading Notes/demo - AI Reading.md";
		const noteMarkdown = [
			"## Visual layout",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 2 &gt; Visual layout &gt; All" data-scope-href="text/ch2.xhtml#layout"></div>',
			"## Range summary",
			"visual overview",
			"## Unit reading",
			"## U071 Chapter 2 > Visual layout > Steps...",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 2 &gt; Visual layout &gt; Steps..." data-scope-href="text/ch2.xhtml#steps" data-ai-unit-id="U071"></div>',
			"steps detail",
			"## U072 Chapter 2 > Visual layout > Principle...",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 2 &gt; Visual layout &gt; Principle..." data-scope-href="text/ch2.xhtml#principle" data-ai-unit-id="U072"></div>',
			"### 核心结论",
			"core detail from file",
			"### 章节关系",
			"relation detail from file",
			"principle detail from file",
			"## U073 Chapter 2 > Visual layout > More...",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 2 &gt; Visual layout &gt; More..." data-scope-href="text/ch2.xhtml#more" data-ai-unit-id="U073"></div>',
			"more detail",
		].join("\n");
		const loadPublicationTocItems = vi.fn(async () => [
			{
				id: "ch2",
				label: "Chapter 2",
				href: "text/ch2.xhtml",
				level: 1,
				subitems: [
					{
						id: "visual-layout",
						label: "Visual layout",
						href: "text/ch2.xhtml#layout",
						level: 2,
						subitems: [
							{
								id: "principle",
								label: "Principle...",
								href: "text/ch2.xhtml#principle",
								level: 3,
							},
						],
					},
				],
			},
		]);
		const noteFile = Object.assign(new TFile(), {
			path: notePath,
			extension: "md",
		});
		const app = {
			plugins: { getPlugin: vi.fn(() => null) },
			loadPublicationTocItems,
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === notePath ? noteFile : null,
				),
				getMarkdownFiles: vi.fn(() => [noteFile]),
				cachedRead: vi.fn(async () => noteMarkdown),
			},
		} as any;
		registerEpubHost(app, {
			loadPublicationTocItems,
		});
		const container = document.createElement("div");
		container.className = "markdown-rendered";
		container.innerHTML = [
			'<div class="el-h2"><h2>Visual layout</h2></div>',
			'<div class="el-div"><div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 2 &gt; Visual layout &gt; All" data-scope-href="text/ch2.xhtml#layout"></div></div>',
			'<div class="el-h2"><h2>Range summary</h2></div><div class="el-p"><p>visual overview</p></div>',
		].join("");

		const processor = createEpubLinkPostProcessor(app);
		processor(container, {} as any);
		await new Promise((resolve) => setTimeout(resolve, 100));

		const toolbar = container.querySelector<HTMLElement>(
			".weave-epub-ai-reading-note-filter",
		);
		const rangeSelects = () =>
			Array.from(
				toolbar!.querySelectorAll<HTMLSelectElement>(
					".weave-epub-ai-reading-note-range-select",
				),
			);
		rangeSelects()[0]!.value = "ch2";
		rangeSelects()[0]!.dispatchEvent(new Event("change"));
		rangeSelects()[1]!.value = "visual-layout";
		rangeSelects()[1]!.dispatchEvent(new Event("change"));
		rangeSelects()[2]!.value = "principle";
		rangeSelects()[2]!.dispatchEvent(new Event("change"));
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(
			container
				.querySelector<HTMLElement>(".weave-epub-ai-reading-note-missing")
				?.classList.contains("is-hidden"),
		).toBe(true);
		expect(
			container.querySelector<HTMLElement>(
				".weave-epub-ai-reading-note-source-preview",
			)?.textContent,
		).toContain("principle detail from file");
		expect(
			container.querySelector<HTMLElement>(".el-p"),
		).toBeNull();
		expect(
			container.querySelector<HTMLElement>(".el-h2"),
		).toBeNull();
		const originalRangeSummaryHeading = Array.from(
			container.querySelectorAll<HTMLElement>(".el-h2"),
		).find((element) => element.textContent?.includes("Range summary"));
		expect(originalRangeSummaryHeading).toBeUndefined();
		const typeSelect = toolbar!.querySelector<HTMLSelectElement>(
			".weave-epub-ai-reading-note-filter-type",
		);
		typeSelect!.value = "relations";
		typeSelect!.dispatchEvent(new Event("change"));
		await new Promise((resolve) => setTimeout(resolve, 30));
		const filteredPreviewText = container.querySelector<HTMLElement>(
			".weave-epub-ai-reading-note-source-preview",
		)?.textContent;
		expect(filteredPreviewText).toContain("relation detail from file");
		expect(filteredPreviewText).not.toContain("core detail from file");
		const lateHeading = document.createElement("div");
		lateHeading.className = "el-h2";
		lateHeading.innerHTML = "<h2>Range summary</h2>";
		const lateParagraph = document.createElement("div");
		lateParagraph.className = "el-p";
		lateParagraph.innerHTML = "<p>late stale overview</p>";
		const lateUnknownBlock = document.createElement("div");
		lateUnknownBlock.className = "obsidian-lazy-rendered-block";
		lateUnknownBlock.textContent = "late unknown stale overview";
		container.append(lateHeading, lateParagraph, lateUnknownBlock);
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(
			container.classList.contains(
				"weave-epub-ai-reading-note-source-active",
			),
		).toBe(true);
		const modeEl = container.querySelector<HTMLElement>(
			".weave-epub-ai-reading-note-render-mode",
		);
		expect(modeEl?.dataset.mode).toBe("source-detach");
		expect(modeEl?.textContent).toContain("source-detach");
		expect(modeEl?.textContent).toContain("scroll: isolated");
		const sourceHost = container.querySelector<HTMLElement>(".el-div");
		expect(
			sourceHost?.classList.contains(
				"weave-epub-ai-reading-note-source-host-active",
			),
		).toBe(true);
		expect(container.contains(lateHeading)).toBe(false);
		expect(container.contains(lateParagraph)).toBe(false);
		expect(container.contains(lateUnknownBlock)).toBe(false);
		unregisterEpubHost(app);
	});

	it("keeps the source preview DOM stable when filters refresh without changes", async () => {
		const notePath = "AI Reading Notes/demo - AI Reading.md";
		const noteMarkdown = [
			"## Visual layout",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 2 &gt; Visual layout &gt; All" data-scope-href="text/ch2.xhtml#layout"></div>',
			"## Range summary",
			"visual overview",
			"## U072 Chapter 2 > Visual layout > Principle...",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 2 &gt; Visual layout &gt; Principle..." data-scope-href="text/ch2.xhtml#principle" data-ai-unit-id="U072"></div>',
			"### 鏍稿績缁撹",
			"core detail from file",
		].join("\n");
		const loadPublicationTocItems = vi.fn(async () => [
			{
				id: "ch2",
				label: "Chapter 2",
				href: "text/ch2.xhtml",
				level: 1,
				subitems: [
					{
						id: "visual-layout",
						label: "Visual layout",
						href: "text/ch2.xhtml#layout",
						level: 2,
						subitems: [
							{
								id: "principle",
								label: "Principle...",
								href: "text/ch2.xhtml#principle",
								level: 3,
							},
						],
					},
				],
			},
		]);
		const noteFile = Object.assign(new TFile(), {
			path: notePath,
			extension: "md",
		});
		const app = {
			plugins: { getPlugin: vi.fn(() => null) },
			loadPublicationTocItems,
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === notePath ? noteFile : null,
				),
				getMarkdownFiles: vi.fn(() => [noteFile]),
				cachedRead: vi.fn(async () => noteMarkdown),
			},
		} as any;
		registerEpubHost(app, {
			loadPublicationTocItems,
		});
		const renderMock = vi.mocked(MarkdownRenderer.render);
		renderMock.mockClear();
		const container = document.createElement("div");
		container.className = "markdown-rendered";
		container.innerHTML = [
			'<div class="el-h2"><h2>Visual layout</h2></div>',
			'<div class="el-div"><div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 2 &gt; Visual layout &gt; All" data-scope-href="text/ch2.xhtml#layout"></div></div>',
			'<div class="el-h2"><h2>Range summary</h2></div>',
			'<div class="el-p"><p>visual overview</p></div>',
		].join("");

		try {
			const processor = createEpubLinkPostProcessor(app);
			processor(container, { sourcePath: notePath } as any);
			await new Promise((resolve) => setTimeout(resolve, 30));

			const toolbar = container.querySelector<HTMLElement>(
				".weave-epub-ai-reading-note-filter",
			);
			const rangeSelects = () =>
				Array.from(
					toolbar!.querySelectorAll<HTMLSelectElement>(
						".weave-epub-ai-reading-note-range-select",
					),
				);
			rangeSelects()[0]!.value = "ch2";
			rangeSelects()[0]!.dispatchEvent(new Event("change"));
			rangeSelects()[1]!.value = "visual-layout";
			rangeSelects()[1]!.dispatchEvent(new Event("change"));
			rangeSelects()[2]!.value = "principle";
			rangeSelects()[2]!.dispatchEvent(new Event("change"));
			await new Promise((resolve) => setTimeout(resolve, 30));

			const callsAfterFirstRender = renderMock.mock.calls.length;
			const marker = container.querySelector<HTMLElement>(
				".weave-epub-ai-reading-note-root",
			) as any;
			marker.__weaveApplyAiReadingNoteFilters?.();
			marker.__weaveApplyAiReadingNoteFilters?.();
			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(
				container.querySelector<HTMLElement>(
					".weave-epub-ai-reading-note-source-preview",
				)?.textContent,
			).toContain("core detail from file");
			expect(renderMock.mock.calls.length).toBe(callsAfterFirstRender);
		} finally {
			unregisterEpubHost(app);
		}
	});

	it("renders the selected range from source markdown instead of the lazy note DOM", async () => {
		const notePath = "AI Reading Notes/demo - AI Reading.md";
		const noteMarkdown = [
			"## Image alignment",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; All" data-scope-href="text/ch5.xhtml#align"></div>',
			"## Range summary",
			"alignment overview from source",
			"## U191 Chapter 5 > Image alignment > Steps...",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; Steps..." data-scope-href="text/ch5.xhtml#steps" data-ai-unit-id="U191"></div>',
			"steps detail from source",
		].join("\n");
		const loadPublicationTocItems = vi.fn(async () => [
			{
				id: "ch5",
				label: "Chapter 5",
				href: "text/ch5.xhtml",
				level: 1,
				subitems: [
					{
						id: "align",
						label: "Image alignment",
						href: "text/ch5.xhtml#align",
						level: 2,
						subitems: [
							{
								id: "all-leaf",
								label: "All",
								href: "text/ch5.xhtml#align",
								level: 3,
							},
						],
					},
				],
			},
		]);
		const noteFile = Object.assign(new TFile(), {
			path: notePath,
			extension: "md",
		});
		const app = {
			plugins: { getPlugin: vi.fn(() => null) },
			loadPublicationTocItems,
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === notePath ? noteFile : null,
				),
				getMarkdownFiles: vi.fn(() => [noteFile]),
				cachedRead: vi.fn(async () => noteMarkdown),
			},
		} as any;
		registerEpubHost(app, {
			loadPublicationTocItems,
		});
		const container = document.createElement("div");
		container.className = "markdown-rendered";
		container.innerHTML = [
			'<div class="el-h2"><h2>Image alignment</h2></div>',
			'<div class="el-div"><div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; All" data-scope-href="text/ch5.xhtml#align"></div></div>',
			'<div class="el-h2"><h2>Range summary</h2></div>',
			'<div class="el-p"><p>alignment overview from rendered DOM</p></div>',
		].join("");

		try {
			const processor = createEpubLinkPostProcessor(app);
			processor(container, { sourcePath: notePath } as any);
			await new Promise((resolve) => setTimeout(resolve, 30));

			const toolbar = container.querySelector<HTMLElement>(
				".weave-epub-ai-reading-note-filter",
			);
			const rangeSelects = () =>
				Array.from(
					toolbar!.querySelectorAll<HTMLSelectElement>(
						".weave-epub-ai-reading-note-range-select",
					),
				);
			rangeSelects()[0]!.value = "ch5";
			rangeSelects()[0]!.dispatchEvent(new Event("change"));
			rangeSelects()[1]!.value = "align";
			rangeSelects()[1]!.dispatchEvent(new Event("change"));
			rangeSelects()[2]!.value = EPUB_AI_READING_ALL_SCOPE_ID;
			rangeSelects()[2]!.dispatchEvent(new Event("change"));
			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(
				container.classList.contains(
					"weave-epub-ai-reading-note-source-active",
				),
			).toBe(true);
			expect(
				container
					.querySelector<HTMLElement>(
						".weave-epub-ai-reading-note-source-preview",
					)
					?.classList.contains("is-hidden"),
			).toBe(false);
			expect(
				container
					.querySelector<HTMLElement>(".el-p"),
			).toBeNull();
			const sourceHost = container.querySelector<HTMLElement>(".el-div");
			const sourcePreview = container.querySelector<HTMLElement>(
				".weave-epub-ai-reading-note-source-preview",
			);
			expect(sourceHost?.contains(sourcePreview || null)).toBe(true);
			expect(sourceHost?.classList.contains("is-hidden")).toBe(false);
			expect(sourcePreview?.closest(".weave-epub-ai-reading-note-chrome")).not.toBeNull();
			const sourceRangeBlocks = Array.from(
				sourcePreview?.querySelectorAll<HTMLElement>(
					".weave-epub-ai-reading-note-source-range",
				) || [],
			);
			expect(sourceRangeBlocks.length).toBe(2);
			expect(sourceRangeBlocks[0]?.dataset.rangeKey).toBe(
				"Chapter 5 > Image alignment > All",
			);
			expect(sourceRangeBlocks[1]?.dataset.rangeKey).toBe(
				"Chapter 5 > Image alignment > Steps",
			);
			const previewText = sourcePreview?.textContent;
			expect(previewText).toContain("alignment overview from source");
			expect(previewText).toContain("steps detail from source");
			expect(previewText).not.toContain("alignment overview from rendered DOM");
		} finally {
			unregisterEpubHost(app);
		}
	});

	it("keeps rendered note content visible until the source preview is ready", async () => {
		const notePath = "AI Reading Notes/demo - AI Reading.md";
		const noteMarkdown = [
			"## Image alignment",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; All" data-scope-href="text/ch5.xhtml#align"></div>',
			"## Range summary",
			"alignment overview from source",
		].join("\n");
		const loadPublicationTocItems = vi.fn(async () => [
			{
				id: "ch5",
				label: "Chapter 5",
				href: "text/ch5.xhtml",
				level: 1,
				subitems: [
					{
						id: "align",
						label: "Image alignment",
						href: "text/ch5.xhtml#align",
						level: 2,
					},
				],
			},
		]);
		const noteFile = Object.assign(new TFile(), {
			path: notePath,
			extension: "md",
		});
		const app = {
			plugins: { getPlugin: vi.fn(() => null) },
			loadPublicationTocItems,
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === notePath ? noteFile : null,
				),
				getMarkdownFiles: vi.fn(() => [noteFile]),
				cachedRead: vi.fn(async () => noteMarkdown),
			},
		} as any;
		registerEpubHost(app, {
			loadPublicationTocItems,
		});
		const renderMock = vi.mocked(MarkdownRenderer.render);
		let finishRender: (() => void) | null = null;
		renderMock.mockImplementationOnce(
			(_app: unknown, markdown: string, el: HTMLElement) =>
				new Promise<void>((resolve) => {
					el.append(el.ownerDocument.createElement("div"));
					finishRender = () => {
						el.textContent = markdown;
						resolve();
					};
				}),
		);
		const container = document.createElement("div");
		container.className = "markdown-rendered";
		container.innerHTML = [
			'<div class="el-h2"><h2>Image alignment</h2></div>',
			'<div class="el-div"><div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; All" data-scope-href="text/ch5.xhtml#align"></div></div>',
			'<div class="el-h2"><h2>Range summary</h2></div>',
			'<div class="el-p"><p>alignment overview from rendered DOM</p></div>',
		].join("");

		try {
			const processor = createEpubLinkPostProcessor(app);
			processor(container, { sourcePath: notePath } as any);
			await new Promise((resolve) => setTimeout(resolve, 30));

			const toolbar = container.querySelector<HTMLElement>(
				".weave-epub-ai-reading-note-filter",
			);
			const rangeSelects = () =>
				Array.from(
					toolbar!.querySelectorAll<HTMLSelectElement>(
						".weave-epub-ai-reading-note-range-select",
					),
				);
			rangeSelects()[0]!.value = "ch5";
			rangeSelects()[0]!.dispatchEvent(new Event("change"));
			rangeSelects()[1]!.value = "align";
			rangeSelects()[1]!.dispatchEvent(new Event("change"));
			await new Promise((resolve) => setTimeout(resolve, 120));

			expect(
				container.classList.contains(
					"weave-epub-ai-reading-note-source-active",
				),
			).toBe(false);
			expect(
				container
					.querySelector<HTMLElement>(".el-p")
					?.classList.contains("is-hidden"),
			).toBe(false);

			finishRender?.();
			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(
				container.classList.contains(
					"weave-epub-ai-reading-note-source-active",
				),
			).toBe(true);
			expect(
				container
					.querySelector<HTMLElement>(".el-p"),
			).toBeNull();
			expect(
				container.querySelector<HTMLElement>(
					".weave-epub-ai-reading-note-source-preview",
				)?.textContent,
			).toContain("alignment overview from source");
		} finally {
			unregisterEpubHost(app);
		}
	});

	it("classifies leaf subsection headings by their own content type", async () => {
		const notePath = "AI Reading Notes/demo - AI Reading.md";
		const noteMarkdown = [
			"## Image alignment",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; All" data-scope-href="text/ch5.xhtml#align"></div>',
			"## U191 Chapter 5 > Image alignment > Steps...",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; Steps..." data-scope-href="text/ch5.xhtml#steps" data-ai-unit-id="U191"></div>',
			"### 小节摘要",
			"steps summary from source",
			"### 核心结论",
			"core detail from source",
			"### 关键知识点",
			"knowledge detail from source",
		].join("\n");
		const loadPublicationTocItems = vi.fn(async () => [
			{
				id: "ch5",
				label: "Chapter 5",
				href: "text/ch5.xhtml",
				level: 1,
				subitems: [
					{
						id: "align",
						label: "Image alignment",
						href: "text/ch5.xhtml#align",
						level: 2,
						subitems: [
							{
								id: "steps",
								label: "Steps...",
								href: "text/ch5.xhtml#steps",
								level: 3,
							},
						],
					},
				],
			},
		]);
		const noteFile = Object.assign(new TFile(), {
			path: notePath,
			extension: "md",
		});
		const app = {
			plugins: { getPlugin: vi.fn(() => null) },
			loadPublicationTocItems,
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === notePath ? noteFile : null,
				),
				getMarkdownFiles: vi.fn(() => [noteFile]),
				cachedRead: vi.fn(async () => noteMarkdown),
			},
		} as any;
		registerEpubHost(app, {
			loadPublicationTocItems,
		});
		const container = document.createElement("div");
		container.className = "markdown-rendered";
		container.innerHTML = [
			'<div class="el-h2"><h2>Image alignment</h2></div>',
			'<div class="el-div"><div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; All" data-scope-href="text/ch5.xhtml#align"></div></div>',
			'<div class="el-h2"><h2>U191 Chapter 5 &gt; Image alignment &gt; Steps...</h2></div>',
			'<div class="el-div"><div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; Steps..." data-scope-href="text/ch5.xhtml#steps" data-ai-unit-id="U191"></div></div>',
			'<div class="el-h3"><h3>小节摘要</h3></div>',
			'<div class="el-p"><p>steps summary from rendered DOM</p></div>',
			'<div class="el-h3"><h3>核心结论</h3></div>',
			'<div class="el-p"><p>core detail from rendered DOM</p></div>',
			'<div class="el-h3"><h3>关键知识点</h3></div>',
			'<div class="el-p"><p>knowledge detail from rendered DOM</p></div>',
		].join("");

		try {
			const processor = createEpubLinkPostProcessor(app);
			processor(container, { sourcePath: notePath } as any);
			await new Promise((resolve) => setTimeout(resolve, 30));

			const toolbar = container.querySelector<HTMLElement>(
				".weave-epub-ai-reading-note-filter",
			);
			const rangeSelects = () =>
				Array.from(
					toolbar!.querySelectorAll<HTMLSelectElement>(
						".weave-epub-ai-reading-note-range-select",
					),
				);
			rangeSelects()[0]!.value = "ch5";
			rangeSelects()[0]!.dispatchEvent(new Event("change"));
			rangeSelects()[1]!.value = "align";
			rangeSelects()[1]!.dispatchEvent(new Event("change"));
			rangeSelects()[2]!.value = "steps";
			rangeSelects()[2]!.dispatchEvent(new Event("change"));
			const typeSelect = toolbar!.querySelector<HTMLSelectElement>(
				".weave-epub-ai-reading-note-filter-type",
			);
			typeSelect!.value = "core";
			typeSelect!.dispatchEvent(new Event("change"));
			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(
				container.classList.contains(
					"weave-epub-ai-reading-note-source-active",
				),
			).toBe(true);
			expect(
				container.querySelector<HTMLElement>(
					".weave-epub-ai-reading-note-filter-count",
				)?.textContent,
			).not.toMatch(/^0\s*\//);
			const previewText = container.querySelector<HTMLElement>(
				".weave-epub-ai-reading-note-source-preview",
			)?.textContent;
			expect(previewText).toContain("core detail from source");
			expect(previewText).not.toContain("steps summary from source");
			expect(previewText).not.toContain("knowledge detail from source");
			expect(previewText).not.toContain("core detail from rendered DOM");
			expect(
				container
					.querySelector<HTMLElement>(
						".weave-epub-ai-reading-note-source-preview",
					)
					?.classList.contains("is-hidden"),
			).toBe(false);
		} finally {
			unregisterEpubHost(app);
		}
	});

	it("reapplies AI reading note filters when later markdown chunks are appended", async () => {
		const notePath = "AI Reading Notes/demo - AI Reading.md";
		const noteMarkdown = [
			"## Metadata",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 9 &gt; Metadata &gt; All" data-scope-href="text/ch9.xhtml#metadata"></div>',
			"## U281 Chapter 9 > Metadata > How to...",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 9 &gt; Metadata &gt; How to..." data-scope-href="text/ch9.xhtml#how-to" data-ai-unit-id="U281"></div>',
			"### 小节摘要",
			"metadata how-to detail",
			"## U282 Chapter 9 > Metadata > How it works...",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 9 &gt; Metadata &gt; How it works..." data-scope-href="text/ch9.xhtml#works" data-ai-unit-id="U282"></div>',
			"### 小节摘要",
			"metadata principle detail",
		].join("\n");
		const loadPublicationTocItems = vi.fn(async () => [
			{
				id: "ch9",
				label: "Chapter 9",
				href: "text/ch9.xhtml",
				level: 1,
				subitems: [
					{
						id: "metadata",
						label: "Metadata",
						href: "text/ch9.xhtml#metadata",
						level: 2,
						subitems: [
							{
								id: "how-to",
								label: "How to...",
								href: "text/ch9.xhtml#how-to",
								level: 3,
							},
							{
								id: "works",
								label: "How it works...",
								href: "text/ch9.xhtml#works",
								level: 3,
							},
						],
					},
				],
			},
		]);
		const noteFile = Object.assign(new TFile(), {
			path: notePath,
			extension: "md",
		});
		const app = {
			plugins: { getPlugin: vi.fn(() => null) },
			loadPublicationTocItems,
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === notePath ? noteFile : null,
				),
				getMarkdownFiles: vi.fn(() => [noteFile]),
				cachedRead: vi.fn(async () => noteMarkdown),
			},
		} as any;
		registerEpubHost(app, {
			loadPublicationTocItems,
		});
		const container = document.createElement("div");
		container.className = "markdown-rendered";
		container.innerHTML = [
			'<div class="el-h2"><h2>Metadata</h2></div>',
			'<div class="el-div"><div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 9 &gt; Metadata &gt; All" data-scope-href="text/ch9.xhtml#metadata"></div></div>',
			'<div class="el-h2"><h2>U281 Chapter 9 &gt; Metadata &gt; How to...</h2></div>',
			'<div class="el-div"><div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 9 &gt; Metadata &gt; How to..." data-scope-href="text/ch9.xhtml#how-to" data-ai-unit-id="U281"></div></div>',
			'<div class="el-h3"><h3>小节摘要</h3></div>',
			'<div class="el-p"><p>metadata how-to detail</p></div>',
		].join("");
		document.body.append(container);

		try {
			const processor = createEpubLinkPostProcessor(app);
			processor(container, { sourcePath: notePath } as any);
			await new Promise((resolve) => setTimeout(resolve, 650));

			const toolbar = container.querySelector<HTMLElement>(
				".weave-epub-ai-reading-note-filter",
			);
			const rangeSelects = () =>
				Array.from(
					toolbar!.querySelectorAll<HTMLSelectElement>(
						".weave-epub-ai-reading-note-range-select",
					),
				);
			rangeSelects()[0]!.value = "ch9";
			rangeSelects()[0]!.dispatchEvent(new Event("change"));
			rangeSelects()[1]!.value = "metadata";
			rangeSelects()[1]!.dispatchEvent(new Event("change"));
			rangeSelects()[2]!.value = "how-to";
			rangeSelects()[2]!.dispatchEvent(new Event("change"));
			await new Promise((resolve) => setTimeout(resolve, 30));
			const selectedPreviewText = container.querySelector<HTMLElement>(
				".weave-epub-ai-reading-note-source-preview",
			)?.textContent;
			expect(selectedPreviewText).toContain("metadata how-to detail");
			expect(selectedPreviewText).not.toContain("metadata principle detail");

			const lateHeading = document.createElement("div");
			lateHeading.className = "el-h2";
			lateHeading.innerHTML =
				"<h2>U282 Chapter 9 &gt; Metadata &gt; How it works...</h2>";
			const lateMarker = document.createElement("div");
			lateMarker.className = "el-div";
			lateMarker.innerHTML =
				'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 9 &gt; Metadata &gt; How it works..." data-scope-href="text/ch9.xhtml#works" data-ai-unit-id="U282"></div>';
			const lateSubheading = document.createElement("div");
			lateSubheading.className = "el-h3";
			lateSubheading.innerHTML = "<h3>小节摘要</h3>";
			const lateParagraph = document.createElement("div");
			lateParagraph.className = "el-p";
			lateParagraph.innerHTML = "<p>metadata principle detail</p>";
			container.append(lateHeading, lateMarker, lateSubheading, lateParagraph);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(container.textContent).toContain("metadata how-to detail");
			expect(container.contains(lateHeading)).toBe(false);
			expect(container.contains(lateMarker)).toBe(false);
			expect(container.contains(lateSubheading)).toBe(false);
			expect(container.contains(lateParagraph)).toBe(false);
		} finally {
			container.remove();
			unregisterEpubHost(app);
		}
	});

	it("hides original AI reading note blocks outside the source host parent when source preview is active", async () => {
		const notePath = "AI Reading Notes/demo - AI Reading.md";
		const noteMarkdown = [
			"## Metadata",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 9 &gt; Metadata &gt; All" data-scope-href="text/ch9.xhtml#metadata"></div>',
			"## U281 Chapter 9 > Metadata > How to...",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 9 &gt; Metadata &gt; How to..." data-scope-href="text/ch9.xhtml#how-to" data-ai-unit-id="U281"></div>',
			"### 小节摘要",
			"metadata how-to detail",
			"## U282 Chapter 9 > Metadata > How it works...",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 9 &gt; Metadata &gt; How it works..." data-scope-href="text/ch9.xhtml#works" data-ai-unit-id="U282"></div>',
			"### 小节摘要",
			"metadata principle detail",
		].join("\n");
		const loadPublicationTocItems = vi.fn(async () => [
			{
				id: "ch9",
				label: "Chapter 9",
				href: "text/ch9.xhtml",
				level: 1,
				subitems: [
					{
						id: "metadata",
						label: "Metadata",
						href: "text/ch9.xhtml#metadata",
						level: 2,
						subitems: [
							{
								id: "how-to",
								label: "How to...",
								href: "text/ch9.xhtml#how-to",
								level: 3,
							},
						],
					},
				],
			},
		]);
		const noteFile = Object.assign(new TFile(), {
			path: notePath,
			extension: "md",
		});
		const app = {
			plugins: { getPlugin: vi.fn(() => null) },
			loadPublicationTocItems,
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === notePath ? noteFile : null,
				),
				getMarkdownFiles: vi.fn(() => [noteFile]),
				cachedRead: vi.fn(async () => noteMarkdown),
			},
		} as any;
		registerEpubHost(app, {
			loadPublicationTocItems,
		});
		const container = document.createElement("div");
		container.className = "markdown-preview-view";
		const sizer = document.createElement("div");
		sizer.className = "markdown-preview-sizer";
		sizer.innerHTML = [
			'<div class="el-h2"><h2>Metadata</h2></div>',
			'<div class="el-div"><div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 9 &gt; Metadata &gt; All" data-scope-href="text/ch9.xhtml#metadata"></div></div>',
		].join("");
		const laterPreviewSection = document.createElement("div");
		laterPreviewSection.className = "markdown-preview-section";
		laterPreviewSection.textContent = "metadata principle detail";
		container.append(sizer, laterPreviewSection);
		document.body.append(container);

		try {
			const processor = createEpubLinkPostProcessor(app);
			processor(container, { sourcePath: notePath } as any);
			await new Promise((resolve) => setTimeout(resolve, 650));

			const toolbar = container.querySelector<HTMLElement>(
				".weave-epub-ai-reading-note-filter",
			);
			const rangeSelects = () =>
				Array.from(
					toolbar!.querySelectorAll<HTMLSelectElement>(
						".weave-epub-ai-reading-note-range-select",
					),
				);
			rangeSelects()[0]!.value = "ch9";
			rangeSelects()[0]!.dispatchEvent(new Event("change"));
			rangeSelects()[1]!.value = "metadata";
			rangeSelects()[1]!.dispatchEvent(new Event("change"));
			rangeSelects()[2]!.value = "how-to";
			rangeSelects()[2]!.dispatchEvent(new Event("change"));
			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(
				container.classList.contains(
					"weave-epub-ai-reading-note-source-active",
				),
			).toBe(true);
			expect(
				container.querySelector<HTMLElement>(
					".weave-epub-ai-reading-note-source-preview",
				)?.textContent,
			).toContain("metadata how-to detail");
			expect(container.contains(laterPreviewSection)).toBe(false);
		} finally {
			container.remove();
			unregisterEpubHost(app);
		}
	});

	it("uses the outer markdown preview view as the AI reading note filter scope", async () => {
		const notePath = "AI Reading Notes/demo - AI Reading.md";
		const noteMarkdown = [
			"## Chapter 5 topic",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Topic &gt; All" data-scope-href="text/ch5.xhtml#topic"></div>',
			"## U191 Chapter 5 > Topic > Steps...",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Topic &gt; Steps..." data-scope-href="text/ch5.xhtml#steps" data-ai-unit-id="U191"></div>',
			"chapter five detail",
			"## Chapter 9 topic",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 9 &gt; Other &gt; All" data-scope-href="text/ch9.xhtml#other"></div>',
			"chapter nine detail",
		].join("\n");
		const loadPublicationTocItems = vi.fn(async () => [
			{
				id: "ch5",
				label: "Chapter 5",
				href: "text/ch5.xhtml",
				level: 1,
				subitems: [
					{
						id: "topic",
						label: "Topic",
						href: "text/ch5.xhtml#topic",
						level: 2,
						subitems: [
							{
								id: "steps",
								label: "Steps...",
								href: "text/ch5.xhtml#steps",
								level: 3,
							},
						],
					},
				],
			},
		]);
		const noteFile = Object.assign(new TFile(), {
			path: notePath,
			extension: "md",
		});
		const app = {
			plugins: { getPlugin: vi.fn(() => null) },
			loadPublicationTocItems,
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === notePath ? noteFile : null,
				),
				getMarkdownFiles: vi.fn(() => [noteFile]),
				cachedRead: vi.fn(async () => noteMarkdown),
			},
		} as any;
		registerEpubHost(app, {
			loadPublicationTocItems,
		});
		const outer = document.createElement("div");
		outer.className = "markdown-preview-view";
		const innerRendered = document.createElement("div");
		innerRendered.className = "markdown-rendered";
		innerRendered.innerHTML = [
			'<div class="el-h2"><h2>Chapter 5 topic</h2></div>',
			'<div class="el-div"><div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Topic &gt; All" data-scope-href="text/ch5.xhtml#topic"></div></div>',
		].join("");
		const laterOuterSection = document.createElement("div");
		laterOuterSection.className = "markdown-preview-section";
		laterOuterSection.textContent = "chapter nine detail";
		outer.append(innerRendered, laterOuterSection);
		document.body.append(outer);

		try {
			const processor = createEpubLinkPostProcessor(app);
			processor(innerRendered, { sourcePath: notePath } as any);
			await new Promise((resolve) => setTimeout(resolve, 650));

			const toolbar = outer.querySelector<HTMLElement>(
				".weave-epub-ai-reading-note-filter",
			);
			const rangeSelects = () =>
				Array.from(
					toolbar!.querySelectorAll<HTMLSelectElement>(
						".weave-epub-ai-reading-note-range-select",
					),
				);
			rangeSelects()[0]!.value = "ch5";
			rangeSelects()[0]!.dispatchEvent(new Event("change"));
			rangeSelects()[1]!.value = "topic";
			rangeSelects()[1]!.dispatchEvent(new Event("change"));
			rangeSelects()[2]!.value = "steps";
			rangeSelects()[2]!.dispatchEvent(new Event("change"));
			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(
				outer.classList.contains(
					"weave-epub-ai-reading-note-source-active",
				),
			).toBe(true);
			expect(
				outer.querySelector<HTMLElement>(
					".weave-epub-ai-reading-note-source-preview",
				)?.textContent,
			).toContain("chapter five detail");
			expect(outer.contains(laterOuterSection)).toBe(false);
		} finally {
			outer.remove();
			unregisterEpubHost(app);
		}
	});

	it("reloads the source markdown index when a selected AI leaf range is added after the filter mounts", async () => {
		const notePath = "AI Reading Notes/demo - AI Reading.md";
		let noteMarkdown = [
			"## Outline",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 3 &gt; Outline &gt; All" data-scope-href="text/ch3.xhtml#outline"></div>',
			"## Range summary",
			"stale overview",
		].join("\n");
		const loadPublicationTocItems = vi.fn(async () => [
			{
				id: "ch3",
				label: "Chapter 3",
				href: "text/ch3.xhtml",
				level: 1,
				subitems: [
					{
						id: "outline",
						label: "Outline",
						href: "text/ch3.xhtml#outline",
						level: 2,
						subitems: [
							{
								id: "how-to",
								label: "How to...",
								href: "text/ch3.xhtml#how-to",
								level: 3,
							},
						],
					},
				],
			},
		]);
		const noteFile = Object.assign(new TFile(), {
			path: notePath,
			extension: "md",
		});
		const cachedRead = vi.fn(async () => noteMarkdown);
		const app = {
			plugins: { getPlugin: vi.fn(() => null) },
			loadPublicationTocItems,
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === notePath ? noteFile : null,
				),
				getMarkdownFiles: vi.fn(() => [noteFile]),
				cachedRead,
			},
		} as any;
		registerEpubHost(app, {
			loadPublicationTocItems,
		});
		const container = document.createElement("div");
		container.className = "markdown-rendered";
		container.innerHTML = [
			'<div class="el-h2"><h2>Outline</h2></div>',
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 3 &gt; Outline &gt; All" data-scope-href="text/ch3.xhtml#outline"></div>',
			'<div class="el-h2"><h2>Range summary</h2></div>',
			'<div class="el-p"><p>stale overview</p></div>',
		].join("");

		try {
			const processor = createEpubLinkPostProcessor(app);
			processor(container, { sourcePath: notePath } as any);
			await new Promise((resolve) => setTimeout(resolve, 30));

			noteMarkdown = [
				noteMarkdown,
				"## U136 Chapter 3 > Outline > How to...",
				'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 3 &gt; Outline &gt; How to..." data-scope-href="text/ch3.xhtml#how-to" data-ai-unit-id="U136"></div>',
				"fresh outline detail",
			].join("\n");

			const toolbar = container.querySelector<HTMLElement>(
				".weave-epub-ai-reading-note-filter",
			);
			const rangeSelects = () =>
				Array.from(
					toolbar!.querySelectorAll<HTMLSelectElement>(
						".weave-epub-ai-reading-note-range-select",
					),
				);
			rangeSelects()[0]!.value = "ch3";
			rangeSelects()[0]!.dispatchEvent(new Event("change"));
			rangeSelects()[1]!.value = "outline";
			rangeSelects()[1]!.dispatchEvent(new Event("change"));
			rangeSelects()[2]!.value = "how-to";
			rangeSelects()[2]!.dispatchEvent(new Event("change"));
			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(cachedRead.mock.calls.length).toBeGreaterThan(1);
			expect(
				container.querySelector<HTMLElement>(
					".weave-epub-ai-reading-note-source-preview",
				)?.textContent,
			).toContain("fresh outline detail");
			expect(
				container
					.querySelector<HTMLElement>(".weave-epub-ai-reading-note-missing")
					?.classList.contains("is-hidden"),
			).toBe(true);
			expect(
				container
					.querySelector<HTMLElement>(".el-p"),
			).toBeNull();
		} finally {
			unregisterEpubHost(app);
		}
	});

	it("mounts the AI reading filter when Obsidian renders only the marker chunk first", async () => {
		const notePath = "AI Reading Notes/demo - AI Reading.md";
		const noteMarkdown = [
			"## Image alignment",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; All" data-scope-href="text/ch5.xhtml#align"></div>',
			"## Range summary",
			"alignment overview",
			"## U191 Chapter 5 > Image alignment > Steps...",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; Steps..." data-scope-href="text/ch5.xhtml#steps" data-ai-unit-id="U191"></div>',
			"steps detail",
		].join("\n");
		const loadPublicationTocItems = vi.fn(async () => [
			{
				id: "ch5",
				label: "Chapter 5",
				href: "text/ch5.xhtml",
				level: 1,
				subitems: [
					{
						id: "align",
						label: "Image alignment",
						href: "text/ch5.xhtml#align",
						level: 2,
					},
				],
			},
		]);
		const noteFile = Object.assign(new TFile(), {
			path: notePath,
			extension: "md",
		});
		const app = {
			plugins: { getPlugin: vi.fn(() => null) },
			loadPublicationTocItems,
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === notePath ? noteFile : null,
				),
				getMarkdownFiles: vi.fn(() => [noteFile]),
				cachedRead: vi.fn(async () => noteMarkdown),
			},
		} as any;
		registerEpubHost(app, {
			loadPublicationTocItems,
		});
		const container = document.createElement("div");
		container.className = "markdown-rendered";
		container.innerHTML =
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; All" data-scope-href="text/ch5.xhtml#align"></div>';

		try {
			const processor = createEpubLinkPostProcessor(app);
			processor(container, { sourcePath: notePath } as any);
			await new Promise((resolve) => setTimeout(resolve, 60));

			expect(
				container.querySelector(".weave-epub-ai-reading-note-filter"),
			).not.toBeNull();
			expect(
				container.querySelector(".weave-epub-ai-reading-note-filter-type"),
			).not.toBeNull();
		} finally {
			unregisterEpubHost(app);
		}
	});

	it("splits source markdown by AI unit headings when leaf markers are missing", async () => {
		const notePath = "AI Reading Notes/demo - AI Reading.md";
		const noteMarkdown = [
			"## Font tables",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 3 &gt; Font tables &gt; All" data-scope-href="text/ch3.xhtml#font-table"></div>',
			"## Range summary",
			"font table overview",
			"## U109 Chapter 3 > Font tables > How to...",
			"steps unit detail",
			"## U110 Chapter 3 > Font tables > How it works...",
			"principle unit detail",
			"## U111 Chapter 3 > Font tables > More...",
			"more unit detail",
		].join("\n");
		const loadPublicationTocItems = vi.fn(async () => [
			{
				id: "ch3",
				label: "Chapter 3",
				href: "text/ch3.xhtml",
				level: 1,
				subitems: [
					{
						id: "font-table",
						label: "Font tables",
						href: "text/ch3.xhtml#font-table",
						level: 2,
						subitems: [
							{
								id: "principle",
								label: "How it works...",
								href: "text/ch3.xhtml#principle",
								level: 3,
							},
						],
					},
				],
			},
		]);
		const noteFile = Object.assign(new TFile(), {
			path: notePath,
			extension: "md",
		});
		const app = {
			plugins: { getPlugin: vi.fn(() => null) },
			loadPublicationTocItems,
			vault: {
				getAbstractFileByPath: vi.fn(() => null),
				getMarkdownFiles: vi.fn(() => [noteFile]),
				cachedRead: vi.fn(async () => noteMarkdown),
			},
		} as any;
		registerEpubHost(app, {
			loadPublicationTocItems,
		});
		const container = document.createElement("div");
		container.className = "markdown-rendered";
		container.innerHTML = [
			'<div class="el-h2"><h2>Font tables</h2></div>',
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 3 &gt; Font tables &gt; All" data-scope-href="text/ch3.xhtml#font-table"></div>',
			'<div class="el-h2"><h2>Range summary</h2></div>',
			'<div class="el-p"><p>unrelated visible overview</p></div>',
		].join("");

		const processor = createEpubLinkPostProcessor(app);
		processor(container, {} as any);
		await new Promise((resolve) => setTimeout(resolve, 30));

		const toolbar = container.querySelector<HTMLElement>(
			".weave-epub-ai-reading-note-filter",
		);
		const rangeSelects = () =>
			Array.from(
				toolbar!.querySelectorAll<HTMLSelectElement>(
					".weave-epub-ai-reading-note-range-select",
				),
			);
		rangeSelects()[0]!.value = "ch3";
		rangeSelects()[0]!.dispatchEvent(new Event("change"));
		rangeSelects()[1]!.value = "font-table";
		rangeSelects()[1]!.dispatchEvent(new Event("change"));
		rangeSelects()[2]!.value = "principle";
		rangeSelects()[2]!.dispatchEvent(new Event("change"));
		await new Promise((resolve) => setTimeout(resolve, 30));

		const previewText = container.querySelector<HTMLElement>(
			".weave-epub-ai-reading-note-source-preview",
		)?.textContent;
		expect(previewText).toContain("principle unit detail");
		expect(previewText).not.toContain("steps unit detail");
		expect(previewText).not.toContain("more unit detail");
		expect(
			container
				.querySelector<HTMLElement>(".weave-epub-ai-reading-note-missing")
				?.classList.contains("is-hidden"),
		).toBe(true);
		unregisterEpubHost(app);
	});

	it("does not mount AI reading filters inside a rendered source preview", async () => {
		const app = {
			plugins: { getPlugin: vi.fn(() => null) },
			vault: {
				getAbstractFileByPath: vi.fn(() => null),
				getMarkdownFiles: vi.fn(() => []),
				cachedRead: vi.fn(async () => ""),
			},
		} as any;
		const container = document.createElement("div");
		container.className = "markdown-rendered";
		container.innerHTML = [
			'<div class="weave-epub-ai-reading-note-source-preview">',
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; Steps..." data-scope-href="text/ch5.xhtml#steps" data-ai-unit-id="U191"></div>',
			"<h2>小节摘要</h2>",
			"<p>source preview detail</p>",
			"</div>",
		].join("");

		const processor = createEpubLinkPostProcessor(app);
		processor(
			container.querySelector<HTMLElement>(
				".weave-epub-ai-reading-note-source-preview",
			)!,
			{} as any,
		);
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(
			container.querySelector(".weave-epub-ai-reading-note-filter"),
		).toBeNull();
		expect(
			container.querySelector(".weave-epub-ai-reading-note-missing"),
		).toBeNull();
	});

	it("waits for the full markdown container before mounting the AI reading note filter", async () => {
		const notePath = "AI Reading Notes/demo - AI Reading.md";
		const noteMarkdown = [
			"## Image alignment",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; All" data-scope-href="text/ch5.xhtml#align"></div>',
			"## Range summary",
			"alignment overview",
			"## U191 Chapter 5 > Image alignment > Steps...",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; Steps..." data-scope-href="text/ch5.xhtml#steps" data-ai-unit-id="U191"></div>',
			"steps detail",
			"## U192 Chapter 5 > Image alignment > Principle...",
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; Principle..." data-scope-href="text/ch5.xhtml#principle" data-ai-unit-id="U192"></div>',
			"principle detail",
		].join("\n");
		const loadPublicationTocItems = vi.fn(async () => [
			{
				id: "ch5",
				label: "Chapter 5",
				href: "text/ch5.xhtml",
				level: 1,
				subitems: [
					{
						id: "align",
						label: "Image alignment",
						href: "text/ch5.xhtml#align",
						level: 2,
						subitems: [
							{
								id: "principle",
								label: "Principle...",
								href: "text/ch5.xhtml#principle",
								level: 3,
							},
						],
					},
				],
			},
		]);
		const noteFile = Object.assign(new TFile(), {
			path: notePath,
			extension: "md",
		});
		const app = {
			plugins: { getPlugin: vi.fn(() => null) },
			loadPublicationTocItems,
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === notePath ? noteFile : null,
				),
				getMarkdownFiles: vi.fn(() => [noteFile]),
				cachedRead: vi.fn(async () => noteMarkdown),
			},
		} as any;
		registerEpubHost(app, {
			loadPublicationTocItems,
		});
		const processor = createEpubLinkPostProcessor(app);
		const markerBlock = document.createElement("div");
		markerBlock.className = "el-div";
		markerBlock.innerHTML =
			'<div class="weave-epub-ai-reading-note-root" data-source-file="Books/demo.epub" data-scope-label="Chapter 5 &gt; Image alignment &gt; All" data-scope-href="text/ch5.xhtml#align"></div>';

		try {
			processor(markerBlock, { sourcePath: notePath } as any);
			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(
				markerBlock.querySelector(".weave-epub-ai-reading-note-filter"),
			).toBeNull();

			const container = document.createElement("div");
			container.className = "markdown-rendered";
			container.append(markerBlock);
			const staleHeading = document.createElement("div");
			staleHeading.className = "el-h2";
			staleHeading.innerHTML = "<h2>Range summary</h2>";
			const staleParagraph = document.createElement("div");
			staleParagraph.className = "el-p";
			staleParagraph.innerHTML = "<p>stale whole note overview</p>";
			container.append(staleHeading, staleParagraph);
			processor(container, { sourcePath: notePath } as any);
			await new Promise((resolve) => setTimeout(resolve, 60));

			const toolbar = container.querySelector<HTMLElement>(
				".weave-epub-ai-reading-note-filter",
			);
			const rangeSelects = () =>
				Array.from(
					toolbar!.querySelectorAll<HTMLSelectElement>(
						".weave-epub-ai-reading-note-range-select",
					),
				);
			rangeSelects()[0]!.value = "ch5";
			rangeSelects()[0]!.dispatchEvent(new Event("change"));
			rangeSelects()[1]!.value = "align";
			rangeSelects()[1]!.dispatchEvent(new Event("change"));
			rangeSelects()[2]!.value = "principle";
			rangeSelects()[2]!.dispatchEvent(new Event("change"));
			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(
				container.querySelectorAll(".weave-epub-ai-reading-note-filter")
					.length,
			).toBe(1);
			expect(
				container.querySelector<HTMLElement>(
					".weave-epub-ai-reading-note-source-preview",
				)?.textContent,
			).toContain("principle detail");
			expect(staleHeading.classList.contains("is-hidden")).toBe(true);
			expect(staleParagraph.classList.contains("is-hidden")).toBe(true);
		} finally {
			unregisterEpubHost(app);
		}
	});

	it("binds the annotation note dual-window button to the EPUB host", () => {
		const openEpubAnnotationNote = vi.fn(async () => undefined);
		const app = { plugins: { getPlugin: vi.fn(() => null) } } as any;
		registerEpubHost(app, { openEpubAnnotationNote });
		try {
			const container = document.createElement("div");
			container.className = "markdown-rendered";
			container.innerHTML = [
				'<button class="weave-annotation-note-dual-window" type="button" data-weave-dual-window-action="open">双窗模式</button>',
				'<div class="weave-annotation-note-root" data-book-id="book-1" data-source-file="Books/demo.epub" data-dual-window-mode="false"></div>',
				'<div class="weave-annotation-note-line" data-cfi-range="epubcfi(/6/2)" data-chapter-key="chapter-0" data-chapter-title="第一章" data-semantic-id="theorem" data-semantic-label="定理" data-annotation-text="alpha theorem">alpha</div>',
			].join("");

			const processor = createEpubLinkPostProcessor(app);
			processor(container, {
				sourcePath: "weave/epub-data/books/book-1/annotations.md",
			} as any);
			container
				.querySelector<HTMLButtonElement>(".weave-annotation-note-dual-window")
				?.click();

			expect(openEpubAnnotationNote).toHaveBeenCalledWith({
				bookId: "book-1",
				filePath: "Books/demo.epub",
				dualWindowMode: true,
				openMode: "right-split",
				focus: false,
			});
		} finally {
			unregisterEpubHost(app);
		}
	});

	it("keeps the annotation note dual-window button working when the button renders after the marker", () => {
		const openEpubAnnotationNote = vi.fn(async () => undefined);
		const app = { plugins: { getPlugin: vi.fn(() => null) } } as any;
		registerEpubHost(app, { openEpubAnnotationNote });
		try {
			const page = document.createElement("div");
			page.className = "markdown-rendered";
			page.innerHTML =
				'<div class="weave-annotation-note-root" data-book-id="book-1" data-source-file="Books/demo.epub" data-dual-window-mode="false"></div>';

			const processor = createEpubLinkPostProcessor(app);
			processor(page, {
				sourcePath: "weave/epub-data/books/book-1/annotations.md",
			} as any);

			const lateButton = document.createElement("button");
			lateButton.className = "weave-annotation-note-dual-window";
			lateButton.type = "button";
			lateButton.dataset.weaveDualWindowAction = "open";
			lateButton.textContent = "双窗模式";
			page.appendChild(lateButton);
			lateButton.click();

			expect(openEpubAnnotationNote).toHaveBeenCalledWith({
				bookId: "book-1",
				filePath: "Books/demo.epub",
				dualWindowMode: true,
				openMode: "right-split",
				focus: false,
			});
		} finally {
			unregisterEpubHost(app);
		}
	});

	it("binds a chunked annotation note dual-window button without a nearby marker", () => {
		const openEpubAnnotationNote = vi.fn(async () => undefined);
		const app = { plugins: { getPlugin: vi.fn(() => null) } } as any;
		registerEpubHost(app, { openEpubAnnotationNote });
		try {
			const buttonChunk = document.createElement("div");
			buttonChunk.className = "el-button";
			buttonChunk.innerHTML =
				'<button class="weave-annotation-note-dual-window" type="button" data-weave-dual-window-action="open" data-book-id="book-1" data-source-file="Books/demo.epub">双窗模式</button>';

			const processor = createEpubLinkPostProcessor(app);
			processor(buttonChunk, {
				sourcePath: "weave/epub-data/books/book-1/annotations.md",
			} as any);
			buttonChunk
				.querySelector<HTMLButtonElement>(".weave-annotation-note-dual-window")
				?.click();

			expect(openEpubAnnotationNote).toHaveBeenCalledWith({
				bookId: "book-1",
				filePath: "Books/demo.epub",
				dualWindowMode: true,
				openMode: "right-split",
				focus: false,
			});
		} finally {
			unregisterEpubHost(app);
		}
	});

	it("dispatches dual-window annotation hover events from annotation note lines", () => {
		const app = { plugins: { getPlugin: vi.fn(() => null) } } as any;
		const events: CustomEvent[] = [];
		const listener = (event: Event) => events.push(event as CustomEvent);
		window.addEventListener(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, listener);
		try {
			const container = document.createElement("div");
			container.className = "markdown-rendered";
			container.innerHTML = [
				'<div class="weave-annotation-note-root" data-book-id="book-1" data-source-file="Books/demo.epub" data-dual-window-mode="true"></div>',
				'<div class="weave-annotation-note-line" data-annotation-id="anno-1" data-cfi-range="epubcfi(/6/2)" data-chapter-key="chapter-0" data-chapter-title="第一章" data-semantic-id="theorem" data-semantic-label="定理" data-annotation-text="alpha theorem">alpha</div>',
			].join("");

			const processor = createEpubLinkPostProcessor(app);
			processor(container, {
				sourcePath: "weave/epub-data/books/book-1/annotations.md",
			} as any);
			const line = container.querySelector<HTMLElement>(
				".weave-annotation-note-line",
			);
			line?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
			line?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));

			expect(events.map((event) => event.detail.phase)).toEqual([
				"enter",
				"leave",
			]);
			expect(events[0]?.detail).toMatchObject({
				bookId: "book-1",
				filePath: "Books/demo.epub",
				cfiRange: "epubcfi(/6/2)",
				annotationId: "anno-1",
				semanticId: "theorem",
				text: "alpha theorem",
			});
		} finally {
			window.removeEventListener(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, listener);
		}
	});

	it("dispatches dual-window annotation hover events for note lines rendered after the marker", () => {
		const app = { plugins: { getPlugin: vi.fn(() => null) } } as any;
		const events: CustomEvent[] = [];
		const listener = (event: Event) => events.push(event as CustomEvent);
		window.addEventListener(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, listener);
		try {
			const page = document.createElement("div");
			page.className = "markdown-rendered";
			page.innerHTML =
				'<div class="weave-annotation-note-root" data-book-id="book-1" data-source-file="Books/demo.epub" data-dual-window-mode="true"></div>';

			const processor = createEpubLinkPostProcessor(app);
			processor(page, {
				sourcePath: "weave/epub-data/books/book-1/annotations.md",
			} as any);

			const lateLine = document.createElement("div");
			lateLine.className = "weave-annotation-note-line";
			lateLine.dataset.annotationId = "anno-late";
			lateLine.dataset.cfiRange = "epubcfi(/6/4)";
			lateLine.dataset.chapterIndex = "3";
			lateLine.dataset.semanticId = "method";
			lateLine.dataset.annotationText = "late annotation";
			lateLine.textContent = "late";
			page.appendChild(lateLine);
			lateLine.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
			lateLine.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));

			expect(events.map((event) => event.detail.phase)).toEqual([
				"enter",
				"leave",
			]);
			expect(events[0]?.detail).toMatchObject({
				bookId: "book-1",
				filePath: "Books/demo.epub",
				cfiRange: "epubcfi(/6/4)",
				chapterIndex: 3,
				annotationId: "anno-late",
				semanticId: "method",
				text: "late annotation",
			});
		} finally {
			window.removeEventListener(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, listener);
		}
	});

	it("dispatches dual-window annotation hover events from a chunked line without a nearby marker", () => {
		const app = { plugins: { getPlugin: vi.fn(() => null) } } as any;
		const events: CustomEvent[] = [];
		const listener = (event: Event) => events.push(event as CustomEvent);
		window.addEventListener(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, listener);
		try {
			const lineChunk = document.createElement("div");
			lineChunk.className = "el-div";
			lineChunk.innerHTML =
				'<div class="weave-annotation-note-line" data-book-id="book-1" data-source-file="Books/demo.epub" data-annotation-id="anno-1" data-cfi-range="epubcfi(/6/2)" data-semantic-id="theorem" data-annotation-text="alpha theorem">alpha</div>';

			const processor = createEpubLinkPostProcessor(app);
			processor(lineChunk, {
				sourcePath: "weave/epub-data/books/book-1/annotations.md",
			} as any);
			const line = lineChunk.querySelector<HTMLElement>(
				".weave-annotation-note-line",
			);
			line?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
			line?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));

			expect(events.map((event) => event.detail.phase)).toEqual([
				"enter",
				"leave",
			]);
			expect(events[0]?.detail).toMatchObject({
				bookId: "book-1",
				filePath: "Books/demo.epub",
				cfiRange: "epubcfi(/6/2)",
				annotationId: "anno-1",
				semanticId: "theorem",
				text: "alpha theorem",
			});
		} finally {
			window.removeEventListener(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, listener);
		}
	});

	it("mounts annotation note filters after Obsidian renders note chunks separately", async () => {
		vi.useFakeTimers();
		try {
			const page = document.createElement("div");
			page.className = "markdown-rendered";
			document.body.appendChild(page);

			const markerChunk = document.createElement("div");
			markerChunk.innerHTML =
				'<div class="weave-annotation-note-root" data-book-id="book-1"></div>';
			page.appendChild(markerChunk);

			const processor = createEpubLinkPostProcessor({} as any);
			processor(markerChunk, {
				sourcePath: "weave/epub-data/books/book-1/annotations.md",
			} as any);
			expect(page.querySelector(".weave-annotation-note-filter")).toBeNull();

			const linesChunk = document.createElement("div");
			linesChunk.innerHTML = [
				'<h2 class="weave-annotation-note-chapter" data-chapter-key="chapter-0">第一章</h2>',
				'<div class="weave-annotation-note-line" data-chapter-key="chapter-0" data-chapter-title="第一章" data-semantic-id="theorem" data-semantic-label="定理" data-annotation-text="alpha theorem">alpha</div>',
			].join("");
			page.appendChild(linesChunk);

			await vi.advanceTimersByTimeAsync(400);
			expect(
				page.querySelector(".weave-annotation-note-filter"),
			).not.toBeNull();
		} finally {
			document.body.innerHTML = "";
			vi.useRealTimers();
		}
	});

	it("refreshes annotation note filter options when later rendered chunks add chapters", async () => {
		const page = document.createElement("div");
		page.className = "markdown-rendered";
		document.body.appendChild(page);
		try {
			const firstChunk = document.createElement("div");
			firstChunk.innerHTML = [
				'<div class="weave-annotation-note-root" data-book-id="book-1"></div>',
				'<h2 class="weave-annotation-note-chapter" data-chapter-key="chapter-0">第一章</h2>',
				'<div class="weave-annotation-note-line" data-chapter-key="chapter-0" data-chapter-title="第一章" data-semantic-id="theorem" data-semantic-label="定理" data-annotation-text="alpha">alpha</div>',
			].join("");
			page.appendChild(firstChunk);

			const processor = createEpubLinkPostProcessor({} as any);
			processor(firstChunk, {
				sourcePath: "weave/epub-data/books/book-1/annotations.md",
			} as any);

			const chapterSelect = page.querySelector<HTMLSelectElement>(
				".weave-annotation-note-filter-chapter",
			);
			expect(
				Array.from(chapterSelect?.options || []).map(
					(option) => option.textContent,
				),
			).toEqual(["全部章节", "第一章"]);

			const secondChunk = document.createElement("div");
			secondChunk.innerHTML = [
				'<h2 class="weave-annotation-note-chapter" data-chapter-key="chapter-1">第二章</h2>',
				'<div class="weave-annotation-note-line" data-chapter-key="chapter-1" data-chapter-title="第二章" data-semantic-id="mistake" data-semantic-label="易错" data-annotation-text="beta">beta</div>',
			].join("");
			page.appendChild(secondChunk);
			processor(secondChunk, {
				sourcePath: "weave/epub-data/books/book-1/annotations.md",
			} as any);
			await Promise.resolve();

			expect(
				Array.from(chapterSelect?.options || []).map(
					(option) => option.textContent,
				),
			).toEqual(["全部章节", "第一章", "第二章"]);
			expect(
				page.querySelector(".weave-annotation-note-filter-count")?.textContent,
			).toBe("2 / 2");
		} finally {
			document.body.innerHTML = "";
		}
	});

	it("supports legacy tuanki-cfi equals links even when the anchor is not marked as an internal link", async () => {
		const navigateSpy = vi
			.spyOn(EpubLinkService.prototype, "navigateToEpubLocation")
			.mockResolvedValue(undefined);

		const container = document.createElement("div");
		container.innerHTML =
			'<a href="Books/demo.epub#tuanki-cfi=epubcfi(/6/2[chapter-1]!/4/4)">Legacy</a>';

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, {} as any);

		const link = container.querySelector("a");
		expect(link).not.toBeNull();

		link!.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);

		expect(navigateSpy).toHaveBeenCalledTimes(1);
		expect(navigateSpy).toHaveBeenCalledWith(
			"Books/demo.epub",
			"epubcfi(/6/2[chapter-1]!/4/4)",
			"",
			undefined,
			undefined,
		);
	});
});
