<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { setIcon } from 'obsidian';
	import { tr } from '../../utils/i18n';
	import { domInstanceOf } from '../../utils/dom-instance-of';
	import {
		isInteractiveFormTarget,
		shouldIgnoreEpubReaderShortcut,
	} from '../../utils/epub-reader-keyboard-guards';
	import type {
		EpubParagraphModeSurfaceStyle,
		EpubParagraphModeTransitionStyle,
		ReaderParagraph,
	} from '../../services/epub';

	type OverlaySelectionInfo = {
		text: string;
		startOffset: number;
		endOffset: number;
		rect: DOMRect;
		rects: DOMRect[];
		clear: () => void;
	};

	interface Props {
		active?: boolean;
		paragraph: ReaderParagraph | null;
		fontScale?: number;
		surfaceStyle?: EpubParagraphModeSurfaceStyle;
		transitionStyle?: EpubParagraphModeTransitionStyle;
		immersive?: boolean;
		randomReadingActive?: boolean;
		currentIndex?: number;
		totalCount?: number;
		onFontScaleChange?: (scale: number) => void | Promise<void>;
		onSurfaceStyleChange?: (style: EpubParagraphModeSurfaceStyle) => void | Promise<void>;
		onTransitionStyleChange?: (style: EpubParagraphModeTransitionStyle) => void | Promise<void>;
		onPrev?: () => void | Promise<void>;
		onNext?: () => void | Promise<void>;
		onFootnoteActivate?: (info: {
			href: string;
			label?: string;
			pinned?: boolean;
			rect?: DOMRect;
		}) => void | Promise<void>;
		onHighlightActivate?: (info: {
			cfiRange: string;
			rect: DOMRect;
			rects: DOMRect[];
		}) => void;
		onFootnoteDismiss?: (options?: { unpin?: boolean }) => void;
		onToggleImmersive?: () => void;
		onRandomParagraph?: () => void | Promise<void>;
		onClose?: () => void;
		onSelectionChange?: (info: OverlaySelectionInfo | null) => void;
		onNavMetricsChange?: (metrics: { bottomDockOffset: number }) => void;
	}

	let {
		active = false,
		paragraph,
		fontScale = 100,
		surfaceStyle = 'spotlight',
		transitionStyle = 'settle',
		immersive = false,
		randomReadingActive = false,
		currentIndex = 0,
		totalCount = 0,
		onFontScaleChange,
		onSurfaceStyleChange,
		onTransitionStyleChange,
		onPrev,
		onNext,
		onFootnoteActivate,
		onHighlightActivate,
		onFootnoteDismiss,
		onToggleImmersive,
		onRandomParagraph,
		onClose,
		onSelectionChange,
		onNavMetricsChange,
	}: Props = $props();

	let t = $derived($tr);
	let overlayEl = $state<HTMLElement | null>(null);
	let bodyEl = $state<HTMLElement | null>(null);
	let textViewportEl = $state<HTMLElement | null>(null);
	let textEl = $state<HTMLElement | null>(null);
	let lastWheelTurnAt = 0;
	let pinnedFootnoteKey = $state('');
	let subpageIndex = $state(0);
	let subpageCount = $state(1);
	let suppressScrollSync = false;
	let settingsPanelOpen = $state(false);
	let settingsButtonEl = $state<HTMLElement | null>(null);
	let settingsPanelEl = $state<HTMLElement | null>(null);
	let navSlotEl = $state<HTMLElement | null>(null);
	let renderedParagraph = $state<ReaderParagraph | null>(null);
	let renderedParagraphIndex = $state(0);
	let paragraphTransitionDirection = $state<'forward' | 'backward'>('forward');
	let paragraphTransitioning = $state(false);
	let paragraphTransitionToken = $state(0);

	function icon(node: HTMLElement, name: string) {
		setIcon(node, name);
		return {
			update(nextName: string) {
				node.replaceChildren();
				setIcon(node, nextName);
			},
		};
	}

	function clearSelection(): void {
		const selection = window.getSelection();
		if (selection && textEl && textEl.contains(selection.anchorNode)) {
			selection.removeAllRanges();
		}
		onSelectionChange?.(null);
	}

	function getFootnoteAnchorKey(anchor: HTMLAnchorElement | null): string {
		if (!anchor) {
			return '';
		}
		const href = String(anchor.getAttribute('data-footnote-href') || anchor.getAttribute('href') || '').trim();
		const label = String(anchor.getAttribute('data-footnote-label') || anchor.textContent || '')
			.replace(/\s+/g, ' ')
			.trim();
		return `${href}::${label}`;
	}

	function buildFootnoteActivationPayload(anchor: HTMLAnchorElement, pinned: boolean) {
		const rect = anchor.getBoundingClientRect();
		return {
			href: String(anchor.getAttribute('data-footnote-href') || anchor.getAttribute('href') || '').trim(),
			label: String(anchor.getAttribute('data-footnote-label') || anchor.textContent || '').trim(),
			pinned,
			rect: new DOMRect(rect.left, rect.top, rect.width, rect.height),
		};
	}

	function getAnnotationRects(element: HTMLElement): DOMRect[] {
		const doc = element.ownerDocument;
		if (!doc) {
			const rect = element.getBoundingClientRect();
			return rect.width || rect.height ? [new DOMRect(rect.left, rect.top, rect.width, rect.height)] : [];
		}
		const range = doc.createRange();
		range.selectNodeContents(element);
		const rects = Array.from(range.getClientRects()).map(
			(rect) => new DOMRect(rect.left, rect.top, rect.width, rect.height)
		);
		if (rects.length > 0) {
			return rects;
		}
		const rect = element.getBoundingClientRect();
		return rect.width || rect.height ? [new DOMRect(rect.left, rect.top, rect.width, rect.height)] : [];
	}

	function getProgressLabel(): string {
		const paragraphLabel = `${currentIndex + 1} / ${Math.max(totalCount, 1)}`;
		return subpageCount > 1
			? `${paragraphLabel} · ${subpageIndex + 1} / ${subpageCount}`
			: paragraphLabel;
	}

	function clampSubpageIndex(index: number): number {
		return Math.max(0, Math.min(index, Math.max(subpageCount - 1, 0)));
	}

	const surfaceOptions: Array<{
		value: EpubParagraphModeSurfaceStyle;
		labelKey: string;
	}> = [
		{ value: 'spotlight', labelKey: 'epub.reader.paragraphMode.surfaceStyleSpotlight' },
		{ value: 'blend', labelKey: 'epub.reader.paragraphMode.surfaceStyleBlend' },
		{ value: 'dashed', labelKey: 'epub.reader.paragraphMode.surfaceStyleDashed' },
	];

	const transitionOptions: Array<{
		value: EpubParagraphModeTransitionStyle;
		labelKey: string;
	}> = [
		{ value: 'steady', labelKey: 'epub.reader.paragraphMode.transitionStyleSteady' },
		{ value: 'fade', labelKey: 'epub.reader.paragraphMode.transitionStyleFade' },
		{ value: 'settle', labelKey: 'epub.reader.paragraphMode.transitionStyleSettle' },
		{ value: 'slide', labelKey: 'epub.reader.paragraphMode.transitionStyleSlide' },
	];
	function clampFontScale(value: number): number {
		return Math.max(85, Math.min(135, Math.round(value)));
	}

	function toggleSettingsPanel(): void {
		settingsPanelOpen = !settingsPanelOpen;
	}

	function closeSettingsPanel(): void {
		settingsPanelOpen = false;
	}

	function selectTransitionStyle(style: EpubParagraphModeTransitionStyle): void {
		if (style === transitionStyle) {
			return;
		}
		void onTransitionStyleChange?.(style);
	}

	function emitNavMetrics(): void {
		onNavMetricsChange?.({
			bottomDockOffset: active && navSlotEl ? navSlotEl.offsetHeight : 0,
		});
	}

	function registerCurrentText(node: HTMLElement): { destroy: () => void } {
		textEl = node;
		return {
			destroy: () => {
				if (textEl === node) {
					textEl = null;
				}
			},
		};
	}

	function syncSubpageMetrics(preserveProgress = true): void {
		if (!textViewportEl || !textEl) {
			subpageCount = 1;
			subpageIndex = 0;
			return;
		}
		const pageHeight = textViewportEl.clientHeight;
		if (pageHeight <= 0) {
			subpageCount = 1;
			subpageIndex = 0;
			return;
		}
		const currentProgress = preserveProgress && subpageCount > 1
			? subpageIndex / Math.max(subpageCount - 1, 1)
			: 0;
		const nextCount = Math.max(1, Math.ceil(textEl.scrollHeight / pageHeight));
		subpageCount = nextCount;
		subpageIndex = nextCount > 1
			? clampSubpageIndex(Math.round(currentProgress * Math.max(nextCount - 1, 0)))
			: 0;
		syncViewportScrollToSubpage('auto');
	}

	function syncViewportScrollToSubpage(behavior: ScrollBehavior = 'smooth'): void {
		if (!textViewportEl) {
			return;
		}
		const pageHeight = textViewportEl.clientHeight;
		if (pageHeight <= 0) {
			return;
		}
		suppressScrollSync = true;
		textViewportEl.scrollTo({
			top: clampSubpageIndex(subpageIndex) * pageHeight,
			behavior,
		});
		window.setTimeout(() => {
			suppressScrollSync = false;
		}, behavior === 'smooth' ? 180 : 0);
	}

	function updateSubpageIndexFromScroll(): void {
		if (!textViewportEl || suppressScrollSync) {
			return;
		}
		const pageHeight = textViewportEl.clientHeight;
		if (pageHeight <= 0) {
			return;
		}
		subpageIndex = clampSubpageIndex(Math.round(textViewportEl.scrollTop / pageHeight));
	}

	async function navigateWithinParagraph(direction: -1 | 1): Promise<boolean> {
		if (subpageCount <= 1) {
			return false;
		}
		const targetIndex = subpageIndex + direction;
		if (targetIndex < 0 || targetIndex >= subpageCount) {
			return false;
		}
		clearSelection();
		subpageIndex = targetIndex;
		syncViewportScrollToSubpage();
		return true;
	}

	function handleViewportScroll(): void {
		updateSubpageIndexFromScroll();
	}

	function isSelectionInsideParagraph(selection: Selection): boolean {
		if (!textEl || !selection.rangeCount) {
			return false;
		}
		const range = selection.getRangeAt(0);
		return textEl.contains(range.commonAncestorContainer);
	}

	function syncSelection(): void {
		if (!active || !paragraph || !textEl) {
			onSelectionChange?.(null);
			return;
		}
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || !selection.rangeCount || !isSelectionInsideParagraph(selection)) {
			onSelectionChange?.(null);
			return;
		}

		const range = selection.getRangeAt(0);
		const selectedText = selection.toString().trim();
		if (!selectedText) {
			onSelectionChange?.(null);
			return;
		}

		const prefixRange = (textEl.ownerDocument ?? activeDocument).createRange();
		prefixRange.selectNodeContents(textEl);
		prefixRange.setEnd(range.startContainer, range.startOffset);
		const startOffset = prefixRange.toString().length;
		const endOffset = startOffset + range.toString().length;
		const rect = range.getBoundingClientRect();
		const rects = Array.from(range.getClientRects()).map(
			(item) => new DOMRect(item.left, item.top, item.width, item.height)
		);
		if (!(rect.width || rect.height) && rects.length === 0) {
			onSelectionChange?.(null);
			return;
		}

		onSelectionChange?.({
			text: selectedText,
			startOffset,
			endOffset,
			rect: rect.width || rect.height ? new DOMRect(rect.left, rect.top, rect.width, rect.height) : rects[0],
			rects: rects.length ? rects : [new DOMRect(rect.left, rect.top, rect.width, rect.height)],
			clear: clearSelection,
		});
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!active || !overlayEl || !isEventWithinOverlay(event)) {
			return;
		}
		if (shouldIgnoreEpubReaderShortcut(event)) {
			return;
		}
		if (event.key === 'Escape') {
			if (settingsPanelOpen) {
				closeSettingsPanel();
				return;
			}
			clearSelection();
			onClose?.();
			return;
		}
		if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
			event.preventDefault();
			void navigateWithinParagraph(-1).then((handled) => {
				if (!handled) {
					clearSelection();
					void onPrev?.();
				}
			});
			return;
		}
		if (event.key === 'ArrowRight' || event.key === 'PageDown') {
			event.preventDefault();
			void navigateWithinParagraph(1).then((handled) => {
				if (!handled) {
					clearSelection();
					void onNext?.();
				}
			});
		}
	}

	function isEventWithinOverlay(event: Event): boolean {
		if (!overlayEl) {
			return false;
		}
		const target = event.target;
		if (!domInstanceOf(target, Node)) {
			return false;
		}
		return overlayEl === target || overlayEl.contains(target);
	}

	function focusOverlaySurface(): void {
		if (!active || !overlayEl) {
			return;
		}
		if (isInteractiveFormTarget(activeDocument.activeElement)) {
			return;
		}
		try {
			overlayEl.focus({ preventScroll: true });
		} catch {
			overlayEl.focus();
		}
	}

	function handleWheel(event: WheelEvent): void {
		if (!active) {
			return;
		}
		if (Math.abs(event.deltaY) < 10 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
			return;
		}
		const now = Date.now();
		if (now - lastWheelTurnAt < 240) {
			event.preventDefault();
			return;
		}
		lastWheelTurnAt = now;
		event.preventDefault();
		if (event.deltaY > 0) {
			void navigateWithinParagraph(1).then((handled) => {
				if (!handled) {
					clearSelection();
					void onNext?.();
				}
			});
			return;
		}
		void navigateWithinParagraph(-1).then((handled) => {
			if (!handled) {
				clearSelection();
				void onPrev?.();
			}
		});
	}

	function handleBodyClick(event: MouseEvent): void {
		const target = event.target as HTMLElement | null;
		const footnoteAnchor = target?.closest?.('.weave-paragraph-footnote') as HTMLAnchorElement | null;
		if (!footnoteAnchor) {
			const annotationEl = target?.closest?.('.weave-paragraph-annotation') as HTMLElement | null;
			if (annotationEl) {
				const cfiRange = String(annotationEl.getAttribute('data-cfi-range') || '').trim();
				const rects = getAnnotationRects(annotationEl);
				const rect = rects[0];
				if (cfiRange && rect) {
					event.preventDefault();
					event.stopPropagation();
					clearSelection();
					onHighlightActivate?.({ cfiRange, rect, rects });
					return;
				}
			}
			if (pinnedFootnoteKey) {
				pinnedFootnoteKey = '';
				onFootnoteDismiss?.({ unpin: true });
			}
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		clearSelection();
		pinnedFootnoteKey = getFootnoteAnchorKey(footnoteAnchor);
		void onFootnoteActivate?.(buildFootnoteActivationPayload(footnoteAnchor, true));
	}

	function handleBodyMouseOver(event: MouseEvent): void {
		if (pinnedFootnoteKey) {
			return;
		}
		const target = event.target as HTMLElement | null;
		const footnoteAnchor = target?.closest?.('.weave-paragraph-footnote') as HTMLAnchorElement | null;
		if (!footnoteAnchor) {
			return;
		}
		void onFootnoteActivate?.(buildFootnoteActivationPayload(footnoteAnchor, false));
	}

	function handleBodyMouseOut(event: MouseEvent): void {
		if (pinnedFootnoteKey) {
			return;
		}
		const target = event.target as HTMLElement | null;
		const footnoteAnchor = target?.closest?.('.weave-paragraph-footnote') as HTMLAnchorElement | null;
		if (!footnoteAnchor) {
			return;
		}
		const relatedTarget = event.relatedTarget as HTMLElement | null;
		const relatedAnchor = relatedTarget?.closest?.('.weave-paragraph-footnote') as HTMLAnchorElement | null;
		if (relatedAnchor === footnoteAnchor) {
			return;
		}
		onFootnoteDismiss?.();
	}

	function handleBodyFocusIn(event: FocusEvent): void {
		if (pinnedFootnoteKey) {
			return;
		}
		const target = event.target as HTMLElement | null;
		const footnoteAnchor = target?.closest?.('.weave-paragraph-footnote') as HTMLAnchorElement | null;
		if (!footnoteAnchor) {
			return;
		}
		void onFootnoteActivate?.(buildFootnoteActivationPayload(footnoteAnchor, false));
	}

	function handleBodyFocusOut(event: FocusEvent): void {
		if (pinnedFootnoteKey) {
			return;
		}
		const target = event.target as HTMLElement | null;
		const footnoteAnchor = target?.closest?.('.weave-paragraph-footnote') as HTMLAnchorElement | null;
		if (!footnoteAnchor) {
			return;
		}
		const relatedTarget = event.relatedTarget as HTMLElement | null;
		const relatedAnchor = relatedTarget?.closest?.('.weave-paragraph-footnote') as HTMLAnchorElement | null;
		if (relatedAnchor === footnoteAnchor) {
			return;
		}
		onFootnoteDismiss?.();
	}

	$effect(() => {
		if (!active) {
			untrack(() => {
				pinnedFootnoteKey = '';
				subpageIndex = 0;
				subpageCount = 1;
				closeSettingsPanel();
				renderedParagraph = paragraph;
				renderedParagraphIndex = currentIndex;
				paragraphTransitioning = false;
				paragraphTransitionToken += 1;
				clearSelection();
				onFootnoteDismiss?.({ unpin: true });
				emitNavMetrics();
			});
		}
	});

	$effect(() => {
		const currentNavSlotEl = navSlotEl;
		const activeState = active;
		void activeState;
		queueMicrotask(() => {
			emitNavMetrics();
		});
		if (!currentNavSlotEl) {
			return;
		}
		const resizeObserver = new ResizeObserver(() => {
			emitNavMetrics();
		});
		resizeObserver.observe(currentNavSlotEl);
		return () => {
			resizeObserver.disconnect();
		};
	});

	$effect(() => {
		const nextParagraph = paragraph;
		const nextParagraphId = nextParagraph?.id || '';
		const fontScaleValue = fontScale;
		const immersiveState = immersive;
		const activeState = active;
		const nextIndex = currentIndex;
		void nextParagraphId;
		void fontScaleValue;
		void immersiveState;
		void activeState;
		queueMicrotask(() => {
			if (!activeState || !nextParagraphId) {
				return;
			}
			if (!renderedParagraph || renderedParagraph.id === nextParagraphId) {
				renderedParagraph = nextParagraph;
				renderedParagraphIndex = nextIndex;
				paragraphTransitioning = false;
				subpageIndex = 0;
				syncSubpageMetrics(false);
				return;
			}
			paragraphTransitionDirection = nextIndex >= renderedParagraphIndex ? 'forward' : 'backward';
			renderedParagraph = nextParagraph;
			renderedParagraphIndex = nextIndex;
			paragraphTransitioning = true;
			paragraphTransitionToken += 1;
			const currentToken = paragraphTransitionToken;
			clearSelection();
			subpageIndex = 0;
			syncSubpageMetrics(false);
			window.setTimeout(() => {
				if (currentToken !== paragraphTransitionToken) {
					return;
				}
				paragraphTransitioning = false;
			}, 170);
		});
	});

	onMount(() => {
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (settingsPanelOpen) {
				if (
					(settingsPanelEl && target && settingsPanelEl.contains(target))
					|| (settingsButtonEl && target && settingsButtonEl.contains(target))
				) {
					return;
				}
				closeSettingsPanel();
			}
		};

		activeDocument.addEventListener('selectionchange', syncSelection);
		activeDocument.addEventListener('pointerdown', handlePointerDown, true);
		const resizeObserver = new ResizeObserver(() => {
			syncSubpageMetrics(true);
		});
		if (bodyEl) {
			resizeObserver.observe(bodyEl);
		}
		if (textViewportEl) {
			resizeObserver.observe(textViewportEl);
		}
		if (textEl) {
			resizeObserver.observe(textEl);
		}
		return () => {
			activeDocument.removeEventListener('selectionchange', syncSelection);
			activeDocument.removeEventListener('pointerdown', handlePointerDown, true);
			resizeObserver.disconnect();
		};
	});

	$effect(() => {
		if (!active) {
			return;
		}
		queueMicrotask(() => focusOverlaySurface());
	});
</script>

{#if active && paragraph}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="epub-paragraph-overlay"
		data-surface-style={surfaceStyle}
		bind:this={overlayEl}
		tabindex="-1"
		onkeydown={handleKeydown}
		onpointerdown={() => focusOverlaySurface()}
	>
		<div class="epub-paragraph-overlay__chrome">
			<div class="epub-paragraph-overlay__meta">
				<span class="epub-paragraph-overlay__chapter">{paragraph.chapterTitle}</span>
			</div>
			<div class="epub-paragraph-overlay__tools">
				<button
					type="button"
					class={`clickable-icon epub-paragraph-overlay__random ${randomReadingActive ? 'is-active' : ''}`}
					title={t('epub.reader.paragraphMode.randomReading')}
					aria-label={t('epub.reader.paragraphMode.randomReading')}
					aria-pressed={randomReadingActive}
					onclick={() => void onRandomParagraph?.()}
				>
					<span use:icon={'shuffle'}></span>
				</button>
				<div class="epub-paragraph-overlay__settings-control">
					<button
						type="button"
						class={`clickable-icon epub-paragraph-overlay__settings-toggle ${settingsPanelOpen ? 'is-active' : ''}`}
						title={t('epub.reader.paragraphMode.settingsLabel')}
						aria-label={t('epub.reader.paragraphMode.settingsLabel')}
						aria-expanded={settingsPanelOpen}
						bind:this={settingsButtonEl}
						onclick={toggleSettingsPanel}
					>
						<span use:icon={'settings'}></span>
					</button>
					{#if settingsPanelOpen}
						<div class="epub-paragraph-overlay__settings-popover" bind:this={settingsPanelEl}>
							<div class="epub-paragraph-overlay__settings-row">
								<div class="epub-paragraph-overlay__settings-title">{t('epub.reader.paragraphMode.surfaceStyleLabel')}</div>
								<label class="epub-paragraph-overlay__settings-value-wrap">
									<span class="epub-paragraph-overlay__sr-only">{t('epub.reader.paragraphMode.surfaceStyleLabel')}</span>
									<select
										class="epub-paragraph-overlay__settings-select"
										value={surfaceStyle}
										onchange={(event) => {
											const target = event.currentTarget as HTMLSelectElement;
											const next = target.value as EpubParagraphModeSurfaceStyle;
											if (next !== surfaceStyle) {
												void onSurfaceStyleChange?.(next);
											}
										}}
									>
										{#each surfaceOptions as option (option.value)}
											<option value={option.value}>{t(option.labelKey)}</option>
										{/each}
									</select>
								</label>
							</div>
							<div class="epub-paragraph-overlay__settings-row">
								<div class="epub-paragraph-overlay__settings-title">{t('epub.reader.paragraphMode.transitionStyleLabel')}</div>
								<label class="epub-paragraph-overlay__settings-value-wrap">
									<span class="epub-paragraph-overlay__sr-only">{t('epub.reader.paragraphMode.transitionStyleLabel')}</span>
									<select
										class="epub-paragraph-overlay__settings-select"
										value={transitionStyle}
										onchange={(event) => {
											const target = event.currentTarget as HTMLSelectElement;
											selectTransitionStyle(target.value as EpubParagraphModeTransitionStyle);
										}}
									>
										{#each transitionOptions as option (option.value)}
											<option value={option.value}>{t(option.labelKey)}</option>
										{/each}
									</select>
								</label>
							</div>
							<div class="epub-paragraph-overlay__settings-row">
								<div class="epub-paragraph-overlay__settings-title">{t('epub.reader.paragraphMode.fontScaleToggle')}</div>
								<label class="epub-paragraph-overlay__font-slider" aria-label={t('epub.reader.paragraphMode.fontScaleLabel')}>
									<button
										type="button"
										class="clickable-icon epub-paragraph-overlay__font-step"
										title={t('epub.reader.paragraphMode.fontScaleDecrease')}
										aria-label={t('epub.reader.paragraphMode.fontScaleDecrease')}
										onclick={() => void onFontScaleChange?.(clampFontScale(fontScale - 5))}
									>
										<span>A-</span>
									</button>
									<input
										type="range"
										min="85"
										max="135"
										step="1"
										value={fontScale}
										aria-label={t('epub.reader.paragraphMode.fontScaleLabel')}
										oninput={(event) => {
											const target = event.currentTarget as HTMLInputElement;
											void onFontScaleChange?.(clampFontScale(Number(target.value)));
										}}
									/>
									<div class="epub-paragraph-overlay__font-scale-value">{fontScale}%</div>
									<button
										type="button"
										class="clickable-icon epub-paragraph-overlay__font-step"
										title={t('epub.reader.paragraphMode.fontScaleIncrease')}
										aria-label={t('epub.reader.paragraphMode.fontScaleIncrease')}
										onclick={() => void onFontScaleChange?.(clampFontScale(fontScale + 5))}
									>
										<span>A+</span>
									</button>
								</label>
							</div>
						</div>
					{/if}
				</div>
				<button
					type="button"
					class="clickable-icon epub-paragraph-overlay__close"
					title={immersive ? t('epub.reader.paragraphMode.immersiveExit') : t('epub.reader.paragraphMode.immersiveEnter')}
					aria-label={immersive ? t('epub.reader.paragraphMode.immersiveExit') : t('epub.reader.paragraphMode.immersiveEnter')}
					onclick={() => onToggleImmersive?.()}
				>
					<span use:icon={immersive ? 'minimize' : 'maximize'}></span>
				</button>
				<button
					type="button"
					class="clickable-icon epub-paragraph-overlay__close"
					title={t('epub.reader.paragraphMode.close')}
					aria-label={t('epub.reader.paragraphMode.close')}
					onclick={() => {
						clearSelection();
						onClose?.();
					}}
				>
					<span use:icon={'x'}></span>
				</button>
			</div>
		</div>

		<!-- svelte-ignore a11y_click_events_have_key_events a11y_mouse_events_have_key_events -->
		<div
			class="epub-paragraph-overlay__body"
			role="presentation"
			bind:this={bodyEl}
			onwheel={handleWheel}
			onclick={handleBodyClick}
			onmouseover={handleBodyMouseOver}
			onmouseout={handleBodyMouseOut}
			onfocusin={handleBodyFocusIn}
			onfocusout={handleBodyFocusOut}
		>
			<div
				class="epub-paragraph-overlay__text-viewport"
				data-surface-style={surfaceStyle}
				data-transition-style={transitionStyle}
				data-transitioning={paragraphTransitioning ? 'true' : 'false'}
				data-direction={paragraphTransitionDirection}
				bind:this={textViewportEl}
				onscroll={handleViewportScroll}
			>
				{#if renderedParagraph}
					{#key `${renderedParagraph.id}:${renderedParagraph.htmlRevision ?? 0}:${paragraphTransitionToken}`}
						<div class="epub-paragraph-overlay__text-frame is-current">
							<div
								class="epub-paragraph-overlay__text"
								style={`--weave-paragraph-font-scale:${fontScale / 100};`}
								use:registerCurrentText
							>
								{@html renderedParagraph.html || renderedParagraph.text}
							</div>
						</div>
					{/key}
				{/if}
			</div>
		</div>

		<div class="epub-paragraph-overlay__nav-slot" bind:this={navSlotEl}>
			<div class="epub-paragraph-overlay__nav">
				<button type="button" class="clickable-icon epub-paragraph-overlay__nav-btn" onclick={() => {
					void navigateWithinParagraph(-1).then((handled) => {
						if (!handled) {
							clearSelection();
							void onPrev?.();
						}
					});
				}}>
					<span use:icon={'arrow-left'}></span>
					<span>{t('epub.reader.paragraphMode.previous')}</span>
				</button>
				<div class="epub-paragraph-overlay__status" aria-live="polite">{getProgressLabel()}</div>
				<button type="button" class="clickable-icon epub-paragraph-overlay__nav-btn" onclick={() => {
					void navigateWithinParagraph(1).then((handled) => {
						if (!handled) {
							clearSelection();
							void onNext?.();
						}
					});
				}}>
					<span use:icon={'arrow-right'}></span>
					<span>{t('epub.reader.paragraphMode.next')}</span>
				</button>
			</div>
		</div>
	</div>
{/if}
