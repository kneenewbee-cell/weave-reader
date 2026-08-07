# PDF Ink Bulk Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stroke-select-only floating panel for batch editing selected PDF ink strokes.

**Architecture:** Put pure ink geometry/style transformations in a small PDF service module with unit tests, then wire `PdfView.ts` to right-click selected strokes and render a compact editor panel. Slider input updates the in-memory preview, while change/commit persists once and records one undo snapshot.

**Tech Stack:** TypeScript, Vitest, Obsidian ItemView DOM APIs, existing PDF SVG annotation layer, existing `PdfInkAnnotationStore`.

## Global Constraints

- The feature is active only when `activeTool === "stroke-select"`.
- The feature edits PDF ink strokes only; it does not edit PDF text annotations or EPUB annotations.
- The editor is a floating panel styled like the existing PDF tool settings panel.
- Scale is relative to the selected strokes' geometry when the panel opens; `100%` is the per-open baseline.
- Scale range is `50%` to `200%`.
- Slider `input` may preview in memory, but must not persist to disk on every event.
- Slider `change` commits once, pushes undo once, and calls `persistPdfAnnotations()`.
- Scaling uses the selected strokes' combined bounding-box center and scales stroke width with geometry.

---

## File Structure

- Create `src/services/pdf/pdf-ink-bulk-edit.ts`
  - Owns pure functions for selected-stroke bounds, style patching, and baseline-relative scaling.
  - Has no DOM, no Obsidian dependency, and no persistence.
- Create `src/services/pdf/pdf-ink-bulk-edit.test.ts`
  - Tests geometry and style behavior without rendering a PDF view.
- Modify `src/views/PdfView.ts`
  - Adds right-click handling in `stroke-select` mode.
  - Adds editor panel state, panel rendering, preview, commit, and cleanup.
  - Reuses existing `selectedInkStrokeIds`, `pushUndoSnapshot`, `renderInkStrokesForPage`, `persistPdfAnnotations`, and `syncAsActivePdfDocument`.
- Modify `src/styles/pdf/pdf-reader.css`
  - Adds compact panel layout and controls, reusing existing PDF panel visual language.
- Modify `src/views/PdfView.test.ts`
  - Adds integration tests for right-click opening, tool gating, style edits, scale preview/commit, and undo.

---

### Task 1: Pure Ink Bulk Edit Helpers

**Files:**
- Create: `src/services/pdf/pdf-ink-bulk-edit.ts`
- Test: `src/services/pdf/pdf-ink-bulk-edit.test.ts`

**Interfaces:**
- Consumes: `PdfInkStroke`, `PdfInkDrawingTool` from `src/services/pdf/pdf-ink-annotation-store.ts`.
- Produces:
  - `PDF_INK_BULK_SCALE_MIN = 0.5`
  - `PDF_INK_BULK_SCALE_MAX = 2`
  - `PDF_INK_BULK_WIDTH_MIN = 1`
  - `PDF_INK_BULK_WIDTH_MAX = 40`
  - `interface PdfInkBounds { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number }`
  - `interface PdfInkStylePatch { tool?: PdfInkDrawingTool; color?: string; width?: number }`
  - `getPdfInkSelectionBounds(strokes: PdfInkStroke[]): PdfInkBounds | null`
  - `applyPdfInkStylePatch(strokes: PdfInkStroke[], selectedIds: Set<string>, patch: PdfInkStylePatch): PdfInkStroke[]`
  - `scalePdfInkSelectionFromBaseline(currentStrokes: PdfInkStroke[], baselineSelectedStrokes: PdfInkStroke[], selectedIds: Set<string>, scale: number): PdfInkStroke[]`

- [ ] **Step 1: Write failing bounds and scale tests**

Add this test content to `src/services/pdf/pdf-ink-bulk-edit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PdfInkStroke } from "./pdf-ink-annotation-store";
import {
	applyPdfInkStylePatch,
	getPdfInkSelectionBounds,
	scalePdfInkSelectionFromBaseline,
} from "./pdf-ink-bulk-edit";

const strokeA: PdfInkStroke = {
	id: "a",
	pageNumber: 1,
	tool: "pen",
	color: "#111111",
	width: 2,
	points: [
		{ x: 0.2, y: 0.2, t: 1 },
		{ x: 0.4, y: 0.4, t: 2 },
	],
};

const strokeB: PdfInkStroke = {
	id: "b",
	pageNumber: 1,
	tool: "highlighter",
	color: "#ffd54a",
	width: 10,
	points: [
		{ x: 0.6, y: 0.3, t: 3 },
		{ x: 0.8, y: 0.5, t: 4 },
	],
};

describe("pdf ink bulk edit helpers", () => {
	it("computes the combined bounds and center for selected strokes", () => {
		expect(getPdfInkSelectionBounds([strokeA, strokeB])).toEqual({
			left: 0.2,
			top: 0.2,
			right: 0.8,
			bottom: 0.5,
			centerX: 0.5,
			centerY: 0.35,
		});
	});

	it("applies style changes only to selected strokes", () => {
		const result = applyPdfInkStylePatch([strokeA, strokeB], new Set(["b"]), {
			tool: "pen",
			color: "#ff0000",
			width: 3,
		});

		expect(result[0]).toEqual(strokeA);
		expect(result[1]).toMatchObject({
			id: "b",
			tool: "pen",
			color: "#ff0000",
			width: 3,
		});
		expect(result[1].points).toEqual(strokeB.points);
	});

	it("scales selected strokes around their group center and scales width", () => {
		const result = scalePdfInkSelectionFromBaseline(
			[strokeA, strokeB],
			[strokeA, strokeB],
			new Set(["a", "b"]),
			2,
		);

		expect(result[0].points).toEqual([
			{ x: 0, y: 0.05, t: 1 },
			{ x: 0.3, y: 0.45, t: 2 },
		]);
		expect(result[1].points).toEqual([
			{ x: 0.7, y: 0.25, t: 3 },
			{ x: 1, y: 0.65, t: 4 },
		]);
		expect(result[0].width).toBe(4);
		expect(result[1].width).toBe(20);
	});
});
```

- [ ] **Step 2: Run the helper tests and verify they fail**

Run:

```powershell
npx vitest run src/services/pdf/pdf-ink-bulk-edit.test.ts
```

Expected: FAIL because `src/services/pdf/pdf-ink-bulk-edit.ts` does not exist.

- [ ] **Step 3: Implement the pure helper module**

Create `src/services/pdf/pdf-ink-bulk-edit.ts`:

```ts
import type { PdfInkDrawingTool, PdfInkStroke } from "./pdf-ink-annotation-store";
import { clonePdfInkStrokes } from "./pdf-ink-annotation-store";

export const PDF_INK_BULK_SCALE_MIN = 0.5;
export const PDF_INK_BULK_SCALE_MAX = 2;
export const PDF_INK_BULK_WIDTH_MIN = 1;
export const PDF_INK_BULK_WIDTH_MAX = 40;

export interface PdfInkBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
	centerX: number;
	centerY: number;
}

export interface PdfInkStylePatch {
	tool?: PdfInkDrawingTool;
	color?: string;
	width?: number;
}

function clampUnit(value: number): number {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function clampWidth(value: number): number {
	return Math.max(
		PDF_INK_BULK_WIDTH_MIN,
		Math.min(PDF_INK_BULK_WIDTH_MAX, Number.isFinite(value) ? value : PDF_INK_BULK_WIDTH_MIN),
	);
}

function clampScale(value: number): number {
	return Math.max(
		PDF_INK_BULK_SCALE_MIN,
		Math.min(PDF_INK_BULK_SCALE_MAX, Number.isFinite(value) ? value : 1),
	);
}

export function getPdfInkSelectionBounds(strokes: PdfInkStroke[]): PdfInkBounds | null {
	const points = strokes.flatMap((stroke) => stroke.points || []);
	if (points.length === 0) {
		return null;
	}
	const left = Math.min(...points.map((point) => point.x));
	const right = Math.max(...points.map((point) => point.x));
	const top = Math.min(...points.map((point) => point.y));
	const bottom = Math.max(...points.map((point) => point.y));
	return {
		left,
		top,
		right,
		bottom,
		centerX: (left + right) / 2,
		centerY: (top + bottom) / 2,
	};
}

export function applyPdfInkStylePatch(
	strokes: PdfInkStroke[],
	selectedIds: Set<string>,
	patch: PdfInkStylePatch,
): PdfInkStroke[] {
	return strokes.map((stroke) => {
		if (!selectedIds.has(stroke.id)) {
			return clonePdfInkStrokes([stroke])[0];
		}
		return {
			...clonePdfInkStrokes([stroke])[0],
			...(patch.tool ? { tool: patch.tool } : {}),
			...(patch.color ? { color: patch.color } : {}),
			...(typeof patch.width === "number" ? { width: clampWidth(patch.width) } : {}),
		};
	});
}

export function scalePdfInkSelectionFromBaseline(
	currentStrokes: PdfInkStroke[],
	baselineSelectedStrokes: PdfInkStroke[],
	selectedIds: Set<string>,
	scale: number,
): PdfInkStroke[] {
	const clampedScale = clampScale(scale);
	const bounds = getPdfInkSelectionBounds(baselineSelectedStrokes);
	if (!bounds) {
		return clonePdfInkStrokes(currentStrokes);
	}
	const baselineById = new Map(
		baselineSelectedStrokes.map((stroke) => [stroke.id, stroke] as const),
	);
	return currentStrokes.map((stroke) => {
		const baseline = selectedIds.has(stroke.id) ? baselineById.get(stroke.id) : null;
		if (!baseline) {
			return clonePdfInkStrokes([stroke])[0];
		}
		return {
			...clonePdfInkStrokes([baseline])[0],
			width: clampWidth(baseline.width * clampedScale),
			points: baseline.points.map((point) => ({
				...point,
				x: clampUnit(bounds.centerX + (point.x - bounds.centerX) * clampedScale),
				y: clampUnit(bounds.centerY + (point.y - bounds.centerY) * clampedScale),
			})),
		};
	});
}
```

- [ ] **Step 4: Run helper tests and verify they pass**

Run:

```powershell
npx vitest run src/services/pdf/pdf-ink-bulk-edit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add src/services/pdf/pdf-ink-bulk-edit.ts src/services/pdf/pdf-ink-bulk-edit.test.ts
git commit -m "添加PDF墨迹批量编辑工具"
```

---

### Task 2: Stroke-Select Right-Click Panel

**Files:**
- Modify: `src/views/PdfView.ts`
- Modify: `src/styles/pdf/pdf-reader.css`
- Test: `src/views/PdfView.test.ts`

**Interfaces:**
- Consumes from Task 1:
  - `PDF_INK_BULK_SCALE_MIN`, `PDF_INK_BULK_SCALE_MAX`
  - `applyPdfInkStylePatch(...)`
  - `scalePdfInkSelectionFromBaseline(...)`
- Produces inside `PdfView`:
  - `private inkEditPanelEl: HTMLElement | null`
  - `private inkEditSession: { pageNumber: number; selectedIds: Set<string>; beforeStrokes: PdfInkStroke[]; baselineSelectedStrokes: PdfInkStroke[]; activeGestureBeforeStrokes: PdfInkStroke[] | null; gestureDirty: boolean } | null`
  - `private handleInkContextMenu(event: MouseEvent, pageNumber: number, layer: SVGSVGElement): void`
  - `private openInkEditPanel(pageNumber: number, anchor: { x: number; y: number }): void`
  - `private closeInkEditPanel(): void`
  - `private applySelectedInkStyle(patch: PdfInkStylePatch): void`
  - `private previewSelectedInkScale(scalePercent: number): void`
  - `private commitInkEditGesture(): void`

- [ ] **Step 1: Write failing right-click panel tests**

Add tests to `src/views/PdfView.test.ts` near the existing stroke-select tests:

```ts
it("opens an ink edit panel when right-clicking a selected stroke in stroke select mode", async () => {
	const restoreCanvas = installCanvasMock();
	const { pdf } = createMockPdfDocument(1);
	vi.mocked(loadPdfJs).mockResolvedValue({
		getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
	} as any);
	const { view, adapter } = createPdfView();

	adapter.exists.mockImplementation(async (path: string) =>
		String(path).startsWith("weave/pdf-annotations/")
	);
	adapter.read.mockResolvedValue(JSON.stringify({
		version: 1,
		sourcePath: "Books/duboule-page.pdf",
		pageCount: 1,
		strokes: [{
			id: "stroke-a",
			pageNumber: 1,
			tool: "pen",
			color: "#111111",
			width: 2,
			points: [{ x: 0.2, y: 0.2, t: 1 }, { x: 0.4, y: 0.4, t: 2 }],
		}],
		textAnnotations: [],
		updatedAt: 1,
	}));

	await view.onOpen();
	await Promise.resolve();
	await Promise.resolve();

	const layer = view.contentEl.querySelector<SVGSVGElement>(".weave-pdf-annotation-layer")!;
	layer.getBoundingClientRect = vi.fn(() => ({
		top: 0, bottom: 280, height: 280, left: 0, right: 200, width: 200, x: 0, y: 0, toJSON: () => ({}),
	} as DOMRect));

	view.contentEl.querySelector<HTMLButtonElement>('[data-weave-pdf-tool="stroke-select"]')?.click();
	dispatchPointerEvent(layer, "pointerdown", { clientX: 50, clientY: 70, pointerType: "mouse" });
	dispatchPointerEvent(layer, "pointerup", { clientX: 50, clientY: 70, buttons: 0, pointerType: "mouse" });

	layer.dispatchEvent(new MouseEvent("contextmenu", {
		bubbles: true,
		cancelable: true,
		clientX: 50,
		clientY: 70,
		button: 2,
	}));

	const panel = view.contentEl.querySelector<HTMLElement>("[data-weave-pdf-ink-edit-panel]");
	expect(panel).toBeTruthy();
	expect(panel?.textContent).toContain("墨迹编辑");
	expect(panel?.querySelector('[data-weave-pdf-ink-edit-tool="pen"]')).toBeTruthy();
	expect(panel?.querySelector('[data-weave-pdf-ink-edit-tool="highlighter"]')).toBeTruthy();
	expect(panel?.querySelector<HTMLInputElement>('[data-weave-pdf-ink-edit-scale]')?.value).toBe("100");
	restoreCanvas();
});

it("does not open the ink edit panel outside stroke select mode", async () => {
	const restoreCanvas = installCanvasMock();
	const { pdf } = createMockPdfDocument(1);
	vi.mocked(loadPdfJs).mockResolvedValue({
		getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
	} as any);
	const { view, adapter } = createPdfView();
	adapter.exists.mockResolvedValue(false);

	await view.onOpen();
	await Promise.resolve();
	await Promise.resolve();

	const layer = view.contentEl.querySelector<SVGSVGElement>(".weave-pdf-annotation-layer")!;
	layer.dispatchEvent(new MouseEvent("contextmenu", {
		bubbles: true,
		cancelable: true,
		clientX: 50,
		clientY: 70,
		button: 2,
	}));

	expect(view.contentEl.querySelector("[data-weave-pdf-ink-edit-panel]")).toBeNull();
	restoreCanvas();
});
```

- [ ] **Step 2: Run right-click panel tests and verify they fail**

Run:

```powershell
npx vitest run src/views/PdfView.test.ts -t "ink edit panel"
```

Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Wire contextmenu listener in `PdfView.ts`**

In the code that creates each `.weave-pdf-annotation-layer`, add:

```ts
layer.addEventListener("contextmenu", (event) => {
	this.handleInkContextMenu(event, pageNumber, layer);
});
```

Add `Menu` to the Obsidian import only if the implementation chooses native menus. The chosen implementation must not use native `Menu`.

- [ ] **Step 4: Add panel state fields**

Near the other ink selection fields in `PdfView.ts`, add:

```ts
private inkEditPanelEl: HTMLElement | null = null;
private inkEditSession: {
	pageNumber: number;
	selectedIds: Set<string>;
	beforeStrokes: PdfInkStroke[];
	baselineSelectedStrokes: PdfInkStroke[];
	activeGestureBeforeStrokes: PdfInkStroke[] | null;
	gestureDirty: boolean;
} | null = null;
```

- [ ] **Step 5: Implement `handleInkContextMenu`**

Add a method that:

```ts
private handleInkContextMenu(
	event: MouseEvent,
	pageNumber: number,
	layer: SVGSVGElement
): void {
	if (this.activeTool !== "stroke-select") {
		return;
	}
	const point = this.eventToInkPoint(event as PointerEvent, layer);
	if (!point) {
		this.closeInkEditPanel();
		return;
	}
	const hitStroke = this.findInkStrokeAtPoint(pageNumber, point, layer);
	if (!hitStroke) {
		this.closeInkEditPanel();
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	if (!this.selectedInkStrokeIds.has(hitStroke.id)) {
		this.selectedInkStrokeIds = new Set([hitStroke.id]);
		this.renderInkStrokesForPage(pageNumber);
	}
	this.openInkEditPanel(pageNumber, { x: event.clientX, y: event.clientY });
}
```

If TypeScript rejects the PointerEvent cast, change `eventToInkPoint` to accept `MouseEvent | PointerEvent` because it only reads `clientX/clientY`.

- [ ] **Step 6: Implement panel rendering**

Create `openInkEditPanel` and `closeInkEditPanel`. The panel must:

- Be appended under the current PDF reader root or `contentEl`.
- Have `data-weave-pdf-ink-edit-panel="true"`.
- Stop `mousedown`, `pointerdown`, and `contextmenu` propagation.
- Show title `墨迹编辑`.
- Render tool buttons with `data-weave-pdf-ink-edit-tool="pen"` and `"highlighter"`.
- Render color swatches with `data-weave-pdf-ink-edit-color`.
- Render width slider with `data-weave-pdf-ink-edit-width`.
- Render scale slider with `data-weave-pdf-ink-edit-scale`, `min="50"`, `max="200"`, `step="1"`, `value="100"`.

- [ ] **Step 7: Add CSS**

In `src/styles/pdf/pdf-reader.css`, add selectors:

```css
.weave-pdf-ink-edit-panel {
	position: fixed;
	z-index: 1000;
	width: 260px;
	padding: 12px;
	border: 1px solid var(--background-modifier-border);
	border-radius: 6px;
	background: var(--background-primary);
	box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
}

.weave-pdf-ink-edit-panel__header,
.weave-pdf-ink-edit-panel__row {
	display: flex;
	align-items: center;
	gap: 10px;
}

.weave-pdf-ink-edit-panel__tool-row {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
}
```

Use existing project class naming and CSS variables. If equivalent panel styles already exist, share their classes instead of duplicating large blocks.

- [ ] **Step 8: Run right-click panel tests and verify they pass**

Run:

```powershell
npx vitest run src/views/PdfView.test.ts -t "ink edit panel"
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

Run:

```powershell
git add src/views/PdfView.ts src/styles/pdf/pdf-reader.css src/views/PdfView.test.ts
git commit -m "添加PDF墨迹编辑面板"
```

---

### Task 3: Style And Scale Editing Behavior

**Files:**
- Modify: `src/views/PdfView.ts`
- Test: `src/views/PdfView.test.ts`

**Interfaces:**
- Consumes Task 2 panel elements and Task 1 helper functions.
- Produces:
  - color swatches call `applySelectedInkStyle({ color })`.
  - tool buttons call `applySelectedInkStyle({ tool })`.
  - width slider previews style on `input` and commits on `change`.
  - scale slider previews geometry on `input` and commits on `change`.

- [ ] **Step 1: Write failing style and scale tests**

Add tests to `src/views/PdfView.test.ts`:

```ts
it("applies ink edit panel color and tool changes to all selected strokes", async () => {
	const restoreCanvas = installCanvasMock();
	const { pdf } = createMockPdfDocument(1);
	vi.mocked(loadPdfJs).mockResolvedValue({
		getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
	} as any);
	const { view, adapter } = createPdfView();
	adapter.exists.mockImplementation(async (path: string) =>
		String(path).startsWith("weave/pdf-annotations/")
	);
	adapter.read.mockResolvedValue(JSON.stringify({
		version: 1,
		sourcePath: "Books/duboule-page.pdf",
		pageCount: 1,
		strokes: [
			{ id: "a", pageNumber: 1, tool: "pen", color: "#111111", width: 2, points: [{ x: 0.2, y: 0.2, t: 1 }, { x: 0.4, y: 0.4, t: 2 }] },
			{ id: "b", pageNumber: 1, tool: "pen", color: "#111111", width: 2, points: [{ x: 0.6, y: 0.3, t: 3 }, { x: 0.8, y: 0.5, t: 4 }] },
		],
		textAnnotations: [],
		updatedAt: 1,
	}));

	await view.onOpen();
	await Promise.resolve();
	await Promise.resolve();

	const layer = view.contentEl.querySelector<SVGSVGElement>(".weave-pdf-annotation-layer")!;
	layer.getBoundingClientRect = vi.fn(() => ({
		top: 0, bottom: 280, height: 280, left: 0, right: 200, width: 200, x: 0, y: 0, toJSON: () => ({}),
	} as DOMRect));
	view.contentEl.querySelector<HTMLButtonElement>('[data-weave-pdf-tool="stroke-select"]')?.click();
	dispatchPointerEvent(layer, "pointerdown", { clientX: 10, clientY: 14, pointerType: "mouse" });
	dispatchPointerEvent(layer, "pointermove", { clientX: 180, clientY: 224, pointerType: "mouse" });
	dispatchPointerEvent(layer, "pointerup", { clientX: 180, clientY: 224, buttons: 0, pointerType: "mouse" });
	layer.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 2 }));

	view.contentEl.querySelector<HTMLButtonElement>('[data-weave-pdf-ink-edit-tool="highlighter"]')?.click();
	view.contentEl.querySelector<HTMLButtonElement>('[data-weave-pdf-ink-edit-color="#ff0000"]')?.click();

	await vi.waitFor(() => expect(adapter.write).toHaveBeenCalled());
	const { payload } = getLastPdfInkAnnotationsPayload(adapter);
	expect(payload.strokes).toHaveLength(2);
	expect(payload.strokes.every((stroke: any) => stroke.tool === "highlighter")).toBe(true);
	expect(payload.strokes.every((stroke: any) => stroke.color === "#ff0000")).toBe(true);
	restoreCanvas();
});

it("previews scale slider changes without repeated persistence and commits once on change", async () => {
	const restoreCanvas = installCanvasMock();
	const { pdf } = createMockPdfDocument(1);
	vi.mocked(loadPdfJs).mockResolvedValue({
		getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
	} as any);
	const { view, adapter } = createPdfView();
	adapter.exists.mockImplementation(async (path: string) =>
		String(path).startsWith("weave/pdf-annotations/")
	);
	adapter.read.mockResolvedValue(JSON.stringify({
		version: 1,
		sourcePath: "Books/duboule-page.pdf",
		pageCount: 1,
		strokes: [
			{ id: "a", pageNumber: 1, tool: "pen", color: "#111111", width: 2, points: [{ x: 0.2, y: 0.2, t: 1 }, { x: 0.4, y: 0.4, t: 2 }] },
			{ id: "b", pageNumber: 1, tool: "pen", color: "#111111", width: 10, points: [{ x: 0.6, y: 0.3, t: 3 }, { x: 0.8, y: 0.5, t: 4 }] },
		],
		textAnnotations: [],
		updatedAt: 1,
	}));

	await view.onOpen();
	await Promise.resolve();
	await Promise.resolve();
	adapter.write.mockClear();

	const layer = view.contentEl.querySelector<SVGSVGElement>(".weave-pdf-annotation-layer")!;
	layer.getBoundingClientRect = vi.fn(() => ({
		top: 0, bottom: 280, height: 280, left: 0, right: 200, width: 200, x: 0, y: 0, toJSON: () => ({}),
	} as DOMRect));
	view.contentEl.querySelector<HTMLButtonElement>('[data-weave-pdf-tool="stroke-select"]')?.click();
	dispatchPointerEvent(layer, "pointerdown", { clientX: 10, clientY: 14, pointerType: "mouse" });
	dispatchPointerEvent(layer, "pointermove", { clientX: 180, clientY: 224, pointerType: "mouse" });
	dispatchPointerEvent(layer, "pointerup", { clientX: 180, clientY: 224, buttons: 0, pointerType: "mouse" });
	layer.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 2 }));

	const scale = view.contentEl.querySelector<HTMLInputElement>("[data-weave-pdf-ink-edit-scale]")!;
	scale.value = "150";
	scale.dispatchEvent(new Event("input", { bubbles: true }));
	expect(adapter.write).not.toHaveBeenCalled();
	scale.dispatchEvent(new Event("change", { bubbles: true }));

	await vi.waitFor(() => expect(adapter.write).toHaveBeenCalledTimes(1));
	const { payload } = getLastPdfInkAnnotationsPayload(adapter);
	expect(payload.strokes[0].points).toEqual([{ x: 0.05, y: 0.125, t: 1 }, { x: 0.35, y: 0.425, t: 2 }]);
	expect(payload.strokes[1].points).toEqual([{ x: 0.65, y: 0.275, t: 3 }, { x: 0.95, y: 0.575, t: 4 }]);
	expect(payload.strokes[0].width).toBe(3);
	expect(payload.strokes[1].width).toBe(15);
	restoreCanvas();
});
```

- [ ] **Step 2: Run behavior tests and verify they fail**

Run:

```powershell
npx vitest run src/views/PdfView.test.ts -t "ink edit panel|scale slider|color and tool"
```

Expected: FAIL until handlers are implemented.

- [ ] **Step 3: Implement immediate style commits**

Add `applySelectedInkStyle(patch: PdfInkStylePatch): void`:

```ts
private applySelectedInkStyle(patch: PdfInkStylePatch): void {
	const session = this.inkEditSession;
	if (!session || session.selectedIds.size === 0) {
		return;
	}
	this.pushUndoSnapshot();
	this.inkStrokes = applyPdfInkStylePatch(this.inkStrokes, session.selectedIds, patch);
	session.baselineSelectedStrokes = clonePdfInkStrokes(
		this.inkStrokes.filter((stroke) => session.selectedIds.has(stroke.id))
	);
	session.beforeStrokes = clonePdfInkStrokes(this.inkStrokes);
	this.annotationsDirty = true;
	this.renderInkStrokesForPage(session.pageNumber);
	this.updateToolbarState();
	this.syncAsActivePdfDocument();
	this.refreshInkEditPanelValues();
	void this.persistPdfAnnotations();
}
```

If `refreshInkEditPanelValues` is not needed, update the color dot, active tool buttons, and sliders directly inside `openInkEditPanel` and after each action.

- [ ] **Step 4: Implement slider preview/commit gesture helpers**

Add:

```ts
private beginInkEditGesture(): void {
	if (!this.inkEditSession || this.inkEditSession.activeGestureBeforeStrokes) {
		return;
	}
	this.inkEditSession.activeGestureBeforeStrokes = clonePdfInkStrokes(this.inkStrokes);
	this.inkEditSession.gestureDirty = false;
}

private markInkEditGestureDirty(): void {
	if (this.inkEditSession) {
		this.inkEditSession.gestureDirty = true;
	}
}

private commitInkEditGesture(): void {
	const session = this.inkEditSession;
	if (!session || !session.activeGestureBeforeStrokes) {
		return;
	}
	const beforeStrokes = session.activeGestureBeforeStrokes;
	const dirty = session.gestureDirty;
	session.activeGestureBeforeStrokes = null;
	session.gestureDirty = false;
	if (!dirty) {
		return;
	}
	this.pushUndoSnapshot({ inkStrokes: beforeStrokes });
	session.baselineSelectedStrokes = clonePdfInkStrokes(
		this.inkStrokes.filter((stroke) => session.selectedIds.has(stroke.id))
	);
	session.beforeStrokes = clonePdfInkStrokes(this.inkStrokes);
	this.annotationsDirty = true;
	this.renderInkStrokesForPage(session.pageNumber);
	this.updateToolbarState();
	this.syncAsActivePdfDocument();
	void this.persistPdfAnnotations();
}
```

- [ ] **Step 5: Implement scale preview**

Add:

```ts
private previewSelectedInkScale(scalePercent: number): void {
	const session = this.inkEditSession;
	if (!session) {
		return;
	}
	this.beginInkEditGesture();
	this.inkStrokes = scalePdfInkSelectionFromBaseline(
		this.inkStrokes,
		session.baselineSelectedStrokes,
		session.selectedIds,
		Math.max(50, Math.min(200, scalePercent)) / 100,
	);
	this.markInkEditGestureDirty();
	this.renderInkStrokesForPage(session.pageNumber);
	this.syncAsActivePdfDocument();
}
```

Wire scale input:

```ts
scaleInput.addEventListener("input", () => {
	this.previewSelectedInkScale(Number(scaleInput.value) || 100);
});
scaleInput.addEventListener("change", () => {
	this.commitInkEditGesture();
});
```

- [ ] **Step 6: Implement width preview and commit**

Width input should call `beginInkEditGesture`, use `applyPdfInkStylePatch` with `{ width }`, mark dirty, re-render, and commit on `change`. Unlike scale, width is absolute and does not need baseline geometry.

- [ ] **Step 7: Run behavior tests and verify they pass**

Run:

```powershell
npx vitest run src/views/PdfView.test.ts -t "ink edit panel|scale slider|color and tool"
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```powershell
git add src/views/PdfView.ts src/views/PdfView.test.ts
git commit -m "支持PDF墨迹批量编辑"
```

---

### Task 4: Regression, Build, Runtime Copy, Push

**Files:**
- Modify: built assets generated by `npm run build`, usually `main.js`, `styles.css`, and release manifest files.
- Runtime copy target: `D:\ResOB\note\.obsidian\plugins\weave-reader`

**Interfaces:**
- Consumes completed Tasks 1-3.
- Produces a pushed restore point on `integration/epub-ai-pdf-reader` and copied runtime plugin assets.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npx vitest run src/services/pdf/pdf-ink-bulk-edit.test.ts
npx vitest run src/views/PdfView.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run production build**

Run:

```powershell
npm run build
```

Expected: build exits 0. Existing Svelte accessibility warnings may appear if unchanged.

- [ ] **Step 3: Copy runtime assets**

Run:

```powershell
$source = 'D:\ResOB\worktrees\weave-reader-integration-epub-ai-pdf'
$target = 'D:\ResOB\note\.obsidian\plugins\weave-reader'
foreach ($name in @('main.js','styles.css','manifest.json','versions.json')) {
	Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $target $name) -Force
}
```

- [ ] **Step 4: Commit build/runtime source changes**

Run:

```powershell
git status --short --branch
git add main.js styles.css manifest.json versions.json src/services/pdf/pdf-ink-bulk-edit.ts src/services/pdf/pdf-ink-bulk-edit.test.ts src/views/PdfView.ts src/views/PdfView.test.ts src/styles/pdf/pdf-reader.css
git commit -m "落地PDF墨迹批量编辑"
```

If Tasks 1-3 already committed all source files, this commit may include only generated build assets. If there is nothing to commit, skip this commit and report that the tree is clean.

- [ ] **Step 5: Push branch**

Run:

```powershell
git push origin integration/epub-ai-pdf-reader
```

Expected: remote branch advances successfully.

---

## Self-Review

- Spec coverage: right-click tool gating, floating panel, color/tool/width/scale, baseline-relative scale, no high-frequency persistence, undo/redo, page-local behavior, and tests are each covered by Tasks 1-4.
- Placeholder scan: no TBD/TODO placeholders are present.
- Type consistency: helper names and `PdfView` method names are repeated consistently across tasks.
