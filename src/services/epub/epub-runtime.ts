export interface EpubRuntimeConfig {
	pluginId: string;
	pluginDirName: string;
	viewTypes: {
		reader: string;
		sidebar: string;
		bookshelfSidebar: string;
	};
	protocol: {
		primaryName: string;
		legacyNames: string[];
		allNames: string[];
	};
	events: {
		bookshelfDataChanged: string;
		bookshelfRefreshRequest: string;
		bookshelfDisplaySettingsChanged: string;
		bookDisplayTitleChanged: string;
		excerptSettingsChanged: string;
		highlightSyncRequested: string;
		navigate: string;
		premiumFeaturePreviewRequest: string;
		premiumUiStateChanged: string;
	};
	globals: {
		pendingNavigationKey: string;
	};
}

declare const __WEAVE_EPUB_STANDALONE__: boolean;

const isStandalone = typeof __WEAVE_EPUB_STANDALONE__ !== "undefined" && __WEAVE_EPUB_STANDALONE__;

const primaryProtocolName = isStandalone ? "weave-epub-reader" : "weave-epub";
const legacyProtocolNames = isStandalone ? ["weave-epub"] : [];
const bookshelfDataChangedEvent = isStandalone
	? "WeaveEpubStandalone:epub-bookshelf-data-changed"
	: "Weave:epub-bookshelf-data-changed";
const bookshelfRefreshRequestEvent = isStandalone
	? "WeaveEpubStandalone:epub-bookshelf-refresh-request"
	: "Weave:epub-bookshelf-refresh-request";
const bookshelfDisplaySettingsChangedEvent = isStandalone
	? "WeaveEpubStandalone:epub-bookshelf-display-settings-changed"
	: "Weave:epub-bookshelf-display-settings-changed";
const bookDisplayTitleChangedEvent = isStandalone
	? "WeaveEpubStandalone:epub-book-display-title-changed"
	: "Weave:epub-book-display-title-changed";
const excerptSettingsChangedEvent = isStandalone
	? "WeaveEpubStandalone:epub-excerpt-settings-changed"
	: "Weave:epub-excerpt-settings-changed";
const highlightSyncRequestedEvent = isStandalone
	? "WeaveEpubStandalone:epub-highlight-sync-requested"
	: "Weave:epub-highlight-sync-requested";

export const EPUB_RUNTIME: EpubRuntimeConfig = {
	pluginId: isStandalone ? "weave-epub-reader" : "weave",
	pluginDirName: isStandalone ? "weave-epub-reader" : "weave",
	viewTypes: {
		reader: isStandalone ? "weave-epub-reader-standalone" : "weave-epub-reader",
		sidebar: isStandalone ? "weave-epub-sidebar-standalone" : "weave-epub-sidebar",
		bookshelfSidebar: isStandalone
			? "weave-epub-bookshelf-sidebar-standalone"
			: "weave-epub-bookshelf-sidebar",
	},
	protocol: {
		primaryName: primaryProtocolName,
		legacyNames: legacyProtocolNames,
		allNames: [primaryProtocolName, ...legacyProtocolNames],
	},
	events: {
		bookshelfDataChanged: bookshelfDataChangedEvent,
		bookshelfRefreshRequest: bookshelfRefreshRequestEvent,
		bookshelfDisplaySettingsChanged: bookshelfDisplaySettingsChangedEvent,
		bookDisplayTitleChanged: bookDisplayTitleChangedEvent,
		excerptSettingsChanged: excerptSettingsChangedEvent,
		highlightSyncRequested: highlightSyncRequestedEvent,
		navigate: isStandalone ? "WeaveEpubStandalone:epub-navigate" : "Weave:epub-navigate",
		premiumFeaturePreviewRequest: isStandalone
			? "WeaveEpubStandalone:epub-premium-feature-preview-request"
			: "Weave:epub-premium-feature-preview-request",
		premiumUiStateChanged: isStandalone
			? "WeaveEpubStandalone:epub-premium-ui-state-changed"
			: "Weave:epub-premium-ui-state-changed",
	},
	globals: {
		pendingNavigationKey: isStandalone
			? "__weaveEpubStandalonePendingNav"
			: "__weaveEpubPendingNav",
	},
};

export function getEpubRuntime(): EpubRuntimeConfig {
	return EPUB_RUNTIME;
}

export function isLegacyEpubProtocolName(protocolName: string): boolean {
	return EPUB_RUNTIME.protocol.legacyNames.includes(protocolName);
}

export function isSupportedEpubProtocolName(protocolName: string): boolean {
	return EPUB_RUNTIME.protocol.allNames.includes(protocolName);
}
