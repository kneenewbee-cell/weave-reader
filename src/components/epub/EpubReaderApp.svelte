<script lang="ts">
        import type { App, WorkspaceLeaf, TAbstractFile, EventRef } from 'obsidian';
        import { setIcon, MarkdownView, Notice, Menu, TFile, Platform, normalizePath } from 'obsidian';
	import { onMount, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import EpubReaderView from './EpubReaderView.svelte';
	import BookshelfView from './BookshelfView.svelte';
	import BottomNav from './BottomNav.svelte';
	import EpubLoadingState from './EpubLoadingState.svelte';
	import SelectionToolbar from './SelectionToolbar.svelte';
	import ParagraphReadingOverlay from './ParagraphReadingOverlay.svelte';
	import BookNotesExportPopover from './BookNotesExportPopover.svelte';
	import ScreenshotOverlay from './ScreenshotOverlay.svelte';
	import EpubTutorial from './EpubTutorial.svelte';
	import type { TutorialTabId } from './epub-tutorial-content';
	import EpubHighlightToolbar from './EpubHighlightToolbar.svelte';
	import AnnotationDisambiguationMenu, {
		type AnnotationDisambiguationCandidate,
	} from './AnnotationDisambiguationMenu.svelte';
	import EpubCommentEditorPopover from './EpubCommentEditorPopover.svelte';
	import EpubFootnotePreviewPopover from './EpubFootnotePreviewPopover.svelte';
	import ReferenceDetailModal from './ReferenceDetailModal.svelte';
	import EpubPremiumFeaturePopover from './EpubPremiumFeaturePopover.svelte';
	import { canUseEpubCanvasExcerpts, canUseEpubChapterExport, canUseEpubExcerptNotes, canUseEpubFootnotePreview, canUseEpubParagraphMode, canUseEpubReadingProgress, canUseEpubReadingReference, canUseEpubSourceLocation, canUseEpubStyledExcerpts, createEpubReaderEngine, createEpubAnnotationCompareContexts, DEFAULT_EPUB_EXCERPT_SETTINGS, ensureBookSourceLocationAccess, ensureEpubPremiumFeature, EPUB_ANNOTATION_COMPARE_CONTEXT_EVENT, EPUB_ANNOTATION_VERSION_CHANGED_EVENT, EPUB_DUAL_WINDOW_ANNOTATION_EVENT, EPUB_READER_UI_MODE_CHANGED_EVENT, EPUB_RUNTIME, EPUB_SEMANTIC_PROFILE_CHANGED_EVENT, EpubAnnotationService, EpubLinkService, EpubLocationMigrationService, SEMANTIC_COLOR_HEX, activeSemanticEntries, applyAnnotationChapterMetadata, flushEpubPendingProgress, getEpubAnnotationIndexService, getEpubBacklinkHighlightService, getEpubHighlightViewSnapshotService, getEpubDualWindowSession, getEpubStorageService, isBookCompleted, listEpubAnnotationVersions, loadEffectiveEpubSemanticProfile, markEpubDualWindowNoteLeaf, normalizeAnnotationStyle, normalizeEpubReaderUiMode, normalizeEpubSemanticSettings, notifyEpubAnnotationVersionChanged, normalizeEpubAnnotationCompareContext, normalizeEpubAnnotationCompareContextChangeDetail, readEpubReaderUiModeChange, resolveAnnotationChapterMetadata, resolveDisplayProgress, resolveEpubAnnotationCompareExitPlan, resolveEpubAnnotationPaneCapabilities, resolveEpubDualWindowOpenGuard, resolveEpubDualWindowPanes, resolveEpubHost, resolveEpubWeaveOfficialAPI, restoreEpubDualWindowSessionsFromWorkspace, switchEpubAnnotationVersion, unregisterEpubDualWindowSession, warmEpubAnnotationIndexForPaths, type EpubAnnotationCompareContext, type EpubAnnotationVersionSummary, type EpubDualWindowAnnotationDetail, type EpubDualWindowMode, type EpubOpenDualWindowSession } from '../../services/epub';
	import { EpubBookmarkService } from '../../services/epub/EpubBookmarkService';
	import { epubVaultPathsReferToSameBook } from '../../services/epub/epub-vault-path';
	import { EpubReferenceStatsService } from '../../services/epub/EpubReferenceStatsService';
	import {
		getDefaultEpubReaderSettings,
		normalizeEpubReaderSettingsForDevice,
		type EpubReaderSettingsDeviceKind,
	} from '../../services/epub/reader-settings';
	import type { ReferenceSourceInfo, ReferenceStats } from '../../services/epub/EpubReferenceStatsService';
	import type { BacklinkSourceMatch } from '../../services/epub/EpubBacklinkHighlightService';
	import { EpubScreenshotService } from '../../services/epub/EpubScreenshotService';
	import { EpubCanvasService } from '../../services/epub/EpubCanvasService';
	import {
		WEAVE_EPUB_CANVAS_LAYOUT_DIRECTION_EVENT,
		type WeaveEpubCanvasLayoutDirectionPayload,
	} from '../../services/epub/canvas-excerpt-anchor';
	import type { EpubVisibleFrameLike, ScreenshotRect } from '../../services/epub/EpubScreenshotService';
	import type { EpubAnnotationSemantic, EpubBook, EpubExcerptSettings, EpubFlowMode, EpubHighlightStyle, EpubHostCapabilities, EpubLayoutMode, EpubParagraphModeReadingPosition, EpubParagraphModeTransitionStyle, EpubReaderEngine, EpubReaderSettings, EpubReaderUiMode, EpubReadingReferencePoint, EpubSemanticSettings, EpubWeaveExcerptRemovalMode, EpubWeaveOfficialAPI, EpubWeaveRemoveExcerptResult, FlashStyle, HighlightClickInfo, PaginationInfo, ReaderFootnotePreviewInfo, ReaderHighlight, ReaderHighlightSegment, ReaderParagraph, ReadingPosition, TocItem, EpubChapterReadingPointDraft } from '../../services/epub';
	import { PremiumFeatureGuard, PREMIUM_FEATURES } from '../../services/premium/PremiumFeatureGuard';
	import { getBookFormatDisplayLabel, isSupportedBookFile } from '../../services/epub/book-format';
	import {
		applyChapterHighlightsToMarkdownAsync,
		highlightBelongsToChapterExport,
		highlightTextAppearsInChapterDraft,
	} from '../../services/epub/chapter-marked-markdown-export';
	import type { FlatTocExportItem } from '../../services/epub/epub-toc-export-scope';
	import type { EpubTocChapterMark, EpubTocChapterMarkMap } from '../../services/epub/epub-toc-chapter-mark';
	import type { EpubTocChapterMarkSettings } from '../../services/epub/epub-toc-chapter-mark-settings';
	import {
		BookLoadCancelledError,
		buildBookLoadSlowWarningMessage,
		runBookLoadSession,
	} from '../../services/epub/book-load-session';
	import {
		canReuseExistingBook,
		resolveBookLoadRestoredPosition,
	} from '../../services/epub/epub-reader-book-load-helpers';
	import {
		findEpubPortableBookIdByIdentity,
		isEpubGeneratedAnnotationNotePath,
		resolveEpubPortableBookDataLocation,
	} from '../../services/epub/epub-portable-data-location';
	import { findOpenAnnotationNoteLeaf } from '../../services/epub/open-annotation-note-file';
	import {
		EpubAnnotationUndoStack,
		type EpubAnnotationUndoPatch,
	} from '../../services/epub/annotation-undo-stack';
	import {
		ensureDefaultBookNotesExportTemplates,
		isMarkdownVaultFile,
		buildBookNotesExportLabelsFromTranslator,
		renderBookNotesMarkdown,
	} from '../../services/epub/book-notes-export/book-notes-export';
	import { resolveBookNotesExportTemplateFolder } from '../../services/epub/book-notes-export/template-folder';
	import {
		getBookshelfDisplayModeOptions,
		getBookshelfDisplayModeOption,
		normalizeBookshelfDisplayMode,
		type BookshelfDisplayMode,
	} from '../../services/epub/bookshelf-display-mode';
	import {
		createDebouncedBookshelfProgressChangedNotifier,
		dispatchEpubBookshelfDataChanged,
		dispatchEpubBookshelfRefreshRequest,
	} from '../../services/epub/bookshelf-data-events';
	import { epubActiveDocumentStore } from '../../stores/epub-active-document-store';
	import { logger } from '../../utils/logger';
	import { tr } from '../../utils/i18n';
	import { isWeaveMainPluginEnabled } from '../../utils/weave-reader-access';
	import { findOpenEpubLeaf, getAllOpenEpubLeaves, getOpenEpubFilePath, pathsReferToSameOpenBook, resolveRegisteredEpubViewType } from '../../utils/epub-leaf-utils';
	import { showObsidianChoice, showObsidianConfirm } from '../../utils/obsidian-confirm';
	import { UnifiedThemeManager } from '../../utils/theme-detection';
	import { getSourceLocateOverlayService } from '../../services/ui/SourceLocateOverlayService';
	import { getNavigationHub } from '../../services/navigation/navigation-hub-access';
	import type { BookLocateIntent, NavigationIntent, PendingLocateState } from '../../services/navigation/navigation-intent';
	import { getBookSessionManager } from '../../services/epub/session/book-session-manager-access';
	import type { BookSession } from '../../services/epub/session/BookSessionManager';
	import {
		applyHighlightSourceOptimisticSyncResult,
		computeHighlightSourceOptimisticSync,
		getReaderHighlightIdentityKey,
		hasReaderHighlightPresentationChanged,
		mergeReaderHighlightsByIdentity,
	} from './useEpubHighlights';
	import {
		buildEpubDisplayHighlightSelectionKey,
		type EpubDisplayHighlight,
	} from '../../services/epub/EpubHighlightViewSnapshotService';
	import type { EpubAnnotationCompareVersionSelection } from './epub-annotation-compare-version-selection';
	import { createEpubNavigationController } from './useEpubNavigation';
	import { resolveReadingViewportLockTarget } from '../../utils/mobile-reading-viewport-lock';
	import { domInstanceOf } from '../../utils/dom-instance-of';
	import { shouldIgnoreEpubReaderShortcut } from '../../utils/epub-reader-keyboard-guards';
	import { shouldDismissToolbarOnPointerDown } from './toolbar-positioning';
	import { buildEpubMarkdownLocateCandidates } from '../../services/ui/source-locate-candidates';
	import { attachExternalHighlightSyncReload } from './external-highlight-sync-reload';
	import {
		attachEpubCardHighlightSyncBridge,
		buildEpubHighlightSyncSnapshot,
		type EpubSavedCardSnapshot,
	} from '../../services/epub/epub-card-highlight-sync';
	import { isEphemeralEditorHighlightSourcePath } from '../../services/epub/epub-highlight-source-path';
	import type { EpubHostCreateCardInput } from '../../services/epub';
	import {
		normalizeContinuousReadingPositionAutoSaveEnabled,
		normalizeContinuousReadingPositionAutoSavePages,
	} from '../../config/reading-position-auto-save';
	import '../../styles/epub/epub-reader.css';

	interface Props {
		app: App;
		filePath: string;
		annotationCompare?: EpubAnnotationCompareContext | null;
		annotationCompareContextSourceId?: string;
		pendingLocate?: PendingLocateState | null;
		pendingCfi?: string;
		pendingText?: string;
		autoInsertEnabled?: boolean;
		getLastActiveMarkdownLeaf?: () => WorkspaceLeaf | null;
		onTitleChange?: (title: string) => void;
		onChapterTitleChange?: (title: string) => void;
		onReadingReferencePointChange?: (point: EpubReadingReferencePoint | null) => void;
		onReadingPositionAutoSaveChange?: () => void;
		onPremiumUiStateChange?: () => void;
		onReaderSettingsLoaded?: (settings: EpubReaderSettings) => void;
		onBackFromBookshelf?: () => void | Promise<void>;
		onCancelBookLoad?: () => void | Promise<void>;
		onActionsReady?: (actions: {
			setAutoInsert: (enabled: boolean) => void;
			setScreenshotMode: (active: boolean) => void;
			setLayoutMode: (mode: EpubLayoutMode) => void;
			setFlowMode: (mode: EpubFlowMode) => void;
			toggleParagraphMode: () => void;
			openTypographyPanel: () => void;
			getReaderSettings: () => EpubReaderSettings;
			updateReaderSettings: (patch: Partial<EpubReaderSettings>) => Promise<void>;
			setScreenshotSaveMode: (saveAsImage: boolean) => void;
			navigateToCfi: (cfi: string, linkTextHint?: string) => void;
			toggleTutorial: () => void;
			addBookmark: () => Promise<void>;
			canUseReadingProgress?: () => boolean;
			canUseReadingReference?: () => boolean;
			canUseParagraphMode?: () => boolean;
			canUseExcerptNotes?: () => boolean;
			canUseStyledExcerpts?: () => boolean;
			canUseCanvasExcerpts?: () => boolean;
			canUseFootnotePreview?: () => boolean;
			isPremiumFeaturePreviewEnabled?: () => boolean;
			showPremiumFeaturePreview?: (featureId: string) => void;
			saveReadingReferencePoint?: () => Promise<void>;
			openReadingPositionMenu?: (event: MouseEvent | KeyboardEvent) => void;
			getReadingPositionAutoSaveEnabled?: () => boolean;
			setReadingPositionAutoSaveEnabled?: (enabled: boolean) => Promise<boolean>;
			bindCanvasPath: (canvasPath: string) => void;
			unbindCanvas: () => void;
			getCanvasService: () => EpubCanvasService;
			exportCurrentChapterToMarkdown?: () => Promise<void>;
			exportCurrentChapterMarkedToMarkdown?: () => Promise<void>;
			exportCurrentChapterHighlightsToMarkdown?: () => Promise<void>;
			exportBookHighlightsToMarkdown?: (event?: MouseEvent) => Promise<void>;
			openAnnotationNote?: () => Promise<void>;
			openAnnotationDualWindow?: () => Promise<void>;
			openAnnotationCompareDualWindow?: () => Promise<void>;
			openAnnotationVersions?: () => Promise<void>;
			getExcerptSettings: () => EpubExcerptSettings;
			updateExcerptSettings: (patch: Partial<EpubExcerptSettings>) => Promise<void>;
			prevPage: () => void | Promise<void>;
			nextPage: () => void | Promise<void>;
		}) => void;
		onSwitchBook?: (filePath: string) => void;
		onCanvasStateChange?: (active: boolean, canvasPath: string | null) => void;
		onCanvasLayoutDirectionChange?: (direction: import('../../services/epub/canvas-types').CanvasLayoutDirection) => void;
	}

	let { 
		app, 
		filePath, 
		annotationCompare = null,
		annotationCompareContextSourceId = '',
		pendingLocate = null,
		pendingCfi = '', 
		pendingText = '', 
		autoInsertEnabled: initialAutoInsert = false, 
		getLastActiveMarkdownLeaf, 
		onTitleChange, 
		onChapterTitleChange,
		onReadingReferencePointChange,
		onReadingPositionAutoSaveChange,
		onPremiumUiStateChange,
		onReaderSettingsLoaded, 
		onBackFromBookshelf,
		onCancelBookLoad,
		onActionsReady, 
		onSwitchBook, 
		onCanvasStateChange,
		onCanvasLayoutDirectionChange
	}: Props = $props();
	let t = $derived($tr);

	function getDefaultReaderLineHeight(): number {
		return getDefaultReaderSettings().lineHeight;
	}

	function getDefaultReaderPageMargin(): number {
		return getDefaultReaderSettings().pageMargin;
	}

	function getDefaultReaderWidthMode(): EpubReaderSettings['widthMode'] {
		return getDefaultReaderSettings().widthMode;
	}

	function getDefaultReaderFlowMode(): EpubReaderSettings['flowMode'] {
		return getDefaultReaderSettings().flowMode;
	}

	function isDesktopScrolledSideNavVisible(): boolean {
		return settings.flowMode === 'scrolled' && settings.showScrolledSideNav && !isMobileReader();
	}

	function getReaderRootStyle(): string {
		const effectiveLineHeight = typeof settings.lineHeight === 'number' && settings.lineHeight > 0
			? settings.lineHeight
			: getDefaultReaderLineHeight();
		const pagedSafeInset = `${(effectiveLineHeight * 0.5).toFixed(3)}em`;
		return `--epub-line-height: ${effectiveLineHeight}; --epub-paged-safe-top: ${pagedSafeInset}; --epub-paged-safe-bottom: ${pagedSafeInset};`;
	}

	let readerService: EpubReaderEngine = untrack(() => createEpubReaderEngine(app));
	let annotationTocItemsPromise: Promise<TocItem[]> | null = null;
	let storageService = untrack(() => getEpubStorageService(app));
	let bookmarkService = untrack(() => new EpubBookmarkService(app));
	let annotationService = untrack(() => new EpubAnnotationService(storageService));
	let highlightViewSnapshotService = untrack(() => getEpubHighlightViewSnapshotService(app));
	let locationMigrationService = untrack(() => new EpubLocationMigrationService(app, storageService, readerService));
	let linkService = untrack(() => new EpubLinkService(app));
	let screenshotService = untrack(() => new EpubScreenshotService(app));
	let canvasService = untrack(() => new EpubCanvasService(app));
	let backlinkService = untrack(() => getEpubBacklinkHighlightService(app));
	let referenceStatsService = untrack(() => new EpubReferenceStatsService(app, backlinkService));
	let readerUiMode = $state<EpubReaderUiMode>(untrack(() => getHostReaderUiMode()));
	let semanticSettings = $state<EpubSemanticSettings>(untrack(() => normalizeEpubSemanticSettings(getHostSemanticSettings())));
	let semanticSettingsLoadToken = 0;

	let book = $state<EpubBook | null>(null);
	let portableBookId = $state('');
	let loading = $state(true);
	let bookLoadSlowWarning = $state(false);
	let errorMsg = $state('');
	let readingProgress = $state(0);
	let paginationInfo = $state<PaginationInfo>({ currentPage: 0, totalPages: 0 });
	let currentChapterIndex = $state(0);
	let showScrolledChapterNavActions = $state(false);
	let readerVersion = $state(0);
	let readerRenderKey = $state(0);
	let autoInsert = $state(untrack(() => initialAutoInsert));
	let screenshotMode = $state(false);
	let screenshotSaveAsImage = $state(true);
	let tutorialVisible = $state(false);
	let tutorialInitialTab = $state<TutorialTabId | undefined>(undefined);
	let readerTutorialDismissed = $state(false);
	let tutorialDismissStateReady = untrack(() =>
		storageService.loadPluginUiMemory().then((memory) => {
			readerTutorialDismissed = memory.readerTutorialDismissed;
		}).catch((error) => {
			logger.warn('[EpubReaderApp] Failed to load tutorial dismiss state:', error);
		})
	);
	let canvasMode = $state(false);
	let transientStatusText = $state('');
	let readingReferencePoint = $state<EpubReadingReferencePoint | null>(null);
	let sessionReadingStartPercent = $state<number | null>(null);
	let bookCompletionPromptOpen = false;
	let bookCompletionPromptDismissedBookId = '';
	let premiumFeaturePreviewEnabled = $state(false);
	let isPremiumLicenseActive = $state(false);
	let premiumFeaturePreviewFeatureId = $state<string | null>(null);
	let paragraphModeSelection = $state<{
		text: string;
		cfiRange: string;
		rect: DOMRect;
		rects: DOMRect[];
		clear: () => void;
	} | null>(null);
	let paragraphModeLocation = $state<{ paragraphs: ReaderParagraph[]; currentIndex: number } | null>(null);
	let paragraphModeBusy = $state(false);
	let paragraphModeImmersive = $state(false);
	let paragraphModeAnchorParagraphId = '';
	let paragraphModeSuppressReactiveRefresh = 0;
	let paragraphModeLastNavigationAt = 0;
	let paragraphModePersistTimer: ReturnType<typeof setTimeout> | null = null;
	let paragraphModeDetachedSession = $state(false);
	let paragraphModeDetachedSnapshot = $state<{
		readingPosition: ReadingPosition;
		paragraphId?: string;
		paragraphIndex?: number;
		paragraphTextPreview?: string;
	} | null>(null);
	const PARAGRAPH_MODE_PERSIST_DEBOUNCE_MS = 1400;
	const PARAGRAPH_MODE_REACTIVE_REFRESH_COOLDOWN_MS = 450;
	let rootEl = $state<HTMLDivElement | null>(null);
	let viewportEl = $state<HTMLDivElement | null>(null);
	let readingViewportLockEl = $derived(resolveReadingViewportLockTarget(rootEl));
	let exportNotesPopoverEl = $state<HTMLDivElement | null>(null);
	let exportNotesPopoverOpen = $state(false);
	let exportNotesSubmitting = $state(false);
	let typographyPopoverOpen = $state(false);
	let paragraphModeNavBottomOffset = $state(0);
	let readerReady = $state(false);
	let scrolledNavSyncFrame = 0;
	let scrolledNavResizeObserver: ResizeObserver | null = null;
	let highlightToolbarInfo = $state<HighlightClickInfo | null>(null);
	let annotationDisambiguationAnchor = $state<HighlightClickInfo | null>(null);
	let annotationDisambiguationCandidates = $state<AnnotationDisambiguationCandidate[]>([]);
	let commentEditorInfo = $state<HighlightClickInfo | null>(null);
	let footnotePreviewInfo = $state<ReaderFootnotePreviewInfo | null>(null);
	let referencePopoverInfo = $state<HighlightClickInfo | null>(null);
	let referencePopoverStats = $state<ReferenceStats | null>(null);
	let commentEditorDraft = $state('');
	let commentEditorSaving = $state(false);
	const SCROLLED_NAV_FRAME_INSET_VAR = '--epub-scrolled-side-nav-frame-inset-end';
	const SCROLLED_NAV_SCROLLBAR_VAR = '--epub-scrolled-side-nav-scrollbar-width';
	let excerptSettings = $state<EpubExcerptSettings>({
		...DEFAULT_EPUB_EXCERPT_SETTINGS,
		bookNotesExportTemplateFolder: '',
	});
	let excerptSettingsLoaded = $state(false);
	let excerptSettingsReady: Promise<void> = Promise.resolve();
	let trackedHighlightSourceFiles = new Set<string>();
	let bookSession = untrack(() => getBookSessionManager(app).acquire(filePath));
	let vaultEventRefs: EventRef[] = [];
	let pendingCollectedHighlights: ReaderHighlight[] | null = null;
	let pendingLoadedHighlights: ReaderHighlight[] | null = null;
	const annotationUndoStack = new EpubAnnotationUndoStack();
	let annotationMutationQueue: Promise<void> = Promise.resolve();
	let annotationNoteRefreshQueue: Promise<void> = Promise.resolve();
	let activeAnnotationPreviewCfiRange: string | null = null;
	let highlightReloadToken = 0;
	let highlightReloading = $state(false);
	let annotationRevision = $state(0);
	let bookmarkRevision = $state(0);
	let tocChapterMarks = $state<EpubTocChapterMarkMap>({});
	let tocChapterMarkSettings = $state<EpubTocChapterMarkSettings>({});
	let tocChapterMarkRevision = $state(0);
	let tocChapterMarkSettingsRevision = $state(0);
	let migratedLocationBookIds = new Set<string>();
	let migratingLocationBookId: string | null = null;
	let referenceBadgeClickCleanup: (() => void) | null = null;
	let scrolledChapterEndCleanup: (() => void) | null = null;
	const sourceLocateOverlay = getSourceLocateOverlayService();
	let hasPendingBookLocate = $state(false);
	const epubNavigation = untrack(() =>
		createEpubNavigationController({
			getReaderReady: () => readerReady,
			getReaderService: () => readerService,
			getSourceLocateOverlay: () => sourceLocateOverlay,
			getLocateOverlayLabel: () => t('epub.reader.locateSourcePosition'),
			onPendingChange: (hasPending) => {
				hasPendingBookLocate = hasPending;
			},
		})
	);
	let transientStatusTimer: ReturnType<typeof setTimeout> | null = null;
	let deferredHighlightReloadTimer: ReturnType<typeof setTimeout> | null = null;
	let deferredHighlightReloadOptions: HighlightReloadOptions = {};
	let componentDisposed = false;
	let activeBookLoadToken = 0;
	let readerStoreSyncTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingReaderStorePatch: Record<string, unknown> = {};
	const READER_STORE_SYNC_MS = 350;
	const ANNOTATION_COMPARE_POSITION_SYNC_EVENT = 'weave-epub-annotation-compare-position-sync';
	const ANNOTATION_COMPARE_SYNC_DEBOUNCE_MS = 160;
	let annotationCompareSyncTimer: ReturnType<typeof setTimeout> | null = null;
	let applyingAnnotationCompareSyncUntil = 0;
	let lastAnnotationCompareBroadcastCfi = '';
	const annotationCompareVersionId = $derived(String(annotationCompare?.versionId || '').trim());
	const annotationCompareReadOnly = $derived(Boolean(annotationCompare && annotationCompare.paneRole === 'readonly'));
	const annotationPaneCapabilities = $derived(resolveEpubAnnotationPaneCapabilities({
		hasExcerptNotes: hasExcerptNotesCapability(),
		annotationCompare,
	}));
	const canReadAnnotationsInPane = $derived(annotationPaneCapabilities.canReadAnnotations);
	const canEditAnnotationsInPane = $derived(annotationPaneCapabilities.canEditAnnotations);
	const canUseSelectionToolbarInPane = $derived(annotationPaneCapabilities.canUseSelectionToolbar);

	$effect(() => {
		if (!annotationCompareReadOnly) {
			return;
		}
		highlightToolbarInfo = null;
		commentEditorInfo = null;
		commentEditorDraft = '';
		commentEditorSaving = false;
		closeAnnotationDisambiguation();
	});
	const annotationCompareLabels = {
		editableSlot: '\u4e3b\u9875',
		readonlySlot: '\u526f\u9875',
		editableMode: '\u53ef\u7f16\u8f91',
		readonlyMode: '\u53ea\u8bfb',
		syncPosition: '\u540c\u6b65\u9605\u8bfb\u4f4d\u7f6e',
		swapPanes: '\u4ea4\u6362\u5de6\u53f3',
		changeCompareVersions: '\u66f4\u6362\u5bf9\u6bd4\u7248\u672c',
		versionManager: '\u7248\u672c\u7ba1\u7406',
		exitCompare: '\u9000\u51fa\u5bf9\u6bd4',
		promoteReadonly: '\u8bbe\u4e3a\u4e3b\u9875\u5e76\u7f16\u8f91',
	};

	type AnnotationComparePositionSyncDetail = {
		sessionId: string;
		sourceVersionId: string;
		cfi: string;
	};

	function getAnnotationCompareVersionLabel(context: EpubAnnotationCompareContext | null = annotationCompare): string {
		return String(context?.versionName || context?.versionId || '').trim();
	}

	function ensureAnnotationCompareWritable(): boolean {
		if (!annotationCompareReadOnly) {
			return true;
		}
		new Notice(`\u5f53\u524d\u5bf9\u6bd4\u7a97\u53e3\u4e3a\u53ea\u8bfb\uff0c\u8bf7\u5148\u70b9\u51fb\u201c${annotationCompareLabels.promoteReadonly}\u201d`);
		return false;
	}

	function applyAnnotationCompareContextChange(nextContext: EpubAnnotationCompareContext | null): void {
		const previousVersionId = String(annotationCompare?.versionId || '').trim();
		const nextVersionId = String(nextContext?.versionId || '').trim();
		annotationCompare = nextContext;
		highlightToolbarInfo = null;
		closeAnnotationDisambiguation();
		commentEditorInfo = null;
		commentEditorDraft = '';
		commentEditorSaving = false;
		syncAsActiveEpubDocumentIfActive();
		if (previousVersionId !== nextVersionId) {
			void reloadHighlights({ invalidateCache: true, forceReaderReplace: true });
		}
	}

	function readAnnotationCompareContextFromLeaf(leaf: WorkspaceLeaf | null | undefined): EpubAnnotationCompareContext | null {
		try {
			const state = leaf?.getViewState?.()?.state as Record<string, unknown> | undefined;
			return normalizeEpubAnnotationCompareContext(state?.annotationCompare);
		} catch {
			return null;
		}
	}

	function getAnnotationCompareLeafEntries(sessionId = annotationCompare?.sessionId || ''): Array<{
		leaf: WorkspaceLeaf;
		context: EpubAnnotationCompareContext;
	}> {
		const targetSessionId = String(sessionId || '').trim();
		if (!targetSessionId) {
			return [];
		}
		return getAllOpenEpubLeaves(app)
			.map((leaf) => ({
				leaf,
				context: readAnnotationCompareContextFromLeaf(leaf),
			}))
			.filter((entry): entry is { leaf: WorkspaceLeaf; context: EpubAnnotationCompareContext } =>
				Boolean(entry.context && entry.context.sessionId === targetSessionId)
			);
	}

	function findCurrentAnnotationCompareLeaf(): WorkspaceLeaf | null {
		if (annotationCompare) {
			const matched = getAnnotationCompareLeafEntries(annotationCompare.sessionId).find((entry) =>
				entry.context.versionId === annotationCompare.versionId &&
				entry.context.paneRole === annotationCompare.paneRole
			);
			if (matched) {
				return matched.leaf;
			}
		}
		const activeLeaf = app.workspace.activeLeaf;
		if (activeLeaf && isActiveEpubReaderInstance(activeLeaf)) {
			return activeLeaf;
		}
		return findOpenEpubLeaf(app, filePath);
	}

	async function setAnnotationCompareLeafState(
		leaf: WorkspaceLeaf,
		nextContext: EpubAnnotationCompareContext | null,
		options: { active?: boolean } = {}
	): Promise<void> {
		const currentViewState = leaf.getViewState?.();
		const currentState = (currentViewState?.state || {}) as Record<string, unknown>;
		const viewType =
			currentViewState?.type ||
			resolveRegisteredEpubViewType(app, filePath) ||
			EPUB_RUNTIME.viewTypes.reader;
		const nextState: Record<string, unknown> = {
			...currentState,
			filePath: normalizePath(String(currentState.filePath || filePath || '').trim()),
		};
		if (nextContext) {
			nextState.annotationCompare = nextContext;
		} else {
			delete nextState.annotationCompare;
		}
		await leaf.setViewState({
			type: viewType,
			active: options.active === true,
			state: nextState,
		});
	}

	function getAnnotationCompareSessionPeer(): { leaf: WorkspaceLeaf; context: EpubAnnotationCompareContext } | null {
		if (!annotationCompare) {
			return null;
		}
		return getAnnotationCompareLeafEntries(annotationCompare.sessionId).find((entry) =>
			entry.context.versionId !== annotationCompare.versionId ||
			entry.context.paneRole !== annotationCompare.paneRole
		) || null;
	}

	function buildAnnotationCompareContextForRole(
		source: EpubAnnotationCompareContext,
		paneRole: EpubAnnotationCompareContext['paneRole'],
		peer: EpubAnnotationCompareContext
	): EpubAnnotationCompareContext {
		return {
			...source,
			paneRole,
			counterpartVersionId: peer.versionId,
			counterpartVersionName: peer.versionName,
			syncPosition: annotationCompare?.syncPosition !== false,
		};
	}

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

	let settings = $state<EpubReaderSettings>({
		lineHeight: getDefaultReaderLineHeight(),
		letterSpacing: 0,
		pageMargin: getDefaultReaderPageMargin(),
		viewportSidePadding: Platform.isMobile ? 18 : 24,
		theme: 'default',
		widthMode: getDefaultReaderWidthMode(),
		layoutMode: 'paginated',
		flowMode: getDefaultReaderFlowMode(),
		showScrolledSideNav: true,
		footnoteClickAction: 'preview',
		paragraphModeEnabled: false,
		paragraphModeFontSize: 'medium',
		paragraphModeFontScale: 100,
		paragraphModeSurfaceStyle: 'spotlight',
		paragraphModeTransitionStyle: 'settle',
	});

	const paragraphTransitionStyleOptions: Array<{
		value: EpubParagraphModeTransitionStyle;
		labelKey: string;
	}> = [
		{ value: 'steady', labelKey: 'epub.reader.paragraphMode.transitionStyleSteady' },
		{ value: 'fade', labelKey: 'epub.reader.paragraphMode.transitionStyleFade' },
		{ value: 'settle', labelKey: 'epub.reader.paragraphMode.transitionStyleSettle' },
		{ value: 'slide', labelKey: 'epub.reader.paragraphMode.transitionStyleSlide' },
	];
	let hostTheme = $state<'light' | 'dark'>(
		untrack(() => (UnifiedThemeManager.getInstance().isDarkMode() ? 'dark' : 'light'))
	);

	function isMobileReader(): boolean {
		return Platform.isMobile;
	}

	function getReaderDeviceKind(): EpubReaderSettingsDeviceKind {
		return isMobileReader() ? 'mobile' : 'desktop';
	}

	function getDefaultReaderSettings(): EpubReaderSettings {
		return getDefaultEpubReaderSettings(getReaderDeviceKind());
	}

	function hasReadingProgressCapability(): boolean {
		return canUseEpubReadingProgress(app);
	}

	function hasReadingReferenceCapability(): boolean {
		return canUseEpubReadingReference(app);
	}

	function hasParagraphModeCapability(): boolean {
		return canUseEpubParagraphMode(app);
	}

	function hasExcerptNotesCapability(): boolean {
		return canUseEpubExcerptNotes(app);
	}

	function hasStyledExcerptCapability(): boolean {
		return canUseEpubStyledExcerpts(app);
	}

	function hasSourceLocationCapability(): boolean {
		return canUseEpubSourceLocation(app);
	}

	function hasCanvasExcerptCapability(): boolean {
		return canUseEpubCanvasExcerpts(app);
	}

	function hasFootnotePreviewCapability(): boolean {
		return canUseEpubFootnotePreview(app);
	}

	function hasChapterExportCapability(): boolean {
		return canUseEpubChapterExport(app);
	}

	function isPremiumFeaturePreviewEnabled(): boolean {
		return premiumFeaturePreviewEnabled;
	}

	function getPremiumFeatureEntryTitle(baseTitle: string, featureId: string): string {
		return PremiumFeatureGuard.getInstance().getFeatureEntryTitle(baseTitle, featureId, {
			page: 'epub-reader',
		});
	}

	function getReadingPositionLabel(percent: number): string {
		return t('epub.reader.readingPosition', { percent: Math.round(percent) });
	}

	function closePremiumFeaturePreview(): void {
		premiumFeaturePreviewFeatureId = null;
	}

	function notifyPremiumUiStateChanged(): void {
		if (isPremiumLicenseActive) {
			closePremiumFeaturePreview();
		}
		void refreshReadingReferencePointState(book?.id);
		syncAsActiveEpubDocumentIfActive();
		onReadingPositionAutoSaveChange?.();
		onPremiumUiStateChange?.();
	}

	function handlePremiumFeaturePreviewRequest(event: Event): void {
		const featureId = String((event as CustomEvent<{ featureId?: string }>).detail?.featureId || '').trim();
		if (!featureId) {
			return;
		}
		openPremiumFeaturePreview(featureId);
	}

	function openPremiumFeaturePreview(featureId: string): void {
		const normalizedFeatureId = String(featureId || '').trim();
		if (!normalizedFeatureId) {
			return;
		}
		clearParagraphModeSelection();
		highlightToolbarInfo = null;
		closeCommentEditor();
		footnotePreviewInfo = null;
		exportNotesPopoverOpen = false;
		typographyPopoverOpen = false;
		premiumFeaturePreviewFeatureId = normalizedFeatureId;
	}

	function requestParagraphModeFeatureAccess(): boolean {
		if (hasParagraphModeCapability()) {
			return true;
		}
		if (isPremiumFeaturePreviewEnabled()) {
			openPremiumFeaturePreview(PREMIUM_FEATURES.EPUB_PARAGRAPH_MODE);
			return false;
		}
		return ensureEpubPremiumFeature(
			app,
			PREMIUM_FEATURES.EPUB_PARAGRAPH_MODE,
			t('epub.reader.paragraphModeFeatureNotice')
		);
	}

	function normalizeFootnoteClickActionForAccess(
		action: EpubReaderSettings['footnoteClickAction'] | undefined
	): EpubReaderSettings['footnoteClickAction'] {
		const normalizedAction = action === 'navigate' || action === 'preview' ? action : 'preview';
		return normalizedAction === 'preview' && !hasFootnotePreviewCapability()
			? 'navigate'
			: normalizedAction;
	}

	function normalizeReaderSettings(readerSettings: EpubReaderSettings): EpubReaderSettings {
		const normalizedSettings = normalizeEpubReaderSettingsForDevice(getReaderDeviceKind(), {
			...readerSettings,
			footnoteClickAction: normalizeFootnoteClickActionForAccess(readerSettings.footnoteClickAction),
		});

		return normalizedSettings;
	}

	function setError(message: string) {
		clearTransientStatus();
		errorMsg = message;
		loading = false;
	}

	function clearTransientStatus() {
		if (transientStatusTimer) {
			clearTimeout(transientStatusTimer);
			transientStatusTimer = null;
		}
		transientStatusText = '';
	}

	function showTransientStatus(message: string, durationMs = 2200) {
		if (transientStatusTimer) {
			clearTimeout(transientStatusTimer);
			transientStatusTimer = null;
		}
		transientStatusText = message;
		if (durationMs > 0) {
			transientStatusTimer = setTimeout(() => {
				transientStatusTimer = null;
				transientStatusText = '';
			}, durationMs);
		}
	}

	function clampReaderSetting(value: number, min: number, max: number, digits = 2): number {
		const clamped = Math.min(Math.max(value, min), max);
		return Number(clamped.toFixed(digits));
	}

	function openTypographyPanel() {
		typographyPopoverOpen = true;
	}

	function closeTypographyPanel() {
		typographyPopoverOpen = false;
	}

	function clearParagraphModeSelection(): void {
		paragraphModeSelection?.clear?.();
		paragraphModeSelection = null;
	}

	function updateParagraphModeAnchorParagraphId(location: { paragraphs: ReaderParagraph[]; currentIndex: number } | null): void {
		const paragraph = location?.paragraphs?.[location.currentIndex];
		paragraphModeAnchorParagraphId = paragraph?.id || '';
	}

	async function persistParagraphModeReadingPositionFromLocation(
		location: { paragraphs: ReaderParagraph[]; currentIndex: number } | null = paragraphModeLocation
	): Promise<void> {
		const currentBook = book;
		if (!currentBook || !location || location.paragraphs.length === 0) {
			return;
		}
		const activeIndex = Math.max(0, Math.min(location.currentIndex, location.paragraphs.length - 1));
		const paragraph = location.paragraphs[activeIndex];
		if (!paragraph?.id || !paragraph.cfiRange) {
			return;
		}
		const currentPosition = readerService.getCurrentPosition();
		const payload: EpubParagraphModeReadingPosition = {
			bookId: currentBook.id,
			filePath: currentBook.filePath,
			bookTitle: currentBook.metadata.title || '',
			chapterTitle: paragraph.chapterTitle || readerService.getCurrentChapterTitle() || '',
			chapterHref: paragraph.chapterHref || readerService.getCurrentChapterHref?.() || '',
			chapterIndex: paragraph.chapterIndex,
			cfi: paragraph.cfiRange,
			percent: Number.isFinite(currentPosition.percent) ? currentPosition.percent : 0,
			paragraphId: paragraph.id,
			paragraphIndex: activeIndex,
			paragraphTextPreview: paragraph.text.slice(0, 160),
			savedAt: Date.now(),
		};
		await storageService.saveParagraphModeReadingPosition(payload);
	}

	async function persistParagraphModeReadingProgress(
		location: { paragraphs: ReaderParagraph[]; currentIndex: number } | null = paragraphModeLocation
	): Promise<void> {
		if (paragraphModeDetachedSession) {
			return;
		}
		await persistParagraphModeReadingPositionFromLocation(location);
		const currentBook = book;
		if (!currentBook?.id || !hasReadingProgressCapability()) {
			return;
		}
		const currentPosition = readerService.getCurrentPosition();
		if (!currentPosition?.cfi) {
			return;
		}
		readerService.flushReadingPace?.();
		const readingStats = readerService.getReadingStats?.() ?? currentBook.readingStats;
		if (readingStats) {
			currentBook.readingStats = readingStats;
		}
		currentBook.currentPosition = currentPosition;
		await storageService.saveProgress(currentBook.id, currentPosition, readingStats);
		await flushEpubPendingProgress(storageService);
		await syncReadingReferencePointFromAutoSave(currentPosition);
		notifyBookshelfProgressChanged(currentBook.filePath);
	}

	async function showParagraphExitAnchor(paragraph: ReaderParagraph): Promise<void> {
		if (!paragraph.cfiRange || typeof readerService.navigateAndHighlight !== 'function') {
			return;
		}
		const anchorText = paragraph.text.slice(0, 120);
		try {
			await readerService.navigateAndHighlight({
				cfi: paragraph.cfiRange,
				text: anchorText,
				flashStyle: 'highlight',
			});
			window.setTimeout(() => {
				const rect = readerService.getNavigationTargetRect?.({
					cfi: paragraph.cfiRange,
					text: anchorText,
				});
				if (rect) {
					sourceLocateOverlay.showAtRect(rect, {
						label: t('epub.reader.paragraphMode.exitAnchor'),
						icon: 'bookmark',
						durationMs: 3200,
					});
				}
			}, 80);
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to show paragraph mode exit anchor:', error);
		}
	}

	function clearParagraphModeDetachedSession(): void {
		paragraphModeDetachedSession = false;
		paragraphModeDetachedSnapshot = null;
	}

	async function beginParagraphModeDetachedSession(): Promise<void> {
		const currentBook = book;
		if (!currentBook || paragraphModeDetachedSession) {
			return;
		}
		if (paragraphModePersistTimer) {
			clearTimeout(paragraphModePersistTimer);
			paragraphModePersistTimer = null;
			await persistParagraphModeReadingProgress();
		}
		const activeLocation = paragraphModeLocation;
		const activeIndex = activeLocation?.currentIndex ?? 0;
		const activeParagraph = activeLocation?.paragraphs?.[activeIndex];
		const livePosition = readerReady ? readerService.getCurrentPosition() : currentBook.currentPosition;
		const readingPosition: ReadingPosition = {
			chapterIndex:
				typeof livePosition?.chapterIndex === 'number'
					? livePosition.chapterIndex
					: currentBook.currentPosition?.chapterIndex || 0,
			cfi: String(livePosition?.cfi || currentBook.currentPosition?.cfi || '').trim(),
			percent:
				typeof livePosition?.percent === 'number' && Number.isFinite(livePosition.percent)
					? livePosition.percent
					: currentBook.currentPosition?.percent || 0,
		};
		if (!readingPosition.cfi) {
			return;
		}
		paragraphModeDetachedSnapshot = {
			readingPosition,
			paragraphId: activeParagraph?.id,
			paragraphIndex: activeIndex,
			paragraphTextPreview: activeParagraph?.text.slice(0, 120),
		};
		paragraphModeDetachedSession = true;
	}

	async function restoreParagraphModeDetachedSnapshot(
		snapshot: {
			readingPosition: ReadingPosition;
			paragraphId?: string;
			paragraphIndex?: number;
			paragraphTextPreview?: string;
		} | null = paragraphModeDetachedSnapshot
	): Promise<void> {
		if (!snapshot?.readingPosition?.cfi) {
			return;
		}
		try {
			await readerService.goToLocation(snapshot.readingPosition.cfi);
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to restore reading position after detached paragraph session:', error);
		}
	}

	async function showParagraphModeDetachedExitAnchor(
		snapshot: {
			readingPosition: ReadingPosition;
			paragraphTextPreview?: string;
		}
	): Promise<void> {
		if (!snapshot.readingPosition?.cfi || typeof readerService.navigateAndHighlight !== 'function') {
			return;
		}
		const anchorText = String(snapshot.paragraphTextPreview || '').trim();
		try {
			await readerService.navigateAndHighlight({
				cfi: snapshot.readingPosition.cfi,
				text: anchorText || undefined,
				flashStyle: 'highlight',
			});
			window.setTimeout(() => {
				const rect = readerService.getNavigationTargetRect?.({
					cfi: snapshot.readingPosition.cfi,
					text: anchorText || undefined,
				});
				if (rect) {
					sourceLocateOverlay.showAtRect(rect, {
						label: t('epub.reader.paragraphMode.exitAnchor'),
						icon: 'bookmark',
						durationMs: 3200,
					});
				}
			}, 80);
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to show detached paragraph mode exit anchor:', error);
		}
	}

	async function exitParagraphModeToMainReader(options?: {
		persist?: boolean;
		disableSetting?: boolean;
		showExitAnchor?: boolean;
		notifySaved?: boolean;
	}): Promise<void> {
		const activeLocation = paragraphModeLocation;
		const activeIndex = activeLocation?.currentIndex ?? 0;
		const activeParagraph = activeLocation?.paragraphs?.[activeIndex];
		const detachedSnapshot = paragraphModeDetachedSnapshot;
		const wasDetachedSession = paragraphModeDetachedSession;
		const shouldPersist = options?.persist !== false && Boolean(activeParagraph) && !wasDetachedSession;
		const shouldDisableSetting = options?.disableSetting !== false;
		const shouldShowExitAnchor = options?.showExitAnchor !== false;
		const shouldNotifySaved = options?.notifySaved !== false;

		// Disable paragraph mode before async persistence so reactive refresh cannot reopen the overlay.
		if (shouldDisableSetting && settings.paragraphModeEnabled) {
			applyAndPersistReaderSettings({
				...settings,
				paragraphModeEnabled: false,
			});
		}
		clearParagraphModeSelection();
		paragraphModeLocation = null;
		paragraphModeAnchorParagraphId = '';
		clearParagraphModeDetachedSession();
		await setParagraphModeImmersive(false);

		if (!shouldPersist && !shouldShowExitAnchor && !wasDetachedSession) {
			return;
		}

		void (async () => {
			if (wasDetachedSession && detachedSnapshot) {
				try {
					if (paragraphModePersistTimer) {
						clearTimeout(paragraphModePersistTimer);
						paragraphModePersistTimer = null;
					}
					await restoreParagraphModeDetachedSnapshot(detachedSnapshot);
					if (shouldShowExitAnchor) {
						await showParagraphModeDetachedExitAnchor(detachedSnapshot);
					}
				} catch (error) {
					logger.warn('[EpubReaderApp] Failed to restore detached paragraph mode reading position on exit:', error);
				}
				return;
			}
			if (shouldPersist && activeLocation) {
				try {
					if (paragraphModePersistTimer) {
						clearTimeout(paragraphModePersistTimer);
						paragraphModePersistTimer = null;
					}
					await persistParagraphModeReadingProgress(activeLocation);
					if (shouldNotifySaved) {
						showTransientStatus(t('epub.reader.paragraphMode.positionSaved'), 2200);
						new Notice(t('epub.reader.paragraphMode.positionSaved'));
					}
				} catch (error) {
					logger.warn('[EpubReaderApp] Failed to persist paragraph mode reading progress on exit:', error);
				}
			}
			if (shouldShowExitAnchor && activeParagraph?.cfiRange) {
				try {
					await showParagraphExitAnchor(activeParagraph);
				} catch (error) {
					logger.warn('[EpubReaderApp] Failed to show paragraph mode exit anchor:', error);
				}
			}
		})();
	}

	function setParagraphModeImmersiveClass(active: boolean): void {
		document.body.classList.toggle('weave-epub-immersive-paragraph-mode', active);
		document.documentElement.classList.toggle('weave-epub-immersive-paragraph-mode', active);
	}

	async function setParagraphModeImmersive(active: boolean): Promise<void> {
		if (paragraphModeImmersive === active) {
			return;
		}
		paragraphModeImmersive = active;
		setParagraphModeImmersiveClass(active);
		if (active) {
			try {
				const fullscreenHost = document.documentElement;
				if (document.fullscreenElement !== fullscreenHost) {
					await fullscreenHost.requestFullscreen?.();
				}
			} catch (error) {
				logger.warn('[EpubReaderApp] Failed to enter immersive fullscreen paragraph mode:', error);
			}
			return;
		}
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen?.();
			}
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to exit immersive fullscreen paragraph mode:', error);
		}
	}

	function toggleParagraphModeImmersive(): void {
		void setParagraphModeImmersive(!paragraphModeImmersive);
	}

	function handleFullscreenChange(): void {
		const active = Boolean(document.fullscreenElement);
		if (!active && paragraphModeImmersive) {
			paragraphModeImmersive = false;
			setParagraphModeImmersiveClass(false);
		}
	}

	async function closeParagraphMode(options?: { persist?: boolean }): Promise<void> {
		try {
			await exitParagraphModeToMainReader({
				persist: options?.persist,
				disableSetting: options?.persist !== false,
				showExitAnchor: true,
				notifySaved: options?.persist !== false,
			});
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to close paragraph mode:', error);
			if (settings.paragraphModeEnabled) {
				applyAndPersistReaderSettings({
					...settings,
					paragraphModeEnabled: false,
				});
			}
			clearParagraphModeSelection();
			paragraphModeLocation = null;
			paragraphModeAnchorParagraphId = '';
			await setParagraphModeImmersive(false);
		}
	}

	function scheduleParagraphModePersist(): void {
		if (paragraphModeDetachedSession) {
			return;
		}
		if (paragraphModePersistTimer) {
			clearTimeout(paragraphModePersistTimer);
		}
		paragraphModePersistTimer = setTimeout(() => {
			paragraphModePersistTimer = null;
			void persistParagraphModeReadingProgress();
		}, PARAGRAPH_MODE_PERSIST_DEBOUNCE_MS);
	}

	function applyParagraphModeIndex(
		location: { paragraphs: ReaderParagraph[]; currentIndex: number },
		targetIndex: number
	): void {
		const boundedIndex = Math.max(0, Math.min(targetIndex, location.paragraphs.length - 1));
		paragraphModeLocation = {
			paragraphs: location.paragraphs,
			currentIndex: boundedIndex,
		};
		updateParagraphModeAnchorParagraphId(paragraphModeLocation);
	}

	async function hydrateParagraphModeActiveParagraph(targetIndex: number): Promise<void> {
		const location = paragraphModeLocation;
		const paragraph = location?.paragraphs?.[targetIndex];
		if (!paragraph?.id || typeof readerService.hydrateReaderParagraph !== 'function') {
			return;
		}
		if (paragraph.html) {
			return;
		}
		const hydrated = await readerService.hydrateReaderParagraph(paragraph.id);
		if (!hydrated || paragraphModeLocation?.paragraphs?.[targetIndex]?.id !== paragraph.id) {
			return;
		}
		const paragraphs = [...paragraphModeLocation.paragraphs];
		paragraphs[targetIndex] = hydrated;
		paragraphModeLocation = {
			paragraphs,
			currentIndex: paragraphModeLocation.currentIndex,
		};
	}

	async function syncParagraphModeAnchor(cfi: string): Promise<void> {
		if (typeof readerService.syncParagraphAnchor === 'function') {
			await readerService.syncParagraphAnchor(cfi);
			return;
		}
		await readerService.goToLocation(cfi);
	}

	async function refreshParagraphModeLocation(
		preferredIndex?: number,
		preferredParagraphId?: string,
		options?: { persist?: boolean }
	): Promise<void> {
		if (!settings.paragraphModeEnabled || !readerReady || typeof readerService.getCurrentParagraphLocation !== 'function') {
			paragraphModeLocation = null;
			return;
		}
		paragraphModeBusy = true;
		try {
			const location = await readerService.getCurrentParagraphLocation({
				preferredIndex,
				preferredParagraphId,
			});
			if (!location || location.paragraphs.length === 0) {
				paragraphModeLocation = null;
				paragraphModeAnchorParagraphId = '';
				return;
			}
			paragraphModeLocation = location;
			updateParagraphModeAnchorParagraphId(location);
			if (options?.persist !== false && !paragraphModeDetachedSession) {
				scheduleParagraphModePersist();
			}
		} finally {
			paragraphModeBusy = false;
		}
	}

	async function setParagraphModeEnabled(enabled: boolean): Promise<void> {
		if (enabled && !requestParagraphModeFeatureAccess()) {
			return;
		}
		if (enabled === settings.paragraphModeEnabled) {
			if (enabled) {
				await refreshParagraphModeLocation(undefined, paragraphModeAnchorParagraphId || undefined);
			}
			return;
		}
		clearParagraphModeSelection();
		highlightToolbarInfo = null;
		closeCommentEditor();
		footnotePreviewInfo = null;
		referencePopoverInfo = null;
		referencePopoverStats = null;
		screenshotMode = false;
		if (!enabled) {
			await exitParagraphModeToMainReader({
				persist: true,
				disableSetting: true,
				showExitAnchor: true,
				notifySaved: false,
			});
			return;
		}
		applyAndPersistReaderSettings({
			...settings,
			paragraphModeEnabled: true,
		});
		const savedParagraphPosition = book
			? await storageService.loadParagraphModeReadingPosition(book.id)
			: null;
		if (savedParagraphPosition?.cfi) {
			try {
				await readerService.goToLocation(savedParagraphPosition.cfi);
			} catch (error) {
				logger.warn('[EpubReaderApp] Failed to restore paragraph mode reading position:', error);
			}
		}
		await refreshParagraphModeLocation();
		if (savedParagraphPosition?.paragraphId && paragraphModeLocation?.paragraphs?.length) {
			const restoredIndex = paragraphModeLocation.paragraphs.findIndex(
				(item) => item.id === savedParagraphPosition.paragraphId
			);
			if (restoredIndex >= 0) {
				await refreshParagraphModeLocation(restoredIndex);
			}
		}
	}

	function toggleParagraphMode(): void {
		void setParagraphModeEnabled(!settings.paragraphModeEnabled);
	}

	async function setParagraphModeTransitionStyle(nextStyle: EpubParagraphModeTransitionStyle): Promise<void> {
		if (nextStyle === settings.paragraphModeTransitionStyle) {
			return;
		}
		await updateReaderSettings({
			paragraphModeTransitionStyle: nextStyle,
		});
	}

	async function navigateToRandomParagraph(): Promise<void> {
		if (!settings.paragraphModeEnabled || paragraphModeBusy || !readerReady) {
			return;
		}
		if (typeof readerService.pickRandomParagraph !== 'function') {
			return;
		}
		const shouldStartDetachedSession = !paragraphModeDetachedSession;
		if (shouldStartDetachedSession) {
			await beginParagraphModeDetachedSession();
			if (!paragraphModeDetachedSession) {
				return;
			}
		}
		const currentParagraph = paragraphModeLocation?.paragraphs?.[paragraphModeLocation.currentIndex];
		const pick = await readerService.pickRandomParagraph({
			excludeParagraphId: currentParagraph?.id,
		});
		if (!pick?.paragraph?.cfiRange) {
			if (shouldStartDetachedSession) {
				clearParagraphModeDetachedSession();
			}
			showTransientStatus(t('epub.reader.paragraphMode.randomReadingUnavailable'), 2200);
			return;
		}

		paragraphModeBusy = true;
		paragraphModeSuppressReactiveRefresh += 1;
		try {
			clearParagraphModeSelection();
			applyParagraphModeIndex(
				{ paragraphs: pick.chapterParagraphs, currentIndex: pick.paragraphIndex },
				pick.paragraphIndex
			);
			void hydrateParagraphModeActiveParagraph(pick.paragraphIndex);
			try {
				await syncParagraphModeAnchor(pick.paragraph.cfiRange);
			} catch (error) {
				logger.warn('[EpubReaderApp] Failed to navigate to random paragraph:', error);
				return;
			}
			await refreshParagraphModeLocation(pick.paragraphIndex, pick.paragraph.id, { persist: false });
		} finally {
			paragraphModeLastNavigationAt = Date.now();
			paragraphModeSuppressReactiveRefresh = Math.max(0, paragraphModeSuppressReactiveRefresh - 1);
			paragraphModeBusy = false;
		}
	}

	async function navigateParagraphRelative(direction: -1 | 1): Promise<void> {
		const currentLocation = paragraphModeLocation;
		if (!currentLocation || currentLocation.paragraphs.length === 0 || paragraphModeBusy) {
			return;
		}
		paragraphModeBusy = true;
		paragraphModeSuppressReactiveRefresh += 1;
		try {
			const targetIndex = currentLocation.currentIndex + direction;
			if (targetIndex < 0 || targetIndex >= currentLocation.paragraphs.length) {
				const targetChapterIndex = readerService.getCurrentChapterIndex() + direction;
				if (typeof readerService.getParagraphsForChapter !== 'function' || targetChapterIndex < 0) {
					return;
				}
				const nextChapterParagraphs = await readerService.getParagraphsForChapter(targetChapterIndex, {
					includeHtml: false,
				});
				if (nextChapterParagraphs.length === 0) {
					return;
				}
				const crossChapterIndex = direction > 0 ? 0 : nextChapterParagraphs.length - 1;
				const paragraph = nextChapterParagraphs[crossChapterIndex];
				clearParagraphModeSelection();
				applyParagraphModeIndex(
					{ paragraphs: nextChapterParagraphs, currentIndex: crossChapterIndex },
					crossChapterIndex
				);
				void hydrateParagraphModeActiveParagraph(crossChapterIndex);
				try {
					await syncParagraphModeAnchor(paragraph.cfiRange);
				} catch (error) {
					logger.warn('[EpubReaderApp] Failed to navigate paragraph across chapters:', error);
				}
				await refreshParagraphModeLocation(crossChapterIndex, paragraph.id, { persist: false });
				scheduleParagraphModePersist();
				return;
			}

			const paragraph = currentLocation.paragraphs[targetIndex];
			if (!paragraph?.cfiRange) {
				return;
			}
			clearParagraphModeSelection();
			applyParagraphModeIndex(currentLocation, targetIndex);
			void hydrateParagraphModeActiveParagraph(targetIndex);
			try {
				await syncParagraphModeAnchor(paragraph.cfiRange);
			} catch (error) {
				logger.warn('[EpubReaderApp] Failed to navigate paragraph within chapter:', error);
			}
			scheduleParagraphModePersist();
		} finally {
			paragraphModeLastNavigationAt = Date.now();
			paragraphModeSuppressReactiveRefresh = Math.max(0, paragraphModeSuppressReactiveRefresh - 1);
			paragraphModeBusy = false;
		}
	}

	async function handleParagraphOverlaySelectionChange(selection: {
		text: string;
		startOffset: number;
		endOffset: number;
		rect: DOMRect;
		rects: DOMRect[];
		clear: () => void;
	} | null): Promise<void> {
		if (!selection || !paragraphModeLocation || typeof readerService.resolveParagraphSelection !== 'function') {
			paragraphModeSelection = null;
			return;
		}

		const paragraph = paragraphModeLocation.paragraphs[paragraphModeLocation.currentIndex];
		if (!paragraph) {
			paragraphModeSelection = null;
			return;
		}

		const resolved = await readerService.resolveParagraphSelection(
			paragraph.id,
			selection.startOffset,
			selection.endOffset
		);
		if (!resolved?.cfiRange) {
			paragraphModeSelection = null;
			return;
		}

		paragraphModeSelection = {
			text: resolved.text || selection.text,
			cfiRange: resolved.cfiRange,
			rect: selection.rect,
			rects: selection.rects,
			clear: selection.clear,
		};
	}

	async function handleParagraphFootnoteActivate(info: {
		href: string;
		label?: string;
		pinned?: boolean;
		rect?: DOMRect;
	}): Promise<void> {
		if (typeof readerService.openParagraphFootnotePreview !== 'function' || !paragraphModeLocation) {
			return;
		}
		const paragraph = paragraphModeLocation.paragraphs[paragraphModeLocation.currentIndex];
		if (!paragraph?.id || !info?.href) {
			return;
		}
		try {
			await readerService.openParagraphFootnotePreview(paragraph.id, info.href, info.label, {
				pinned: info.pinned === true,
				rect: info.rect
					? {
							top: info.rect.top,
							left: info.rect.left,
							bottom: info.rect.bottom,
							right: info.rect.right,
							width: info.rect.width,
							height: info.rect.height,
						}
					: undefined,
			});
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to open paragraph footnote preview:', error);
		}
	}

	function dismissParagraphFootnotePreview(options?: { unpin?: boolean }): void {
		readerService.dismissParagraphFootnotePreview?.(options);
	}

	function handleParagraphHighlightActivate(info: {
		cfiRange: string;
		rect: DOMRect;
		rects: DOMRect[];
	}): void {
		if (!hasExcerptNotesCapability() || !readerService.getHighlightClickInfo) {
			return;
		}
		footnotePreviewInfo = null;
		referencePopoverInfo = null;
		referencePopoverStats = null;
		closeCommentEditor();
		const clickInfo = readerService.getHighlightClickInfo(info.cfiRange, 'highlight', {
			rect: {
				top: info.rect.top,
				left: info.rect.left,
				bottom: info.rect.bottom,
				right: info.rect.right,
				width: info.rect.width,
				height: info.rect.height,
			},
			rects: info.rects.map((rect) => ({
				top: rect.top,
				left: rect.left,
				bottom: rect.bottom,
				right: rect.right,
				width: rect.width,
				height: rect.height,
			})),
			anchorPoint: {
				x: info.rect.left + info.rect.width / 2,
				y: info.rect.top + info.rect.height / 2,
			},
		});
		if (!clickInfo) {
			return;
		}
		const candidates = collectAnnotationCandidatesAtHighlight(clickInfo);
		if (candidates.length > 1) {
			highlightToolbarInfo = null;
			annotationDisambiguationAnchor = clickInfo;
			annotationDisambiguationCandidates = candidates;
			return;
		}
		openAnnotationActions(clickInfo);
	}

	function applyReaderSettingsState(nextSettings: EpubReaderSettings, persist: boolean) {
		const normalizedSettings = normalizeReaderSettings(nextSettings);
		settings = normalizedSettings;
		readerService.setFootnoteClickAction?.(normalizedSettings.footnoteClickAction);
		onReaderSettingsLoaded?.(normalizedSettings);
		if (persist) {
			void storageService.saveReaderSettings(normalizedSettings);
		}
	}

	async function updateReaderSettings(patch: Partial<EpubReaderSettings>) {
		applyAndPersistReaderSettings({
			...settings,
			...patch,
		});
	}

	function previewReaderSettings(nextSettings: EpubReaderSettings) {
		applyReaderSettingsState(nextSettings, false);
	}

	function persistCurrentReaderSettings() {
		applyReaderSettingsState(settings, true);
	}

	function previewReaderLineHeight(value: string) {
		previewReaderSettings({
			...settings,
			lineHeight: clampReaderSetting(Number(value), 1.2, 2.4),
		});
	}

	function previewReaderLetterSpacing(value: string) {
		previewReaderSettings({
			...settings,
			letterSpacing: clampReaderSetting(Number(value), -0.02, 0.24, 3),
		});
	}

	function previewReaderPageMargin(value: string) {
		previewReaderSettings({
			...settings,
			pageMargin: clampReaderSetting(Number(value), 8, 96, 0),
		});
	}

	function setReaderWidthMode(mode: EpubReaderSettings['widthMode']) {
		if (settings.layoutMode === 'double' && mode !== 'fit') {
			return;
		}
		applyAndPersistReaderSettings({
			...settings,
			widthMode: mode,
		});
	}

	function setFootnoteClickAction(action: EpubReaderSettings['footnoteClickAction']) {
		applyAndPersistReaderSettings({
			...settings,
			footnoteClickAction: action,
		});
	}

	function resetReaderTypographySettings() {
		applyAndPersistReaderSettings({
			...settings,
			lineHeight: getDefaultReaderLineHeight(),
			letterSpacing: 0,
			pageMargin: getDefaultReaderPageMargin(),
			widthMode: settings.layoutMode === 'double' ? 'fit' : getDefaultReaderWidthMode(),
			showScrolledSideNav: true,
			footnoteClickAction: 'preview',
			paragraphModeFontSize: 'medium',
			paragraphModeFontScale: 100,
			paragraphModeSurfaceStyle: 'spotlight',
			paragraphModeTransitionStyle: 'settle',
		});
	}

	function formatLetterSpacingValue(value: number): string {
		return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
	}

	function handleTypographyPointerDownOutside(event: MouseEvent) {
		if (!typographyPopoverOpen) {
			return;
		}
		const target = event.target as HTMLElement | null;
		if (target?.closest?.('.epub-settings-float')) {
			return;
		}
		closeTypographyPanel();
	}

	function updateReadingReferencePointState(point: EpubReadingReferencePoint | null) {
		readingReferencePoint = point;
		onReadingReferencePointChange?.(point);
	}

	function updateSessionReadingStartPercent(value: number | null | undefined) {
		sessionReadingStartPercent = typeof value === 'number' && Number.isFinite(value)
			? Math.max(0, value)
			: null;
	}

	function clearReaderStoreSyncTimer() {
		if (readerStoreSyncTimer) {
			clearTimeout(readerStoreSyncTimer);
			readerStoreSyncTimer = null;
		}
		pendingReaderStorePatch = {};
	}

	function isActiveEpubReaderInstance(leaf: WorkspaceLeaf | null = app.workspace.activeLeaf): boolean {
		if (!leaf) {
			return false;
		}
		const activePath = getOpenEpubFilePath(leaf);
		const currentPath = normalizePath(String(filePath || '').trim());
		if (currentPath) {
			return !!activePath && pathsReferToSameOpenBook(activePath, currentPath);
		}
		return !activePath;
	}

	function flushReaderStoreSync() {
		clearReaderStoreSyncTimer();
		const patch = pendingReaderStorePatch;
		pendingReaderStorePatch = {};
		if (Object.keys(patch).length > 0 && isActiveEpubReaderInstance()) {
			epubActiveDocumentStore.setSharedState(patch);
		}
	}

	function scheduleReaderStoreSync(patch: Record<string, unknown>) {
		if (!isActiveEpubReaderInstance()) {
			return;
		}
		pendingReaderStorePatch = { ...pendingReaderStorePatch, ...patch };
		if (readerStoreSyncTimer) {
			return;
		}
		readerStoreSyncTimer = setTimeout(() => {
			readerStoreSyncTimer = null;
			const nextPatch = pendingReaderStorePatch;
			pendingReaderStorePatch = {};
			if (Object.keys(nextPatch).length > 0 && isActiveEpubReaderInstance()) {
				epubActiveDocumentStore.setSharedState(nextPatch);
			}
		}, READER_STORE_SYNC_MS);
	}

	function isStaleBookLoad(loadToken: number): boolean {
		return componentDisposed || loadToken !== activeBookLoadToken;
	}

	function normalizeTrackedVaultPath(path?: string | null): string {
		return normalizePath(String(path || '').trim());
	}

	function rememberHighlightSourcePath(path?: string | null) {
		const normalizedPath = normalizeTrackedVaultPath(path);
		if (!normalizedPath) {
			return;
		}
		trackedHighlightSourceFiles.add(normalizedPath);
	}

	function collectTrackedHighlightSourceFiles(highlights: ReaderHighlight[]): Set<string> {
		const trackedPaths = new Set<string>();
		for (const highlight of highlights) {
			const primarySourceFile = normalizeTrackedVaultPath(highlight.sourceFile);
			if (primarySourceFile) {
				trackedPaths.add(primarySourceFile);
			}
			for (const locator of highlight.sourceLocators || []) {
				const locatorSourceFile = normalizeTrackedVaultPath(locator?.sourceFile);
				if (locatorSourceFile) {
					trackedPaths.add(locatorSourceFile);
				}
			}
		}
		return trackedPaths;
	}

	function markCollectedHighlightsStale(): void {
		pendingCollectedHighlights = null;
	}

	function getBoundCanvasPath(): string | null {
		const canvasPath = normalizeTrackedVaultPath(canvasService.getCanvasPath());
		return canvasPath || null;
	}

	type HighlightReloadOptions = {
		invalidateCache?: boolean;
		incremental?: boolean;
		forceReaderReplace?: boolean;
	};

	function buildCollectHighlightsOptions(options: {
		additionalSourcePaths?: string[];
		diskIncremental?: boolean;
	} = {}) {
		const result: {
			additionalSourcePaths?: string[];
			diskIncremental?: boolean;
			annotationVersionId?: string;
		} = { ...options };
		if (annotationCompareVersionId) {
			result.annotationVersionId = annotationCompareVersionId;
		}
		return Object.keys(result).length > 0 ? result : undefined;
	}

	function reloadHighlightsAfterExcerptMutation(sourcePath?: string | null) {
		rememberHighlightSourcePath(sourcePath);
		void reloadHighlights({ incremental: true });
	}

	function mergeHighlightReloadOptions(
		current: HighlightReloadOptions,
		incoming: HighlightReloadOptions
	): HighlightReloadOptions {
		return {
			invalidateCache: current.invalidateCache === true || incoming.invalidateCache === true,
			incremental: current.incremental === true && incoming.incremental === true,
			forceReaderReplace:
				current.forceReaderReplace === true || incoming.forceReaderReplace === true,
		};
	}

	function queueHighlightReload(delayMs = 350, options: HighlightReloadOptions = {}) {
		if (componentDisposed) {
			return;
		}
		deferredHighlightReloadOptions = deferredHighlightReloadTimer
			? mergeHighlightReloadOptions(deferredHighlightReloadOptions, options)
			: { ...options };
		if (deferredHighlightReloadTimer) {
			clearTimeout(deferredHighlightReloadTimer);
		}
		deferredHighlightReloadTimer = setTimeout(() => {
			deferredHighlightReloadTimer = null;
			const mergedOptions = deferredHighlightReloadOptions;
			deferredHighlightReloadOptions = {};
			if (!componentDisposed) {
				const incremental = mergedOptions.incremental === true;
				void reloadHighlights({
					invalidateCache: mergedOptions.invalidateCache === true,
					incremental,
					forceReaderReplace: mergedOptions.forceReaderReplace === true,
				});
			}
		}, delayMs);
	}

	function prefetchAnnotationIndexForBook(
		loadedBook: EpubBook,
		targetFilePath: string,
		options?: { priority?: 'immediate' | 'background' }
	) {
		if (!hasExcerptNotesCapability()) {
			return;
		}
		void getEpubAnnotationIndexService(app).prefetchBook({
			bookId: portableBookId || loadedBook.id,
			filePath: targetFilePath,
			showStrikethroughHighlights: excerptSettings.showStrikethroughInSidebar,
			annotationService,
			backlinkService,
			readerService,
			highlightRevision: annotationRevision,
			priority: options?.priority ?? 'immediate',
		});
	}

	function publishSidebarHighlights(highlights: ReaderHighlight[]) {
		if (!book || !hasExcerptNotesCapability()) {
			return;
		}
		const nextRevision = annotationRevision + 1;
		highlightViewSnapshotService.publishFromHighlights({
			bookId: getCurrentAnnotationBookId(),
			filePath,
			showStrikethroughHighlights: excerptSettings.showStrikethroughInSidebar,
			revision: nextRevision,
			highlights,
			readerService,
		});
		annotationRevision = nextRevision;
		epubActiveDocumentStore.setSharedState({ annotationRevision });
	}

	function applyReferenceStatsToHighlights(highlights: ReaderHighlight[]): ReaderHighlight[] {
		const referenceStats = referenceStatsService.computeReferenceStatsFromHighlights(
			highlights,
			filePath,
			getBoundCanvasPath()
		);

		return highlights.map((highlight) => {
			const normalizedCfi = EpubLinkService.normalizeCfi(highlight.cfiRange);
			const stats = referenceStats.get(normalizedCfi);
			return {
				...highlight,
				referenceCount: stats?.referenceCount || 1,
				referenceHeat: stats?.referenceHeat || 0,
			};
		});
	}

	function getEpubActionHost() {
		return resolveEpubHost(app);
	}

	function getHostReaderUiMode(): EpubReaderUiMode {
		const host = resolveEpubHost(app) as {
			settings?: {
				readerUiMode?: unknown;
				expertModeEnabled?: unknown;
			};
		} | null;
		return normalizeEpubReaderUiMode(
			host?.settings?.readerUiMode,
			host?.settings?.expertModeEnabled
		);
	}

	function getHostSemanticSettings(): unknown {
		const host = resolveEpubHost(app) as { settings?: unknown } | null;
		return host?.settings || {};
	}

	async function resolvePortableBookIdForBook(
		targetBook: EpubBook | null | undefined,
		targetFilePath = filePath
	): Promise<string> {
		const runtimeBookId = String(targetBook?.id || '').trim();
		if (!runtimeBookId) {
			return '';
		}
		return (
			await findEpubPortableBookIdByIdentity(app, {
				bookId: runtimeBookId,
				sourceId: targetBook?.sourceId,
				sourceFingerprint: targetBook?.sourceFingerprint,
				filePath: targetFilePath || targetBook?.filePath,
				knownPaths: targetBook?.filePath && targetBook.filePath !== targetFilePath
					? [targetBook.filePath]
					: [],
			})
		) || runtimeBookId;
	}

	async function syncPortableBookIdForCurrentBook(): Promise<string> {
		const nextBookId = await resolvePortableBookIdForBook(book, filePath);
		if (nextBookId) {
			portableBookId = nextBookId;
		}
		return nextBookId;
	}

	function getCurrentAnnotationBookId(): string {
		return portableBookId || String(book?.id || '').trim();
	}

	async function refreshSemanticSettings(options?: {
		reloadHighlights?: boolean;
		semanticOnly?: boolean;
	}): Promise<void> {
		const token = ++semanticSettingsLoadToken;
		try {
			const fallbackSettings = getHostSemanticSettings();
			const semanticBookId = book?.id ? await syncPortableBookIdForCurrentBook() : '';
			const nextSettings = semanticBookId
				? (await loadEffectiveEpubSemanticProfile(app, semanticBookId, fallbackSettings)).settings
				: normalizeEpubSemanticSettings(fallbackSettings);
			if (componentDisposed || token !== semanticSettingsLoadToken) {
				return;
			}
			semanticSettings = normalizeEpubSemanticSettings(nextSettings);
			if (options?.reloadHighlights && readerReady) {
				if (options.semanticOnly && await refreshSemanticPresentationFromCache()) {
					return;
				}
				void reloadHighlights({ invalidateCache: true });
			}
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to load semantic profile:', error);
			if (token === semanticSettingsLoadToken) {
				semanticSettings = normalizeEpubSemanticSettings(getHostSemanticSettings());
			}
		}
	}

	function findSemanticById(semanticId?: string): EpubAnnotationSemantic | null {
		const id = String(semanticId || '').trim();
		if (!id || semanticSettings.annotationSemanticsEnabled === false) {
			return null;
		}
		return (activeSemanticEntries(semanticSettings) as EpubAnnotationSemantic[])
			.find((semantic) => String(semantic.id || '').trim() === id) || null;
	}

	function resolveSemanticFromHighlightInfo(info: HighlightClickInfo): EpubAnnotationSemantic | undefined {
		const semantic = findSemanticById(info.semanticId);
		if (semantic) {
			return semantic;
		}
		const id = String(info.semanticId || '').trim();
		if (!id) {
			return undefined;
		}
		return {
			id,
			label: info.semanticLabel || id,
			color: info.color || 'yellow',
			style: info.style || 'highlight',
			group: info.semanticGroup || 'study',
			description: info.semanticDescription || '',
			source: info.semanticSource || 'custom',
			active: true,
		};
	}

	function toReaderHighlightStyle(style?: string): EpubHighlightStyle | undefined {
		const normalized = normalizeAnnotationStyle(style);
		return normalized === 'highlight' ? undefined : normalized as EpubHighlightStyle;
	}

	function applySemanticPresentation(highlight: ReaderHighlight): ReaderHighlight {
		const semantic = findSemanticById(highlight.semanticId);
		if (!semantic) {
			return highlight;
		}
		const style = toReaderHighlightStyle(semantic.style);
		return {
			...highlight,
			color: semantic.color || highlight.color || 'yellow',
			style,
			semanticId: semantic.id,
			semanticLabel: semantic.label,
			semanticGroup: semantic.group || highlight.semanticGroup,
			semanticDescription: semantic.description || highlight.semanticDescription,
			semanticSource: semantic.source || highlight.semanticSource || 'preset',
		};
	}

	function applySemanticPresentationToHighlights(highlights: ReaderHighlight[]): ReaderHighlight[] {
		if (semanticSettings.annotationSemanticsEnabled === false) {
			return highlights;
		}
		return highlights.map((highlight) => applySemanticPresentation(highlight));
	}

	async function refreshSemanticPresentationFromCache(): Promise<boolean> {
		if (!book || !readerReady || !pendingCollectedHighlights) {
			return false;
		}
		const reloadToken = ++highlightReloadToken;
		highlightReloading = true;
		try {
			const previousHighlights = pendingLoadedHighlights || [];
			const highlightsWithStats = applyReferenceStatsToHighlights(
				applySemanticPresentationToHighlights(pendingCollectedHighlights)
			);
			if (componentDisposed || reloadToken !== highlightReloadToken) {
				return true;
			}
			pendingLoadedHighlights = highlightsWithStats;
			trackedHighlightSourceFiles = collectTrackedHighlightSourceFiles(highlightsWithStats);
			getExcerptPipeline().syncCollectedHighlights(highlightsWithStats);
			await readerService.applyHighlights(highlightsWithStats, { preserveAnchorCache: true });
			if (componentDisposed || reloadToken !== highlightReloadToken) {
				return true;
			}
			publishSidebarHighlights(highlightsWithStats);
			if (highlightToolbarInfo) {
				const toolbarKey = getReaderHighlightIdentityKey(
					buildHighlightIdentityFields(highlightToolbarInfo)
				);
				const nextToolbarInfo = highlightsWithStats.find(
					(highlight) => getReaderHighlightIdentityKey(highlight) === toolbarKey
				);
				if (nextToolbarInfo) {
					highlightToolbarInfo = {
						...highlightToolbarInfo,
						color: nextToolbarInfo.color,
						style: nextToolbarInfo.style,
						semanticLabel: nextToolbarInfo.semanticLabel,
						semanticGroup: nextToolbarInfo.semanticGroup,
						semanticDescription: nextToolbarInfo.semanticDescription,
						semanticSource: nextToolbarInfo.semanticSource,
					};
				} else if (previousHighlights.length !== highlightsWithStats.length) {
					highlightToolbarInfo = null;
				}
			}
			return true;
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to refresh semantic highlight presentation:', error);
			return false;
		} finally {
			if (reloadToken === highlightReloadToken) {
				highlightReloading = false;
			}
		}
	}

	function clearReaderSelection(frame?: { window?: Window | null; frameDocument?: Document | null }): void {
		try {
			frame?.window?.getSelection?.()?.removeAllRanges?.();
			frame?.frameDocument?.getSelection?.()?.removeAllRanges?.();
			activeDocument.getSelection?.()?.removeAllRanges?.();
			window.getSelection?.()?.removeAllRanges?.();
		} catch {
			// Selection cleanup is best effort across EPUB iframe boundaries.
		}
	}

	function getContinuousReadingPositionAutoSaveConfig(): { enabled: boolean; pages: number } {
		const host = getEpubActionHost() as {
			settings?: {
				continuousReadingPositionAutoSaveEnabled?: unknown;
				continuousReadingPositionAutoSavePages?: unknown;
			};
		} | null;

		return {
			enabled: normalizeContinuousReadingPositionAutoSaveEnabled(
				host?.settings?.continuousReadingPositionAutoSaveEnabled
			),
			pages: normalizeContinuousReadingPositionAutoSavePages(
				host?.settings?.continuousReadingPositionAutoSavePages
			),
		};
	}

	async function setContinuousReadingPositionAutoSaveEnabled(enabled: boolean): Promise<boolean> {
		const host = getEpubActionHost() as
			| ({
				settings?: {
					continuousReadingPositionAutoSaveEnabled?: unknown;
					continuousReadingPositionAutoSavePages?: unknown;
				};
				saveSettings?: () => Promise<void>;
			})
			| null;
		const normalizedEnabled = normalizeContinuousReadingPositionAutoSaveEnabled(enabled);
		if (!host?.settings) {
			return normalizedEnabled;
		}
		host.settings.continuousReadingPositionAutoSaveEnabled = normalizedEnabled;
		if (host.settings.continuousReadingPositionAutoSavePages == null) {
			host.settings.continuousReadingPositionAutoSavePages =
				DEFAULT_CONTINUOUS_READING_POSITION_AUTO_SAVE_PAGES;
		}
		await host.saveSettings?.();
		return normalizedEnabled;
	}

	const bookshelfProgressChangedNotifier = createDebouncedBookshelfProgressChangedNotifier();

	function notifyBookshelfProgressChanged(bookPath?: string) {
		bookshelfProgressChangedNotifier.notify(bookPath);
	}

	async function persistCurrentReadingProgress(
		targetBook: EpubBook | null = book
	): Promise<boolean> {
		if (!hasReadingProgressCapability()) {
			await flushEpubPendingProgress(storageService);
			return false;
		}
		if (!targetBook?.id) {
			await flushEpubPendingProgress(storageService);
			return false;
		}

		const fallbackPosition = targetBook.currentPosition;
		const livePosition = readerReady ? readerService.getCurrentPosition() : fallbackPosition;
		const currentCfi = String(
			livePosition?.cfi || readerService.getCurrentCFI() || fallbackPosition?.cfi || ''
		).trim();

		const position = currentCfi
			? {
				chapterIndex:
					typeof livePosition?.chapterIndex === 'number'
						? livePosition.chapterIndex
						: fallbackPosition?.chapterIndex || 0,
				cfi: currentCfi,
				percent:
					typeof livePosition?.percent === 'number' && Number.isFinite(livePosition.percent)
						? livePosition.percent
						: fallbackPosition?.percent || 0,
			}
			: fallbackPosition;

		if (!position?.cfi) {
			await flushEpubPendingProgress(storageService);
			return false;
		}

		readerService.flushReadingPace?.();
		const readingStats = readerService.getReadingStats?.() ?? targetBook.readingStats;
		if (readingStats) {
			targetBook.readingStats = readingStats;
		}
		targetBook.currentPosition = position;
		await storageService.saveProgress(targetBook.id, position, readingStats);
		await flushEpubPendingProgress(storageService);
		notifyBookshelfProgressChanged(targetBook.filePath);
		return true;
	}

	const EXCERPT_SETTINGS_CHANGED_EVENT = EPUB_RUNTIME.events.excerptSettingsChanged;
	const EPUB_PENDING_NAVIGATION_KEY = EPUB_RUNTIME.globals.pendingNavigationKey;
	const EPUB_NAVIGATE_EVENT = EPUB_RUNTIME.events.navigate;
	const LEGACY_EPUB_PENDING_NAVIGATION_KEY = EPUB_PENDING_NAVIGATION_KEY === '__weaveEpubStandalonePendingNav'
		? '__weaveEpubPendingNav'
		: null;
	const LEGACY_EPUB_NAVIGATE_EVENT = EPUB_NAVIGATE_EVENT === 'WeaveEpubStandalone:epub-navigate'
		? 'Weave:epub-navigate'
		: null;

	function syncReadingProgressDisplay(rawPercent?: number): void {
		const currentBook = book;
		if (!currentBook) {
			readingProgress = 0;
			return;
		}
		readingProgress = resolveDisplayProgress(currentBook, rawPercent);
	}

	async function markCurrentBookCompleted(): Promise<void> {
		const currentBook = book;
		if (!currentBook?.id || !hasReadingProgressCapability()) {
			return;
		}
		const updated = await storageService.markBookCompleted(currentBook.id);
		if (!updated) {
			return;
		}
		currentBook.readingStats = updated.readingStats;
		syncReadingProgressDisplay();
		epubActiveDocumentStore.setSharedState({
			progress: readingProgress,
		});
		notifyBookshelfProgressChanged(currentBook.filePath);
		const title = currentBook.metadata.title?.trim() || currentBook.filePath;
		new Notice(t('epub.reader.bookCompletionMarked', { title }));
	}

	async function handleBookEndAdvanceAttempt(): Promise<boolean> {
		if (!hasReadingProgressCapability()) {
			return false;
		}
		const currentBook = book;
		if (!currentBook?.id || !readerService.isAtBookEnd?.()) {
			return false;
		}
		if (isBookCompleted(currentBook.readingStats)) {
			return true;
		}
		if (bookCompletionPromptOpen) {
			return true;
		}
		if (bookCompletionPromptDismissedBookId === currentBook.id) {
			return true;
		}

		bookCompletionPromptOpen = true;
		const title = currentBook.metadata.title?.trim() || currentBook.filePath;
		const confirmed = await showObsidianConfirm(
			app,
			t('epub.reader.bookCompletionConfirmMessage', { title }),
			{
				title: t('epub.reader.bookCompletionConfirmTitle'),
				confirmText: t('epub.reader.bookCompletionConfirmButton'),
			}
		);
		bookCompletionPromptOpen = false;
		if (confirmed) {
			await markCurrentBookCompleted();
		} else {
			bookCompletionPromptDismissedBookId = currentBook.id;
		}
		return true;
	}

	async function openScanImportModal(scanEntries?: Awaited<ReturnType<typeof storageService.loadScanIndex>>) {
		const entries = scanEntries ?? await storageService.loadScanIndex();
		if (entries.length === 0) {
			new Notice(t('epub.bookshelf.vaultScanEmpty'));
			return;
		}

		const membership = await storageService.loadBookshelfMembership();
		const { EpubBookshelfImportModal } = await import('../modals/EpubBookshelfImportModal');
		const modal = new EpubBookshelfImportModal(app, {
			entries,
			membership,
			title: t('epub.bookshelf.vaultScanTitle'),
			onConfirm: async (paths: string[]) => {
				const addedEntries = await storageService.addBooksToBookshelf(paths);
				if (addedEntries.length === 0) {
					new Notice(
						paths.length > 0
							? t('epub.bookshelf.vaultScanAddFailed')
							: t('epub.bookshelf.vaultScanAlreadyAdded')
					);
					return;
				}
				warmEpubAnnotationIndexForPaths(
					app,
					addedEntries.map((entry) => entry.path)
				);
				dispatchEpubBookshelfDataChanged();
				new Notice(t('epub.bookshelf.vaultScanAdded', { count: addedEntries.length }));
			},
		});
		modal.open();
	}

	async function scanVaultAndPromptImport() {
		try {
			const scanEntries = await storageService.scanVaultBooks();
			dispatchEpubBookshelfDataChanged();

			if (scanEntries.length === 0) {
				new Notice(t('epub.bookshelf.vaultScanEmpty'));
				return;
			}

			await openScanImportModal(scanEntries);
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to scan vault EPUB files:', error);
			new Notice(t('epub.bookshelf.vaultScanFailed'));
		}
	}

	async function requestBookshelfRefresh() {
		dispatchEpubBookshelfRefreshRequest(undefined, { showNotice: true });
	}

	function getCreateCardPlugin(): {
		openCreateCardModal?: (input: EpubHostCreateCardInput) => Promise<void>;
	} | null {
		const host = getEpubActionHost();
		if (!host?.openCreateCardModal) {
			new Notice(t('epub.reader.createCardUnavailable'));
			return null;
		}
		return host;
	}

	function getExcerptPipeline() {
		return bookSession.excerptPipeline;
	}

	function syncBookSessionForPath(nextFilePath: string): BookSession {
		const manager = getBookSessionManager(app);
		if (!manager.pathsShareSession(filePath, nextFilePath)) {
			manager.release(filePath);
		}
		bookSession = manager.acquire(nextFilePath);
		return bookSession;
	}

	function syncReaderHighlightsFromCollection(
		nextHighlights: ReaderHighlight[],
		previousHighlights: ReaderHighlight[]
	): void {
		if (!readerReady) {
			return;
		}
		const previousByKey = new Map(
			previousHighlights.map((highlight) => [
				getReaderHighlightIdentityKey(highlight),
				highlight,
			])
		);
		for (const highlight of nextHighlights) {
			const key = getReaderHighlightIdentityKey(highlight);
			if (!key) {
				continue;
			}
			const previous = previousByKey.get(key);
			if (!previous || hasReaderHighlightPresentationChanged(previous, highlight)) {
				readerService.addHighlight(highlight);
			}
		}
	}

	function buildHighlightIdentityFields(info: HighlightClickInfo) {
		return {
			cfiRange: info.cfiRange,
			text: info.text,
			excerptId: info.excerptId,
			sourceFile: info.sourceFile,
			sourceRef: info.sourceRef,
			createdTime: info.createdTime,
			semanticId: info.semanticId,
		};
	}

	function buildReaderHighlightFromInfo(info: HighlightClickInfo): ReaderHighlight {
		return {
			cfiRange: info.cfiRange,
			color: info.color || 'yellow',
			...(info.style ? { style: info.style } : {}),
			...(info.semanticId ? { semanticId: info.semanticId } : {}),
			...(info.semanticLabel ? { semanticLabel: info.semanticLabel } : {}),
			...(info.semanticGroup ? { semanticGroup: info.semanticGroup } : {}),
			...(info.semanticDescription ? { semanticDescription: info.semanticDescription } : {}),
			...(info.semanticSource ? { semanticSource: info.semanticSource } : {}),
			text: info.text,
			...(info.commentText ? { commentText: info.commentText } : {}),
			...(info.hasCommentDivider ? { hasCommentDivider: true } : {}),
			...(typeof info.chapterIndex === 'number' ? { chapterIndex: info.chapterIndex } : {}),
			...(info.chapterTitle ? { chapterTitle: info.chapterTitle } : {}),
			...(info.chapterRootTitle ? { chapterRootTitle: info.chapterRootTitle } : {}),
			...(info.chapterPath?.length ? { chapterPath: info.chapterPath } : {}),
			...(info.chapterHref ? { chapterHref: info.chapterHref } : {}),
			...(typeof info.spineIndex === 'number' ? { spineIndex: info.spineIndex } : {}),
			...(info.sourceFile ? { sourceFile: info.sourceFile } : {}),
			...(info.sourceRef ? { sourceRef: info.sourceRef } : {}),
			...(info.excerptId ? { excerptId: info.excerptId } : {}),
			...(info.sourceLocators ? { sourceLocators: info.sourceLocators } : {}),
			...(typeof info.createdTime === 'number' ? { createdTime: info.createdTime } : {}),
			presentation: info.presentation || 'highlight',
		};
	}

	function buildHighlightClickInfoFromReaderHighlight(
		highlight: ReaderHighlight,
		geometry: {
			rect: HighlightClickInfo['rect'];
			rects?: HighlightClickInfo['rects'];
			anchorPoint?: HighlightClickInfo['anchorPoint'];
		},
		interactionTarget: HighlightClickInfo['interactionTarget'] = 'highlight'
	): HighlightClickInfo {
		return {
			cfiRange: highlight.cfiRange,
			color: highlight.color || 'yellow',
			style: highlight.style,
			semanticId: highlight.semanticId,
			semanticLabel: highlight.semanticLabel,
			semanticGroup: highlight.semanticGroup,
			semanticDescription: highlight.semanticDescription,
			semanticSource: highlight.semanticSource,
			text: highlight.text || '',
			commentText: highlight.commentText,
			hasCommentDivider: highlight.hasCommentDivider,
			chapterIndex: highlight.chapterIndex,
			chapterTitle: highlight.chapterTitle,
			chapterRootTitle: highlight.chapterRootTitle,
			chapterPath: highlight.chapterPath,
			chapterHref: highlight.chapterHref,
			spineIndex: highlight.spineIndex,
			sourceFile: highlight.sourceFile || '',
			sourceRef: highlight.sourceRef,
			excerptId: highlight.excerptId,
			sourceLocators: highlight.sourceLocators,
			createdTime: highlight.createdTime,
			presentation: highlight.presentation || 'highlight',
			interactionTarget,
			rect: geometry.rect,
			rects: geometry.rects,
			anchorPoint: geometry.anchorPoint,
		};
	}

	function closeAnnotationDisambiguation(): void {
		clearAnnotationPreview();
		annotationDisambiguationAnchor = null;
		annotationDisambiguationCandidates = [];
	}

	function getSemanticColorHex(color?: string): string {
		const key = String(color || 'yellow').trim().toLowerCase();
		return (SEMANTIC_COLOR_HEX as Record<string, string>)[key] || (SEMANTIC_COLOR_HEX as Record<string, string>).yellow || '#ffe58a';
	}

	function resolveAnnotationCandidateLabel(info: HighlightClickInfo): string {
		if (info.semanticLabel) {
			return info.semanticLabel;
		}
		if (info.semanticId) {
			return info.semanticId;
		}
		if (info.style === 'underline') {
			return t('epub.highlightToolbar.underline');
		}
		if (info.style === 'wavy') {
			return t('epub.highlightToolbar.wavy');
		}
		if (info.style === 'strikethrough') {
			return t('epub.highlightToolbar.strikethrough');
		}
		return t('epub.highlightToolbar.highlight');
	}

	function getHighlightInfoIdentity(info: HighlightClickInfo): string {
		return getReaderHighlightIdentityKey(buildHighlightIdentityFields(info));
	}

	function rectArea(rect: HighlightClickInfo['rect']): number {
		return Math.max(0, rect.width) * Math.max(0, rect.height);
	}

	function rectsIntersect(a: HighlightClickInfo['rect'], b: HighlightClickInfo['rect']): boolean {
		return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
	}

	function pointInRect(point: HighlightClickInfo['anchorPoint'], rect: HighlightClickInfo['rect']): boolean {
		return Boolean(point && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom);
	}

	function highlightInfosVisuallyOverlap(a: HighlightClickInfo, b: HighlightClickInfo): boolean {
		const aRects = a.rects?.length ? a.rects : [a.rect];
		const bRects = b.rects?.length ? b.rects : [b.rect];
		if (a.anchorPoint) {
			return bRects.some((rect) => pointInRect(a.anchorPoint, rect));
		}
		if (b.anchorPoint) {
			return aRects.some((rect) => pointInRect(b.anchorPoint, rect));
		}
		return aRects.some((left) => bRects.some((right) => rectsIntersect(left, right)));
	}

	function buildAnnotationDisambiguationCandidate(info: HighlightClickInfo): AnnotationDisambiguationCandidate | null {
		const id = getHighlightInfoIdentity(info);
		if (!id) {
			return null;
		}
		return {
			id,
			label: resolveAnnotationCandidateLabel(info),
			description: info.semanticDescription || info.text,
			color: getSemanticColorHex(info.color),
			info,
		};
	}

	function collectAnnotationCandidatesAtHighlight(anchorInfo: HighlightClickInfo): AnnotationDisambiguationCandidate[] {
		const byId = new Map<string, AnnotationDisambiguationCandidate>();
		const anchorCandidate = buildAnnotationDisambiguationCandidate(anchorInfo);
		if (anchorCandidate) {
			byId.set(anchorCandidate.id, anchorCandidate);
		}
		const serviceCandidates = readerService.getHighlightClickCandidates?.(anchorInfo) || [];
		for (const info of serviceCandidates) {
			if (info.presentation === 'conceal') {
				continue;
			}
			const candidate = buildAnnotationDisambiguationCandidate(info);
			if (candidate) {
				byId.set(candidate.id, candidate);
			}
		}
		if (serviceCandidates.length > 0) {
			return Array.from(byId.values());
		}
		if (!readerService.getSelectionViewportGeometry) {
			return Array.from(byId.values());
		}
		for (const highlight of pendingLoadedHighlights || []) {
			if (highlight.presentation === 'conceal') {
				continue;
			}
			const geometry = readerService.getSelectionViewportGeometry(highlight.cfiRange);
			if (!geometry?.rect) {
				continue;
			}
			const info = buildHighlightClickInfoFromReaderHighlight(highlight, geometry, 'highlight');
			if (!highlightInfosVisuallyOverlap(anchorInfo, info)) {
				continue;
			}
			const candidate = buildAnnotationDisambiguationCandidate(info);
			if (candidate) {
				byId.set(candidate.id, candidate);
			}
		}
		return Array.from(byId.values()).sort((a, b) => {
			const areaDiff = rectArea(a.info.rect) - rectArea(b.info.rect);
			if (Math.abs(areaDiff) > 1) {
				return areaDiff;
			}
			const commentDiff = Number(Boolean(b.info.hasCommentDivider)) - Number(Boolean(a.info.hasCommentDivider));
			if (commentDiff !== 0) {
				return commentDiff;
			}
			return (b.info.createdTime || 0) - (a.info.createdTime || 0);
		});
	}

	function openAnnotationActions(info: HighlightClickInfo): void {
		closeAnnotationDisambiguation();
		footnotePreviewInfo = null;
		referencePopoverInfo = null;
		referencePopoverStats = null;
		closeCommentEditor();
		highlightToolbarInfo = info;
	}

	function handleAnnotationCandidatePreview(candidate: AnnotationDisambiguationCandidate | null): void {
		clearAnnotationPreview();
		if (!candidate) {
			return;
		}
		activeAnnotationPreviewCfiRange = candidate.info.cfiRange;
		readerService.previewHighlightFocus(candidate.info.cfiRange, 'cyan', 1200);
	}

	function clearAnnotationPreview(): void {
		if (!activeAnnotationPreviewCfiRange) {
			return;
		}
		readerService.clearHighlightFocus(activeAnnotationPreviewCfiRange);
		activeAnnotationPreviewCfiRange = null;
	}

	function handleAnnotationCandidateSelect(candidate: AnnotationDisambiguationCandidate): void {
		clearAnnotationPreview();
		openAnnotationActions(candidate.info);
	}

	function enqueueAnnotationMutation(operation: () => Promise<void>): Promise<void> {
		const run = annotationMutationQueue.then(operation, operation);
		annotationMutationQueue = run.catch((error) => {
			logger.warn('[EpubReaderApp] Annotation mutation failed:', error);
		});
		return run;
	}

	function removeHighlightFromCurrentView(highlight: ReaderHighlight): void {
		markCollectedHighlightsStale();
		const key = getReaderHighlightIdentityKey(highlight);
		if (key) {
			readerService.removeHighlightByIdentityKey(key);
			pendingLoadedHighlights = (pendingLoadedHighlights || []).filter(
				(item) => getReaderHighlightIdentityKey(item) !== key
			);
		} else {
			readerService.removeHighlight(highlight.cfiRange);
			const normalizedCfi = EpubLinkService.normalizeCfi(highlight.cfiRange);
			pendingLoadedHighlights = (pendingLoadedHighlights || []).filter(
				(item) => EpubLinkService.normalizeCfi(item.cfiRange) !== normalizedCfi
			);
		}
		publishSidebarHighlights(pendingLoadedHighlights || []);
		highlightToolbarInfo = null;
	}

	function addHighlightToCurrentView(highlight: ReaderHighlight): void {
		markCollectedHighlightsStale();
		const presentedHighlight = applySemanticPresentation({
			...highlight,
			presentation: highlight.presentation || 'highlight',
		});
		readerService.addHighlight(presentedHighlight);
		pendingLoadedHighlights = mergeReaderHighlightsByIdentity(
			pendingLoadedHighlights || [],
			[presentedHighlight]
		);
		publishSidebarHighlights(pendingLoadedHighlights);
	}

	async function applyAnnotationUndoPatch(patch: EpubAnnotationUndoPatch): Promise<boolean> {
		if (!book) {
			return false;
		}
		if (!ensureAnnotationCompareWritable()) {
			return false;
		}
		const currentAnnotationBookId = getCurrentAnnotationBookId();
		if (patch.bookId !== book.id && patch.bookId !== currentAnnotationBookId) {
			return false;
		}
		if (patch.kind === 'delete') {
			await annotationService.removePortableHighlight(currentAnnotationBookId, patch.highlight);
			removeHighlightFromCurrentView(patch.highlight);
			queueOpenAnnotationNoteRefresh(currentAnnotationBookId);
			return true;
		}
		if (patch.kind === 'restore') {
			await annotationService.savePortableHighlight(currentAnnotationBookId, patch.highlight);
			addHighlightToCurrentView(patch.highlight);
			queueOpenAnnotationNoteRefresh(currentAnnotationBookId);
			return true;
		}
		await annotationService.removePortableHighlight(currentAnnotationBookId, patch.before);
		await annotationService.savePortableHighlight(currentAnnotationBookId, patch.after);
		removeHighlightFromCurrentView(patch.before);
		addHighlightToCurrentView(patch.after);
		queueOpenAnnotationNoteRefresh(currentAnnotationBookId);
		return true;
	}

	function shouldHandleAnnotationUndoShortcut(event: KeyboardEvent): boolean {
		if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) {
			return false;
		}
		if (String(event.key || '').toLowerCase() !== 'z') {
			return false;
		}
		if (readerUiMode === 'minimal' || commentEditorInfo || exportNotesPopoverOpen || typographyPopoverOpen) {
			return false;
		}
		if (!isActiveEpubReaderInstance()) {
			return false;
		}
		return !shouldIgnoreEpubReaderShortcut(event);
	}

	function handleAnnotationUndoKeydown(event: KeyboardEvent): void {
		if (!shouldHandleAnnotationUndoShortcut(event)) {
			return;
		}
		event.preventDefault();
		void enqueueAnnotationMutation(async () => {
			const patch = annotationUndoStack.undo();
			if (!patch) {
				new Notice('没有可撤销的标注操作');
				return;
			}
			const applied = await applyAnnotationUndoPatch(patch);
			if (applied) {
				new Notice(patch.kind === 'restore' ? '已恢复上一条标注' : '已撤销上一条标注');
				return;
			}
			new Notice('当前书籍没有可撤销的标注操作');
		});
	}

	function purgeOrphanHighlightFromReader(info: HighlightClickInfo): void {
		markCollectedHighlightsStale();
		const identityKey = getReaderHighlightIdentityKey(buildHighlightIdentityFields(info));
		if (identityKey) {
			readerService.removeHighlightByIdentityKey(identityKey);
			pendingLoadedHighlights = (pendingLoadedHighlights || []).filter(
				(highlight) => getReaderHighlightIdentityKey(highlight) !== identityKey
			);
		} else {
			readerService.removeHighlight(info.cfiRange);
			const normalizedCfi = EpubLinkService.normalizeCfi(info.cfiRange);
			pendingLoadedHighlights = (pendingLoadedHighlights || []).filter(
				(highlight) => EpubLinkService.normalizeCfi(highlight.cfiRange) !== normalizedCfi
			);
		}
		if (pendingLoadedHighlights) {
			publishSidebarHighlights(pendingLoadedHighlights);
		}
		highlightToolbarInfo = null;
	}

	async function isHighlightStillPersistedInSource(
		info: HighlightClickInfo,
		source: BacklinkSourceMatch
	): Promise<boolean> {
		const sourceFile = normalizeTrackedVaultPath(source.sourceFile);
		if (!sourceFile || !app.vault.getAbstractFileByPath(sourceFile)) {
			return false;
		}
		try {
			const highlights = await backlinkService.collectHighlightsFromSourcePath(
				filePath,
				sourceFile,
				getBoundCanvasPath()
			);
			const mutationCfi = resolveHighlightMutationCfi(info, source);
			const normalizedTargetCfi = EpubLinkService.normalizeCfi(mutationCfi);
			return highlights.some((highlight) => {
				if (source.excerptId && highlight.excerptId) {
					return highlight.excerptId === source.excerptId;
				}
				return EpubLinkService.normalizeCfi(highlight.cfiRange) === normalizedTargetCfi;
			});
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to inspect highlight persistence in source:', error);
			return true;
		}
	}

	async function finalizeHighlightRemoval(
		info: HighlightClickInfo,
		source: BacklinkSourceMatch,
		options?: { quiet?: boolean }
	): Promise<void> {
		purgeOrphanHighlightFromReader(info);
		if (!options?.quiet) {
			new Notice(t('epub.reader.highlightDeleted'));
		}
		reloadHighlightsAfterExcerptMutation(source.sourceFile);
	}

	async function syncHighlightsAfterSourcePathChange(sourcePath?: string | null): Promise<boolean> {
		const normalizedPath = normalizeTrackedVaultPath(sourcePath);
		if (!normalizedPath || !book || componentDisposed) {
			return false;
		}
		const current = pendingLoadedHighlights || [];
		if (current.length === 0) {
			return false;
		}

		let remainingFromSource: ReaderHighlight[] = [];
		try {
			const fromSource = await backlinkService.collectHighlightsFromSourcePath(
				filePath,
				normalizedPath,
				getBoundCanvasPath()
			);
			remainingFromSource = fromSource.map((highlight) => ({
				...applySemanticPresentation(highlight),
				presentation: 'highlight' as const,
			}));
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to sync highlights after source path change:', {
				path: normalizedPath,
				error,
			});
			return false;
		}

		const syncResult = computeHighlightSourceOptimisticSync(
			current,
			normalizedPath,
			remainingFromSource
		);
		if (syncResult.removed.length === 0 && syncResult.updated.length === 0) {
			return false;
		}

		const nextHighlights = applyHighlightSourceOptimisticSyncResult(current, syncResult);
		markCollectedHighlightsStale();
		pendingLoadedHighlights = nextHighlights;
		getExcerptPipeline().syncCollectedHighlights(nextHighlights);
		publishSidebarHighlights(nextHighlights);

		if (readerReady) {
			for (const highlight of syncResult.removed) {
				const key = getReaderHighlightIdentityKey(highlight);
				if (key) {
					readerService.removeHighlightByIdentityKey(key);
				} else {
					readerService.removeHighlight(highlight.cfiRange);
				}
			}
			syncReaderHighlightsFromCollection(syncResult.updated, current);
		}
		return true;
	}

	function resolveCommentDraftFromMemory(info: HighlightClickInfo): string {
		const key = getReaderHighlightIdentityKey({
			cfiRange: info.cfiRange,
			text: info.text,
			excerptId: info.excerptId,
			sourceFile: info.sourceFile,
			sourceRef: info.sourceRef,
			createdTime: info.createdTime,
		});
		if (key) {
			const loaded = pendingLoadedHighlights.find(
				(highlight) => getReaderHighlightIdentityKey(highlight) === key
			);
			if (loaded?.commentText) {
				return loaded.commentText;
			}
		}
		return info.commentText || '';
	}

	async function resolveCommentDraftFromSource(info: HighlightClickInfo): Promise<string> {
		const memoryDraft = resolveCommentDraftFromMemory(info);
		if (memoryDraft.trim()) {
			return memoryDraft;
		}
		const source = await resolveHighlightSource(info);
		if (!source?.sourceFile) {
			return memoryDraft;
		}
		try {
			const highlights = await backlinkService.collectHighlightsFromSourcePath(
				filePath,
				source.sourceFile,
				getBoundCanvasPath()
			);
			const mutationCfi = resolveHighlightMutationCfi(info, source);
			const normalizedTargetCfi = EpubLinkService.normalizeCfi(mutationCfi);
			const match = highlights.find((highlight) => {
				if (source.excerptId && highlight.excerptId) {
					return highlight.excerptId === source.excerptId;
				}
				return EpubLinkService.normalizeCfi(highlight.cfiRange) === normalizedTargetCfi;
			});
			return match?.commentText || memoryDraft;
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to resolve highlight comment from source:', error);
			return memoryDraft;
		}
	}

	function applyIncomingReaderHighlights(incoming: ReaderHighlight[]): boolean {
		if (incoming.length === 0) {
			return false;
		}
		const incomingWithSemanticPresentation = applySemanticPresentationToHighlights(incoming);
		const previousHighlights = pendingLoadedHighlights || [];
		markCollectedHighlightsStale();
		pendingLoadedHighlights = mergeReaderHighlightsByIdentity(previousHighlights, incomingWithSemanticPresentation);
		syncReaderHighlightsFromCollection(incomingWithSemanticPresentation, previousHighlights);
		publishSidebarHighlights(pendingLoadedHighlights);
		return true;
	}

	async function mergeHighlightsFromSourcePath(sourcePath?: string | null): Promise<boolean> {
		const normalizedPath = normalizeTrackedVaultPath(sourcePath);
		if (!normalizedPath || !book || componentDisposed) {
			return false;
		}
		try {
			const fromSource = await backlinkService.collectHighlightsFromSourcePath(
				filePath,
				normalizedPath,
				getBoundCanvasPath()
			);
			if (fromSource.length === 0) {
				return syncHighlightsAfterSourcePathChange(normalizedPath);
			}
			const incoming: ReaderHighlight[] = fromSource.map((highlight) => ({
				...highlight,
				presentation: 'highlight' as const,
			}));
			return applyIncomingReaderHighlights(incoming);
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to merge highlights from source path:', {
				path: normalizedPath,
				error,
			});
			return false;
		}
	}

	async function handleSavedCardHighlightSync(card: EpubSavedCardSnapshot) {
		if (!book || componentDisposed || !hasExcerptNotesCapability()) {
			return;
		}
		const normalizedCard = buildEpubHighlightSyncSnapshot(card);
		await getExcerptPipeline().handleCardSaved({
			card: normalizedCard,
			extractFromCard: () =>
				backlinkService.extractHighlightsFromSavedCard(
					normalizedCard,
					filePath,
					book?.sourceId
				),
			mergeFromSourcePath: (sourcePath) => mergeHighlightsFromSourcePath(sourcePath),
			applyReaderHighlights: (incoming) => applyIncomingReaderHighlights(incoming),
			requestReload: (request) =>
				queueHighlightReload(request.delayMs ?? 300, {
					incremental: request.incremental,
					invalidateCache: request.invalidateCache,
				}),
			rememberSourcePath: (sourcePath) => rememberHighlightSourcePath(sourcePath),
		});
	}

	async function extractContentToCard(
		content: string,
		successMessage: string,
		errorLogLabel: string,
		failureMessage: string,
		onSuccess?: () => void
	) {
		try {
			const plugin = getCreateCardPlugin();
			if (!plugin?.openCreateCardModal) return;

			const handleCardSaved = (card: EpubSavedCardSnapshot) => {
				void handleSavedCardHighlightSync(card);
			};
			const modalInput: EpubHostCreateCardInput & {
				onSuccess?: (card: EpubSavedCardSnapshot) => void | Promise<void>;
			} = {
				initialContent: `${content}\n---div---\n\n`,
				onCardSaved: handleCardSaved,
				onSuccess: handleCardSaved,
			};

			await plugin.openCreateCardModal(modalInput);
			onSuccess?.();
			new Notice(successMessage);
		} catch (error) {
			logger.error(`[EpubReaderApp] ${errorLogLabel}:`, error);
			new Notice(failureMessage);
		}
	}

	function getMarkdownExportHost(): EpubHostCapabilities | null {
		const host = getEpubActionHost();
		if (!host) {
			return null;
		}
		return host;
	}

	async function openAnnotationNoteWithOptions(options: {
		dualWindowMode?: boolean;
		openMode?: 'existing' | 'right-split';
		focus?: boolean;
	} = {}) {
		if (!book?.id) {
			new Notice(t('epub.reader.bookNotReady'));
			return;
		}
		try {
			const plugin = getMarkdownExportHost();
			if (!plugin?.openEpubAnnotationNote) {
				new Notice(t('epub.reader.annotationNoteUnavailable'));
				return;
			}
			const annotationBookId = await syncPortableBookIdForCurrentBook();
			const currentPosition = readerReady ? readerService.getCurrentPosition() : book.currentPosition;
			await plugin.openEpubAnnotationNote({
				bookId: annotationBookId || book.id,
				filePath,
				currentCfi: String(currentPosition?.cfi || '').trim(),
				currentChapterIndex:
					typeof currentPosition?.chapterIndex === 'number' && Number.isFinite(currentPosition.chapterIndex)
						? currentPosition.chapterIndex
						: undefined,
				dualWindowMode: options.dualWindowMode,
				openMode: options.openMode,
				focus: options.focus,
			});
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to open annotation note:', error);
			new Notice(t('epub.reader.annotationNoteOpenFailed'));
		}
	}

	async function refreshOpenAnnotationNoteAfterMutation(annotationBookId: string): Promise<void> {
		const normalizedBookId = String(annotationBookId || '').trim();
		if (!normalizedBookId || !book?.id) {
			return;
		}
		const notePath = resolveEpubPortableBookDataLocation(normalizedBookId).annotationsMarkdownPath;
		if (!findOpenAnnotationNoteLeaf(app, notePath)) {
			return;
		}
		const plugin = getMarkdownExportHost();
		if (!plugin?.refreshEpubAnnotationNote) {
			return;
		}
		const currentPosition = readerReady ? readerService.getCurrentPosition() : book.currentPosition;
		const dualWindowSession = getEpubDualWindowSession(app, filePath);
		const isDualWindowNote =
			dualWindowSession?.mode === 'book-annotation-note' &&
			normalizePath(String(dualWindowSession.notePath || '')) === normalizePath(notePath);
		await plugin.refreshEpubAnnotationNote({
			bookId: normalizedBookId,
			filePath,
			currentCfi: String(currentPosition?.cfi || '').trim(),
			currentChapterIndex:
				typeof currentPosition?.chapterIndex === 'number' && Number.isFinite(currentPosition.chapterIndex)
					? currentPosition.chapterIndex
					: undefined,
			dualWindowMode: isDualWindowNote,
			openMode: 'existing',
			focus: false,
		});
	}

	function queueOpenAnnotationNoteRefresh(annotationBookId: string): void {
		annotationNoteRefreshQueue = annotationNoteRefreshQueue
			.catch(() => undefined)
			.then(() => refreshOpenAnnotationNoteAfterMutation(annotationBookId))
			.catch((error) => {
				logger.warn('[EpubReaderApp] Failed to refresh open annotation note:', error);
			});
	}

	async function openAnnotationNote() {
		await openAnnotationNoteWithOptions();
	}

	function createAnnotationCompareSessionId(bookId: string): string {
		return `${bookId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	}

	function findAnnotationVersionSummary(
		versions: EpubAnnotationVersionSummary[],
		versionId: string
	): EpubAnnotationVersionSummary | null {
		return versions.find((version) => String(version.versionId || '').trim() === versionId) || null;
	}

	function getDualWindowModeLabel(mode: EpubDualWindowMode): string {
		if (mode === 'book-annotation-note') {
			return '\u539f\u4e66 + \u6807\u6ce8\u7b14\u8bb0';
		}
		if (mode === 'annotation-compare') {
			return '\u4e24\u79cd\u6807\u6ce8\u5bf9\u6bd4';
		}
		return '\u539f\u4e66 + \u7ffb\u8bd1';
	}

	function revealOpenDualWindowSession(session: EpubOpenDualWindowSession | undefined): boolean {
		const targetLeaf = session?.mainLeaf || session?.sideLeaf || null;
		if (!targetLeaf) {
			return false;
		}
		void app.workspace.revealLeaf(targetLeaf);
		return true;
	}

	async function closeBookAnnotationNoteDualWindow(session?: EpubOpenDualWindowSession): Promise<void> {
		const targetFilePath = session?.filePath || filePath;
		const panes = resolveEpubDualWindowPanes(app, targetFilePath);
		const noteLeaf = panes?.noteLeaf || session?.sideLeaf || null;
		const epubLeaf = panes?.epubLeaf || session?.mainLeaf || null;
		if (noteLeaf) {
			markEpubDualWindowNoteLeaf(noteLeaf, false);
			await noteLeaf.detach();
		}
		unregisterEpubDualWindowSession(app, targetFilePath);
		if (epubLeaf) {
			void app.workspace.revealLeaf(epubLeaf);
		}
	}

	async function exitAnnotationCompareSession(sessionId: string): Promise<void> {
		const targetSessionId = String(sessionId || '').trim();
		if (!targetSessionId) {
			return;
		}
		const entries = getAnnotationCompareLeafEntries(targetSessionId);
		if (entries.length === 0) {
			const currentLeaf = findCurrentAnnotationCompareLeaf();
			if (currentLeaf) {
				await setAnnotationCompareLeafState(currentLeaf, null, { active: true });
			}
			return;
		}
		const currentLeaf = findCurrentAnnotationCompareLeaf();
		const exitPlan = resolveEpubAnnotationCompareExitPlan(entries, (entry) => entry.context);
		const keepEntries = exitPlan.keepEntries.length > 0
			? exitPlan.keepEntries
			: entries.filter((entry) => !exitPlan.closeEntries.includes(entry));
		const targetLeaf = keepEntries[0]?.leaf || currentLeaf || entries[0]?.leaf;

		await Promise.all(keepEntries.map((entry) =>
			setAnnotationCompareLeafState(entry.leaf, null, { active: entry.leaf === targetLeaf })
		));
		await Promise.all(exitPlan.closeEntries.map((entry) => entry.leaf.detach()));
		if (targetLeaf) {
			void app.workspace.revealLeaf(targetLeaf);
		}
	}

	async function closeOpenDualWindowSession(session: EpubOpenDualWindowSession): Promise<void> {
		if (session.mode === 'book-annotation-note') {
			await closeBookAnnotationNoteDualWindow(session);
			return;
		}
		if (session.mode === 'annotation-compare') {
			await exitAnnotationCompareSession(session.sessionId || '');
		}
	}

	async function promptReplaceDualWindow(
		existingSession: EpubOpenDualWindowSession,
		requestedMode: EpubDualWindowMode
	): Promise<'replace' | 'reveal' | null> {
		return showObsidianChoice(app, '\u5f53\u524d\u8fd9\u672c\u4e66\u5df2\u5904\u4e8e\u300c' + getDualWindowModeLabel(existingSession.mode) + '\u300d\u53cc\u7a97\u3002', {
			title: '\u5df2\u6709\u53cc\u7a97',
			cancelText: '\u53d6\u6d88',
			choices: [
				{
					value: 'replace',
					text: '\u9000\u51fa\u5f53\u524d\u53cc\u7a97\u5e76\u6253\u5f00' + getDualWindowModeLabel(requestedMode),
					description: '\u5173\u95ed\u5f53\u524d\u526f\u9875\uff0c\u4fdd\u7559\u4e3b\u9875\u540e\u5207\u6362\u5230\u65b0\u7684\u53cc\u7a97\u6a21\u5f0f\u3002',
					className: 'mod-cta',
				},
				{
					value: 'reveal',
					text: '\u56de\u5230\u5f53\u524d\u53cc\u7a97',
					description: '\u4e0d\u65b0\u5efa\u7a97\u53e3\uff0c\u53ea\u5b9a\u4f4d\u5230\u5df2\u6253\u5f00\u7684\u53cc\u7a97\u3002',
				},
			],
		});
	}

	async function ensureCanOpenDualWindowMode(requestedMode: EpubDualWindowMode): Promise<boolean> {
		const annotationBookId = (await syncPortableBookIdForCurrentBook()) || getCurrentAnnotationBookId();
		await restoreEpubDualWindowSessionsFromWorkspace(app);
		const guard = resolveEpubDualWindowOpenGuard(app, {
			requestedMode,
			bookId: annotationBookId,
			filePath,
			currentAnnotationCompare: annotationCompare,
		});
		if (guard.action === 'open') {
			return true;
		}
		if (guard.action === 'blocked-side-pane') {
			new Notice('\u526f\u9875\u53ea\u8bfb\u7a97\u53e3\u4e0d\u652f\u6301\u518d\u6253\u5f00\u53cc\u7a97\uff0c\u8bf7\u5148\u56de\u5230\u4e3b\u9875\u64cd\u4f5c');
			return false;
		}
		if (guard.action === 'reveal-existing') {
			if (!revealOpenDualWindowSession(guard.existingSession)) {
				new Notice('\u627e\u4e0d\u5230\u5df2\u6253\u5f00\u7684\u53cc\u7a97');
			}
			return false;
		}
		if (guard.action === 'change-annotation-compare-versions') {
			await openAnnotationCompareVersionSelection({ existingSession: guard.existingSession });
			return false;
		}
		if (!guard.existingSession) {
			return true;
		}
		const choice = await promptReplaceDualWindow(guard.existingSession, requestedMode);
		if (choice === 'reveal') {
			if (!revealOpenDualWindowSession(guard.existingSession)) {
				new Notice('\u627e\u4e0d\u5230\u5df2\u6253\u5f00\u7684\u53cc\u7a97');
			}
			return false;
		}
		if (choice !== 'replace') {
			return false;
		}
		await closeOpenDualWindowSession(guard.existingSession);
		return true;
	}

	async function openAnnotationDualWindow() {
		if (!book?.id) {
			new Notice(t('epub.reader.bookNotReady'));
			return;
		}
		if (!(await ensureCanOpenDualWindowMode('book-annotation-note'))) {
			return;
		}
		await openAnnotationNoteWithOptions({
			dualWindowMode: true,
			openMode: 'right-split',
			focus: false,
		});
	}

	type PreparedAnnotationCompareWindows = {
		canonicalPath: string;
		contexts: { editable: EpubAnnotationCompareContext; readonly: EpubAnnotationCompareContext };
	};

	async function prepareAnnotationCompareWindows(
		selection: EpubAnnotationCompareVersionSelection,
		input: { sessionId: string; syncPosition: boolean; reason: string }
	): Promise<PreparedAnnotationCompareWindows | null> {
		if (!book?.id) {
			new Notice(t('epub.reader.bookNotReady'));
			return null;
		}
		const annotationBookId = (await syncPortableBookIdForCurrentBook()) || getCurrentAnnotationBookId();
		const versions = await listEpubAnnotationVersions(app, annotationBookId);
		const editableVersionId = String(selection.editableVersionId || '').trim();
		const readonlyVersionId = String(selection.readonlyVersionId || '').trim();
		const editableVersion = findAnnotationVersionSummary(versions, editableVersionId);
		const readonlyVersion = findAnnotationVersionSummary(versions, readonlyVersionId);
		if (!editableVersion || !readonlyVersion || editableVersionId === readonlyVersionId) {
			new Notice('\u8bf7\u9009\u62e9\u4e24\u4e2a\u4e0d\u540c\u7684\u6807\u6ce8\u7248\u672c');
			return null;
		}

		await switchEpubAnnotationVersion(app, annotationBookId, editableVersionId);
		notifyEpubAnnotationVersionChanged(annotationBookId, {
			filePath,
			versionId: editableVersionId,
			reason: input.reason,
		});

		const canonicalPath = storageService.resolveSupportedBookFilePath(filePath) || normalizePath(filePath);
		const contexts = createEpubAnnotationCompareContexts({
			sessionId: input.sessionId,
			bookId: annotationBookId,
			filePath: canonicalPath,
			editableVersionId,
			editableVersionName: editableVersion.name,
			readonlyVersionId,
			readonlyVersionName: readonlyVersion.name,
			syncPosition: input.syncPosition,
		});
		if (!contexts) {
			new Notice('\u65e0\u6cd5\u521b\u5efa\u6807\u6ce8\u5bf9\u6bd4\u7a97\u53e3');
			return null;
		}
		return { canonicalPath, contexts };
	}

	async function openAnnotationCompareWindows(
		selection: EpubAnnotationCompareVersionSelection
	): Promise<void> {
		const annotationBookId = (await syncPortableBookIdForCurrentBook()) || getCurrentAnnotationBookId();
		const prepared = await prepareAnnotationCompareWindows(selection, {
			sessionId: createAnnotationCompareSessionId(annotationBookId),
			syncPosition: true,
			reason: 'annotation-compare-open',
		});
		if (!prepared) {
			return;
		}

		const viewType = resolveRegisteredEpubViewType(app, prepared.canonicalPath) || EPUB_RUNTIME.viewTypes.reader;
		const editableLeaf = findOpenEpubLeaf(app, prepared.canonicalPath) || app.workspace.getMostRecentLeaf?.() || app.workspace.getLeaf('tab');
		const readonlyLeaf = app.workspace.getLeaf('split', 'vertical');

		await editableLeaf.setViewState({
			type: viewType,
			active: true,
			state: {
				filePath: prepared.canonicalPath,
				annotationCompare: prepared.contexts.editable,
			},
		});
		await readonlyLeaf.setViewState({
			type: viewType,
			active: false,
			state: {
				filePath: prepared.canonicalPath,
				annotationCompare: prepared.contexts.readonly,
			},
		});
		void app.workspace.revealLeaf(editableLeaf);
	}

	function getAnnotationCompareSelectionForSession(sessionId: string): EpubAnnotationCompareVersionSelection | null {
		const entries = getAnnotationCompareLeafEntries(sessionId);
		const editable = entries.find((entry) => entry.context.paneRole === 'editable')?.context;
		const readonly = entries.find((entry) => entry.context.paneRole === 'readonly')?.context;
		if (!editable?.versionId || !readonly?.versionId || editable.versionId === readonly.versionId) {
			return null;
		}
		return {
			editableVersionId: editable.versionId,
			readonlyVersionId: readonly.versionId,
		};
	}

	async function changeAnnotationCompareVersions(
		selection: EpubAnnotationCompareVersionSelection,
		sessionId: string
	): Promise<void> {
		const targetSessionId = String(sessionId || '').trim();
		const entries = getAnnotationCompareLeafEntries(targetSessionId);
		if (entries.length < 2) {
			await openAnnotationCompareWindows(selection);
			return;
		}
		const prepared = await prepareAnnotationCompareWindows(selection, {
			sessionId: targetSessionId,
			syncPosition: annotationCompare?.syncPosition !== false,
			reason: 'annotation-compare-change-versions',
		});
		if (!prepared) {
			return;
		}
		const editableEntry = entries.find((entry) => entry.context.paneRole === 'editable') || entries[0];
		const readonlyEntry = entries.find((entry) => entry.context.paneRole === 'readonly' && entry.leaf !== editableEntry.leaf)
			|| entries.find((entry) => entry.leaf !== editableEntry.leaf);
		if (!readonlyEntry) {
			await openAnnotationCompareWindows(selection);
			return;
		}
		await Promise.all([
			setAnnotationCompareLeafState(editableEntry.leaf, prepared.contexts.editable, { active: true }),
			setAnnotationCompareLeafState(readonlyEntry.leaf, prepared.contexts.readonly),
		]);
		void app.workspace.revealLeaf(editableEntry.leaf);
	}

	async function openAnnotationCompareVersionSelection(options: {
		existingSession?: EpubOpenDualWindowSession;
	} = {}): Promise<void> {
		if (!book?.id) {
			new Notice(t('epub.reader.bookNotReady'));
			return;
		}
		const annotationBookId = options.existingSession?.bookId
			|| (await syncPortableBookIdForCurrentBook())
			|| getCurrentAnnotationBookId();
		const sessionId = options.existingSession?.sessionId || annotationCompare?.sessionId || '';
		const initialSelection = sessionId ? getAnnotationCompareSelectionForSession(sessionId) : null;
		const { EpubAnnotationCompareVersionSelectModal } = await import('./EpubAnnotationCompareVersionSelectModal');
		new EpubAnnotationCompareVersionSelectModal(app, {
			bookId: annotationBookId,
			bookTitle: book.metadata?.title?.trim() || filePath,
			initialSelection,
			confirmText: sessionId ? '\u5e94\u7528\u5bf9\u6bd4' : undefined,
			onConfirm: async (selection) => {
				if (sessionId) {
					await changeAnnotationCompareVersions(selection, sessionId);
					return;
				}
				await openAnnotationCompareWindows(selection);
			},
		}).open();
	}

	async function openAnnotationCompareDualWindow() {
		if (!book?.id) {
			new Notice(t('epub.reader.bookNotReady'));
			return;
		}
		if (!(await ensureCanOpenDualWindowMode('annotation-compare'))) {
			return;
		}
		await openAnnotationCompareVersionSelection();
	}

	async function openAnnotationVersions() {
		if (!book?.id) {
			new Notice(t('epub.reader.bookNotReady'));
			return;
		}
		const annotationBookId = await syncPortableBookIdForCurrentBook();
		const location = resolveEpubPortableBookDataLocation(annotationBookId || book.id);
		const { EpubAnnotationVersionManagerModal } = await import('./EpubAnnotationVersionManagerModal');
		new EpubAnnotationVersionManagerModal(app, {
			bookTitle: book.metadata?.title?.trim() || filePath,
			bookId: location.bookId,
			filePath,
			bookDataDir: location.bookDir,
			annotationsPath: location.annotationsPath,
		}).open();
	}

	async function toggleAnnotationCompareSyncPosition(): Promise<void> {
		if (!annotationCompare) {
			return;
		}
		const nextSyncPosition = annotationCompare.syncPosition === false;
		const entries = getAnnotationCompareLeafEntries(annotationCompare.sessionId);
		await Promise.all(entries.map((entry) =>
			setAnnotationCompareLeafState(entry.leaf, {
				...entry.context,
				syncPosition: nextSyncPosition,
			})
		));
	}

	async function swapAnnotationComparePanes(): Promise<void> {
		if (!annotationCompare) {
			return;
		}
		const entries = getAnnotationCompareLeafEntries(annotationCompare.sessionId);
		if (entries.length < 2) {
			new Notice('\u627e\u4e0d\u5230\u53ef\u4ea4\u6362\u7684\u5bf9\u6bd4\u7a97\u53e3');
			return;
		}
		const [first, second] = entries;
		await Promise.all([
			setAnnotationCompareLeafState(first.leaf, second.context),
			setAnnotationCompareLeafState(second.leaf, first.context),
		]);
	}

	async function exitAnnotationCompareMode(): Promise<void> {
		if (!annotationCompare) {
			return;
		}
		await exitAnnotationCompareSession(annotationCompare.sessionId);
	}

	async function switchAnnotationComparePaneToEditable(): Promise<void> {
		if (!annotationCompare || annotationCompare.paneRole === 'editable') {
			return;
		}
		const currentLeaf = findCurrentAnnotationCompareLeaf();
		if (!currentLeaf) {
			new Notice('\u627e\u4e0d\u5230\u5f53\u524d\u5bf9\u6bd4\u7a97\u53e3');
			return;
		}
		const peer = getAnnotationCompareSessionPeer();
		const nextCurrentContext = peer
			? buildAnnotationCompareContextForRole(annotationCompare, 'editable', peer.context)
			: { ...annotationCompare, paneRole: 'editable' as const };
		const nextPeerContext = peer
			? buildAnnotationCompareContextForRole(peer.context, 'readonly', annotationCompare)
			: null;

		await switchEpubAnnotationVersion(app, annotationCompare.bookId, annotationCompare.versionId);
		notifyEpubAnnotationVersionChanged(annotationCompare.bookId, {
			filePath,
			versionId: annotationCompare.versionId,
			reason: 'annotation-compare-editable-switch',
		});

		await setAnnotationCompareLeafState(currentLeaf, nextCurrentContext, { active: true });
		if (peer) {
			await setAnnotationCompareLeafState(peer.leaf, nextPeerContext);
		}
		void app.workspace.revealLeaf(currentLeaf);
	}

	function scheduleAnnotationComparePositionBroadcast(position?: ReadingPosition): void {
		if (!annotationCompare || annotationCompare.syncPosition === false || !readerReady) {
			return;
		}
		if (Date.now() < applyingAnnotationCompareSyncUntil) {
			return;
		}
		const cfi = String(position?.cfi || readerService.getCurrentCFI() || '').trim();
		if (!cfi || cfi === lastAnnotationCompareBroadcastCfi) {
			return;
		}
		if (annotationCompareSyncTimer) {
			clearTimeout(annotationCompareSyncTimer);
		}
		annotationCompareSyncTimer = setTimeout(() => {
			annotationCompareSyncTimer = null;
			if (!annotationCompare || annotationCompare.syncPosition === false || componentDisposed) {
				return;
			}
			lastAnnotationCompareBroadcastCfi = cfi;
			window.dispatchEvent(new CustomEvent<AnnotationComparePositionSyncDetail>(
				ANNOTATION_COMPARE_POSITION_SYNC_EVENT,
				{
					detail: {
						sessionId: annotationCompare.sessionId,
						sourceVersionId: annotationCompare.versionId,
						cfi,
					},
				}
			));
		}, ANNOTATION_COMPARE_SYNC_DEBOUNCE_MS);
	}

	function handleAnnotationComparePositionSyncEvent(event: Event): void {
		if (!annotationCompare || annotationCompare.syncPosition === false || !readerReady) {
			return;
		}
		const detail = (event as CustomEvent<AnnotationComparePositionSyncDetail>).detail || null;
		if (!detail || detail.sessionId !== annotationCompare.sessionId) {
			return;
		}
		if (detail.sourceVersionId === annotationCompare.versionId) {
			return;
		}
		const cfi = String(detail.cfi || '').trim();
		if (!cfi) {
			return;
		}
		const currentCfi = EpubLinkService.normalizeCfi(readerService.getCurrentCFI());
		if (currentCfi && currentCfi === EpubLinkService.normalizeCfi(cfi)) {
			return;
		}
		applyingAnnotationCompareSyncUntil = Date.now() + 900;
		void readerService.goToLocation(cfi)
			.catch((error) => {
				logger.warn('[EpubReaderApp] Failed to sync annotation compare position:', error);
			})
			.finally(() => {
				setTimeout(() => {
					if (Date.now() >= applyingAnnotationCompareSyncUntil) {
						applyingAnnotationCompareSyncUntil = 0;
					}
				}, 920);
			});
	}

	function setupAnnotationComparePositionSync(): (() => void) | null {
		if (!annotationCompare) {
			return null;
		}
		const detachRelocated = readerService.onRelocated((position) => {
			scheduleAnnotationComparePositionBroadcast(position);
		});
		window.addEventListener(
			ANNOTATION_COMPARE_POSITION_SYNC_EVENT,
			handleAnnotationComparePositionSyncEvent as EventListener
		);
		return () => {
			detachRelocated();
			window.removeEventListener(
				ANNOTATION_COMPARE_POSITION_SYNC_EVENT,
				handleAnnotationComparePositionSyncEvent as EventListener
			);
			if (annotationCompareSyncTimer) {
				clearTimeout(annotationCompareSyncTimer);
				annotationCompareSyncTimer = null;
			}
		};
	}

	$effect(() => {
		const sessionId = annotationCompare?.sessionId || '';
		const versionId = annotationCompare?.versionId || '';
		const syncPosition = annotationCompare?.syncPosition !== false;
		void sessionId;
		void versionId;
		void syncPosition;
		const detach = setupAnnotationComparePositionSync();
		return () => {
			detach?.();
		};
	});

	async function refreshAfterAnnotationVersionChanged() {
		if (!book?.id) {
			return;
		}
		const annotationBookId = await syncPortableBookIdForCurrentBook() || getCurrentAnnotationBookId();
		highlightReloadToken += 1;
		pendingCollectedHighlights = null;
		pendingLoadedHighlights = null;
		trackedHighlightSourceFiles = new Set<string>();
		annotationUndoStack.clear();
		highlightToolbarInfo = null;
		closeAnnotationDisambiguation();
		commentEditorInfo = null;
		getExcerptPipeline().syncCollectedHighlights([]);
		publishSidebarHighlights([]);
		try {
			annotationService.invalidateCollectedHighlightsCache(annotationBookId, filePath);
			highlightViewSnapshotService.invalidate(annotationBookId, filePath);
			referenceStatsService.clearCache(filePath);
			await backlinkService.invalidateHighlightsCacheForEpub(filePath, getBoundCanvasPath());
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to invalidate annotation version caches:', error);
		}
		await reloadHighlights({ invalidateCache: true, forceReaderReplace: true });
		queueOpenAnnotationNoteRefresh(annotationBookId);
	}

	function hasCreateReadingPointCapability(): boolean {
		return Boolean(getEpubActionHost()?.openIRReadingPointFromExternalSelection);
	}

	function hasScheduleChapterForIncrementalReadingCapability(): boolean {
		return Boolean(getEpubActionHost()?.scheduleEpubChapterForIncrementalReading);
	}

	function getIncrementalReadingHost(): EpubHostCapabilities | null {
		const host = getEpubActionHost();
		if (!host) {
			return null;
		}
		return host;
	}

	function applyAndPersistReaderSettings(nextSettings: EpubReaderSettings) {
		applyReaderSettingsState(nextSettings, true);
	}

	async function finalizeBookLoad(
		loadToken: number,
		loadedBook: EpubBook,
		targetFilePath: string,
		reusableBook: EpubBook | null
	): Promise<void> {
		if (isStaleBookLoad(loadToken)) {
			return;
		}

		try {
			const sourceEntry = await storageService.ensureSourceIdentity(targetFilePath, {
				preferredSourceId: reusableBook?.sourceId,
			});
			if (isStaleBookLoad(loadToken)) {
				return;
			}

			if (sourceEntry) {
				loadedBook.sourceId = sourceEntry.sourceId;
				loadedBook.sourceFingerprint = sourceEntry.sourceFingerprint;
				loadedBook.sourceSize = sourceEntry.sourceSize;
				loadedBook.sourceMtime = sourceEntry.sourceMtime;
				loadedBook.filePath = sourceEntry.filePath;
			} else if (reusableBook?.sourceId) {
				loadedBook.sourceId = reusableBook.sourceId;
			}

			await storageService.saveBook(loadedBook);
			if (isStaleBookLoad(loadToken)) {
				return;
			}

			await refreshReadingReferencePointState(loadedBook.id);
			if (isStaleBookLoad(loadToken)) {
				return;
			}

			await initCanvasBinding();
			if (isStaleBookLoad(loadToken)) {
				return;
			}

			await refreshTocChapterMarksForBook(loadedBook.id);
			if (isStaleBookLoad(loadToken)) {
				return;
			}

			void reloadHighlights();
			prefetchAnnotationIndexForBook(loadedBook, targetFilePath, { priority: 'immediate' });
		} catch (error) {
			logger.warn('[EpubReaderApp] Deferred book persistence failed:', error);
		}
	}

	async function cancelSlowBookLoad() {
		activeBookLoadToken += 1;
		bookLoadSlowWarning = false;
		loading = false;
		errorMsg = '';
		try {
			await onCancelBookLoad?.();
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to cancel book load:', error);
		}
	}

	async function loadBook() {
		syncBookSessionForPath(filePath);
		const loadToken = ++activeBookLoadToken;
		const targetFilePath = filePath;
		const previousBook = book;
		if (previousBook?.id) {
			void persistCurrentReadingProgress(previousBook);
		}
		portableBookId = '';
		loading = true;
		bookLoadSlowWarning = false;
		errorMsg = '';
		readerReady = false;
		highlightReloading = false;
		pendingCollectedHighlights = null;
		pendingLoadedHighlights = null;
		annotationUndoStack.clear();
		highlightToolbarInfo = null;
		closeAnnotationDisambiguation();
		commentEditorInfo = null;
		footnotePreviewInfo = null;
		commentEditorDraft = '';
		commentEditorSaving = false;
		updateReadingReferencePointState(null);
		updateSessionReadingStartPercent(null);
		try {
			const canonicalFilePath =
				storageService.resolveSupportedBookFilePath(targetFilePath) || targetFilePath;
			if (canonicalFilePath !== targetFilePath) {
				await storageService.updateBookFileReferences(targetFilePath, canonicalFilePath);
			}
			const vaultFile = app.vault.getAbstractFileByPath(canonicalFilePath);
			if (!isSupportedBookFile(vaultFile)) {
				if (await storageService.isBookshelfSourceMissing(targetFilePath)) {
					await storageService.removeMissingBookshelfEntry(targetFilePath);
					throw new Error(t('epub.bookshelf.notFoundRemoved'));
				}
				throw new Error(t('views.epubView.notice.bookFileMissing'));
			}

			const existingBook =
				(await storageService.findBookByFilePath(canonicalFilePath))
				|| (canonicalFilePath !== targetFilePath
					? await storageService.findBookByFilePath(targetFilePath)
					: null);
			if (isStaleBookLoad(loadToken)) {
				return;
			}
			if (existingBook?.id) {
				await storageService.hydrateBookState(existingBook.id);
			}
			if (isStaleBookLoad(loadToken)) {
				return;
			}
			const reusableBook = canReuseExistingBook(existingBook, vaultFile) ? existingBook : null;
			if (existingBook && !reusableBook) {
				await storageService.removeBookByFilePath(canonicalFilePath);
				showTransientStatus(
					t('epub.reader.fileUpdatedRebuilt', {
						format: getBookFormatDisplayLabel(canonicalFilePath),
					}),
					3200
				);
			}
			const loadedBook = await runBookLoadSession({
				filePath: canonicalFilePath,
				fileSizeBytes: vaultFile.stat.size,
				loadPromise: readerService.loadEpub(canonicalFilePath, reusableBook?.id),
				onSlowLoad: () => {
					if (!isStaleBookLoad(loadToken)) {
						bookLoadSlowWarning = true;
					}
				},
				isCancelled: () => isStaleBookLoad(loadToken),
			});

			if (isStaleBookLoad(loadToken)) {
				return;
			}

			if (reusableBook) {
				loadedBook.readingStats = reusableBook.readingStats;
				const storedTitle = reusableBook.metadata?.title?.trim();
				if (storedTitle) {
					loadedBook.metadata = {
						...loadedBook.metadata,
						title: storedTitle,
					};
				}
			}

			const sourceEntry = await storageService.ensureSourceIdentity(canonicalFilePath, {
				preferredSourceId: reusableBook?.sourceId,
				preferredSourceFingerprint: reusableBook?.sourceFingerprint,
			});
			if (isStaleBookLoad(loadToken)) {
				return;
			}
			if (sourceEntry) {
				loadedBook.sourceId = sourceEntry.sourceId;
				loadedBook.sourceFingerprint = sourceEntry.sourceFingerprint;
				loadedBook.sourceSize = sourceEntry.sourceSize;
				loadedBook.sourceMtime = sourceEntry.sourceMtime;
				loadedBook.filePath = sourceEntry.filePath;
			} else if (reusableBook?.sourceId) {
				loadedBook.sourceId = reusableBook.sourceId;
				loadedBook.sourceFingerprint = reusableBook.sourceFingerprint;
			}
			portableBookId = await resolvePortableBookIdForBook(loadedBook, targetFilePath);

			const restoredPosition = await resolveBookLoadRestoredPosition({
				hasProgressCapability: hasReadingProgressCapability(),
				reusableBook,
				loadedBook,
				loadProgress: (bookId, book) => storageService.loadProgress(bookId, book),
			});
			if (isStaleBookLoad(loadToken)) {
				return;
			}
			if (hasReadingProgressCapability() && restoredPosition?.cfi) {
				loadedBook.currentPosition = restoredPosition;
				await readerService.setRestoredPosition?.(restoredPosition);
			}

			book = loadedBook;
			await refreshSemanticSettings();
			bookCompletionPromptDismissedBookId = '';
			currentChapterIndex = loadedBook.currentPosition?.chapterIndex ?? 0;
			syncReadingProgressDisplay(loadedBook.currentPosition?.percent ?? 0);
			updateSessionReadingStartPercent(readingProgress);
			showScrolledChapterNavActions = false;
			bookmarkRevision = 0;
			tocChapterMarks = {};
			tocChapterMarkRevision = 0;
			onTitleChange?.(loadedBook.metadata.title);
			if (isActiveEpubReaderInstance()) {
				epubActiveDocumentStore.setSharedState({ filePath: targetFilePath, book: loadedBook });
			}
			syncAsActiveEpubDocumentIfActive();
			prefetchAnnotationIndexForBook(loadedBook, targetFilePath, { priority: 'immediate' });

			// Unblock the reader shell as soon as the engine can render.
			loading = false;
			void maybeShowTutorialOnBookOpen();
			void finalizeBookLoad(loadToken, loadedBook, targetFilePath, reusableBook);
		} catch (error) {
			if (isStaleBookLoad(loadToken) || error instanceof BookLoadCancelledError) {
				return;
			}
			logger.error(
				`[EpubReaderApp] Failed to load ${getBookFormatDisplayLabel(targetFilePath)}:`,
				error
			);
			setError(`${error instanceof Error ? error.message : t('epub.reader.unknownError')}`);
		} finally {
			if (!isStaleBookLoad(loadToken)) {
				loading = false;
			}
		}
	}

	async function refreshTocChapterMarksForBook(bookId: string): Promise<void> {
		const normalizedBookId = String(bookId || '').trim();
		if (!normalizedBookId) {
			tocChapterMarks = {};
			return;
		}

		try {
			tocChapterMarks = await storageService.getTocChapterMarks(normalizedBookId);
			tocChapterMarkRevision += 1;
			if (isActiveEpubReaderInstance()) {
				epubActiveDocumentStore.setSharedState({
					tocChapterMarks,
					tocChapterMarkRevision,
				});
			}
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to load TOC chapter marks:', error);
			tocChapterMarks = {};
		}
	}

	async function handleSetTocChapterMark(item: TocItem, mark: EpubTocChapterMark | null): Promise<void> {
		if (!book) {
			new Notice(t('epub.reader.bookNotLoaded'));
			return;
		}
		const href = String(item.href || '').trim();
		if (!href) {
			return;
		}

		try {
			tocChapterMarks = await storageService.setTocChapterMark(book.id, href, mark);
			tocChapterMarkRevision += 1;
			epubActiveDocumentStore.setSharedState({
				tocChapterMarks,
				tocChapterMarkRevision,
			});
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to update TOC chapter mark:', error);
			new Notice(t('epub.globalSidebar.tocMarkUpdateFailed'));
			throw error;
		}
	}

	async function handleSaveTocChapterMarkSettings(
		nextSettings: EpubTocChapterMarkSettings
	): Promise<void> {
		try {
			tocChapterMarkSettings = await storageService.saveTocChapterMarkSettings(nextSettings);
			tocChapterMarkSettingsRevision += 1;
			epubActiveDocumentStore.setSharedState({
				tocChapterMarkSettings,
				tocChapterMarkSettingsRevision,
			});
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to save TOC chapter mark settings:', error);
			new Notice(t('epub.globalSidebar.tocMarkSettingsSaveFailed'));
			throw error;
		}
	}

	async function refreshReadingReferencePointState(bookId?: string | null) {
		if (!hasReadingReferenceCapability()) {
			updateReadingReferencePointState(null);
			return;
		}
		const normalizedBookId = String(bookId || '').trim();
		if (!normalizedBookId) {
			updateReadingReferencePointState(null);
			return;
		}

		try {
			const point = await storageService.loadReadingReferencePoint(normalizedBookId);
			updateReadingReferencePointState(point);
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to load reading reference point:', error);
			updateReadingReferencePointState(null);
		}
	}

	function closeTutorial() {
		tutorialVisible = false;
		tutorialInitialTab = undefined;
	}

	function toggleTutorial() {
		if (tutorialVisible) {
			closeTutorial();
			return;
		}
		tutorialInitialTab = undefined;
		tutorialVisible = true;
	}

	async function dismissTutorialPermanently() {
		readerTutorialDismissed = true;
		try {
			await storageService.savePluginUiMemory({ readerTutorialDismissed: true });
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to save tutorial dismiss state:', error);
		}
		closeTutorial();
	}

	async function maybeShowTutorialOnBookOpen() {
		await tutorialDismissStateReady;
		if (readerTutorialDismissed) {
			return;
		}
		tutorialInitialTab = 'workflow';
		tutorialVisible = true;
	}

	async function addBookmark() {
		if (!book) {
			new Notice(t('epub.reader.bookNotLoaded'));
			return;
		}
		try {
			const pos = readerService.getCurrentPosition();
			let currentCfi = EpubLinkService.normalizeCfi(
				pos.cfi || readerService.getCurrentCFI() || book.currentPosition?.cfi || ''
			);
			if (!currentCfi) {
				new Notice(t('epub.reader.readingPositionUnavailable'));
				return;
			}

			if (typeof readerService.canonicalizeLocation === 'function') {
				const canonicalCfi = await readerService.canonicalizeLocation(currentCfi);
				if (canonicalCfi) {
					currentCfi = canonicalCfi;
				}
			}

			const chapterTitle = readerService.getCurrentChapterTitle() || getReadingPositionLabel(pos.percent);
			const result = await bookmarkService.addBookmark(book, {
				cfi: currentCfi,
				chapterIndex: pos.chapterIndex,
				percent: pos.percent,
				chapterTitle,
				pageNumber: settings.flowMode !== 'scrolled' && paginationInfo.currentPage > 0
					? paginationInfo.currentPage
					: undefined,
				totalPages: settings.flowMode !== 'scrolled' && paginationInfo.totalPages > 0
					? paginationInfo.totalPages
					: undefined,
				createdAt: Date.now(),
				preview: chapterTitle,
			});
			bookmarkRevision += 1;
			epubActiveDocumentStore.setSharedState({ bookmarkRevision });
			new Notice(result.created ? t('epub.reader.bookmarkAdded') : t('epub.reader.bookmarkExists'));
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to add bookmark:', error);
			new Notice(t('epub.reader.bookmarkActionFailed'));
		}
	}

	async function deleteBookmarkById(bookmarkId: string): Promise<boolean> {
		if (!book) {
			new Notice(t('epub.reader.bookNotLoaded'));
			return false;
		}

		try {
			const deleted = await bookmarkService.deleteBookmark(book, bookmarkId);
			if (!deleted) {
				new Notice(t('epub.reader.bookmarkMissing'));
				return false;
			}
			bookmarkRevision += 1;
			epubActiveDocumentStore.setSharedState({ bookmarkRevision });
			new Notice(t('epub.reader.bookmarkDeleted'));
			return true;
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to delete bookmark:', error);
			new Notice(t('epub.reader.bookmarkDeleteFailed'));
			return false;
		}
	}

	async function buildReadingReferencePoint(position?: ReadingPosition | null): Promise<EpubReadingReferencePoint | null> {
		if (!book) {
			return null;
		}

		const currentPosition = position ?? readerService.getCurrentPosition();
		let currentCfi = EpubLinkService.normalizeCfi(
			currentPosition.cfi || readerService.getCurrentCFI() || book.currentPosition?.cfi || ''
		);
		if (!currentCfi) {
			return null;
		}

		if (typeof readerService.canonicalizeLocation === 'function') {
			const canonicalCfi = await readerService.canonicalizeLocation(currentCfi);
			if (canonicalCfi) {
				currentCfi = canonicalCfi;
			}
		}

		const percent =
			typeof currentPosition.percent === 'number' && Number.isFinite(currentPosition.percent)
				? currentPosition.percent
				: book.currentPosition?.percent || 0;
		const chapterIndex =
			typeof currentPosition.chapterIndex === 'number' && Number.isFinite(currentPosition.chapterIndex)
				? currentPosition.chapterIndex
				: book.currentPosition?.chapterIndex || 0;
		const chapterTitle = readerService.getCurrentChapterTitle()
			|| getReadingPositionLabel(percent);

		return {
			chapterIndex,
			cfi: currentCfi,
			percent,
			title: chapterTitle,
			savedAt: Date.now(),
		};
	}

	async function saveReadingReferencePoint() {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_READING_REFERENCE, t('epub.reader.readingReferenceFeatureNotice'))) {
			return;
		}
		if (!book) {
			new Notice(t('epub.reader.bookNotLoaded'));
			return;
		}

		try {
			const point = await buildReadingReferencePoint();
			if (!point) {
				new Notice(t('epub.reader.readingPositionUnavailable'));
				return;
			}

			await storageService.saveReadingReferencePoint(book.id, point);
			updateReadingReferencePointState(point);
			showTransientStatus(t('epub.reader.referenceSavedStatus', { title: point.title }), 2600);
			new Notice(t('epub.reader.referenceSaved'));
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to save reading reference point:', error);
			new Notice(t('epub.reader.referenceSaveFailed'));
		}
	}

	async function syncReadingReferencePointFromAutoSave(position: ReadingPosition): Promise<void> {
		if (!hasReadingReferenceCapability()) {
			return;
		}
		if (!book) {
			return;
		}

		try {
			const point = await buildReadingReferencePoint(position);
			if (!point) {
				return;
			}

			await storageService.saveReadingReferencePoint(book.id, point);
			updateReadingReferencePointState(point);
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to sync reading reference point from auto-saved reading progress:', error);
		}
	}

	async function handleAutoReadingPositionSaved(position: ReadingPosition): Promise<void> {
		await syncReadingReferencePointFromAutoSave(position);
		await flushEpubPendingProgress(storageService);
		notifyBookshelfProgressChanged(book?.filePath);
	}

	async function goToReadingReferencePoint() {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_READING_REFERENCE, t('epub.reader.readingReferenceFeatureNotice'))) {
			return;
		}
		if (!readingReferencePoint?.cfi) {
			new Notice(t('epub.reader.referenceMissing'));
			return;
		}
		try {
			const referenceTitle = readingReferencePoint.title || t('epub.reader.referenceFallbackTitle');
			requestBookLocate({
				cfi: readingReferencePoint.cfi,
				flashStyle: 'highlight',
				showLocateOverlay: true,
			});
			showTransientStatus(t('epub.reader.referenceJumpedStatus', { title: referenceTitle }), 2200);
			new Notice(t('epub.reader.referenceJumped'));
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to jump to reading reference point:', error);
			new Notice(t('epub.reader.referenceJumpFailed'));
		}
	}

	async function clearReadingReferencePoint() {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_READING_REFERENCE, t('epub.reader.readingReferenceFeatureNotice'))) {
			return;
		}
		if (!book) {
			new Notice(t('epub.reader.bookNotLoaded'));
			return;
		}
		try {
			await storageService.deleteReadingReferencePoint(book.id);
			updateReadingReferencePointState(null);
			showTransientStatus(t('epub.reader.referenceCleared'), 2200);
			new Notice(t('epub.reader.referenceCleared'));
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to clear reading reference point:', error);
			new Notice(t('epub.reader.referenceClearFailed'));
		}
	}

	function openReadingReferencePointMenu(event: MouseEvent | KeyboardEvent) {
		const canUseReference = hasReadingReferenceCapability();
		const canUseProgress = hasReadingProgressCapability();
		const autoSaveEnabled = getContinuousReadingPositionAutoSaveConfig().enabled;
		const menu = new Menu();

		if (canUseReference && readingReferencePoint) {
			menu.addItem((item) => {
				item.setTitle(getReadingReferenceTitleText());
				item.setIcon('flag');
				item.setDisabled(true);
			});
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle(t('epub.reader.referenceJumpMenu'));
				item.setIcon('locate-fixed');
				item.onClick(() => {
					void goToReadingReferencePoint();
				});
			});
			menu.addItem((item) => {
				item.setTitle(t('epub.reader.referenceUpdateMenu'));
				item.setIcon('flag');
				item.onClick(() => {
					void saveReadingReferencePoint();
				});
			});
			menu.addItem((item) => {
				item.setTitle(t('epub.reader.referenceClearMenu'));
				item.setIcon('trash-2');
				item.onClick(() => {
					void clearReadingReferencePoint();
				});
			});
		} else if (canUseReference) {
			menu.addItem((item) => {
				item.setTitle(t('epub.reader.referenceRecordMenu'));
				item.setIcon('flag');
				item.onClick(() => {
					void saveReadingReferencePoint();
				});
			});
		} else if (isPremiumFeaturePreviewEnabled()) {
			menu.addItem((item) => {
				item.setTitle(
					getPremiumFeatureEntryTitle(
						t('epub.reader.referenceRecordMenu'),
						PREMIUM_FEATURES.EPUB_READING_REFERENCE
					)
				);
				item.setIcon('flag');
				item.onClick(() => {
					openPremiumFeaturePreview(PREMIUM_FEATURES.EPUB_READING_REFERENCE);
				});
			});
		}

		if (canUseReference || isPremiumFeaturePreviewEnabled()) {
			menu.addSeparator();
		}

		if (canUseProgress) {
			menu.addItem((item) => {
				item.setTitle(t('epub.reader.readingPositionAutoSaveMenu'));
				item.setIcon(autoSaveEnabled ? 'locate-fixed' : 'map-pinned');
				item.setChecked(autoSaveEnabled);
				item.onClick(() => {
					void (async () => {
						const nextEnabled = !getContinuousReadingPositionAutoSaveConfig().enabled;
						await setContinuousReadingPositionAutoSaveEnabled(nextEnabled);
						onReadingPositionAutoSaveChange?.();
						new Notice(
							nextEnabled
								? t('epub.reader.autoSaveEnabled')
								: t('epub.reader.autoSaveDisabled')
						);
					})();
				});
			});
		}

		showMenuAtAnchor(menu, event);
	}

	async function applyAndPersistExcerptSettings(patch: Partial<EpubExcerptSettings>) {
		const nextExcerptSettings = {
			...excerptSettings,
			...patch,
		};
		excerptSettings = nextExcerptSettings;
		epubActiveDocumentStore.setSharedState({ excerptSettings: nextExcerptSettings });
		await storageService.saveExcerptSettings(nextExcerptSettings);
	}

	async function syncExcerptSettingsFromStorage() {
		try {
			const savedExcerptSettings = await storageService.loadExcerptSettings();
			excerptSettings = savedExcerptSettings;
			excerptSettingsLoaded = true;
			epubActiveDocumentStore.setSharedState({ excerptSettings: savedExcerptSettings });
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to sync excerpt settings:', error);
		}
	}

	function resolveExcerptChapterTitle(): string {
		const format = excerptSettings.chapterLocationFormat ?? 'leaf';
		if (typeof readerService.getChapterLocationLabel === 'function') {
			return readerService.getChapterLocationLabel(format);
		}
		return readerService.getCurrentChapterTitle();
	}

	async function getAnnotationTocItems(): Promise<TocItem[]> {
		if (!annotationTocItemsPromise) {
			annotationTocItemsPromise = readerService.getTableOfContents().catch((error) => {
				annotationTocItemsPromise = null;
				logger.warn('[EpubReaderApp] Failed to load TOC for annotation metadata:', error);
				return [];
			});
		}
		return annotationTocItemsPromise;
	}

	async function resolveSelectionChapterMetadata(cfiRange: string) {
		const tocItems = await getAnnotationTocItems();
		const sectionHref =
			readerService.getSectionHrefForCfi?.(cfiRange) ||
			readerService.getCurrentChapterHref?.() ||
			'';
		const sectionIndex =
			readerService.getSectionIndexForCfi?.(cfiRange) ??
			readerService.getCurrentChapterIndex();
		return resolveAnnotationChapterMetadata({
			tocItems,
			cfiRange,
			sectionHref,
			spineIndex: sectionIndex,
			fallbackChapterTitle: resolveExcerptChapterTitle(),
		});
	}

	function resolveExcerptChapterLabelMaxLength(): number {
		return excerptSettings.chapterLocationFormat === 'full'
			? EpubLinkService.MAX_FULL_CHAPTER_LABEL_LENGTH
			: EpubLinkService.MAX_CHAPTER_LABEL_LENGTH;
	}

	function handleGlobalExcerptSettingsChanged(event: Event) {
		const detail = event instanceof CustomEvent ? event.detail : null;
		const nextExcerptSettings = detail?.settings;
		if (!nextExcerptSettings || typeof nextExcerptSettings !== 'object') {
			void syncExcerptSettingsFromStorage();
			return;
		}
		excerptSettings = nextExcerptSettings as EpubExcerptSettings;
		excerptSettingsLoaded = true;
		epubActiveDocumentStore.setSharedState({ excerptSettings });
	}

	function showSettingsMenu(evt: MouseEvent) {
		const menu = new Menu();
		const bookshelfSettingsHost = resolveEpubHost(app) as
			| ({ settings?: Record<string, unknown>; saveSettings?: () => Promise<void> })
			| null;
		const currentBookshelfDisplayMode = normalizeBookshelfDisplayMode(
			bookshelfSettingsHost?.settings?.bookshelfDisplayMode
		);

		const applyBookshelfDisplayMode = (mode: BookshelfDisplayMode) => {
			void (async () => {
				if (!bookshelfSettingsHost?.settings) {
					return;
				}
				bookshelfSettingsHost.settings.bookshelfDisplayMode = mode;
				bookshelfSettingsHost.settings.bookshelfAutoViewByLocationEnabled = mode === 'adaptive';
				if (typeof bookshelfSettingsHost.saveSettings === 'function') {
					await bookshelfSettingsHost.saveSettings();
				}
				window.dispatchEvent(new CustomEvent(EPUB_RUNTIME.events.bookshelfDisplaySettingsChanged, {
					detail: {
						enabled: mode === 'adaptive',
						mode,
					},
				}));
				new Notice(t('epub.bookshelf.switchDisplayMode', { mode: getBookshelfDisplayModeOption(mode).label }));
			})();
		};

		menu.addItem((item) => {
			item.setTitle(t('epub.reader.displayFeatures'));
			item.setIcon('library');
			const subMenu = (item as any).setSubmenu();

			for (const option of getBookshelfDisplayModeOptions()) {
				subMenu.addItem((subItem: any) => {
					subItem.setTitle(option.label);
					subItem.setIcon(option.icon);
					subItem.setChecked(currentBookshelfDisplayMode === option.mode);
					subItem.onClick(() => {
						applyBookshelfDisplayMode(option.mode);
					});
				});
			}
		});

		menu.addItem((item) => {
			item.setTitle(t('epub.reader.scanVault'));
			item.setIcon('scan-search');
			item.onClick(() => {
				void scanVaultAndPromptImport();
			});
		});

		menu.addItem((item) => {
			item.setTitle(t('epub.reader.refreshBookshelf'));
			item.setIcon('refresh-cw');
			item.onClick(() => {
				void requestBookshelfRefresh();
			});
		});

		menu.showAtMouseEvent(evt);
	}

	function handleLayoutModeChange(mode: EpubLayoutMode) {
		if (isMobileReader()) {
			mode = 'paginated';
		}
		applyAndPersistReaderSettings({
			...settings,
			layoutMode: mode,
			widthMode: mode === 'double' ? 'fit' : settings.widthMode
		});
	}

	function handleFlowModeChange(mode: EpubFlowMode) {
		applyAndPersistReaderSettings({
			...settings,
			layoutMode: mode === 'scrolled' ? 'paginated' : settings.layoutMode,
			flowMode: mode
		});
	}

	function handleScrolledSideNavToggle(enabled: boolean) {
		applyAndPersistReaderSettings({
			...settings,
			showScrolledSideNav: enabled
		});
	}

	function showBottomNav() {
		return settings.flowMode !== 'scrolled' || (!isMobileReader() && settings.showScrolledSideNav);
	}

	function useVerticalNav() {
		return settings.flowMode === 'scrolled';
	}

	function getBottomNavStatusText(): string | undefined {
		if (transientStatusText.trim()) {
			if (!useVerticalNav()) {
				return undefined;
			}
			return transientStatusText;
		}
		if (!useVerticalNav()) {
			return undefined;
		}
		if (!hasReadingProgressCapability()) {
			return undefined;
		}
		return `${Math.max(0, Math.round(readingProgress))}%`;
	}

	function getBottomNavStatusDetail(): string | undefined {
		if (useVerticalNav()) {
			return undefined;
		}
		const detail = transientStatusText.trim();
		return detail || undefined;
	}

	function getReadingReferenceDeltaText(): string {
		if (sessionReadingStartPercent === null) {
			return '0%';
		}
		const delta = Math.round(readingProgress - sessionReadingStartPercent);
		return delta > 0 ? `+${delta}%` : `${delta}%`;
	}

	function getReadingReferenceTitleText(): string {
		if (!readingReferencePoint) {
			return t('epub.reader.sessionDeltaLabel');
		}
		const currentDelta = getReadingReferenceDeltaText();
		const resumePercent = Math.max(0, Math.round(readingReferencePoint.percent));
		const title = String(
			readingReferencePoint.title || getReadingPositionLabel(resumePercent)
		).trim();
		return t('epub.reader.sessionDeltaTitle', {
			delta: currentDelta,
			percent: resumePercent,
			title,
		});
	}

	function showMenuAtAnchor(menu: Menu, event: MouseEvent | KeyboardEvent) {
		if (domInstanceOf(event, MouseEvent)) {
			menu.showAtMouseEvent(event);
			return;
		}
		menu.showAtPosition({
			x: Math.max(24, Math.round(window.innerWidth / 2)),
			y: Math.max(24, Math.round(window.innerHeight / 2)),
		});
	}

	function clearScrolledNavMetrics() {
		rootEl?.style.removeProperty(SCROLLED_NAV_FRAME_INSET_VAR);
		rootEl?.style.removeProperty(SCROLLED_NAV_SCROLLBAR_VAR);
	}

	function getVisibleReaderFrameGeometry(): {
		frameElement: HTMLElement;
		frameWindow: Window;
		frameDocument: Document;
	} | null {
		for (const frame of readerService.getVisibleFrames()) {
			const frameElement = frame.window?.frameElement;
			if (!domInstanceOf(frameElement, HTMLElement)) {
				continue;
			}
			return {
				frameElement,
				frameWindow: frame.window,
				frameDocument: frame.frameDocument,
			};
		}
		return null;
	}

	function syncScrolledNavMetrics() {
		if (!rootEl || !viewportEl || !showBottomNav() || !useVerticalNav()) {
			clearScrolledNavMetrics();
			return;
		}

		const frameGeometry = getVisibleReaderFrameGeometry();
		if (!frameGeometry) {
			clearScrolledNavMetrics();
			return;
		}

		const viewportRect = viewportEl.getBoundingClientRect();
		const frameRect = frameGeometry.frameElement.getBoundingClientRect();
		const documentElement = frameGeometry.frameDocument.documentElement;
		const body = frameGeometry.frameDocument.body;
		const contentWidth = Math.max(documentElement?.clientWidth || 0, body?.clientWidth || 0);
		const scrollbarWidth = Math.max(0, frameGeometry.frameWindow.innerWidth - contentWidth);
		const frameInsetEnd = Math.max(0, viewportRect.right - frameRect.right);

		rootEl.style.setProperty(SCROLLED_NAV_FRAME_INSET_VAR, `${frameInsetEnd}px`);
		rootEl.style.setProperty(SCROLLED_NAV_SCROLLBAR_VAR, `${scrollbarWidth}px`);
	}

	function scheduleScrolledNavLayoutSync() {
		if (scrolledNavSyncFrame) {
			return;
		}
		scrolledNavSyncFrame = window.requestAnimationFrame(() => {
			scrolledNavSyncFrame = 0;
			syncScrolledNavMetrics();
		});
	}

	function setupScrolledNavMetricsObserver() {
		if (scrolledNavResizeObserver) {
			scrolledNavResizeObserver.disconnect();
		}
		scrolledNavResizeObserver = new ResizeObserver(() => {
			scheduleScrolledNavLayoutSync();
		});
		if (rootEl) {
			scrolledNavResizeObserver.observe(rootEl);
		}
		if (viewportEl) {
			scrolledNavResizeObserver.observe(viewportEl);
		}
	}

	async function handlePrevPage() {
		await readerService.prevPage();
	}

	async function handleNextPage() {
		await readerService.nextPage();
	}

	async function handleJumpToPage(pageNumber: number) {
		await readerService.goToPage(pageNumber);
	}

	function hasPrevChapter(): boolean {
		return Boolean(book && currentChapterIndex > 0);
	}

	function hasNextChapter(): boolean {
		return Boolean(book && currentChapterIndex >= 0 && currentChapterIndex < book.metadata.chapterCount - 1);
	}

	function syncScrolledChapterNavVisibility() {
		const atChapterEnd = Boolean(readerService.isAtCurrentChapterEnd?.());
		showScrolledChapterNavActions = Boolean(
			atChapterEnd && (hasPrevChapter() || hasNextChapter())
		);
	}

	async function handlePrevChapter() {
		if (!hasPrevChapter()) {
			return;
		}

		const moved = await readerService.prevChapter?.();
		if (!moved) {
			new Notice(t('epub.reader.prevChapterExists'));
			return;
		}

		showScrolledChapterNavActions = false;
	}

	async function handleNextChapter() {
		if (!hasNextChapter()) {
			return;
		}

		const moved = await readerService.nextChapter?.();
		if (!moved) {
			new Notice(t('epub.reader.nextChapterExists'));
			return;
		}

		showScrolledChapterNavActions = false;
	}

	function resolveExcerptLinkSourcePath(forEditorInsert: boolean): string | undefined {
		if (!forEditorInsert) {
			return undefined;
		}
		return (getLastActiveMarkdownLeaf?.()?.view as MarkdownView | undefined)?.file?.path;
	}

	function buildNoteContent(
		text: string,
		cfiRange: string,
		color?: string,
		style?: EpubHighlightStyle,
		forEditorInsert = false,
		semantic?: EpubAnnotationSemantic
	): string {
		const chapterIndex = readerService.getCurrentChapterIndex();
		const chapterTitle = resolveExcerptChapterTitle();
		const timestamp = excerptSettings.addCreationTime ? formatTimestamp(new Date()) : undefined;
		return linkService.buildQuoteBlock(
			filePath,
			cfiRange,
			text,
			chapterIndex,
			color,
			chapterTitle,
			timestamp,
			resolveExcerptLinkSourcePath(forEditorInsert),
			book?.sourceId,
			undefined,
			style,
			resolveExcerptChapterLabelMaxLength(),
			semantic?.id
		);
	}

	function buildReadingPointSourceLink(text: string, cfiRange: string): string {
		const chapterIndex = readerService.getCurrentChapterIndex();
		const chapterTitle = resolveExcerptChapterTitle();
		return linkService.buildEpubLink(
			filePath,
			cfiRange,
			text,
			chapterIndex,
			chapterTitle,
			undefined,
			book?.sourceId
		);
	}

	function buildChapterReadingPointSourceLink(
		text: string,
		cfiRange: string,
		chapterIndex?: number
	): string {
		return linkService.buildEpubLink(
			filePath,
			cfiRange,
			text,
			chapterIndex,
			text,
			undefined,
			book?.sourceId
		);
	}

	function formatTimestamp(date: Date): string {
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
	}

	function insertToEditor(content: string): string | null {
		const leaf = getLastActiveMarkdownLeaf?.();
		if (!leaf) {
			new Notice(t('epub.reader.markdownEditorMissing'));
			return null;
		}
		const view = leaf.view;
		if (!(view instanceof MarkdownView) || !view.editor) {
			new Notice(t('epub.reader.markdownEditorMissing'));
			return null;
		}
		const editor = view.editor;
		const cursor = editor.getCursor();
		editor.replaceRange(content + '\n', cursor);
		const lines = content.split('\n').length;
		editor.setCursor({ line: cursor.line + lines, ch: 0 });
		return view.file?.path || null;
	}

	function insertToEditorAndTrack(content: string, delayMs = 900) {
		const sourcePath = insertToEditor(content);
		rememberHighlightSourcePath(sourcePath);
		if (sourcePath) {
			queueHighlightReload(delayMs, { incremental: true });
		}
	}

	async function copyTextToClipboard(content: string) {
		try {
			await navigator.clipboard.writeText(content);
			new Notice(t('epub.reader.copiedToClipboard'));
		} catch (_e) {
			new Notice(t('epub.reader.copyFailed'));
		}
	}

	async function copyImageToClipboard(blob: Blob) {
		try {
			await navigator.clipboard.write([
				new ClipboardItem({ [blob.type]: blob })
			]);
			new Notice(t('epub.reader.imageCopied'));
		} catch (_e) {
			new Notice(t('epub.reader.imageCopyFailed'));
		}
	}

	function outputNote(
		text: string,
		cfiRange: string,
		color?: string,
		style?: EpubHighlightStyle,
		semantic?: EpubAnnotationSemantic
	) {
		if (!hasExcerptNotesCapability()) {
			return;
		}
		if (canvasMode && canvasService.isActive() && hasCanvasExcerptCapability()) {
			addToCanvas(text, cfiRange, color, style, semantic);
			return;
		}

		const content = buildNoteContent(text, cfiRange, color, style, autoInsert, semantic);
		if (autoInsert) {
			insertToEditorAndTrack(content);
		} else {
			copyTextToClipboard(content);
		}
	}

	async function handleCopySelectionLink(
		action: 'protocolMarkdown' | 'vaultWikilink' | 'obsidianUri' | 'plainText',
		text: string,
		cfiRange: string
	) {
		if (!hasExcerptNotesCapability()) {
			if (isPremiumFeaturePreviewEnabled()) {
				openPremiumFeaturePreview(PREMIUM_FEATURES.EPUB_EXCERPT_NOTES);
			}
			return;
		}
		const content = linkService.buildSelectionCopyLink(action, filePath, cfiRange, text, {
			chapterIndex: readerService.getCurrentChapterIndex(),
			chapterTitle: resolveExcerptChapterTitle(),
			sourceId: book?.sourceId,
			chapterLabelMaxLength: resolveExcerptChapterLabelMaxLength(),
		});
		if (content) {
			await copyTextToClipboard(content);
		}
	}

	function showCanvasAddedNotice(
		anchorMode: ReturnType<EpubCanvasService['getLastInsertAnchorMode']>
	): void {
		const noticeKey =
			anchorMode === 'locked'
				? 'epub.reader.addedToCanvasLocked'
				: anchorMode === 'selection'
					? 'epub.reader.addedToCanvasSelection'
					: anchorMode === 'chain'
						? 'epub.reader.addedToCanvasChain'
						: 'epub.reader.addedToCanvas';
		new Notice(t(noticeKey));
	}

	async function addToCanvas(
		text: string,
		cfiRange: string,
		color?: string,
		style?: EpubHighlightStyle,
		semantic?: EpubAnnotationSemantic
	) {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_CANVAS_EXCERPTS, t('epub.reader.canvasExcerptFeatureNotice'))) {
			return;
		}
		const chapterIndex = readerService.getCurrentChapterIndex();
		const chapterTitle = resolveExcerptChapterTitle();

		const timestamp = excerptSettings.addCreationTime ? formatTimestamp(new Date()) : undefined;
		const node = await canvasService.addExcerptNode(
			text,
			cfiRange,
			filePath,
			chapterIndex,
			chapterTitle,
			color,
			timestamp,
			book?.sourceId,
			style,
			resolveExcerptChapterLabelMaxLength(),
			semantic?.id
		);
		if (node) {
			rememberHighlightSourcePath(canvasService.getCanvasPath());
			queueHighlightReload(120, { incremental: true });
			showCanvasAddedNotice(canvasService.getLastInsertAnchorMode());
		}
	}

	async function initCanvasBinding() {
		if (!book || !hasCanvasExcerptCapability()) {
			canvasService.setCanvasPath(null);
			canvasService.setAnchor(null);
			canvasMode = false;
			onCanvasStateChange?.(false, null);
			return;
		}
		const savedPath = await storageService.getCanvasBinding(book.id);
		if (savedPath) {
			const exists = await app.vault.adapter.exists(savedPath);
			if (exists) {
				canvasService.setCanvasPath(savedPath);
				canvasMode = true;
				onCanvasStateChange?.(true, savedPath);
			}
		}
	}

	async function bindCanvas(canvasPath: string) {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_CANVAS_EXCERPTS, t('epub.reader.canvasExcerptFeatureNotice'))) {
			return;
		}
		if (!book) return;
		canvasService.setCanvasPath(canvasPath);
		await storageService.setCanvasBinding(book.id, canvasPath);
		canvasMode = true;
		onCanvasStateChange?.(true, canvasPath);
		void reloadHighlights({ invalidateCache: true });
	}

	async function unbindCanvas() {
		if (!book) return;
		canvasService.setCanvasPath(null);
		canvasService.setAnchor(null);
		await storageService.removeCanvasBinding(book.id);
		canvasMode = false;
		onCanvasStateChange?.(false, null);
		void reloadHighlights({ invalidateCache: true });
	}

	function handleInsertToNote(
		text: string,
		cfiRange: string,
		color?: string,
		style?: EpubHighlightStyle
	) {
		if (!canEditAnnotationsInPane || !ensureAnnotationCompareWritable()) {
			return;
		}
		outputNote(text, cfiRange, color, style);
	}

	async function handleExtractToCard(
		text: string,
		cfiRange: string,
		color?: string,
		style?: EpubHighlightStyle
	) {
		if (!canEditAnnotationsInPane || !ensureAnnotationCompareWritable()) {
			return;
		}
		if (readerReady && hasExcerptNotesCapability()) {
			try {
				readerService.addHighlight({
					cfiRange,
					color: color || 'yellow',
					style,
					text,
					presentation: 'highlight',
				});
			} catch (error) {
				logger.warn('[EpubReaderApp] Failed to apply immediate highlight before card extract:', error);
			}
		}
		await extractContentToCard(
			buildNoteContent(text, cfiRange, color, style),
			t('epub.reader.createCardSuccess'),
			'Failed to extract selection to card',
			t('epub.reader.createCardFailed')
		);
	}

	function showSelectedTextAIMenu(event: MouseEvent, text: string, cfiRange: string) {
		if (!isWeaveMainPluginEnabled(app)) {
			new Notice(t('epub.reader.weaveRequired'));
			return;
		}

		const host = resolveEpubHost(app);
		if (!host?.openSelectedTextAISplitMenu || !host.openSelectedTextAIPanelFromEpub) {
			new Notice(t('epub.reader.weaveRequired'));
			return;
		}

		host.openSelectedTextAISplitMenu({
			event,
			selectedText: text,
			onSelectAction: (actionId: string) => {
				void host.openSelectedTextAIPanelFromEpub?.({
					filePath,
					selectedText: text,
					actionId,
					sourceLink: buildReadingPointSourceLink(text, cfiRange),
				});
			},
		});
	}

	async function handleCreateReadingPoint(text: string, cfiRange: string) {
		if (!canEditAnnotationsInPane || !ensureAnnotationCompareWritable()) {
			return;
		}
		try {
			const plugin = getIncrementalReadingHost();
			if (!plugin?.openIRReadingPointFromExternalSelection) {
				new Notice(t('epub.reader.irUnavailable'));
				return;
			}

			await plugin.openIRReadingPointFromExternalSelection({
				filePath,
				selectedText: text,
				sourceLink: buildReadingPointSourceLink(text, cfiRange),
				successNotice: t('epub.reader.irReadingPointCreated')
			});
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to create reading point from selection:', error);
			new Notice(t('epub.reader.createReadingPointFailed'));
		}
	}

	async function handleCreateChapterReadingPoint(item: TocItem, event?: MouseEvent) {
		try {
			const plugin = getIncrementalReadingHost();
			if (!plugin?.scheduleEpubChapterForIncrementalReading) {
				new Notice(t('epub.reader.irUnavailable'));
				return;
			}

			const topicProvider = plugin.getAvailableEpubIncrementalReadingTopics;
			if (!topicProvider) {
				await plugin.scheduleEpubChapterForIncrementalReading({
					filePath,
					title: item.label,
					tocHref: item.href,
					tocLevel: item.level
				});
				return;
			}

			const topics = (await topicProvider())
				.filter((topic) => String(topic.id || '').trim() && String(topic.name || '').trim());
			if (topics.length === 0) {
				new Notice(t('epub.reader.noIncrementalTopics'));
				return;
			}

			const menu = new Menu();
			for (const topic of topics) {
				menu.addItem((menuItem) => {
					menuItem.setTitle(topic.name);
					menuItem.onClick(() => {
						void plugin.scheduleEpubChapterForIncrementalReading?.({
							filePath,
							title: item.label,
							tocHref: item.href,
							tocLevel: item.level,
							deckId: topic.id,
						});
					});
				});
			}
			if (domInstanceOf(event, MouseEvent)) {
				menu.showAtMouseEvent(event);
			} else {
				menu.showAtPosition({
					x: Math.max(24, Math.round(window.innerWidth / 2)),
					y: Math.max(24, Math.round(window.innerHeight / 2)),
				});
			}
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to add chapter to incremental reading:', error);
			new Notice(t('epub.reader.addToIncrementalReadingFailed'));
		}
	}

	async function exportCurrentChapterToMarkdown() {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_CHAPTER_EXPORT, t('epub.reader.chapterExportFeatureNotice'))) {
			return;
		}
		try {
			const plugin = getMarkdownExportHost();
			if (!plugin?.exportEpubChapterToMarkdown) {
				new Notice(t('epub.reader.exportMarkdownUnavailable'));
				return;
			}

			const chapterHref = readerService.getCurrentChapterHref?.() || '';
			const titleHint = readerService.getCurrentChapterTitle() || book?.metadata.title || t('epub.reader.epubChapterDefaultTitle');
			if (!chapterHref) {
				new Notice(t('epub.reader.chapterLocateFailed'));
				return;
			}

			const draft = await readerService.getChapterReadingPointDraft?.(chapterHref, titleHint);
			if (!draft?.text?.trim()) {
				new Notice(t('epub.reader.chapterExtractFailed'));
				return;
			}

			await plugin.exportEpubChapterToMarkdown({
				filePath,
				title: draft.title || titleHint,
				body: draft.text,
				markdown: draft.markdown,
				assets: draft.assets,
				sourceLink: buildChapterReadingPointSourceLink(
					draft.title || titleHint,
					draft.cfi,
					draft.chapterIndex
				),
				bookTitle: book?.metadata.title,
				author: book?.metadata.author,
			});
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to export current chapter to markdown:', error);
			new Notice(t('epub.reader.exportMarkdownFailed'));
		}
	}

	async function exportChapterMarkedDraftToMarkdown(
		draft: EpubChapterReadingPointDraft,
		titleHint: string,
		options?: { restrictHighlightsToDraftText?: boolean }
	) {
		if (!book) {
			new Notice(t('epub.reader.bookNotReady'));
			return;
		}

		const plugin = getMarkdownExportHost();
		if (!plugin?.exportEpubChapterToMarkdown) {
			new Notice(t('epub.reader.exportMarkdownUnavailable'));
			return;
		}

		const chapterIndex = draft.chapterIndex;
		let chapterHighlights = applySemanticPresentationToHighlights(
			await annotationService.collectAllHighlights(
				getCurrentAnnotationBookId(),
				filePath,
				backlinkService,
				buildCollectHighlightsOptions()
			)
		)
			.filter((highlight) =>
				highlightBelongsToChapterExport(highlight, chapterIndex, draft.chapterHref, {
					getSectionIndexForCfi: (cfi) => readerService.getSectionIndexForCfi?.(cfi) ?? null,
					getSectionHrefForCfi: (cfi) => readerService.getSectionHrefForCfi?.(cfi) ?? null,
				})
			);
		if (options?.restrictHighlightsToDraftText) {
			chapterHighlights = chapterHighlights.filter((highlight) =>
				highlightTextAppearsInChapterDraft(highlight, draft.text)
			);
		}

		const sourceMarkdown = draft.markdown || draft.text;
		const markedExport = await applyChapterHighlightsToMarkdownAsync(sourceMarkdown, chapterHighlights, {
			plainText: draft.text,
			resolveRangeText: (highlight) =>
				readerService.resolveChapterHighlightRangeText?.(
					highlight,
					draft.chapterHref,
					chapterIndex
				) ?? Promise.resolve(null),
		});

		await plugin.exportEpubChapterToMarkdown({
			filePath,
			title: draft.title || titleHint,
			body: draft.text,
			markdown: markedExport.markdown,
			footnotesMarkdown: markedExport.footnotesMarkdown,
			assets: draft.assets,
			sourceLink: buildChapterReadingPointSourceLink(
				draft.title || titleHint,
				draft.cfi,
				draft.chapterIndex
			),
			bookTitle: book.metadata.title,
			author: book.metadata.author,
		});
	}

	async function exportCurrentChapterMarkedToMarkdown() {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_CHAPTER_EXPORT, t('epub.reader.chapterExportFeatureNotice'))) {
			return;
		}
		try {
			const chapterHref = readerService.getCurrentChapterHref?.() || '';
			const titleHint = readerService.getCurrentChapterTitle() || book?.metadata.title || t('epub.reader.epubChapterDefaultTitle');
			if (!chapterHref) {
				new Notice(t('epub.reader.chapterLocateFailed'));
				return;
			}

			const draft = await readerService.getChapterReadingPointDraft?.(chapterHref, titleHint);
			if (!draft?.text?.trim()) {
				new Notice(t('epub.reader.chapterExtractFailed'));
				return;
			}

			await exportChapterMarkedDraftToMarkdown(draft, titleHint);
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to export current chapter marked markdown:', error);
			new Notice(t('epub.reader.exportMarkdownFailed'));
		}
	}

	async function exportTocChapterMarkedToMarkdown(
		item: TocItem,
		itemIndex: number,
		flatTocItems: FlatTocExportItem[]
	) {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_CHAPTER_EXPORT, t('epub.reader.chapterExportFeatureNotice'))) {
			return;
		}
		try {
			if (!readerService.getTocChapterReadingPointDraft) {
				new Notice(t('epub.reader.exportMarkdownUnavailable'));
				return;
			}

			const titleHint = String(item.label || '').trim() || t('epub.reader.epubChapterDefaultTitle');
			const draft = await readerService.getTocChapterReadingPointDraft(
				item.href,
				titleHint,
				flatTocItems,
				itemIndex
			);
			if (!draft?.text?.trim()) {
				new Notice(t('epub.reader.chapterExtractFailed'));
				return;
			}

			await exportChapterMarkedDraftToMarkdown(draft, titleHint, {
				restrictHighlightsToDraftText: true,
			});
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to export toc chapter marked markdown:', error);
			new Notice(t('epub.reader.exportMarkdownFailed'));
		}
	}

	function getHighlightStyleLabel(highlight: ReaderHighlight): string | null {
		if (highlight.presentation === 'conceal') {
			return t('epub.reader.concealed');
		}

		switch (highlight.style) {
			case 'underline':
				return t('epub.reader.underline');
			case 'strikethrough':
				return t('epub.reader.strikethrough');
			case 'wavy':
				return t('epub.reader.wavy');
			default:
				return null;
		}
	}

	function isHighlightSelectedForBookNotesExport(highlight: ReaderHighlight): boolean {
		if (highlight.presentation !== 'highlight') {
			return false;
		}
		if (highlight.style === 'underline') {
			return excerptSettings.bookNotesExportIncludeUnderline;
		}
		if (highlight.style === 'strikethrough') {
			return excerptSettings.bookNotesExportIncludeStrikethrough;
		}
		if (highlight.style === 'wavy') {
			return excerptSettings.bookNotesExportIncludeWavy;
		}
		return excerptSettings.bookNotesExportIncludeHighlight;
	}

	function ensureBookNotesExportSelection(): boolean {
		return Boolean(
			excerptSettings.bookNotesExportIncludeHighlight ||
			excerptSettings.bookNotesExportIncludeUnderline ||
			excerptSettings.bookNotesExportIncludeStrikethrough ||
			excerptSettings.bookNotesExportIncludeWavy
		);
	}

	async function updateBookNotesExportSetting(
		patch: Partial<Pick<
			EpubExcerptSettings,
			| 'bookNotesExportIncludeHighlight'
			| 'bookNotesExportIncludeUnderline'
			| 'bookNotesExportIncludeStrikethrough'
			| 'bookNotesExportIncludeWavy'
			| 'bookNotesExportTemplatePath'
			| 'bookNotesExportTargetMode'
			| 'bookNotesExportAppendPath'
		>>
	) {
		await applyAndPersistExcerptSettings(patch);
	}

	function canSubmitBookNotesExport(): boolean {
		if (!ensureBookNotesExportSelection()) {
			return false;
		}
		if (!String(excerptSettings.bookNotesExportTemplatePath || '').trim()) {
			return false;
		}
		if (
			excerptSettings.bookNotesExportTargetMode === 'append' &&
			!String(excerptSettings.bookNotesExportAppendPath || '').trim()
		) {
			return false;
		}
		return true;
	}

	function buildBookNotesExportLabels() {
		return buildBookNotesExportLabelsFromTranslator(t);
	}

	async function resolveHighlightPageNumber(highlight: ReaderHighlight): Promise<number | undefined> {
		if (!highlight.cfiRange) {
			return undefined;
		}
		try {
			const pageNumber = await readerService.getPageNumberFromCfi(highlight.cfiRange);
			return typeof pageNumber === 'number' && Number.isFinite(pageNumber) && pageNumber > 0
				? pageNumber
				: undefined;
		} catch {
			return undefined;
		}
	}

	async function renderBookNotesExportMarkdown(highlights: ReaderHighlight[]): Promise<string> {
		if (!book) {
			throw new Error('Book not ready');
		}
		return await renderBookNotesMarkdown({
			app,
			book,
			filePath,
			highlights,
			templatePath: excerptSettings.bookNotesExportTemplatePath,
			templateFolder: excerptSettings.bookNotesExportTemplateFolder,
			legacyTemplate: excerptSettings.bookNotesExportLegacyTemplate,
			trimBlocks: excerptSettings.bookNotesExportTrimBlocks,
			labels: buildBookNotesExportLabels(),
			formatTimestamp,
			resolvePageNumber: resolveHighlightPageNumber,
		});
	}

	async function exportRenderedBookNotes(
		markdown: string,
		options: {
			bookTitle?: string;
			targetMode?: EpubExcerptSettings['bookNotesExportTargetMode'];
			appendTargetPath?: string | null;
			rememberAppendTarget?: boolean;
		} = {}
	): Promise<void> {
		const plugin = getMarkdownExportHost();
		if (!plugin?.exportEpubBookNotesToMarkdown) {
			new Notice(t('epub.reader.exportMarkdownUnavailable'));
			return;
		}
		if (!book) {
			new Notice(t('epub.reader.bookNotReady'));
			return;
		}

		const targetMode = options.targetMode ?? excerptSettings.bookNotesExportTargetMode;
		const appendTargetPath =
			options.appendTargetPath ?? excerptSettings.bookNotesExportAppendPath;

		await plugin.exportEpubBookNotesToMarkdown({
			filePath,
			markdown,
			bookTitle: options.bookTitle || book.metadata.title,
			targetMode,
			appendTargetPath,
		});

		if (options.rememberAppendTarget !== false && targetMode === 'append' && appendTargetPath) {
			await storageService.saveBookNotesExportAppendPath(filePath, appendTargetPath);
			await updateBookNotesExportSetting({
				bookNotesExportAppendPath: appendTargetPath,
			});
		}
	}

	async function prepareExportNotesPopoverState(): Promise<void> {
		await excerptSettingsReady;
		const templateFolder = resolveBookNotesExportTemplateFolder(excerptSettings);
		if (!templateFolder) {
			return;
		}
		const templateResult = await ensureDefaultBookNotesExportTemplates(app, templateFolder);
		const perBookAppendPath = await storageService.loadBookNotesExportAppendPath(filePath);
		const patch: Partial<EpubExcerptSettings> = {};

		if (
			!String(excerptSettings.bookNotesExportTemplatePath || '').trim() &&
			templateResult.digestBTemplatePath
		) {
			patch.bookNotesExportTemplatePath = templateResult.digestBTemplatePath;
		}
		if (perBookAppendPath && !String(excerptSettings.bookNotesExportAppendPath || '').trim()) {
			patch.bookNotesExportAppendPath = perBookAppendPath;
		}
		if (Object.keys(patch).length > 0) {
			await applyAndPersistExcerptSettings(patch);
		}
	}

	async function updateBookNotesExportTargetMode(
		targetMode: EpubExcerptSettings['bookNotesExportTargetMode']
	): Promise<void> {
		if (excerptSettings.bookNotesExportTargetMode === targetMode) {
			return;
		}
		await updateBookNotesExportSetting({ bookNotesExportTargetMode: targetMode });
	}

	function closeExportNotesPopover() {
		exportNotesPopoverOpen = false;
		exportNotesSubmitting = false;
	}

	function openExportNotesPopover(event?: MouseEvent) {
		event?.preventDefault();
		exportNotesSubmitting = false;
		// Defer until Obsidian pane menu has dismissed so outside-clicks do not hit both layers.
		window.setTimeout(() => {
			void prepareExportNotesPopoverState().finally(() => {
				exportNotesPopoverOpen = true;
			});
		}, 0);
	}

	function handleExportNotesPointerDownOutside(event: MouseEvent) {
		if (!exportNotesPopoverOpen || !exportNotesPopoverEl) {
			return;
		}
		if (!shouldDismissToolbarOnPointerDown(exportNotesPopoverEl, event)) {
			return;
		}
		closeExportNotesPopover();
	}

	function getHighlightChapterIndex(highlight: ReaderHighlight): number | undefined {
		return typeof highlight.chapterIndex === 'number' && Number.isFinite(highlight.chapterIndex)
			? highlight.chapterIndex
			: undefined;
	}

	function buildReaderHighlightSelectionKey(highlight: ReaderHighlight): string {
		return buildEpubDisplayHighlightSelectionKey({
			cfiRange: highlight.cfiRange,
			sourceRef: highlight.sourceRef,
			sourceFile: highlight.sourceFile,
			excerptId: highlight.excerptId,
		});
	}

	function buildHighlightClickInfoFromDisplay(highlight: EpubDisplayHighlight): HighlightClickInfo {
		const style =
			highlight.noteTypeKey === 'underline' ||
			highlight.noteTypeKey === 'strikethrough' ||
			highlight.noteTypeKey === 'wavy'
				? highlight.noteTypeKey
				: undefined;
		return {
			cfiRange: highlight.cfiRange,
			color: highlight.color,
			style,
			text: highlight.text,
			commentText: highlight.commentText,
			hasCommentDivider: highlight.hasCommentDivider,
			chapterIndex: highlight.chapterIndex,
			chapterTitle: highlight.chapterTitle,
			chapterRootTitle: highlight.chapterRootTitle,
			chapterPath: highlight.chapterPath,
			chapterHref: highlight.chapterHref,
			spineIndex: highlight.spineIndex,
			sourceFile: highlight.sourceFile || '',
			sourceRef: highlight.sourceRef,
			excerptId: highlight.excerptId,
			createdTime: highlight.createdTime,
			presentation: 'highlight',
			rect: { top: 0, left: 0, width: 0, height: 0 },
		};
	}

	async function exportHighlightsBySelectionKeys(selectionKeys: string[]): Promise<void> {
		try {
			const plugin = getMarkdownExportHost();
			if (!plugin?.exportEpubBookNotesToMarkdown) {
				new Notice(t('epub.reader.exportMarkdownUnavailable'));
				return;
			}
			if (!book) {
				new Notice(t('epub.reader.bookNotReady'));
				return;
			}
			if (!ensureBookNotesExportSelection()) {
				new Notice(t('epub.reader.selectAtLeastOneExportType'));
				return;
			}

			const keySet = new Set(selectionKeys);
			const highlights = applySemanticPresentationToHighlights(
				await annotationService.collectAllHighlights(
					getCurrentAnnotationBookId(),
					filePath,
					backlinkService,
					buildCollectHighlightsOptions()
				)
			)
				.filter((highlight) => keySet.has(buildReaderHighlightSelectionKey(highlight)))
				.filter(isHighlightSelectedForBookNotesExport);
			if (highlights.length === 0) {
				new Notice(t('epub.notes.noExportableSelection'));
				return;
			}

			const markdown = await renderBookNotesExportMarkdown(highlights);
			await exportRenderedBookNotes(markdown, {
				targetMode: 'new',
				rememberAppendTarget: false,
			});
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to export selected highlights to markdown:', error);
			new Notice(t('epub.reader.exportReadingNotesFailed'));
		}
	}

	async function exportCurrentChapterHighlightsToMarkdown() {
		try {
			if (!book) {
				new Notice(t('epub.reader.bookNotReady'));
				return;
			}
			if (!ensureBookNotesExportSelection()) {
				new Notice(t('epub.reader.selectAtLeastOneExportType'));
				return;
			}

			const chapterIndex = readerService.getCurrentChapterIndex();
			const chapterTitle = readerService.getCurrentChapterTitle() || t('epub.reader.epubChapterDefaultTitle');
			const highlights = applySemanticPresentationToHighlights(
				await annotationService.collectAllHighlights(
					getCurrentAnnotationBookId(),
					filePath,
					backlinkService,
					buildCollectHighlightsOptions()
				)
			)
				.filter((highlight) => getHighlightChapterIndex(highlight) === chapterIndex)
				.filter(isHighlightSelectedForBookNotesExport);
			if (highlights.length === 0) {
				new Notice(t('epub.reader.noChapterExportableNotes'));
				return;
			}

			const markdown = await renderBookNotesExportMarkdown(highlights);
			await exportRenderedBookNotes(markdown, {
				bookTitle: `${book.metadata.title} - ${chapterTitle}`,
				targetMode: 'new',
				rememberAppendTarget: false,
			});
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to export current chapter highlights to markdown:', error);
			new Notice(t('epub.reader.exportReadingNotesFailed'));
		}
	}

	async function exportBookHighlightsToMarkdown(event?: MouseEvent) {
		try {
			if (!book) {
				new Notice(t('epub.reader.bookNotReady'));
				return;
			}

			if (event) {
				openExportNotesPopover(event);
				return;
			}

			if (!canSubmitBookNotesExport()) {
				if (!ensureBookNotesExportSelection()) {
					new Notice(t('epub.reader.selectAtLeastOneExportType'));
				} else if (!String(excerptSettings.bookNotesExportTemplatePath || '').trim()) {
					new Notice(t('epub.reader.exportNotesPopover.templateRequired'));
				} else {
					new Notice(t('epub.reader.exportNotesPopover.appendTargetRequired'));
				}
				return;
			}

			const highlights = applySemanticPresentationToHighlights(
				await annotationService.collectAllHighlights(
					getCurrentAnnotationBookId(),
					filePath,
					backlinkService,
					buildCollectHighlightsOptions()
				)
			)
				.filter(isHighlightSelectedForBookNotesExport);
			if (highlights.length === 0) {
				new Notice(t('epub.reader.noExportableNotes'));
				return;
			}

			const markdown = await renderBookNotesExportMarkdown(highlights);
			await exportRenderedBookNotes(markdown);
			closeExportNotesPopover();
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to export book highlights to markdown:', error);
			new Notice(t('epub.reader.exportReadingNotesFailed'));
			exportNotesSubmitting = false;
		}
	}

	async function submitBookNotesExport() {
		if (exportNotesSubmitting) {
			return;
		}
		if (!hasExcerptNotesCapability()) {
			return;
		}
		exportNotesSubmitting = true;
		try {
			await exportBookHighlightsToMarkdown();
		} finally {
			if (exportNotesPopoverOpen) {
				exportNotesSubmitting = false;
			}
		}
	}

	async function handleHighlightExtractToCard(info: HighlightClickInfo) {
		if (!canEditAnnotationsInPane || !ensureAnnotationCompareWritable()) {
			return;
		}
		await extractContentToCard(
			buildNoteContent(
				info.text,
				info.cfiRange,
				info.color,
				info.style,
				false,
				resolveSemanticFromHighlightInfo(info)
			),
			t('epub.reader.createCardSuccess'),
			'Failed to extract highlight to card',
			t('epub.reader.highlightExtractFailed'),
			() => {
				highlightToolbarInfo = null;
			}
		);
	}

        function handleAutoInsertSelection(
		text: string,
		cfiRange: string,
		color?: string,
		style?: EpubHighlightStyle,
		semantic?: EpubAnnotationSemantic,
		segments?: ReaderHighlightSegment[]
	) {
		if (!hasExcerptNotesCapability()) {
			return;
		}
		if (!ensureAnnotationCompareWritable()) {
			return;
		}
		if (book) {
			const bookId = getCurrentAnnotationBookId();
			const baseHighlight: ReaderHighlight = {
				cfiRange,
				color: color || semantic?.color || 'yellow',
				...(style ? { style } : {}),
				...(semantic?.id ? {
					semanticId: semantic.id,
					semanticLabel: semantic.label,
					semanticGroup: semantic.group || 'study',
					semanticDescription: semantic.description,
					semanticSource: semantic.source || 'preset',
				} : {}),
				text,
				...(segments && segments.length > 1 ? { segments } : {}),
				chapterIndex: readerService.getCurrentChapterIndex(),
				chapterTitle: resolveExcerptChapterTitle(),
				createdTime: Date.now(),
				presentation: 'highlight',
			};
			void enqueueAnnotationMutation(async () => {
				const chapterMetadata = await resolveSelectionChapterMetadata(cfiRange);
				const highlight = applyAnnotationChapterMetadata(baseHighlight, chapterMetadata);
				const result = await annotationService.savePortableHighlightWithPolicy(bookId, highlight);
				if (result.kind === 'create') {
					annotationUndoStack.pushCreate(bookId, result.current);
					queueOpenAnnotationNoteRefresh(bookId);
					return;
				}
				if (result.kind === 'replace') {
					removeHighlightFromCurrentView(result.previous);
					addHighlightToCurrentView(result.current);
					annotationUndoStack.pushUpdate(bookId, result.previous, result.current);
					queueOpenAnnotationNoteRefresh(bookId);
				}
			});
		}
		outputNote(text, cfiRange, color, style, semantic);
	}

	async function handleConcealSelection(text: string, cfiRange: string) {
		if (!hasExcerptNotesCapability()) {
			return;
		}
		if (!ensureAnnotationCompareWritable()) {
			return;
		}
		if (!book) {
			new Notice(t('epub.reader.bookNotReady'));
			return;
		}

		try {
			const canonicalCfi = typeof readerService.canonicalizeLocation === 'function'
				? await readerService.canonicalizeLocation(cfiRange, text)
				: cfiRange;
			await annotationService.createConcealedText(
				book.id,
				text,
				readerService.getCurrentChapterIndex(),
				canonicalCfi || cfiRange,
				'mask'
			);
			new Notice(t('epub.reader.hideTextSuccess'));
			void reloadHighlights();
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to conceal selection:', error);
			new Notice(t('epub.reader.hideTextFailed'));
		}
	}

	function requestSourceBookLocate(nav: BookLocateIntent): boolean {
		if (!ensureBookSourceLocationAccess(app, t('epub.reader.sourceLocationFeatureNotice'))) {
			return false;
		}
		epubNavigation.requestBookLocate(nav);
		return true;
	}

	function requestBookLocate(nav: BookLocateIntent) {
		epubNavigation.requestBookLocate(nav);
	}

	function flushPendingLocateFromProps() {
		if (!hasSourceLocationCapability()) {
			return;
		}
		epubNavigation.flushPendingLocateFromProps(pendingLocate, pendingCfi, pendingText);
	}

	/** `linkTextHint` is only honored when embedded in link metadata, not callout body text. */
	function navigateToCfi(cfi: string, linkTextHint = '') {
		requestSourceBookLocate({
			cfi,
			text: linkTextHint,
			flashStyle: 'highlight',
			showLocateOverlay: true,
		});
	}

	function getVisibleReaderFrames(): EpubVisibleFrameLike[] {
		return readerService.getVisibleFrames() as EpubVisibleFrameLike[];
	}

	async function handleScreenshotCapture(blob: Blob, rect: ScreenshotRect) {
		const currentCfi = readerService.getCurrentCFI();
		const chapterIndex = readerService.getCurrentChapterIndex();
		const chapterTitle = resolveExcerptChapterTitle();
		const targetNotePath = (getLastActiveMarkdownLeaf?.()?.view as MarkdownView | undefined)?.file?.path;

		let canvasContent: string | null = null;

		if (autoInsert) {
			if (screenshotSaveAsImage) {
				const bookTitle = book?.metadata.title || 'epub';
				const imagePath = await screenshotService.saveAsJpeg(blob, bookTitle);
				const insertText = screenshotService.buildJpegInsert(
					imagePath,
					filePath,
					currentCfi,
					chapterIndex,
					chapterTitle,
					targetNotePath
				);
				insertToEditorAndTrack(insertText);
				canvasContent = insertText;
			} else {
				const extractedText = screenshotService.extractTextFromRect(viewportEl!, rect, getVisibleReaderFrames());
				const insertText = screenshotService.buildSnapshotEmbed(
					filePath,
					currentCfi,
					extractedText,
					chapterIndex,
					chapterTitle,
					targetNotePath
				);
				insertToEditorAndTrack(insertText);
				canvasContent = insertText;
			}
		} else {
			if (screenshotSaveAsImage) {
				const pngBlob = await convertToClipboardImage(blob);
				await copyImageToClipboard(pngBlob);
			} else {
				const extractedText = screenshotService.extractTextFromRect(viewportEl!, rect, getVisibleReaderFrames());
				const content = screenshotService.buildSnapshotEmbed(
					filePath,
					currentCfi,
					extractedText,
					chapterIndex,
					chapterTitle,
					targetNotePath
				);
				await copyTextToClipboard(content);
				canvasContent = content;
			}
		}

		if (canvasMode && canvasService.isActive() && canvasContent) {
			const node = await canvasService.addRawTextNode(canvasContent);
			if (node) {
				showCanvasAddedNotice(canvasService.getLastInsertAnchorMode());
			}
		}
	}

	async function convertToClipboardImage(blob: Blob): Promise<Blob> {
		const img = new Image();
		const url = URL.createObjectURL(blob);
		return new Promise((resolve) => {
			img.onload = () => {
				const canvas = activeWindow.createEl('canvas');
				canvas.width = img.naturalWidth;
				canvas.height = img.naturalHeight;
				const ctx = canvas.getContext('2d')!;
				ctx.drawImage(img, 0, 0);
				URL.revokeObjectURL(url);
				canvas.toBlob((b) => resolve(b || blob), 'image/png');
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				resolve(blob);
			};
			img.src = url;
		});
	}

	function handleEpubNavigateEvent(e: Event) {
		const detail = (e as CustomEvent).detail;
		if (!detail || detail.filePath !== filePath) return;

		const nav = epubNavigation.buildLocateFromEventDetail(detail);
		if (nav) {
			requestSourceBookLocate(nav);
		}
	}

	function setupHighlightClickHandler() {
		readerService.onHighlightClick((info: HighlightClickInfo) => {
			footnotePreviewInfo = null;
			if (info.interactionTarget === 'reference-badge') {
				return;
			}
			if (annotationCompareReadOnly) {
				closeAnnotationDisambiguation();
				closeCommentEditor();
				highlightToolbarInfo = null;
				referencePopoverInfo = null;
				referencePopoverStats = null;
				return;
			}
			if (info.interactionTarget === 'comment-marker') {
				closeAnnotationDisambiguation();
				referencePopoverInfo = null;
				referencePopoverStats = null;
				openCommentEditor(info);
				return;
			}
			if (readerUiMode === 'minimal') {
				closeAnnotationDisambiguation();
				highlightToolbarInfo = null;
				return;
			}
			referencePopoverInfo = null;
			referencePopoverStats = null;
			closeCommentEditor();
			const candidates = collectAnnotationCandidatesAtHighlight(info);
			if (candidates.length > 1) {
				highlightToolbarInfo = null;
				annotationDisambiguationAnchor = info;
				annotationDisambiguationCandidates = candidates;
				return;
			}
			openAnnotationActions(info);
		});
	}

	function setupScrolledChapterEndHandler() {
		scrolledChapterEndCleanup?.();
		scrolledChapterEndCleanup = null;
		if (typeof readerService.onScrolledChapterEndChange !== 'function') {
			return;
		}
		scrolledChapterEndCleanup = readerService.onScrolledChapterEndChange(() => {
			syncScrolledChapterNavVisibility();
		});
	}

	function setupReferenceBadgeClickHandler() {
		referenceBadgeClickCleanup?.();
		referenceBadgeClickCleanup = null;

		const cleanupTasks: Array<() => void> = [];

		if (typeof readerService.onReferenceBadgeClick === 'function') {
			cleanupTasks.push(
				readerService.onReferenceBadgeClick((info: HighlightClickInfo) => {
					void handleReferenceBadgeClick(info);
				})
			);
		}

		// 保留旧的 DOM 自定义事件监听作为兼容兜底。
		if (readerService && typeof (readerService as any).foliateView !== 'undefined') {
			const foliateView = (readerService as any).foliateView;
			if (foliateView) {
				const handleReferenceBadgeClickEvent = (event: Event) => {
					const customEvent = event as CustomEvent;
					const cfiRange = customEvent.detail?.cfiRange;
					if (cfiRange) {
						const info = readerService.getHighlightClickInfo?.(cfiRange, 'reference-badge') || cfiRange;
						void handleReferenceBadgeClick(info);
					}
				};

				foliateView.addEventListener('reference-badge-click', handleReferenceBadgeClickEvent as EventListener);
				cleanupTasks.push(() => {
					foliateView.removeEventListener(
						'reference-badge-click',
						handleReferenceBadgeClickEvent as EventListener
					);
				});
			}
		}

		if (cleanupTasks.length > 0) {
			referenceBadgeClickCleanup = () => {
				for (const cleanup of cleanupTasks) {
					cleanup();
				}
			};
		}
	}

	function setupFootnotePreviewHandler() {
		readerService.onFootnotePreview((info: ReaderFootnotePreviewInfo | null) => {
			logger.debugWithTag(
				'FootnoteDiag',
				`[FootnoteDiag] EpubReaderApp received footnote preview event hasInfo=${String(Boolean(info))} href=${info?.href || ''} textLength=${String(info?.text.length || 0)}`
			);
			if (!hasFootnotePreviewCapability()) {
				footnotePreviewInfo = null;
				return;
			}
			if (highlightToolbarInfo || commentEditorInfo) {
				footnotePreviewInfo = null;
				return;
			}
			footnotePreviewInfo = info;
		});
	}

	function openCommentEditor(info: HighlightClickInfo) {
		if (!hasExcerptNotesCapability()) {
			return;
		}
		if (!ensureAnnotationCompareWritable()) {
			return;
		}
		highlightToolbarInfo = null;
		footnotePreviewInfo = null;
		referencePopoverInfo = null;
		referencePopoverStats = null;
		commentEditorInfo = info;
		commentEditorDraft = resolveCommentDraftFromMemory(info);
		commentEditorSaving = false;
		void hydrateCommentEditorDraft(info);
	}

	async function hydrateCommentEditorDraft(info: HighlightClickInfo) {
		const hydrated = await resolveCommentDraftFromSource(info);
		if (commentEditorInfo !== info) {
			return;
		}
		commentEditorDraft = hydrated;
		if (!hydrated.trim()) {
			return;
		}
		if (info.commentText === hydrated && info.hasCommentDivider) {
			return;
		}
		const refreshedHighlight: ReaderHighlight = {
			cfiRange: info.cfiRange,
			color: info.color,
			style: info.style,
			semanticId: info.semanticId,
			semanticLabel: info.semanticLabel,
			semanticGroup: info.semanticGroup,
			semanticDescription: info.semanticDescription,
			semanticSource: info.semanticSource,
			text: info.text,
			commentText: hydrated,
			hasCommentDivider: true,
			sourceFile: info.sourceFile,
			sourceRef: info.sourceRef,
			excerptId: info.excerptId,
			sourceLocators: info.sourceLocators,
			createdTime: info.createdTime,
			presentation: info.presentation,
		};
		readerService.addHighlight(refreshedHighlight);
		markCollectedHighlightsStale();
		pendingLoadedHighlights = mergeReaderHighlightsByIdentity(
			pendingLoadedHighlights,
			[refreshedHighlight]
		);
	}

	function closeCommentEditor() {
		commentEditorInfo = null;
		commentEditorDraft = '';
		commentEditorSaving = false;
	}

	function closeReferencePopover() {
		referencePopoverInfo = null;
		referencePopoverStats = null;
	}

	function syncAsActiveEpubDocumentIfActive(leaf: WorkspaceLeaf | null = app.workspace.activeLeaf): void {
		if (isActiveEpubReaderInstance(leaf)) {
			syncAsActiveEpubDocument();
		}
	}

	function handleWorkspaceActiveLeafChange(leaf: WorkspaceLeaf | null): void {
		syncAsActiveEpubDocumentIfActive(leaf);
	}

	function syncAsActiveEpubDocument() {
		const activeFilePath = filePath?.trim() ? filePath : null;
		const canUseReadingProgress = hasReadingProgressCapability();
		const canUseExcerptNotes = canReadAnnotationsInPane;
		const canEditExcerptNotes = canEditAnnotationsInPane;
		if (!activeFilePath) {
			epubActiveDocumentStore.clearActiveDocument();
			epubActiveDocumentStore.setSharedState({
				filePath: null,
				canUseReadingProgress,
				canUseExcerptNotes,
				excerptSettings,
				highlightViewSnapshotService: canUseExcerptNotes ? highlightViewSnapshotService : null,
				onDeleteBookmark: null,
				onDeleteHighlight: null,
				onExportHighlights: null,
				onSettingsClick: showSettingsMenu,
			});
			return;
		}

		epubActiveDocumentStore.setActiveDocument(activeFilePath);
		epubActiveDocumentStore.setSharedState({
			filePath: activeFilePath,
			readerService,
			annotationService: canUseExcerptNotes ? annotationService : null,
			highlightViewSnapshotService: canUseExcerptNotes ? highlightViewSnapshotService : null,
			backlinkService: canUseExcerptNotes ? backlinkService : null,
			referenceStatsService: canUseExcerptNotes ? referenceStatsService : null,
			book,
			canUseReadingProgress,
			canUseExcerptNotes,
			excerptSettings,
			annotationRevision,
			bookmarkRevision,
			tocChapterMarks,
			tocChapterMarkSettings,
			tocChapterMarkRevision,
			tocChapterMarkSettingsRevision,
			progress: canUseReadingProgress ? readingProgress : 0,
			chapterTitle: readerService.getCurrentChapterTitle(),
			chapterHref: readerService.getCurrentChapterHref?.() || '',
			paginationInfo,
			onDeleteBookmark: deleteBookmarkById,
			onDeleteHighlight: canEditExcerptNotes ? deleteDisplayHighlight : null,
			onExportHighlights: canUseExcerptNotes ? exportHighlightsBySelectionKeys : null,
			onNavigate: requestBookLocate,
			onSettingsClick: showSettingsMenu,
			onSwitchBook,
			onCreateChapterReadingPoint: hasScheduleChapterForIncrementalReadingCapability()
				? handleCreateChapterReadingPoint
				: null,
			onExportTocChapterMarked: hasChapterExportCapability()
				? exportTocChapterMarkedToMarkdown
				: null,
			onSetTocChapterMark: handleSetTocChapterMark,
			onSaveTocChapterMarkSettings: handleSaveTocChapterMarkSettings,
		});
	}

	async function resolveHighlightSource(info: HighlightClickInfo): Promise<BacklinkSourceMatch | null> {
		let sourceFile = String(info.sourceFile || '').trim();
		let sourceRef = info.sourceRef;
		let excerptId = info.excerptId;
		let storedCfiRange: string | undefined;

		const resolved = await backlinkService.findSourceForCfi(
			info.cfiRange,
			filePath,
			sourceFile || undefined,
			{
				text: info.text,
				createdTime: info.createdTime,
			}
		);
		if (resolved?.sourceFile) {
			sourceFile = resolved.sourceFile;
			if (!sourceRef && resolved.sourceRef) {
				sourceRef = resolved.sourceRef;
			}
			if (!excerptId && resolved.excerptId) {
				excerptId = resolved.excerptId;
			}
			if (resolved.cfiRange) {
				storedCfiRange = resolved.cfiRange;
			}
		}

		if (!sourceFile) {
			sourceFile = await backlinkService.findSourceFileForCfi(info.cfiRange, filePath) || '';
		}

		if (!sourceFile) {
			return null;
		}

		return {
			sourceFile,
			sourceRef,
			excerptId,
			cfiRange: storedCfiRange,
		};
	}

	function resolveHighlightMutationCfi(
		info: HighlightClickInfo,
		source: BacklinkSourceMatch
	): string {
		return String(source.cfiRange || info.cfiRange || '').trim();
	}

	function hasGeneratedAnnotationNoteSource(info: HighlightClickInfo, source?: BacklinkSourceMatch | null): boolean {
		if (isEpubGeneratedAnnotationNotePath(source?.sourceFile)) {
			return true;
		}
		if (isEpubGeneratedAnnotationNotePath(info.sourceFile)) {
			return true;
		}
		return (info.sourceLocators || []).some((locator) => isEpubGeneratedAnnotationNotePath(locator.sourceFile));
	}

	async function handleHighlightDelete(
		info: HighlightClickInfo,
		options?: { quiet?: boolean }
	): Promise<boolean> {
		const quiet = options?.quiet === true;
		if (!hasExcerptNotesCapability()) {
			return false;
		}
		if (!ensureAnnotationCompareWritable()) {
			return false;
		}
		if (info.presentation === 'conceal') {
			readerService.removeHighlight(info.cfiRange);
			if (!book) {
				if (!quiet) {
					new Notice(t('epub.reader.bookNotReady'));
				}
				return false;
			}
			await annotationService.deleteConcealedTextByCfi(book.id, info.cfiRange);
			if (!quiet) {
				new Notice(t('epub.reader.hideTextRestored'));
			}
			highlightToolbarInfo = null;
			void reloadHighlights();
			return true;
		}
		const source = await resolveHighlightSource(info);
		const generatedAnnotationNoteSource = hasGeneratedAnnotationNoteSource(info, source);
		if (!source?.sourceFile || generatedAnnotationNoteSource) {
			if (book) {
				const annotationBookId = getCurrentAnnotationBookId();
				let removedPortableHighlight: ReaderHighlight | null = null;
				await enqueueAnnotationMutation(async () => {
					removedPortableHighlight = await annotationService.removePortableHighlight(
						annotationBookId,
						buildReaderHighlightFromInfo(info)
					);
					if (removedPortableHighlight) {
						annotationUndoStack.pushDelete(annotationBookId, removedPortableHighlight);
					}
				});
				if (removedPortableHighlight) {
					removeHighlightFromCurrentView(removedPortableHighlight);
					queueOpenAnnotationNoteRefresh(annotationBookId);
					if (!quiet) {
						new Notice(t('epub.reader.highlightDeleted'));
					}
					return true;
				}
				if (generatedAnnotationNoteSource) {
					removeHighlightFromCurrentView(buildReaderHighlightFromInfo(info));
					queueOpenAnnotationNoteRefresh(annotationBookId);
					void reloadHighlights({ invalidateCache: true });
					if (!quiet) {
						new Notice(t('epub.reader.highlightDeleted'));
					}
					return true;
				}
			}
			if (!quiet) {
				new Notice(t('epub.reader.highlightSourcePending'));
			}
			void reloadHighlights();
			return false;
		}
		const mutationCfiRange = resolveHighlightMutationCfi(info, source);

		const officialApi = resolveEpubWeaveOfficialAPI(app);
		const officialApiInfo = officialApi?.getInfo?.();
		const canUseOfficialExcerptApi = !!(
			officialApi?.removeExcerpt &&
			officialApiInfo?.capabilities?.excerpts?.remove
		);
		const supportsInteractiveUserChoice = !!officialApiInfo?.capabilities?.excerpts?.supportsInteractiveUserChoice;

		if (canUseOfficialExcerptApi) {
			const officialApiResult = await deleteHighlightThroughOfficialAPI(
				officialApi,
				info,
				source,
				mutationCfiRange,
				supportsInteractiveUserChoice
			);
			if (officialApiResult !== 'fallback') {
				if (officialApiResult === 'success') {
					readerService.removeHighlight(info.cfiRange);
					if (!quiet) {
						new Notice(t('epub.reader.highlightDeleted'));
					}
					highlightToolbarInfo = null;
					reloadHighlightsAfterExcerptMutation(source.sourceFile);
					return true;
				}
				if (officialApiResult === 'failed') {
					if (!(await isHighlightStillPersistedInSource(info, source))) {
						await finalizeHighlightRemoval(info, source, { quiet });
						return true;
					}
					if (!quiet) {
						new Notice(t('epub.reader.highlightDeleteFailed'));
					}
				}
				if (officialApiResult !== 'cancelled') {
					void reloadHighlights({ invalidateCache: true });
				}
				return false;
			}
		}

		let cardDeletionMode: 'excerpt-only' | 'delete-card' | undefined;
		if (source.sourceFile.endsWith('.json') || source.sourceFile.endsWith('.wdeck')) {
			const analysis = await backlinkService.inspectCardDataHighlightDeletion(
				source.sourceFile,
				mutationCfiRange,
				filePath,
				source.sourceRef,
				source.excerptId
			);

			if (analysis?.hasAdditionalContent) {
				const message = [
					t('epub.reader.highlightDeleteChoiceMessage'),
					analysis.additionalContentPreview
						? `${t('epub.reader.highlightDeleteChoicePreviewLabel')}\n${analysis.additionalContentPreview}`
						: '',
				].filter(Boolean).join('\n\n');
				const choice = await showObsidianChoice(app, message, {
					title: t('epub.reader.highlightDeleteChoiceTitle'),
					cancelText: t('epub.reader.highlightDeleteChoiceCancel'),
					choices: [
						{
							value: 'excerpt-only',
							text: t('epub.reader.highlightDeleteChoiceExcerptOnly'),
							description: t('epub.reader.highlightDeleteChoiceExcerptOnlyDescription'),
							className: 'mod-cta',
						},
						{
							value: 'delete-card',
							text: t('epub.reader.highlightDeleteChoiceDeleteCard'),
							description: t('epub.reader.highlightDeleteChoiceDeleteCardDescription'),
							className: 'mod-warning',
						},
					],
				});

				if (!choice) {
					reloadHighlightsAfterExcerptMutation(source.sourceFile);
					return false;
				}
				cardDeletionMode = choice;
			} else if (analysis?.matched) {
				cardDeletionMode = analysis.recommendedMode;
			}
		}

		const deleted = await backlinkService.deleteHighlight(
			source.sourceFile,
			mutationCfiRange,
			filePath,
			source.sourceRef,
			source.excerptId,
			cardDeletionMode
		);
		if (deleted) {
			readerService.removeHighlight(info.cfiRange);
			if (!quiet) {
				new Notice(t('epub.reader.highlightDeleted'));
			}
			highlightToolbarInfo = null;
			reloadHighlightsAfterExcerptMutation(source.sourceFile);
			return true;
		}
		if (!(await isHighlightStillPersistedInSource(info, source))) {
			await finalizeHighlightRemoval(info, source, { quiet });
			return true;
		}
		if (!quiet) {
			new Notice(t('epub.reader.highlightDeleteFailed'));
		}
		reloadHighlightsAfterExcerptMutation(source.sourceFile);
		return false;
	}

	async function deleteDisplayHighlight(highlight: EpubDisplayHighlight, quiet = false): Promise<boolean> {
		return handleHighlightDelete(buildHighlightClickInfoFromDisplay(highlight), { quiet });
	}

	async function deleteHighlightThroughOfficialAPI(
		api: EpubWeaveOfficialAPI,
		info: HighlightClickInfo,
		source: BacklinkSourceMatch & { excerptId?: string },
		mutationCfiRange: string,
		supportsInteractiveUserChoice: boolean
	): Promise<'success' | 'failed' | 'cancelled' | 'fallback'> {
		const initialResult = await api.removeExcerpt?.({
			sourceType: 'epub',
			epubFilePath: filePath,
			cfiRange: mutationCfiRange,
			cardId: extractCardIdFromSourceRef(source.sourceRef),
			sourceFile: source.sourceFile,
			sourceRef: source.sourceRef,
			excerptId: source.excerptId,
			mode: 'auto',
		});

		if (!initialResult) {
			return 'fallback';
		}

		if (initialResult.needsUserChoice && supportsInteractiveUserChoice) {
			const choice = await promptHighlightDeleteChoice(initialResult);
			if (!choice) {
				return 'cancelled';
			}
			const retryResult = await api.removeExcerpt?.({
				sourceType: 'epub',
				epubFilePath: filePath,
				cfiRange: mutationCfiRange,
				cardId:
					extractCardIdFromSourceRef(source.sourceRef) ||
					initialResult.affectedCardIds?.[0],
				sourceFile: source.sourceFile,
				sourceRef: source.sourceRef,
				excerptId: source.excerptId,
				mode: choice,
			});
			return retryResult?.success ? 'success' : 'failed';
		}

		if (initialResult.needsUserChoice) {
			return 'fallback';
		}

		if (!initialResult.success || initialResult.action === 'noop') {
			return 'failed';
		}

		return 'success';
	}

	function extractCardIdFromSourceRef(sourceRef?: string): string | undefined {
		const normalized = String(sourceRef || '').trim();
		if (!normalized.startsWith('card:')) {
			return undefined;
		}
		const cardId = normalized.slice(5).trim();
		return cardId || undefined;
	}

	async function promptHighlightDeleteChoice(
		result: EpubWeaveRemoveExcerptResult
	): Promise<EpubWeaveExcerptRemovalMode | null> {
		const message = [
			t('epub.reader.highlightDeleteChoiceMessage'),
			result.additionalContentPreview
				? `${t('epub.reader.highlightDeleteChoicePreviewLabel')}\n${result.additionalContentPreview}`
				: '',
		].filter(Boolean).join('\n\n');

		const choice = await showObsidianChoice(app, message, {
			title: t('epub.reader.highlightDeleteChoiceTitle'),
			cancelText: t('epub.reader.highlightDeleteChoiceCancel'),
			choices: [
				{
					value: 'excerpt-only',
					text: t('epub.reader.highlightDeleteChoiceExcerptOnly'),
					description: t('epub.reader.highlightDeleteChoiceExcerptOnlyDescription'),
					className: 'mod-cta',
				},
				{
					value: 'delete-card',
					text: t('epub.reader.highlightDeleteChoiceDeleteCard'),
					description: t('epub.reader.highlightDeleteChoiceDeleteCardDescription'),
					className: 'mod-warning',
				},
			],
		});

		return choice ?? null;
	}

        function handleTemporarilyRevealConcealed(info: HighlightClickInfo) {
                if (info.presentation !== 'conceal') {
                        return;
                }

                readerService.temporarilyRevealConcealedText?.(info.cfiRange, 3000);
                highlightToolbarInfo = null;
                new Notice(t('epub.reader.transientRevealSuccess'));
        }

        async function handleHighlightChangeColor(info: HighlightClickInfo, newColor: string) {
                if (!hasExcerptNotesCapability()) {
			return;
		}
		if (!ensureAnnotationCompareWritable()) {
			return;
		}
		if (newColor === info.color) return;
		const source = await resolveHighlightSource(info);
		if (!source?.sourceFile) {
			if (book) {
				const annotationBookId = getCurrentAnnotationBookId();
				const previous = buildReaderHighlightFromInfo(info);
				const next: ReaderHighlight = {
					...previous,
					color: newColor,
				};
				await enqueueAnnotationMutation(async () => {
					const result = await annotationService.replacePortableHighlight(annotationBookId, previous, next);
					if (!result?.current) {
						new Notice(t('epub.reader.changeColorFailed'));
						return;
					}
					removeHighlightFromCurrentView(result.previous || previous);
					addHighlightToCurrentView(result.current);
					annotationUndoStack.pushUpdate(annotationBookId, result.previous || previous, result.current);
					queueOpenAnnotationNoteRefresh(annotationBookId);
					highlightToolbarInfo = null;
				});
				return;
			}
			new Notice(t('epub.reader.highlightSourcePending'));
			void reloadHighlights();
			return;
		}
		const changed = await backlinkService.changeHighlightColor(
			source.sourceFile,
			resolveHighlightMutationCfi(info, source),
			filePath,
			newColor,
			source.sourceRef,
			source.excerptId
		);

		if (changed) {
			highlightToolbarInfo = null;
			reloadHighlightsAfterExcerptMutation(source.sourceFile);
		} else {
			new Notice(t('epub.reader.changeColorFailed'));
		}
	}

	async function handleHighlightChangeSemantic(
		info: HighlightClickInfo,
		semantic: EpubAnnotationSemantic
	) {
		if (!hasExcerptNotesCapability() || !book) {
			return;
		}
		if (!ensureAnnotationCompareWritable()) {
			return;
		}
		const previous = buildReaderHighlightFromInfo(info);
		const nextStyle = toReaderHighlightStyle(semantic.style);
		const next: ReaderHighlight = {
			...previous,
			color: semantic.color || previous.color || 'yellow',
			...(nextStyle ? { style: nextStyle } : { style: undefined }),
			semanticId: semantic.id,
			semanticLabel: semantic.label,
			semanticGroup: semantic.group || 'study',
			semanticDescription: semantic.description,
			semanticSource: semantic.source || 'preset',
		};
		const annotationBookId = getCurrentAnnotationBookId();
		await enqueueAnnotationMutation(async () => {
			const result = await annotationService.replacePortableHighlight(annotationBookId, previous, next);
			if (!result?.current) {
				new Notice(t('epub.reader.changeSemanticFailed'));
				return;
			}
			removeHighlightFromCurrentView(result.previous || previous);
			addHighlightToCurrentView(result.current);
			annotationUndoStack.pushUpdate(annotationBookId, result.previous || previous, result.current);
			queueOpenAnnotationNoteRefresh(annotationBookId);
			highlightToolbarInfo = null;
			new Notice(t('epub.reader.semanticChanged'));
		});
	}

	async function handleHighlightChangeStyle(
		info: HighlightClickInfo,
		newStyle?: HighlightClickInfo['style']
	) {
		if (!hasExcerptNotesCapability()) {
			return;
		}
		if (!ensureAnnotationCompareWritable()) {
			return;
		}
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_STYLED_EXCERPTS, t('epub.reader.styledExcerptFeatureNotice'))) {
			return;
		}
		if (newStyle === info.style) return;
		const source = await resolveHighlightSource(info);
		if (!source?.sourceFile) {
			new Notice(t('epub.reader.highlightSourcePending'));
			void reloadHighlights();
			return;
		}
		const changed = await backlinkService.changeHighlightStyle(
			source.sourceFile,
			resolveHighlightMutationCfi(info, source),
			filePath,
			newStyle,
			source.sourceRef,
			source.excerptId
		);

		if (changed) {
			highlightToolbarInfo = null;
			reloadHighlightsAfterExcerptMutation(source.sourceFile);
		} else {
			new Notice(t('epub.reader.changeStyleFailed'));
		}
	}

	async function handleReferenceBadgeClick(infoOrCfi: HighlightClickInfo | string) {
		if (!hasExcerptNotesCapability()) {
			if (isPremiumFeaturePreviewEnabled()) {
				openPremiumFeaturePreview(PREMIUM_FEATURES.EPUB_EXCERPT_NOTES);
			}
			return;
		}
		try {
			if (!book || !filePath) {
				logger.warn('[EpubReaderApp] Reference badge click ignored because reader context is incomplete', {
					hasBook: Boolean(book),
					filePath,
					cfiRange: typeof infoOrCfi === 'string' ? infoOrCfi : infoOrCfi.cfiRange,
				});
				new Notice(t('epub.reader.readingContextUnavailable'));
				return;
			}

			const info = typeof infoOrCfi === 'string'
				? readerService.getHighlightClickInfo?.(infoOrCfi, 'reference-badge') || null
				: infoOrCfi;
			const cfiRange = typeof infoOrCfi === 'string' ? infoOrCfi : infoOrCfi.cfiRange;

			const stats = await referenceStatsService.getStatsForCfi(
				filePath,
				cfiRange,
				getBoundCanvasPath()
			);

			if (!stats) {
				logger.warn('[EpubReaderApp] No reference stats found for clicked badge', {
					filePath,
					cfiRange,
				});
				new Notice(t('epub.reader.referenceStatsMissing'));
				return;
			}
			if (!info) {
				logger.warn('[EpubReaderApp] Reference stats found but anchor info is missing', {
					filePath,
					cfiRange,
				});
				new Notice(t('epub.reader.referenceRectUnavailable'));
				return;
			}
			closeCommentEditor();
			highlightToolbarInfo = null;
			footnotePreviewInfo = null;
			referencePopoverInfo = info;
			referencePopoverStats = stats;
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to open reference detail popover:', error);
			new Notice(t('epub.reader.referencePopoverOpenFailed'));
		}
	}

	async function handleHighlightBacklink(info: HighlightClickInfo) {
		if (!ensureBookSourceLocationAccess(app, t('epub.reader.sourceLocationFeatureNotice'))) {
			return;
		}
		const source = await resolveHighlightSource(info);
		if (!source?.sourceFile) {
			new Notice(t('epub.reader.relatedNoteMissing'));
			return;
		}

		const sourceFile = source.sourceFile;
		const sourceRef = source.sourceRef;

		if (sourceRef?.startsWith('card:')) {
			await navigateExternalSource({ kind: 'card', resourcePath: sourceRef.slice(5) });
			highlightToolbarInfo = null;
			return;
		}

		if (sourceFile.endsWith('.wdeck')) {
			await navigateExternalSource({ kind: 'json', resourcePath: sourceFile });
			highlightToolbarInfo = null;
			return;
		}

		const encodedCfi = EpubLinkService.encodeCfiForWikilink(info.cfiRange);

		if (sourceFile.endsWith('.canvas')) {
			await navigateExternalSource({
				kind: 'canvas',
				resourcePath: sourceFile,
				locate: { candidates: [encodedCfi, info.cfiRange, sourceFile] },
				context: { nodeId: sourceRef, epubFilePath: filePath },
			});
			highlightToolbarInfo = null;
			return;
		}

		if (sourceFile.endsWith('.json')) {
			await navigateExternalSource({ kind: 'json', resourcePath: sourceFile });
			highlightToolbarInfo = null;
			return;
		}

		await navigateToMarkdownCallout(sourceFile, encodedCfi, info.cfiRange, info.text, info.createdTime);
		highlightToolbarInfo = null;
	}

	function handleHighlightEditComment(info: HighlightClickInfo) {
		if (!ensureAnnotationCompareWritable()) {
			return;
		}
		openCommentEditor(info);
	}

	async function saveHighlightComment() {
		if (!hasExcerptNotesCapability()) {
			return;
		}
		if (!ensureAnnotationCompareWritable()) {
			return;
		}
		const info = commentEditorInfo;
		if (!info) {
			return;
		}
		const source = await resolveHighlightSource(info);
		if (!source?.sourceFile) {
			if (book) {
				const annotationBookId = getCurrentAnnotationBookId();
				const previous = buildReaderHighlightFromInfo(info);
				const next: ReaderHighlight = {
					...previous,
					commentText: commentEditorDraft,
					hasCommentDivider: commentEditorDraft.trim().length > 0,
				};
				commentEditorSaving = true;
				await enqueueAnnotationMutation(async () => {
					try {
						const result = await annotationService.replacePortableHighlight(annotationBookId, previous, next);
						if (!result?.current) {
							new Notice(t('epub.reader.commentSaveFailed'));
							return;
						}
						removeHighlightFromCurrentView(result.previous || previous);
						addHighlightToCurrentView(result.current);
						annotationUndoStack.pushUpdate(annotationBookId, result.previous || previous, result.current);
						queueOpenAnnotationNoteRefresh(annotationBookId);
						new Notice(t('epub.reader.commentSaved'));
						closeCommentEditor();
					} finally {
						commentEditorSaving = false;
					}
				});
				return;
			}
			new Notice(t('epub.reader.highlightSourcePending'));
			void reloadHighlights();
			return;
		}
		commentEditorSaving = true;
		const updated = await backlinkService.updateHighlightComment(
			source.sourceFile,
			resolveHighlightMutationCfi(info, source),
			filePath,
			commentEditorDraft,
			source.sourceRef,
			source.excerptId,
			true
		);
		commentEditorSaving = false;
		if (!updated) {
			new Notice(t('epub.reader.commentSaveFailed'));
			return;
		}
		const optimisticHighlight: ReaderHighlight = {
			cfiRange: resolveHighlightMutationCfi(info, source),
			color: info.color,
			style: info.style,
			semanticId: info.semanticId,
			semanticLabel: info.semanticLabel,
			semanticGroup: info.semanticGroup,
			semanticDescription: info.semanticDescription,
			semanticSource: info.semanticSource,
			text: info.text,
			commentText: commentEditorDraft,
			hasCommentDivider: true,
			sourceFile: source.sourceFile,
			sourceRef: source.sourceRef,
			excerptId: source.excerptId,
			sourceLocators: info.sourceLocators,
			createdTime: info.createdTime,
			presentation: info.presentation,
		};
		readerService.addHighlight(optimisticHighlight);
		markCollectedHighlightsStale();
		pendingLoadedHighlights = mergeReaderHighlightsByIdentity(
			pendingLoadedHighlights,
			[optimisticHighlight]
		);
		new Notice(t('epub.reader.commentSaved'));
		closeCommentEditor();
		reloadHighlightsAfterExcerptMutation(source.sourceFile);
	}

	async function navigateExternalSource(intent: NavigationIntent): Promise<boolean> {
		if (!ensureBookSourceLocationAccess(app, t('epub.reader.sourceLocationFeatureNotice'))) {
			return false;
		}
		const result = await getNavigationHub(app).navigate({
			...intent,
			policy: { reuseLeaf: true, focus: true, ...intent.policy },
		});
		if (!result.success) {
			if (intent.kind === 'card') {
				new Notice(t('epub.reader.cardLocateUnavailable'));
			} else if (intent.kind === 'json') {
				new Notice(t('epub.reader.relatedNoteMissing'));
			} else {
				new Notice(t('epub.reader.relatedNoteMissing'));
			}
			return false;
		}
		if (intent.kind === 'card') {
			new Notice(t('epub.reader.cardLocated'));
		} else if (intent.kind === 'json') {
			new Notice(t('epub.reader.openedSourceFileSearchHighlight'));
		}
		return true;
	}

	async function navigateToReferenceSource(source: ReferenceSourceInfo) {
		if (source.sourceRef?.startsWith('card:')) {
			await navigateExternalSource({ kind: 'card', resourcePath: source.sourceRef.slice(5) });
			return;
		}

		if (source.type === 'canvas') {
			await navigateExternalSource({
				kind: 'canvas',
				resourcePath: source.file,
				locate: { candidates: source.locateCandidates },
				context: { nodeId: source.nodeId, epubFilePath: filePath },
			});
			return;
		}

		if (source.file.endsWith('.json')) {
			await navigateExternalSource({ kind: 'json', resourcePath: source.file });
			return;
		}

		await navigateExternalSource({
			kind: 'markdown',
			resourcePath: source.file,
			locate: { candidates: source.locateCandidates },
			context: { epubFilePath: filePath },
		});
	}

	async function navigateToMarkdownCallout(sourceFile: string, encodedCfi: string, rawCfi: string, excerptText?: string, createdTime?: number) {
		const locateCandidates = buildEpubMarkdownLocateCandidates({
			epubFilePath: filePath,
			encodedCfi,
			rawCfi,
			excerptText,
			createdTime,
		});
		await navigateExternalSource({
			kind: 'markdown',
			resourcePath: sourceFile,
			locate: { candidates: locateCandidates },
			context: { epubFilePath: filePath },
		});
	}

	async function openCardBacklink(cardUuid: string) {
		try {
			await navigateExternalSource({ kind: 'card', resourcePath: cardUuid });
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to open card backlink:', error);
			new Notice(t('epub.reader.cardLocateFailed'));
		}
	}

	async function handleHighlightCopyText(info: HighlightClickInfo) {
		const plainText = info.text.replace(/^>\s?/gm, '').trim();
		await copyTextToClipboard(plainText);
		highlightToolbarInfo = null;
	}

	async function reloadHighlights(options?: HighlightReloadOptions) {
		if (!book || componentDisposed) return;
		if (!hasExcerptNotesCapability()) {
			trackedHighlightSourceFiles = new Set<string>();
			pendingCollectedHighlights = [];
			pendingLoadedHighlights = [];
			highlightReloading = false;
			highlightToolbarInfo = null;
			closeCommentEditor();
			if (readerReady) {
				await readerService.applyHighlights([]);
			}
			annotationRevision += 1;
			epubActiveDocumentStore.setSharedState({ annotationRevision });
			return;
		}
		const incremental = options?.incremental === true;
		const invalidateCache = options?.invalidateCache === true;
		const forceReaderReplace = options?.forceReaderReplace === true;
		const reloadToken = ++highlightReloadToken;
		highlightReloading = true;
		const previousHighlights = pendingLoadedHighlights || [];
		const annotationBookId = getCurrentAnnotationBookId();
		try {
			if (invalidateCache) {
				annotationService.invalidateCollectedHighlightsCache(annotationBookId, filePath);
				if (!incremental) {
					highlightViewSnapshotService.invalidate(annotationBookId, filePath);
					referenceStatsService.clearCache(filePath);
				}
				await backlinkService.invalidateHighlightsCacheForEpub(filePath, getBoundCanvasPath());
			} else if (incremental) {
				annotationService.invalidateCollectedHighlightsCache(annotationBookId, filePath);
			}
			const additionalSourcePaths = Array.from(trackedHighlightSourceFiles);
			const collectedHighlights = await annotationService.collectAllHighlights(
				annotationBookId,
				filePath,
				backlinkService,
				buildCollectHighlightsOptions(
					additionalSourcePaths.length > 0
						? { additionalSourcePaths, diskIncremental: incremental }
						: {}
				)
			);
			if (componentDisposed || reloadToken !== highlightReloadToken) {
				return;
			}

			pendingCollectedHighlights = collectedHighlights;
			const highlightsWithStats = applyReferenceStatsToHighlights(
				applySemanticPresentationToHighlights(collectedHighlights)
			);

			trackedHighlightSourceFiles = collectTrackedHighlightSourceFiles(highlightsWithStats);
			pendingLoadedHighlights = highlightsWithStats;
			getExcerptPipeline().syncCollectedHighlights(highlightsWithStats);

			if (readerReady) {
				const previousKeys = new Set(
					previousHighlights
						.map((highlight) => getReaderHighlightIdentityKey(highlight))
						.filter((key) => key.length > 0)
				);
				const nextKeys = new Set(
					highlightsWithStats
						.map((highlight) => getReaderHighlightIdentityKey(highlight))
						.filter((key) => key.length > 0)
				);
				const hasRemovedHighlights = [...previousKeys].some((key) => !nextKeys.has(key));
				const shouldReplaceAllHighlights =
					forceReaderReplace ||
					!incremental ||
					hasRemovedHighlights ||
					highlightsWithStats.length < previousHighlights.length ||
					!highlightsWithStats.every((highlight) => {
						const key = getReaderHighlightIdentityKey(highlight);
						return (
							!key ||
							previousHighlights.some(
								(previous) => getReaderHighlightIdentityKey(previous) === key
							)
						);
					});

				if (shouldReplaceAllHighlights) {
					await readerService.applyHighlights(highlightsWithStats);
				} else {
					syncReaderHighlightsFromCollection(highlightsWithStats, previousHighlights);
				}
			}

			if (!incremental) {
				const nextRevision = annotationRevision + 1;
				highlightViewSnapshotService.publishFromHighlights({
					bookId: annotationBookId,
					filePath,
					showStrikethroughHighlights: excerptSettings.showStrikethroughInSidebar,
					revision: nextRevision,
					highlights: highlightsWithStats,
					readerService,
				});
				annotationRevision = nextRevision;
				epubActiveDocumentStore.setSharedState({ annotationRevision });
			} else {
				publishSidebarHighlights(highlightsWithStats);
			}

			if (book) {
				void bookmarkService.syncAnalytics(book, highlightsWithStats).catch((error) => {
					logger.warn('[EpubReaderApp] Failed to sync bookmark analytics:', error);
				});
			}
		} catch (_e) {
			logger.warn('[EpubReaderApp] Failed to reload highlights:', _e);
		} finally {
			if (reloadToken === highlightReloadToken) {
				highlightReloading = false;
			}
		}
	}

	async function migrateLegacyStoredLocations(options?: {
		requireReaderReady?: boolean;
		targetBook?: EpubBook | null;
	}) {
		const targetBook = options?.targetBook ?? book;
		const requireReaderReady = options?.requireReaderReady ?? true;
		if (!targetBook || (requireReaderReady && !readerReady)) {
			return;
		}
		if (migratedLocationBookIds.has(targetBook.id) || migratingLocationBookId === targetBook.id) {
			return;
		}

		migratingLocationBookId = targetBook.id;
		try {
			const summary = await locationMigrationService.migrateBookData(targetBook.id, filePath);
			migratedLocationBookIds.add(targetBook.id);
			migratingLocationBookId = null;

			if (
				summary.progressMigrated
				|| summary.resumePointsMigrated > 0
			) {
				if (readerReady) {
					annotationRevision += 1;
					epubActiveDocumentStore.setSharedState({ annotationRevision });
				}
			}
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to migrate legacy EPUB locations:', error);
		} finally {
			if (migratingLocationBookId === targetBook.id) {
				migratingLocationBookId = null;
			}
		}
	}

	function trackHighlightSourceChanges() {
		if (vaultEventRefs.length > 0) return;

		const shouldReloadForPath = (path: string): boolean => {
			const normalizedPath = normalizeTrackedVaultPath(path);
			if (!normalizedPath) return false;
			if (trackedHighlightSourceFiles.has(normalizedPath)) return true;
			const canvasPath = normalizeTrackedVaultPath(canvasService.getCanvasPath());
			if (canvasPath && normalizedPath === canvasPath) return true;
			return false;
		};

		const requestReload = (path: string, delayMs = 180) => {
			const normalizedPath = normalizeTrackedVaultPath(path);
			if (!normalizedPath || !book || componentDisposed) return;
			if (isEphemeralEditorHighlightSourcePath(app, normalizedPath)) {
				return;
			}
			if (shouldReloadForPath(normalizedPath)) {
				rememberHighlightSourcePath(normalizedPath);
				void syncHighlightsAfterSourcePathChange(normalizedPath);
				queueHighlightReload(delayMs, { incremental: true });
				return;
			}
			void (async () => {
				try {
					const mayAffectHighlights = await backlinkService.mayFileAffectHighlights(
						normalizedPath,
						filePath,
						canvasService.getCanvasPath()
					);
					if (!mayAffectHighlights || componentDisposed) {
						return;
					}
					rememberHighlightSourcePath(normalizedPath);
					void syncHighlightsAfterSourcePathChange(normalizedPath);
					queueHighlightReload(delayMs, { incremental: true });
				} catch (error) {
					logger.debug('[EpubReaderApp] Failed to inspect changed highlight source file:', {
						path: normalizedPath,
						error,
					});
				}
			})();
		};

		vaultEventRefs = [
			app.vault.on('create', (file: TAbstractFile) => {
				requestReload(file.path, 160);
			}),
			app.vault.on('modify', (file: TAbstractFile) => {
				requestReload(file.path, 180);
			}),
			app.vault.on('delete', (file: TAbstractFile) => {
				requestReload(file.path, 120);
			}),
			app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				if (shouldReloadForPath(oldPath) || shouldReloadForPath(file.path)) {
					rememberHighlightSourcePath(oldPath);
					rememberHighlightSourcePath(file.path);
					queueHighlightReload(120, { incremental: true });
					return;
				}
				requestReload(file.path, 160);
			}),
		];
	}

	onMount(() => {
		document.addEventListener('fullscreenchange', handleFullscreenChange);
		const cleanupExternalHighlightSyncReload = attachExternalHighlightSyncReload({
			canReload: () => !componentDisposed && !!book && hasExcerptNotesCapability(),
			onReload: (delayMs) => {
				queueHighlightReload(delayMs, { incremental: true });
			},
		});
		const cleanupCardHighlightSync = attachEpubCardHighlightSyncBridge({
			app,
			getEpubFilePath: () => filePath,
			getBookSourceId: () => book?.sourceId,
			isActive: () => !componentDisposed && !!book && hasExcerptNotesCapability(),
			backlinkService,
			onCardSaved: handleSavedCardHighlightSync,
		});
		const premiumGuard = PremiumFeatureGuard.getInstance();
		isPremiumLicenseActive = get(premiumGuard.isPremiumActive);
		premiumFeaturePreviewEnabled = get(premiumGuard.premiumFeaturesPreviewEnabled);
		const unsubscribePremiumActive = premiumGuard.isPremiumActive.subscribe((value) => {
			isPremiumLicenseActive = value;
			notifyPremiumUiStateChanged();
		});
		const unsubscribePremiumPreview = premiumGuard.premiumFeaturesPreviewEnabled.subscribe((value) => {
			premiumFeaturePreviewEnabled = value;
			if (!value) {
				closePremiumFeaturePreview();
			}
			notifyPremiumUiStateChanged();
		});
		const handlePremiumUiStateChanged = () => {
			notifyPremiumUiStateChanged();
		};
		window.addEventListener(EPUB_RUNTIME.events.premiumUiStateChanged, handlePremiumUiStateChanged);
		window.addEventListener(
			EPUB_RUNTIME.events.premiumFeaturePreviewRequest,
			handlePremiumFeaturePreviewRequest
		);
		const handleBookDisplayTitleChanged = (event: Event) => {
			const detail = (event as CustomEvent<{ filePath?: string; title?: string }>).detail;
			const changedPath = normalizePath(String(detail?.filePath || "").trim());
			const activePath = normalizePath(String(filePath || "").trim());
			const nextTitle = String(detail?.title || "").trim();
			if (!changedPath || changedPath !== activePath || !nextTitle || !book) {
				return;
			}
			book = {
				...book,
				metadata: {
					...book.metadata,
					title: nextTitle,
				},
			};
			onTitleChange?.(nextTitle);
			if (isActiveEpubReaderInstance()) {
				epubActiveDocumentStore.setSharedState({ book });
			}
		};
		window.addEventListener(
			EPUB_RUNTIME.events.bookDisplayTitleChanged,
			handleBookDisplayTitleChanged
		);
		const handleReaderUiModeChanged = (event: Event) => {
			readerUiMode = readEpubReaderUiModeChange(event) || getHostReaderUiMode();
			if (readerUiMode === 'minimal') {
				highlightToolbarInfo = null;
				closeAnnotationDisambiguation();
				commentEditorInfo = null;
				referencePopoverInfo = null;
				clearParagraphModeSelection();
				clearReaderSelection();
			}
		};
		window.addEventListener(EPUB_READER_UI_MODE_CHANGED_EVENT, handleReaderUiModeChanged);
		readerUiMode = getHostReaderUiMode();
		const handleSemanticProfileChanged = (event: Event) => {
			const detail = (event as CustomEvent<{ scope?: unknown; bookId?: unknown }>).detail || {};
			const eventScope = String(detail.scope || '').trim();
			const eventBookId = String(detail.bookId || '').trim();
			if (eventScope === 'book' && book?.id && eventBookId && eventBookId !== book.id) {
				return;
			}
			if (readerReady) {
				highlightToolbarInfo = null;
				closeAnnotationDisambiguation();
				commentEditorInfo = null;
			}
			void refreshSemanticSettings({ reloadHighlights: true, semanticOnly: true });
		};
		window.addEventListener(EPUB_SEMANTIC_PROFILE_CHANGED_EVENT, handleSemanticProfileChanged);
		const handleAnnotationVersionChanged = (event: Event) => {
			const detail = (event as CustomEvent<{ bookId?: unknown; filePath?: unknown }>).detail || {};
			const eventBookId = String(detail.bookId || '').trim();
			const eventFilePath = normalizePath(String(detail.filePath || '').trim());
			const currentBookId = getCurrentAnnotationBookId();
			const currentFilePath = normalizePath(String(filePath || '').trim());
			if (
				(eventBookId && currentBookId && eventBookId !== currentBookId) &&
				(!eventFilePath || !currentFilePath || eventFilePath !== currentFilePath)
			) {
				return;
			}
			void refreshAfterAnnotationVersionChanged();
		};
		window.addEventListener(EPUB_ANNOTATION_VERSION_CHANGED_EVENT, handleAnnotationVersionChanged);
		const handleAnnotationCompareContextChanged = (event: Event) => {
			const detail = normalizeEpubAnnotationCompareContextChangeDetail((event as CustomEvent).detail);
			if (!detail || detail.sourceId !== annotationCompareContextSourceId) {
				return;
			}
			const eventFilePath = normalizePath(String(detail.filePath || '').trim());
			const currentFilePath = normalizePath(String(filePath || '').trim());
			if (
				eventFilePath &&
				currentFilePath &&
				eventFilePath !== currentFilePath &&
				!epubVaultPathsReferToSameBook(eventFilePath, currentFilePath)
			) {
				return;
			}
			applyAnnotationCompareContextChange(detail.annotationCompare);
		};
		window.addEventListener(EPUB_ANNOTATION_COMPARE_CONTEXT_EVENT, handleAnnotationCompareContextChanged);
		const handleDualWindowAnnotation = (event: Event) => {
			const detail = (event as CustomEvent<EpubDualWindowAnnotationDetail>).detail || null;
			if (!detail || detail.mode !== 'book-annotation-note') {
				return;
			}
			const eventBookId = String(detail.bookId || '').trim();
			const eventFilePath = normalizePath(String(detail.filePath || '').trim());
			const currentBookId = getCurrentAnnotationBookId();
			const currentFilePath = normalizePath(String(filePath || '').trim());
			const sameBook = Boolean(eventBookId && currentBookId && eventBookId === currentBookId);
			const sameFile = Boolean(
				eventFilePath &&
					currentFilePath &&
					(eventFilePath === currentFilePath ||
						epubVaultPathsReferToSameBook(eventFilePath, currentFilePath))
			);
			if (!sameBook && !sameFile) {
				return;
			}
			const cfiRange = String(detail.cfiRange || '').trim();
			if (!cfiRange || !readerReady) {
				return;
			}
			const annotationText = String(detail.text || '').trim();
			const chapterIndex =
				typeof detail.chapterIndex === 'number' && Number.isFinite(detail.chapterIndex)
					? detail.chapterIndex
					: undefined;
			if (detail.phase === 'leave') {
				readerService.clearHighlightFocus();
				return;
			}
			readerService.previewHighlightFocus(
				cfiRange,
				'cyan',
				detail.phase === 'click' ? 2400 : 10000,
				{
					textHint: annotationText,
					...(chapterIndex !== undefined ? { chapterIndex } : {}),
				}
			);
			if (detail.phase === 'click') {
				navigateToCfi(cfiRange, annotationText);
			}
		};
		window.addEventListener(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, handleDualWindowAnnotation);
		const canvasDirectionRef = app.workspace.on(
			WEAVE_EPUB_CANVAS_LAYOUT_DIRECTION_EVENT,
			(payload: WeaveEpubCanvasLayoutDirectionPayload) => {
				const activePath = normalizePath(String(canvasService.getCanvasPath() || '').trim());
				const eventPath = normalizePath(String(payload?.canvasPath || '').trim());
				if (!activePath || activePath !== eventPath || !payload?.direction) {
					return;
				}
				canvasService.applyLayoutDirection(payload.direction);
				onCanvasLayoutDirectionChange?.(payload.direction);
			}
		);
		componentDisposed = false;
		setupScrolledNavMetricsObserver();
		window.addEventListener('resize', scheduleScrolledNavLayoutSync);
		window.addEventListener('keydown', handleAnnotationUndoKeydown, true);
		const loadReaderPreferences = async (): Promise<void> => {
			try {
				const [savedExcerptSettings, savedReaderSettings, savedTocChapterMarkSettings] = await Promise.all([
					storageService.loadExcerptSettings(),
					storageService.loadReaderSettings(),
					storageService.loadTocChapterMarkSettings(),
				]);
				excerptSettings = savedExcerptSettings;
				excerptSettingsLoaded = true;
				tocChapterMarkSettings = savedTocChapterMarkSettings;
				epubActiveDocumentStore.setSharedState({
					excerptSettings: savedExcerptSettings,
					tocChapterMarkSettings: savedTocChapterMarkSettings,
				});
				const normalizedSettings = normalizeReaderSettings(savedReaderSettings);
				settings = normalizedSettings;
				readerService.setFootnoteClickAction?.(normalizedSettings.footnoteClickAction);
				onReaderSettingsLoaded?.(normalizedSettings);
				if (
					normalizedSettings.widthMode !== savedReaderSettings.widthMode
					|| normalizedSettings.layoutMode !== savedReaderSettings.layoutMode
					|| normalizedSettings.flowMode !== savedReaderSettings.flowMode
					|| normalizedSettings.footnoteClickAction !== savedReaderSettings.footnoteClickAction
					|| normalizedSettings.paragraphModeEnabled !== savedReaderSettings.paragraphModeEnabled
				) {
					await storageService.saveReaderSettings(normalizedSettings);
				}
			} catch (error) {
				logger.warn('[EpubReaderApp] Failed to load reader settings:', error);
			}
		};
		excerptSettingsReady = loadReaderPreferences();
		const readerPreferencesReady = excerptSettingsReady;

		void (async () => {
			if (!filePath) {
				await readerPreferencesReady;
				book = null;
				loading = false;
				errorMsg = '';
				readerReady = false;
				onReadingReferencePointChange?.(null);
				onChapterTitleChange?.('');
				scheduleScrolledNavLayoutSync();
				return;
			}

			// Apply persisted flow/layout (and related reader prefs) before first render.
			await readerPreferencesReady;
			await loadBook();
		})();

		// Check global pending IR navigation (set by sidebar before this component mounts)
		const pending =
			(window as any)[EPUB_PENDING_NAVIGATION_KEY] ??
			(LEGACY_EPUB_PENDING_NAVIGATION_KEY
				? (window as any)[LEGACY_EPUB_PENDING_NAVIGATION_KEY]
				: null);
		if (pending && pending.filePath === filePath) {
			const nav = epubNavigation.buildLocateFromEventDetail(pending);
			if (nav) {
				requestSourceBookLocate(nav);
			}
		}

		flushPendingLocateFromProps();

		setupHighlightClickHandler();
		setupReferenceBadgeClickHandler();
		setupFootnotePreviewHandler();
		trackHighlightSourceChanges();
		setupScrolledChapterEndHandler();
		readerService.setBookEndAdvanceHandler?.(handleBookEndAdvanceAttempt);
		const activeLeafChangeRef = app.workspace.on(
			'active-leaf-change',
			handleWorkspaceActiveLeafChange
		);
		syncAsActiveEpubDocumentIfActive();

		if (rootEl) {
			rootEl.addEventListener('pointerdown', syncAsActiveEpubDocument);
			rootEl.addEventListener('focusin', syncAsActiveEpubDocument);
		}

		window.addEventListener(EXCERPT_SETTINGS_CHANGED_EVENT, handleGlobalExcerptSettingsChanged);
		window.addEventListener(EPUB_NAVIGATE_EVENT, handleEpubNavigateEvent);
		if (LEGACY_EPUB_NAVIGATE_EVENT) {
			window.addEventListener(LEGACY_EPUB_NAVIGATE_EVENT, handleEpubNavigateEvent);
		}

		onActionsReady?.({
			setAutoInsert: (enabled: boolean) => { autoInsert = enabled; },
			setScreenshotMode: (active: boolean) => { screenshotMode = active; },
			setLayoutMode: handleLayoutModeChange,
			setFlowMode: handleFlowModeChange,
			toggleParagraphMode,
			openTypographyPanel,
			getReaderSettings: () => settings,
			updateReaderSettings,
			setScreenshotSaveMode: (saveAsImage: boolean) => { screenshotSaveAsImage = saveAsImage; },
			navigateToCfi,
			toggleTutorial,
			addBookmark,
			canUseReadingProgress: hasReadingProgressCapability,
			canUseReadingReference: hasReadingReferenceCapability,
			canUseParagraphMode: hasParagraphModeCapability,
			canUseExcerptNotes: hasExcerptNotesCapability,
			canUseStyledExcerpts: hasStyledExcerptCapability,
			canUseCanvasExcerpts: hasCanvasExcerptCapability,
			canUseFootnotePreview: hasFootnotePreviewCapability,
			isPremiumFeaturePreviewEnabled,
			showPremiumFeaturePreview: openPremiumFeaturePreview,
			saveReadingReferencePoint: hasReadingReferenceCapability() ? saveReadingReferencePoint : undefined,
			openReadingPositionMenu: openReadingReferencePointMenu,
			getReadingPositionAutoSaveEnabled: hasReadingProgressCapability()
				? () => getContinuousReadingPositionAutoSaveConfig().enabled
				: undefined,
			setReadingPositionAutoSaveEnabled: hasReadingProgressCapability()
				? setContinuousReadingPositionAutoSaveEnabled
				: undefined,
			bindCanvasPath: (canvasPath: string) => { bindCanvas(canvasPath); },
			unbindCanvas: () => { unbindCanvas(); },
			getCanvasService: () => canvasService,
			exportCurrentChapterToMarkdown: hasChapterExportCapability() ? exportCurrentChapterToMarkdown : undefined,
			exportCurrentChapterMarkedToMarkdown: hasChapterExportCapability()
				? exportCurrentChapterMarkedToMarkdown
				: undefined,
			exportCurrentChapterHighlightsToMarkdown: hasExcerptNotesCapability()
				? exportCurrentChapterHighlightsToMarkdown
				: undefined,
			exportBookHighlightsToMarkdown: hasExcerptNotesCapability() ? exportBookHighlightsToMarkdown : undefined,
			openAnnotationNote,
			openAnnotationDualWindow,
			openAnnotationCompareDualWindow,
			openAnnotationVersions,
			getExcerptSettings: () => excerptSettings,
			updateExcerptSettings: applyAndPersistExcerptSettings,
			prevPage: handlePrevPage,
			nextPage: handleNextPage,
		});
		return () => {
			app.workspace.offref(activeLeafChangeRef);
			app.workspace.offref(canvasDirectionRef);
			document.removeEventListener('fullscreenchange', handleFullscreenChange);
			cleanupExternalHighlightSyncReload();
			cleanupCardHighlightSync();
			setParagraphModeImmersiveClass(false);
			unsubscribePremiumActive();
			unsubscribePremiumPreview();
			window.removeEventListener(EPUB_RUNTIME.events.premiumUiStateChanged, handlePremiumUiStateChanged);
			window.removeEventListener(
				EPUB_RUNTIME.events.premiumFeaturePreviewRequest,
				handlePremiumFeaturePreviewRequest
			);
			window.removeEventListener(
				EPUB_RUNTIME.events.bookDisplayTitleChanged,
				handleBookDisplayTitleChanged
			);
			window.removeEventListener(EPUB_READER_UI_MODE_CHANGED_EVENT, handleReaderUiModeChanged);
			window.removeEventListener(EPUB_SEMANTIC_PROFILE_CHANGED_EVENT, handleSemanticProfileChanged);
			window.removeEventListener(EPUB_ANNOTATION_VERSION_CHANGED_EVENT, handleAnnotationVersionChanged);
			window.removeEventListener(EPUB_ANNOTATION_COMPARE_CONTEXT_EVENT, handleAnnotationCompareContextChanged);
			window.removeEventListener(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, handleDualWindowAnnotation);
			componentDisposed = true;
			closeAnnotationDisambiguation();
			getBookSessionManager(app).releaseIfNoOpenLeaves(app, filePath);
			clearParagraphModeSelection();
			window.removeEventListener('resize', scheduleScrolledNavLayoutSync);
			window.removeEventListener('keydown', handleAnnotationUndoKeydown, true);
			annotationUndoStack.clear();
			if (scrolledNavSyncFrame) {
				cancelAnimationFrame(scrolledNavSyncFrame);
				scrolledNavSyncFrame = 0;
			}
			if (scrolledNavResizeObserver) {
				scrolledNavResizeObserver.disconnect();
				scrolledNavResizeObserver = null;
			}
			clearScrolledNavMetrics();
			activeBookLoadToken += 1;
			if (deferredHighlightReloadTimer) {
				clearTimeout(deferredHighlightReloadTimer);
				deferredHighlightReloadTimer = null;
			}
			deferredHighlightReloadOptions = {};
			flushReaderStoreSync();
			if (rootEl) {
				rootEl.removeEventListener('pointerdown', syncAsActiveEpubDocument);
				rootEl.removeEventListener('focusin', syncAsActiveEpubDocument);
			}
			for (const ref of vaultEventRefs) {
				app.vault.offref(ref);
			}
			vaultEventRefs = [];
			referenceBadgeClickCleanup?.();
			referenceBadgeClickCleanup = null;
			window.removeEventListener(EXCERPT_SETTINGS_CHANGED_EVENT, handleGlobalExcerptSettingsChanged);
			window.removeEventListener(EPUB_NAVIGATE_EVENT, handleEpubNavigateEvent);
			if (LEGACY_EPUB_NAVIGATE_EVENT) {
				window.removeEventListener(LEGACY_EPUB_NAVIGATE_EVENT, handleEpubNavigateEvent);
			}
			sourceLocateOverlay.clear();
			scrolledChapterEndCleanup?.();
			scrolledChapterEndCleanup = null;
			readerService.setBookEndAdvanceHandler?.(null);
			void persistCurrentReadingProgress(book).then((saved) => {
				if (saved) {
					bookshelfProgressChangedNotifier.flush();
				}
			}).finally(() => {
				bookshelfProgressChangedNotifier.dispose();
			});
			readerService.destroy();
			epubActiveDocumentStore.clearActiveDocument(filePath);
		};
	});

	onMount(() => {
		const unsubscribeTheme = UnifiedThemeManager.getInstance().addListener((result) => {
			hostTheme = result.isDark ? 'dark' : 'light';
		});
		window.addEventListener('mousedown', handleExportNotesPointerDownOutside);
		window.addEventListener('mousedown', handleTypographyPointerDownOutside);
		return () => {
			unsubscribeTheme();
			window.removeEventListener('mousedown', handleExportNotesPointerDownOutside);
			window.removeEventListener('mousedown', handleTypographyPointerDownOutside);
		};
	});

	$effect(() => {
		const mode = readerUiMode;
		const service = readerService;
		if (mode !== 'minimal') {
			return;
		}

		untrack(() => {
			highlightToolbarInfo = null;
			commentEditorInfo = null;
			referencePopoverInfo = null;
			paragraphModeSelection = null;
			clearReaderSelection();
		});

		const offSelection = service.onSelectionChange(({ frame }) => {
			clearReaderSelection(frame);
		});
		return () => {
			offSelection();
		};
	});

	$effect(() => {
		const _flowMode = settings.flowMode;
		const _showScrolledSideNav = settings.showScrolledSideNav;
		const _widthMode = settings.widthMode;
		const _layoutMode = settings.layoutMode;
		const _viewport = viewportEl;
		const _readingReferencePoint = readingReferencePoint?.cfi;
		void _flowMode;
		void _showScrolledSideNav;
		void _widthMode;
		void _layoutMode;
		void _viewport;
		void _readingReferencePoint;
		untrack(() => {
			setupScrolledNavMetricsObserver();
			scheduleScrolledNavLayoutSync();
		});
	});

	$effect(() => {
		const paragraphModeEnabled = settings.paragraphModeEnabled;
		const ready = readerReady;
		const chapterIndex = currentChapterIndex;
		const currentPage = paginationInfo.currentPage;
		const version = readerVersion;
		const revision = annotationRevision;
		void chapterIndex;
		void currentPage;
		void version;
		void revision;
		if (!paragraphModeEnabled || !ready) {
			untrack(() => {
				paragraphModeLocation = null;
				paragraphModeAnchorParagraphId = '';
				paragraphModeSelection = null;
			});
			return;
		}

		if (untrack(() => paragraphModeSuppressReactiveRefresh) > 0) {
			return;
		}
		if (Date.now() - untrack(() => paragraphModeLastNavigationAt) < PARAGRAPH_MODE_REACTIVE_REFRESH_COOLDOWN_MS) {
			return;
		}

		const preferredAnchorParagraphId = untrack(() => paragraphModeAnchorParagraphId || undefined);
		untrack(() => {
			void refreshParagraphModeLocation(undefined, preferredAnchorParagraphId);
		});
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="epub-reader-root"
	data-theme={settings.theme}
	data-host-theme={hostTheme}
	data-flow={settings.flowMode}
	data-layout={settings.layoutMode}
	data-width={settings.widthMode}
	data-reader-ui-mode={readerUiMode}
	data-paragraph-mode={settings.paragraphModeEnabled ? 'active' : 'inactive'}
	data-scrolled-side-nav={isDesktopScrolledSideNavVisible() ? 'visible' : 'hidden'}
	style={getReaderRootStyle()}
	bind:this={rootEl}
>
	{#if loading}
		<div class="epub-loading">
			<div class="epub-loading__panel">
				<EpubLoadingState
					message={bookLoadSlowWarning
						? buildBookLoadSlowWarningMessage(filePath)
						: t('epub.reader.loading')}
				/>
				{#if bookLoadSlowWarning}
					<button
						type="button"
						class="epub-loading__cancel-btn"
						onclick={() => {
							void cancelSlowBookLoad();
						}}
					>
						{t('epub.reader.cancelLoading')}
					</button>
				{/if}
			</div>
		</div>
	{:else if errorMsg}
		<div class="epub-error">
			<span>{errorMsg}</span>
		</div>
	{:else if !filePath}
		<BookshelfView
			{app}
			{onSwitchBook}
			onClose={() => {}}
			onBack={() => {
				void onBackFromBookshelf?.();
			}}
			onSettingsClick={showSettingsMenu}
		/>
	{:else}
		<div
			class="epub-reader-viewport"
			bind:this={viewportEl}
		>
			{#if annotationCompare}
				<div
					class="epub-annotation-compare-bar"
					data-role={annotationCompare.paneRole}
				>
					<div class="epub-annotation-compare-bar__info">
						<span class="epub-annotation-compare-bar__slot">
							{annotationCompare.paneRole === 'editable'
								? annotationCompareLabels.editableSlot
								: annotationCompareLabels.readonlySlot}
						</span>
						<span class="epub-annotation-compare-bar__title">
							{getAnnotationCompareVersionLabel()}
						</span>
						<span class="epub-annotation-compare-bar__mode">
							{annotationCompare.paneRole === 'editable'
								? annotationCompareLabels.editableMode
								: annotationCompareLabels.readonlyMode}
						</span>
					</div>
					{#if annotationCompareReadOnly}
						<button
							type="button"
							class="epub-annotation-compare-bar__promote"
							title={annotationCompareLabels.promoteReadonly}
							aria-label={annotationCompareLabels.promoteReadonly}
							onclick={() => void switchAnnotationComparePaneToEditable()}
						>
							<span use:icon={'pencil'}></span>
							<span>{annotationCompareLabels.promoteReadonly}</span>
						</button>
					{:else}
						<div class="epub-annotation-compare-bar__actions">
							<button
								type="button"
								class:mod-active={annotationCompare.syncPosition !== false}
								title={annotationCompareLabels.syncPosition}
								aria-label={annotationCompareLabels.syncPosition}
								onclick={() => void toggleAnnotationCompareSyncPosition()}
							>
								<span use:icon={annotationCompare.syncPosition === false ? 'unlink' : 'link'}></span>
								<span>{annotationCompareLabels.syncPosition}</span>
							</button>
							<button
								type="button"
								title={annotationCompareLabels.swapPanes}
								aria-label={annotationCompareLabels.swapPanes}
								onclick={() => void swapAnnotationComparePanes()}
							>
								<span use:icon={'arrow-left-right'}></span>
								<span>{annotationCompareLabels.swapPanes}</span>
							</button>
							<button
								type="button"
								class="mod-cta"
								title={annotationCompareLabels.changeCompareVersions}
								aria-label={annotationCompareLabels.changeCompareVersions}
								onclick={() => void openAnnotationCompareVersionSelection()}
							>
								<span use:icon={'git-compare'}></span>
								<span>{annotationCompareLabels.changeCompareVersions}</span>
							</button>
							<button
								type="button"
								title={annotationCompareLabels.versionManager}
								aria-label={annotationCompareLabels.versionManager}
								onclick={() => void openAnnotationVersions()}
							>
								<span use:icon={'history'}></span>
								<span>{annotationCompareLabels.versionManager}</span>
							</button>
							<button
								type="button"
								title={annotationCompareLabels.exitCompare}
								aria-label={annotationCompareLabels.exitCompare}
								onclick={() => void exitAnnotationCompareMode()}
							>
								<span use:icon={'x'}></span>
								<span>{annotationCompareLabels.exitCompare}</span>
							</button>
						</div>
					{/if}
				</div>
			{/if}
			{#if hasExcerptNotesCapability() && readerReady && highlightReloading}
				<div class="epub-reader-highlight-loading-overlay">
					<EpubLoadingState
						variant="compact"
						message={t('epub.reader.highlightLoadingHint')}
					/>
				</div>
			{/if}
			<div class="epub-content-wrapper">
				<EpubReaderView
					{filePath}
					{book}
					{readerService}
					{storageService}
					{annotationService}
					{backlinkService}
					{settings}
					{excerptSettings}
					annotationBookId={getCurrentAnnotationBookId()}
					annotationVersionId={annotationCompareVersionId}
					renderKey={readerRenderKey}
					canUseReadingProgress={hasReadingProgressCapability() && !annotationCompareReadOnly}
					canUseExcerptNotes={canReadAnnotationsInPane}
					getReadingPositionAutoSaveConfig={getContinuousReadingPositionAutoSaveConfig}
					isParagraphModeActive={() => settings.paragraphModeEnabled}
					isParagraphModeProgressDetached={() => paragraphModeDetachedSession}
					shouldSkipReadingProgressPersistOnRelocate={() =>
						paragraphModeDetachedSession
						|| (
							settings.paragraphModeEnabled
							&& (
								paragraphModeBusy
								|| paragraphModeSuppressReactiveRefresh > 0
								|| readerService.isParagraphAnchorSyncInFlight?.() === true
							)
						)
					}
					onAutoReadingPositionSaved={handleAutoReadingPositionSaved}
					hasPendingNavigation={hasPendingBookLocate}
					onProgressChange={(p) => {
						syncReadingProgressDisplay(p);
						scheduleReaderStoreSync({
							progress: hasReadingProgressCapability() ? readingProgress : 0,
							chapterTitle: readerService.getCurrentChapterTitle(),
							chapterHref: readerService.getCurrentChapterHref?.() || '',
							paginationInfo,
						});
						syncScrolledChapterNavVisibility();
						scheduleScrolledNavLayoutSync();
					}}
					onPaginationChange={(info) => {
						paginationInfo = info;
						currentChapterIndex = readerService.getCurrentChapterIndex();
						scheduleReaderStoreSync({
							paginationInfo: info,
							chapterTitle: readerService.getCurrentChapterTitle(),
							chapterHref: readerService.getCurrentChapterHref?.() || '',
						});
						syncScrolledChapterNavVisibility();
						scheduleScrolledNavLayoutSync();
					}}
					onChapterChange={(title) => {
						currentChapterIndex = readerService.getCurrentChapterIndex();
						if (isActiveEpubReaderInstance()) {
							epubActiveDocumentStore.setSharedState({
								chapterTitle: String(title || '').trim(),
								chapterHref: readerService.getCurrentChapterHref?.() || '',
							});
						}
						syncScrolledChapterNavVisibility();
						onChapterTitleChange?.(String(title || '').trim());
					}}
					onReaderReady={() => {
						readerVersion++;
						readerReady = true;
						if (pendingLoadedHighlights) {
							void readerService.applyHighlights(pendingLoadedHighlights).then(() => {
								if (pendingLoadedHighlights && pendingLoadedHighlights.length > 0) {
									publishSidebarHighlights(pendingLoadedHighlights);
								}
							});
						} else if (book) {
							void reloadHighlights();
						}
						epubNavigation.flushPendingBookLocate();
						void migrateLegacyStoredLocations();
						syncScrolledChapterNavVisibility();
						scheduleScrolledNavLayoutSync();
					}}
					onRenderError={(message) => {
						logger.error('[EpubReaderApp] Reader view render error:', message);
						setError(message);
					}}
				/>
			</div>

		{#if !settings.paragraphModeEnabled && showBottomNav() && useVerticalNav()}
				<BottomNav
					onPrev={handlePrevPage}
					onNext={handleNextPage}
					onJumpToPage={handleJumpToPage}
					currentPage={paginationInfo.currentPage}
					totalPages={paginationInfo.totalPages}
					vertical={true}
					statusText={getBottomNavStatusText()}
					statusDetail={getBottomNavStatusDetail()}
				/>
			{/if}

			{#if !settings.paragraphModeEnabled && useVerticalNav() && showScrolledChapterNavActions}
				<div class="epub-scrolled-chapter-action-slot">
					<div class="epub-scrolled-chapter-action-start">
						{#if hasPrevChapter()}
							<button
								type="button"
								class="clickable-icon epub-nav-btn"
								title={t('epub.reader.prevChapter')}
								aria-label={t('epub.reader.prevChapter')}
								onclick={() => void handlePrevChapter()}
							>
								<span class="epub-nav-btn-icon" use:icon={'arrow-left'}></span>
								<span class="epub-nav-btn-label">{t('epub.reader.prevChapter')}</span>
							</button>
						{/if}
					</div>
					<div class="epub-scrolled-chapter-action-end">
						{#if hasNextChapter()}
							<button
								type="button"
								class="clickable-icon epub-nav-btn"
								title={t('epub.reader.nextChapter')}
								aria-label={t('epub.reader.nextChapter')}
								onclick={() => void handleNextChapter()}
							>
								<span class="epub-nav-btn-icon" use:icon={'arrow-right'}></span>
								<span class="epub-nav-btn-label">{t('epub.reader.nextChapter')}</span>
							</button>
						{/if}
					</div>
				</div>
			{/if}

			<ParagraphReadingOverlay
				active={settings.paragraphModeEnabled}
				paragraph={paragraphModeLocation?.paragraphs?.[paragraphModeLocation.currentIndex] || null}
				fontScale={settings.paragraphModeFontScale}
				surfaceStyle={settings.paragraphModeSurfaceStyle}
				transitionStyle={settings.paragraphModeTransitionStyle}
				immersive={paragraphModeImmersive}
				randomReadingActive={paragraphModeDetachedSession}
				currentIndex={paragraphModeLocation?.currentIndex || 0}
				totalCount={paragraphModeLocation?.paragraphs?.length || 0}
				onFontScaleChange={(fontScale) => void updateReaderSettings({ paragraphModeFontScale: fontScale })}
				onSurfaceStyleChange={(surfaceStyle) => void updateReaderSettings({ paragraphModeSurfaceStyle: surfaceStyle })}
				onTransitionStyleChange={setParagraphModeTransitionStyle}
				onRandomParagraph={() => navigateToRandomParagraph()}
				onPrev={() => navigateParagraphRelative(-1)}
				onNext={() => navigateParagraphRelative(1)}
				onFootnoteActivate={handleParagraphFootnoteActivate}
				onHighlightActivate={handleParagraphHighlightActivate}
				onFootnoteDismiss={dismissParagraphFootnotePreview}
				onToggleImmersive={toggleParagraphModeImmersive}
				onClose={() => void closeParagraphMode()}
				onSelectionChange={handleParagraphOverlaySelectionChange}
				onNavMetricsChange={({ bottomDockOffset }) => {
					paragraphModeNavBottomOffset = bottomDockOffset;
				}}
			/>

			{#if readerUiMode !== 'minimal'}
				<AnnotationDisambiguationMenu
					{readerService}
					anchor={annotationDisambiguationAnchor}
					candidates={annotationDisambiguationCandidates}
					mobileDockBottomOffset={settings.paragraphModeEnabled ? paragraphModeNavBottomOffset : 0}
					onPreview={handleAnnotationCandidatePreview}
					onSelect={handleAnnotationCandidateSelect}
					onDismiss={closeAnnotationDisambiguation}
				/>
				<EpubHighlightToolbar
					readerService={readerService}
					mobileDockBottomOffset={settings.paragraphModeEnabled ? paragraphModeNavBottomOffset : 0}
					readerUiMode={readerUiMode}
					semanticSettings={semanticSettings}
					info={canEditAnnotationsInPane ? highlightToolbarInfo : null}
					onDelete={handleHighlightDelete}
					onTemporarilyReveal={handleTemporarilyRevealConcealed}
					onChangeSemantic={handleHighlightChangeSemantic}
					onCopyText={handleHighlightCopyText}
					onEditComment={handleHighlightEditComment}
					onDismiss={() => highlightToolbarInfo = null}
				/>
			{/if}

			<EpubCommentEditorPopover
				open={canEditAnnotationsInPane && commentEditorInfo !== null}
				info={canEditAnnotationsInPane ? commentEditorInfo : null}
				{readerService}
				boundsEl={viewportEl}
				readingLockEl={readingViewportLockEl}
				draftText={commentEditorDraft}
				saving={commentEditorSaving}
				onDraftTextChange={(value) => commentEditorDraft = value}
				onSave={saveHighlightComment}
				onClose={closeCommentEditor}
			/>

			<EpubFootnotePreviewPopover
				info={footnotePreviewInfo}
				boundsEl={viewportEl}
			/>

			<ReferenceDetailModal
				open={referencePopoverInfo !== null && referencePopoverStats !== null}
				info={referencePopoverInfo}
				stats={referencePopoverStats}
				{readerService}
				boundsEl={viewportEl}
				onNavigate={async (source: ReferenceSourceInfo) => {
					await navigateToReferenceSource(source);
					closeReferencePopover();
				}}
				onClose={closeReferencePopover}
			/>

			{#if readerUiMode !== 'minimal' && canUseSelectionToolbarInPane}
				<SelectionToolbar
					{app}
					{readerService}
					{book}
					{readerVersion}
					readerUiMode={readerUiMode}
					semanticSettings={semanticSettings}
					boundsEl={viewportEl}
					mobileDockBottomOffset={settings.paragraphModeEnabled ? paragraphModeNavBottomOffset : 0}
					externalSelection={settings.paragraphModeEnabled ? paragraphModeSelection : null}
					{autoInsert}
					{canvasMode}
					canUseExcerptNotes={canEditAnnotationsInPane}
					canUseStyledExcerpts={canEditAnnotationsInPane && hasStyledExcerptCapability()}
					showPremiumFeaturePreviewEnabled={isPremiumFeaturePreviewEnabled() && !annotationCompareReadOnly}
					onRequestPremiumFeaturePreview={openPremiumFeaturePreview}
					onInsertToNote={canEditAnnotationsInPane ? handleInsertToNote : undefined}
					onCopySelectionLink={
						canEditAnnotationsInPane || (isPremiumFeaturePreviewEnabled() && !annotationCompareReadOnly)
							? handleCopySelectionLink
							: undefined
					}
					onExtractToCard={canEditAnnotationsInPane ? handleExtractToCard : undefined}
					onCreateReadingPoint={canEditAnnotationsInPane && hasCreateReadingPointCapability() ? handleCreateReadingPoint : undefined}
					onAutoInsert={canEditAnnotationsInPane ? handleAutoInsertSelection : undefined}
					onOpenAIMenu={showSelectedTextAIMenu}
				/>
			{/if}

			<EpubPremiumFeaturePopover
				open={premiumFeaturePreviewFeatureId !== null}
				featureId={premiumFeaturePreviewFeatureId}
				onClose={closePremiumFeaturePreview}
				onOpenSettings={() => resolveEpubHost(app)?.openEpubPremiumSettings?.()}
			/>

			<EpubTutorial
				visible={tutorialVisible}
				initialTab={tutorialInitialTab}
				showDismissOption={!readerTutorialDismissed}
				onClose={closeTutorial}
				onDismissPermanently={dismissTutorialPermanently}
			/>

			<ScreenshotOverlay
				active={screenshotMode}
				sourceEl={viewportEl}
				{screenshotService}
				getVisibleFrames={getVisibleReaderFrames}
				onCapture={handleScreenshotCapture}
				onCancel={() => screenshotMode = false}
			/>

			{#if typographyPopoverOpen}
				<div class="epub-settings-float epub-glass-panel">
					<div class="epub-settings-row epub-settings-row--stack">
						<div class="epub-settings-row__heading">
							<span class="label">{t('epub.reader.typography.lineHeight')}</span>
							<span class="epub-settings-value">{settings.lineHeight.toFixed(2)}</span>
						</div>
						<input
							class="epub-settings-range"
							type="range"
							min="1.2"
							max="2.4"
							step="0.01"
							value={settings.lineHeight}
							aria-label={t('epub.reader.typography.lineHeightAria')}
							oninput={(event) => previewReaderLineHeight((event.currentTarget as HTMLInputElement).value)}
							onchange={persistCurrentReaderSettings}
						/>
					</div>
					<div class="epub-settings-row epub-settings-row--stack">
						<div class="epub-settings-row__heading">
							<span class="label">{t('epub.reader.typography.letterSpacing')}</span>
							<span class="epub-settings-value">{formatLetterSpacingValue(settings.letterSpacing)}</span>
						</div>
						<input
							class="epub-settings-range"
							type="range"
							min="-0.02"
							max="0.24"
							step="0.01"
							value={settings.letterSpacing}
							aria-label={t('epub.reader.typography.letterSpacingAria')}
							oninput={(event) => previewReaderLetterSpacing((event.currentTarget as HTMLInputElement).value)}
							onchange={persistCurrentReaderSettings}
						/>
					</div>
					<div class="epub-settings-row epub-settings-row--stack">
						<div class="epub-settings-row__heading">
							<span class="label">{t('epub.reader.typography.pageMargin')}</span>
							<span class="epub-settings-value">{Math.round(settings.pageMargin)}</span>
						</div>
						<input
							class="epub-settings-range"
							type="range"
							min="8"
							max="96"
							step="1"
							value={settings.pageMargin}
							aria-label={t('epub.reader.typography.pageMarginAria')}
							oninput={(event) => previewReaderPageMargin((event.currentTarget as HTMLInputElement).value)}
							onchange={persistCurrentReaderSettings}
						/>
					</div>
					<div class="epub-settings-row">
						<span class="label">{t('epub.reader.typography.widthMode')}</span>
						<div class="epub-settings-mode-group">
							<button
								type="button"
							class="clickable-icon epub-settings-mode-btn"
							class:active={settings.widthMode === 'standard'}
							disabled={settings.layoutMode === 'double'}
							onclick={() => setReaderWidthMode('standard')}
						>{t('epub.reader.typography.widthStandard')}</button>
						<button
							type="button"
							class="clickable-icon epub-settings-mode-btn"
							class:active={settings.widthMode === 'full'}
							disabled={settings.layoutMode === 'double'}
							onclick={() => setReaderWidthMode('full')}
						>{t('epub.reader.typography.widthWide')}</button>
						<button
							type="button"
							class="clickable-icon epub-settings-mode-btn"
							class:active={settings.widthMode === 'fit'}
							onclick={() => setReaderWidthMode('fit')}
						>{t('epub.reader.typography.widthFull')}</button>
						<button
							type="button"
							class="clickable-icon epub-settings-mode-btn"
							class:active={settings.widthMode === 'edge'}
							disabled={settings.layoutMode === 'double'}
							onclick={() => setReaderWidthMode('edge')}
						>{t('epub.reader.typography.widthEdge')}</button>
						</div>
					</div>
					<div class="epub-settings-row">
						<span class="label">{t('epub.reader.typography.scrolledSideNav')}</span>
						<label class="epub-export-notes-popover__toggle-switch">
							<input
								type="checkbox"
								checked={settings.showScrolledSideNav}
								onchange={(event) => handleScrolledSideNavToggle((event.currentTarget as HTMLInputElement).checked)}
							/>
							<span class="epub-export-notes-popover__toggle-slider"></span>
						</label>
					</div>
					<div class="epub-settings-row">
						<span class="label">{t('epub.reader.typography.footnoteAction')}</span>
						<div class="epub-settings-mode-group">
							{#if hasFootnotePreviewCapability()}
								<button
									type="button"
									class="clickable-icon epub-settings-mode-btn"
									class:active={settings.footnoteClickAction === 'preview'}
									onclick={() => setFootnoteClickAction('preview')}
								>{t('epub.reader.typography.footnotePreview')}</button>
							{/if}
							<button
								type="button"
								class="clickable-icon epub-settings-mode-btn"
								class:active={settings.footnoteClickAction === 'navigate'}
								onclick={() => setFootnoteClickAction('navigate')}
							>{t('epub.reader.typography.footnoteNavigate')}</button>
						</div>
					</div>
					<div class="epub-settings-actions">
						<button type="button" class="epub-settings-reset" onclick={resetReaderTypographySettings}>{t('epub.reader.typography.reset')}</button>
					</div>
				</div>
			{/if}

			<BookNotesExportPopover
				{app}
				open={exportNotesPopoverOpen}
				excerptSettingsReady={excerptSettingsLoaded}
				bind:exportNotesPopoverEl
				{excerptSettings}
				exportNotesSubmitting={exportNotesSubmitting}
				canSubmit={canSubmitBookNotesExport()}
				{t}
				{isMarkdownVaultFile}
				onUpdateSetting={updateBookNotesExportSetting}
				onUpdateTargetMode={updateBookNotesExportTargetMode}
				onClose={closeExportNotesPopover}
				onSubmit={submitBookNotesExport}
			/>

		</div>

		{#if !settings.paragraphModeEnabled && showBottomNav() && !useVerticalNav()}
			<div class="epub-bottom-nav-slot">
				<BottomNav
					onPrev={handlePrevPage}
					onNext={handleNextPage}
					onJumpToPage={handleJumpToPage}
					currentPage={paginationInfo.currentPage}
					totalPages={paginationInfo.totalPages}
					vertical={false}
					statusText={getBottomNavStatusText()}
					statusDetail={getBottomNavStatusDetail()}
				/>
			</div>
		{/if}
	{/if}
</div>
