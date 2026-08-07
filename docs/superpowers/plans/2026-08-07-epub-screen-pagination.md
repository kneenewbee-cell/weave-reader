# EPUB Screen Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace EPUB text-bucket page display with full-book screen-page display, including dual-page ranges and TOC screen page numbers.

**Architecture:** Add a small pure pagination model that converts current layout metrics plus section reading metrics into screen pages. `FoliateReaderService` owns the live index for the active book/layout, updates it from relocate/layout changes, and publishes compatible `PaginationInfo` updates to existing UI. UI components only learn how to display an optional page label/range, while stored progress, bookmarks, annotations, and AI-note anchors continue to use CFI.

**Tech Stack:** TypeScript, Svelte 5, Vitest, Foliate renderer events, existing `FoliateReaderService`, `FoliateVaultPublicationParser`, `BottomNav.svelte`, and `TableOfContents.svelte`.

## Global Constraints

- Do not modify the original feature branches; work only on `integration/epub-ai-pdf-reader`.
- Keep EPUB progress, bookmarks, annotations, and AI reading note source positioning based on CFI.
- Do not synchronously render or measure the whole book on the main thread.
- Single-page paginated mode advances the displayed page number by 1 per screen.
- Dual-page paginated mode displays a range and advances the displayed page number by 2 per screen.
- Scrolled mode maps one viewport height to one displayed page.
- TOC page numbers are full-book cumulative screen pages from page 1.
- Copy built runtime files into `D:\ResOB\note\.obsidian\plugins\weave-reader` only after tests and build pass.

---

## File Structure

- Create `src/services/epub/epub-screen-pagination.ts`: pure functions and types for layout keys, section screen-page estimates, page ranges, and TOC page cloning.
- Create `src/services/epub/__tests__/epub-screen-pagination.test.ts`: fast unit tests for single-page, dual-page, scrolled, layout-key, and TOC mapping behavior.
- Modify `src/services/epub/types.ts`: extend `TocItem` and `PaginationInfo` with optional screen-page fields while keeping existing `currentPage` and `totalPages`.
- Modify `src/services/epub/FoliateVaultPublicationParser.ts`: expose safe section metric and TOC href helpers without exposing mutable internal descriptors.
- Modify `src/services/epub/FoliateReaderService.ts`: maintain the active screen-page index, update it on render/layout/relocate, and route `goToPage` through screen-page mapping.
- Modify `src/components/epub/BottomNav.svelte`: display `PaginationInfo.pageLabel` when available and keep jump input numeric.
- Modify `src/components/epub/TableOfContents.svelte`: prefer `screenPageNumber` over legacy `pageNumber`.
- Modify `src/components/epub/EpubReaderApp.svelte`: pass the optional screen-page label/range to bottom navigation without changing reading-state persistence.
- Modify i18n resources only if a new visible string is required; first version should use existing page status strings plus computed `pageLabel`.

---

### Task 1: Pure Screen-Pagination Model

**Files:**
- Create: `src/services/epub/epub-screen-pagination.ts`
- Test: `src/services/epub/__tests__/epub-screen-pagination.test.ts`

**Interfaces:**
- Consumes: `EpubFlowMode`, `EpubLayoutMode`, `EpubWidthMode`, `TocItem` from `src/services/epub/types.ts`.
- Produces:
  - `ScreenPaginationLayoutInput`
  - `ScreenPaginationSectionMetric`
  - `ScreenPaginationSectionIndex`
  - `ScreenPaginationState`
  - `buildScreenPaginationLayoutKey(input: ScreenPaginationLayoutInput): string`
  - `estimateScreenPageCount(input: ScreenPageEstimateInput): number`
  - `buildScreenPaginationState(input: BuildScreenPaginationStateInput): ScreenPaginationState`
  - `resolveScreenPageRange(input: ResolveScreenPageRangeInput): ScreenPageRange`
  - `cloneTocItemsWithScreenPages(items: TocItem[], resolvePage: (item: TocItem) => number | undefined): TocItem[]`

- [ ] **Step 1: Write failing tests for page-count estimation**

```ts
import { describe, expect, it } from "vitest";
import {
	buildScreenPaginationState,
	estimateScreenPageCount,
	resolveScreenPageRange,
} from "../epub-screen-pagination";

describe("epub screen pagination", () => {
	it("estimates pages from current screen capacity instead of a fixed text bucket", () => {
		expect(estimateScreenPageCount({
			textLength: 3600,
			viewportHeight: 720,
			inlineWidthPx: 720,
			fontSizePx: 18,
			lineHeight: 1.6,
			letterSpacing: 0,
			layoutMode: "paginated",
			flowMode: "paginated",
			fallbackPositionCount: 2,
			fixedLayout: false,
		})).toBeGreaterThan(2);
	});

	it("counts a dual-page screen as two displayed pages", () => {
		const state = buildScreenPaginationState({
			sections: [
				{ index: 0, href: "chapter-1.xhtml", textLength: 2000, fallbackPositionCount: 2 },
				{ index: 1, href: "chapter-2.xhtml", textLength: 2000, fallbackPositionCount: 2 },
			],
			layout: {
				bookId: "book",
				viewportWidth: 1200,
				viewportHeight: 720,
				inlineWidthPx: 520,
				fontSizePx: 18,
				lineHeight: 1.6,
				letterSpacing: 0,
				pageMargin: 48,
				gap: "10%",
				widthMode: "full",
				layoutMode: "double",
				flowMode: "paginated",
			},
		});
		const range = resolveScreenPageRange({
			state,
			sectionIndex: 0,
			sectionLocalPage: 1,
			visiblePageCount: 2,
		});
		expect(range.startPage).toBe(1);
		expect(range.endPage).toBe(2);
		expect(range.label).toBe("1-2");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/epub/__tests__/epub-screen-pagination.test.ts --reporter dot`

Expected: FAIL because `../epub-screen-pagination` does not exist.

- [ ] **Step 3: Implement the pure module**

Use this implementation shape:

```ts
import type { EpubFlowMode, EpubLayoutMode, EpubWidthMode, TocItem } from "./types";

export interface ScreenPaginationLayoutInput {
	bookId: string;
	viewportWidth: number;
	viewportHeight: number;
	inlineWidthPx: number;
	fontSizePx: number;
	lineHeight: number;
	letterSpacing: number;
	pageMargin: number;
	gap: string;
	widthMode: EpubWidthMode;
	layoutMode: EpubLayoutMode;
	flowMode: EpubFlowMode;
}

export interface ScreenPaginationSectionMetric {
	index: number;
	href: string;
	textLength: number;
	fallbackPositionCount: number;
	fixedLayout?: boolean;
}

export interface ScreenPaginationSectionIndex {
	index: number;
	href: string;
	pageStart: number;
	pageCount: number;
}

export interface ScreenPaginationState {
	layoutKey: string;
	totalPages: number;
	sections: ScreenPaginationSectionIndex[];
	sectionByHref: Map<string, ScreenPaginationSectionIndex>;
}

export interface ScreenPageRange {
	startPage: number;
	endPage: number;
	totalPages: number;
	label: string;
}
```

Implementation rules:
- Use `Math.max(1, Math.ceil(textLength / screenCapacityChars))`.
- Compute `screenCapacityChars` from `viewportHeight`, `inlineWidthPx`, `fontSizePx`, `lineHeight`, and `letterSpacing`.
- Clamp absurd values; if metrics are missing, fall back to `fallbackPositionCount`.
- For dual-page mode, do not halve total pages; one visible screen contains two page numbers.

- [ ] **Step 4: Run pure module tests**

Run: `npx vitest run src/services/epub/__tests__/epub-screen-pagination.test.ts --reporter dot`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/services/epub/epub-screen-pagination.ts src/services/epub/__tests__/epub-screen-pagination.test.ts
git commit -m "添加 EPUB 屏幕页码模型"
```

---

### Task 2: Compatible Types and UI Display

**Files:**
- Modify: `src/services/epub/types.ts`
- Modify: `src/components/epub/BottomNav.svelte`
- Modify: `src/components/epub/TableOfContents.svelte`
- Test: `src/components/epub/useEpubNavigation.test.ts` only if existing Svelte tests are too costly; otherwise use focused component tests if already present.

**Interfaces:**
- Consumes: Task 1 output labels and page ranges.
- Produces:
  - `TocItem.screenPageNumber?: number`
  - `PaginationInfo.screenStartPage?: number`
  - `PaginationInfo.screenEndPage?: number`
  - `PaginationInfo.screenTotalPages?: number`
  - `PaginationInfo.pageLabel?: string`

- [ ] **Step 1: Write failing type/UI tests**

Add a focused test around the pure display helper if one exists; otherwise add a minimal `BottomNav` render test:

```ts
import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import BottomNav from "./BottomNav.svelte";

describe("BottomNav screen page label", () => {
	it("prefers pageLabel over the legacy current / total template", () => {
		render(BottomNav, {
			props: {
				onPrev: vi.fn(),
				onNext: vi.fn(),
				currentPage: 10,
				totalPages: 214,
				pageLabel: "第 10-11 / 214 页",
			},
		});
		expect(screen.getByText("第 10-11 / 214 页")).toBeTruthy();
	});
});
```

If Svelte 5 test setup rejects direct props, implement a pure helper in `BottomNav.svelte` or a sibling module and test that helper.

- [ ] **Step 2: Run focused UI/type test to verify failure**

Run: `npx vitest run src/components/epub/BottomNav.test.ts --reporter dot`

Expected: FAIL because `pageLabel` is not accepted or not rendered.

- [ ] **Step 3: Extend types**

Patch `src/services/epub/types.ts`:

```ts
export interface TocItem {
	id: string;
	label: string;
	href: string;
	level: number;
	pageNumber?: number;
	screenPageNumber?: number;
	subitems?: TocItem[];
}

export interface PaginationInfo {
	currentPage: number;
	totalPages: number;
	screenStartPage?: number;
	screenEndPage?: number;
	screenTotalPages?: number;
	pageLabel?: string;
}
```

- [ ] **Step 4: Update `BottomNav.svelte`**

Add `pageLabel?: string` to props and display it when present:

```svelte
interface Props {
	onPrev: () => void;
	onNext: () => void;
	onJumpToPage?: (pageNumber: number) => void | Promise<void>;
	currentPage?: number;
	totalPages?: number;
	pageLabel?: string;
	vertical?: boolean;
	statusText?: string;
	statusDetail?: string;
	busy?: boolean;
}
```

Use `pageLabel || t('epub.bottomNav.pageStatus', { current: currentPage, total: totalPages })` in the non-vertical label path.

- [ ] **Step 5: Update `TableOfContents.svelte`**

Replace direct `item.pageNumber` rendering with a tiny helper:

```ts
function getDisplayPageNumber(item: TocItem): number | undefined {
	return item.screenPageNumber || item.pageNumber;
}
```

Render `getDisplayPageNumber(item)`.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run src/components/epub/BottomNav.test.ts --reporter dot`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/services/epub/types.ts src/components/epub/BottomNav.svelte src/components/epub/TableOfContents.svelte src/components/epub/BottomNav.test.ts
git commit -m "支持 EPUB 屏幕页码显示"
```

---

### Task 3: Parser Read-Only Section Helpers

**Files:**
- Modify: `src/services/epub/FoliateVaultPublicationParser.ts`
- Test: `src/services/epub/__tests__/FoliateVaultPublicationParser.test.ts`

**Interfaces:**
- Consumes: existing private `sectionDescriptors`, `resolveHrefTarget`, and `normalizeSectionHref`.
- Produces:
  - `getAllSectionReadingMetrics(): FoliateSectionReadingMetrics[]`
  - `resolveHrefSectionIndex(href: string): Promise<number | null>`

- [ ] **Step 1: Write failing parser tests**

```ts
it("exposes read-only section metrics for screen pagination", async () => {
	const parser = new FoliateVaultPublicationParser(createMockApp(await createSampleEpubBuffer()) as any);
	await parser.load("Books/foliate-sample.epub");
	const metrics = parser.getAllSectionReadingMetrics();
	expect(metrics).toHaveLength(1);
	expect(metrics[0]).toMatchObject({
		index: 0,
		href: "OPS/text/chapter1.xhtml",
		positionStart: 0,
	});
	metrics[0]!.positionStart = 999;
	expect(parser.getAllSectionReadingMetrics()[0]!.positionStart).toBe(0);
});
```

- [ ] **Step 2: Run parser test to verify failure**

Run: `npx vitest run src/services/epub/__tests__/FoliateVaultPublicationParser.test.ts --reporter dot`

Expected: FAIL because `getAllSectionReadingMetrics` is not defined.

- [ ] **Step 3: Add read-only helpers**

Implement:

```ts
getAllSectionReadingMetrics(): FoliateSectionReadingMetrics[] {
	return this.sectionDescriptors.map((section) => ({
		index: section.index,
		href: section.href,
		title: section.title,
		textLength: section.textLength,
		wordCount: section.wordCount,
		positionCount: section.positionCount,
		positionStart: section.positionStart,
	}));
}

async resolveHrefSectionIndex(href: string): Promise<number | null> {
	const resolved = await this.resolveHrefTarget(href);
	return typeof resolved?.index === "number" ? resolved.index : null;
}
```

- [ ] **Step 4: Run parser tests**

Run: `npx vitest run src/services/epub/__tests__/FoliateVaultPublicationParser.test.ts --reporter dot`

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/services/epub/FoliateVaultPublicationParser.ts src/services/epub/__tests__/FoliateVaultPublicationParser.test.ts
git commit -m "暴露 EPUB 章节页码指标"
```

---

### Task 4: FoliateReaderService Screen-Page Integration

**Files:**
- Modify: `src/services/epub/FoliateReaderService.ts`
- Test: `src/services/epub/__tests__/FoliateReaderService.test.ts`

**Interfaces:**
- Consumes: Task 1 `buildScreenPaginationState`, `resolveScreenPageRange`, `cloneTocItemsWithScreenPages`.
- Consumes: Task 3 `getAllSectionReadingMetrics`, `resolveHrefSectionIndex`.
- Produces:
  - `private screenPaginationState: ScreenPaginationState | null`
  - `private screenPaginationLayoutKey = ""`
  - `private screenPaginationRevision = 0`
  - `private buildCurrentScreenPaginationState(): ScreenPaginationState | null`
  - `private getCurrentScreenVisiblePageCount(): number`
  - `private readRelocateScreenPageDetail(detail: FoliateRelocateDetail): { sectionLocalPage?: number; sectionPageCount?: number }`
  - `private publishPaginationInfo(info: PaginationInfo): void`

- [ ] **Step 1: Write failing tests for dual-page optimistic pagination**

Replace the current assertion in `"optimistically updates pagination after page-turn APIs before relocate arrives"` or add a new test:

```ts
it("optimistically advances screen pagination by two in dual-page mode", async () => {
	const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
	try {
		const view = {
			next: vi.fn().mockResolvedValue(undefined),
			removeEventListener: vi.fn(),
			close: vi.fn(),
			remove: vi.fn(),
		};
		(service as any).foliateView = view;
		(service as any).currentFlowMode = "paginated";
		(service as any).currentLayoutMode = "double";
		(service as any).currentPaginationInfo = {
			currentPage: 10,
			totalPages: 100,
			screenStartPage: 10,
			screenEndPage: 11,
			screenTotalPages: 100,
			pageLabel: "第 10-11 / 100 页",
		};
		const paginationChanged = vi.fn();
		const detach = service.onPaginationChanged(paginationChanged);
		await service.nextPage();
		await expect(service.getPaginationInfo()).resolves.toMatchObject({
			currentPage: 12,
			totalPages: 100,
			screenStartPage: 12,
			screenEndPage: 13,
		});
		detach();
	} finally {
		service.destroy();
	}
});
```

- [ ] **Step 2: Write failing tests for relocate-derived screen range**

```ts
it("uses Foliate relocate fraction and size for current screen page range", async () => {
	const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any) as any;
	const container = document.createElement("div");
	document.body.appendChild(container);
	try {
		await service.loadEpub("Books/foliate-sample.epub", "foliate-book", { skipCoverImage: true });
		await service.renderTo(container, {
			flow: "paginated",
			spread: "always",
			width: 1200,
			height: 720,
			lineHeight: 1.6,
			pageMargin: 48,
			widthMode: "full",
		});
		const view = container.querySelector("foliate-view");
		view?.dispatchEvent(new CustomEvent("relocate", {
			detail: {
				index: 0,
				cfi: "epubcfi(/6/2!/4/2/2)",
				fraction: 0.25,
				size: 0.125,
			},
		}));
		await Promise.resolve();
		await expect(service.getPaginationInfo()).resolves.toMatchObject({
			screenStartPage: 3,
			screenEndPage: 4,
			pageLabel: "第 3-4 /",
		});
	} finally {
		service.destroy();
	}
});
```

If exact label total is hard to assert in the existing fake EPUB, assert start/end and `pageLabel` contains `3-4`.

- [ ] **Step 3: Run service tests to verify failure**

Run: `npx vitest run src/services/epub/__tests__/FoliateReaderService.test.ts --reporter dot`

Expected: FAIL on missing screen pagination fields or dual-page delta.

- [ ] **Step 4: Add local relocate detail type**

```ts
type FoliateRelocateDetail = {
	cfi?: string;
	index?: number;
	fraction?: number;
	size?: number;
	location?: unknown;
	range?: unknown;
};
```

- [ ] **Step 5: Build layout input without forcing reflow loops**

Use existing `computePaginatorLayoutMetrics()` and `getObsidianStyleSource()`:

```ts
private buildScreenPaginationLayoutInput(): ScreenPaginationLayoutInput | null {
	const bookId = this.currentBook?.id || "";
	const bounds = this.renderContainer?.getBoundingClientRect();
	const metrics = this.computePaginatorLayoutMetrics();
	const style = getComputedStyle(this.getObsidianStyleSource());
	const fontSizePx = Number.parseFloat(style.fontSize || "16") || 16;
	if (!bookId || !bounds) return null;
	return {
		bookId,
		viewportWidth: Math.max(1, Math.round(bounds.width)),
		viewportHeight: Math.max(1, Math.round(bounds.height)),
		inlineWidthPx: Number.parseFloat(metrics.inlineSize) || Math.max(1, Math.round(bounds.width)),
		fontSizePx,
		lineHeight: this.currentLineHeight,
		letterSpacing: this.currentLetterSpacing,
		pageMargin: this.currentPageMargin,
		gap: metrics.gap,
		widthMode: this.currentWidthMode,
		layoutMode: this.currentLayoutMode,
		flowMode: this.currentFlowMode,
	};
}
```

- [ ] **Step 6: Build and invalidate the active screen-page state**

Use `screenPaginationRevision` to prevent stale layout results from overwriting current state:

```ts
private refreshScreenPaginationState(): void {
	const layout = this.buildScreenPaginationLayoutInput();
	if (!layout) {
		this.screenPaginationState = null;
		this.screenPaginationLayoutKey = "";
		return;
	}
	const sections = this.parser.getAllSectionReadingMetrics().map((metric) => ({
		index: metric.index,
		href: metric.href,
		textLength: metric.textLength,
		fallbackPositionCount: metric.positionCount,
		fixedLayout: this.parser.isFixedLayout(),
	}));
	const nextState = buildScreenPaginationState({ layout, sections });
	this.screenPaginationRevision += 1;
	this.screenPaginationLayoutKey = nextState.layoutKey;
	this.screenPaginationState = nextState;
}
```

Call this after `applyRenderOptions`, `applyReaderAppearance`, `setLayoutMode`, and `resize`.

- [ ] **Step 7: Publish compatible pagination info**

Add helper:

```ts
private publishPaginationInfo(info: PaginationInfo): void {
	this.currentPaginationInfo = info;
	for (const callback of this.paginationCallbacks) {
		try {
			callback(this.currentPaginationInfo);
		} catch (error) {
			logger.warn("[FoliateReaderService] Pagination listener failed:", error);
		}
	}
}
```

Replace repeated callback loops with this helper.

- [ ] **Step 8: Convert relocate detail to screen page range**

Rules:
- `sectionLocalPage = Math.floor(fraction / size) + 1` when `fraction` and `size` are valid.
- `sectionPageCount = Math.round(1 / size)` when `size` is valid.
- In dual-page mode, clamp `sectionLocalPage` to an odd left-page start when the visible pair starts on the left.
- If detail is missing, keep fallback from `parser.resolvePageNumberForResolvedTarget`.

- [ ] **Step 9: Route `syncCurrentPositionFromTarget` through screen pagination**

Pass the relocate detail into `syncCurrentPositionFromTarget(target, textHint, token, detail)`. Build `PaginationInfo` with legacy fields set to the screen-page start/total so existing consumers do not break:

```ts
const screenRange = this.resolveCurrentScreenPageRange(resolved.index, currentPage, detail);
this.publishPaginationInfo({
	currentPage: screenRange?.startPage || currentPage,
	totalPages: screenRange?.totalPages || totalPages,
	screenStartPage: screenRange?.startPage,
	screenEndPage: screenRange?.endPage,
	screenTotalPages: screenRange?.totalPages,
	pageLabel: screenRange
		? screenRange.startPage === screenRange.endPage
			? `第 ${screenRange.startPage} / ${screenRange.totalPages} 页`
			: `第 ${screenRange.startPage}-${screenRange.endPage} / ${screenRange.totalPages} 页`
		: undefined,
});
```

- [ ] **Step 10: Update optimistic next/prev**

In `syncPaginationAfterPageTurn`, use `delta = 2` only when `currentFlowMode === "paginated" && currentLayoutMode === "double"`. Keep scrolled and single-page as `1`.

- [ ] **Step 11: Update screen page jump**

In `goToPage`, first map screen page to a section and section-local page. Use the parser fallback CFI by converting section-local page to section progress:

```ts
const target = this.resolveCfiForScreenPage(pageNumber);
const canonical = target ? await this.parser.resolveCfiForPage(target.legacyPositionPage) : await this.parser.resolveCfiForPage(pageNumber);
```

First version may use the corresponding legacy estimated page inside that section; do not block UI waiting for a hidden render pass.

- [ ] **Step 12: Run service tests**

Run: `npx vitest run src/services/epub/__tests__/FoliateReaderService.test.ts --reporter dot`

Expected: PASS.

- [ ] **Step 13: Commit Task 4**

```bash
git add src/services/epub/FoliateReaderService.ts src/services/epub/__tests__/FoliateReaderService.test.ts
git commit -m "接入 EPUB 屏幕页码"
```

---

### Task 5: TOC Screen Page Numbers

**Files:**
- Modify: `src/services/epub/FoliateReaderService.ts`
- Test: `src/services/epub/__tests__/FoliateReaderService.test.ts`

**Interfaces:**
- Consumes: Task 4 `screenPaginationState`.
- Produces: `getTableOfContents()` returns cloned TOC items with `screenPageNumber`.

- [ ] **Step 1: Write failing TOC test**

```ts
it("returns TOC entries with screen page numbers when a screen index exists", async () => {
	const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any) as any;
	const container = document.createElement("div");
	document.body.appendChild(container);
	try {
		await service.loadEpub("Books/foliate-sample.epub", "foliate-book", { skipCoverImage: true });
		await service.renderTo(container, {
			flow: "paginated",
			spread: "none",
			width: 720,
			height: 720,
			lineHeight: 1.6,
			pageMargin: 48,
			widthMode: "standard",
		});
		const toc = await service.getTableOfContents();
		expect(toc[0]?.screenPageNumber).toBe(1);
		expect(toc[0]?.subitems?.[0]?.screenPageNumber).toBe(1);
	});
	finally {
		service.destroy();
	}
});
```

- [ ] **Step 2: Run service test to verify failure**

Run: `npx vitest run src/services/epub/__tests__/FoliateReaderService.test.ts --reporter dot`

Expected: FAIL because `screenPageNumber` is not populated.

- [ ] **Step 3: Clone TOC instead of mutating parser TOC**

Implement `getTableOfContents()` as:

```ts
async getTableOfContents(): Promise<TocItem[]> {
	await this.parser.hydrateTocPageNumbersForCurrentBook();
	const items = this.parser.getTocItems();
	if (!this.screenPaginationState) {
		return items;
	}
	return cloneTocItemsWithScreenPages(items, (item) => this.resolveScreenPageForTocHref(item.href));
}
```

Resolve `href` to a section index through parser helpers; return that section's `pageStart`.

- [ ] **Step 4: Run TOC test**

Run: `npx vitest run src/services/epub/__tests__/FoliateReaderService.test.ts --reporter dot`

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/services/epub/FoliateReaderService.ts src/services/epub/__tests__/FoliateReaderService.test.ts
git commit -m "目录显示 EPUB 屏幕页码"
```

---

### Task 6: App Wiring, Build, Runtime Copy, Push

**Files:**
- Modify: `src/components/epub/EpubReaderApp.svelte`
- Possibly Modify: `src/components/epub/BottomNav.svelte`
- Runtime copy target: `D:\ResOB\note\.obsidian\plugins\weave-reader`

**Interfaces:**
- Consumes: `PaginationInfo.pageLabel`, `screenStartPage`, `screenEndPage`, `screenTotalPages`.
- Produces: running Obsidian plugin receives built `main.js`, `styles.css`, `manifest.json`, `versions.json`.

- [ ] **Step 1: Pass `pageLabel` into BottomNav**

Find the `BottomNav` component usage and add:

```svelte
pageLabel={paginationInfo.pageLabel}
```

Keep existing `currentPage={paginationInfo.currentPage}` and `totalPages={paginationInfo.totalPages}`.

- [ ] **Step 2: Run focused test group**

Run:

```bash
npx vitest run src/services/epub/__tests__/epub-screen-pagination.test.ts src/services/epub/__tests__/FoliateReaderService.test.ts src/components/epub/BottomNav.test.ts --reporter dot
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: PASS. Existing Svelte a11y warnings may remain, but no build error.

- [ ] **Step 4: Copy runtime files**

Run:

```powershell
Copy-Item -LiteralPath "main.js" -Destination "D:\ResOB\note\.obsidian\plugins\weave-reader\main.js" -Force
Copy-Item -LiteralPath "styles.css" -Destination "D:\ResOB\note\.obsidian\plugins\weave-reader\styles.css" -Force
Copy-Item -LiteralPath "manifest.json" -Destination "D:\ResOB\note\.obsidian\plugins\weave-reader\manifest.json" -Force
Copy-Item -LiteralPath "versions.json" -Destination "D:\ResOB\note\.obsidian\plugins\weave-reader\versions.json" -Force
```

- [ ] **Step 5: Verify runtime hashes**

Run:

```powershell
$files = "main.js","styles.css","manifest.json","versions.json"
foreach ($file in $files) {
	$source = Join-Path (Get-Location) $file
	$target = Join-Path "D:\ResOB\note\.obsidian\plugins\weave-reader" $file
	"$file`t$((Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash -eq (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash)"
}
```

Expected: every line ends with `True`.

- [ ] **Step 6: Commit and push**

```bash
git status --short
git add src/services/epub src/components/epub src/utils/i18n docs/superpowers/plans/2026-08-07-epub-screen-pagination.md
git commit -m "优化 EPUB 屏幕页码"
git push origin integration/epub-ai-pdf-reader
```

---

## Self-Review

- Spec coverage: bottom page number, dual-page range, scrolled screen mapping, TOC page numbers, CFI data boundary, layout invalidation, and performance constraints are all mapped to tasks.
- Placeholder scan: no placeholder markers or open-ended "handle later" steps remain.
- Type consistency: `screenStartPage`, `screenEndPage`, `screenTotalPages`, `pageLabel`, and `screenPageNumber` are introduced in Task 2 and consumed by later tasks.
- Scope check: this is one EPUB pagination subsystem. PDF page numbers and PDF ink editing are not part of this plan.
