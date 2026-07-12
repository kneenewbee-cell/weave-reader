# EPUB reader i18n

## Locale model

| Language | Source | Missing keys |
|----------|--------|--------------|
| `zh-CN` | `resources/epub.ts` + `app-shell-epub.ts` | — |
| `en-US` | same (English tree) | — |
| `ja-JP` | `en-US` catalog + `overlays/ja-JP.json` (~99% UI keys) | brand names / language labels may stay Latin |
| `ko-KR` | `en-US` catalog + `overlays/ko-KR.json` (~99% UI keys) | brand names / language labels may stay Latin |
| `ru-RU` | `en-US` catalog + `overlays/ru-RU.json` (~99% UI keys) | brand names / language labels may stay Latin |

## Runtime language resolution

1. Plugin settings → **Interface language** (`interfaceLanguage`):
   - `auto` (default): follow Obsidian via `getLanguage()` → `locale-resolver.ts`
   - fixed `zh-CN` / `en-US` / `ja-JP` / `ko-KR` / `ru-RU`: never overridden by focus/layout sync
2. Auto mode fallback chain: Obsidian API → Obsidian `language` localStorage → browser locale → `en-US`
3. Obsidian `ru` maps to `ru-RU` in `mapObsidianLocaleToPluginLanguage`

Curated overlays cover essentially all user-facing `views.*` / `epub.*` strings (reader menus, bookshelf, sidebars, toolbars, settings). Add or revise copy under `scripts/curated-overlay-data/manual-*.json`, then run `npm run i18n:build-overlays`.

## Adding or changing UI copy

1. Update `resources/epub.ts` (and `app-shell-epub.ts` if needed) for **zh-CN** and **en-US**.
2. Run `npm run i18n:export-keys` to refresh `flat-locales/en-US.template.json`.
3. Add curated **ja** / **ko** / **ru** strings in:
   - `scripts/curated-overlay-data/manual-ja*.json`
   - `scripts/curated-overlay-data/manual-ko*.json`
   - `scripts/curated-overlay-data/manual-ru*.json`
4. Run `npm run i18n:build-overlays` to regenerate `overlays/*.json`.
5. Run `npm run i18n:validate`.

Optional: legacy draft files under `flat-locales/ja-JP.json` may be consulted by the build script if present, but only entries that pass quality checks are kept.

## Tutorial

Tutorial content lives in `src/components/epub/tutorial-locales/*.json` (`zh-CN`, `en-US`, `ja-JP`, `ko-KR`, `ru-RU`). Tab labels are in `epub-tutorial-content.ts`. The tutorial modal follows `currentLanguage` automatically.

To refresh draft `ja` / `ko` / `ru` bodies from English: `npm run i18n:draft:generate-tutorial` (Argos MT — review before shipping). Prefer hand-editing the JSON files for production copy.

## Scripts

| Script | Purpose |
|--------|---------|
| `i18n:export-keys` | Export English key template |
| `i18n:export-zh-snapshot` | Export zh-CN flat snapshot (overlay QA) |
| `i18n:build-overlays` | Build curated `overlays/*.json` |
| `i18n:validate` | Policy + tests for overlays |

Do **not** use `i18n:complete-ko` / `i18n:generate-locales` for production catalogs; they produce draft MT only.
