<script lang="ts">
  import { Notice } from 'obsidian';
  import type StandaloneEpubPlugin from '../../main';
  import {
    EpubDataManagementService,
    type EpubDataCheckResult,
    type EpubDataFixResult,
  } from '../../services/data-management/EpubDataManagementService';

  interface Props {
    plugin: StandaloneEpubPlugin;
    onClose?: () => void;
  }

  let { plugin, onClose }: Props = $props();

  const CHECK_TYPES = [
    'epub_source_link_migration',
    'epub_markdown_source_id_backfill',
  ] as const;

  const CHECK_LABELS: Record<(typeof CHECK_TYPES)[number], string> = {
    epub_source_link_migration: 'EPUB 溯源链接迁移',
    epub_markdown_source_id_backfill: 'EPUB Markdown sourceId 回填',
  };

  let isBusy = $state(false);
  let results = $state<EpubDataCheckResult[]>([]);
  let fixReports = $state<EpubDataFixResult[]>([]);

  const service = $derived(new EpubDataManagementService(plugin.app));

  async function runChecks(): Promise<void> {
    isBusy = true;
    fixReports = [];
    try {
      results = [];
      for (const type of CHECK_TYPES) {
        results.push(await service.check(type));
      }
    } catch (error) {
      new Notice(`EPUB 数据检测失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      isBusy = false;
    }
  }

  async function runFixes(): Promise<void> {
    isBusy = true;
    try {
      fixReports = [];
      for (const type of CHECK_TYPES) {
        fixReports.push(await service.fix(type, { allowHighRisk: true }));
      }
      await runChecks();
      new Notice('EPUB 数据修复已完成');
    } catch (error) {
      new Notice(`EPUB 数据修复失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      isBusy = false;
    }
  }

  function statusClass(status: EpubDataCheckResult['status']): string {
    if (status === 'warning') return 'warning';
    if (status === 'error') return 'error';
    return 'ok';
  }
</script>

<div class="epub-data-management">
  <p class="intro">
    检测与修复 EPUB 溯源链接、Markdown sourceId 回填等遗留格式。记忆卡片写入依赖已安装的 Weave 主插件。
  </p>

  <div class="actions">
    <button type="button" class="mod-cta" disabled={isBusy} onclick={runChecks}>
      {isBusy ? '处理中…' : '检测全部'}
    </button>
    <button type="button" class="mod-warning" disabled={isBusy} onclick={runFixes}>
      修复全部
    </button>
    {#if onClose}
      <button type="button" disabled={isBusy} onclick={onClose}>关闭</button>
    {/if}
  </div>

  {#if results.length > 0}
    <div class="results">
      {#each results as result}
        <div class="result-item {statusClass(result.status)}">
          <div class="result-title">{CHECK_LABELS[result.type]}</div>
          <div class="result-message">{result.message}</div>
          {#if result.items.length > 0}
            <ul class="result-items">
              {#each result.items.slice(0, 8) as item}
                <li>{item}</li>
              {/each}
              {#if result.items.length > 8}
                <li>…还有 {result.items.length - 8} 项</li>
              {/if}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if fixReports.length > 0}
    <div class="fix-reports">
      {#each fixReports as report}
        <div class="fix-report">
          <span>{CHECK_LABELS[report.type]}：成功 {report.success}，失败 {report.failed}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  :global(.weave-epub-data-management-modal) {
    width: min(720px, 92vw);
    max-width: 720px;
  }

  .epub-data-management {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .intro {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    line-height: 1.5;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .result-item {
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    padding: 10px 12px;
  }

  .result-item.warning {
    border-color: var(--color-orange);
  }

  .result-item.error {
    border-color: var(--color-red);
  }

  .result-title {
    font-weight: 600;
    margin-bottom: 4px;
  }

  .result-message {
    font-size: var(--font-ui-small);
  }

  .result-items {
    margin: 8px 0 0;
    padding-left: 18px;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  .fix-reports {
    font-size: var(--font-ui-small);
    color: var(--text-muted);
  }
</style>
