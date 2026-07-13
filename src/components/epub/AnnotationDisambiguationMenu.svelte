<script lang="ts">
	import { setIcon, Platform } from 'obsidian';
	import { tick, untrack } from 'svelte';
	import { tr } from '../../utils/i18n';
	import type { EpubReaderEngine, HighlightClickInfo } from '../../services/epub';
	import {
		computeToolbarPosition,
		createEventBinder,
		isEventOutsideToolbar,
		resolveMobileFloatingInsetBottom,
	} from './toolbar-positioning';

	export type AnnotationDisambiguationCandidate = {
		id: string;
		label: string;
		description?: string;
		color: string;
		info: HighlightClickInfo;
	};

	interface Props {
		readerService: EpubReaderEngine;
		anchor: HighlightClickInfo | null;
		candidates: AnnotationDisambiguationCandidate[];
		mobileDockBottomOffset?: number;
		onPreview: (candidate: AnnotationDisambiguationCandidate | null) => void;
		onSelect: (candidate: AnnotationDisambiguationCandidate) => void;
		onDismiss: () => void;
	}

	let {
		readerService,
		anchor,
		candidates,
		mobileDockBottomOffset = 0,
		onPreview,
		onSelect,
		onDismiss,
	}: Props = $props();
	let t = $derived($tr);

	let menuEl: HTMLDivElement | undefined = $state(undefined);
	let posTop = $state(0);
	let posLeft = $state(0);
	let isBelowTarget = $state(false);
	let menuMode = $state<'floating' | 'docked'>('floating');
	let arrowOffset = $state(0);
	let teardownOutsidePointerTracking: (() => void) | null = null;

	const isMobileMenu = Platform.isMobile || activeDocument.body.classList.contains('is-mobile');

	function icon(node: HTMLElement, name: string) {
		setIcon(node, name);
		return {
			update(newName: string) {
				node.replaceChildren();
				setIcon(node, newName);
			},
		};
	}

	function stopOutsidePointerTracking() {
		teardownOutsidePointerTracking?.();
		teardownOutsidePointerTracking = null;
	}

	function startOutsidePointerTracking() {
		if (!anchor || !menuEl || teardownOutsidePointerTracking) return;
		const binder = createEventBinder();
		const eventTargets = new Set<EventTarget>([document]);
		for (const frame of readerService.getVisibleFrames()) {
			if (frame?.frameDocument) {
				eventTargets.add(frame.frameDocument);
			}
		}
		for (const target of eventTargets) {
			binder.bind(target, 'mousedown', handleClickOutside);
			binder.bind(target, 'touchstart', handleClickOutside, { passive: true });
		}
		teardownOutsidePointerTracking = () => binder.dispose();
	}

	function handleClickOutside(event: Event) {
		if (anchor && isEventOutsideToolbar(menuEl, event)) {
			onPreview(null);
			onDismiss();
		}
	}

	async function positionMenu() {
		const currentAnchor = anchor;
		if (!currentAnchor) {
			stopOutsidePointerTracking();
			menuMode = 'floating';
			arrowOffset = 0;
			return;
		}
		await tick();
		if (!menuEl || anchor !== currentAnchor) return;
		startOutsidePointerTracking();

		const viewportEl = menuEl.closest('.epub-reader-viewport') as HTMLElement | null;
		if (!viewportEl) return;
		const containerRect = viewportEl.getBoundingClientRect();
		const toRelativeRect = (rect: HighlightClickInfo['rect']) => ({
			top: rect.top - containerRect.top,
			left: rect.left - containerRect.left,
			bottom: rect.bottom - containerRect.top,
			right: rect.right - containerRect.left,
			width: rect.width,
			height: rect.height,
		});
		const position = computeToolbarPosition({
			anchorRect: toRelativeRect(currentAnchor.rect),
			anchorRects: (currentAnchor.rects || []).map((rect) => toRelativeRect(rect)),
			anchorPoint: currentAnchor.anchorPoint
				? {
						x: currentAnchor.anchorPoint.x - containerRect.left,
						y: currentAnchor.anchorPoint.y - containerRect.top,
				  }
				: undefined,
			containerWidth: viewportEl.clientWidth,
			containerHeight: viewportEl.clientHeight,
			toolbarWidth: menuEl.offsetWidth || 320,
			toolbarHeight: menuEl.offsetHeight || 92,
			mobile: isMobileMenu,
			insetBottom: isMobileMenu ? resolveMobileFloatingInsetBottom(mobileDockBottomOffset) : 0,
		});
		menuMode = position.mode;
		posTop = position.top;
		posLeft = position.left;
		isBelowTarget = position.isBelowAnchor;
		arrowOffset = position.arrowOffset;
	}

	$effect(() => {
		const currentAnchor = anchor;
		void candidates;
		untrack(() => stopOutsidePointerTracking());
		if (currentAnchor) {
			void positionMenu();
		} else {
			untrack(() => {
				menuMode = 'floating';
				arrowOffset = 0;
			});
		}
		return () => {
			untrack(() => {
				stopOutsidePointerTracking();
				onPreview(null);
			});
		};
	});
</script>

<div
	class="epub-annotation-disambiguation-menu epub-glass-panel"
	class:visible={anchor !== null && candidates.length > 1}
	class:below-target={isBelowTarget}
	class:mobile-docked={menuMode === 'docked'}
	style={`top: ${posTop}px; left: ${posLeft}px; --toolbar-arrow-offset: ${arrowOffset}px;`}
	bind:this={menuEl}
>
	{#if anchor && candidates.length > 1}
		<div class="annotation-disambiguation-title">
			<span class="annotation-disambiguation-title-icon" use:icon={'mouse-pointer-click'}></span>
			<span>{t('epub.highlightToolbar.chooseAnnotation')}</span>
		</div>
		<div class="annotation-disambiguation-candidates">
			{#each candidates as candidate (candidate.id)}
				<button
					class="clickable-icon action-item annotation-disambiguation-chip"
					style={`--weave-annotation-choice-color: ${candidate.color};`}
					title={candidate.description || candidate.label}
					onmouseenter={() => onPreview(candidate)}
					onfocus={() => onPreview(candidate)}
					onmouseleave={() => onPreview(null)}
					onblur={() => onPreview(null)}
					onclick={() => onSelect(candidate)}
				>
					<span class="annotation-disambiguation-dot"></span>
					<span class="action-label">{candidate.label}</span>
				</button>
			{/each}
		</div>
	{/if}
	<div class="toolbar-arrow"></div>
</div>
