export { FoliateReaderService } from "./FoliateReaderService";
export {
	DEFAULT_EPUB_READER_ENGINE,
	createEpubReaderEngine,
} from "./reader-engine-factory";
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
