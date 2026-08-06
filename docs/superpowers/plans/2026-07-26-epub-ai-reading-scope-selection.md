# EPUB AI Reading Scope Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a TOC-based range picker before EPUB AI reading generation, with disabled lower-level `All` controls, full-book placeholder, scoped extraction, and in-progress session restore after modal close.

**Architecture:** Add pure TOC scope helpers, then extend the existing `EpubAiReadingModal` into a small stateful workflow. `EpubReaderApp.svelte` remains the owner of reader-service extraction and passes a scoped draft resolver into the modal. The modal stores AI reading sessions outside modal instances so close/reopen can restore generating or completed state.

**Tech Stack:** TypeScript, Svelte integration, Obsidian Modal APIs, Vitest, existing EPUB reader service APIs.

## Global Constraints

- Work only in `D:\ResOB\worktrees\weave-reader-epub-feature` on `feature/epub-new-feature`.
- Do not merge or depend on PDF reader work.
- Do not implement full-book AI reading in this pass.
- Do not infer headings from body text that are missing from EPUB TOC/nav.
- Do not store API keys in committed files or generated assets.
- Do not copy build artifacts into `D:\ResOB\note\.obsidian\plugins\weave-reader` unless the user types exactly `拷贝`.
- Use TDD for behavior changes: write failing tests first, verify failure, implement, verify pass.

---

### Task 1: TOC Scope Helper

**Files:**
- Create: `src/services/epub/epub-ai-reading-scope.ts`
- Create: `src/services/epub/__tests__/epub-ai-reading-scope.test.ts`

**Interfaces:**
- Consumes: `TocItem` from `src/services/epub/types.ts`
- Produces:
  - `EPUB_AI_READING_ALL_SCOPE_ID: "__all__"`
  - `EpubAiReadingScopeOption`
  - `EpubAiReadingScopeSelection`
  - `EpubAiReadingScopeLevel`
  - `buildEpubAiReadingScopeLevels(tocItems, selectedIds, options)`
  - `resolveEpubAiReadingScopeSelection(tocItems, selectedIds)`
  - `resolveDefaultEpubAiReadingScopeIds(tocItems, currentHref)`
  - `getEpubAiReadingScopeSessionKeyPart(scope)`

- [ ] **Step 1: Write failing tests**

```ts
it("builds cascaded levels and disables descendants after All", () => {
  const levels = buildEpubAiReadingScopeLevels(toc, ["chapter-1", "__all__"]);
  expect(levels[0].options.map((option) => option.label)).toEqual(["全部", "第一章"]);
  expect(levels[1].selectedId).toBe("__all__");
  expect(levels[2].selectedId).toBe("__all__");
  expect(levels[2].disabled).toBe(true);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run: `npm test -- src/services/epub/__tests__/epub-ai-reading-scope.test.ts`
Expected: FAIL because helper module does not exist.

- [ ] **Step 3: Implement helper**

Implement recursive TOC flattening and cascade level derivation. Full-book `All` resolves to `kind: "book-placeholder"` and is disabled for generation by consumers. Parent `All` keeps lower levels visible as disabled `All`.

- [ ] **Step 4: Run helper tests**

Run: `npm test -- src/services/epub/__tests__/epub-ai-reading-scope.test.ts`
Expected: PASS.

---

### Task 2: Modal Scope Selection UI

**Files:**
- Modify: `src/components/epub/EpubAiReadingModal.ts`
- Modify: `src/components/epub/EpubAiReadingModal.test.ts`
- Modify: `src/styles/epub/epub-ai-reading.css`

**Interfaces:**
- Consumes Task 1 helpers.
- Adds optional modal options:
  - `tocItems?: TocItem[]`
  - `initialScopeIds?: string[]`
  - `resolveScopedInput?: (scope: EpubAiReadingScopeSelection) => Promise<EpubAiReadingInput | null>`

- [ ] **Step 1: Write failing modal tests**

Add tests for:
- Opening with TOC shows scope selector and does not call `requestEpubAiReading`.
- Parent `全部` renders lower disabled `全部` button.
- Full-book `全部` disables `开始 AI 阅读`.

- [ ] **Step 2: Run modal tests and verify they fail**

Run: `npm test -- src/components/epub/EpubAiReadingModal.test.ts`
Expected: FAIL because the modal still auto-generates.

- [ ] **Step 3: Implement selecting state**

Render scope controls before generation when TOC options are provided. Keep legacy auto-generation when no scope options are provided so existing tests and old call sites keep working.

- [ ] **Step 4: Run modal tests**

Run: `npm test -- src/components/epub/EpubAiReadingModal.test.ts`
Expected: PASS.

---

### Task 3: Scoped Generation And Session Restore

**Files:**
- Modify: `src/components/epub/EpubAiReadingModal.ts`
- Modify: `src/components/epub/EpubAiReadingModal.test.ts`

**Interfaces:**
- Produces shared session behavior:
  - generation state survives modal close
  - `onStage` and `onPartialContent` update the session
  - same scope reopen attaches to the in-flight request
  - finished background request renders result on reopen

- [ ] **Step 1: Write failing tests**

Add tests for:
- Clicking `开始 AI 阅读` calls `resolveScopedInput`, then `requestEpubAiReading`.
- Closing during pending generation and reopening restores stage/partial content without a second request.
- Resolving the original promise while closed makes reopen show the completed result.

- [ ] **Step 2: Run modal tests and verify they fail**

Run: `npm test -- src/components/epub/EpubAiReadingModal.test.ts`
Expected: FAIL because sessions only cache completed results.

- [ ] **Step 3: Implement shared session state**

Replace result-only draft storage with session records that track `state`, `status`, `partialContent`, `request`, `result`, `errorMessage`, `noteFile`, and `savedToNote`.

- [ ] **Step 4: Run modal tests**

Run: `npm test -- src/components/epub/EpubAiReadingModal.test.ts`
Expected: PASS.

---

### Task 4: Reader Integration

**Files:**
- Modify: `src/components/epub/EpubReaderApp.svelte`
- Modify: `src/views/EpubView.test.ts` if existing assertions need new modal options

**Interfaces:**
- Consumes modal `resolveScopedInput`.
- Uses existing `readerService.getTocChapterReadingPointDraft`.
- Uses existing `buildAiReadingSourceBlocksForDraft`.

- [ ] **Step 1: Write failing integration-oriented test**

In the modal test, verify `resolveScopedInput` receives the selected TOC scope. If practical, add an `EpubView`/reader integration test for passing TOC options.

- [ ] **Step 2: Run targeted tests and verify failure**

Run: `npm test -- src/components/epub/EpubAiReadingModal.test.ts src/views/EpubView.test.ts`
Expected: FAIL until reader integration passes scope options.

- [ ] **Step 3: Wire `openAiReading`**

Load TOC with `getAnnotationTocItems()`, derive default scope ids from current href, and pass `resolveScopedInput`. For `toc` scope, call `getTocChapterReadingPointDraft`; otherwise keep current section fallback.

- [ ] **Step 4: Run targeted tests**

Run: `npm test -- src/components/epub/EpubAiReadingModal.test.ts src/views/EpubView.test.ts`
Expected: PASS.

---

### Task 5: Verification, Build, Commit, Push

**Files:**
- Build outputs: `main.js`, `styles.css`, `manifest.json` if changed by build

**Interfaces:**
- No new runtime interfaces.

- [ ] **Step 1: Run EPUB AI targeted tests**

Run:
`npm test -- src/services/epub/__tests__/epub-ai-reading-scope.test.ts src/components/epub/EpubAiReadingModal.test.ts src/services/epub/__tests__/epub-ai-reading.test.ts src/services/epub/__tests__/epub-ai-reading-source-blocks.test.ts src/views/EpubView.test.ts`

- [ ] **Step 2: Run build**

Run: `npm run build`

- [ ] **Step 3: Scan for secrets**

Run:
`rg -n "sk-kimi-|KIMI_API_KEY\\s*=|MOONSHOT_API_KEY\\s*=" main.js styles.css manifest.json src package.json scripts -g "!node_modules/**"`

Expected: only fake `runtime-key` values in tests.

- [ ] **Step 4: Commit and push**

Run:
`git add -- src main.js styles.css manifest.json`
`git commit -m "Add EPUB AI reading scope selection"`
`git push origin feature/epub-new-feature`

- [ ] **Step 5: Do not copy artifacts**

Do not copy `main.js`, `manifest.json`, or `styles.css` into the Obsidian test plugin unless the user sends exactly `拷贝`.
