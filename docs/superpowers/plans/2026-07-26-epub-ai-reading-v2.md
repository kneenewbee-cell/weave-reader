# EPUB AI Reading v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build paragraph-located EPUB AI Reading so important excerpts and knowledge points can link back to exact EPUB positions.

**Architecture:** Reuse the existing EPUB reader paragraph extraction API (`getParagraphsForChapter`) and convert `ReaderParagraph` entries into AI source blocks (`P001`, `P002`, ...). The model references source ids, while the plugin post-processes those ids into plugin-owned EPUB links for the modal and generated Markdown note.

**Tech Stack:** TypeScript, Svelte, Obsidian plugin APIs, Vitest, existing `EpubLinkService`, existing Kimi/OpenAI-compatible chat completion flow.

## Global Constraints

- Work only in `D:\ResOB\worktrees\weave-reader-epub-feature`.
- Stay on `feature/epub-new-feature`.
- Do not merge or depend on PDF reader work.
- Do not implement whole-book AI reading in v2.
- Do not ask the model to generate EPUB CFIs or internal anchors.
- Do not auto-create highlights or annotations from AI-selected passages in v2.
- Do not store API keys in committed files or generated assets.
- When syncing for Obsidian testing, copy only `main.js`, `manifest.json`, and `styles.css`.

---

## File Structure

- Create `src/services/epub/epub-ai-reading-source-blocks.ts`
  - Owns source block types, source block creation from `ReaderParagraph[]`, source marker parsing, and Markdown link decoration.
- Create `src/services/epub/__tests__/epub-ai-reading-source-blocks.test.ts`
  - Tests paragraph-to-block conversion and `[P001]` source marker decoration.
- Modify `src/services/epub/epub-ai-reading.ts`
  - Adds `sourceBlocks` to input/result, includes source blocks in prompts, and decorates final content before note output.
- Modify `src/services/epub/__tests__/epub-ai-reading.test.ts`
  - Tests prompt construction and note generation with paragraph source links.
- Modify `src/components/epub/EpubReaderApp.svelte`
  - Fetches current chapter paragraphs and maps them to AI source blocks before opening the modal.
- Modify `src/components/epub/EpubAiReadingModal.ts`
  - Renders the decorated AI result and adds lightweight section tabs.
- Modify `src/components/epub/EpubAiReadingModal.test.ts`
  - Tests source links and tabs in the modal.
- Modify `src/styles/epub/epub-ai-reading.css`
  - Adds compact tab and source reference styles.
- Modify generated build artifacts after `npm run build`: `main.js`, `styles.css`.

---

### Task 1: Source Block Model and Markdown Reference Decoration

**Files:**
- Create: `src/services/epub/epub-ai-reading-source-blocks.ts`
- Test: `src/services/epub/__tests__/epub-ai-reading-source-blocks.test.ts`

**Interfaces:**
- Consumes: `ReaderParagraph` from `src/services/epub/reader-engine-types.ts`
- Produces:
  - `type EpubAiReadingSourceBlockKind = "heading" | "paragraph" | "list" | "code" | "quote" | "table"`
  - `interface EpubAiReadingSourceBlock`
  - `function buildEpubAiReadingSourceBlocksFromParagraphs(paragraphs, options): EpubAiReadingSourceBlock[]`
  - `function formatEpubAiReadingSourceBlocksForPrompt(blocks): string`
  - `function decorateEpubAiReadingSourceReferences(markdown, blocks): string`

- [ ] **Step 1: Write failing tests for source block conversion**

```ts
import { describe, expect, it } from "vitest";
import {
	buildEpubAiReadingSourceBlocksFromParagraphs,
} from "../epub-ai-reading-source-blocks";
import type { ReaderParagraph } from "../reader-engine-types";

describe("epub-ai-reading-source-blocks", () => {
	it("creates ordered P001 source blocks from reader paragraphs", () => {
		const paragraphs: ReaderParagraph[] = [
			{
				id: "reader-p1",
				chapterIndex: 4,
				chapterTitle: "第一章：LaTeX 入门指南",
				chapterHref: "OEBPS/chapter1.xhtml",
				text: "LaTeX 是一种文档标记语言。",
				cfiRange: "epubcfi(/6/10!/4/2,/1:0,/1:14)",
			},
			{
				id: "reader-p2",
				chapterIndex: 4,
				chapterTitle: "第一章：LaTeX 入门指南",
				chapterHref: "OEBPS/chapter1.xhtml",
				text: "   ",
				cfiRange: "epubcfi(/6/10!/4/4)",
			},
			{
				id: "reader-p3",
				chapterIndex: 4,
				chapterTitle: "第一章：LaTeX 入门指南",
				chapterHref: "OEBPS/chapter1.xhtml",
				text: "Overleaf 可以在线协作。",
				html: "<li>Overleaf 可以在线协作。</li>",
				cfiRange: "epubcfi(/6/10!/4/6,/1:0,/1:12)",
			},
		];

		const blocks = buildEpubAiReadingSourceBlocksFromParagraphs(paragraphs, {
			sourceLinkForParagraph: (paragraph, id) => `[[Books/demo.epub#weave-cfi=${paragraph.cfiRange}|${id}]]`,
		});

		expect(blocks).toEqual([
			expect.objectContaining({
				id: "P001",
				readerParagraphId: "reader-p1",
				chapterIndex: 4,
				headingPath: ["第一章：LaTeX 入门指南"],
				kind: "paragraph",
				text: "LaTeX 是一种文档标记语言。",
				sourceLink: "[[Books/demo.epub#weave-cfi=epubcfi(/6/10!/4/2,/1:0,/1:14)|P001]]",
			}),
			expect.objectContaining({
				id: "P002",
				readerParagraphId: "reader-p3",
				kind: "list",
				text: "Overleaf 可以在线协作。",
				sourceLink: "[[Books/demo.epub#weave-cfi=epubcfi(/6/10!/4/6,/1:0,/1:12)|P002]]",
			}),
		]);
	});
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- src/services/epub/__tests__/epub-ai-reading-source-blocks.test.ts`

Expected: FAIL because `epub-ai-reading-source-blocks.ts` does not exist.

- [ ] **Step 3: Implement minimal source block conversion**

```ts
import type { ReaderParagraph } from "./reader-engine-types";

export type EpubAiReadingSourceBlockKind =
	| "heading"
	| "paragraph"
	| "list"
	| "code"
	| "quote"
	| "table";

export interface EpubAiReadingSourceBlock {
	id: string;
	readerParagraphId?: string;
	chapterIndex?: number;
	chapterTitle?: string;
	chapterHref: string;
	cfi?: string;
	sourceLink?: string;
	headingPath: string[];
	text: string;
	kind: EpubAiReadingSourceBlockKind;
}

export interface BuildEpubAiReadingSourceBlockOptions {
	sourceLinkForParagraph?: (paragraph: ReaderParagraph, blockId: string) => string;
	maxBlocks?: number;
}

function normalizeBlockText(value: string): string {
	return String(value || "").replace(/\s+/g, " ").trim();
}

function inferBlockKind(paragraph: ReaderParagraph): EpubAiReadingSourceBlockKind {
	const html = String(paragraph.html || "").trim().toLowerCase();
	if (/^<h[1-6]\b/.test(html)) return "heading";
	if (html.startsWith("<li")) return "list";
	if (html.startsWith("<pre") || html.startsWith("<code")) return "code";
	if (html.startsWith("<blockquote")) return "quote";
	if (html.startsWith("<table")) return "table";
	return "paragraph";
}

function formatSourceBlockId(index: number): string {
	return `P${String(index + 1).padStart(3, "0")}`;
}

export function buildEpubAiReadingSourceBlocksFromParagraphs(
	paragraphs: ReaderParagraph[],
	options: BuildEpubAiReadingSourceBlockOptions = {}
): EpubAiReadingSourceBlock[] {
	const blocks: EpubAiReadingSourceBlock[] = [];
	for (const paragraph of paragraphs || []) {
		if (options.maxBlocks && blocks.length >= options.maxBlocks) break;
		const text = normalizeBlockText(paragraph.text);
		if (!text) continue;
		const id = formatSourceBlockId(blocks.length);
		blocks.push({
			id,
			readerParagraphId: paragraph.id,
			chapterIndex: paragraph.chapterIndex,
			chapterTitle: paragraph.chapterTitle,
			chapterHref: paragraph.chapterHref,
			cfi: paragraph.cfiRange,
			sourceLink: options.sourceLinkForParagraph?.(paragraph, id) || undefined,
			headingPath: paragraph.chapterTitle ? [paragraph.chapterTitle] : [],
			text,
			kind: inferBlockKind(paragraph),
		});
	}
	return blocks;
}
```

- [ ] **Step 4: Run source block test to verify GREEN**

Run: `npm test -- src/services/epub/__tests__/epub-ai-reading-source-blocks.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing tests for prompt formatting and source decoration**

```ts
import {
	decorateEpubAiReadingSourceReferences,
	formatEpubAiReadingSourceBlocksForPrompt,
	type EpubAiReadingSourceBlock,
} from "../epub-ai-reading-source-blocks";

it("formats source blocks for the model prompt", () => {
	const blocks: EpubAiReadingSourceBlock[] = [
		{
			id: "P001",
			chapterHref: "chapter.xhtml",
			cfi: "epubcfi(/6/2)",
			headingPath: ["第一章", "形式与内容分离"],
			text: "只需告诉 LaTeX 这是章节标题。",
			kind: "paragraph",
			sourceLink: "[[Books/demo.epub#weave-cfi=epubcfi(/6/2)|P001]]",
		},
	];

	expect(formatEpubAiReadingSourceBlocksForPrompt(blocks)).toContain(
		"[P001] kind=paragraph path=第一章 > 形式与内容分离"
	);
	expect(formatEpubAiReadingSourceBlocksForPrompt(blocks)).toContain(
		"只需告诉 LaTeX 这是章节标题。"
	);
});

it("decorates model source markers with plugin-owned EPUB links", () => {
	const markdown = "## 重要原文\n这句很关键。[P001]\n未知引用。[P999]";
	const decorated = decorateEpubAiReadingSourceReferences(markdown, [
		{
			id: "P001",
			chapterHref: "chapter.xhtml",
			text: "只需告诉 LaTeX 这是章节标题。",
			headingPath: ["第一章"],
			kind: "paragraph",
			sourceLink: "[[Books/demo.epub#weave-cfi=epubcfi(/6/2)|P001]]",
		},
	]);

	expect(decorated).toContain("[[Books/demo.epub#weave-cfi=epubcfi(/6/2)|P001]]");
	expect(decorated).toContain("未知引用。[P999]");
});
```

- [ ] **Step 6: Run source block test to verify RED**

Run: `npm test -- src/services/epub/__tests__/epub-ai-reading-source-blocks.test.ts`

Expected: FAIL because formatter/decorator are not implemented.

- [ ] **Step 7: Implement formatter and decorator**

```ts
export function formatEpubAiReadingSourceBlocksForPrompt(
	blocks: EpubAiReadingSourceBlock[]
): string {
	return (blocks || [])
		.map((block) => {
			const path = block.headingPath.length > 0 ? block.headingPath.join(" > ") : block.chapterTitle || "";
			return [
				`[${block.id}] kind=${block.kind}${path ? ` path=${path}` : ""}`,
				`href=${block.chapterHref}${block.cfi ? ` cfi=${block.cfi}` : ""}`,
				block.text,
			].join("\n");
		})
		.join("\n\n");
}

export function decorateEpubAiReadingSourceReferences(
	markdown: string,
	blocks: EpubAiReadingSourceBlock[] = []
): string {
	const byId = new Map(blocks.map((block) => [block.id, block]));
	return String(markdown || "").replace(/\[(P\d{3})\]/g, (match, id: string) => {
		const block = byId.get(id);
		return block?.sourceLink || match;
	});
}
```

- [ ] **Step 8: Run source block test to verify GREEN**

Run: `npm test -- src/services/epub/__tests__/epub-ai-reading-source-blocks.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/services/epub/epub-ai-reading-source-blocks.ts src/services/epub/__tests__/epub-ai-reading-source-blocks.test.ts
git commit -m "Add EPUB AI reading source blocks"
```

---

### Task 2: Prompt and Note Support for Source Blocks

**Files:**
- Modify: `src/services/epub/epub-ai-reading.ts`
- Modify: `src/services/epub/__tests__/epub-ai-reading.test.ts`

**Interfaces:**
- Consumes: `EpubAiReadingSourceBlock`, `formatEpubAiReadingSourceBlocksForPrompt`, `decorateEpubAiReadingSourceReferences`
- Produces:
  - `EpubAiReadingInput.sourceBlocks?: EpubAiReadingSourceBlock[]`
  - `EpubAiReadingResult.sourceBlocks?: EpubAiReadingSourceBlock[]`
  - Decorated `result.content` when source blocks exist.

- [ ] **Step 1: Write failing prompt test**

```ts
it("builds paragraph-located AI messages when source blocks are available", () => {
	const messages = buildEpubAiReadingMessages({
		bookTitle: "LaTeX Guide",
		filePath: "Books/latex.epub",
		chapterTitle: "Chapter 1",
		chapterHref: "Text/chapter1.xhtml",
		chapterText: "Fallback chapter text",
		tocItems,
		sourceBlocks: [
			{
				id: "P001",
				chapterHref: "Text/chapter1.xhtml",
				cfi: "epubcfi(/6/2)",
				text: "LaTeX is a document markup language.",
				headingPath: ["Chapter 1", "What is LaTeX?"],
				kind: "paragraph",
				sourceLink: "[[Books/latex.epub#weave-cfi=epubcfi(/6/2)|P001]]",
			},
		],
	});

	expect(messages.user).toContain("# 当前章节定位正文块");
	expect(messages.user).toContain("[P001] kind=paragraph path=Chapter 1 > What is LaTeX?");
	expect(messages.user).toContain("请引用 P001 这种段落编号");
	expect(messages.user).not.toContain("# 当前章节正文\nFallback chapter text");
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- src/services/epub/__tests__/epub-ai-reading.test.ts`

Expected: FAIL because `sourceBlocks` is not part of `EpubAiReadingInput`.

- [ ] **Step 3: Extend input/result and prompt construction**

Implementation requirements:

```ts
import {
	decorateEpubAiReadingSourceReferences,
	formatEpubAiReadingSourceBlocksForPrompt,
	type EpubAiReadingSourceBlock,
} from "./epub-ai-reading-source-blocks";
```

Add:

```ts
sourceBlocks?: EpubAiReadingSourceBlock[];
```

to both `EpubAiReadingInput` and `EpubAiReadingResult`.

In `buildEpubAiReadingMessages`, use:

```ts
const sourceBlocks = Array.isArray(input.sourceBlocks) ? input.sourceBlocks : [];
const sourceBlockText = formatEpubAiReadingSourceBlocksForPrompt(sourceBlocks);
```

When `sourceBlockText` exists, include:

```ts
"# 定位规则",
"请引用 P001 这种段落编号；不要生成 EPUB CFI、内部锚点或 URL。",
"摘要可以综合多个段落，但关键知识点和重要原文必须尽量带来源编号，例如 [P001]。",
"插件会把段落编号转换成可点击链接。",
"",
"# 当前章节定位正文块",
sourceBlockText,
```

and omit the raw `# 当前章节正文` block. Keep the raw chapter text path as fallback when no blocks exist.

- [ ] **Step 4: Run prompt test to verify GREEN**

Run: `npm test -- src/services/epub/__tests__/epub-ai-reading.test.ts`

Expected: PASS for the new prompt test.

- [ ] **Step 5: Write failing request/note decoration test**

```ts
it("decorates AI source markers in request results and generated notes", async () => {
	const requester = vi.fn(async () => ({
		json: {
			choices: [
				{
					message: {
						content: "## 重要原文\nLaTeX 的定义很关键。[P001]",
					},
				},
			],
		},
	}));
	const sourceBlocks = [
		{
			id: "P001",
			chapterHref: "Text/chapter1.xhtml",
			cfi: "epubcfi(/6/2)",
			text: "LaTeX is a document markup language.",
			headingPath: ["Chapter 1"],
			kind: "paragraph" as const,
			sourceLink: "[[Books/latex.epub#weave-cfi=epubcfi(/6/2)|P001]]",
		},
	];

	const result = await requestEpubAiReading(
		{
			bookTitle: "LaTeX Guide",
			filePath: "Books/latex.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "Text/chapter1.xhtml",
			chapterText: "Fallback text",
			tocItems,
			sourceBlocks,
		},
		{
			config: {
				apiKey: "test-key",
				baseUrl: "https://api.kimi.com/coding/v1",
				model: "k3",
			},
			requester,
			enableStreaming: false,
			now: () => 1710000000000,
		}
	);

	expect(result.content).toContain("[[Books/latex.epub#weave-cfi=epubcfi(/6/2)|P001]]");
	expect(result.sourceBlocks).toEqual(sourceBlocks);
	expect(buildEpubAiReadingNoteSection(result)).toContain(
		"[[Books/latex.epub#weave-cfi=epubcfi(/6/2)|P001]]"
	);
});
```

- [ ] **Step 6: Run test to verify RED**

Run: `npm test -- src/services/epub/__tests__/epub-ai-reading.test.ts`

Expected: FAIL because content is not decorated.

- [ ] **Step 7: Decorate final content in `requestEpubAiReading`**

After `content` is extracted:

```ts
const sourceBlocks = Array.isArray(input.sourceBlocks) ? input.sourceBlocks : [];
const decoratedContent = sourceBlocks.length > 0
	? decorateEpubAiReadingSourceReferences(content, sourceBlocks)
	: content;
```

Return `content: decoratedContent` and `sourceBlocks`.

- [ ] **Step 8: Run service tests to verify GREEN**

Run: `npm test -- src/services/epub/__tests__/epub-ai-reading.test.ts src/services/epub/__tests__/epub-ai-reading-source-blocks.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/services/epub/epub-ai-reading.ts src/services/epub/__tests__/epub-ai-reading.test.ts
git commit -m "Add source-linked EPUB AI reading prompts"
```

---

### Task 3: Reader Integration for Current Chapter Paragraphs

**Files:**
- Modify: `src/components/epub/EpubReaderApp.svelte`
- Modify: `src/components/epub/EpubReaderApp` related tests only if existing tests cover `openAiReading`; otherwise rely on service tests and build.

**Interfaces:**
- Consumes: `buildEpubAiReadingSourceBlocksFromParagraphs`
- Produces: `input.sourceBlocks` passed into `EpubAiReadingModal`.

- [ ] **Step 1: Add import**

```ts
import { buildEpubAiReadingSourceBlocksFromParagraphs } from '../../services/epub/epub-ai-reading-source-blocks';
```

- [ ] **Step 2: Add source block extraction inside `openAiReading`**

In `openAiReading`, after `draft` and before constructing `EpubAiReadingModal`, add:

```ts
const chapterParagraphs = await readerService.getParagraphsForChapter?.(draft.chapterIndex, {
	includeHtml: true,
}) ?? [];
const sourceBlocks = buildEpubAiReadingSourceBlocksFromParagraphs(chapterParagraphs, {
	sourceLinkForParagraph: (paragraph, blockId) =>
		linkService.buildEpubLink(
			filePath,
			paragraph.cfiRange,
			blockId,
			paragraph.chapterIndex,
			paragraph.chapterTitle,
			undefined,
			book.sourceId
		),
});
```

Pass `sourceBlocks` into `input`.

- [ ] **Step 3: Add stage-safe fallback**

If `sourceBlocks.length === 0`, keep opening the modal with v1 input. Do not block generation.

- [ ] **Step 4: Run targeted type/build check**

Run: `npm test -- src/services/epub/__tests__/epub-ai-reading.test.ts src/services/epub/__tests__/epub-ai-reading-source-blocks.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/components/epub/EpubReaderApp.svelte
git commit -m "Pass EPUB AI reading source blocks from reader"
```

---

### Task 4: Modal Section Tabs and Source Link Rendering

**Files:**
- Modify: `src/components/epub/EpubAiReadingModal.ts`
- Modify: `src/components/epub/EpubAiReadingModal.test.ts`
- Modify: `src/styles/epub/epub-ai-reading.css`

**Interfaces:**
- Consumes: decorated Markdown content containing real Obsidian EPUB links.
- Produces: section tabs for `摘要`, `知识点`, `重要原文`, `章节关系`, `精读路径`.

- [ ] **Step 1: Write failing modal tab test**

```ts
it("renders section tabs for structured AI reading markdown", async () => {
	mockedRequestEpubAiReading.mockResolvedValue({
		bookTitle: "Demo Book",
		filePath: "Books/demo.epub",
		chapterTitle: "Chapter 1",
		chapterHref: "text/chapter1.xhtml",
		content: [
			"## 本章摘要",
			"摘要内容",
			"## 关键知识点",
			"- 知识点",
			"## 重要原文",
			"[[Books/demo.epub#weave-cfi=epubcfi(/6/2)|P001]]",
			"## 章节关系",
			"承上启下",
			"## 建议精读顺序",
			"1. 先读定义",
		].join("\n"),
		model: "k3",
		generatedAt: 1710000000000,
	});
	const modal = new EpubAiReadingModal(new App(), {
		input: {
			bookTitle: "Demo Book",
			filePath: "Books/demo.epub",
			chapterTitle: "Chapter 1",
			chapterHref: "text/chapter1.xhtml",
			chapterText: "Chapter text",
			tocItems: [],
		},
	});

	EpubAiReadingModal.prototype.onOpen.call(modal);

	await waitFor(() => {
		expect(modal.contentEl.querySelectorAll(".weave-epub-ai-reading-tab")).toHaveLength(5);
		expect(modal.contentEl.textContent || "").toContain("摘要内容");
	});
});
```

- [ ] **Step 2: Run modal test to verify RED**

Run: `npm test -- src/components/epub/EpubAiReadingModal.test.ts`

Expected: FAIL because tabs are not rendered.

- [ ] **Step 3: Implement lightweight section parser**

Inside `EpubAiReadingModal.ts`, add private helpers:

```ts
private splitAiReadingSections(markdown: string): Array<{ key: string; label: string; markdown: string }> {
	const labels = [
		{ key: "summary", label: "摘要", match: /本章摘要|内容概要/ },
		{ key: "knowledge", label: "知识点", match: /关键知识点|概念\/术语/ },
		{ key: "quotes", label: "重要原文", match: /重要原文/ },
		{ key: "relations", label: "章节关系", match: /章节关系/ },
		{ key: "path", label: "精读路径", match: /建议精读顺序|精读路径|行动清单/ },
	];
	// Parse level-2 headings and group matching sections. Fallback returns one section.
}
```

Render tabs before the result body. The first tab is active by default. Clicking a tab re-renders only that section with `MarkdownRenderer.render`.

- [ ] **Step 4: Run modal test to verify GREEN**

Run: `npm test -- src/components/epub/EpubAiReadingModal.test.ts`

Expected: PASS.

- [ ] **Step 5: Add CSS**

Add compact styles:

```css
.weave-epub-ai-reading-tabs {
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
}

.weave-epub-ai-reading-tab {
	border: 1px solid var(--background-modifier-border);
	background: var(--background-secondary);
	color: var(--text-muted);
	border-radius: 6px;
	padding: 4px 8px;
}

.weave-epub-ai-reading-tab.is-active {
	background: var(--interactive-accent);
	color: var(--text-on-accent);
}
```

- [ ] **Step 6: Run modal tests**

Run: `npm test -- src/components/epub/EpubAiReadingModal.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/components/epub/EpubAiReadingModal.ts src/components/epub/EpubAiReadingModal.test.ts src/styles/epub/epub-ai-reading.css
git commit -m "Add EPUB AI reading section tabs"
```

---

### Task 5: Verification, Build, and Test Plugin Sync

**Files:**
- Modify after build: `main.js`, `styles.css`
- Do not modify: `D:\ResOB\note\.obsidian\plugins\weave-reader\.env`, `cache/`, `data.json`, `state/`

- [ ] **Step 1: Run full targeted tests**

Run:

```bash
npm test -- src/components/epub/EpubAiReadingModal.test.ts src/services/epub/__tests__/epub-ai-reading.test.ts src/services/epub/__tests__/epub-ai-reading-source-blocks.test.ts src/views/EpubView.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: exit code 0. Existing Svelte a11y warnings in unrelated files are acceptable if build exits 0.

- [ ] **Step 3: Scan generated assets for leaked keys**

Run:

```bash
rg -n "sk-kimi-|KIMI_API_KEY\s*=|MOONSHOT_API_KEY\s*=" main.js styles.css manifest.json src package.json scripts -g "!node_modules/**"
```

Expected: no real keys. Test fixture values like `runtime-key` are acceptable only in test files.

- [ ] **Step 4: Commit build artifacts**

```bash
git add main.js styles.css
git commit -m "Build EPUB AI reading v2"
```

If build artifacts are already included in a prior task commit because `npm run build` ran earlier, include them in that final commit instead.

- [ ] **Step 5: Sync test plugin artifacts only when actively testing**

Run only because the user already established this worktree as the active test worktree:

```powershell
$source = "D:\ResOB\worktrees\weave-reader-epub-feature"
$target = "D:\ResOB\note\.obsidian\plugins\weave-reader"
foreach ($file in @("main.js", "manifest.json", "styles.css")) {
  Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $target $file) -Force
}
```

- [ ] **Step 6: Verify copied artifact hashes**

Run:

```powershell
Get-FileHash -Algorithm SHA256 "D:\ResOB\worktrees\weave-reader-epub-feature\main.js", "D:\ResOB\note\.obsidian\plugins\weave-reader\main.js"
Get-FileHash -Algorithm SHA256 "D:\ResOB\worktrees\weave-reader-epub-feature\manifest.json", "D:\ResOB\note\.obsidian\plugins\weave-reader\manifest.json"
Get-FileHash -Algorithm SHA256 "D:\ResOB\worktrees\weave-reader-epub-feature\styles.css", "D:\ResOB\note\.obsidian\plugins\weave-reader\styles.css"
```

Expected: each pair has matching SHA256 hashes.

- [ ] **Step 7: Push branch after user-facing verification**

Run:

```bash
git push origin feature/epub-new-feature
```

Expected: remote branch advances from the current local HEAD.
