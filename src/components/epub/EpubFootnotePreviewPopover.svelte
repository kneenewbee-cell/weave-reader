<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { computePosition, flip, offset, shift } from '@floating-ui/dom';
	import type { ReaderFootnotePreviewInfo } from '../../services/epub';
	import { logger } from '../../utils/logger';

	interface Props {
		info: ReaderFootnotePreviewInfo | null;
		boundsEl?: HTMLElement | null;
	}

	let { info, boundsEl = null }: Props = $props();

	let popoverEl: HTMLDivElement | undefined = $state(undefined);
	let posTop = $state(0);
	let posLeft = $state(0);
	let currentPlacement = $state('right-start');

	async function positionPreview() {
		if (!info) {
			return;
		}
		await tick();
		if (!popoverEl) {
			return;
		}
		const virtualReference = {
			getBoundingClientRect: () =>
				DOMRect.fromRect({
					x: info.rect.left,
					y: info.rect.top,
					width: info.rect.width,
					height: info.rect.height,
				}),
		};
		const position = await computePosition(virtualReference, popoverEl, {
			strategy: 'fixed',
			placement: 'right-start',
			middleware: [
				offset(8),
				flip({
					fallbackPlacements: ['left-start', 'top', 'bottom'],
					padding: 12,
				}),
				shift({ padding: 12 }),
			],
		});
		posLeft = position.x;
		posTop = position.y;
		currentPlacement = position.placement;
		logger.debugWithTag(
			'FootnoteDiag',
			`[FootnoteDiag] EpubFootnotePreviewPopover positioned preview href=${info.href} top=${String(posTop)} left=${String(posLeft)} placement=${currentPlacement} width=${String(popoverEl.offsetWidth)}`
		);
	}

	$effect(() => {
		const currentInfo = info;
		const currentBoundsEl = boundsEl;
		void currentInfo;
		void currentBoundsEl;
		if (currentInfo) {
			void positionPreview();
		}
	});

	onMount(() => {
		window.addEventListener('resize', positionPreview);
		window.addEventListener('scroll', positionPreview, true);
		return () => {
			window.removeEventListener('resize', positionPreview);
			window.removeEventListener('scroll', positionPreview, true);
		};
	});
</script>

{#if info}
	<div
		class="epub-footnote-preview epub-glass-panel"
		class:epub-footnote-preview--vertical={currentPlacement.startsWith('top') || currentPlacement.startsWith('bottom')}
		style={`top: ${posTop}px; left: ${posLeft}px;`}
		bind:this={popoverEl}
	>
		<div class="epub-footnote-preview__label">{info.label}</div>
		<div class="epub-footnote-preview__text">{info.text}</div>
	</div>
{/if}

<style>
	.epub-footnote-preview {
		position: fixed;
		z-index: calc(var(--epub-z-popover) + 24);
		display: flex;
		flex-direction: column;
		gap: var(--size-2-2);
		inline-size: fit-content;
		max-inline-size: min(34ch, calc(100vw - 24px));
		padding: var(--size-4-2) var(--size-4-3);
		border-radius: var(--modal-radius, var(--radius-l));
		border: 1px solid color-mix(in srgb, var(--background-modifier-border) 74%, transparent);
		box-shadow: var(--shadow-s);
		pointer-events: none;
		max-height: min(220px, calc(100vh - 24px));
		overflow: hidden;
		box-sizing: border-box;
	}

	.epub-footnote-preview--vertical {
		max-inline-size: min(38ch, calc(100vw - 24px));
	}

	.epub-footnote-preview__label {
		font-size: var(--font-ui-smaller);
		font-weight: 600;
		line-height: var(--line-height-tight);
		color: var(--text-muted);
	}

	.epub-footnote-preview__text {
		font-size: clamp(var(--font-ui-smaller), calc(var(--font-text-size) * 0.8125), calc(var(--font-text-size) * 0.875));
		line-height: var(--line-height-normal);
		font-family: var(--font-text);
		color: var(--text-normal);
		overflow-wrap: anywhere;
		word-break: break-word;
		overflow: hidden;
		line-clamp: 6;
		display: -webkit-box;
		-webkit-line-clamp: 6;
		-webkit-box-orient: vertical;
	}

	@media (max-width: 768px) {
		.epub-footnote-preview {
			display: none;
		}
	}
</style>
