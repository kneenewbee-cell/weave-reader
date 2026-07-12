/**
 * EPUB Active Document Store
 * 全局状态：EPUB阅读器当前打开的文件路径及共享服务实例
 * - filePath: 卡片管理界面用于文档关联筛选
 * - services: 全局侧边栏用于读取TOC/高亮并执行导航
 */

import type {
	EpubAnnotationService,
	EpubBook,
	EpubExcerptSettings,
	EpubHighlightViewSnapshotService,
	EpubReaderEngine,
	TocItem,
} from "../services/epub";
import type { EpubTocChapterMark, EpubTocChapterMarkMap } from "../services/epub/epub-toc-chapter-mark";
import type { FlatTocExportItem } from "../services/epub/epub-toc-export-scope";
import type { EpubTocChapterMarkSettings } from "../services/epub/epub-toc-chapter-mark-settings";
import type { EpubDisplayHighlight } from "../services/epub/EpubHighlightViewSnapshotService";
import type { FlashStyle, PaginationInfo } from "../services/epub";
import type { EpubBacklinkHighlightService } from "../services/epub/EpubBacklinkHighlightService";
import type { EpubReferenceStatsService } from "../services/epub/EpubReferenceStatsService";

export interface EpubNavigationRequest {
	cfi?: string;
	href?: string;
	text?: string;
	flashStyle?: FlashStyle;
	flashColor?: string;
	showLocateOverlay?: boolean;
}

export interface EpubSharedState {
	filePath: string | null;
	readerService: EpubReaderEngine | null;
	annotationService: EpubAnnotationService | null;
	highlightViewSnapshotService: EpubHighlightViewSnapshotService | null;
	backlinkService: EpubBacklinkHighlightService | null;
	referenceStatsService: EpubReferenceStatsService | null;
	book: EpubBook | null;
	canUseReadingProgress: boolean;
	canUseExcerptNotes: boolean;
	excerptSettings: EpubExcerptSettings | null;
	annotationRevision: number;
	bookmarkRevision: number;
	tocChapterMarkRevision: number;
	tocChapterMarkSettingsRevision: number;
	tocChapterMarks: EpubTocChapterMarkMap;
	tocChapterMarkSettings: EpubTocChapterMarkSettings;
	progress: number;
	chapterTitle: string;
	chapterHref: string;
	paginationInfo: PaginationInfo | null;
	navigationBusy: boolean;
	navigationLabel: string;
	searchQuerySeed: string;
	searchRequestNonce: number;
	onDeleteBookmark: ((bookmarkId: string) => Promise<boolean>) | null;
	onDeleteHighlight: ((highlight: EpubDisplayHighlight) => Promise<boolean>) | null;
	onExportHighlights: ((selectionKeys: string[]) => Promise<void>) | null;
	onSettingsClick: ((evt: MouseEvent) => void) | null;
	onSwitchBook: ((filePath: string) => void) | null;
	onCreateChapterReadingPoint: ((item: TocItem, event?: MouseEvent) => Promise<void>) | null;
	onExportTocChapterMarked:
		| ((
				item: TocItem,
				itemIndex: number,
				flatTocItems: FlatTocExportItem[]
		  ) => Promise<void>)
		| null;
	onSetTocChapterMark: ((item: TocItem, mark: EpubTocChapterMark | null) => Promise<void>) | null;
	onSaveTocChapterMarkSettings: ((settings: EpubTocChapterMarkSettings) => Promise<void>) | null;
	onNavigate: ((request: EpubNavigationRequest) => void) | null;
}

type Subscriber = (state: EpubSharedState) => void;
type FilePathSubscriber = (filePath: string | null) => void;

const EMPTY_STATE: EpubSharedState = {
	filePath: null,
	readerService: null,
	annotationService: null,
	highlightViewSnapshotService: null,
	backlinkService: null,
	referenceStatsService: null,
	book: null,
	canUseReadingProgress: false,
	canUseExcerptNotes: false,
	excerptSettings: null,
	annotationRevision: 0,
	bookmarkRevision: 0,
	tocChapterMarkRevision: 0,
	tocChapterMarkSettingsRevision: 0,
	tocChapterMarks: {},
	tocChapterMarkSettings: {},
	progress: 0,
	chapterTitle: "",
	chapterHref: "",
	paginationInfo: null,
	navigationBusy: false,
	navigationLabel: "",
	searchQuerySeed: "",
	searchRequestNonce: 0,
	onDeleteBookmark: null,
	onDeleteHighlight: null,
	onExportHighlights: null,
	onSettingsClick: null,
	onSwitchBook: null,
	onCreateChapterReadingPoint: null,
	onExportTocChapterMarked: null,
	onSetTocChapterMark: null,
	onSaveTocChapterMarkSettings: null,
	onNavigate: null,
};

class EpubActiveDocumentStore {
	private state: EpubSharedState = { ...EMPTY_STATE };
	private subscribers: Set<Subscriber> = new Set();
	private filePathSubscribers: Set<FilePathSubscriber> = new Set();

	setActiveDocument(filePath: string | null): void {
		this.state.filePath = filePath;
		this.notifyAll();
	}

	getActiveDocument(): string | null {
		return this.state.filePath;
	}

	clearActiveDocument(filePath?: string | null): void {
		if (filePath && this.state.filePath && this.state.filePath !== filePath) {
			return;
		}
		this.state = { ...EMPTY_STATE };
		this.notifyAll();
	}

	setSharedState(partial: Partial<EpubSharedState>): void {
		Object.assign(this.state, partial);
		this.notifyAll();
	}

	getSharedState(): Readonly<EpubSharedState> {
		return this.state;
	}

	subscribe(callback: FilePathSubscriber): () => void {
		this.filePathSubscribers.add(callback);
		callback(this.state.filePath);
		return () => {
			this.filePathSubscribers.delete(callback);
		};
	}

	subscribeState(callback: Subscriber): () => void {
		this.subscribers.add(callback);
		callback(this.state);
		return () => {
			this.subscribers.delete(callback);
		};
	}

	private notifyAll(): void {
		for (const callback of this.filePathSubscribers) {
			callback(this.state.filePath);
		}

		for (const callback of this.subscribers) {
			callback(this.state);
		}
	}
}

export const epubActiveDocumentStore = new EpubActiveDocumentStore();
