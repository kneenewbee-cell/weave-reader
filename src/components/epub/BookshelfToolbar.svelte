<script lang="ts">
	import { obsidianIcon } from '../../utils/obsidian-icon-action';

	export interface BookshelfToolbarProps {
		searching: boolean;
		backButtonLabel: string;
		t: (key: string) => string;
		onImport: () => void | Promise<void>;
		onToggleSearch: () => void;
		onBack: () => void | Promise<void>;
		onSettings: (event: MouseEvent) => void;
	}

	let {
		searching = false,
		backButtonLabel,
		t,
		onImport,
		onToggleSearch,
		onBack,
		onSettings,
	}: BookshelfToolbarProps = $props();

</script>

<div class="epub-bookshelf-toolbar nav-header" role="toolbar" aria-label={t('epub.bookshelf.toolbar.aria')}>
	<div class="epub-bookshelf-actions nav-buttons-container">
		<button
			type="button"
			class="epub-toolbar-btn clickable-icon nav-action-button"
			title={t('epub.bookshelf.toolbar.import')}
			aria-label={t('epub.bookshelf.toolbar.import')}
			onclick={() => void onImport()}
		>
			<span use:obsidianIcon={'scan-search'}></span>
		</button>
		<button
			type="button"
			class="epub-toolbar-btn clickable-icon nav-action-button"
			title={searching ? t('epub.bookshelf.toolbar.searchClose') : t('epub.bookshelf.toolbar.search')}
			aria-label={searching ? t('epub.bookshelf.toolbar.searchClose') : t('epub.bookshelf.toolbar.search')}
			onclick={onToggleSearch}
		>
			<span use:obsidianIcon={searching ? 'x' : 'search'}></span>
		</button>
		<button
			type="button"
			class="epub-toolbar-btn clickable-icon nav-action-button"
			title={backButtonLabel}
			aria-label={backButtonLabel}
			onclick={() => void onBack()}
		>
			<span use:obsidianIcon={'arrow-left'}></span>
		</button>
		<button
			type="button"
			class="epub-toolbar-btn clickable-icon nav-action-button"
			title={t('epub.bookshelf.toolbar.settings')}
			aria-label={t('epub.bookshelf.toolbar.settings')}
			onclick={onSettings}
		>
			<span use:obsidianIcon={'settings'}></span>
		</button>
	</div>
</div>
