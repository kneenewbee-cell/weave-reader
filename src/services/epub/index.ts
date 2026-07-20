export { FoliateReaderService } from "./FoliateReaderService";
export {
	DEFAULT_EPUB_READER_ENGINE,
	createEpubReaderEngine,
} from "./reader-engine-factory";
export {
	DEFAULT_EPUB_READER_UI_MODE,
	EPUB_READER_UI_MODE_CHANGED_EVENT,
	EPUB_READER_UI_MODES,
	normalizeEpubReaderUiMode,
	notifyEpubReaderUiModeChanged,
	readEpubReaderUiModeChange,
	type EpubReaderUiMode,
} from "./reader-ui-mode";
export * from "./semantic/profiles";
export {
	EPUB_PORTABLE_DATA_ROOT,
	EPUB_SEMANTIC_PROFILE_CHANGED_EVENT,
	clearBookEpubPortableSemanticAnnotations,
	createEpubSemanticProfileStore,
	deleteBookEpubSemanticProfile,
	ensureActiveEpubSemanticProfile,
	getEpubPortableBookPath,
	getEpubPortableDataRoot,
	loadEffectiveEpubSemanticProfile,
	loadEffectiveEpubSemanticProfileForVersion,
	materializeEpubSemanticProfileForVersion,
	normalizeEpubSemanticSettings,
	notifyEpubSemanticProfileChanged,
	readAndMaterializeEffectiveEpubPortableAnnotations,
	readBookEpubPortableAnnotations,
	readBookEpubSemanticProfile,
	readEffectiveEpubPortableAnnotations,
	readEpubSemanticProfileForVersion,
	readEpubPortableAnnotationsForVersion,
	readGlobalEpubSemanticProfile,
	readEpubSemanticJson,
	safeEpubSemanticBookId,
	writeBookEpubPortableAnnotations,
	writeBookEpubSemanticProfile,
	writeEpubSemanticJson,
	writeGlobalEpubSemanticProfile,
	type EpubAnnotationSemantic,
	type EpubSemanticSettings,
	type EpubSemanticSettingsScope,
} from "./semantic/semantic-store";
export type {
	EpubReaderEngine,
	EpubReaderEngineType,
	FlashStyle,
	HighlightSourceLocator,
	HighlightClickInfo,
	NavigateAndHighlightOptions,
	ReaderHighlightPresentation,
	ReaderNavigateOptions,
	ReaderAppearanceOptions,
	ReaderFootnotePreviewInfo,
	ReaderFrame,
	ReaderHighlight,
	ReaderHighlightInput,
	ReaderHighlightSegment,
	ReaderParagraph,
	ReaderParagraphLocation,
	ReaderParagraphSelectionResolution,
	ReaderRandomParagraphPick,
	ReaderRenderOptions,
	ReaderSelectionChange,
	ReaderViewportGeometry,
} from "./reader-engine-types";
export { EpubStorageService, flushEpubStoragePendingProgress } from "./EpubStorageService";
export { flushEpubPendingProgress, getEpubStorageService, resetEpubStorageServiceCache } from "./epub-storage-access";
export {
	BOOKSHELF_GRID_PAINT_OPTIMIZATION_THRESHOLD,
	BOOKSHELF_LIST_VIRTUAL_SCROLL_THRESHOLD,
	shouldUseBookshelfGridPaintOptimization,
	shouldUseBookshelfListVirtualScroll,
} from "./bookshelf-display-performance";
export {
	findEpubPortableBookIdByIdentity,
	findEpubPortableBookIdByPath,
	findEpubPortableBookIdInIndexByIdentity,
	findEpubPortableBookIdInIndex,
	resolveEpubPortableBookDataLocation,
	type EpubPortableBookIdentityHints,
	type EpubPortableBookDataLocation,
} from "./epub-portable-data-location";
export {
	createEpubAnnotationVersion,
	deleteEpubAnnotationVersion,
	ensureActiveEpubAnnotationVersion,
	EPUB_ANNOTATION_VERSION_CHANGED_EVENT,
	listEpubAnnotationVersions,
	notifyEpubAnnotationVersionChanged,
	readActiveEpubAnnotationVersionAnnotations,
	readEpubAnnotationVersionAnnotations,
	renameEpubAnnotationVersion,
	switchEpubAnnotationVersion,
	writeActiveEpubAnnotationVersionAnnotations,
	type EpubAnnotationVersionSummary,
} from "./epub-annotation-version-store";
export {
	resolveEpubAnnotationPaneCapabilities,
	type EpubAnnotationPaneCapabilities,
	type EpubAnnotationPaneCapabilitiesInput,
} from "./epub-annotation-pane-capabilities";
export {
	createEpubAnnotatedBookPackage,
	downloadEpubAnnotatedBookPackage,
	importEpubAnnotatedBookPackage,
	pickEpubAnnotatedBookPackageArrayBuffer,
	type EpubAnnotatedBookPackageMatchKind,
	type EpubAnnotatedBookPackageResult,
	type ImportEpubAnnotatedBookPackageResult,
} from "./epub-portable-book-package";
export {
	computeAvailableEpubFingerprints,
	computeEpubFileFingerprint,
	computeEpubFingerprints,
	type EpubFingerprints,
	type PartialEpubFingerprints,
} from "./epub-fingerprints";
export {
	hasEpubPortableBookmarksData,
	hasEpubPortableReadingStateData,
	readEpubPortableBookmarks,
	readEpubPortableReadingState,
	writeEpubPortableBookmarks,
	writeEpubPortableReadingState,
} from "./epub-portable-book-data";
export {
	renderEpubAnnotationNoteMarkdown,
	type EpubAnnotationNoteAnnotationInput,
	type EpubAnnotationNoteBookInput,
	type RenderEpubAnnotationNoteMarkdownInput,
} from "./annotation-note-markdown";
export {
	applyAnnotationChapterMetadata,
	hasAnnotationChapterMetadataChanged,
	resolveAnnotationChapterMetadata,
	type EpubAnnotationChapterMetadata,
	type ResolveAnnotationChapterMetadataInput,
} from "./annotation-chapter-metadata";
export type {
	EpubBookshelfSettings,
	EpubBookshelfIndexEntry,
	EpubBookshelfMembershipEntry,
	EpubExcerptSettings,
	EpubScanIndexEntry,
} from "./EpubStorageService";
export {
	DEFAULT_EPUB_BOOKSHELF_SETTINGS,
	DEFAULT_EPUB_EXCERPT_SETTINGS,
} from "./EpubStorageService";
export {
	registerEpubHost,
	resolveEpubHost,
	resolveEpubWeaveOfficialAPI,
	unregisterEpubHost,
} from "./epub-host";
export type {
	EpubHostAISplitConfigModalInput,
	EpubHostCapabilities,
	EpubHostCreateCardInput,
	EpubHostExportBookNotesInput,
	EpubHostExportChapterInput,
	EpubHostOpenAnnotationNoteInput,
	EpubHostIncrementalReadingTopicOption,
	EpubHostMarkdownAsset,
	EpubHostReadingPointInput,
	EpubHostResumePointInput,
	EpubHostScheduleChapterInput,
	EpubHostSelectedTextAIPanelInput,
	EpubHostSelectedTextAISplitMenuOptions,
	EpubWeaveExcerptRemovalMode,
	EpubWeaveOfficialAPI,
	EpubWeaveOfficialAPIInfo,
	EpubWeaveRemoveExcerptInput,
	EpubWeaveRemoveExcerptResult,
} from "./epub-host";
export {
	EPUB_ANNOTATION_COMPARE_CONTEXT_EVENT,
	EPUB_DUAL_WINDOW_ANNOTATION_EVENT,
	EPUB_DUAL_WINDOW_READER_DISPLAY_EVENT,
	EPUB_DUAL_WINDOW_SESSION_EVENT,
	createEpubDualWindowAnnotationDetail,
	createEpubAnnotationCompareContexts,
	dispatchEpubAnnotationCompareContextEvent,
	dispatchEpubDualWindowAnnotationEvent,
	dispatchEpubDualWindowReaderDisplayEvent,
	dispatchEpubDualWindowSessionEvent,
	normalizeEpubAnnotationCompareContextChangeDetail,
	normalizeEpubDualWindowReaderDisplayDetail,
	normalizeEpubAnnotationCompareContext,
	resolveEpubAnnotationCompareExitPlan,
	shouldRemountEpubReaderForStateChange,
	shouldShowEpubReaderPrimaryToolbar,
	type EpubAnnotationCompareContextChangeDetail,
	type EpubAnnotationCompareContext,
	type EpubAnnotationCompareExitPlan,
	type EpubAnnotationComparePaneRole,
	type EpubDualWindowReaderDisplayDetail,
	type EpubDualWindowReaderFlowMode,
	type EpubDualWindowReaderLayoutMode,
	type EpubReaderPrimaryToolbarVisibilityInput,
	type EpubDualWindowAnnotationDetail,
	type EpubDualWindowAnnotationPhase,
	type EpubDualWindowMode,
	type EpubDualWindowSessionDetail,
} from "./epub-dual-window";
export {
	cleanupStaleEpubDualWindowSessions,
	getEpubDualWindowLeafContainerEl,
	getEpubDualWindowLeafContainerEls,
	getEpubDualWindowSession,
	hasEpubDualWindowSession,
	listOpenEpubDualWindowSessions,
	markEpubDualWindowPaneRoles,
	markEpubDualWindowNoteLeaf,
	registerEpubDualWindowSession,
	resolveEpubDualWindowOpenGuard,
	resolveEpubDualWindowBoundaryPosition,
	resolveEpubDualWindowPanes,
	resolveEpubDualWindowSwapPanes,
	restoreEpubDualWindowSessionsFromWorkspace,
	swapEpubDualWindowPanes,
	unregisterEpubDualWindowSession,
	type EpubDualWindowHousekeepingResult,
	type EpubDualWindowOpenGuardInput,
	type EpubDualWindowOpenGuardResult,
	type EpubDualWindowPanes,
	type EpubDualWindowPosition,
	type EpubDualWindowRect,
	type EpubDualWindowSideKind,
	type EpubDualWindowSession,
	type EpubDualWindowSwapLookupInput,
	type EpubDualWindowSwapPanes,
	type EpubOpenDualWindowSession,
} from "./epub-dual-window-workspace";
export {
	EPUB_RUNTIME,
	getEpubRuntime,
	isLegacyEpubProtocolName,
	isSupportedEpubProtocolName,
} from "./epub-runtime";
export { EpubAnnotationService } from "./EpubAnnotationService";
export { EpubBacklinkHighlightService } from "./EpubBacklinkHighlightService";
export { getEpubBacklinkHighlightService } from "./epub-backlink-highlight-access";
export {
	EpubAnnotationIndexService,
	bootstrapEpubAnnotationIndex,
	getEpubAnnotationIndexService,
	scheduleEpubAnnotationIndexWarmup,
	warmEpubAnnotationIndexForPaths,
} from "./epub-annotation-index";
export type {
	EpubAnnotationIndexReadiness,
	EpubAnnotationPrefetchInput,
} from "./epub-annotation-index";
export { getEpubHighlightViewSnapshotService } from "./epub-highlight-view-snapshot-access";
export { EpubHighlightViewSnapshotService } from "./EpubHighlightViewSnapshotService";
export type {
	EpubDisplayHighlight,
	EpubHighlightRenderSnapshot,
	EpubHighlightSnapshotContextInput,
	EpubHighlightSnapshotRevalidateInput,
} from "./EpubHighlightViewSnapshotService";
export { EpubReferenceStatsService } from "./EpubReferenceStatsService";
export type { ReferenceStats, ReferenceSourceInfo } from "./EpubReferenceStatsService";
export {
	EpubBookmarkService,
	EPUB_BOOKMARK_AUTO_MAINTAINED_CALLOUT,
	type EpubBookmarkReadingState,
	DEFAULT_EPUB_BOOKMARK_FOLDER,
	normalizeEpubBookmarkFolderPath,
} from "./EpubBookmarkService";
export { EpubLinkService } from "./EpubLinkService";
export { EpubLocationMigrationService } from "./EpubLocationMigrationService";
export { EpubScreenshotService } from "./EpubScreenshotService";
export { EpubCanvasService } from "./EpubCanvasService";
export {
	canOpenBookWithCurrentLicense,
	canUseEpubCanvasExcerpts,
	canOpenEpubFile,
	canUseEpubChapterExport,
	canUseEpubExcerptNotes,
	canUseEpubFootnotePreview,
	canUseEpubParagraphMode,
	getEpubFeatureTierPreview,
	getEpubPremiumFeaturePreviewContent,
	canUseEpubPremiumFeature,
	canUseEpubReadingProgress,
	canUseEpubReadingReference,
	canUseEpubSourceLocation,
	canUseEpubStyledExcerpts,
	ensureBookSourceLocationAccess,
	ensureEpubFileAccess,
	ensureEpubPremiumFeature,
	requestEpubPremiumFeaturePreview,
} from "./epub-premium";
export {
	exportBookNotesToMarkdown,
	exportBookSectionToMarkdown,
} from "./book-markdown-export";
export {
	loadPublicationTocItems,
	navigateToPublicationChapter,
	buildPublicationChapterMarkdownLink,
} from "./epub-ir-interop";
export type {
	BookMarkdownExportAsset,
	ExportBookNotesToMarkdownInput,
	ExportBookSectionToMarkdownInput,
} from "./book-markdown-export";
export * from "./types";
export * from "./canvas-types";
export {
	isBookCompleted,
	resolveDisplayProgress,
	resolveBookshelfReadingStatus,
	type BookshelfReadingStatus,
} from "./book-progress";
