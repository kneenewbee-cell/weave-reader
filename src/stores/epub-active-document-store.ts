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

export type ActiveReaderDocumentKind = "epub" | "pdf" | null;

export interface PdfPageThumbnail {
	pageNumber: number;
	image: string;
}

export interface PdfSharedState {
	filePath: string;
	title: string;
	currentPage?: number;
	pageCount?: number;
	furthestPage?: number;
	progress?: number;
	visitedPageCount?: number;
	activeTool?: "pan" | "select" | "stroke-select" | "capture" | "pen" | "highlighter" | "eraser";
	inkStrokeCount?: number;
	thumbnails?: PdfPageThumbnail[];
	onNavigatePage?: ((pageNumber: number) => void) | null;
}

export interface EpubSharedState {
	activeKind: ActiveReaderDocumentKind;
	filePath: string | null;
	pdf: PdfSharedState | null;
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
	activeKind: null,
	filePath: null,
	pdf: null,
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
		if (!filePath) {
			this.clearActiveDocument();
			return;
		}
		this.state.activeKind = "epub";
		this.state.filePath = filePath;
		this.state.pdf = null;
		this.notifyAll();
	}

	getActiveDocument(): string | null {
		return this.state.filePath;
	}

	setActivePdfDocument(input: PdfSharedState): void {
		const filePath = String(input.filePath || "").trim();
		const title = String(input.title || "").trim();
		const pdf: PdfSharedState = {
			filePath,
			title,
		};

		if (Number.isFinite(input.currentPage)) {
			pdf.currentPage = Math.max(1, Math.floor(Number(input.currentPage)));
		}
		if (Number.isFinite(input.pageCount)) {
			pdf.pageCount = Math.max(1, Math.floor(Number(input.pageCount)));
		}
		if (Number.isFinite(input.furthestPage)) {
			pdf.furthestPage = Math.max(1, Math.floor(Number(input.furthestPage)));
		}
		if (Number.isFinite(input.progress)) {
			pdf.progress = Math.max(0, Math.min(100, Math.round(Number(input.progress))));
		}
		if (Number.isFinite(input.visitedPageCount)) {
			pdf.visitedPageCount = Math.max(0, Math.floor(Number(input.visitedPageCount)));
		}
		if (
			input.activeTool === "pan" ||
			input.activeTool === "select" ||
			input.activeTool === "stroke-select" ||
			input.activeTool === "capture" ||
			input.activeTool === "pen" ||
			input.activeTool === "highlighter" ||
			input.activeTool === "eraser"
		) {
			pdf.activeTool = input.activeTool;
		}
		if (Number.isFinite(input.inkStrokeCount)) {
			pdf.inkStrokeCount = Math.max(0, Math.floor(Number(input.inkStrokeCount)));
		}
		if (Array.isArray(input.thumbnails)) {
			pdf.thumbnails = input.thumbnails
				.filter((thumbnail) => thumbnail?.pageNumber && thumbnail?.image)
				.map((thumbnail) => ({
					pageNumber: Math.max(1, Math.floor(Number(thumbnail.pageNumber))),
					image: String(thumbnail.image),
				}));
		}
		if (typeof input.onNavigatePage === "function") {
			pdf.onNavigatePage = input.onNavigatePage;
		}

		this.state = {
			...EMPTY_STATE,
			activeKind: "pdf",
			filePath,
			pdf,
			progress: pdf.progress ?? 0,
		};
		this.notifyAll();
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
