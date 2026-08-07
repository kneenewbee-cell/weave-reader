# PDF Ink Bulk Edit Design

## Background

The PDF reader already supports ink drawing, stroke selection, marquee selection,
moving selected strokes, copy/paste, delete, undo/redo, and persistence to
`ink.json`. The next feature extends the existing `stroke-select` tool so a user
can right-click selected ink strokes and edit them as a group.

This feature must stay scoped to ink strokes. It does not edit PDF text
annotations, EPUB annotations, AI reading notes, or reading-package import/export
behavior.

## Goals

- Enable batch editing for one selected stroke or multiple selected strokes.
- Keep the interaction active only in the `stroke-select` tool.
- Provide a floating editor panel similar to the existing PDF tool settings
  panel, not a plain menu list.
- Support color, tool type, width, and group scale edits.
- Apply scale relative to the selected strokes' size at the moment the panel is
  opened.
- Keep edits undoable, redoable, and persisted to the existing PDF ink store.
- Avoid high-latency writes while sliders are being dragged.

## Non-Goals

- Freeform rotation.
- Arbitrary transform handles around the selection box.
- Cross-page group scaling.
- Editing text annotations through this panel.
- Changing the reading-package format.
- Saving every slider frame to disk.

## Interaction

The feature is available only when the active PDF tool is `stroke-select`.

When the user right-clicks in `stroke-select` mode:

1. If the pointer hits an already selected ink stroke, keep the current
   selection and open the ink edit panel.
2. If the pointer hits an unselected ink stroke, replace the selection with that
   stroke and open the panel.
3. If the pointer does not hit an ink stroke, close the panel and leave the
   current selection behavior unchanged.

The panel is positioned near the right-click point and constrained inside the
reader viewport where possible. It should not open in pen, highlighter, eraser,
capture, pan, or text-selection mode.

The panel should look and behave like the existing PDF tool settings panel:

- Title: `墨迹编辑`
- Current color preview dot.
- Segmented buttons: `普通笔` and `透明笔`.
- Color swatches.
- Width slider.
- Scale slider.
- Optional action row for copy/delete if layout remains compact.

For mixed selections:

- If selected strokes have the same tool, color, or width, show that value.
- If values differ, show a mixed state visually where practical.
- Choosing a new value applies it to all selected strokes.

## Scale Semantics

Scale is relative to the selected strokes' original geometry when the panel is
opened.

- `100%` means the current selected size.
- `50%` means half of the original selected size.
- `200%` means twice the original selected size.
- Reopening the panel resets the current selection to a new `100%` baseline.

Scaling uses the bounding box center of all selected strokes on the active page.
Every selected point is transformed around that center:

```text
next.x = center.x + (original.x - center.x) * scale
next.y = center.y + (original.y - center.y) * scale
```

The stroke width scales with geometry. For example, a 2px pen stroke at `150%`
becomes 3px. Width values are clamped to the same practical bounds used by the
existing width controls.

Selection remains page-local for scaling. If the current selection somehow spans
multiple pages, the first implementation should either edit only the page that
opened the panel or disable scale with a short notice. The recommended first
version is to keep stroke selection page-local, matching current marquee and move
behavior.

## Data Flow

The selected stroke ids already live in `selectedInkStrokeIds`. The editor panel
uses those ids to derive `selectedStrokes`.

Opening the panel captures an edit session snapshot:

- `beforeStrokes`: cloned full `inkStrokes` array for undo.
- `baselineSelectedStrokes`: cloned selected strokes for live scale calculation.
- `pageNumber`: the page where the panel was opened.

Property edits update `inkStrokes` in memory and re-render the affected page.
The existing PDF state sync is updated after each applied edit so dual-window or
active-document consumers see the latest in-memory state.

## Persistence And Undo

Slider drag should not write to disk on every input event.

Recommended behavior:

- `input`: update in memory and re-render for live preview.
- `change` or pointer release: commit the edit once, push one undo snapshot, and
  call `persistPdfAnnotations()`.

For button or swatch actions:

- Push one undo snapshot before changing selected strokes.
- Apply the change.
- Mark annotations dirty.
- Re-render affected page.
- Sync active PDF document state.
- Persist once.

If a slider is dragged multiple times in one open panel session, each completed
drag gesture can become one undo step. This is predictable and avoids giant undo
steps that mix unrelated edits.

## Error Handling

- If no selected stroke ids resolve to existing strokes, close the panel.
- If a scale operation would move points outside the PDF page unit bounds, clamp
  points to `[0, 1]`.
- If persistence fails, keep the in-memory edit and show the existing notice
  pattern used for PDF annotation save failures.
- If the active tool changes away from `stroke-select`, close the panel.
- If the file changes or annotations reload externally, close the panel and clear
  stale edit baselines.

## Testing

Add focused tests in `src/views/PdfView.test.ts`:

- Right-click selected stroke in `stroke-select` mode opens the edit panel.
- Right-click unselected stroke selects it and opens the panel.
- Right-click in other tools does not open the panel.
- Changing color applies to all selected strokes and persists once.
- Switching normal pen/transparent pen applies to all selected strokes.
- Width slider updates selected stroke widths and records undo.
- Scale slider transforms selected points around the group center and scales
  width.
- Dragging scale input previews without repeated persistence, then commits on
  change.
- Undo restores the pre-edit stroke geometry and style.

Run at minimum:

```powershell
npx vitest run src/views/PdfView.test.ts
npm run build
```

## Open Decisions

- The first version uses a `50%` to `200%` scale range with `100%` as the
  per-open baseline.
- The first version keeps scaling page-local.
- The first version uses a floating panel rather than Obsidian native menus.
