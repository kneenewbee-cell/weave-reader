# EPUB AI Reading v2: Paragraph-Located Reading Design

## Summary

EPUB AI Reading v2 upgrades the current chapter-level AI reading flow into a paragraph-located reading flow. The main goal is to let AI identify important ideas and excerpts while the plugin, not the model, owns exact EPUB navigation links.

The first implementation scope is current-chapter analysis only. Full-book synthesis and cross-chapter batch processing are intentionally deferred until paragraph-level location is reliable.

## Current State

The current AI reading flow can:

- Open AI Reading from the EPUB pane menu.
- Extract the current chapter title, chapter text, TOC context, and a single source link.
- Generate a streamed Kimi result.
- Show the result in an Obsidian modal.
- Generate or update an Obsidian Markdown note.

The current limitation is location fidelity. The model receives one chapter-level source link, so it can only produce broad location descriptions such as "near the chapter start" or "in the section about Overleaf". It cannot produce reliable per-excerpt jump targets.

## Goals

- Extract the current chapter as ordered paragraph blocks.
- Attach a stable paragraph id, heading path, text, and plugin-generated EPUB jump link to each block.
- Ask the model to reference paragraph ids instead of inventing anchors or links.
- Render paragraph references as clickable source links in both the modal and generated Markdown note.
- Improve the result structure for reading, review, and long-term notes.
- Keep the first v2 release focused on the current chapter.

## Non-Goals

- Do not merge or depend on PDF reader work.
- Do not implement whole-book AI reading in v2.
- Do not ask the model to generate EPUB CFIs or internal anchors.
- Do not auto-create highlights or annotations from AI-selected passages in v2.
- Do not store API keys in committed files or generated assets.

## User Experience

### Entry Point

The current pane menu item `AI阅读` remains the entry point. The modal title stays `AI阅读`, but the generated content becomes more structured.

### Modal Layout

The modal uses a compact reading workspace:

- Header: book title, chapter title, status, and a chapter-level "回到当前章节原文" link.
- Tab bar:
  - `摘要`
  - `知识点`
  - `重要原文`
  - `章节关系`
  - `精读路径`
- Footer actions:
  - `重新生成`
  - `生成并打开笔记`
  - `复制摘要`

The tabs are display-level only for v2. The service can keep returning Markdown plus structured references, but the modal should separate sections for readability.

### Important Excerpts

Each important excerpt is rendered as a repeated item:

- Excerpt title or short label.
- Original text snippet.
- Why it matters.
- Source chips such as `P004`, each rendered as a clickable "回到原文" link.

If a source link is missing, the chip is shown disabled with a short tooltip-like title explaining that the paragraph could not be located.

### Generated Note Layout

The generated note remains Markdown-first:

```md
# Book Title - AI阅读

## Chapter Title

> EPUB 跳转：[[chapter source]]
> 模型：k3
> 生成时间：...

### 本章一句话

...

### 本章摘要

...

### 关键知识点

- **Concept**
  Explanation.
  来源：[[...|P004]] [[...|P007]]

### 重要原文

> Original excerpt...

为什么重要：...

来源：[[...|P004]]

### 章节关系

...

### 精读路径

...

### 行动清单

- ...
```

## Data Model

### Paragraph Block

The extraction layer produces `EpubAiReadingSourceBlock` values:

```ts
interface EpubAiReadingSourceBlock {
  id: string;              // P001, P002, ...
  href: string;            // chapter href or subdocument href
  cfi?: string;            // EPUB CFI when available
  sourceLink?: string;     // Obsidian/weave EPUB jump link
  headingPath: string[];   // nearest EPUB heading ancestry
  text: string;            // normalized readable paragraph text
  kind: "heading" | "paragraph" | "list" | "code" | "quote" | "table";
}
```

Block ids are stable within a generation request. They do not need to be globally stable across EPUB reimports.

### AI Input

The model receives:

- Book title and author.
- Current chapter title and href.
- Full TOC outline.
- Chapter-level source link.
- A list of source blocks.

The prompt must explicitly say:

- Reference source paragraphs by ids such as `P004`.
- Do not invent anchors, CFIs, or links.
- For important excerpts, quote or paraphrase only from the supplied source blocks.
- For summary sections, use source ids when a claim depends on specific paragraphs.

### AI Output Contract

The preferred model output is structured Markdown with source markers:

```md
## 本章一句话
...

## 本章摘要
... [P004, P007]

## 关键知识点
- **...** ... [P003]

## 重要原文
1. **...** [P004]
   原文：...
   为什么重要：...
```

The service post-processes bracket markers like `[P004]` into renderable source references. If a marker does not match a known block, it remains plain text and is reported in debug metadata.

## Extraction Strategy

The first v2 implementation should reuse the current EPUB reader state rather than parsing the whole EPUB independently.

Preferred extraction order:

1. Use the current rendered chapter/document when available.
2. Walk readable block elements: headings, paragraphs, list items, blockquotes, pre/code blocks, and tables.
3. Resolve or derive a CFI/source link for each block using the same navigation mechanism used by highlights and "回到当前章节原文".
4. Normalize text:
   - Collapse repeated whitespace.
   - Keep code blocks readable.
   - Skip empty or tiny decorative blocks.
5. Maintain heading ancestry while walking.

If exact CFI generation is unavailable for a block, include the block with no `sourceLink` rather than dropping useful content. The UI should show that item as non-clickable.

## Chunking and Token Budget

For v2, the default is one current chapter request. If a chapter is too long:

- Keep the TOC and heading structure.
- Send a capped set of source blocks using a character budget.
- Prefer heading blocks, first paragraphs under each heading, paragraphs with technical definitions, and paragraphs near the current reading location.
- Emit a stage message explaining that the chapter was compressed for token limits.

Long-chapter multi-pass summarization is deferred. It can be added later as:

1. Summarize block ranges.
2. Merge range summaries.
3. Generate final chapter reading with source links retained.

## Rendering and Post-Processing

The rendering layer should not trust the model to create links. It should:

- Parse source ids from the AI result.
- Look up matching source blocks.
- Render source chips/buttons from plugin-owned `sourceLink`.
- Preserve normal Markdown rendering for the rest of the result.

The modal can initially use Markdown plus enhanced source links. Full structured card rendering can follow once the output contract is stable.

## Error Handling

- If no source blocks can be extracted, fall back to v1 chapter-level generation and show a stage message.
- If some blocks lack source links, keep them usable as text references but mark them non-clickable.
- If model output references unknown block ids, keep the text and show no link for those ids.
- If streaming fails, keep the existing fallback to non-streaming generation.
- If note generation fails, keep the modal result visible and show a Notice.

## Tests

Add or update tests for:

- Source block extraction from a mocked chapter DOM.
- Heading ancestry assignment.
- Source link generation and missing-link fallback.
- Prompt/message construction containing `P001` style blocks.
- AI result post-processing from `[P001]` markers to known source references.
- Modal rendering of clickable and non-clickable source references.
- Note generation with paragraph source links.
- Long chapter compression behavior.

Existing v1 tests for config loading, Kimi streaming, modal rendering fallback, and note upsert should remain.

## Rollout Plan

1. Add source block data structures and extraction helpers.
2. Wire current chapter extraction into the AI reading input.
3. Update prompt construction to include paragraph blocks and source-id rules.
4. Add source marker post-processing.
5. Update modal rendering for source references.
6. Update note generation to include source links.
7. Run unit tests and production build.
8. Sync only `main.js`, `manifest.json`, and `styles.css` to the Obsidian test plugin directory when the user is actively testing this worktree.

## Open Decisions

- Whether tab rendering should be implemented in the first v2 code pass or after the paragraph-linking data path is proven.
- Whether `复制摘要` copies only the summary tab or the full AI reading result.
- Whether blocks near the current visible page should be weighted higher than the whole chapter when token compression is needed.

Recommended defaults:

- Implement paragraph linking first, then tabs.
- `复制摘要` copies `本章一句话` plus `本章摘要`.
- Give the current visible area a mild priority boost only when compression is required.
