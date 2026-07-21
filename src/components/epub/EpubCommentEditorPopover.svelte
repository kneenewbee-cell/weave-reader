<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { tr } from '../../utils/i18n';
	import {
		activeSemanticEntries,
		normalizeAnnotationStyle,
		SEMANTIC_COLOR_HEX,
	} from '../../services/epub';
	import type {
		EpubAnnotationSemantic,
		EpubReaderEngine,
		EpubSemanticSettings,
		HighlightClickInfo,
	} from '../../services/epub';
	import { computeToolbarPosition, TOOLBAR_EDGE_MARGIN } from './toolbar-positioning';
	import {
		bindMobileFloatingViewport,
		computeKeyboardAnchoredFixedRect,
		getVisualViewportLayout,
		isMobileFloatingEditorTarget,
		mapBoundsRelativeToFixed,
	} from '../../utils/mobile-floating-viewport';
	import { applyReadingViewportLock } from '../../utils/mobile-reading-viewport-lock';
	import { domInstanceOf } from '../../utils/dom-instance-of';

	interface Props {
		open: boolean;
		info: HighlightClickInfo | null;
		readerService?: EpubReaderEngine | null;
		boundsEl?: HTMLElement | null;
		readingLockEl?: HTMLElement | null;
		draftText: string;
		saving?: boolean;
		semanticSettings?: EpubSemanticSettings | null;
		onDraftTextChange: (value: string) => void;
		onSave: () => void;
		onConvertToSemantic?: (info: HighlightClickInfo, semantic: EpubAnnotationSemantic) => void | Promise<void>;
		onClose: () => void;
	}

	let {
		open,
		info,
		readerService = null,
		boundsEl = null,
		readingLockEl = null,
		draftText,
		saving = false,
		semanticSettings = null,
		onDraftTextChange,
		onSave,
		onConvertToSemantic,
		onClose,
	}: Props = $props();
	let t = $derived($tr);

	let popoverEl: HTMLDivElement | undefined = $state(undefined);
	let textareaEl: HTMLTextAreaElement | undefined = $state(undefined);
	let posTop = $state(0);
	let posLeft = $state(0);
	let popoverWidth = $state(340);
	let preferBelow = $state(true);
	let useFixedLayer = $state(false);
	let keyboardDocked = $state(false);
	let mobileMode = $state(false);
	let pendingFocusFrame = 0;
	let pendingFocusTimeout = 0;
	let hasFocusedCurrentSession = false;
	let teardownViewportTracking: (() => void) | null = null;
	let readingLockCleanup: (() => void) | null = null;
	let convertPickerOpen = $state(false);
	let activeSemantics = $derived(
		semanticSettings?.annotationSemanticsEnabled === false
			? []
			: (activeSemanticEntries(semanticSettings || {}) as EpubAnnotationSemantic[])
	);
	let canConvertThought = $derived(
		Boolean(info && info.presentation === 'thought' && onConvertToSemantic && activeSemantics.length > 0)
	);

	const KEYBOARD_ACTIVE_BODY_CLASS = 'epub-comment-keyboard-active';

	function shouldLockReadingSurface(): boolean {
		if (!mobileMode || !open || !readingLockEl) {
			return false;
		}
		const layout = getVisualViewportLayout();
		return layout.keyboardVisible || activeDocument.activeElement === textareaEl;
	}

	function syncReadingSurfaceLock() {
		const shouldLock = shouldLockReadingSurface();
		activeDocument.body.classList.toggle(KEYBOARD_ACTIVE_BODY_CLASS, shouldLock);

		if (!readingLockEl) {
			releaseReadingSurfaceLock();
			return;
		}

		if (shouldLock) {
			if (!readingLockCleanup) {
				readingLockCleanup = applyReadingViewportLock(readingLockEl);
			}
			return;
		}

		releaseReadingSurfaceLock();
	}

	function releaseReadingSurfaceLock() {
		activeDocument.body.classList.remove(KEYBOARD_ACTIVE_BODY_CLASS);
		readingLockCleanup?.();
		readingLockCleanup = null;
	}

	function portalToBody(node: HTMLElement) {
		if (!activeDocument.body) {
			return;
		}

		activeDocument.body.appendChild(node);

		return {
			destroy() {
				if (node.isConnected) {
					node.remove();
				}
			},
		};
	}

	function optionalPortal(node: HTMLElement, enabled: boolean) {
		let cleanup: (() => void) | undefined;

		const sync = (shouldPortal: boolean) => {
			cleanup?.();
			cleanup = undefined;
			if (shouldPortal) {
				const teardown = portalToBody(node);
				cleanup = () => teardown?.destroy();
			}
		};

		sync(enabled);

		return {
			update(nextEnabled: boolean) {
				sync(nextEnabled);
			},
			destroy() {
				cleanup?.();
			},
		};
	}

	function clearPendingFocus() {
		if (pendingFocusFrame) {
			window.cancelAnimationFrame(pendingFocusFrame);
			pendingFocusFrame = 0;
		}
		if (pendingFocusTimeout) {
			window.clearTimeout(pendingFocusTimeout);
			pendingFocusTimeout = 0;
		}
	}

	function getFallbackBoundsRect() {
		return boundsEl?.getBoundingClientRect?.() || {
			top: 0,
			left: 0,
			right: window.innerWidth || 0,
			bottom: window.innerHeight || 0,
			width: window.innerWidth || 0,
			height: window.innerHeight || 0,
		};
	}

	function applyFixedRect(rect: { top: number; left: number; width: number }) {
		posTop = rect.top;
		posLeft = rect.left;
		popoverWidth = rect.width;
	}

	function focusTextareaIfNeeded() {
		if (!textareaEl || saving) {
			return;
		}
		if (activeDocument.activeElement === textareaEl) {
			hasFocusedCurrentSession = true;
			return;
		}

		const applyFocus = () => {
			if (!open || !textareaEl || saving) {
				return;
			}
			try {
				textareaEl.focus({ preventScroll: true });
			} catch {
				textareaEl.focus();
			}
			textareaEl.setSelectionRange(draftText.length, draftText.length);
			hasFocusedCurrentSession = true;
		};

		if (mobileMode) {
			if (hasFocusedCurrentSession) {
				return;
			}
			clearPendingFocus();
			pendingFocusFrame = window.requestAnimationFrame(() => {
				pendingFocusFrame = 0;
				pendingFocusTimeout = window.setTimeout(() => {
					pendingFocusTimeout = 0;
					applyFocus();
				}, 40);
			});
			return;
		}

		applyFocus();
	}

	async function positionPopover() {
		if (!open || !info) {
			mobileMode = false;
			useFixedLayer = false;
			keyboardDocked = false;
			clearPendingFocus();
			hasFocusedCurrentSession = false;
			releaseReadingSurfaceLock();
			return;
		}

		await tick();
		mobileMode = isMobileFloatingEditorTarget();
		useFixedLayer = mobileMode;

		if (!popoverEl) {
			return;
		}

		const height = popoverEl.offsetHeight || 220;
		const layout = getVisualViewportLayout();

		if (mobileMode && layout.keyboardVisible) {
			applyFixedRect(computeKeyboardAnchoredFixedRect(height, TOOLBAR_EDGE_MARGIN, layout));
			keyboardDocked = true;
			preferBelow = false;
			focusTextareaIfNeeded();
			return;
		}

		keyboardDocked = false;

		const currentInfo = readerService?.getHighlightClickInfo?.(
			info.cfiRange,
			info.interactionTarget || 'highlight'
		) || info;
		const boundsRect = getFallbackBoundsRect();
		const width = mobileMode
			? Math.max(220, boundsRect.width - TOOLBAR_EDGE_MARGIN * 2)
			: Math.min(360, Math.max(260, (boundsRect.width || window.innerWidth || 0) - 24));
		const toRelativeRect = (rect: HighlightClickInfo['rect']) => ({
			top: rect.top - boundsRect.top,
			left: rect.left - boundsRect.left,
			bottom: rect.bottom - boundsRect.top,
			right: rect.right - boundsRect.left,
			width: rect.width,
			height: rect.height,
		});
		const position = computeToolbarPosition({
			anchorRect: toRelativeRect(currentInfo.rect),
			anchorRects: (currentInfo.rects || []).map((rect) => toRelativeRect(rect)),
			anchorPoint: currentInfo.anchorPoint
				? {
					x: currentInfo.anchorPoint.x - boundsRect.left,
					y: currentInfo.anchorPoint.y - boundsRect.top,
				}
				: undefined,
			containerWidth: boundsRect.width || window.innerWidth || 0,
			containerHeight: boundsRect.height || window.innerHeight || 0,
			toolbarWidth: width,
			toolbarHeight: height,
			mobile: mobileMode,
			preferredSide: 'bottom',
			align: 'center',
		});

		if (mobileMode && boundsEl) {
			applyFixedRect(mapBoundsRelativeToFixed(position.top, position.left, width, boundsEl));
		} else {
			popoverWidth = width;
			posTop = position.top;
			posLeft = position.left;
		}

		preferBelow = position.isBelowAnchor;
		focusTextareaIfNeeded();
		syncReadingSurfaceLock();
	}

	function startViewportTracking() {
		stopViewportTracking();
		if (!mobileMode) {
			return;
		}
		teardownViewportTracking = bindMobileFloatingViewport(() => {
			syncReadingSurfaceLock();
			void positionPopover();
		});
	}

	function stopViewportTracking() {
		teardownViewportTracking?.();
		teardownViewportTracking = null;
		releaseReadingSurfaceLock();
	}

	function handlePointerDownOutside(event: MouseEvent) {
		if (!open || !popoverEl || mobileMode) {
			return;
		}
		if (popoverEl.contains(event.target as Node)) {
			return;
		}
		onClose();
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
			return;
		}
		if (
			(event.metaKey || event.ctrlKey)
			&& event.key === 'Enter'
			&& textareaEl
			&& activeDocument.activeElement === textareaEl
		) {
			event.preventDefault();
			onSave();
		}
	}

	function handleTextareaFocus() {
		if (!mobileMode) {
			return;
		}
		syncReadingSurfaceLock();
		void positionPopover();
		window.setTimeout(() => {
			syncReadingSurfaceLock();
			void positionPopover();
		}, 120);
	}

	function getSemanticColorHex(color?: string): string {
		const key = String(color || 'yellow').trim().toLowerCase();
		const canonicalKey = key === 'cyan' ? 'teal' : key === 'pink' ? 'magenta' : key === 'gray' ? 'slate' : key;
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

	function handleConvertSemanticClick(semantic: EpubAnnotationSemantic) {
		if (!info) {
			return;
		}
		convertPickerOpen = false;
		void onConvertToSemantic?.(info, semantic);
	}

	$effect(() => {
		const currentOpen = open;
		const currentInfo = info;
		const currentReaderService = readerService;
		const currentBoundsEl = boundsEl;
		void currentInfo;
		void currentReaderService;
		void currentBoundsEl;
		untrack(() => {
			mobileMode = currentOpen ? isMobileFloatingEditorTarget() : false;
		});
		if (!currentOpen) {
			untrack(() => {
				clearPendingFocus();
				hasFocusedCurrentSession = false;
				convertPickerOpen = false;
				stopViewportTracking();
			});
			return;
		}
		untrack(() => {
			if (mobileMode) {
				startViewportTracking();
			} else {
				stopViewportTracking();
			}
			void positionPopover();
		});
	});

	function handleWindowLayoutChange() {
		void positionPopover();
	}

	onMount(() => {
		activeDocument.addEventListener('mousedown', handlePointerDownOutside);
		activeDocument.addEventListener('touchstart', handlePointerDownOutside as unknown as EventListener);
		window.addEventListener('resize', handleWindowLayoutChange);
		window.addEventListener('scroll', handleWindowLayoutChange, true);
		return () => {
			clearPendingFocus();
			stopViewportTracking();
			activeDocument.removeEventListener('mousedown', handlePointerDownOutside);
			activeDocument.removeEventListener('touchstart', handlePointerDownOutside as unknown as EventListener);
			window.removeEventListener('resize', handleWindowLayoutChange);
			window.removeEventListener('scroll', handleWindowLayoutChange, true);
		};
	});
</script>

{#if open && info}
	{@const isMobileEditor = isMobileFloatingEditorTarget()}
	<div
		class="epub-comment-editor epub-glass-panel"
		class:epub-comment-editor--below={preferBelow}
		class:epub-comment-editor--mobile={isMobileEditor}
		class:epub-comment-editor--viewport-fixed={useFixedLayer}
		class:epub-comment-editor--keyboard-docked={keyboardDocked}
		style={`top: ${posTop}px; left: ${posLeft}px; width: ${popoverWidth}px;`}
		bind:this={popoverEl}
		tabindex="-1"
		onkeydown={handleKeydown}
		use:optionalPortal={isMobileEditor}
	>
		<textarea
			class="epub-comment-editor__textarea"
			bind:this={textareaEl}
			value={draftText}
			placeholder={t('epub.reader.commentEditor.placeholder')}
			aria-label={t('epub.reader.commentEditor.ariaLabel')}
			disabled={saving}
			onfocus={handleTextareaFocus}
			oninput={(event) => onDraftTextChange((event.currentTarget as HTMLTextAreaElement).value)}
		></textarea>
		{#if canConvertThought}
			<div class="epub-comment-editor__convert">
				<button
					type="button"
					class="epub-comment-editor__convert-toggle"
					class:active={convertPickerOpen}
					disabled={saving}
					onclick={() => convertPickerOpen = !convertPickerOpen}
				>转为标注</button>
				{#if convertPickerOpen}
					<div class="epub-comment-editor__semantic-row" aria-label="转换为语义标注">
						{#each activeSemantics as semantic (semantic.id)}
							<button
								type="button"
								class="epub-comment-editor__semantic-chip"
								data-semantic-style={getSemanticPreviewStyle(semantic)}
								style={`--weave-semantic-color: ${getSemanticColorHex(semantic.color)};`}
								title={getSemanticTitle(semantic)}
								aria-label={semantic.label || semantic.id}
								disabled={saving}
								onclick={() => handleConvertSemanticClick(semantic)}
							>
								<span class="epub-comment-editor__semantic-dot"></span>
								<span class="epub-comment-editor__semantic-label">{semantic.label}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
		<div class="epub-comment-editor__actions">
			<button type="button" class="epub-comment-editor__cancel" disabled={saving} onclick={onClose}>{t('epub.reader.commentEditor.cancel')}</button>
			<button type="button" class="mod-cta" disabled={saving} onclick={onSave}>{saving ? t('epub.reader.commentEditor.saving') : t('epub.reader.commentEditor.save')}</button>
		</div>
	</div>
{/if}

<style>
	.epub-comment-editor {
		position: absolute;
		z-index: 1200;
		display: flex;
		flex-direction: column;
		gap: var(--size-4-2);
		padding: var(--size-4-3);
		border-radius: var(--modal-radius, var(--radius-l));
		border: 1px solid color-mix(in srgb, var(--background-modifier-border) 74%, transparent);
		background: color-mix(in srgb, var(--background-primary) 94%, var(--background-secondary) 6%);
		box-shadow: var(--shadow-s);
	}

	.epub-comment-editor--viewport-fixed {
		position: fixed;
		z-index: calc(var(--epub-z-popover, 300) + 64);
	}

	.epub-comment-editor--mobile {
		max-width: none;
	}

	.epub-comment-editor--keyboard-docked {
		box-shadow: var(--shadow-l);
	}

	.epub-comment-editor__textarea {
		min-height: 116px;
		max-height: 220px;
		resize: vertical;
		padding: var(--size-4-3);
		border-radius: var(--input-radius);
		border: 1px solid color-mix(in srgb, var(--background-modifier-border) 78%, transparent);
		background: color-mix(in srgb, var(--background-primary) 96%, transparent);
		color: var(--text-normal);
		font-size: var(--font-ui-small);
		line-height: 1.7;
	}

	.epub-comment-editor--mobile .epub-comment-editor__textarea,
	.epub-comment-editor--keyboard-docked .epub-comment-editor__textarea {
		width: 100%;
		min-height: min(180px, 34vh);
		max-height: min(240px, 42vh);
		resize: none;
		box-sizing: border-box;
	}

	.epub-comment-editor__textarea::placeholder {
		color: var(--text-faint);
	}

	.epub-comment-editor__convert {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-2);
	}

	.epub-comment-editor__convert-toggle {
		align-self: flex-start;
		border: 1px solid color-mix(in srgb, var(--text-normal) 36%, transparent);
		border-radius: var(--button-radius, 6px);
		background: color-mix(in srgb, var(--background-primary) 92%, transparent);
		color: var(--text-normal);
		font-size: var(--font-ui-smaller);
		box-shadow: none;
	}

	.epub-comment-editor__convert-toggle.active {
		background: color-mix(in srgb, var(--text-normal) 10%, var(--background-primary));
		border-color: color-mix(in srgb, var(--text-normal) 58%, transparent);
	}

	.epub-comment-editor__semantic-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		max-height: 6.6rem;
		overflow: auto;
		padding: 0.15rem 0;
	}

	.epub-comment-editor__semantic-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 1.75rem;
		max-width: 10rem;
		padding: 0.2rem 0.45rem;
		border: 1px solid color-mix(in srgb, var(--weave-semantic-color) 34%, var(--background-modifier-border));
		border-radius: 6px;
		background: color-mix(in srgb, var(--weave-semantic-color) 12%, var(--background-primary));
		color: var(--text-normal);
		box-shadow: none;
		font-size: var(--font-ui-smaller);
	}

	.epub-comment-editor__semantic-chip:hover,
	.epub-comment-editor__semantic-chip:focus-visible {
		border-color: color-mix(in srgb, var(--weave-semantic-color) 72%, var(--background-modifier-border));
		background: color-mix(in srgb, var(--weave-semantic-color) 18%, var(--background-primary));
	}

	.epub-comment-editor__semantic-dot {
		width: 0.66rem;
		height: 0.66rem;
		border-radius: 999px;
		background: var(--weave-semantic-color);
		flex: 0 0 auto;
	}

	.epub-comment-editor__semantic-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.epub-comment-editor--mobile .epub-comment-editor__textarea:focus {
		animation: epub-comment-editor-ios-keyboard-fix 0.1s forwards;
	}

	@keyframes epub-comment-editor-ios-keyboard-fix {
		from { opacity: 0.999; }
		to { opacity: 1; }
	}

	.epub-comment-editor__actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--size-4-2);
	}

	.epub-comment-editor__actions button {
		border: 0;
		box-shadow: none;
	}

	.epub-comment-editor__cancel {
		border: 0;
		background: transparent;
		color: var(--text-muted);
		padding: 0;
	}

	@media (max-width: 768px) {
		.epub-comment-editor:not(.epub-comment-editor--mobile) {
			left: 12px !important;
			right: 12px;
			width: auto !important;
			max-width: none;
		}
	}
</style>
