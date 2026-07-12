<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { Platform } from 'obsidian';
	import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
	import { tr } from '../../utils/i18n';
	import { domInstanceOf } from '../../utils/dom-instance-of';
	import type { EpubTocChapterMark } from '../../services/epub/epub-toc-chapter-mark';
	import type { EpubTocChapterMarkSettings } from '../../services/epub/epub-toc-chapter-mark-settings';
	import {
		buildPersistedTocChapterMarkSettings,
		buildTocChapterMarkDefaultLabels,
		normalizeTocChapterMarkColor,
		resolveTocChapterMarkDefinitions,
		type ResolvedEpubTocChapterMarkDefinition,
	} from '../../services/epub/epub-toc-chapter-mark-settings';

	interface Props {
		open: boolean;
		anchor: { x: number; y: number } | null;
		settings: EpubTocChapterMarkSettings;
		onClose: () => void;
		onSave: (settings: EpubTocChapterMarkSettings) => void | Promise<void>;
	}

	let { open, anchor, settings, onClose, onSave }: Props = $props();
	let t = $derived($tr);

	let popoverEl: HTMLDivElement | undefined = $state(undefined);
	let posTop = $state(0);
	let posLeft = $state(0);
	let draftRows = $state<ResolvedEpubTocChapterMarkDefinition[]>([]);
	let saving = $state(false);
	let draftInitializedForOpen = false;
	let cleanupAutoUpdate: (() => void) | null = null;

	let defaultLabels = $derived(buildTocChapterMarkDefaultLabels(t));

	function cloneDraftRows(rows: ResolvedEpubTocChapterMarkDefinition[]): ResolvedEpubTocChapterMarkDefinition[] {
		return rows.map((row) => ({ ...row }));
	}

	function getViewportPadding(): number {
		return Platform.isMobile ? 16 : 12;
	}

	function mountPopoverToBody(): void {
		if (!popoverEl || typeof activeDocument === 'undefined') {
			return;
		}
		if (popoverEl.parentNode === activeDocument.body) {
			return;
		}
		activeDocument.body.appendChild(popoverEl);
	}

	function removePopoverFromBody(): void {
		if (!popoverEl || typeof activeDocument === 'undefined') {
			return;
		}
		if (popoverEl.parentNode === activeDocument.body) {
			popoverEl.remove();
		}
	}

	function stopAutoPositioning(): void {
		cleanupAutoUpdate?.();
		cleanupAutoUpdate = null;
	}

	async function positionPopover() {
		if (!open || !anchor || !popoverEl) {
			return;
		}

		await tick();
		mountPopoverToBody();
		if (!popoverEl) {
			return;
		}

		const padding = getViewportPadding();
		const virtualReference = {
			getBoundingClientRect: () =>
				DOMRect.fromRect({
					x: anchor.x,
					y: anchor.y,
					width: 1,
					height: 1,
				}),
		};

		const position = await computePosition(virtualReference, popoverEl, {
			strategy: 'fixed',
			placement: Platform.isMobile ? 'bottom' : 'right-start',
			middleware: [
				offset(Platform.isMobile ? 12 : 10),
				flip({
					fallbackPlacements: Platform.isMobile
						? ['top', 'bottom']
						: ['left-start', 'bottom-start', 'top-start'],
					padding,
				}),
				shift({ padding, crossAxis: true }),
			],
		});

		posLeft = position.x;
		posTop = position.y;
	}

	async function setupPositioning(): Promise<void> {
		await positionPopover();
		if (!open || !anchor || !popoverEl) {
			return;
		}
		stopAutoPositioning();
		cleanupAutoUpdate = autoUpdate(
			{
				getBoundingClientRect: () =>
					DOMRect.fromRect({
						x: anchor.x,
						y: anchor.y,
						width: 1,
						height: 1,
					}),
			},
			popoverEl,
			() => {
				void positionPopover();
			}
		);
	}

	function updateDraftLabel(mark: EpubTocChapterMark, label: string) {
		draftRows = draftRows.map((row) => (row.mark === mark ? { ...row, label } : row));
	}

	function updateDraftColor(mark: EpubTocChapterMark, color: string) {
		const normalized = normalizeTocChapterMarkColor(color);
		if (!normalized) {
			return;
		}
		draftRows = draftRows.map((row) => (row.mark === mark ? { ...row, color: normalized } : row));
	}

	function handleResetDefaults() {
		draftRows = cloneDraftRows(resolveTocChapterMarkDefinitions({}, defaultLabels));
	}

	async function handleSave() {
		if (saving) {
			return;
		}
		saving = true;
		try {
			const nextSettings = buildPersistedTocChapterMarkSettings(draftRows, defaultLabels);
			await onSave(nextSettings);
			onClose();
		} finally {
			saving = false;
		}
	}

	function handlePointerDownOutside(event: MouseEvent) {
		if (!open || !popoverEl) {
			return;
		}
		const target = event.target;
		if (!domInstanceOf(target, Node) || popoverEl.contains(target)) {
			return;
		}
		if (domInstanceOf(target, Element) && target.closest('.menu')) {
			return;
		}
		onClose();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!open) {
			return;
		}
		if (event.key === 'Escape') {
			onClose();
		}
	}

	$effect(() => {
		if (!open) {
			draftInitializedForOpen = false;
			return;
		}
		if (!draftInitializedForOpen) {
			draftRows = cloneDraftRows(resolveTocChapterMarkDefinitions(settings, defaultLabels));
			draftInitializedForOpen = true;
		}
	});

	$effect(() => {
		if (!open || !anchor) {
			stopAutoPositioning();
			removePopoverFromBody();
			return;
		}

		void setupPositioning();

		return () => {
			stopAutoPositioning();
		};
	});

	onMount(() => {
		activeDocument.addEventListener('mousedown', handlePointerDownOutside, true);
		activeDocument.addEventListener('touchstart', handlePointerDownOutside, true);
		window.addEventListener('resize', positionPopover);
		window.visualViewport?.addEventListener('resize', positionPopover);
		window.visualViewport?.addEventListener('scroll', positionPopover);
	});

	onDestroy(() => {
		activeDocument.removeEventListener('mousedown', handlePointerDownOutside, true);
		activeDocument.removeEventListener('touchstart', handlePointerDownOutside, true);
		window.removeEventListener('resize', positionPopover);
		window.visualViewport?.removeEventListener('resize', positionPopover);
		window.visualViewport?.removeEventListener('scroll', positionPopover);
		stopAutoPositioning();
		removePopoverFromBody();
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open && anchor}
	<div
		class="epub-toc-mark-settings-popover epub-glass-panel"
		style={`top: ${posTop}px; left: ${posLeft}px;`}
		bind:this={popoverEl}
		role="dialog"
		aria-label={t('epub.toc.markSettingsTitle')}
	>
		<div class="epub-toc-mark-settings-popover__title">{t('epub.toc.markSettingsTitle')}</div>

		<ul class="epub-toc-mark-settings-popover__list">
			{#each draftRows as row (row.mark)}
				<li class="epub-toc-mark-settings-popover__item">
					<label class="epub-toc-mark-settings-popover__color-field">
						<span class="epub-toc-mark-settings-popover__color-input-wrap">
							<span
								class="epub-toc-mark-settings-popover__preview-dot"
								style={`--toc-mark-preview-color:${row.color};`}
								aria-hidden="true"
							></span>
							<input
								class="epub-toc-mark-settings-popover__color-input"
								type="color"
								value={row.color}
								aria-label={t('epub.toc.markSettingsColorAria', { label: row.label })}
								oninput={(event) => {
									const target = event.currentTarget;
									if (domInstanceOf(target, HTMLInputElement)) {
										updateDraftColor(row.mark, target.value);
									}
								}}
							/>
						</span>
					</label>
					<input
						class="epub-toc-mark-settings-popover__name-input"
						type="text"
						value={row.label}
						maxlength="24"
						placeholder={defaultLabels[row.mark]}
						aria-label={defaultLabels[row.mark]}
						oninput={(event) => {
							const target = event.currentTarget;
							if (domInstanceOf(target, HTMLInputElement)) {
								updateDraftLabel(row.mark, target.value);
							}
						}}
					/>
				</li>
			{/each}
		</ul>

		<div class="epub-toc-mark-settings-popover__actions">
			<button
				type="button"
				class="clickable-icon epub-toc-mark-settings-popover__reset"
				onclick={handleResetDefaults}
				disabled={saving}
			>
				{t('epub.toc.markSettingsReset')}
			</button>
			<div class="epub-toc-mark-settings-popover__primary-actions">
				<button
					type="button"
					class="clickable-icon epub-toc-mark-settings-popover__cancel"
					onclick={onClose}
					disabled={saving}
				>
					{t('epub.toc.markSettingsCancel')}
				</button>
				<button
					type="button"
					class="mod-cta epub-toc-mark-settings-popover__save"
					onclick={() => void handleSave()}
					disabled={saving}
				>
					{t('epub.toc.markSettingsSave')}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.epub-toc-mark-settings-popover {
		position: fixed;
		z-index: var(--weave-z-menu, 1200);
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: min(320px, calc(100vw - 32px));
		max-height: min(72dvh, calc(100dvh - 32px));
		overflow: auto;
		padding: 14px;
		border-radius: var(--modal-radius, var(--radius-l));
		border: 1px solid color-mix(in srgb, var(--background-modifier-border) 74%, transparent);
		box-shadow: var(--shadow-s);
		background: color-mix(in srgb, var(--background-primary) 94%, var(--background-secondary) 6%);
	}

	:global(body > .epub-toc-mark-settings-popover) {
		position: fixed !important;
	}

	.epub-toc-mark-settings-popover__title {
		font-size: var(--font-ui-small);
		font-weight: var(--font-semibold, 600);
		color: var(--text-normal);
	}

	.epub-toc-mark-settings-popover__list {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.epub-toc-mark-settings-popover__item {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 10px;
		align-items: center;
		padding: 8px 10px;
		border-radius: var(--radius-m);
		background: color-mix(in srgb, var(--background-secondary) 72%, transparent);
	}

	.epub-toc-mark-settings-popover__color-field {
		display: flex;
		align-items: center;
	}

	.epub-toc-mark-settings-popover__color-input-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
	}

	.epub-toc-mark-settings-popover__preview-dot {
		width: 10px;
		height: 10px;
		border-radius: 999px;
		background: var(--toc-mark-preview-color);
		pointer-events: none;
	}

	.epub-toc-mark-settings-popover__color-input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
		opacity: 0;
	}

	.epub-toc-mark-settings-popover__name-input {
		width: 100%;
		min-width: 0;
		padding: 6px 8px;
		border-radius: var(--input-radius, var(--radius-s));
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: var(--font-ui-small);
	}

	.epub-toc-mark-settings-popover__actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: 2px;
	}

	.epub-toc-mark-settings-popover__primary-actions {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.epub-toc-mark-settings-popover__reset,
	.epub-toc-mark-settings-popover__cancel {
		padding: 4px 8px;
		color: var(--text-muted);
		font-size: var(--font-ui-smaller);
	}

	.epub-toc-mark-settings-popover__save {
		padding: 6px 12px;
		font-size: var(--font-ui-smaller);
	}
</style>
