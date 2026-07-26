import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("EpubReaderApp semantic presentation refresh", () => {
	function readReaderAppSource(): string {
		return readFileSync(
			resolve(process.cwd(), "src/components/epub/EpubReaderApp.svelte"),
			"utf8"
		);
	}

	it("forces a reader repaint when only semantic presentation changes", () => {
		const source = readReaderAppSource();
		const semanticRefreshBody = source.match(
			/function refreshSemanticPresentationFromCache\(\): Promise<boolean> \{(?<body>[\s\S]*?)\n\t\}\n\n\tfunction clearReaderSelection/
		)?.groups?.body;

		expect(semanticRefreshBody).toBeDefined();
		expect(semanticRefreshBody).toMatch(
			/await readerService\.applyHighlights\(highlightsWithStats,\s*\{[\s\S]*preserveAnchorCache:\s*true,[\s\S]*forceRepaint:\s*true,[\s\S]*\}\);/
		);
	});

	it("refreshes semantic presentation after switching reader UI mode", () => {
		const source = readReaderAppSource();
		const handlerBody = source.match(
			/const handleReaderUiModeChanged = \(event: Event\) => \{(?<body>[\s\S]*?)\n\t\t\};\n\t\twindow\.addEventListener\(EPUB_READER_UI_MODE_CHANGED_EVENT/
		)?.groups?.body;

		expect(handlerBody).toBeDefined();
		expect(handlerBody).toContain(
			"void refreshSemanticSettings({ reloadHighlights: true, semanticOnly: true });"
		);
	});

	it("passes force repaint through semantic settings reloads", () => {
		const source = readReaderAppSource();
		const refreshBody = source.match(
			/async function refreshSemanticSettings\(options\?: \{(?<body>[\s\S]*?)\n\t\}\n\n\tfunction findSemanticById/
		)?.groups?.body;

		expect(refreshBody).toBeDefined();
		expect(refreshBody).toContain("forceReaderReplace?: boolean;");
		expect(refreshBody).toMatch(
			/void reloadHighlights\(\{[\s\S]*invalidateCache:\s*true,[\s\S]*forceReaderReplace:\s*options\.forceReaderReplace === true,[\s\S]*\}\);/
		);
	});

	it("filters book semantic profile events against the current annotation book id", () => {
		const source = readReaderAppSource();
		const handlerBody = source.match(
			/const handleSemanticProfileChanged = \(event: Event\) => \{(?<body>[\s\S]*?)\n\t\t\};\n\t\twindow\.addEventListener\(EPUB_SEMANTIC_PROFILE_CHANGED_EVENT/
		)?.groups?.body;

		expect(handlerBody).toBeDefined();
		expect(handlerBody).toContain("const currentSemanticBookId = getCurrentAnnotationBookId();");
		expect(handlerBody).toMatch(
			/eventScope === 'book'[\s\S]*eventBookId !== currentSemanticBookId[\s\S]*eventBookId !== currentRuntimeBookId/
		);
	});

	it("reloads highlights from source after semantic profile changes", () => {
		const source = readReaderAppSource();
		const handlerBody = source.match(
			/const handleSemanticProfileChanged = \(event: Event\) => \{(?<body>[\s\S]*?)\n\t\t\};\n\t\twindow\.addEventListener\(EPUB_SEMANTIC_PROFILE_CHANGED_EVENT/
		)?.groups?.body;

		expect(handlerBody).toBeDefined();
		expect(handlerBody).toContain("void refreshAfterSemanticProfileChanged();");
		expect(handlerBody).not.toContain("semanticOnly: true");
	});

	it("uses the reader view reload lifecycle after semantic profile changes", () => {
		const source = readReaderAppSource();
		const refreshFunctionBody = source.match(
			/async function runSemanticProfileRefresh\(\) \{(?<body>[\s\S]*?)\n\t\}\n\n\tfunction hasCreateReadingPointCapability/
		)?.groups?.body;

		expect(refreshFunctionBody).toBeDefined();
		expect(refreshFunctionBody).toContain("highlightRefreshKey += 1;");
		expect(refreshFunctionBody).toContain("readerReady = false;");
		expect(refreshFunctionBody).toContain("readerRenderKey += 1;");
		expect(refreshFunctionBody).toContain("queueOpenAnnotationNoteRefresh(annotationBookId, { force: true });");
	});
});
