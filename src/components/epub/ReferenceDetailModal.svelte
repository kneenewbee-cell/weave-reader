<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { computePosition, flip, offset, shift } from '@floating-ui/dom';
	import type { EpubReaderEngine, HighlightClickInfo } from '../../services/epub';
	import type { ReferenceSourceInfo, ReferenceStats } from '../../services/epub/EpubReferenceStatsService';
	import { tr } from '../../utils/i18n';
	import { createEventBinder, isEventOutsideToolbar } from './toolbar-positioning';
	import { domInstanceOf } from '../../utils/dom-instance-of';

	interface Props {
		open: boolean;
		info: HighlightClickInfo | null;
		stats: ReferenceStats | null;
		readerService?: EpubReaderEngine | null;
		boundsEl?: HTMLElement | null;
		onClose: () => void;
		onNavigate: (source: ReferenceSourceInfo) => Promise<void> | void;
	}

	let {
		open,
		info,
		stats,
		readerService = null,
		boundsEl = null,
		onClose,
		onNavigate,
	}: Props = $props();
	let t = $derived($tr);

	let popoverEl: HTMLDivElement | undefined = $state(undefined);
	let posTop = $state(0);
	let posLeft = $state(0);
	let currentPlacement = $state('bottom-end');
	let navigatingKey = $state<string | null>(null);
	let teardownOutsidePointerTracking: (() => void) | null = null;

	async function positionPopover() {
		if (!open || !info) {
			return;
		}
		await tick();
		if (!popoverEl) {
			return;
		}

		const referenceRect = info.anchorPoint
			? DOMRect.fromRect({
					x: info.anchorPoint.x,
					y: info.anchorPoint.y,
					width: 1,
					height: 1,
				})
			: DOMRect.fromRect({
					x: info.rect.left,
					y: info.rect.top,
					width: info.rect.width,
					height: info.rect.height,
				});

		const virtualReference = {
			getBoundingClientRect: () => referenceRect,
		};

		const position = await computePosition(virtualReference, popoverEl, {
			strategy: 'fixed',
			placement: 'bottom-end',
			middleware: [
				offset(10),
				flip({
					fallbackPlacements: ['top-end', 'bottom-start', 'top-start'],
					padding: 12,
				}),
				shift({ padding: 12 }),
			],
		});

		posLeft = position.x;
		posTop = position.y;
		currentPlacement = position.placement;
	}

	async function handleNavigate(source: ReferenceSourceInfo) {
		navigatingKey = source.key;
		try {
			await onNavigate(source);
		} finally {
			navigatingKey = null;
		}
	}

	function handlePointerDownOutside(event: Event) {
		if (!open || !popoverEl) {
			return;
		}
		if (!isEventOutsideToolbar(popoverEl, event)) {
			return;
		}
		onClose();
	}

	function stopOutsidePointerTracking() {
		teardownOutsidePointerTracking?.();
		teardownOutsidePointerTracking = null;
	}

	function startOutsidePointerTracking() {
		if (!open || !popoverEl || teardownOutsidePointerTracking) {
			return;
		}

		const binder = createEventBinder();
		const eventTargets = new Set<EventTarget>([activeDocument]);
		for (const frame of readerService?.getVisibleFrames?.() || []) {
			if (frame?.frameDocument) {
				eventTargets.add(frame.frameDocument);
			}
		}

		for (const target of eventTargets) {
			binder.bind(target, 'mousedown', handlePointerDownOutside);
			binder.bind(target, 'touchstart', handlePointerDownOutside, { passive: true });
		}

		teardownOutsidePointerTracking = () => {
			binder.dispose();
		};
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!open || !popoverEl) {
			return;
		}
		const target = event.target;
		if (!domInstanceOf(target, Node) || !popoverEl.contains(target)) {
			return;
		}
		if (event.key === 'Escape') {
			onClose();
		}
	}

	function focusPopover(): void {
		if (!open || !popoverEl) {
			return;
		}
		try {
			popoverEl.focus({ preventScroll: true });
		} catch {
			popoverEl.focus();
		}
	}

	$effect(() => {
		const currentOpen = open;
		const currentInfo = info;
		const currentStats = stats;
		const currentReaderService = readerService;
		const currentBoundsEl = boundsEl;
		void currentInfo;
		void currentStats;
		void currentReaderService;
		void currentBoundsEl;
		if (currentOpen && currentInfo && currentStats) {
			untrack(() => {
				void positionPopover();
			});
		}
	});

	$effect(() => {
		const currentOpen = open;
		const currentInfo = info;
		const currentStats = stats;
		const currentReaderService = readerService;
		void currentReaderService;

		if (!currentOpen || !currentInfo || !currentStats || !popoverEl) {
			untrack(() => {
				stopOutsidePointerTracking();
			});
			return;
		}

		untrack(() => {
			startOutsidePointerTracking();
		});
		return () => {
			untrack(() => {
				stopOutsidePointerTracking();
			});
		};
	});

	$effect(() => {
		if (!open) {
			return;
		}
		queueMicrotask(() => focusPopover());
	});

	onMount(() => {
		window.addEventListener('resize', positionPopover);
		window.addEventListener('scroll', positionPopover, true);
		return () => {
			stopOutsidePointerTracking();
			window.removeEventListener('resize', positionPopover);
			window.removeEventListener('scroll', positionPopover, true);
		};
	});
</script>

{#if open && info && stats}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="epub-reference-popover"
		class:epub-reference-popover--top={currentPlacement.startsWith('top')}
		style={`top: ${posTop}px; left: ${posLeft}px;`}
		bind:this={popoverEl}
		tabindex="-1"
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="false"
		aria-labelledby="epub-reference-popover-heading"
	>
		<section class="epub-reference-popover__list" aria-label={t('epub.reader.referenceDetail.listAria')}>
			<h2 id="epub-reference-popover-heading" class="epub-reference-popover__subtitle">
				{t('epub.reader.referenceDetail.title')}
			</h2>
			<ol class="epub-reference-popover__items">
				{#each stats.sources as source, index (source.key)}
					<li>
						<button
							type="button"
							class="epub-reference-popover__item"
							onclick={() => void handleNavigate(source)}
							disabled={navigatingKey === source.key}
							aria-label={t('epub.reader.referenceDetail.itemAria', { index: index + 1, name: source.displayName })}
							title={source.file}
						>
							<span class="epub-reference-popover__line">{index + 1}.{source.displayName}</span>
						</button>
					</li>
				{/each}
			</ol>
		</section>
	</div>
{/if}

<style>
	.epub-reference-popover {
		position: fixed;
		z-index: calc(var(--epub-z-popover) + 28);
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		min-height: 0;
		width: max-content;
		max-width: min(420px, calc(100vw - 24px));
		min-width: 0;
		max-height: min(78vh, 720px);
		padding: 6px 0;
		border-radius: var(--radius-m, 8px);
		border: 1px solid var(--background-modifier-border);
		box-shadow: var(--shadow-s, 0 2px 12px rgba(0, 0, 0, 0.12));
		background: var(--background-primary);
		color: var(--text-normal);
		font-family: var(--font-interface, var(--font-text, ui-sans-serif, system-ui, sans-serif));
	}

	.epub-reference-popover__list {
		width: 100%;
		flex: 1 1 auto;
		min-height: 0;
		max-height: inherit;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.epub-reference-popover__subtitle {
		margin: 0;
		padding: 8px 12px 4px;
		font-size: var(--font-ui-smaller, 11px);
		font-weight: 500;
		line-height: var(--line-height-tight, 1.35);
		letter-spacing: 0.02em;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.epub-reference-popover__items {
		width: 100%;
		box-sizing: border-box;
		margin: 0;
		padding: 4px 8px 6px;
		flex: 1;
		min-height: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0;
		max-height: min(72vh, 680px);
		overflow-y: auto;
	}

	.epub-reference-popover__item {
		display: block;
		width: 100%;
		margin: 0;
		padding: 6px 10px;
		border: none;
		border-radius: var(--radius-s, 4px);
		box-shadow: none;
		background: transparent;
		text-align: left;
		cursor: pointer;
		color: inherit;
		font: inherit;
		line-height: var(--line-height-tight, 1.35);
		transition: background-color 100ms ease;
	}

	.epub-reference-popover__item:focus {
		outline: none;
	}

	.epub-reference-popover__item:focus-visible {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 1px;
	}

	.epub-reference-popover__item:hover:not(:disabled) {
		background: var(--background-modifier-hover);
	}

	.epub-reference-popover__item:disabled {
		opacity: 0.65;
		cursor: progress;
	}

	.epub-reference-popover__line {
		display: block;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--font-ui-small, 13px);
		font-weight: 400;
	}

	@media (max-width: 768px) {
		.epub-reference-popover {
			max-width: calc(100vw - 16px);
			max-height: min(72vh, calc(100vh - 16px));
		}

		.epub-reference-popover__items {
			max-height: min(68vh, calc(100vh - 48px));
		}
	}
</style>
