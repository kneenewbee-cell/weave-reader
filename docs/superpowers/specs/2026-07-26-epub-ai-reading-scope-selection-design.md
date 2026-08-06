# EPUB AI Reading Scope Selection Design

## Summary

EPUB AI Reading should no longer generate immediately after the user clicks `AI 阅读`. It should first show a range picker based on the EPUB TOC/nav tree. The user selects the exact reading scope, then clicks `开始 AI 阅读`.

This design keeps the current streamed AI generation, paragraph source references, modal cache, note generation, and note-open actions. It changes the entry flow from "current section first" to "choose scope first".

## Goals

- Let the user choose the AI reading scope before sending text to AI.
- Use the EPUB TOC/nav hierarchy as the default structure.
- Support arbitrary TOC depth within a reasonable UI limit.
- Let every level expose an `全部` option.
- Keep full-book AI reading visible as a future option but disabled for the first pass.
- Reuse existing TOC-scoped extraction (`getTocChapterReadingPointDraft`) where possible.
- Preserve the current modal result cache and generated note flow.
- Preserve an in-progress AI reading session after the modal is closed, then restore that session when `AI 阅读` is opened again.

## Non-Goals

- Do not implement full-book AI reading in this pass.
- Do not infer headings from body text that are missing from EPUB TOC/nav.
- Do not merge PDF reader behavior.
- Do not change Kimi/OpenAI-compatible configuration.
- Do not copy build artifacts into the Obsidian test plugin unless the user types `拷贝`.

## Current Behavior

The current `openAiReading` flow in `EpubReaderApp.svelte`:

1. Reads `readerService.getCurrentChapterHref()`.
2. Builds a reading draft with `getChapterReadingPointDraft`.
3. Opens `EpubAiReadingModal`.
4. The modal immediately generates AI output.

This means the input scope is based on the current reader section/spine href. It is not necessarily the smallest visible TOC item. In a book where several TOC subsections live inside one XHTML file, the current flow can send a larger section than the user expects.

## Proposed UX

### Entry

Clicking `AI 阅读` opens the existing AI reading modal, but the modal starts in `scope-selection` state.

Exception: if the current book already has an in-progress AI reading session, the modal restores that session first instead of showing a fresh scope picker. This covers backdrop clicks, the close button, and other normal modal dismiss paths during generation.

The modal shows:

- Book title.
- Current detected reading location.
- A compact scope selector.
- A disabled or enabled `开始 AI 阅读` button depending on selected scope.
- Existing actions only after AI generation exists.

### Scope Selector

The selector is a cascade built from the EPUB TOC tree:

- Level 1: `全部`, then top-level TOC items.
- Level 2: shown for the selected level-1 item.
- Level 3+: shown for the selected child path.
- Each visible level includes `全部`.

When a parent level is set to `全部`:

- All lower levels remain visible only as disabled menu buttons showing `全部`.
- The lower-level buttons cannot be opened or changed.
- The effective scope is the parent `全部` range.

This matches the user's requirement: the menu button still shows `全部`, but is not selectable.

### Default Selection

The modal should preselect the best current TOC item but should not generate automatically.

Default resolution order:

1. Use current CFI/href to find the deepest matching TOC item when available.
2. Fall back to the reader's current section href.
3. Fall back to the first non-full-book TOC item.
4. If no usable TOC item exists, show the current section fallback.

The selected path can be changed before generation.

### Close And Reopen During Generation

Closing the modal while AI generation is running must not discard the running request.

Expected behavior:

- The generation continues in the background.
- The latest stage text is stored.
- The latest streamed partial content is stored.
- Reopening `AI 阅读` for the same book restores the generating state, selected scope label, status text, and partial content.
- When the request finishes while the modal is closed, reopening shows the completed result.
- The request is not sent a second time unless the user explicitly chooses `重新生成`.

If the reader is now at a different location, the in-progress session still takes priority. The modal should show the original selected scope label so the user understands what is being generated.

### Full Book Placeholder

Top-level `全部` means full-book AI reading. In this pass it is a placeholder:

- The selector can show it.
- The `开始 AI 阅读` button is disabled.
- The modal shows a short status: `全书 AI 阅读将在后续版本支持。`

Lower-level `全部` is allowed. For example:

- `第一章 > 全部` generates the whole first chapter range.
- `第一章 > 准备你的 LaTeX 工具 > 全部` generates that subsection range.

## Scope Semantics

The effective scope is the deepest selected non-`全部` TOC item plus whether its child level is `全部`.

Examples:

- `第一章 > 准备你的 LaTeX 工具 > 准备工作`: exact leaf item.
- `第一章 > 准备你的 LaTeX 工具 > 全部`: the full second-level item.
- `第一章 > 全部`: the full first-level chapter.
- `全部`: full-book placeholder, disabled.

For implementation, a selected TOC item maps to:

- `item.href`
- item index in flattened TOC
- item depth
- selected path labels
- scope label for UI and AI prompt

## Data Flow

### New Scope Model

Introduce an internal scope type near the AI reading modal/reader integration:

```ts
interface EpubAiReadingScopeSelection {
  kind: "toc" | "book-placeholder" | "section-fallback";
  label: string;
  pathLabels: string[];
  href?: string;
  flatIndex?: number;
  depth?: number;
}
```

The UI can derive cascade levels from `TocItem[]` and current selection path.

### Session Model

The modal should store generation state outside the modal instance, keyed by app/book/scope:

```ts
interface EpubAiReadingSession {
  key: string;
  bookPath: string;
  scope: EpubAiReadingScopeSelection;
  state: "selecting-scope" | "generating" | "result" | "error";
  status: string;
  partialContent: string;
  result?: EpubAiReadingResult;
  errorMessage?: string;
  noteFile?: TFile | null;
  savedToNote: boolean;
  request?: Promise<EpubAiReadingResult>;
  updatedAt: number;
}
```

The important distinction is that the modal is only a view over the session. Closing the modal should detach the view, not destroy the session or abort the request.

### Generation Flow

When the user clicks `开始 AI 阅读`:

1. If `kind === "book-placeholder"`, do not generate.
2. If `kind === "toc"` and `readerService.getTocChapterReadingPointDraft` exists:
   - Call `getTocChapterReadingPointDraft(item.href, item.label, flatTocItems, itemIndex)`.
   - Build source blocks from the returned draft.
   - Open/generate in the existing modal result area.
3. If scoped extraction is unavailable:
   - Fall back to `getChapterReadingPointDraft`.
   - Show a status explaining the fallback.
4. Send the selected scope title/path into `EpubAiReadingInput`.

### Cache Key

The current modal cache should include the scope identity:

```text
normalizePath(filePath)::scopeKind::scopeHref::scopeDepth::scopeLabel
```

This prevents `第一章 > 全部` from overwriting `第一章 > 准备工作`.

For in-progress sessions, the same key prevents duplicate requests. If a session with `state === "generating"` already exists, opening the modal attaches to it instead of creating a new request.

## Components

### EpubAiReadingModal

Extend the modal to support states:

- `selecting-scope`
- `generating`
- `result`
- `error`

The modal should render from the shared session state. During `generating`, `onStage` and `onPartialContent` update the session first, then update the modal if it is currently open.

The result state keeps existing behavior:

- streamed content
- section tabs
- source links
- draggable modal
- close and restore cache
- generated note actions

### Scope Picker Helper

Add pure helper functions for testability:

- flatten nested TOC with parent paths.
- compute maximum visible selector levels.
- resolve current selection path.
- apply selection at a level.
- force lower levels to disabled `全部` when a parent is `全部`.
- resolve effective scope from selected levels.

### Reader Integration

`EpubReaderApp.svelte` should pass the TOC, reader service hooks, and current location into the modal, or prepare a scope picker input object before constructing the modal.

Keep extraction close to the reader integration because it already owns:

- `readerService`
- `buildAiReadingSourceBlocksForDraft`
- `buildChapterReadingPointSourceLink`
- AI config host/env paths

## Error Handling

- Empty TOC: show a single current-section fallback scope.
- Full-book `全部`: disabled with explanatory status.
- Selected TOC item extracts no text: show existing chapter extract failure notice.
- Scoped extraction unavailable: fall back to current section extraction.
- AI request failure: keep existing modal error handling.
- Modal closed before generation: no cache is written.
- Modal closed during generation: keep the request and restore its latest status/partial content on reopen.
- Modal closed after generation: same-scope reopening restores cached content.

## Tests

Add focused tests for:

- Building selector levels from a 3-level TOC.
- Building selector levels from a 4-level TOC.
- Parent `全部` keeps lower level buttons visible but disabled and set to `全部`.
- Default selection resolves to the deepest current TOC item.
- Full-book `全部` disables `开始 AI 阅读`.
- Selecting a TOC leaf calls `getTocChapterReadingPointDraft`.
- Selecting a parent plus child `全部` calls `getTocChapterReadingPointDraft` for the parent item.
- Cache key differs between parent scope and leaf scope.
- Closing during generation and reopening restores the in-progress status/partial content without sending a duplicate request.
- Reopening after a background generation finishes shows the completed result.

Existing tests for streaming, note generation, markdown rendering, source link clicks, and modal close/restore should remain.

## Rollout

1. Add pure TOC scope selector helpers and tests.
2. Add scope-selection state to `EpubAiReadingModal`.
3. Wire `EpubReaderApp.svelte` to pass TOC and scoped generation dependencies.
4. Generate selected TOC scope via `getTocChapterReadingPointDraft`.
5. Move modal cache into a shared AI reading session store that also tracks in-progress generation.
6. Update cache key to include scope identity.
7. Run targeted tests and `npm run build`.
8. Do not copy build artifacts unless the user types `拷贝`.

## Open Decisions

No blocking open decisions remain for the first pass.

Deferred decisions:

- Whether to persist scope results across Obsidian restarts.
- Whether to support body-heading extraction when TOC/nav is too coarse.
- How full-book AI reading should chunk and merge results.
