<script lang="ts">
	import type { App, TFile } from 'obsidian';
	import { onDestroy, onMount } from 'svelte';
	import { fromStore } from 'svelte/store';
	import { domInstanceOf } from '../../utils/dom-instance-of';
	import { tr } from '../../utils/i18n';
	import {
		getVaultFileBasename,
		VaultMarkdownFileSuggest,
		WEAVE_VAULT_FILE_SEARCH_ROOT_CLASS,
	} from '../../utils/VaultMarkdownFileSuggest';

	interface Props {
		app: App;
		filePath?: string | null;
		placeholder?: string;
		filter?: (file: TFile) => boolean;
		onSelect?: (path: string) => void | Promise<void>;
	}

	let {
		app,
		filePath = null,
		placeholder = '',
		filter,
		onSelect,
	}: Props = $props();

	const trState = fromStore(tr);
	let t = $derived(trState.current);

	let inputEl = $state<HTMLInputElement | null>(null);
	let inputValue = $state('');
	let isFocused = $state(false);
	let suggest: VaultMarkdownFileSuggest | null = null;

	const showClearButton = $derived(Boolean(String(inputValue || '').trim()));

	function syncInputFromSelection(): void {
		if (isFocused) {
			return;
		}
		inputValue = getVaultFileBasename(filePath);
	}

	$effect(() => {
		filePath;
		syncInputFromSelection();
	});

	function openSuggestions(): void {
		inputEl?.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function handleFocus(): void {
		isFocused = true;
		openSuggestions();
	}

	function handleBlur(): void {
		window.setTimeout(() => {
			isFocused = false;
			syncInputFromSelection();
		}, 120);
	}

	function handleInput(event: Event): void {
		const target = event.currentTarget;
		if (!domInstanceOf(target, HTMLInputElement)) {
			return;
		}
		inputValue = target.value;
	}

	function handleClearMouseDown(event: MouseEvent): void {
		event.preventDefault();
	}

	function handleClear(): void {
		inputValue = '';
		if (inputEl) {
			inputEl.value = '';
			inputEl.focus();
		}
		openSuggestions();
	}

	onMount(() => {
		if (!inputEl) {
			return;
		}

		syncInputFromSelection();
		suggest = new VaultMarkdownFileSuggest(app, inputEl, {
			filter: typeof filter === 'function' ? filter : undefined,
			onSelectFile: (file) => {
				isFocused = false;
				inputValue = file.basename;
				void onSelect?.(file.path);
			},
		});
	});

	$effect(() => {
		const nextFilter = typeof filter === 'function' ? filter : undefined;
		suggest?.updateFilter(nextFilter);
	});

	onDestroy(() => {
		suggest?.destroy();
		suggest = null;
	});
</script>

<div class={WEAVE_VAULT_FILE_SEARCH_ROOT_CLASS}>
	<span class="weave-vault-file-search__icon" aria-hidden="true">
		<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
			<circle cx="11" cy="11" r="7"></circle>
			<path d="M20 20L16.65 16.65"></path>
		</svg>
	</span>
	<input
		bind:this={inputEl}
		type="text"
		class="weave-vault-file-search__input"
		{placeholder}
		value={inputValue}
		onfocus={handleFocus}
		onblur={handleBlur}
		oninput={handleInput}
	/>
	{#if showClearButton}
		<button
			type="button"
			class="weave-vault-file-search__clear clickable-icon"
			aria-label={t('epub.globalSidebar.searchUi.clearSearch')}
			onmousedown={handleClearMouseDown}
			onclick={handleClear}
		>
			<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M18 6L6 18"></path>
				<path d="M6 6L18 18"></path>
			</svg>
		</button>
	{/if}
</div>
