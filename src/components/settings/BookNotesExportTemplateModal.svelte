<script lang="ts">
  import { Component, MarkdownRenderer, Menu, Notice, setIcon } from "obsidian";
  import { onDestroy, onMount, tick } from "svelte";
  import type StandaloneEpubPlugin from "../../main";
  import { getEpubStorageService } from "../../services/epub";
  import { notifyExcerptSettingsChanged } from "../../services/epub/excerpt-settings-events";
  import {
    renderBookNotesTemplatePreview,
  } from "../../services/epub/book-notes-export/book-notes-export";
  import { formatBookNotesTemplateError } from "../../services/epub/book-notes-export/template-renderer";
  import { resolveBookNotesExportTemplateFolder } from "../../services/epub/book-notes-export/template-folder";
  import {
    deleteBookNotesExportTemplateFile,
    duplicateBookNotesExportTemplateFile,
    findPresetBookNotesExportTemplatePath,
    listBookNotesExportTemplateFiles,
    openBookNotesExportTemplateInEditor,
    openPresetBookNotesExportTemplate,
    readBookNotesExportTemplateFile,
    resetBookNotesExportTemplateToBuiltin,
    saveBookNotesExportTemplateFile,
    suggestUniqueTemplateFileName,
    type BookNotesExportTemplateListItem,
  } from "../../services/epub/book-notes-export/template-catalog";
  import {
    BOOK_NOTES_EXPORT_DIGEST_PRESET_IDS,
    BOOK_NOTES_EXPORT_TEMPLATE_LOOP_SNIPPETS,
    BOOK_NOTES_EXPORT_TEMPLATE_VARIABLE_GROUPS,
  } from "../../services/epub/book-notes-export/template-variables";
  import type { BookNotesExportBuiltinTemplateId } from "../../services/epub/book-notes-export/constants";
  import { tr } from "../../utils/i18n";
  import { showObsidianConfirm } from "../../utils/obsidian-confirm";

  interface Props {
    plugin: StandaloneEpubPlugin;
    onClose?: () => void;
    registerCloseGuard?: (guard: () => boolean | Promise<boolean>) => void;
  }

  let { plugin, onClose, registerCloseGuard }: Props = $props();
  let t = $derived($tr);

  const app = plugin.app;
  const previewHost = new Component();

  let templateFolder = $state("");
  let templates = $state<BookNotesExportTemplateListItem[]>([]);
  let activeTemplatePath = $state("");
  let defaultTemplatePath = $state("");
  let editorValue = $state("");
  let savedValue = $state("");
  let trimBlocks = $state(true);
  let previewMode = $state(false);
  let previewMarkdown = $state("");
  let previewError = $state("");
  let isLoading = $state(true);
  let isSaving = $state(false);
  let expandedGroups = $state<Record<string, boolean>>({
    book: true,
    export: false,
    chapter: false,
    highlight: true,
  });

  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return {
      update(newName: string) {
        node.replaceChildren();
        setIcon(node, newName);
      },
    };
  }

  let editorEl = $state<HTMLTextAreaElement | null>(null);
  let previewEl = $state<HTMLElement | null>(null);
  let previewToggleBtn = $state<HTMLButtonElement | null>(null);
  let previewTimer: ReturnType<typeof window.setTimeout> | null = null;
  let presetTargetPaths = $state<Partial<Record<BookNotesExportBuiltinTemplateId, string>>>({});

  const isDirty = $derived(editorValue !== savedValue);
  const activeTemplate = $derived(
    templates.find((item) => item.path === activeTemplatePath) ?? null
  );
  const activeFileName = $derived(activeTemplate?.fileName ?? "");
  const isDefaultTemplate = $derived(
    Boolean(activeTemplatePath && defaultTemplatePath === activeTemplatePath)
  );

  async function loadSettingsState(): Promise<void> {
    const settings = await getEpubStorageService(app).loadExcerptSettings();
    templateFolder = resolveBookNotesExportTemplateFolder(settings);
    defaultTemplatePath = String(settings.bookNotesExportTemplatePath || "").trim();
    trimBlocks = settings.bookNotesExportTrimBlocks !== false;
  }

  async function refreshPresetTargetPaths(): Promise<void> {
    const next: Partial<Record<BookNotesExportBuiltinTemplateId, string>> = {};
    for (const presetId of BOOK_NOTES_EXPORT_DIGEST_PRESET_IDS) {
      const path = await findPresetBookNotesExportTemplatePath(app, presetId, templateFolder);
      if (path) {
        next[presetId] = path;
      }
    }
    presetTargetPaths = next;
  }

  async function refreshTemplateList(preferredPath?: string): Promise<void> {
    isLoading = true;
    try {
      await loadSettingsState();
      templates = await listBookNotesExportTemplateFiles(app, templateFolder);
      await refreshPresetTargetPaths();
      const nextPath =
        preferredPath && templates.some((item) => item.path === preferredPath)
          ? preferredPath
          : activeTemplatePath && templates.some((item) => item.path === activeTemplatePath)
            ? activeTemplatePath
            : defaultTemplatePath && templates.some((item) => item.path === defaultTemplatePath)
              ? defaultTemplatePath
              : templates[0]?.path || "";
      if (nextPath) {
        await selectTemplate(nextPath, { skipDirtyCheck: true });
      } else {
        activeTemplatePath = "";
        editorValue = "";
        savedValue = "";
      }
    } finally {
      isLoading = false;
    }
  }

  async function selectTemplate(
    path: string,
    options: { skipDirtyCheck?: boolean } = {}
  ): Promise<boolean> {
    if (isSaving) {
      return false;
    }
    if (!options.skipDirtyCheck && isDirty) {
      const confirmed = await showObsidianConfirm(
        app,
        t("epub.settings.exportTemplateModal.confirmDiscard"),
        { title: t("epub.settings.exportTemplateModal.title") }
      );
      if (!confirmed) {
        return false;
      }
    }

    const content = await readBookNotesExportTemplateFile(app, path);
    activeTemplatePath = path;
    editorValue = content;
    savedValue = content;
    previewError = "";
    schedulePreview();
    return true;
  }

  function schedulePreview(): void {
    if (previewTimer) {
      window.clearTimeout(previewTimer);
    }
    previewTimer = window.setTimeout(() => {
      runPreview();
    }, 280);
  }

  function runPreview(): void {
    try {
      previewMarkdown = renderBookNotesTemplatePreview(editorValue, { trimBlocks });
      previewError = "";
    } catch (error) {
      previewMarkdown = "";
      previewError = formatBookNotesTemplateError(error);
    }

    if (previewMode) {
      void renderPreviewHtml();
    }
  }

  async function renderPreviewHtml(): Promise<void> {
    await tick();
    if (!previewEl) {
      return;
    }
    previewEl.empty();
    if (!previewMarkdown.trim()) {
      return;
    }
    await MarkdownRenderer.render(
      app,
      previewMarkdown,
      previewEl,
      activeTemplatePath || "preview.md",
      previewHost
    );
  }

  async function handleTemplateSelect(event: Event): Promise<void> {
    const target = event.currentTarget as HTMLSelectElement;
    const nextPath = target.value;
    if (isSaving || !nextPath || nextPath === activeTemplatePath) {
      if (isSaving) {
        target.value = activeTemplatePath;
      }
      return;
    }
    const switched = await selectTemplate(nextPath);
    if (!switched) {
      target.value = activeTemplatePath;
    }
  }

  async function saveCurrentTemplate(): Promise<void> {
    if (!activeTemplatePath || isSaving) {
      return;
    }
    const snapshotPath = activeTemplatePath;
    const snapshotContent = editorValue;
    isSaving = true;
    try {
      await saveBookNotesExportTemplateFile(app, snapshotPath, snapshotContent);
      if (activeTemplatePath === snapshotPath) {
        savedValue = snapshotContent;
      }
      new Notice(t("epub.settings.exportTemplateModal.saved"));
    } catch (error) {
      new Notice(
        t("epub.settings.exportTemplateModal.saveFailed", {
          message: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      isSaving = false;
    }
  }

  async function revertCurrentTemplate(): Promise<void> {
    editorValue = savedValue;
    previewError = "";
    schedulePreview();
  }

  async function setCurrentAsDefault(): Promise<void> {
    if (!activeTemplatePath) {
      return;
    }
    if (isDirty) {
      new Notice(t("epub.settings.exportTemplateModal.saveBeforeDefault"));
      return;
    }
    const storageService = getEpubStorageService(app);
    const currentSettings = await storageService.loadExcerptSettings();
    await storageService.saveExcerptSettings({
      ...currentSettings,
      bookNotesExportTemplatePath: activeTemplatePath,
    });
    defaultTemplatePath = activeTemplatePath;
    new Notice(t("epub.settings.exportTemplateModal.defaultUpdated"));
    dispatchExcerptSettingsChanged();
  }

  async function createFromPreset(presetId: BookNotesExportBuiltinTemplateId): Promise<void> {
    if (isDirty) {
      const confirmed = await showObsidianConfirm(
        app,
        t("epub.settings.exportTemplateModal.confirmDiscard"),
        { title: t("epub.settings.exportTemplateModal.title") }
      );
      if (!confirmed) {
        return;
      }
    }

    const result = await openPresetBookNotesExportTemplate(app, presetId, templateFolder);
    await refreshTemplateList(result.path);
    if (result.outcome === "created") {
      new Notice(t("epub.settings.exportTemplateModal.created"));
      return;
    }
    new Notice(
      t("epub.settings.exportTemplateModal.presetAlreadyExists", { name: result.fileName })
    );
  }

  function isPresetActive(presetId: BookNotesExportBuiltinTemplateId): boolean {
    if (!activeTemplatePath) {
      return false;
    }
    return presetTargetPaths[presetId] === activeTemplatePath;
  }

  async function duplicateCurrentTemplate(): Promise<void> {
    if (!activeTemplatePath) {
      return;
    }
    const fileName = suggestUniqueTemplateFileName(
      templates.map((item) => item.fileName),
      activeFileName.replace(/\.md$/i, "-copy")
    );
    const path = await duplicateBookNotesExportTemplateFile(
      app,
      activeTemplatePath,
      fileName,
      templateFolder
    );
    await refreshTemplateList(path);
    new Notice(t("epub.settings.exportTemplateModal.duplicated"));
  }

  async function resetCurrentToBuiltin(): Promise<void> {
    if (!activeTemplate?.isBuiltin || !activeTemplatePath) {
      return;
    }
    const confirmed = await showObsidianConfirm(
      app,
      t("epub.settings.exportTemplateModal.confirmResetBuiltin"),
      { title: t("epub.settings.exportTemplateModal.title") }
    );
    if (!confirmed) {
      return;
    }
    await resetBookNotesExportTemplateToBuiltin(app, activeTemplatePath);
    await selectTemplate(activeTemplatePath, { skipDirtyCheck: true });
    new Notice(t("epub.settings.exportTemplateModal.resetBuiltinDone"));
  }

  async function deleteCurrentTemplate(): Promise<void> {
    if (!activeTemplatePath) {
      return;
    }
    if (templates.length <= 1) {
      new Notice(t("epub.settings.exportTemplateModal.cannotDeleteLast"));
      return;
    }
    if (isDefaultTemplate) {
      new Notice(t("epub.settings.exportTemplateModal.cannotDeleteDefault"));
      return;
    }
    const confirmed = await showObsidianConfirm(
      app,
      t("epub.settings.exportTemplateModal.confirmDelete", { name: activeFileName }),
      { title: t("epub.settings.exportTemplateModal.title") }
    );
    if (!confirmed) {
      return;
    }
    const deletingPath = activeTemplatePath;
    await deleteBookNotesExportTemplateFile(app, deletingPath);
    await refreshTemplateList();
    new Notice(t("epub.settings.exportTemplateModal.deleted"));
  }

  function dispatchExcerptSettingsChanged(): void {
    notifyExcerptSettingsChanged();
  }

  function insertAtCursor(text: string): void {
    if (!editorEl) {
      return;
    }
    const start = editorEl.selectionStart;
    const end = editorEl.selectionEnd;
    const nextValue = editorValue.slice(0, start) + text + editorValue.slice(end);
    editorValue = nextValue;
    const nextPos = start + text.length;
    window.requestAnimationFrame(() => {
      editorEl?.focus();
      editorEl?.setSelectionRange(nextPos, nextPos);
    });
    schedulePreview();
  }

  function togglePreviewMode(): void {
    previewMode = !previewMode;
    if (previewMode) {
      runPreview();
      void renderPreviewHtml();
    }
  }

  function openMoreMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle(t("epub.settings.exportTemplateModal.actions.revert"));
      item.setDisabled(!isDirty);
      item.onClick(() => {
        void revertCurrentTemplate();
      });
    });
    menu.addItem((item) => {
      item.setTitle(t("epub.settings.exportTemplateModal.actions.duplicate"));
      item.onClick(() => {
        void duplicateCurrentTemplate();
      });
    });
    menu.addItem((item) => {
      item.setTitle(t("epub.settings.exportTemplateModal.actions.openInObsidian"));
      item.onClick(() => {
        if (activeTemplatePath) {
          openBookNotesExportTemplateInEditor(app, activeTemplatePath);
        }
      });
    });
    if (activeTemplate?.isBuiltin) {
      menu.addItem((item) => {
        item.setTitle(t("epub.settings.exportTemplateModal.actions.resetBuiltin"));
        item.onClick(() => {
          void resetCurrentToBuiltin();
        });
      });
    }
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle(t("epub.settings.exportTemplateModal.actions.delete"));
      item.setWarning();
      item.onClick(() => {
        void deleteCurrentTemplate();
      });
    });
    menu.showAtMouseEvent(event);
  }

  function handleEditorInput(): void {
    schedulePreview();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveCurrentTemplate();
    }
  }

  function toggleGroup(groupId: string): void {
    expandedGroups = {
      ...expandedGroups,
      [groupId]: !expandedGroups[groupId],
    };
  }

  async function canCloseModal(): Promise<boolean> {
    if (!isDirty) {
      return true;
    }
    return showObsidianConfirm(
      app,
      t("epub.settings.exportTemplateModal.confirmClose"),
      { title: t("epub.settings.exportTemplateModal.title") }
    );
  }

  async function requestClose(): Promise<void> {
    if (!(await canCloseModal())) {
      return;
    }
    onClose?.();
  }

  $effect(() => {
    editorValue;
    trimBlocks;
    schedulePreview();
  });

  $effect(() => {
    if (previewMode) {
      previewMarkdown;
      void renderPreviewHtml();
    }
  });

  $effect(() => {
    if (!previewToggleBtn) {
      return;
    }
    previewToggleBtn.empty();
    setIcon(previewToggleBtn, previewMode ? "pencil" : "eye");
  });

  onMount(() => {
    registerCloseGuard?.(() => canCloseModal());
    void refreshTemplateList();
    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
      if (previewTimer) {
        window.clearTimeout(previewTimer);
      }
    };
  });

  onDestroy(() => {
    previewHost.unload();
  });
</script>

<div class="epub-export-template-modal">
  <h2 class="epub-export-template-modal__title with-accent-bar accent-purple">
    {t("epub.settings.exportTemplateModal.title")}
  </h2>

  <div class="epub-export-template-modal__toolbar">
    <div class="epub-export-template-modal__toolbar-main">
      <select
        class="epub-export-template-modal__template-select"
        value={activeTemplatePath}
        disabled={isLoading || isSaving || templates.length === 0}
        onchange={handleTemplateSelect}
        aria-label={t("epub.settings.exportTemplateModal.templateSelect")}
      >
        {#each templates as item (item.path)}
          <option value={item.path}>
            {item.fileName}
            {defaultTemplatePath === item.path ? ` ★` : ""}
            {activeTemplatePath === item.path && isDirty ? " ●" : ""}
          </option>
        {/each}
      </select>
    </div>

    <div class="epub-export-template-modal__toolbar-actions">
      {#if isDefaultTemplate || isDirty}
        <div class="epub-export-template-modal__toolbar-status" aria-live="polite">
          {#if isDefaultTemplate}
            <span class="epub-export-template-modal__badge epub-export-template-modal__badge--default">
              {t("epub.settings.exportTemplateModal.defaultBadge")}
            </span>
          {/if}
          {#if isDirty}
            <span class="epub-export-template-modal__badge epub-export-template-modal__badge--dirty">
              {t("epub.settings.exportTemplateModal.unsavedBadge")}
            </span>
          {/if}
        </div>
        <span class="epub-export-template-modal__toolbar-sep" aria-hidden="true"></span>
      {/if}
      <button
        type="button"
        class="clickable-icon epub-export-template-modal__icon-btn"
        bind:this={previewToggleBtn}
        class:is-active={previewMode}
        aria-label={previewMode
          ? t("epub.settings.exportTemplateModal.switchToEdit")
          : t("epub.settings.exportTemplateModal.switchToPreview")}
        title={previewMode
          ? t("epub.settings.exportTemplateModal.switchToEdit")
          : t("epub.settings.exportTemplateModal.switchToPreview")}
        onclick={togglePreviewMode}
      ></button>
      <button
        type="button"
        class="clickable-icon epub-export-template-modal__action-btn epub-export-template-modal__action-btn--primary"
        disabled={!activeTemplatePath || isSaving || !isDirty}
        onclick={() => void saveCurrentTemplate()}
      >
        {t("epub.settings.exportTemplateModal.save")}
      </button>
      <button
        type="button"
        class="clickable-icon epub-export-template-modal__action-btn"
        disabled={!activeTemplatePath || isDefaultTemplate}
        onclick={() => void setCurrentAsDefault()}
      >
        {t("epub.settings.exportTemplateModal.setDefault")}
      </button>
      <button
        type="button"
        class="clickable-icon epub-export-template-modal__icon-btn"
        aria-label={t("epub.settings.exportTemplateModal.moreActions")}
        title={t("epub.settings.exportTemplateModal.moreActions")}
        onclick={openMoreMenu}
      >
        <span aria-hidden="true">⋯</span>
      </button>
    </div>
  </div>

  <div class="epub-export-template-modal__body">
    <aside class="epub-export-template-modal__params">
      <div class="epub-export-template-modal__params-header">
        {t("epub.settings.exportTemplateModal.parametersTitle")}
      </div>

      <div class="epub-export-template-modal__labeled-row">
        <span class="epub-export-template-modal__row-label">
          {t("epub.settings.exportTemplateModal.createFromPreset")}
        </span>
        <div class="epub-export-template-modal__row-actions">
          {#each BOOK_NOTES_EXPORT_DIGEST_PRESET_IDS as presetId, index (presetId)}
            {#if index > 0}
              <span class="epub-export-template-modal__action-sep" aria-hidden="true">·</span>
            {/if}
            <button
              type="button"
              class="clickable-icon epub-export-template-modal__text-btn epub-export-template-modal__preset-btn"
              class:is-active={isPresetActive(presetId)}
              onclick={() => void createFromPreset(presetId)}
            >
              {t(`epub.settings.exportTemplateModal.presets.${presetId === "digest-a" ? "digestA" : presetId === "digest-b" ? "digestB" : "citationG"}`)}
            </button>
          {/each}
        </div>
      </div>

      <div class="epub-export-template-modal__section-divider" role="separator"></div>

      {#each BOOK_NOTES_EXPORT_TEMPLATE_VARIABLE_GROUPS as group (group.id)}
        <section class="epub-export-template-modal__param-group">
          <button
            type="button"
            class="clickable-icon epub-export-template-modal__param-group-toggle"
            onclick={() => toggleGroup(group.id)}
            aria-expanded={expandedGroups[group.id]}
          >
            <span class="epub-export-template-modal__param-group-chevron" aria-hidden="true">
              {expandedGroups[group.id] ? "▾" : "▸"}
            </span>
            <span>{t(group.labelKey)}</span>
          </button>
          {#if expandedGroups[group.id]}
            <ul class="epub-export-template-modal__param-list">
              {#each group.items as item (item.token)}
                <li class="epub-export-template-modal__param-row">
                  <span class="epub-export-template-modal__param-token" title={t(item.labelKey)}>
                    {item.token}
                  </span>
                  <span
                    class="epub-export-template-modal__param-sample"
                    title={t(item.labelKey)}
                  >
                    {t(item.sampleKey)}
                  </span>
                  <button
                    type="button"
                    class="clickable-icon epub-export-template-modal__param-insert"
                    aria-label={t("epub.settings.exportTemplateModal.insert")}
                    title={t("epub.settings.exportTemplateModal.insert")}
                    onclick={() => insertAtCursor(item.token)}
                  >
                    <span use:icon={"plus"}></span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/each}

      <div class="epub-export-template-modal__section-divider" role="separator"></div>

      <div class="epub-export-template-modal__labeled-row">
        <span class="epub-export-template-modal__row-label">
          {t("epub.settings.exportTemplateModal.snippetsTitle")}
        </span>
        <div class="epub-export-template-modal__row-actions">
          {#each BOOK_NOTES_EXPORT_TEMPLATE_LOOP_SNIPPETS as snippet, index (snippet.id)}
            {#if index > 0}
              <span class="epub-export-template-modal__action-sep" aria-hidden="true">·</span>
            {/if}
            <button
              type="button"
              class="clickable-icon epub-export-template-modal__text-btn epub-export-template-modal__snippet-btn"
              onclick={() => insertAtCursor(snippet.content)}
            >
              {t(snippet.labelKey)}
            </button>
          {/each}
        </div>
      </div>

      <div class="epub-export-template-modal__section-divider" role="separator"></div>

      <p class="epub-export-template-modal__page-note">
        {t("epub.settings.exportTemplateModal.pageLabelNote")}
      </p>
    </aside>

    <section class="epub-export-template-modal__workspace">
      {#if isLoading}
        <div class="epub-export-template-modal__loading">{t("epub.settings.exportTemplateModal.loading")}</div>
      {:else if !activeTemplatePath}
        <div class="epub-export-template-modal__empty">{t("epub.settings.exportTemplateModal.empty")}</div>
      {:else if previewMode}
        <div class="epub-export-template-modal__preview-header">
          <span>{t("epub.settings.exportTemplateModal.previewTitle")}</span>
          <span class="epub-export-template-modal__preview-hint">
            {t("epub.settings.exportTemplateModal.previewHint")}
          </span>
        </div>
        {#if previewError}
          <pre class="epub-export-template-modal__preview-error">{previewError}</pre>
        {:else}
          <div class="epub-export-template-modal__preview markdown-rendered" bind:this={previewEl}></div>
        {/if}
      {:else}
        <textarea
          class="epub-export-template-modal__editor"
          bind:this={editorEl}
          bind:value={editorValue}
          spellcheck="false"
          oninput={handleEditorInput}
          aria-label={t("epub.settings.exportTemplateModal.editorLabel")}
        ></textarea>
      {/if}
    </section>
  </div>

  <div class="epub-export-template-modal__footer">
    <span class="epub-export-template-modal__footer-hint">
      {t("epub.settings.exportTemplateModal.footerHint")}
    </span>
    <button type="button" class="clickable-icon epub-export-template-modal__action-btn" onclick={requestClose}>
      {t("epub.settings.exportTemplateModal.close")}
    </button>
  </div>
</div>

<style>
  .epub-export-template-modal {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 520px;
  }

  .epub-export-template-modal__toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: nowrap;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .epub-export-template-modal__toolbar-main {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .epub-export-template-modal__toolbar-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    flex-wrap: nowrap;
  }

  .epub-export-template-modal__toolbar-status {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .epub-export-template-modal__toolbar-sep {
    width: 1px;
    height: 18px;
    background: var(--background-modifier-border);
    flex-shrink: 0;
  }

  .epub-export-template-modal__template-select {
    width: min(320px, 100%);
    min-width: 0;
    max-width: 360px;
  }

  .epub-export-template-modal__badge {
    font-size: 11px;
    line-height: 1.3;
    padding: 0;
    border-radius: 0;
    background: transparent;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .epub-export-template-modal__badge--default {
    color: var(--color-green);
  }

  .epub-export-template-modal__badge--dirty {
    color: var(--color-orange);
  }

  .epub-export-template-modal__icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--clickable-icon-size, 28px);
    height: var(--clickable-icon-size, 28px);
    border-radius: var(--clickable-icon-radius, 4px);
  }

  .epub-export-template-modal__icon-btn.is-active {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }

  .epub-export-template-modal__body {
    display: grid;
    grid-template-columns: minmax(220px, 260px) minmax(0, 1fr);
    gap: 12px;
    min-height: 420px;
    flex: 1;
  }

  .epub-export-template-modal__params {
    overflow: auto;
    padding: 0 10px 0 0;
    border-right: 1px solid var(--background-modifier-border);
  }

  .epub-export-template-modal__params-header {
    font-weight: 600;
    font-size: var(--font-ui-small, 13px);
    margin-bottom: 6px;
  }

  .epub-export-template-modal__section-divider {
    height: 0;
    margin: 8px 0;
    border: none;
    border-top: 1px dashed var(--background-modifier-border);
  }

  .epub-export-template-modal__labeled-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 0;
    line-height: 1.4;
    min-height: 24px;
  }

  .epub-export-template-modal__row-label {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-faint);
    padding-top: 2px;
    user-select: none;
    cursor: default;
  }

  .epub-export-template-modal__row-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 2px 4px;
    flex: 1;
    min-width: 0;
    margin-left: auto;
    text-align: right;
  }

  .epub-export-template-modal__action-sep {
    color: var(--text-faint);
    font-size: 11px;
    user-select: none;
    padding: 0 1px;
  }

  .epub-export-template-modal__text-btn {
    appearance: none;
    border: none;
    box-shadow: none;
    background: transparent;
    color: var(--text-normal);
    font-size: 11px;
    padding: 2px 4px;
    border-radius: var(--clickable-icon-radius, 4px);
    line-height: 1.3;
    min-height: auto;
    text-decoration: underline;
    text-decoration-color: var(--text-faint);
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .epub-export-template-modal__text-btn:hover:not(:disabled) {
    color: var(--text-accent);
    text-decoration-color: currentColor;
    background: var(--background-modifier-hover);
  }

  .epub-export-template-modal__text-btn.is-active {
    color: var(--text-accent);
    font-weight: 600;
    text-decoration-color: currentColor;
  }

  .epub-export-template-modal__param-group {
    margin-bottom: 4px;
  }

  .epub-export-template-modal__param-group-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 4px;
    border: none;
    box-shadow: none;
    background: transparent;
    color: var(--text-normal);
    font-size: 12px;
    font-weight: 600;
    padding: 5px 4px;
    cursor: pointer;
    border-radius: var(--clickable-icon-radius, 4px);
    min-height: auto;
    justify-content: flex-start;
  }

  .epub-export-template-modal__param-group-toggle:hover {
    background: var(--background-modifier-hover);
  }

  .epub-export-template-modal__param-group-chevron {
    width: 12px;
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 10px;
    line-height: 1;
  }

  .epub-export-template-modal__param-list {
    list-style: none;
    margin: 0;
    padding: 0 0 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .epub-export-template-modal__param-row {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr) 24px;
    gap: 4px;
    align-items: center;
    padding: 3px 4px;
    border-radius: var(--clickable-icon-radius, 4px);
    min-height: 26px;
  }

  .epub-export-template-modal__param-row:hover {
    background: var(--background-modifier-hover);
  }

  .epub-export-template-modal__param-token {
    font-family: var(--font-monospace);
    font-size: 10px;
    line-height: 1.3;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .epub-export-template-modal__param-sample {
    font-size: 10px;
    line-height: 1.3;
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .epub-export-template-modal__param-insert {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    min-width: 24px;
    padding: 0;
    border: none;
    box-shadow: none;
    background: transparent;
    color: var(--text-faint);
    border-radius: var(--clickable-icon-radius, 4px);
    flex-shrink: 0;
  }

  .epub-export-template-modal__param-insert:hover:not(:disabled) {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }

  .epub-export-template-modal__page-note {
    margin: 12px 0 0;
    font-size: 11px;
    color: var(--text-faint);
    line-height: 1.45;
  }

  .epub-export-template-modal__workspace {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--background-primary);
  }

  .epub-export-template-modal__editor {
    flex: 1;
    width: 100%;
    min-height: 420px;
    resize: vertical;
    border: none;
    background: transparent;
    color: var(--text-normal);
    font-family: var(--font-monospace);
    font-size: 13px;
    line-height: 1.55;
    padding: 14px;
  }

  .epub-export-template-modal__editor:focus {
    outline: none;
  }

  .epub-export-template-modal__preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
    font-size: 12px;
    color: var(--text-muted);
  }

  .epub-export-template-modal__preview-hint {
    color: var(--text-faint);
  }

  .epub-export-template-modal__preview {
    flex: 1;
    overflow: auto;
    padding: 14px 16px;
  }

  .epub-export-template-modal__preview-error {
    margin: 0;
    padding: 12px 14px;
    color: var(--text-error);
    background: rgba(var(--background-modifier-error-rgb, 255, 80, 80), 0.08);
    white-space: pre-wrap;
    font-family: var(--font-monospace);
    font-size: 12px;
  }

  .epub-export-template-modal__loading,
  .epub-export-template-modal__empty {
    padding: 24px;
    color: var(--text-muted);
  }

  .epub-export-template-modal__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-top: 8px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .epub-export-template-modal__footer-hint {
    font-size: 12px;
    color: var(--text-faint);
  }

  @media (max-width: 860px) {
    .epub-export-template-modal__toolbar {
      flex-wrap: wrap;
      row-gap: 8px;
    }

    .epub-export-template-modal__toolbar-actions {
      width: 100%;
      justify-content: flex-end;
    }

    .epub-export-template-modal__body {
      grid-template-columns: 1fr;
    }

    .epub-export-template-modal__params {
      max-height: 220px;
      border-right: none;
      padding: 0 0 8px;
      border-bottom: 1px dashed var(--background-modifier-border);
    }
  }
</style>
