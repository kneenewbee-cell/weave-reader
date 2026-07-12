<script lang="ts">
import type { App } from "obsidian";
import type { EpubExcerptSettings } from "../../services/epub/epub-excerpt-settings";
import BookNotesExportTemplateSelect from "./BookNotesExportTemplateSelect.svelte";
import VaultFileSearchInput from "./VaultFileSearchInput.svelte";

export type BookNotesExportSettingKey =
	| "bookNotesExportIncludeHighlight"
	| "bookNotesExportIncludeUnderline"
	| "bookNotesExportIncludeStrikethrough"
	| "bookNotesExportIncludeWavy"
	| "bookNotesExportTemplatePath"
	| "bookNotesExportTargetMode"
	| "bookNotesExportAppendPath";

export interface BookNotesExportPopoverProps {
	app: App;
	open: boolean;
	excerptSettingsReady?: boolean;
	exportNotesPopoverEl?: HTMLDivElement | null;
	excerptSettings: EpubExcerptSettings;
	exportNotesSubmitting: boolean;
	canSubmit: boolean;
	t: (key: string) => string;
	isMarkdownVaultFile: (file: import("obsidian").TAbstractFile) => boolean;
	onUpdateSetting: (patch: Partial<Pick<EpubExcerptSettings, BookNotesExportSettingKey>>) => void | Promise<void>;
	onUpdateTargetMode: (targetMode: EpubExcerptSettings["bookNotesExportTargetMode"]) => void | Promise<void>;
	onClose: () => void;
	onSubmit: () => void | Promise<void>;
}

let {
	app,
	open = false,
	excerptSettingsReady = true,
	exportNotesPopoverEl = $bindable(null),
	excerptSettings,
	exportNotesSubmitting = false,
	canSubmit = false,
	t,
	isMarkdownVaultFile,
	onUpdateSetting,
	onUpdateTargetMode,
	onClose,
	onSubmit,
}: BookNotesExportPopoverProps = $props();
</script>

{#if open}
	<div
		class="epub-settings-float epub-export-notes-popover epub-glass-panel"
		bind:this={exportNotesPopoverEl}
	>
		<div class="epub-export-notes-popover__header">
			<div class="epub-export-notes-popover__title">{t('epub.reader.exportNotesPopover.title')}</div>
		</div>
		<div class="epub-export-notes-popover__section">
			<div class="epub-export-notes-popover__label">{t('epub.reader.exportNotesPopover.templateLabel')}</div>
			<BookNotesExportTemplateSelect
				{app}
				active={open}
				settingsReady={excerptSettingsReady}
				templatePath={excerptSettings.bookNotesExportTemplatePath}
				templateFolderSettings={excerptSettings}
				onSelect={(path) => void onUpdateSetting({ bookNotesExportTemplatePath: path })}
			/>
		</div>
		<div class="epub-export-notes-popover__section">
			<div class="epub-export-notes-popover__label">{t('epub.reader.exportNotesPopover.typeLabel')}</div>
			<div class="epub-export-notes-popover__toggle-list">
				<label class="epub-export-notes-popover__toggle-row">
					<span>{t('epub.reader.highlight')}</span>
					<span class="epub-export-notes-popover__toggle-switch">
						<input
							type="checkbox"
							checked={excerptSettings.bookNotesExportIncludeHighlight}
							onchange={(event) => void onUpdateSetting({
								bookNotesExportIncludeHighlight: (event.currentTarget as HTMLInputElement).checked,
							})}
						/>
						<span class="epub-export-notes-popover__toggle-slider"></span>
					</span>
				</label>
				<label class="epub-export-notes-popover__toggle-row">
					<span>{t('epub.reader.underline')}</span>
					<span class="epub-export-notes-popover__toggle-switch">
						<input
							type="checkbox"
							checked={excerptSettings.bookNotesExportIncludeUnderline}
							onchange={(event) => void onUpdateSetting({
								bookNotesExportIncludeUnderline: (event.currentTarget as HTMLInputElement).checked,
							})}
						/>
						<span class="epub-export-notes-popover__toggle-slider"></span>
					</span>
				</label>
				<label class="epub-export-notes-popover__toggle-row">
					<span>{t('epub.reader.strikethrough')}</span>
					<span class="epub-export-notes-popover__toggle-switch">
						<input
							type="checkbox"
							checked={excerptSettings.bookNotesExportIncludeStrikethrough}
							onchange={(event) => void onUpdateSetting({
								bookNotesExportIncludeStrikethrough: (event.currentTarget as HTMLInputElement).checked,
							})}
						/>
						<span class="epub-export-notes-popover__toggle-slider"></span>
					</span>
				</label>
				<label class="epub-export-notes-popover__toggle-row">
					<span>{t('epub.reader.wavy')}</span>
					<span class="epub-export-notes-popover__toggle-switch">
						<input
							type="checkbox"
							checked={excerptSettings.bookNotesExportIncludeWavy}
							onchange={(event) => void onUpdateSetting({
								bookNotesExportIncludeWavy: (event.currentTarget as HTMLInputElement).checked,
							})}
						/>
						<span class="epub-export-notes-popover__toggle-slider"></span>
					</span>
				</label>
			</div>
		</div>
		<div class="epub-export-notes-popover__section">
			<div class="epub-export-notes-popover__label">{t('epub.reader.exportNotesPopover.targetLabel')}</div>
			<div class="epub-export-notes-popover__target-options">
				<label class="epub-export-notes-popover__target-option">
					<input
						type="radio"
						name="epub-export-notes-target"
						value="new"
						checked={excerptSettings.bookNotesExportTargetMode !== 'append'}
						onchange={() => void onUpdateTargetMode('new')}
					/>
					<span>{t('epub.reader.exportNotesPopover.targetNew')}</span>
				</label>
				<label class="epub-export-notes-popover__target-option">
					<input
						type="radio"
						name="epub-export-notes-target"
						value="append"
						checked={excerptSettings.bookNotesExportTargetMode === 'append'}
						onchange={() => void onUpdateTargetMode('append')}
					/>
					<span>{t('epub.reader.exportNotesPopover.targetAppend')}</span>
				</label>
			</div>
			{#if excerptSettings.bookNotesExportTargetMode === 'append'}
				<div class="epub-export-notes-popover__append-target">
					<div class="epub-export-notes-popover__label">{t('epub.reader.exportNotesPopover.appendTargetLabel')}</div>
					{#key excerptSettings.bookNotesExportTargetMode}
						<VaultFileSearchInput
							{app}
							filePath={excerptSettings.bookNotesExportAppendPath}
							placeholder={t('epub.reader.exportNotesPopover.appendTargetPlaceholder')}
							filter={isMarkdownVaultFile}
							onSelect={(path) => void onUpdateSetting({
								bookNotesExportAppendPath: path,
								bookNotesExportTargetMode: 'append',
							})}
						/>
					{/key}
				</div>
			{/if}
		</div>
		<div class="epub-export-notes-popover__actions">
			<button type="button" class="epub-export-notes-popover__action" onclick={onClose}>{t('epub.reader.exportNotesPopover.cancel')}</button>
			<button
				type="button"
				class="epub-export-notes-popover__action epub-export-notes-popover__action--primary"
				disabled={exportNotesSubmitting || !canSubmit}
				onclick={() => void onSubmit()}
			>{t('epub.reader.exportNotesPopover.export')}</button>
		</div>
	</div>
{/if}
