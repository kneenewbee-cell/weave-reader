<script lang="ts">
	import type { App } from "obsidian";
	import {
		listBookNotesExportTemplateFiles,
		type BookNotesExportTemplateListItem,
	} from "../../services/epub/book-notes-export/template-catalog";
	import { resolveBookNotesExportTemplateFolder } from "../../services/epub/book-notes-export/template-folder";
	import { domInstanceOf } from "../../utils/dom-instance-of";
	import { getVaultFileBasename } from "../../utils/VaultMarkdownFileSuggest";
	import { tr } from "../../utils/i18n";
	import { fromStore } from "svelte/store";

	interface Props {
		app: App;
		templatePath?: string | null;
		templateFolderSettings?: { bookNotesExportTemplateFolder?: string | null } | null;
		settingsReady?: boolean;
		active?: boolean;
		onSelect?: (path: string) => void | Promise<void>;
	}

	let {
		app,
		templatePath = null,
		templateFolderSettings = null,
		settingsReady = true,
		active = true,
		onSelect,
	}: Props = $props();

	const trState = fromStore(tr);
	let t = $derived(trState.current);
	let templates = $state<BookNotesExportTemplateListItem[]>([]);
	let isLoading = $state(false);

	const selectedPath = $derived(String(templatePath || "").trim());
	const templateFolder = $derived(
		resolveBookNotesExportTemplateFolder(templateFolderSettings, {
			allowDefaultFallback: settingsReady,
		})
	);

	const displayTemplates = $derived.by(() => {
		const items = [...templates];
		if (
			selectedPath &&
			!items.some((item) => item.path === selectedPath)
		) {
			items.unshift({
				path: selectedPath,
				fileName: getVaultFileBasename(selectedPath),
				isBuiltin: false,
				builtinId: null,
			});
		}
		return items;
	});

	function displayName(fileName: string): string {
		return getVaultFileBasename(fileName);
	}

	async function refreshTemplates(): Promise<void> {
		isLoading = true;
		try {
			templates = await listBookNotesExportTemplateFiles(app, templateFolder);
		} finally {
			isLoading = false;
		}
	}

	$effect(() => {
		templateFolder;
		settingsReady;
		if (!active || !settingsReady || !templateFolder) {
			return;
		}
		void refreshTemplates();
	});

	function handleChange(event: Event): void {
		const target = event.currentTarget;
		if (!domInstanceOf(target, HTMLSelectElement)) {
			return;
		}
		const nextPath = String(target.value || "").trim();
		if (!nextPath || nextPath === selectedPath) {
			return;
		}
		void onSelect?.(nextPath);
	}

	function stopPopoverClose(event: Event): void {
		event.stopPropagation();
	}
</script>

<select
	class="epub-export-notes-popover__template-select"
	value={selectedPath}
	disabled={isLoading || displayTemplates.length === 0}
	aria-label={t("epub.reader.exportNotesPopover.templateLabel")}
	onchange={handleChange}
	onmousedown={stopPopoverClose}
	onclick={stopPopoverClose}
	onpointerdown={stopPopoverClose}
>
	{#if isLoading}
		<option value="" disabled>
			{t("epub.reader.exportNotesPopover.templateLoading")}
		</option>
	{:else if displayTemplates.length === 0}
		<option value="" disabled>
			{t("epub.reader.exportNotesPopover.templateEmpty")}
		</option>
	{:else if !selectedPath}
		<option value="" disabled selected>
			{t("epub.reader.exportNotesPopover.templatePlaceholder")}
		</option>
	{/if}
	{#each displayTemplates as item (item.path)}
		<option value={item.path}>{displayName(item.fileName)}</option>
	{/each}
</select>
