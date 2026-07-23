<script lang="ts">
	import { setIcon, Platform } from 'obsidian';
	import { tick, untrack } from 'svelte';
	import { tr } from '../../utils/i18n';
	import {
		activeSemanticEntries,
		normalizeAnnotationStyle,
		SEMANTIC_COLOR_HEX,
	} from '../../services/epub';
	import type {
		EpubAnnotationSemantic,
		EpubReaderEngine,
		EpubReaderUiMode,
		EpubSemanticSettings,
		HighlightClickInfo,
	} from '../../services/epub';
	import {
		computeToolbarPosition,
		createEventBinder,
		isEventOutsideToolbar,
		resolveMobileFloatingInsetBottom,
	} from './toolbar-positioning';

	interface Props {
		info: HighlightClickInfo | null;
		readerService: EpubReaderEngine;
		readerUiMode?: EpubReaderUiMode;
		semanticSettings?: EpubSemanticSettings | null;
		mobileDockBottomOffset?: number;
		canvasAttached?: boolean;
		canvasActionBusy?: boolean;
		onDelete: (info: HighlightClickInfo) => void;
		onTemporarilyReveal: (info: HighlightClickInfo) => void;
		onChangeSemantic: (info: HighlightClickInfo, semantic: EpubAnnotationSemantic) => void;
		onEditComment: (info: HighlightClickInfo) => void;
		onAddToCanvas?: (info: HighlightClickInfo) => void | Promise<void>;
		onRemoveFromCanvas?: (info: HighlightClickInfo) => void | Promise<void>;
		onCopyText: (info: HighlightClickInfo) => void;
		onDismiss: () => void;
	}

	let {
		info,
		readerService,
		readerUiMode = 'standard',
		semanticSettings = null,
		mobileDockBottomOffset = 0,
		canvasAttached = false,
		canvasActionBusy = false,
		onDelete,
		onTemporarilyReveal,
		onChangeSemantic,
		onEditComment,
		onAddToCanvas,
		onRemoveFromCanvas,
		onCopyText,
		onDismiss
	}: Props = $props();
	let t = $derived($tr);

	let toolbarEl: HTMLDivElement | undefined = $state(undefined);
	let posTop = $state(0);
	let posLeft = $state(0);
	let isBelowTarget = $state(false);
	let toolbarMode = $state<'floating' | 'docked'>('floating');
	let arrowOffset = $state(0);
	let teardownOutsidePointerTracking: (() => void) | null = null;
	let teardownViewportTracking: (() => void) | null = null;
	let semanticPickerOpen = $state(false);
	let activeSemantics = $derived(
		semanticSettings?.annotationSemanticsEnabled === false
			? []
			: (activeSemanticEntries(semanticSettings || {}) as EpubAnnotationSemantic[])
	);
	let inlineSemantics = $derived.by(() => {
		if (readerUiMode === 'expert') {
			return activeSemantics;
		}
		const standardIds = new Set(semanticSettings?.standardSemanticIds || []);
		return activeSemantics.filter((semantic) => standardIds.has(semantic.id));
	});
	let isThought = $derived(Boolean(info && info.presentation === 'thought'));
	const isMobileToolbar = Platform.isMobile || activeDocument.body.classList.contains('is-mobile');
	const LEGACY_SEMANTIC_COLOR_ALIASES: Record<string, string> = {
		cyan: 'teal',
		pink: 'magenta',
		gray: 'slate'
	};

	function icon(node: HTMLElement, name: string) {
		setIcon(node, name);
		return {
			update(newName: string) {
				// /skip innerHTML is used to clear the trusted icon container before setIcon rerenders it
				node.replaceChildren();
				setIcon(node, newName);
			}
		};
	}

	function stopOutsidePointerTracking() {
		teardownOutsidePointerTracking?.();
		teardownOutsidePointerTracking = null;
	}

	function startOutsidePointerTracking() {
		if (!info || !toolbarEl || teardownOutsidePointerTracking) return;

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

		teardownOutsidePointerTracking = () => {
			binder.dispose();
		};
	}

	function stopViewportTracking() {
		teardownViewportTracking?.();
		teardownViewportTracking = null;
	}

	function startViewportTracking() {
		if (!toolbarEl || teardownViewportTracking) return;

		const viewportEl = toolbarEl.closest('.epub-reader-viewport') as HTMLElement | null;
		const scrollHost = toolbarEl.closest('.epub-reader-viewport')?.querySelector('.epub-content-wrapper') as HTMLElement | null;
		const visualViewport = window.visualViewport;
		const dismiss = () => onDismiss();
		const binder = createEventBinder();

		binder.bind(scrollHost, 'scroll', dismiss, { passive: true });
		binder.bind(viewportEl, 'scroll', dismiss, { passive: true });
		binder.bind(window, 'resize', dismiss);
		binder.bind(window, 'orientationchange', dismiss);
		binder.bind(visualViewport, 'resize', dismiss);
		binder.bind(visualViewport, 'scroll', dismiss);

		teardownViewportTracking = () => {
			binder.dispose();
		};
	}

	async function positionToolbar() {
		const currentInfo = info;
		if (!currentInfo) {
			stopOutsidePointerTracking();
			stopViewportTracking();
			toolbarMode = 'floating';
			arrowOffset = 0;
			return;
		}

		await tick();
		if (!toolbarEl || info !== currentInfo) return;

		startOutsidePointerTracking();

		const viewportEl = toolbarEl.closest('.epub-reader-viewport') as HTMLElement | null;
		if (!viewportEl) return;

		startViewportTracking();
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
			anchorRect: toRelativeRect(currentInfo.rect),
			anchorRects: (currentInfo.rects || []).map((rect) => toRelativeRect(rect)),
			anchorPoint: currentInfo.anchorPoint
				? {
					x: currentInfo.anchorPoint.x - containerRect.left,
					y: currentInfo.anchorPoint.y - containerRect.top,
				}
				: undefined,
			containerWidth: viewportEl.clientWidth,
			containerHeight: viewportEl.clientHeight,
			toolbarWidth: toolbarEl.offsetWidth || 296,
			toolbarHeight: toolbarEl.offsetHeight || 78,
			mobile: isMobileToolbar,
			insetBottom: isMobileToolbar
				? resolveMobileFloatingInsetBottom(mobileDockBottomOffset)
				: 0,
		});

		toolbarMode = position.mode;
		posTop = position.top;
		posLeft = position.left;
		isBelowTarget = position.isBelowAnchor;
		arrowOffset = position.arrowOffset;
	}

	function handleClickOutside(e: Event) {
		if (info && isEventOutsideToolbar(toolbarEl, e)) {
			onDismiss();
		}
	}

	function getSemanticColorHex(color?: string): string {
		const key = String(color || 'yellow').trim().toLowerCase();
		const canonicalKey = LEGACY_SEMANTIC_COLOR_ALIASES[key] || key;
		return (SEMANTIC_COLOR_HEX as Record<string, string>)[canonicalKey] || (SEMANTIC_COLOR_HEX as Record<string, string>).yellow || '#ffe58a';
	}

	function getSemanticPreviewStyle(semantic: EpubAnnotationSemantic): string {
		return normalizeAnnotationStyle(semantic.style);
	}

	function getSemanticTitle(semantic: EpubAnnotationSemantic): string {
		const label = String(semantic.label || semantic.id || '').trim();
		const description = String(semantic.description || '').trim();
		return description && description !== label ? `${label} - ${description}` : label || description;
	}

	function handleSemanticClick(targetInfo: HighlightClickInfo, semantic: EpubAnnotationSemantic) {
		semanticPickerOpen = false;
		onChangeSemantic(targetInfo, semantic);
	}

	async function toggleSemanticPicker() {
		semanticPickerOpen = !semanticPickerOpen;
		await tick();
		void positionToolbar();
	}

	$effect(() => {
		const currentInfo = info;
		const currentReaderService = readerService;

		void currentReaderService;

		// Avoid tracking local teardown/positioning mutations as effect
		// dependencies, which can otherwise spiral into Svelte update loops.
		untrack(() => {
			stopOutsidePointerTracking();
		});

		if (currentInfo) {
			semanticPickerOpen = false;
			void positionToolbar();
		} else {
			untrack(() => {
				stopViewportTracking();
				toolbarMode = 'floating';
				arrowOffset = 0;
				semanticPickerOpen = false;
			});
		}

		return () => {
			untrack(() => {
				stopOutsidePointerTracking();
				stopViewportTracking();
			});
		};
	});
</script>

<div
	class="epub-highlight-toolbar epub-glass-panel"
	class:visible={info !== null}
	class:below-target={isBelowTarget}
	class:mobile-docked={toolbarMode === 'docked'}
	style={`top: ${posTop}px; left: ${posLeft}px; --toolbar-arrow-offset: ${arrowOffset}px;`}
	bind:this={toolbarEl}
>
	{#if info}
		{#if info.presentation === 'conceal'}
			<div class="highlight-main-row">
				<div class="highlight-actions-shell">
					<div class="toolbar-row actions-row highlight-actions-row concealment-actions">
						<button class="clickable-icon action-item" onclick={() => onTemporarilyReveal(info)} title={t('epub.highlightToolbar.temporaryRevealTitle')}>
							<span class="action-icon" use:icon={'eye'}></span>
							<span class="action-label">{t('epub.highlightToolbar.temporaryReveal')}</span>
						</button>
						<button class="clickable-icon action-item" onclick={() => onCopyText(info)} title={t('epub.highlightToolbar.copyHiddenTitle')}>
							<span class="action-icon" use:icon={'clipboard-copy'}></span>
							<span class="action-label">{t('epub.highlightToolbar.copy')}</span>
						</button>
						<button class="clickable-icon action-item accent concealment-reset" onclick={() => onDelete(info)} title={t('epub.highlightToolbar.resetHiddenTitle')}>
							<span class="action-icon" use:icon={'eye'}></span>
							<span class="action-label">{t('epub.highlightToolbar.resetHidden')}</span>
						</button>
					</div>
				</div>
			</div>
		{:else if isThought}
			<div class="highlight-main-row">
				{#if semanticPickerOpen}
					<div
						class="toolbar-row highlight-semantic-picker-row"
						class:weave-epub-expert-semantic-row={readerUiMode === 'expert'}
						class:weave-epub-standard-semantic-row={readerUiMode !== 'expert'}
					>
						{#each activeSemantics as semantic (semantic.id)}
							<button
								class="clickable-icon action-item weave-epub-semantic-chip"
								class:weave-epub-standard-semantic-btn={readerUiMode !== 'expert'}
								data-semantic-id={semantic.id}
								data-semantic-style={getSemanticPreviewStyle(semantic)}
								style={`--weave-semantic-color: ${getSemanticColorHex(semantic.color)};`}
								title={getSemanticTitle(semantic)}
								aria-label={semantic.label || semantic.id}
								onclick={() => handleSemanticClick(info, semantic)}
							>
								<span class="action-icon weave-epub-semantic-dot"></span>
								<span class="action-label weave-epub-semantic-label">{semantic.label}</span>
							</button>
						{/each}
					</div>
				{/if}
				<div class="highlight-actions-shell">
					<div class="toolbar-row actions-row highlight-actions-row thought-actions-row">
						<button
							class="clickable-icon action-item comment-action thought-edit-action accent"
							onclick={() => onEditComment(info)}
							title={t('epub.highlightToolbar.commentTitle')}
							aria-label={t('epub.highlightToolbar.commentTitle')}
						>
							<span class="action-icon" use:icon={'message-square'}></span>
							<span class="action-label">编辑想法</span>
						</button>
						<button
							class="clickable-icon action-item thought-convert-action"
							class:accent={semanticPickerOpen}
							disabled={activeSemantics.length === 0}
							onclick={() => void toggleSemanticPicker()}
							title="转为标注"
							aria-label="转为标注"
						>
							<span class="action-icon" use:icon={'tags'}></span>
							<span class="action-label">转为标注</span>
						</button>
						<div class="row-divider"></div>
						<button class="clickable-icon action-item delete delete-action" onclick={() => onDelete(info)} title={t('epub.highlightToolbar.deleteTitle')}>
							<span class="action-icon" use:icon={'trash-2'}></span>
							<span class="action-label">删除想法</span>
						</button>
					</div>
				</div>
			</div>
		{:else}
			<div class="highlight-main-row">
				<div
					class="highlight-actions-shell"
					class:highlight-actions-shell--inline-semantics={semanticPickerOpen && inlineSemantics.length > 0}
				>
					{#if semanticPickerOpen && inlineSemantics.length > 0}
						<div
							class="toolbar-row highlight-inline-semantic-row"
							class:weave-epub-expert-semantic-row={readerUiMode === 'expert'}
							class:weave-epub-standard-semantic-row={readerUiMode !== 'expert'}
						>
							{#each inlineSemantics as semantic (semantic.id)}
								<button
									class="clickable-icon action-item weave-epub-semantic-chip"
									class:weave-epub-standard-semantic-btn={readerUiMode !== 'expert'}
									class:accent={semantic.id === info.semanticId}
									data-semantic-id={semantic.id}
									data-semantic-style={getSemanticPreviewStyle(semantic)}
									style={`--weave-semantic-color: ${getSemanticColorHex(semantic.color)};`}
									title={getSemanticTitle(semantic)}
									aria-label={semantic.label || semantic.id}
									onclick={() => handleSemanticClick(info, semantic)}
								>
									<span class="action-icon weave-epub-semantic-dot"></span>
									<span class="action-label weave-epub-semantic-label">{semantic.label}</span>
								</button>
							{/each}
						</div>
					{/if}
					<div class="toolbar-row actions-row highlight-actions-row">
						<button
							class="clickable-icon action-item semantic-action"
							class:accent={semanticPickerOpen}
							disabled={inlineSemantics.length === 0}
							onclick={() => void toggleSemanticPicker()}
							title={t('epub.highlightToolbar.changeSemanticTitle')}
							aria-label={t('epub.highlightToolbar.changeSemanticTitle')}
						>
							<span class="action-icon" use:icon={'tags'}></span>
							<span class="action-label">{t('epub.highlightToolbar.changeSemantic')}</span>
						</button>
						{#if readerUiMode === 'expert'}
							<button class="clickable-icon action-item comment-action" class:accent={Boolean(info.hasCommentDivider)} onclick={() => onEditComment(info)} title={t('epub.highlightToolbar.commentTitle')} aria-label={t('epub.highlightToolbar.commentTitle')}>
								<span class="action-icon" use:icon={'message-square'}></span>
								<span class="action-label">{t('epub.highlightToolbar.comment')}</span>
							</button>
							{#if onAddToCanvas || onRemoveFromCanvas}
								<button
									class="clickable-icon action-item canvas-action"
									class:accent={canvasAttached}
									disabled={canvasActionBusy}
									onclick={() => canvasAttached ? void onRemoveFromCanvas?.(info) : void onAddToCanvas?.(info)}
									title={canvasAttached ? '取消加入脑图' : '加入脑图'}
									aria-label={canvasAttached ? '取消加入脑图' : '加入脑图'}
								>
									<span class="action-icon" use:icon={canvasAttached ? 'unlink' : 'network'}></span>
									<span class="action-label">{canvasAttached ? '取消脑图' : '加入脑图'}</span>
								</button>
							{/if}
						{/if}
						<div class="row-divider"></div>
						<button class="clickable-icon action-item delete delete-action" onclick={() => onDelete(info)} title={t('epub.highlightToolbar.deleteTitle')}>
							<span class="action-icon" use:icon={'trash-2'}></span>
							<span class="action-label">{t('epub.highlightToolbar.delete')}</span>
						</button>
					</div>
				</div>
			</div>
		{/if}
	{/if}

	<div class="toolbar-arrow"></div>
</div>
