import JSZip from "jszip";
import { unknownPlainText } from "../../utils/unknown-plain-text";
import { type App, TFile } from "obsidian";
import {
	isBlobResourceUrl,
	prefetchBlobUrlsFromText,
	readBlobUrlAsArrayBuffer,
	readBlobUrlAsText,
} from "../../utils/blob-url-text";
import "../../utils/blob-url-registry";
import { createDivInDocument } from "../../utils/obsidian-document-dom";
import { domInstanceOf } from "../../utils/dom-instance-of";
import { logger } from "../../utils/logger";
import { readVaultBinaryData } from "./EpubBinaryData";
import {
	getBookExtensionFromPath,
	stripSupportedBookExtension,
	usesFoliateGenericBookLoader,
	usesPlainTextBookAdapter,
} from "./book-format";
import { EpubError } from "./epub-error";
import { makePlainTextBook } from "./plain-text-book";
import { inlineFoliateBlobMarkup, shouldRemoveHttpEquivMeta } from "./foliate-blob-markup-normalizer";
import * as EpubCfi from "./epub-cfi";
import type { TocItem } from "./types";
import type { EpubChapterLocationFormat } from "./epub-excerpt-settings";
import {
	getSplitSectionParentBasename,
	resolveChapterLocationLabel,
} from "../../utils/epub-chapter-location-label";
import { tocHrefBasename } from "../../utils/epub-toc-reading-position";
import type { EpubBookFootnoteEntry, EpubBookFootnotesDraft } from "./reader-engine-types";
import {
	extractTocHrefFragment,
	resolveTocExportEndBoundary,
	type FlatTocExportItem,
} from "./epub-toc-export-scope";

const EPUB_OPS_NAMESPACE = "http://www.idpf.org/2007/ops";
const POSITION_CHAR_BUCKET = 1800;
const MAX_SEARCH_RESULTS = 120;
const TEXT_NODE_TAG_BLACKLIST = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
const COMPACT_READIUM_MARKER = "loc";
const COMPACT_READIUM_SEPARATOR = "~";
const REMOTE_RESOURCE_URL_PATTERN = /^(?:https?:)?\/\//i;
const SCRIPT_PROTOCOL_PATTERN = /^\s*(?:javascript|vbscript)\s*:/i;
const DANGEROUS_URL_ATTRIBUTES = ["href", "src", "xlink:href", "formaction"];
const MARKDOWN_SKIPPED_TAGS = new Set([
	"script",
	"style",
	"noscript",
	"iframe",
	"object",
	"embed",
	"meta",
	"link",
	"head",
]);

const MARKDOWN_CONTAINER_TAGS = new Set([
	"body",
	"main",
	"article",
	"section",
	"div",
	"aside",
	"header",
	"footer",
	"nav",
]);
const MARKDOWN_BLOCK_TAGS = new Set([
	...MARKDOWN_CONTAINER_TAGS,
	"address",
	"blockquote",
	"details",
	"dl",
	"figure",
	"figcaption",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"hr",
	"li",
	"ol",
	"p",
	"pre",
	"summary",
	"table",
	"tbody",
	"thead",
	"tfoot",
	"tr",
	"td",
	"th",
	"ul",
	"img",
]);
const FOOTNOTE_EXPORT_ROLE_VALUES = new Set([
	"doc-footnote",
	"doc-endnote",
	"doc-footnotes",
	"doc-endnotes",
]);
const FOOTNOTE_EXPORT_TYPE_VALUES = new Set([
	"footnote",
	"endnote",
	"endnotes",
	"rearnote",
	"rearnotes",
]);
const FOOTNOTE_EXPORT_KEYWORD_PATTERN =
	/(?:footnote|footnotes|endnote|endnotes|rearnote|rearnotes|backnote|backnotes|notes?)/i;

type TextQuote = {
	highlight?: string;
	before?: string;
	after?: string;
};

type TextNodeSegment = {
	node: Text;
	start: number;
	end: number;
	text: string;
};

type ResolvedFootnoteExportTarget = {
	href: string;
	section: SectionDescriptor;
	doc: Document;
	element: Element | null;
	text: string;
};

type SectionDescriptor = {
	index: number;
	href: string;
	title: string;
	linear: boolean;
	textLength: number;
	wordCount: number;
	positionCount: number;
	positionStart: number;
};

export interface FoliateSectionReadingMetrics {
	index: number;
	href: string;
	title: string;
	textLength: number;
	wordCount: number;
	positionCount: number;
	positionStart: number;
}

type LegacyStoredLocationPayload = {
	href?: string;
	locations?: {
		fragments?: string[];
		totalProgression?: number;
	};
	text?: {
		highlight?: string;
		before?: string;
		after?: string;
	};
};

type CompactReadiumLocation = {
	href: string;
	fragment?: string;
	text?: string;
};

type FoliateSection = {
	id?: string | number;
	cfi?: string;
	linear?: string;
	size?: number;
	load?: () => Promise<string> | string;
	createDocument?: () => Promise<Document>;
	resolveHref?: (href: string) => string;
};

type FoliateBook = {
	sections: FoliateSection[];
	toc?: unknown[];
	pageList?: unknown[];
	metadata?: Record<string, unknown>;
	rendition?: { layout?: string };
	dir?: string;
	transformTarget?: EventTarget;
	resolveCFI?: (cfi: string) => { index: number; anchor: (doc: Document) => unknown } | null;
	resolveHref: (
		href: string
	) =>
		| { index: number; anchor: (doc: Document) => unknown }
		| Promise<{ index: number; anchor: (doc: Document) => unknown } | null>
		| null;
	getCover?: () => Promise<Blob | null>;
	destroy?: () => void;
};

export interface FoliateLoadedPublication {
	filePath: string;
	fileName: string;
	book: FoliateBook;
	tocItems: TocItem[];
	coverImage?: string;
	metadata: {
		title: string;
		author: string;
		publisher?: string;
		language?: string;
		identifier?: string;
		isbn?: string;
		translator?: string;
		description?: string;
		publishDate?: string;
		subjects?: string[];
		series?: string;
		rights?: string;
		price?: string;
		wordCount?: number;
		chapterCount: number;
		isFixedLayout: boolean;
	};
	totalPositions: number;
}

export interface FoliateResolvedTarget {
	cfi: string | null;
	index: number;
	href: string;
	doc: Document | null;
	range: Range | null;
	textHint?: string;
}

export interface FoliateSectionReadingPointDraft {
	title: string;
	text: string;
	cfi: string;
	chapterIndex: number;
	chapterHref: string;
	markdown?: string;
	assets?: FoliateChapterExportAsset[];
}

export interface FoliateChapterExportAsset {
	placeholder: string;
	suggestedName: string;
	data: Uint8Array;
	mimeType: string;
	originalHref?: string;
}

type MarkdownExportContext = {
	baseHref: string;
	assets: FoliateChapterExportAsset[];
	assetBySource: Map<string, FoliateChapterExportAsset>;
};

export interface FoliatePublicationLoadOptions {
	/** IR 导入等场景只需目录，跳过章节正文扫描与封面提取。 */
	tocOnly?: boolean;
}

export class FoliateVaultPublicationParser {
	private readonly app: App;
	private archive: JSZip | null = null;
	private archiveEntryLookup = new Map<string, string>();
	private manifestMediaTypeByHref = new Map<string, string>();
	private packageDocumentPath = "";
	private currentBook: FoliateBook | null = null;
	private filePath = "";
	private fileName = "";
	private tocItems: TocItem[] = [];
	private tocSpineIndexByHref = new Map<string, number>();
	private sectionDescriptors: SectionDescriptor[] = [];
	private sectionTitleByHref = new Map<string, string>();
	private rawDocumentCache = new Map<string, Document>();
	private processedDocumentCache = new Map<string, Document>();
	/** Reader-aligned generic section DOM (from `section.load`, not `createDocument`). */
	private genericSectionDocumentCache = new Map<number, Document>();
	/** Serialize foliate `section.load()` so blob resources are not revoked mid-read. */
	private genericSectionLoadChain: Promise<void> = Promise.resolve();
	private metadata: FoliateLoadedPublication["metadata"] = {
		title: "",
		author: "",
		wordCount: 0,
		chapterCount: 0,
		isFixedLayout: false,
	};
	private totalPositions = 0;
	private transformCleanup: (() => void) | null = null;

	constructor(app: App) {
		this.app = app;
	}

	async load(
		filePath: string,
		options?: FoliatePublicationLoadOptions
	): Promise<FoliateLoadedPublication> {
		this.dispose();
		this.filePath = filePath;
		this.fileName = filePath.split("/").pop() || "book";

		const vaultFile = this.app.vault.getAbstractFileByPath(filePath);
		if (!(vaultFile instanceof TFile)) {
			throw new EpubError("file_not_found", `书籍文件不存在: ${filePath}`, { filePath });
		}

		const extension = getBookExtensionFromPath(filePath);
		if (extension === "epub") {
			const normalizedBinary = await readVaultBinaryData(this.app, vaultFile, filePath, {
				requireZipSignature: true,
				failureLabel: "EPUB",
			});
			try {
				this.archive = await JSZip.loadAsync(normalizedBinary, {
					checkCRC32: false,
				});
			} catch (error) {
				throw new EpubError(
					"invalid_archive",
					error instanceof Error ? error.message : `EPUB ZIP parse failed: ${filePath}`,
					{
						filePath,
						byteLength: normalizedBinary.byteLength,
					}
				);
			}
			this.rebuildArchiveEntryLookup();
			this.packageDocumentPath = await this.findPackageDocumentPath();
			await this.buildManifestMediaTypeLookup();

			const epubModule = (await import("foliate-js/epub.js")) as {
				EPUB?: new (loader: unknown) => {
					init(): Promise<FoliateBook>;
				};
			};
			const EPUB = epubModule.EPUB;
			if (!EPUB) {
				throw new Error("foliate-js EPUB constructor unavailable");
			}
			const loader = this.createFoliateLoader();
			this.currentBook = await new EPUB(loader).init();
		} else if (usesPlainTextBookAdapter(extension)) {
			this.archive = null;
			this.archiveEntryLookup.clear();
			this.manifestMediaTypeByHref.clear();
			this.packageDocumentPath = "";
			const text = await this.app.vault.read(vaultFile);
			this.currentBook = makePlainTextBook({
				fileName: vaultFile.name,
				text,
			}) as FoliateBook;
		} else if (usesFoliateGenericBookLoader(extension)) {
			this.archive = null;
			this.archiveEntryLookup.clear();
			this.manifestMediaTypeByHref.clear();
			this.packageDocumentPath = "";
			const normalizedBinary = await readVaultBinaryData(this.app, vaultFile, filePath, {
				requireZipSignature: false,
				failureLabel: "Book",
			});
			const file = new File([normalizedBinary], vaultFile.name, {
				type: this.getGenericPublicationMimeType(extension),
			});
			const viewModule = (await import("foliate-js/view.js")) as unknown as {
				makeBook: (input: File) => Promise<FoliateBook>;
			};
			this.currentBook = await viewModule.makeBook(file);
		} else {
			throw new EpubError("unknown", `暂不支持的书籍格式: ${filePath}`, { filePath });
		}

		this.attachHtmlTransformPipeline(this.currentBook);
		await this.buildMetadata();
		this.buildTocItems();
		if (options?.tocOnly) {
			return {
				filePath,
				fileName: this.fileName,
				book: this.currentBook,
				tocItems: this.tocItems,
				metadata: this.metadata,
				totalPositions: 0,
			};
		}
		await this.buildSectionDescriptors();
		void this.hydrateTocSpineIndices().catch((error) => {
			logger.warn("[FoliateVaultPublicationParser] Failed to hydrate TOC spine indices:", error);
		});
		// Accurate word counts / page positions are non-critical for first paint.
		void this.hydrateSectionDescriptorMetrics().catch((error) => {
			logger.warn("[FoliateVaultPublicationParser] Failed to hydrate section metrics:", error);
		});
		// TOC page numbers are non-critical for first paint; hydrate in the background.
		void this.hydrateTocPageNumbers().catch((error) => {
			logger.warn("[FoliateVaultPublicationParser] Failed to hydrate TOC page numbers:", error);
		});

		return {
			filePath,
			fileName: this.fileName,
			book: this.currentBook,
			tocItems: this.tocItems,
			coverImage: (await this.extractCoverDataUrl()) || undefined,
			metadata: this.metadata,
			totalPositions: this.totalPositions,
		};
	}

	getBook(): FoliateBook {
		if (!this.currentBook) {
			throw new Error("Foliate publication 尚未加载");
		}
		return this.currentBook;
	}

	getTocItems(): TocItem[] {
		return this.tocItems;
	}

	getMetadata(): FoliateLoadedPublication["metadata"] {
		return this.metadata;
	}

	getTotalPositions(): number {
		return this.totalPositions;
	}

	getTotalWordCount(): number {
		return this.metadata.wordCount || 0;
	}

	getSectionReadingMetrics(index: number): FoliateSectionReadingMetrics | null {
		const section = this.sectionDescriptors[index];
		if (!section) {
			return null;
		}
		return {
			index: section.index,
			href: section.href,
			title: section.title,
			textLength: section.textLength,
			wordCount: section.wordCount,
			positionCount: section.positionCount,
			positionStart: section.positionStart,
		};
	}

	isFixedLayout(): boolean {
		return this.metadata.isFixedLayout;
	}

	getSectionIndexForHref(href: string): number {
		const normalized = this.normalizeSectionHref(href);
		return this.sectionDescriptors.findIndex((section) => section.href === normalized);
	}

	getSectionTitleByHref(href: string): string {
		const normalized = this.normalizeSectionHref(href);
		return (
			this.sectionTitleByHref.get(normalized) ||
			this.sectionDescriptors.find((section) => section.href === normalized)?.title ||
			""
		);
	}

	getSectionTitleByIndex(index: number): string {
		return this.sectionDescriptors[index]?.title || "";
	}

	getSectionLocationLabelByIndex(
		index: number,
		format: EpubChapterLocationFormat = "leaf"
	): string {
		const href = this.getSectionHrefByIndex(index);
		return resolveChapterLocationLabel(
			this.tocItems,
			href,
			this.getSectionTitleByIndex(index),
			format,
			{
				sectionIndex: index,
				resolveSpineIndex: (tocHref) => this.resolveTocHrefSpineIndex(tocHref),
			}
		);
	}

	getSectionHrefByIndex(index: number): string {
		return this.sectionDescriptors[index]?.href || "";
	}

	resolveHrefAgainst(baseHref: string, rawHref: string): string {
		return this.normalizeInternalHref(baseHref, rawHref);
	}

	async getSectionReadingPointDraft(
		href: string,
		titleHint?: string
	): Promise<FoliateSectionReadingPointDraft | null> {
		const resolved = await this.resolveHrefTarget(href);
		if (!resolved?.doc) {
			return null;
		}

		const title = this.normalizeReadingPointTitle(
			titleHint ||
				this.getSectionTitleByHref(resolved.href) ||
				this.getSectionTitleByIndex(resolved.index) ||
				`章节 ${resolved.index + 1}`
		);
		const root = resolved.doc.body || resolved.doc.documentElement;
		const markdownExport = await this.buildSectionMarkdownExport(root, resolved.href, title);
		const extractedText = markdownExport.plainText || this.extractReadableSectionText(root);
		const text = this.stripLeadingSectionTitle(extractedText, title);
		if (!text) {
			return null;
		}

		return {
			title,
			text,
			cfi: resolved.cfi || this.getBaseSectionCfi(resolved.index),
			chapterIndex: resolved.index,
			chapterHref: resolved.href,
			markdown: markdownExport.markdown || text,
			assets: markdownExport.assets,
		};
	}

	async getTocReadingPointDraft(
		href: string,
		titleHint: string | undefined,
		flatTocItems: FlatTocExportItem[],
		itemIndex: number
	): Promise<FoliateSectionReadingPointDraft | null> {
		const resolved = await this.resolveHrefTarget(href, titleHint);
		if (!resolved?.doc) {
			return null;
		}

		const title = this.normalizeReadingPointTitle(
			titleHint ||
				this.getSectionTitleByHref(resolved.href) ||
				this.getSectionTitleByIndex(resolved.index) ||
				`章节 ${resolved.index + 1}`
		);
		const startElement = this.resolveTocExportStartElement(
			resolved.doc,
			href,
			titleHint,
			resolved.range
		);
		if (!startElement) {
			return null;
		}

		const endBoundary = resolveTocExportEndBoundary(flatTocItems, itemIndex);
		const endElement = endBoundary
			? this.resolveTocExportBoundaryElement(resolved.doc, endBoundary.href, endBoundary.label)
			: null;
		const scopedRoot = this.buildTocScopedExportRoot(resolved.doc, startElement, endElement);
		if (!scopedRoot) {
			return null;
		}

		const markdownExport = await this.buildSectionMarkdownExport(scopedRoot, resolved.href, title);
		const extractedText = markdownExport.plainText || this.extractReadableSectionText(scopedRoot);
		const text = this.stripLeadingSectionTitle(extractedText, title);
		if (!text) {
			return null;
		}

		return {
			title,
			text,
			cfi: resolved.cfi || this.getBaseSectionCfi(resolved.index),
			chapterIndex: resolved.index,
			chapterHref: href,
			markdown: markdownExport.markdown || text,
			assets: markdownExport.assets,
		};
	}

	async getBookFootnotesDraft(): Promise<EpubBookFootnotesDraft | null> {
		const entries: EpubBookFootnoteEntry[] = [];
		for (const section of this.sectionDescriptors) {
			const doc = await this.getRawDocumentByIndex(section.index);
			if (!doc) {
				continue;
			}
			entries.push(...(await this.extractFootnotesFromReferences(doc, section)));
			entries.push(...this.extractFootnotesFromDocument(doc, section));
		}
		const dedupedEntries = this.deduplicateFootnoteEntries(entries);
		if (dedupedEntries.length === 0) {
			return null;
		}
		const bookTitle = this.normalizeReadingPointTitle(
			this.metadata.title || stripSupportedBookExtension(this.fileName) || "EPUB 脚注"
		);
		return {
			title: `${bookTitle} - 全部脚注`,
			markdown: this.buildBookFootnotesMarkdown(dedupedEntries),
			footnotes: dedupedEntries,
		};
	}

	private async extractFootnotesFromReferences(
		doc: Document,
		section: SectionDescriptor
	): Promise<EpubBookFootnoteEntry[]> {
		const entries: EpubBookFootnoteEntry[] = [];
		for (const anchor of Array.from(doc.getElementsByTagName("a"))) {
			if (!this.isFootnoteReferenceAnchor(anchor, section.href)) {
				continue;
			}
			const entry = await this.buildFootnoteEntryFromReference(doc, anchor, section);
			if (entry) {
				entries.push(entry);
			}
		}
		return entries;
	}

	getSectionHrefForCfi(cfi: string): string | null {
		const index = this.getSectionIndexForCfi(cfi);
		return typeof index === "number" ? this.getSectionHrefByIndex(index) : null;
	}

	async getRawDocumentByHref(href: string): Promise<Document | null> {
		return this.loadRawDocumentByHref(href);
	}

	getSectionIndexForCfi(cfi: string): number | null {
		const resolved = this.resolveCfiTarget(cfi);
		return typeof resolved?.index === "number" ? resolved.index : null;
	}

	getLoadedFilePath(): string {
		return this.filePath;
	}

	getSectionEntryCfi(index: number): string {
		return this.wrapCfi(this.getBaseSectionCfi(index));
	}

	createCfiFromRange(index: number, range: Range): string {
		const baseCfi = this.getBaseSectionCfi(index);
		return EpubCfi.joinIndir(baseCfi, EpubCfi.fromRange(range));
	}

	async getRawDocumentByIndex(index: number): Promise<Document | null> {
		const href =
			this.sectionDescriptors[index]?.href ||
			this.getSectionIdentifier(this.getBook().sections[index]);
		return href ? this.loadRawDocumentByHref(href) : null;
	}

	async getProcessedDocumentByIndex(index: number): Promise<Document | null> {
		const href =
			this.sectionDescriptors[index]?.href ||
			this.getSectionIdentifier(this.getBook().sections[index]);
		return href ? this.loadProcessedDocumentByHref(href) : null;
	}

	async getProcessedDocumentByHref(href: string): Promise<Document | null> {
		return this.loadProcessedDocumentByHref(href);
	}

	findFragmentTargetInDocument(doc: Document, fragment: string): Element | null {
		return this.findFragmentTargetElement(doc, fragment);
	}

	async findFragmentTargetAcrossSections(
		fragment: string,
		preferredHrefs: string[] = []
	): Promise<{ index: number; href: string; doc: Document; element: Element } | null> {
		const normalizedFragment = String(fragment || "").trim();
		if (!normalizedFragment) {
			return null;
		}
		for (const index of this.buildFragmentSearchOrder(preferredHrefs)) {
			const href =
				this.getSectionHrefByIndex(index) || this.resolveSectionHref(this.getBook().sections[index]);
			if (!href) {
				continue;
			}
			const doc = await this.getRawDocumentByIndex(index);
			if (!doc) {
				continue;
			}
			const element = this.findFragmentTargetElement(doc, normalizedFragment);
			if (element) {
				return {
					index,
					href,
					doc,
					element,
				};
			}
		}
		return null;
	}

	private getSectionIdentifier(section: FoliateSection | undefined): string {
		return String(section?.id ?? "").trim();
	}

	private resolveSectionHref(section: FoliateSection | undefined): string {
		const sectionId = this.getSectionIdentifier(section);
		if (!sectionId) {
			return "";
		}
		if (!this.archive && /^\d+$/.test(sectionId)) {
			return "";
		}
		return this.normalizeInternalHref(this.packageDocumentPath || sectionId, sectionId);
	}

	private async resolveDescriptorHref(
		section: FoliateSection | undefined,
		index: number
	): Promise<string> {
		const directHref = this.resolveSectionHref(section);
		if (directHref) {
			return directHref;
		}
		return (await this.findTocHrefForSection(index)) || "";
	}

	resolveRangeInLoadedSection(
		target: string,
		doc: Document,
		sectionIndex: number,
		textHint?: string
	): Range | null {
		const normalizedTarget = this.normalizeLocationString(target);
		const currentHref = this.getSectionHrefByIndex(sectionIndex);
		const currentRoot = doc.body || doc.documentElement;
		const currentTextHint = textHint?.trim();

		if (this.isCfiLike(normalizedTarget)) {
			const resolved = this.resolveCfiTarget(normalizedTarget);
			if (resolved && resolved.index === sectionIndex) {
				const cfiRange = this.resolveAnchorAsRange(
					doc,
					this.executeResolvedAnchor(resolved.anchor, doc, normalizedTarget),
					currentRoot
				);
				if (cfiRange) {
					return cfiRange;
				}
			}
			if (currentTextHint) {
				return this.findRangeByTextQuote(currentRoot, { highlight: currentTextHint });
			}
			return null;
		}

		const legacyReadium = this.parseAnyLegacyReadiumLocation(normalizedTarget);
		if (legacyReadium) {
			const hrefTarget = this.buildHrefTargetFromReadiumLocation(legacyReadium);
			return this.resolveRangeInLoadedSection(
				hrefTarget,
				doc,
				sectionIndex,
				currentTextHint || legacyReadium.text
			);
		}

		if (!this.isDocumentHrefLike(normalizedTarget)) {
			return currentTextHint
				? this.findRangeByTextQuote(currentRoot, { highlight: currentTextHint })
				: null;
		}

		const normalizedHref = this.normalizeInternalHref(
			this.packageDocumentPath || currentHref,
			normalizedTarget
		);
		if (this.normalizeSectionHref(normalizedHref) !== currentHref) {
			return null;
		}

		if (currentTextHint) {
			const quoteRange = this.findRangeByTextQuote(currentRoot, { highlight: currentTextHint });
			if (quoteRange) {
				return quoteRange;
			}
		}

		const fragment = this.extractHrefFragment(normalizedHref);
		if (fragment) {
			return this.createRangeForFragment(doc, fragment);
		}

		return this.createDocumentStartRange(doc);
	}

	async resolveNavigationTarget(
		target: string,
		textHint?: string
	): Promise<FoliateResolvedTarget | null> {
		const normalizedTarget = this.normalizeLocationString(target);
		if (!normalizedTarget) {
			return null;
		}

		const legacyReadium = this.parseAnyLegacyReadiumLocation(normalizedTarget);
		if (legacyReadium) {
			const nextTextHint = textHint?.trim() || legacyReadium.text?.trim();
			return this.resolveHrefTarget(
				this.buildHrefTargetFromReadiumLocation(legacyReadium),
				nextTextHint || undefined
			);
		}

		if (this.isCfiLike(normalizedTarget)) {
			return this.resolveCfiNavigationTarget(normalizedTarget, textHint);
		}

		const resolvedHrefTarget = await this.resolveHrefTarget(normalizedTarget, textHint);
		if (resolvedHrefTarget) {
			return resolvedHrefTarget;
		}

		return null;
	}

	async canonicalizeLocation(value: string, textHint?: string): Promise<string | null> {
		const normalized = this.normalizeLocationString(value);
		if (!normalized) {
			return null;
		}

		if (this.isCfiLike(normalized)) {
			return (await this.resolveCfiNavigationTarget(this.wrapCfi(normalized), textHint))?.cfi || null;
		}

		const resolved = await this.resolveNavigationTarget(normalized, textHint);
		return resolved?.cfi || null;
	}

	async search(
		query: string
	): Promise<Array<{ cfi: string; excerpt: string; chapterTitle: string }>> {
		const needle = query.trim().toLowerCase();
		if (!needle) {
			return [];
		}

		const results: Array<{ cfi: string; excerpt: string; chapterTitle: string }> = [];
		for (const section of this.sectionDescriptors) {
			if (results.length >= MAX_SEARCH_RESULTS) {
				break;
			}
			const doc = await this.getRawDocumentByIndex(section.index);
			if (!doc) {
				continue;
			}
			const root = doc.body || doc.documentElement;
			const segments = this.collectTextSegments(root);
			if (segments.length === 0) {
				continue;
			}
			const combined = segments.map((segment) => segment.text).join("");
			let searchFrom = 0;
			while (searchFrom < combined.length && results.length < MAX_SEARCH_RESULTS) {
				const foundAt = combined.toLowerCase().indexOf(needle, searchFrom);
				if (foundAt < 0) {
					break;
				}
				const range = this.createRangeFromTextOffsets(
					doc,
					segments,
					foundAt,
					foundAt + needle.length
				);
				if (range) {
					results.push({
						cfi: this.createCfiFromRange(section.index, range),
						excerpt: this.buildSearchSnippet(combined, foundAt, needle.length),
						chapterTitle: section.title,
					});
				}
				searchFrom = foundAt + Math.max(needle.length, 1);
			}
		}
		return results;
	}

	async resolvePageNumber(cfi: string): Promise<number | undefined> {
		const resolved = await this.resolveNavigationTarget(cfi);
		if (!resolved) {
			return undefined;
		}
		return this.resolvePageNumberForResolvedTarget(resolved);
	}

	resolvePageNumberForResolvedTarget(resolved: FoliateResolvedTarget): number | undefined {
		return this.resolveResolvedTargetPageNumber(resolved);
	}

	async resolveCfiForPage(pageNumber: number): Promise<string | null> {
		if (this.sectionDescriptors.length === 0 || this.totalPositions <= 0) {
			return null;
		}

		const normalizedPage = this.clamp(Math.round(pageNumber), 1, this.totalPositions);
		const targetPosition = normalizedPage - 1;
		const section =
			this.sectionDescriptors.find(
				(item) =>
					targetPosition >= item.positionStart &&
					targetPosition < item.positionStart + item.positionCount
			) || this.sectionDescriptors[this.sectionDescriptors.length - 1];
		if (!section) {
			return null;
		}

		if (section.positionCount <= 1) {
			return this.getBaseSectionCfi(section.index);
		}

		const doc = await this.loadRawDocumentByHref(section.href);
		if (!doc) {
			return this.getBaseSectionCfi(section.index);
		}

		const root = doc.body || doc.documentElement;
		const segments = this.collectTextSegments(root);
		if (segments.length === 0) {
			return this.getBaseSectionCfi(section.index);
		}

		const totalLength = segments[segments.length - 1]?.end || 0;
		if (totalLength <= 0) {
			return this.getBaseSectionCfi(section.index);
		}

		const positionOffset = targetPosition - section.positionStart;
		const progression = positionOffset / Math.max(section.positionCount - 1, 1);
		const targetOffset = Math.round(progression * Math.max(totalLength - 1, 0));
		const range = this.createCollapsedRangeFromTextOffset(
			doc,
			segments,
			this.clamp(targetOffset, 0, Math.max(totalLength - 1, 0))
		);
		return this.createCanonicalCfiForRange(section.index, range, section.href);
	}

	private resolveResolvedTargetPageNumber(resolved: FoliateResolvedTarget): number | undefined {
		const section = this.sectionDescriptors[resolved.index];
		if (!section) {
			return undefined;
		}
		if (!resolved.range || !resolved.doc || section.positionCount <= 1) {
			return section.positionStart + 1;
		}
		const progression = this.computeProgressionForRange(resolved.doc, resolved.range);
		const positionOffset = Math.min(
			section.positionCount - 1,
			Math.max(0, Math.round(progression * Math.max(section.positionCount - 1, 0)))
		);
		return section.positionStart + positionOffset + 1;
	}

	private async hydrateTocPageNumbers(): Promise<void> {
		if (!this.currentBook || this.tocItems.length === 0 || this.sectionDescriptors.length === 0) {
			return;
		}

		await Promise.all(this.tocItems.map((item) => this.hydrateTocItemPageNumber(item)));
	}

	private async hydrateTocItemPageNumber(item: TocItem): Promise<void> {
		if (!this.currentBook) {
			return;
		}
		try {
			const pageNumber = await this.resolveHrefPageNumber(item.href);
			if (typeof pageNumber === "number" && Number.isFinite(pageNumber) && pageNumber > 0) {
				item.pageNumber = pageNumber;
			} else {
				item.pageNumber = undefined;
			}
		} catch (error) {
			// Background TOC hydration can race with parser disposal.
			if (!this.currentBook) {
				return;
			}
			throw error;
		}

		if (item.subitems?.length) {
			await Promise.all(item.subitems.map((child) => this.hydrateTocItemPageNumber(child)));
		}
	}

	private async resolveHrefPageNumber(href: string): Promise<number | undefined> {
		const resolved = await this.resolveHrefTarget(href);
		if (!resolved) {
			return undefined;
		}

		return this.resolveResolvedTargetPageNumber(resolved);
	}

	dispose(): void {
		this.transformCleanup?.();
		this.transformCleanup = null;
		this.currentBook?.destroy?.();
		this.currentBook = null;
		this.archive = null;
		this.archiveEntryLookup.clear();
		this.manifestMediaTypeByHref.clear();
		this.packageDocumentPath = "";
		this.filePath = "";
		this.fileName = "";
		this.tocItems = [];
		this.tocSpineIndexByHref.clear();
		this.sectionDescriptors = [];
		this.sectionTitleByHref.clear();
		this.rawDocumentCache.clear();
		this.processedDocumentCache.clear();
		this.genericSectionDocumentCache.clear();
		this.metadata = {
			title: "",
			author: "",
			chapterCount: 0,
			isFixedLayout: false,
		};
		this.totalPositions = 0;
	}

	private createFoliateLoader(): {
		loadText: (name: string) => Promise<string | null>;
		loadBlob: (name: string, type?: string) => Promise<Blob | null>;
		getSize: (name: string) => number;
	} {
		return {
			loadText: async (name: string) => {
				const normalizedHref = this.normalizeSectionHref(name);
				const entry = this.findArchiveEntry(normalizedHref);
				if (!entry) {
					return null;
				}
				const raw = await entry.async("text");
				const mediaType = this.inferMimeType(normalizedHref);
				if (
					this.isRewritableDocumentMediaType(mediaType) ||
					this.isDocumentHrefLike(normalizedHref)
				) {
					return this.repairMarkupText(raw, mediaType, normalizedHref);
				}
				return raw;
			},
			loadBlob: async (name: string, type?: string) => {
				const normalizedHref = this.normalizeSectionHref(name);
				const entry = this.findArchiveEntry(normalizedHref);
				if (!entry) {
					return null;
				}
				const bytes = await entry.async("uint8array");
				const normalizedBytes = new Uint8Array(bytes);
				return new Blob([normalizedBytes], { type: type || this.inferMimeType(normalizedHref) });
			},
			getSize: (name: string) => {
				const normalizedHref = this.normalizeSectionHref(name);
				const entry = this.findArchiveEntry(normalizedHref);
				return (
					(entry as { _data?: { uncompressedSize?: number } } | null)?._data?.uncompressedSize || 0
				);
			},
		};
	}

	private async findPackageDocumentPath(): Promise<string> {
		const containerEntry = this.findArchiveEntry("META-INF/container.xml");
		if (!containerEntry) {
			throw new EpubError("missing_container", "EPUB 缺少 META-INF/container.xml", {
				filePath: this.filePath,
			});
		}
		const raw = await containerEntry.async("text");
		const doc = this.parseMarkupDocument(raw, "application/xml", "META-INF/container.xml");
		const rootfile = doc.querySelector("rootfile");
		const fullPath = rootfile?.getAttribute("full-path")?.trim();
		if (!fullPath) {
			throw new EpubError("missing_package_document", "EPUB 缺少 package 文档路径", {
				filePath: this.filePath,
			});
		}
		return this.normalizePath(fullPath);
	}

	private async buildManifestMediaTypeLookup(): Promise<void> {
		this.manifestMediaTypeByHref.clear();
		if (!this.packageDocumentPath) {
			return;
		}

		const packageEntry = this.findArchiveEntry(this.packageDocumentPath);
		if (!packageEntry) {
			return;
		}

		const raw = await packageEntry.async("text");
		const doc = this.parseMarkupDocument(raw, "application/xml", this.packageDocumentPath);
		for (const item of Array.from(doc.getElementsByTagNameNS("*", "item"))) {
			const href = item.getAttribute("href")?.trim();
			const mediaType = item.getAttribute("media-type")?.trim().toLowerCase();
			if (!href || !mediaType) {
				continue;
			}

			const normalizedHref = this.normalizeSectionHref(
				this.normalizeInternalHref(this.packageDocumentPath, href)
			);
			if (!normalizedHref) {
				continue;
			}

			this.manifestMediaTypeByHref.set(normalizedHref, mediaType);
		}
	}

	private async buildMetadata(): Promise<void> {
		const book = this.getBook();
		const metadata = book.metadata ?? {};
		const packageMetadataDoc = await this.readPackageMetadataDocument();
		const identifier =
			this.readPackagePrimaryIdentifier(packageMetadataDoc) ||
			this.readFoliateMetadataValue(metadata.identifier) ||
			undefined;
		const isbn =
			this.extractIsbn(identifier) ||
			this.extractIsbn(this.readPackageMetadataFirstText(packageMetadataDoc, ["isbn"])) ||
			this.extractIsbn(this.readFoliateMetadataValue(metadata.isbn)) ||
			undefined;
		const subjects = this.readPackageMetadataTexts(packageMetadataDoc, ["subject"]);
		this.metadata = {
			title:
				this.readFoliateMetadataValue(metadata.title) || stripSupportedBookExtension(this.fileName),
			author:
				this.readFoliateMetadataValue(metadata.author) ||
				this.readFoliateMetadataValue(metadata.creator) ||
				"未知作者",
			publisher:
				this.readPackageMetadataFirstText(packageMetadataDoc, ["publisher"]) ||
				this.readFoliateMetadataValue(metadata.publisher) ||
				undefined,
			language:
				this.readPackageMetadataFirstText(packageMetadataDoc, ["language"]) ||
				this.readFoliateMetadataValue(metadata.language) ||
				undefined,
			identifier,
			isbn,
			translator:
				this.readPackageContributorByRole(packageMetadataDoc, new Set(["trl", "translator", "trans"])) ||
				this.readPackageMetadataFirstText(packageMetadataDoc, ["translator"]) ||
				this.readFoliateMetadataValue(metadata.translator) ||
				undefined,
			description:
				this.readPackageMetadataFirstText(packageMetadataDoc, ["description"]) ||
				this.readFoliateMetadataValue(metadata.description) ||
				undefined,
			publishDate:
				this.readPackageMetadataFirstText(packageMetadataDoc, ["date"]) ||
				this.readPackageMetaProperty(packageMetadataDoc, [
					"dcterms:issued",
					"schema:datePublished",
					"publication-date",
				]) ||
				this.readPackageMetaNameContent(packageMetadataDoc, ["pubdate", "date published"]) ||
				this.readFoliateMetadataValue(metadata.publishDate) ||
				undefined,
			subjects:
				subjects.length > 0
					? subjects
					: this.readFoliateMetadataValues(metadata.subject).slice(0, 12),
			series:
				this.readPackageMetaProperty(packageMetadataDoc, ["belongs-to-collection", "calibre:series"]) ||
				this.readPackageMetaNameContent(packageMetadataDoc, ["calibre:series", "series"]) ||
				this.readFoliateMetadataValue(metadata.series) ||
				undefined,
			rights:
				this.readPackageMetadataFirstText(packageMetadataDoc, ["rights"]) ||
				this.readFoliateMetadataValue(metadata.rights) ||
				undefined,
			price:
				this.readPackageMetaProperty(packageMetadataDoc, ["price", "schema:price"]) ||
				this.readPackageMetaNameContent(packageMetadataDoc, ["price", "calibre:price"]) ||
				this.readFoliateMetadataValue(metadata.price) ||
				undefined,
			chapterCount: book.sections.length,
			isFixedLayout: book.rendition?.layout === "pre-paginated",
		};
	}

	private buildTocItems(): void {
		const book = this.getBook();
		this.sectionTitleByHref.clear();
		const toc = Array.isArray(book.toc) ? book.toc : [];
		if (toc.length > 0) {
			this.tocItems = this.convertFoliateTocEntries(toc, 1);
			return;
		}
		this.tocItems = book.sections.map((section, index) => {
			const href = this.resolveSectionHref(section);
			const label = this.readableTitleFromHref(href) || `章节 ${index + 1}`;
			this.sectionTitleByHref.set(href, label);
			return {
				id: `${index}-${href}`,
				label,
				href,
				level: 1,
			};
		});
	}

	private convertFoliateTocEntries(entries: unknown[], level: number): TocItem[] {
		return entries
			.map((entry, index) => this.convertSingleFoliateTocEntry(entry, level, index))
			.filter((entry): entry is TocItem => Boolean(entry));
	}

	private convertSingleFoliateTocEntry(
		entry: unknown,
		level: number,
		index: number
	): TocItem | null {
		if (!entry || typeof entry !== "object") {
			return null;
		}
		const tocEntry = entry as Record<string, unknown>;
		const rawHref = this.readFoliateMetadataValue(tocEntry.href);
		if (!rawHref) {
			return null;
		}
		const href = this.normalizeInternalHref(this.packageDocumentPath || rawHref, rawHref);
		const label =
			this.readFoliateMetadataValue(tocEntry.label) ||
			this.readFoliateMetadataValue(tocEntry.title) ||
			this.readableTitleFromHref(href) ||
			`章节 ${index + 1}`;
		const sectionHref = this.normalizeSectionHref(href);
		if (sectionHref) {
			this.sectionTitleByHref.set(sectionHref, label);
		}
		const children = Array.isArray(tocEntry.subitems)
			? tocEntry.subitems
			: Array.isArray(tocEntry.children)
			? tocEntry.children
			: [];
		return {
			id: `${level}-${index}-${href}`,
			label,
			href,
			level,
			subitems:
				children.length > 0 ? this.convertFoliateTocEntries(children, level + 1) : undefined,
		};
	}

	private async buildSectionDescriptors(): Promise<void> {
		const sections = this.getBook().sections;
		this.sectionDescriptors = [];
		let positionStart = 0;
		let totalWordCount = 0;
		for (const [index, section] of sections.entries()) {
			const href = await this.resolveDescriptorHref(section, index);
			const textLength = this.estimateSectionTextLength(section, href);
			const wordCount = this.estimateWordCountFromTextLength(textLength);
			const title =
				this.getSectionTitleByHref(href) || this.readableTitleFromHref(href) || `章节 ${index + 1}`;
			this.sectionTitleByHref.set(href, title);
			const positionCount = this.metadata.isFixedLayout
				? 1
				: Math.max(1, Math.ceil(Math.max(textLength, 1) / POSITION_CHAR_BUCKET));
			this.sectionDescriptors.push({
				index,
				href,
				title,
				linear: (section.linear || "yes").toLowerCase() !== "no",
				textLength,
				wordCount,
				positionCount,
				positionStart,
			});
			positionStart += positionCount;
			totalWordCount += wordCount;
		}
		this.totalPositions = positionStart;
		this.metadata.wordCount = totalWordCount;
		this.metadata.chapterCount = this.sectionDescriptors.length;
	}

	private estimateSectionTextLength(section: FoliateSection | undefined, href: string): number {
		const byteSize = this.resolveSectionByteSize(section, href);
		if (byteSize > 0) {
			return this.estimateTextLengthFromByteSize(byteSize);
		}
		return 0;
	}

	private resolveSectionByteSize(section: FoliateSection | undefined, href: string): number {
		const normalizedHref = this.normalizeSectionHref(href);
		if (normalizedHref && this.archive) {
			const entry = this.findArchiveEntry(normalizedHref);
			const archiveSize = (entry as { _data?: { uncompressedSize?: number } } | null)?._data
				?.uncompressedSize;
			if (typeof archiveSize === "number" && archiveSize > 0) {
				return archiveSize;
			}
		}

		const sectionSize = section?.size;
		return typeof sectionSize === "number" && sectionSize > 0 ? sectionSize : 0;
	}

	private estimateTextLengthFromByteSize(byteSize: number): number {
		// HTML / XML markup inflates byte size; this is only for pagination estimates.
		return Math.max(0, Math.round(byteSize * 0.45));
	}

	private estimateWordCountFromTextLength(textLength: number): number {
		const normalizedLength = Math.max(0, Math.round(textLength));
		if (normalizedLength <= 0) {
			return 0;
		}
		return Math.max(1, Math.round(normalizedLength / 2.5));
	}

	private async hydrateSectionDescriptorMetrics(): Promise<void> {
		if (!this.currentBook || this.sectionDescriptors.length === 0) {
			return;
		}

		let totalWordCount = 0;
		let positionStart = 0;
		for (const descriptor of this.sectionDescriptors) {
			if (!this.currentBook) {
				return;
			}

			const doc = await this.getRawDocumentByHref(descriptor.href);
			const textLength = this.extractReadableSectionText(
				doc?.body || doc?.documentElement || null
			).length;
			const wordCount = this.estimateWordCount(
				this.extractReadableSectionText(doc?.body || doc?.documentElement || null)
			);
			descriptor.textLength = textLength;
			descriptor.wordCount = wordCount;
			descriptor.positionCount = this.metadata.isFixedLayout
				? 1
				: Math.max(1, Math.ceil(Math.max(textLength, 1) / POSITION_CHAR_BUCKET));
			descriptor.positionStart = positionStart;
			positionStart += descriptor.positionCount;
			totalWordCount += wordCount;
		}

		if (!this.currentBook) {
			return;
		}

		this.totalPositions = positionStart;
		this.metadata.wordCount = totalWordCount;
	}

	private estimateWordCount(text: string): number {
		const normalized = String(text || "").trim();
		if (!normalized) {
			return 0;
		}
		const latinWords = normalized.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length || 0;
		const cjkUnits =
			normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)
				?.length || 0;
		return latinWords + cjkUnits;
	}

	private async extractCoverDataUrl(): Promise<string | null> {
		try {
			const coverBlob = await this.getBook().getCover?.();
			return coverBlob ? await this.blobToDataUrl(coverBlob) : null;
		} catch (error) {
			logger.warn("[FoliateVaultPublicationParser] Failed to extract cover image:", error);
			return null;
		}
	}

	private async resolveCfiNavigationTarget(
		cfi: string,
		textHint?: string
	): Promise<FoliateResolvedTarget | null> {
		const resolved = this.resolveCfiTarget(cfi);
		if (!resolved) {
			return null;
		}
		const doc = await this.getRawDocumentByIndex(resolved.index);
		const root = doc?.body || doc?.documentElement || null;
		const normalizedTextHint = textHint?.trim();
		let range = doc
			? this.resolveAnchorAsRange(doc, this.executeResolvedAnchor(resolved.anchor, doc, cfi), root)
			: null;
		if (!range && doc && root && normalizedTextHint) {
			range = this.findRangeByTextQuote(root, { highlight: normalizedTextHint });
		}
		if (!range && doc) {
			range = this.createDocumentStartRange(doc);
		}
		return {
			cfi: this.createCanonicalCfiForRange(
				resolved.index,
				range,
				this.getSectionHrefByIndex(resolved.index)
			),
			index: resolved.index,
			href: this.getSectionHrefByIndex(resolved.index),
			doc,
			range,
			textHint: normalizedTextHint || undefined,
		};
	}

	private async resolveHrefTarget(
		href: string,
		textHint?: string
	): Promise<FoliateResolvedTarget | null> {
		const normalizedHref = this.normalizeInternalHref(this.packageDocumentPath || href, href);
		const resolved = await Promise.resolve(this.getBook().resolveHref(normalizedHref));
		if (!resolved || typeof resolved.index !== "number") {
			return null;
		}
		const doc = await this.getRawDocumentByIndex(resolved.index);
		const root = doc?.body || doc?.documentElement || null;
		let range =
			doc && textHint?.trim()
				? this.findRangeByTextQuote(root, { highlight: textHint.trim() })
				: null;
		if (!range && doc) {
			range = this.resolveAnchorAsRange(
				doc,
				this.executeResolvedAnchor(resolved.anchor, doc, normalizedHref),
				root
			);
		}
		if (!range && doc) {
			const fragment = this.extractHrefFragment(normalizedHref);
			range = fragment ? this.createRangeForFragment(doc, fragment) : null;
		}
		if (!range && doc) {
			range = this.createDocumentStartRange(doc);
		}
		return {
			cfi: this.createCanonicalCfiForRange(resolved.index, range, normalizedHref),
			index: resolved.index,
			href: this.getSectionHrefByIndex(resolved.index) || normalizedHref,
			doc,
			range,
			textHint: textHint?.trim() || undefined,
		};
	}

	private resolveCfiTarget(
		cfi: string
	): { index: number; anchor: (doc: Document) => unknown } | null {
		try {
			const wrapped = this.wrapCfi(cfi);
			const resolved = this.getBook().resolveCFI?.(wrapped);
			if (resolved) {
				return resolved;
			}

			const parsed = EpubCfi.parse(wrapped);
			const indexedByPrefix = this.findSectionIndexFromCfiPrefix(wrapped);
			if (indexedByPrefix !== null) {
				return {
					index: indexedByPrefix,
					anchor: (doc: Document): Range | null => {
						try {
							return EpubCfi.toRange(doc, parsed);
						} catch {
							return null;
						}
					},
				};
			}
			const parentPath = EpubCfi.getCfiParentPath(parsed);
			const sectionPart = parentPath.shift();
			const index = EpubCfi.fake.toIndex(sectionPart);
			if (typeof index !== "number" || index < 0) {
				return null;
			}
			return {
				index,
				anchor: (doc: Document): Range | null => {
					const rangeUnknown: unknown = EpubCfi.toRange(doc, parsed);
					return rangeUnknown instanceof Range ? rangeUnknown : null;
				},
			};
		} catch (error) {
			logger.debugWithTag("FoliateVaultPublicationParser", "Failed to resolve CFI target", {
				cfi,
				error,
			});
			return null;
		}
	}

	private findSectionIndexFromCfiPrefix(cfi: string): number | null {
		let bestMatchIndex: number | null = null;
		let bestMatchLength = -1;
		for (const section of this.getBook().sections.map((_, index) => ({
			index,
			cfi: this.getBaseSectionCfi(index),
		}))) {
			const baseCfi = this.wrapCfi(section.cfi);
			if (!baseCfi) {
				continue;
			}
			const normalizedBase = baseCfi.endsWith(")") ? baseCfi.slice(0, -1) : baseCfi;
			const matches =
				cfi === baseCfi ||
				cfi.startsWith(`${normalizedBase}!)`) ||
				cfi.startsWith(`${normalizedBase}!`) ||
				cfi.startsWith(normalizedBase);
			if (matches && normalizedBase.length > bestMatchLength) {
				bestMatchIndex = section.index;
				bestMatchLength = normalizedBase.length;
			}
		}
		return bestMatchIndex;
	}

	private getBaseSectionCfi(index: number): string {
		const sectionCfi = this.getBook().sections[index]?.cfi;
		if (typeof sectionCfi === "string" && sectionCfi.trim()) {
			return sectionCfi;
		}
		const fakeCfiUnknown: unknown = EpubCfi.fake.fromIndex(index);
		return typeof fakeCfiUnknown === "string" ? fakeCfiUnknown : unknownPlainText(fakeCfiUnknown);
	}

	private resolveAnchorAsRange(
		doc: Document,
		anchor: unknown,
		_scopeRoot: Element | null
	): Range | null {
		if (anchor instanceof Range) {
			return anchor;
		}
		if (domInstanceOf(anchor, Node)) {
			return this.createRangeForNode(anchor);
		}
		return null;
	}

	private executeResolvedAnchor(
		anchorResolver: ((doc: Document) => unknown) | undefined,
		doc: Document,
		target: string
	): unknown {
		if (typeof anchorResolver !== "function") {
			return null;
		}
		try {
			return anchorResolver(doc);
		} catch (error) {
			logger.debugWithTag(
				"FoliateVaultPublicationParser",
				"Failed to execute EPUB anchor resolver",
				{
					target,
					error,
				}
			);
			return null;
		}
	}

	private createCanonicalCfiForRange(
		index: number,
		range: Range | null,
		fallbackHref?: string
	): string {
		if (!this.supportsEpubCfiNavigation()) {
			return fallbackHref || this.getSectionHrefByIndex(index);
		}
		if (!range) {
			return this.getBaseSectionCfi(index);
		}
		try {
			return this.createCfiFromRange(index, range);
		} catch (error) {
			logger.debugWithTag(
				"FoliateVaultPublicationParser",
				"Failed to canonicalize EPUB range back to CFI",
				{
					index,
					error,
				}
			);
			return this.getBaseSectionCfi(index);
		}
	}

	private supportsEpubCfiNavigation(): boolean {
		return (this.currentBook?.sections.length || 0) > 0;
	}

	private async findTocHrefForSection(targetIndex: number): Promise<string> {
		for (const href of this.collectTocHrefs(this.tocItems)) {
			try {
				const resolved = await Promise.resolve(this.getBook().resolveHref(href));
				if (resolved?.index === targetIndex) {
					return this.normalizeInternalHref(this.packageDocumentPath || href, href);
				}
			} catch {
				/* ignore */
			}
		}
		return "";
	}

	private async hydrateTocSpineIndices(): Promise<void> {
		for (const href of this.collectTocHrefs(this.tocItems)) {
			const normalized = this.normalizeInternalHref(this.packageDocumentPath || href, href);
			if (this.tocSpineIndexByHref.has(href) || this.tocSpineIndexByHref.has(normalized)) {
				continue;
			}
			try {
				const resolved = await Promise.resolve(this.getBook().resolveHref(normalized));
				if (typeof resolved?.index === "number" && resolved.index >= 0) {
					this.cacheTocSpineIndex(href, resolved.index);
					this.cacheTocSpineIndex(normalized, resolved.index);
				}
			} catch {
				/* ignore */
			}
		}
	}

	private cacheTocSpineIndex(href: string, index: number): void {
		const trimmed = String(href || "").trim();
		if (!trimmed) {
			return;
		}
		this.tocSpineIndexByHref.set(trimmed, index);
	}

	private hrefBasenameWithoutExtension(href: string): string {
		const basename = tocHrefBasename(href);
		return basename.replace(/\.[^.]+$/, "");
	}

	private resolveTocHrefSpineIndex(href: string): number {
		const trimmed = String(href || "").trim();
		if (!trimmed) {
			return -1;
		}

		const cached = this.tocSpineIndexByHref.get(trimmed);
		if (cached !== undefined) {
			return cached;
		}

		const normalized = this.normalizeInternalHref(this.packageDocumentPath || trimmed, trimmed);
		const cachedNormalized = this.tocSpineIndexByHref.get(normalized);
		if (cachedNormalized !== undefined) {
			return cachedNormalized;
		}

		const exactIndex = this.getSectionIndexForHref(normalized);
		if (exactIndex >= 0) {
			this.cacheTocSpineIndex(trimmed, exactIndex);
			this.cacheTocSpineIndex(normalized, exactIndex);
			return exactIndex;
		}

		const tocParentBasename =
			getSplitSectionParentBasename(normalized) || this.hrefBasenameWithoutExtension(normalized);
		for (const section of this.sectionDescriptors) {
			const sectionBasename = this.hrefBasenameWithoutExtension(section.href);
			if (sectionBasename === tocParentBasename) {
				this.cacheTocSpineIndex(trimmed, section.index);
				this.cacheTocSpineIndex(normalized, section.index);
				return section.index;
			}
			const splitParent = getSplitSectionParentBasename(section.href);
			if (splitParent && splitParent === tocParentBasename) {
				this.cacheTocSpineIndex(trimmed, section.index);
				this.cacheTocSpineIndex(normalized, section.index);
				return section.index;
			}
		}

		const tocBasename = tocHrefBasename(normalized);
		for (const section of this.sectionDescriptors) {
			if (tocHrefBasename(section.href) === tocBasename) {
				this.cacheTocSpineIndex(trimmed, section.index);
				this.cacheTocSpineIndex(normalized, section.index);
				return section.index;
			}
		}

		return -1;
	}

	private collectTocHrefs(items: TocItem[]): string[] {
		const results: string[] = [];
		const visit = (entries: TocItem[]) => {
			for (const entry of entries) {
				if (entry.href) {
					results.push(entry.href);
				}
				if (entry.subitems?.length) {
					visit(entry.subitems);
				}
			}
		};
		visit(items);
		return Array.from(new Set(results));
	}

	private async loadRawDocumentByHref(href: string): Promise<Document | null> {
		const normalizedHref = this.normalizeSectionHref(href);
		if (!normalizedHref) {
			return null;
		}
		if (this.rawDocumentCache.has(normalizedHref)) {
			return this.rawDocumentCache.get(normalizedHref) || null;
		}
		if (!this.archive) {
			const sectionIndex = this.getSectionIndexForHref(normalizedHref);
			if (sectionIndex < 0) {
				return null;
			}
			const doc = await this.getRawDocumentFromGenericSection(sectionIndex);
			if (doc) {
				this.rawDocumentCache.set(normalizedHref, doc);
			}
			return doc;
		}
		const entry = this.findArchiveEntry(normalizedHref);
		if (!entry) {
			return null;
		}
		const raw = await entry.async("text");
		const mediaType = this.inferMimeType(normalizedHref);
		const repaired = this.isRewritableDocumentMediaType(mediaType)
			? this.repairMarkupText(raw, mediaType, normalizedHref)
			: raw;
		const doc = this.parseMarkupDocument(
			repaired,
			this.getMarkupParserType(mediaType),
			normalizedHref,
			true
		);
		this.rawDocumentCache.set(normalizedHref, doc);
		return doc;
	}

	private async loadProcessedDocumentByHref(href: string): Promise<Document | null> {
		const normalizedHref = this.normalizeSectionHref(href);
		if (!normalizedHref) {
			return null;
		}
		if (this.processedDocumentCache.has(normalizedHref)) {
			return this.processedDocumentCache.get(normalizedHref) || null;
		}
		if (!this.archive) {
			const sectionIndex = this.getSectionIndexForHref(normalizedHref);
			if (sectionIndex < 0) {
				return null;
			}
			const doc = await this.getRawDocumentFromGenericSection(sectionIndex);
			if (doc) {
				this.processedDocumentCache.set(normalizedHref, doc);
			}
			return doc;
		}
		const entry = this.findArchiveEntry(normalizedHref);
		if (!entry) {
			return null;
		}
		const raw = await entry.async("text");
		const mediaType = this.inferMimeType(normalizedHref);
		const repaired = this.isRewritableDocumentMediaType(mediaType)
			? this.repairMarkupText(raw, mediaType, normalizedHref)
			: raw;
		let markup = repaired;
		try {
			markup = await this.inlineFoliateBlobStylesheets(repaired, mediaType);
		} catch (error) {
			logger.warn("[FoliateVaultPublicationParser] Failed to process section markup:", {
				href: normalizedHref,
				error,
			});
		}
		const doc = this.parseMarkupDocument(
			markup,
			this.getMarkupParserType(mediaType),
			normalizedHref,
			true
		);
		this.processedDocumentCache.set(normalizedHref, doc);
		return doc;
	}

	private async getRawDocumentFromGenericSection(index: number): Promise<Document | null> {
		const section = this.getBook().sections[index];
		if (!section) {
			return null;
		}
		return this.loadReaderAlignedGenericSectionDocument(section, index);
	}

	/**
	 * MOBI/AZW3 sections expose both `createDocument()` (skeleton HTML) and `load()`
	 * (reader HTML with resources inlined). Locators must use the same DOM as foliate's iframe.
	 */
	private async loadReaderAlignedGenericSectionDocument(
		section: FoliateSection,
		index: number
	): Promise<Document | null> {
		if (this.genericSectionDocumentCache.has(index)) {
			return this.genericSectionDocumentCache.get(index) || null;
		}

		let doc: Document | null = null;
		if (typeof section.load === "function") {
			try {
				const loaded = await this.withGenericSectionLoadLock(() => section.load!());
				const url = String(loaded || "").trim();
				if (url) {
					const markup = await this.fetchMarkupFromSectionLoadUrl(url);
					if (markup) {
						await prefetchBlobUrlsFromText(markup);
						let transformed = markup;
						try {
							transformed = await this.inlineFoliateBlobStylesheets(
								markup,
								"application/xhtml+xml"
							);
						} catch (error) {
							logger.warn(
								"[FoliateVaultPublicationParser] Failed to transform reader-aligned generic section:",
								{ index, error }
							);
						}
						doc = this.parseGenericSectionMarkup(transformed);
					}
				}
			} catch (error) {
				logger.warn(
					"[FoliateVaultPublicationParser] Failed to load reader-aligned generic section:",
					{ index, error }
				);
			}
		}

		if (!doc && typeof section.createDocument === "function") {
			doc = await section.createDocument();
		}

		if (doc) {
			this.genericSectionDocumentCache.set(index, doc);
		}
		return doc;
	}

	private async withGenericSectionLoadLock<T>(task: () => Promise<T> | T): Promise<T> {
		const run = this.genericSectionLoadChain.then(() => task());
		this.genericSectionLoadChain = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	}

	private async fetchMarkupFromSectionLoadUrl(url: string): Promise<string> {
		if (!url.startsWith("blob:")) {
			throw new Error(`Unsupported generic section load URL: ${url}`);
		}
		return readBlobUrlAsText(url);
	}

	private parseGenericSectionMarkup(markup: string): Document {
		let doc = this.parseMarkupDocument(
			markup,
			this.getMarkupParserType("application/xhtml+xml"),
			"foliate-generic-section",
			true
		);
		if (doc.querySelector("parsererror") || !doc.documentElement?.namespaceURI) {
			doc = this.parseMarkupDocument(markup, "text/html", "foliate-generic-section", true);
		}
		return doc;
	}

	private attachHtmlTransformPipeline(book: FoliateBook): void {
		const target = book.transformTarget;
		if (!target) {
			return;
		}
		const listener = (event: Event) => {
			const detail = (event as CustomEvent<{ data?: Promise<string> | string; type?: string }>)
				.detail;
			if (!detail?.data) {
				return;
			}
			const mimeType = String(detail.type || "").toLowerCase();
			if (!mimeType.includes("html") && !mimeType.includes("svg") && !mimeType.includes("xml")) {
				return;
			}
			detail.data = Promise.resolve(detail.data)
				.then(async (rawMarkup) => {
					if (typeof rawMarkup !== "string") {
						return rawMarkup;
					}
					await prefetchBlobUrlsFromText(rawMarkup);
					return this.inlineFoliateBlobStylesheets(rawMarkup, mimeType);
				})
				.catch((error) => {
					logger.warn(
						"[FoliateVaultPublicationParser] Failed to transform foliate HTML payload:",
						error
					);
					return "";
				});
		};
		target.addEventListener("data", listener as EventListener);
		this.transformCleanup = () => target.removeEventListener("data", listener as EventListener);
	}

	private async inlineFoliateBlobStylesheets(markup: string, mediaType: string): Promise<string> {
		return inlineFoliateBlobMarkup(markup, mediaType);
	}

	private isRemoteResourceUrl(value: string): boolean {
		return REMOTE_RESOURCE_URL_PATTERN.test(String(value || "").trim());
	}

	private async readBinaryResource(
		href: string
	): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
		try {
			if (isBlobResourceUrl(href)) {
				return await readBlobUrlAsArrayBuffer(href);
			}
			return await readBinaryResourceViaFetch(href);
		} catch (error) {
			if (!isBlobResourceUrl(href)) {
				logger.warn(
					"[FoliateVaultPublicationParser] Failed to read transformed binary resource:",
					{
						href,
						error,
					}
				);
			}
			return null;
		}
	}

	private parseAnyLegacyReadiumLocation(value: string): CompactReadiumLocation | null {
		const normalized = this.normalizeLocationString(value);
		if (!normalized.startsWith("readium:")) {
			return null;
		}
		const compact = this.parseCompactReadiumLocation(normalized);
		if (compact) {
			return compact;
		}
		const payload = this.parseLegacyStoredLocation(normalized);
		if (!payload?.href) {
			return null;
		}
		return {
			href: this.buildLegacyHrefTarget(payload),
			text: payload.text?.highlight,
		};
	}

	private parseCompactReadiumLocation(value: string): CompactReadiumLocation | null {
		const raw = value.startsWith("readium:") ? value.slice("readium:".length) : value;
		if (!raw.startsWith(`${COMPACT_READIUM_MARKER}${COMPACT_READIUM_SEPARATOR}`)) {
			return null;
		}
		const parts = raw.split(COMPACT_READIUM_SEPARATOR);
		if (parts[0] !== COMPACT_READIUM_MARKER || parts.length < 2) {
			return null;
		}
		const href = this.decodeCompactField(parts[1]);
		if (!href) {
			return null;
		}
		const fragment = this.decodeCompactField(parts[3]);
		const text = this.decodeCompactField(parts[5]);
		return { href, fragment, text };
	}

	private decodeCompactField(value?: string): string | undefined {
		if (!value) {
			return undefined;
		}
		try {
			const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
			const paddingLength = (4 - (normalized.length % 4)) % 4;
			const binary = atob(`${normalized}${"=".repeat(paddingLength)}`);
			const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
			return new TextDecoder().decode(bytes);
		} catch {
			return undefined;
		}
	}

	private parseLegacyStoredLocation(value: string): LegacyStoredLocationPayload | null {
		try {
			return JSON.parse(
				decodeURIComponent(value.slice("readium:".length))
			) as LegacyStoredLocationPayload;
		} catch {
			return null;
		}
	}

	private buildLegacyHrefTarget(payload: LegacyStoredLocationPayload): string {
		const href = payload.href || "";
		const fragment = payload.locations?.fragments?.find(Boolean);
		if (fragment && href && !href.includes("#")) {
			return `${href}#${fragment}`;
		}
		return href;
	}

	private buildHrefTargetFromReadiumLocation(location: CompactReadiumLocation): string {
		if (location.fragment && !location.href.includes("#")) {
			return `${location.href}#${location.fragment}`;
		}
		return location.href;
	}

	private stripCfiAssertions(value: string): string {
		return String(value || "").replace(/\[(?:[^\]])*]/g, "");
	}

	private wrapCfi(value: string): string {
		const normalizedValue = this.stripCfiAssertions(this.normalizeLocationString(value));
		return EpubCfi.isCFI.test(normalizedValue) ? normalizedValue : `epubcfi(${normalizedValue})`;
	}

	private isCfiLike(value: string): boolean {
		const normalized = this.normalizeLocationString(value);
		return normalized.startsWith("epubcfi(") || /^\/\d+/.test(normalized);
	}

	private findRangeByTextQuote(root: Element | null, text: TextQuote): Range | null {
		if (!root) {
			return null;
		}
		const highlight = text.highlight?.trim();
		if (!highlight) {
			return null;
		}
		const segments = this.collectTextSegments(root);
		if (segments.length === 0) {
			return null;
		}
		const combined = segments.map((segment) => segment.text).join("");
		const needles = this.buildTextQuoteNeedles(highlight);
		let bestIndex = -1;
		let bestLength = 0;
		let bestScore = -Infinity;
		for (const needle of needles) {
			let searchFrom = 0;
			while (searchFrom <= combined.length) {
				const foundAt = combined.indexOf(needle, searchFrom);
				if (foundAt < 0) {
					break;
				}
				const score = this.scoreTextQuoteCandidate(
					combined,
					foundAt,
					needle.length,
					text.before,
					text.after
				);
				if (score > bestScore) {
					bestScore = score;
					bestIndex = foundAt;
					bestLength = needle.length;
				}
				searchFrom = foundAt + Math.max(needle.length, 1);
			}
		}

		if (bestIndex < 0) {
			const normalizedMatch = this.findRangeByNormalizedTextQuote(
				root.ownerDocument,
				segments,
				combined,
				highlight
			);
			if (normalizedMatch) {
				return normalizedMatch;
			}
			return null;
		}
		return this.createRangeFromTextOffsets(
			root.ownerDocument,
			segments,
			bestIndex,
			bestIndex + bestLength
		);
	}

	private buildTextQuoteNeedles(highlight: string): string[] {
		const trimmed = String(highlight || "").trim();
		if (!trimmed) {
			return [];
		}
		const needles = new Set<string>();
		const push = (value: string) => {
			const normalized = String(value || "").trim();
			if (normalized.length >= 4) {
				needles.add(normalized);
			}
		};

		push(trimmed);
		push(trimmed.replace(/[\u201c\u201d\u2018\u2019「」『』]/g, '"'));
		push(trimmed.replace(/[•·・]/g, ""));
		push(trimmed.replace(/\s+/g, " "));
		if (trimmed.length > 24) {
			push(trimmed.slice(0, 24));
		}
		if (trimmed.length > 12) {
			push(trimmed.slice(0, 12));
		}
		return Array.from(needles);
	}

	private normalizeTextForQuoteSearch(value: string): string {
		return String(value || "")
			.replace(/[\u201c\u201d\u2018\u2019「」『』""'']/g, "")
			.replace(/[•·・]/g, "")
			.replace(/\s+/g, "")
			.trim()
			.toLowerCase();
	}

	private findRangeByNormalizedTextQuote(
		doc: Document | null,
		segments: TextNodeSegment[],
		combined: string,
		highlight: string
	): Range | null {
		if (!doc) {
			return null;
		}
		const normalizedHighlight = this.normalizeTextForQuoteSearch(highlight);
		if (normalizedHighlight.length < 4) {
			return null;
		}

		const normalizedCombined: string[] = [];
		const indexMap: number[] = [];
		for (let i = 0; i < combined.length; i++) {
			const mapped = this.normalizeTextForQuoteSearch(combined[i] || "");
			if (!mapped) {
				continue;
			}
			normalizedCombined.push(mapped);
			indexMap.push(i);
		}
		const normalizedText = normalizedCombined.join("");
		const needles = [
			normalizedHighlight,
			normalizedHighlight.length > 24 ? normalizedHighlight.slice(0, 24) : "",
			normalizedHighlight.length > 12 ? normalizedHighlight.slice(0, 12) : "",
		].filter((needle) => needle.length >= 4);

		for (const needle of needles) {
			const foundAt = normalizedText.indexOf(needle);
			if (foundAt < 0) {
				continue;
			}
			const start = indexMap[foundAt];
			const end = indexMap[foundAt + needle.length - 1];
			if (typeof start !== "number" || typeof end !== "number") {
				continue;
			}
			return this.createRangeFromTextOffsets(doc, segments, start, end + 1);
		}

		return null;
	}

	private scoreTextQuoteCandidate(
		combined: string,
		index: number,
		highlightLength: number,
		before?: string,
		after?: string
	): number {
		let score = 0;
		if (before) {
			const actualBefore = combined.slice(Math.max(0, index - before.length), index);
			if (actualBefore === before) {
				score += before.length + 10;
			}
		}
		if (after) {
			const actualAfter = combined.slice(
				index + highlightLength,
				index + highlightLength + after.length
			);
			if (actualAfter === after) {
				score += after.length + 10;
			}
		}
		if (!before && !after) {
			score += 1;
		}
		return score;
	}

	private findFragmentTargetElement(doc: Document, fragment: string): Element | null {
		const normalizedFragment = String(fragment || "").trim();
		if (!normalizedFragment) {
			return null;
		}

		const byId = doc.getElementById(normalizedFragment);
		if (byId) {
			return byId;
		}

		try {
			const bySelector = doc.querySelector(
				`[id="${CSS.escape(normalizedFragment)}"],[name="${CSS.escape(normalizedFragment)}"]`
			);
			if (bySelector) {
				return bySelector;
			}
		} catch {
			/* ignore */
		}

		for (const element of Array.from(doc.getElementsByTagName("*"))) {
			if (
				element.getAttribute("xml:id") === normalizedFragment ||
				element.getAttributeNS("http://www.w3.org/XML/1998/namespace", "id") === normalizedFragment
			) {
				return element;
			}
		}

		return null;
	}

	private createRangeForFragment(doc: Document, fragment: string): Range | null {
		const target = this.findFragmentTargetElement(doc, fragment);
		return this.createRangeForNode(target);
	}

	private createRangeForNode(node: Element | Node | null | undefined): Range | null {
		if (!node?.ownerDocument) {
			return null;
		}
		if (node.nodeType === Node.TEXT_NODE) {
			const textNode = node as Text;
			const range = textNode.ownerDocument.createRange();
			range.setStart(textNode, 0);
			range.setEnd(textNode, Math.min(textNode.textContent?.length || 0, 1));
			return range;
		}
		if (domInstanceOf(node, Element)) {
			const textSegments = this.collectTextSegments(node);
			if (textSegments.length > 0) {
				const range = node.ownerDocument.createRange();
				range.setStart(textSegments[0].node, 0);
				range.setEnd(textSegments[0].node, Math.min(1, textSegments[0].text.length));
				return range;
			}
		}
		const range = node.ownerDocument.createRange();
		range.selectNode(node);
		return range;
	}

	private resolveTocExportStartElement(
		doc: Document,
		href: string,
		titleHint: string | undefined,
		fallbackRange: Range | null | undefined
	): Element | null {
		const root = doc.body || doc.documentElement;
		const fragment = extractTocHrefFragment(href) || this.extractHrefFragment(href);
		if (fragment) {
			const byFragment = this.findFragmentTargetElement(doc, fragment);
			if (byFragment) {
				return byFragment;
			}
		}

		const byTitle = titleHint?.trim()
			? this.findTocExportHeadingElement(root, titleHint)
			: null;
		if (byTitle) {
			return byTitle;
		}

		return this.resolveRangeBlockElement(root, fallbackRange);
	}

	private resolveTocExportBoundaryElement(
		doc: Document,
		href: string,
		label: string
	): Element | null {
		const fragment = extractTocHrefFragment(href) || this.extractHrefFragment(href);
		if (fragment) {
			const byFragment = this.findFragmentTargetElement(doc, fragment);
			if (byFragment) {
				return byFragment;
			}
		}
		return this.findTocExportHeadingElement(doc.body || doc.documentElement, label);
	}

	private findTocExportHeadingElement(root: Element, label: string): Element | null {
		const normalizedLabel = this.normalizeReadingPointTitle(label);
		if (!normalizedLabel) {
			return null;
		}

		const quoteRange = this.findRangeByTextQuote(root, { highlight: normalizedLabel });
		if (quoteRange) {
			return this.resolveRangeBlockElement(root, quoteRange);
		}

		for (const heading of Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6"))) {
			if (
				this.normalizeReadingPointTitle(String(heading.textContent || "")) === normalizedLabel
			) {
				return heading;
			}
		}

		return null;
	}

	private resolveRangeBlockElement(root: Element, range: Range | null | undefined): Element | null {
		if (!range) {
			return null;
		}

		let node: Node | null = range.startContainer;
		if (node.nodeType === Node.TEXT_NODE) {
			node = node.parentElement;
		}
		while (node && domInstanceOf(node, Element) && node !== root) {
			const tag = node.tagName.toUpperCase();
			if (/^H[1-6]$/.test(tag) || tag === "P" || tag === "DIV" || tag === "SECTION" || tag === "ARTICLE") {
				return node;
			}
			node = node.parentElement;
		}

		return domInstanceOf(node, Element) ? node : root;
	}

	private buildTocScopedExportRoot(
		doc: Document,
		startElement: Element,
		endElement: Element | null
	): Element | null {
		const root = doc.body || doc.documentElement;
		const range = doc.createRange();
		range.setStart(startElement, 0);
		if (endElement && endElement !== startElement && root.contains(endElement)) {
			const position = startElement.compareDocumentPosition(endElement);
			if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
				range.setEndBefore(endElement);
			} else {
				range.setEnd(root, root.childNodes.length);
			}
		} else {
			range.setEnd(root, root.childNodes.length);
		}

		const wrapper = createDivInDocument(doc);
		wrapper.appendChild(range.cloneContents());
		if (!String(wrapper.textContent || "").replace(/\s+/g, "").trim()) {
			return null;
		}
		return wrapper;
	}

	private createDocumentStartRange(doc: Document): Range | null {
		const root = doc.body || doc.documentElement;
		const segments = this.collectTextSegments(root);
		if (segments.length > 0) {
			const range = doc.createRange();
			range.setStart(segments[0].node, 0);
			range.setEnd(segments[0].node, Math.min(1, segments[0].text.length));
			return range;
		}
		return this.createRangeForNode(root);
	}

	private collectTextSegments(root: Element): TextNodeSegment[] {
		const segments: TextNodeSegment[] = [];
		const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: (node) => {
				const parent = node.parentElement;
				if (!parent || TEXT_NODE_TAG_BLACKLIST.has(parent.tagName.toUpperCase())) {
					return NodeFilter.FILTER_REJECT;
				}
				return (node.textContent || "").length > 0
					? NodeFilter.FILTER_ACCEPT
					: NodeFilter.FILTER_REJECT;
			},
		});
		let offset = 0;
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			const text = node.textContent || "";
			segments.push({ node, start: offset, end: offset + text.length, text });
			offset += text.length;
		}
		return segments;
	}

	private computeTextOffsetForBoundary(
		segments: TextNodeSegment[],
		node: Node,
		offset: number
	): number {
		if (node.nodeType === Node.TEXT_NODE) {
			const segment = segments.find((item) => item.node === node);
			if (segment) {
				return segment.start + Math.min(offset, segment.text.length);
			}
		}
		const rangeDoc = node.ownerDocument || activeDocument;
		const probe = rangeDoc.createRange();
		try {
			probe.setStart(segments[0].node, 0);
			probe.setEnd(node, offset);
			return probe.toString().length;
		} catch {
			return 0;
		}
	}

	private createRangeFromTextOffsets(
		doc: Document,
		segments: TextNodeSegment[],
		startOffset: number,
		endOffset: number
	): Range | null {
		const startSegment = segments.find(
			(segment) => startOffset >= segment.start && startOffset <= segment.end
		);
		const endSegment = segments.find(
			(segment) => endOffset >= segment.start && endOffset <= segment.end
		);
		if (!startSegment || !endSegment) {
			return null;
		}
		const range = doc.createRange();
		range.setStart(startSegment.node, Math.max(0, startOffset - startSegment.start));
		range.setEnd(endSegment.node, Math.max(0, endOffset - endSegment.start));
		return range;
	}

	private createCollapsedRangeFromTextOffset(
		doc: Document,
		segments: TextNodeSegment[],
		offset: number
	): Range | null {
		const targetSegment =
			segments.find((segment) => offset >= segment.start && offset <= segment.end) ||
			segments[segments.length - 1];
		if (!targetSegment) {
			return null;
		}
		const textOffset = this.clamp(offset - targetSegment.start, 0, targetSegment.text.length);
		const range = doc.createRange();
		range.setStart(targetSegment.node, textOffset);
		range.setEnd(targetSegment.node, textOffset);
		return range;
	}

	private computeProgressionForRange(doc: Document, range: Range): number {
		const root = doc.body || doc.documentElement;
		const segments = this.collectTextSegments(root);
		if (segments.length === 0) {
			return 0;
		}
		const totalLength = segments[segments.length - 1]?.end || 0;
		if (totalLength <= 0) {
			return 0;
		}
		const startOffset = this.computeTextOffsetForBoundary(
			segments,
			range.startContainer,
			range.startOffset
		);
		return this.clamp(startOffset / totalLength, 0, 1);
	}

	private buildSearchSnippet(source: string, index: number, length: number): string {
		const start = Math.max(0, index - 40);
		const end = Math.min(source.length, index + length + 40);
		let snippet = source.slice(start, end).replace(/\s+/g, " ").trim();
		if (start > 0) {
			snippet = `...${snippet}`;
		}
		if (end < source.length) {
			snippet = `${snippet}...`;
		}
		return snippet;
	}

	private extractReadableSectionText(root: Element | null): string {
		if (!root) {
			return "";
		}

		const candidate = root as HTMLElement & { innerText?: string };
		const rawText = String(candidate.innerText || root.textContent || "")
			.replace(/\r\n?/g, "\n")
			.replace(/\u00a0/g, " ");
		const lines: string[] = [];
		let previousBlank = false;

		for (const line of rawText.split("\n")) {
			const normalizedLine = line.replace(/[ \t]+/g, " ").trim();
			if (!normalizedLine) {
				if (lines.length > 0 && !previousBlank) {
					lines.push("");
					previousBlank = true;
				}
				continue;
			}

			lines.push(normalizedLine);
			previousBlank = false;
		}

		return lines.join("\n").trim();
	}

	private async buildSectionMarkdownExport(
		root: Element | null,
		baseHref: string,
		title: string
	): Promise<{
		markdown: string;
		assets: FoliateChapterExportAsset[];
		plainText: string;
	}> {
		const plainText = this.extractReadableSectionText(root);
		if (!root) {
			return { markdown: "", assets: [], plainText };
		}

		const context: MarkdownExportContext = {
			baseHref,
			assets: [],
			assetBySource: new Map<string, FoliateChapterExportAsset>(),
		};

		let markdown = await this.renderBlockNodesToMarkdown(Array.from(root.childNodes), context);
		markdown = this.stripLeadingMarkdownHeading(this.normalizeExportedMarkdown(markdown), title);
		if (!markdown) {
			markdown = this.normalizeExportedMarkdown(this.stripLeadingSectionTitle(plainText, title));
		}

		return {
			markdown,
			assets: context.assets,
			plainText,
		};
	}

	private extractFootnotesFromDocument(
		doc: Document,
		section: SectionDescriptor
	): EpubBookFootnoteEntry[] {
		const root = doc.body || doc.documentElement;
		if (!root) {
			return [];
		}
		const results: EpubBookFootnoteEntry[] = [];
		const candidateContainers = this.collectFootnoteExportContainers(root, section.href);
		for (const container of candidateContainers) {
			const itemCandidates = this.collectFootnoteExportItemCandidates(container);
			for (const item of itemCandidates) {
				const entry = this.buildFootnoteExportEntry(item, section);
				if (entry) {
					results.push(entry);
				}
			}
		}
		return results;
	}

	private isFootnoteReferenceAnchor(anchor: Element, currentSectionHref: string): boolean {
		const href = String(anchor.getAttribute("href") || "").trim();
		if (!href.includes("#")) {
			return false;
		}
		const rel = String(anchor.getAttribute("rel") || "").toLowerCase();
		const ariaDescribedBy = String(anchor.getAttribute("aria-describedby") || "").toLowerCase();
		const ariaLabel = String(anchor.getAttribute("aria-label") || "").toLowerCase();
		const title = String(anchor.getAttribute("title") || "").toLowerCase();
		const labelText = String(anchor.textContent || "")
			.replace(/\s+/g, " ")
			.trim()
			.toLowerCase();
		const hrefPath = this.extractFootnoteReferencePath(href, currentSectionHref).toLowerCase();
		const fragment = String(this.extractHrefFragment(href) || "").toLowerCase();
		const signals = [
			anchor.getAttribute("role") || "",
			this.getSemanticAttributeValue(anchor, "type"),
			anchor.getAttribute("type") || "",
			anchor.getAttribute("class") || "",
			rel,
			ariaDescribedBy,
			ariaLabel,
			title,
		]
			.join(" ")
			.toLowerCase();
		if (
			signals.includes("noteref") ||
			signals.includes("footnote") ||
			signals.includes("endnote")
		) {
			return true;
		}
		if (/(?:^|[\\/_-])(footnote|endnote|notes?)(?:[\\/_.-]|$)/i.test(hrefPath)) {
			return true;
		}
		if (/(?:^|[-_:.])(fn|footnote|endnote|note|zhu|zhushi)\d*/i.test(fragment)) {
			return true;
		}
		if (/^(?:\[?\d+\]?|[*†‡§])$/.test(labelText) && /#(?:[a-z_-]*\d+)?$/i.test(href)) {
			return true;
		}
		return false;
	}

	private async buildFootnoteEntryFromReference(
		doc: Document,
		anchor: Element,
		sourceSection: SectionDescriptor
	): Promise<EpubBookFootnoteEntry | null> {
		const rawHref = String(anchor.getAttribute("href") || "").trim();
		if (!rawHref) {
			return null;
		}
		const resolvedTarget = await this.resolveFootnoteExportTarget(doc, sourceSection, rawHref);
		if (!resolvedTarget) {
			return null;
		}
		const label = this.normalizeReadingPointTitle(
			String(anchor.textContent || "").trim() ||
				String(this.extractHrefFragment(rawHref) || "").trim() ||
				"脚注"
		);
		const entryFromElement = resolvedTarget.element
			? this.buildFootnoteExportEntry(
					resolvedTarget.element,
					resolvedTarget.section,
					label,
					resolvedTarget.href
			  )
			: null;
		if (entryFromElement) {
			return entryFromElement;
		}
		const text = this.normalizeFootnoteExportText(resolvedTarget.text);
		if (!text) {
			return null;
		}
		return {
			label,
			text,
			href: resolvedTarget.href,
			sectionHref: resolvedTarget.section.href,
			sectionTitle: resolvedTarget.section.title,
			chapterIndex: resolvedTarget.section.index,
		};
	}

	private async resolveFootnoteExportTarget(
		doc: Document,
		sourceSection: SectionDescriptor,
		href: string
	): Promise<ResolvedFootnoteExportTarget | null> {
		const candidates = this.buildFootnoteReferenceHrefCandidates(sourceSection.href, href);
		for (const candidate of candidates) {
			const directTarget = await this.findDirectFootnoteExportTarget(doc, sourceSection, candidate);
			if (directTarget) {
				return directTarget;
			}
			const resolvedTarget = await this.resolveNavigationTarget(candidate);
			if (!resolvedTarget?.doc && !resolvedTarget?.range) {
				continue;
			}
			const resolvedHref =
				this.getSectionHrefByIndex(resolvedTarget.index) ||
				this.normalizeSectionHref(resolvedTarget.href || candidate) ||
				this.extractFootnoteReferencePath(candidate, sourceSection.href) ||
				sourceSection.href;
			const resolvedSection = this.getSectionDescriptorByHref(resolvedHref) || sourceSection;
			const fragment =
				this.extractHrefFragment(resolvedTarget.href || "") ||
				this.extractHrefFragment(candidate) ||
				"";
			const element = fragment
				? this.findFragmentTargetInDocument(resolvedTarget.doc || doc, fragment)
				: this.getElementFromRangeForFootnoteExport(resolvedTarget.range || null);
			const text = this.extractNormalizedFootnoteTextFromRangeForExport(resolvedTarget.range || null);
			if (element || text) {
				return {
					href: resolvedHref,
					section: resolvedSection,
					doc: resolvedTarget.doc || doc,
					element,
					text,
				};
			}
		}
		const fragment = this.extractHrefFragment(href);
		if (!fragment) {
			return null;
		}
		const crossSectionResult = await this.findFragmentTargetAcrossSections(fragment, candidates);
		if (!crossSectionResult?.element || !crossSectionResult.doc) {
			return null;
		}
		const crossSection = this.getSectionDescriptorByHref(crossSectionResult.href) || {
			index: crossSectionResult.index,
			href: crossSectionResult.href,
			title: this.getSectionTitleByHref(crossSectionResult.href) || `章节 ${crossSectionResult.index + 1}`,
			linear: true,
			textLength: 0,
			wordCount: 0,
			positionCount: 0,
			positionStart: 0,
		};
		return {
			href: crossSectionResult.href,
			section: crossSection,
			doc: crossSectionResult.doc,
			element: crossSectionResult.element,
			text: this.getNormalizedFootnoteElementTextForExport(crossSectionResult.element),
		};
	}

	private async findDirectFootnoteExportTarget(
		doc: Document,
		sourceSection: SectionDescriptor,
		candidate: string
	): Promise<ResolvedFootnoteExportTarget | null> {
		const fragment = this.extractHrefFragment(candidate);
		if (!fragment) {
			return null;
		}
		const preferredPath = this.extractFootnoteReferencePath(candidate, sourceSection.href);
		const normalizedPreferredPath = this.normalizeSectionHref(preferredPath || sourceSection.href);
		if (normalizedPreferredPath === sourceSection.href) {
			const element = this.findFragmentTargetInDocument(doc, fragment);
			if (element) {
				return {
					href: `${sourceSection.href}#${fragment}`,
					section: sourceSection,
					doc,
					element,
					text: this.getNormalizedFootnoteElementTextForExport(element),
				};
			}
		}
		if (!normalizedPreferredPath || normalizedPreferredPath === sourceSection.href) {
			return null;
		}
		const externalDoc = await this.getRawDocumentByHref(normalizedPreferredPath);
		if (!externalDoc) {
			return null;
		}
		const element = this.findFragmentTargetInDocument(externalDoc, fragment);
		if (!element) {
			return null;
		}
		const targetSection = this.getSectionDescriptorByHref(normalizedPreferredPath) || sourceSection;
		return {
			href: `${targetSection.href}#${fragment}`,
			section: targetSection,
			doc: externalDoc,
			element,
			text: this.getNormalizedFootnoteElementTextForExport(element),
		};
	}

	private buildFootnoteReferenceHrefCandidates(sectionHref: string, href: string): string[] {
		const rawHref = String(href || "").trim();
		if (!rawHref) {
			return [];
		}
		const candidates = new Set<string>();
		const push = (value: string | null | undefined) => {
			const normalizedValue = String(value || "").trim();
			if (!normalizedValue) {
				return;
			}
			candidates.add(normalizedValue);
		};
		push(rawHref);
		push(this.resolveHrefAgainst(sectionHref, rawHref));
		const resolvedPath = this.extractFootnoteReferencePath(rawHref, sectionHref);
		const fragment = this.extractHrefFragment(rawHref);
		const fileName = resolvedPath.split("/").pop() || resolvedPath;
		if (fileName) {
			for (const section of this.sectionDescriptors) {
				const sectionFileName = section.href.split("/").pop() || section.href;
				if (sectionFileName === fileName || section.href.endsWith(`/${fileName}`)) {
					push(fragment ? `${section.href}#${fragment}` : section.href);
				}
			}
		}
		return Array.from(candidates);
	}

	private extractFootnoteReferencePath(href: string, baseHref: string): string {
		const normalizedHref = String(href || "").trim();
		if (!normalizedHref) {
			return "";
		}
		const hashIndex = normalizedHref.indexOf("#");
		const rawPath = (hashIndex >= 0 ? normalizedHref.slice(0, hashIndex) : normalizedHref)
			.split(/[?]/)[0]
			.trim();
		if (!rawPath) {
			return this.normalizeSectionHref(baseHref);
		}
		return this.resolveHrefAgainst(baseHref || rawPath, rawPath);
	}

	private collectFootnoteExportContainers(root: Element, sectionHref: string): Element[] {
		const containers: Element[] = [];
		const visited = new Set<Element>();
		const push = (element: Element | null | undefined) => {
			if (!element || visited.has(element)) {
				return;
			}
			visited.add(element);
			containers.push(element);
		};
		for (const element of Array.from(root.getElementsByTagName("*"))) {
			if (this.isFootnoteExportContainer(element)) {
				push(element);
			}
		}
		if (containers.length === 0 && this.isLikelyNoteSectionHref(sectionHref)) {
			push(root);
		}
		return containers;
	}

	private collectFootnoteExportItemCandidates(container: Element): Element[] {
		const tag = this.getNodeLocalName(container);
		if (tag === "ol" || tag === "ul") {
			const items = Array.from(container.children).filter(
				(child) => this.getNodeLocalName(child) === "li"
			);
			if (items.length > 0) {
				return items;
			}
		}
		const directChildren = Array.from(container.children);
		const childItems = directChildren.filter((child) => this.getNodeLocalName(child) === "li");
		for (const child of directChildren) {
			const childTag = this.getNodeLocalName(child);
			if (childTag !== "ol" && childTag !== "ul") {
				continue;
			}
			for (const grandChild of Array.from(child.children)) {
				if (this.getNodeLocalName(grandChild) === "li") {
					childItems.push(grandChild);
				}
			}
		}
		if (childItems.length > 0) {
			return childItems;
		}
		return [container];
	}

	private buildFootnoteExportEntry(
		element: Element,
		section: SectionDescriptor,
		preferredLabel?: string,
		preferredHref?: string
	): EpubBookFootnoteEntry | null {
		const contentElement = this.resolveFootnoteExportContentElement(element, preferredLabel) || element;
		const normalizedText = this.getNormalizedFootnoteElementTextForExport(contentElement);
		if (!normalizedText) {
			return null;
		}
		const rawLabel = this.extractFootnoteEntryLabel(element, normalizedText) || preferredLabel;
		const label = rawLabel || `脚注 ${section.index + 1}-${Math.max(1, this.estimateElementOrdinal(element))}`;
		const href = preferredHref || this.buildFootnoteExportHref(section.href, element, label);
		return {
			label,
			text: normalizedText,
			href,
			sectionHref: section.href,
			sectionTitle: section.title,
			chapterIndex: section.index,
		};
	}

	private resolveFootnoteExportContentElement(target: Element, label?: string): Element | null {
		let bestCandidate: { element: Element; score: number } | null = null;
		for (const candidate of this.collectFootnoteExportContentCandidates(target)) {
			const text = this.getNormalizedFootnoteElementTextForExport(candidate);
			if (!this.isMeaningfulFootnoteExportText(text, label)) {
				continue;
			}
			let score = 0;
			if (candidate === target) {
				score += 32;
			}
			if (candidate.contains(target)) {
				score += 24;
			}
			if (this.isFootnoteExportContainer(candidate)) {
				score += 24;
			}
			if (this.containsFootnoteBacklink(candidate)) {
				score += 10;
			}
			score += this.scoreFootnoteExportTagName(this.getNodeLocalName(candidate));
			score += this.scoreFootnoteExportTextLength(text.length);
			score -= this.computeFootnoteExportDomDistance(target, candidate) * 4;
			if (!bestCandidate || score > bestCandidate.score) {
				bestCandidate = { element: candidate, score };
			}
		}
		return bestCandidate?.element || null;
	}

	private collectFootnoteExportContentCandidates(target: Element): Element[] {
		const candidates: Element[] = [];
		const visited = new Set<Element>();
		const enqueue = (candidate: Element | null | undefined) => {
			if (!candidate || visited.has(candidate)) {
				return;
			}
			visited.add(candidate);
			candidates.push(candidate);
		};
		enqueue(target);
		let current: Element | null = target;
		for (let depth = 0; current && depth < 4; depth += 1) {
			enqueue(current.parentElement);
			enqueue(current.nextElementSibling);
			enqueue(current.previousElementSibling);
			enqueue(current.parentElement?.nextElementSibling);
			enqueue(current.parentElement?.previousElementSibling);
			current = current.parentElement;
		}
		for (const descendant of Array.from(target.getElementsByTagName("*")).slice(0, 24)) {
			enqueue(descendant);
		}
		return candidates;
	}

	private containsFootnoteBacklink(element: Element): boolean {
		for (const anchor of Array.from(element.querySelectorAll("a[href]"))) {
			const role = String(anchor.getAttribute("role") || "").toLowerCase();
			const epubType = this.getSemanticAttributeValue(anchor, "type");
			if (role.includes("backlink") || epubType.includes("backlink") || /^\s*[↩↑←]/.test(anchor.textContent || "")) {
				return true;
			}
		}
		return false;
	}

	private scoreFootnoteExportTagName(tagName: string): number {
		switch (tagName) {
			case "li":
				return 34;
			case "p":
				return 26;
			case "dd":
				return 22;
			case "blockquote":
				return 18;
			case "aside":
			case "article":
				return 16;
			case "section":
				return 12;
			case "div":
				return 8;
			case "span":
				return -4;
			default:
				return 0;
		}
	}

	private scoreFootnoteExportTextLength(length: number): number {
		if (length >= 8 && length <= 320) {
			return 22;
		}
		if (length <= 520) {
			return 10;
		}
		if (length <= 900) {
			return -4;
		}
		return -Math.min(36, Math.floor((length - 900) / 80) + 8);
	}

	private computeFootnoteExportDomDistance(target: Element, candidate: Element): number {
		let distance = 0;
		let current: Element | null = target;
		while (current) {
			if (current === candidate) {
				return distance;
			}
			current = current.parentElement;
			distance += 1;
		}
		current = candidate;
		while (current) {
			if (current === target) {
				return distance;
			}
			current = current.parentElement;
			distance += 1;
		}
		return distance + 4;
	}

	private getNormalizedFootnoteElementTextForExport(element: Element): string {
		const clone = element.cloneNode(true) as Element;
		this.removeFootnoteBacklinks(clone);
		const text = this.extractReadableSectionText(clone as HTMLElement) || clone.textContent || "";
		return this.normalizeFootnoteExportText(text);
	}

	private extractNormalizedFootnoteTextFromRangeForExport(range: Range | null): string {
		if (!range) {
			return "";
		}
		try {
			const fragment = range.cloneContents();
			const ownerDocument = range.commonAncestorContainer.ownerDocument || activeDocument;
			const container = createDivInDocument(ownerDocument);
			container.appendChild(fragment);
			this.removeFootnoteBacklinks(container);
			return this.normalizeFootnoteExportText(
				this.extractReadableSectionText(container as HTMLElement) || container.textContent || ""
			);
		} catch {
			return this.normalizeFootnoteExportText(range.toString());
		}
	}

	private removeFootnoteBacklinks(root: Element): void {
		for (const anchor of Array.from(root.querySelectorAll("a[href]"))) {
			const role = String(anchor.getAttribute("role") || "").toLowerCase();
			const epubType = this.getSemanticAttributeValue(anchor, "type");
			if (role.includes("backlink") || epubType.includes("backlink") || /^\s*[↩↑←]/.test(anchor.textContent || "")) {
				anchor.remove();
			}
		}
	}

	private normalizeFootnoteExportText(text: string | null | undefined): string {
		return this.normalizeExportedMarkdown(String(text || "")).replace(/\n{3,}/g, "\n\n").trim();
	}

	private normalizeComparableFootnoteExportLabel(text: string | null | undefined): string {
		return String(text || "")
			.replace(/\s+/g, "")
			.replace(/^[[(（【〔「『]+/, "")
			.replace(/[\])）】〕」』.,;:、，。]+$/g, "")
			.toLowerCase();
	}

	private isMeaningfulFootnoteExportText(text: string, label?: string): boolean {
		const normalizedText = this.normalizeFootnoteExportText(text);
		if (!normalizedText) {
			return false;
		}
		const comparableText = this.normalizeComparableFootnoteExportLabel(normalizedText);
		const comparableLabel = this.normalizeComparableFootnoteExportLabel(label);
		if (comparableText && comparableLabel && comparableText === comparableLabel) {
			return false;
		}
		return true;
	}

	private getElementFromRangeForFootnoteExport(range: Range | null): Element | null {
		if (!range) {
			return null;
		}
		const container = range.commonAncestorContainer;
		if (!container) {
			return null;
		}
		if (container.nodeType === Node.ELEMENT_NODE) {
			return container as Element;
		}
		return container.parentElement ?? null;
	}

	private getSectionDescriptorByHref(href: string): SectionDescriptor | null {
		const normalizedHref = this.normalizeSectionHref(href);
		return this.sectionDescriptors.find((section) => section.href === normalizedHref) || null;
	}

	private isFootnoteExportContainer(element: Element): boolean {
		const role = String(element.getAttribute("role") || "")
			.trim()
			.toLowerCase();
		if (FOOTNOTE_EXPORT_ROLE_VALUES.has(role)) {
			return true;
		}
		const semanticType = this.getSemanticAttributeValue(element, "type");
		const semanticTokens = semanticType
			.split(/\s+/)
			.map((token) => token.trim().toLowerCase())
			.filter(Boolean);
		if (semanticTokens.some((token) => FOOTNOTE_EXPORT_TYPE_VALUES.has(token))) {
			return true;
		}
		const tag = this.getNodeLocalName(element);
		if (tag !== "section" && tag !== "aside" && tag !== "div" && tag !== "ol" && tag !== "ul") {
			return false;
		}
		const className = String(element.getAttribute("class") || "").trim();
		const id = this.getElementStableId(element);
		return FOOTNOTE_EXPORT_KEYWORD_PATTERN.test(className) || FOOTNOTE_EXPORT_KEYWORD_PATTERN.test(id);
	}

	private getSemanticAttributeValue(element: Element, localName: string): string {
		return String(
			element.getAttribute(`epub:${localName}`) ||
				element.getAttribute(localName) ||
				element.getAttributeNS(EPUB_OPS_NAMESPACE, localName) ||
				""
		)
			.trim()
			.toLowerCase();
	}

	private getElementStableId(element: Element): string {
		return String(
			element.getAttribute("id") ||
				element.getAttribute("xml:id") ||
				element.getAttributeNS("http://www.w3.org/XML/1998/namespace", "id") ||
				""
		).trim();
	}

	private extractFootnoteEntryLabel(element: Element, text: string): string {
		const directId = this.getElementStableId(element);
		if (directId) {
			return directId;
		}
		const firstLine = String(text || "").split("\n")[0]?.trim() || "";
		const labelMatch = firstLine.match(/^([[(（【]?[0-9A-Za-z一二三四五六七八九十百千*†‡§]+[\])）】]?)\s*[.、:：-]?\s*/u);
		return labelMatch?.[1]?.trim() || "";
	}

	private estimateElementOrdinal(element: Element): number {
		let ordinal = 1;
		let current = element.previousElementSibling;
		while (current) {
			ordinal += 1;
			current = current.previousElementSibling;
		}
		return ordinal;
	}

	private buildFootnoteExportHref(sectionHref: string, element: Element, label: string): string {
		const fragment = this.getElementStableId(element) || this.slugifyFootnoteLabel(label);
		return fragment ? `${sectionHref}#${fragment}` : sectionHref;
	}

	private slugifyFootnoteLabel(label: string): string {
		return String(label || "")
			.trim()
			.toLowerCase()
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9\-\u4e00-\u9fa5]+/g, "")
			.replace(/-+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	private deduplicateFootnoteEntries(entries: EpubBookFootnoteEntry[]): EpubBookFootnoteEntry[] {
		const results: EpubBookFootnoteEntry[] = [];
		const seen = new Set<string>();
		for (const entry of entries) {
			const key = `${entry.href}::${entry.text}`.trim();
			if (!key || seen.has(key)) {
				continue;
			}
			seen.add(key);
			results.push(entry);
		}
		return results;
	}

	private buildBookFootnotesMarkdown(entries: EpubBookFootnoteEntry[]): string {
		const lines: string[] = ["# 全部脚注", ""];
		let currentSectionKey = "";
		for (const entry of entries) {
			const sectionKey = `${entry.chapterIndex}:${entry.sectionTitle}`;
			if (sectionKey !== currentSectionKey) {
				currentSectionKey = sectionKey;
				lines.push(`## ${entry.sectionTitle || `章节 ${entry.chapterIndex + 1}`}`, "");
			}
			lines.push(`### ${entry.label}`, "");
			lines.push(`- 位置：${entry.href}`, "");
			lines.push(entry.text, "");
		}
		return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
	}

	private async renderBlockNodesToMarkdown(
		nodes: Node[],
		context: MarkdownExportContext
	): Promise<string> {
		const chunks: string[] = [];
		for (const node of nodes) {
			const rendered = this.normalizeExportedMarkdown(
				await this.renderNodeAsBlockMarkdown(node, context)
			);
			if (rendered) {
				chunks.push(rendered);
			}
		}
		return chunks.join("\n\n");
	}

	private async renderNodeAsBlockMarkdown(
		node: Node,
		context: MarkdownExportContext
	): Promise<string> {
		if (node.nodeType === Node.TEXT_NODE) {
			return this.normalizeInlineMarkdown(this.normalizeInlineTextFragment(node.textContent || ""));
		}
		if (node.nodeType !== Node.ELEMENT_NODE) {
			return "";
		}

		const element = node as Element;
		const tag = this.getNodeLocalName(element);
		if (!tag || MARKDOWN_SKIPPED_TAGS.has(tag)) {
			return "";
		}

		if (/^h[1-6]$/.test(tag)) {
			const level = Number(tag.slice(1));
			const text = this.normalizeInlineMarkdown(
				await this.renderInlineNodesToMarkdown(Array.from(element.childNodes), context)
			);
			return text ? `${"#".repeat(level)} ${text}` : "";
		}

		if (tag === "blockquote") {
			const inner = this.normalizeExportedMarkdown(
				await this.renderBlockNodesToMarkdown(Array.from(element.childNodes), context)
			);
			return inner ? this.prefixMarkdownLines(inner, "> ") : "";
		}

		if (tag === "pre") {
			return this.renderPreformattedElementAsMarkdown(element);
		}

		if (tag === "hr") {
			return "---";
		}

		if (tag === "ul" || tag === "ol") {
			return this.renderListElementAsMarkdown(element, context, 0);
		}

		if (tag === "img") {
			return this.renderImageElementAsMarkdown(element, context);
		}

		if (tag === "figure") {
			return this.renderFigureElementAsMarkdown(element, context);
		}

		if (tag === "table") {
			return this.renderTableElementAsMarkdown(element, context);
		}

		if (tag === "p" || tag === "summary" || tag === "figcaption" || tag === "td" || tag === "th") {
			return this.normalizeInlineMarkdown(
				await this.renderInlineNodesToMarkdown(Array.from(element.childNodes), context)
			);
		}

		const childNodes = Array.from(element.childNodes);
		if (childNodes.length === 0) {
			return this.normalizeInlineMarkdown(
				this.normalizeInlineTextFragment(element.textContent || "")
			);
		}

		if (
			MARKDOWN_CONTAINER_TAGS.has(tag) ||
			childNodes.some((child) => this.nodeProducesBlockMarkdown(child))
		) {
			return this.renderBlockNodesToMarkdown(childNodes, context);
		}

		return this.normalizeInlineMarkdown(
			await this.renderInlineNodesToMarkdown(childNodes, context)
		);
	}

	private async renderInlineNodesToMarkdown(
		nodes: Node[],
		context: MarkdownExportContext
	): Promise<string> {
		let result = "";
		for (const node of nodes) {
			result += await this.renderInlineNodeToMarkdown(node, context);
		}
		return result;
	}

	private async renderInlineNodeToMarkdown(
		node: Node,
		context: MarkdownExportContext
	): Promise<string> {
		if (node.nodeType === Node.TEXT_NODE) {
			return this.normalizeInlineTextFragment(node.textContent || "");
		}
		if (node.nodeType !== Node.ELEMENT_NODE) {
			return "";
		}

		const element = node as Element;
		const tag = this.getNodeLocalName(element);
		if (!tag || MARKDOWN_SKIPPED_TAGS.has(tag)) {
			return "";
		}

		if (tag === "br") {
			return "\n";
		}

		if (tag === "code") {
			return this.renderInlineCodeSpan(element.textContent || "");
		}

		if (tag === "strong" || tag === "b") {
			const text = this.normalizeInlineMarkdown(
				await this.renderInlineNodesToMarkdown(Array.from(element.childNodes), context)
			);
			return text ? `**${text}**` : "";
		}

		if (tag === "em" || tag === "i") {
			const text = this.normalizeInlineMarkdown(
				await this.renderInlineNodesToMarkdown(Array.from(element.childNodes), context)
			);
			return text ? `*${text}*` : "";
		}

		if (tag === "s" || tag === "del" || tag === "strike") {
			const text = this.normalizeInlineMarkdown(
				await this.renderInlineNodesToMarkdown(Array.from(element.childNodes), context)
			);
			return text ? `~~${text}~~` : "";
		}

		if (tag === "a") {
			const href = String(
				element.getAttribute("href") || element.getAttribute("xlink:href") || ""
			).trim();
			const text = this.normalizeInlineMarkdown(
				await this.renderInlineNodesToMarkdown(Array.from(element.childNodes), context)
			);
			if (!href || !text) {
				return text;
			}
			if (text.includes("{{WEAVE_EPUB_ASSET_")) {
				return text;
			}
			if (href.startsWith("#")) {
				return text;
			}
			if (this.shouldKeepOriginalUrl(href)) {
				return `[${text}](${href})`;
			}
			return text;
		}

		if (tag === "img") {
			const image = await this.renderImageElementAsMarkdown(element, context);
			return image ? `\n${image}\n` : "";
		}

		if (this.nodeProducesBlockMarkdown(element)) {
			const block = this.normalizeExportedMarkdown(
				await this.renderNodeAsBlockMarkdown(element, context)
			);
			return block ? `\n${block}\n` : "";
		}

		return this.renderInlineNodesToMarkdown(Array.from(element.childNodes), context);
	}

	private renderPreformattedElementAsMarkdown(element: Element): string {
		const rawText = String(element.textContent || "")
			.replace(/\r\n?/g, "\n")
			.trimEnd();
		if (!rawText.trim()) {
			return "";
		}

		const codeElement = Array.from(element.children).find(
			(child) => this.getNodeLocalName(child) === "code"
		);
		const className = String(codeElement?.getAttribute("class") || "");
		const languageMatch = className.match(/(?:language-|lang-)([A-Za-z0-9_-]+)/);
		const language = languageMatch?.[1] || "";
		const fence = rawText.includes("```") ? "````" : "```";
		return `${fence}${language}\n${rawText}\n${fence}`;
	}

	private async renderListElementAsMarkdown(
		listElement: Element,
		context: MarkdownExportContext,
		depth: number
	): Promise<string> {
		const ordered = this.getNodeLocalName(listElement) === "ol";
		const items = Array.from(listElement.children).filter(
			(child) => this.getNodeLocalName(child) === "li"
		);
		const renderedItems: string[] = [];

		for (const [index, item] of items.entries()) {
			const contentNodes = Array.from(item.childNodes).filter((child) => {
				if (child.nodeType !== Node.ELEMENT_NODE) {
					return true;
				}
				const childTag = this.getNodeLocalName(child as Element);
				return childTag !== "ul" && childTag !== "ol";
			});
			const nestedLists = Array.from(item.children).filter((child) => {
				const childTag = this.getNodeLocalName(child);
				return childTag === "ul" || childTag === "ol";
			});

			const itemContent = this.normalizeExportedMarkdown(
				await this.renderBlockNodesToMarkdown(contentNodes, context)
			);
			const bullet = ordered ? `${index + 1}. ` : "- ";
			const indent = "  ".repeat(depth);
			const continuationIndent = `${indent}  `;
			const prefixedContent = this.prefixListItemMarkdown(
				itemContent ||
					this.normalizeInlineMarkdown(this.normalizeInlineTextFragment(item.textContent || "")),
				`${indent}${bullet}`,
				continuationIndent
			);

			const nestedMarkdownChunks: string[] = [];
			for (const nestedList of nestedLists) {
				const nestedMarkdown = this.normalizeExportedMarkdown(
					await this.renderListElementAsMarkdown(nestedList, context, depth + 1)
				);
				if (nestedMarkdown) {
					nestedMarkdownChunks.push(nestedMarkdown);
				}
			}

			renderedItems.push([prefixedContent, ...nestedMarkdownChunks].filter(Boolean).join("\n"));
		}

		return renderedItems.join("\n");
	}

	private async renderFigureElementAsMarkdown(
		figureElement: Element,
		context: MarkdownExportContext
	): Promise<string> {
		const captionElement = Array.from(figureElement.children).find(
			(child) => this.getNodeLocalName(child) === "figcaption"
		);
		const bodyNodes = Array.from(figureElement.childNodes).filter(
			(child) => child !== captionElement
		);
		const body = this.normalizeExportedMarkdown(
			await this.renderBlockNodesToMarkdown(bodyNodes, context)
		);
		const caption = captionElement
			? this.normalizeInlineMarkdown(
					await this.renderInlineNodesToMarkdown(Array.from(captionElement.childNodes), context)
			  )
			: "";
		return [body, caption ? `*${caption}*` : ""].filter(Boolean).join("\n\n");
	}

	private async renderTableElementAsMarkdown(
		tableElement: Element,
		context: MarkdownExportContext
	): Promise<string> {
		const rowElements = Array.from(tableElement.querySelectorAll("tr"));
		if (rowElements.length === 0) {
			return "";
		}

		const matrix: string[][] = [];
		for (const row of rowElements) {
			const cells = Array.from(row.children).filter((cell) => {
				const tag = this.getNodeLocalName(cell);
				return tag === "th" || tag === "td";
			});
			if (cells.length === 0) {
				continue;
			}
			const rowCells: string[] = [];
			for (const cell of cells) {
				const content = this.normalizeInlineMarkdown(
					await this.renderInlineNodesToMarkdown(Array.from(cell.childNodes), context)
				);
				rowCells.push(
					(
						content ||
						this.normalizeInlineMarkdown(this.normalizeInlineTextFragment(cell.textContent || ""))
					)
						.replace(/\n+/g, " <br> ")
						.replace(/\|/g, "\\|")
				);
			}
			matrix.push(rowCells);
		}

		if (matrix.length === 0) {
			return "";
		}

		const columnCount = Math.max(...matrix.map((row) => row.length));
		const padded = matrix.map((row) =>
			Array.from({ length: columnCount }, (_, index) => row[index] || "")
		);
		const hasHeader = Array.from(rowElements[0]?.children || []).some(
			(cell) => this.getNodeLocalName(cell) === "th"
		);
		const header = hasHeader
			? padded[0]
			: padded[0].map((cell, index) => cell || `列 ${index + 1}`);
		const bodyRows = hasHeader ? padded.slice(1) : padded;

		const lines = [
			`| ${header.join(" | ")} |`,
			`| ${header.map(() => "---").join(" | ")} |`,
			...bodyRows.map((row) => `| ${row.join(" | ")} |`),
		];
		return lines.join("\n");
	}

	private async renderImageElementAsMarkdown(
		imageElement: Element,
		context: MarkdownExportContext
	): Promise<string> {
		const src = String(
			imageElement.getAttribute("src") || imageElement.getAttribute("xlink:href") || ""
		).trim();
		const altText = this.normalizeInlineMarkdown(
			String(imageElement.getAttribute("alt") || imageElement.getAttribute("title") || "")
		);
		if (!src) {
			return altText;
		}
		if (this.isRemoteResourceUrl(src) || src.startsWith("//")) {
			const alt = altText || "image";
			return `![${alt}](${src})`;
		}

		const asset = await this.getOrCreateMarkdownAsset(src, context);
		return asset?.placeholder || altText;
	}

	private async getOrCreateMarkdownAsset(
		rawSrc: string,
		context: MarkdownExportContext
	): Promise<FoliateChapterExportAsset | null> {
		const normalizedSrc = String(rawSrc || "").trim();
		if (!normalizedSrc) {
			return null;
		}

		const sourceKey = normalizedSrc.startsWith("data:")
			? normalizedSrc
			: this.normalizeInternalHref(context.baseHref || normalizedSrc, normalizedSrc);
		if (!sourceKey) {
			return null;
		}

		const cached = context.assetBySource.get(sourceKey);
		if (cached) {
			return cached;
		}

		let bytes: Uint8Array | null = null;
		let mimeType = "application/octet-stream";
		if (sourceKey.startsWith("data:")) {
			const decoded = this.decodeDataUrl(sourceKey);
			if (!decoded) {
				return null;
			}
			bytes = decoded.bytes;
			mimeType = decoded.mimeType;
		} else if (sourceKey.startsWith("blob:")) {
			const blobResource = await this.readBinaryResource(sourceKey);
			if (!blobResource) {
				return null;
			}
			bytes = blobResource.bytes;
			mimeType = blobResource.mimeType || mimeType;
		} else {
			const entry = this.findArchiveEntry(sourceKey);
			if (entry) {
				bytes = new Uint8Array(await entry.async("uint8array"));
				mimeType = this.inferMimeType(sourceKey);
			} else {
				const blobResource = await this.readBinaryResource(sourceKey);
				if (!blobResource) {
					return null;
				}
				bytes = blobResource.bytes;
				mimeType = blobResource.mimeType || this.inferMimeType(sourceKey);
			}
		}

		if (!bytes || bytes.length === 0) {
			return null;
		}

		const asset: FoliateChapterExportAsset = {
			placeholder: `{{WEAVE_EPUB_ASSET_${context.assets.length}}}`,
			suggestedName: this.buildMarkdownAssetFileName(sourceKey, context.assets.length, mimeType),
			data: bytes,
			mimeType,
			originalHref: sourceKey.startsWith("data:") ? undefined : sourceKey,
		};
		context.assets.push(asset);
		context.assetBySource.set(sourceKey, asset);
		return asset;
	}

	private decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType: string } | null {
		const match = String(dataUrl || "").match(
			/^data:([^;,]+)?(?:;charset=[^;,]+)?(?:;(base64))?,(.*)$/i
		);
		if (!match) {
			return null;
		}
		const mimeType = String(match[1] || "application/octet-stream")
			.trim()
			.toLowerCase();
		const isBase64 = Boolean(match[2]);
		const payload = match[3] || "";
		try {
			if (isBase64) {
				const binary = atob(payload);
				const bytes = new Uint8Array(binary.length);
				for (let index = 0; index < binary.length; index += 1) {
					bytes[index] = binary.charCodeAt(index);
				}
				return { bytes, mimeType };
			}
			return {
				bytes: new TextEncoder().encode(decodeURIComponent(payload)),
				mimeType,
			};
		} catch {
			return null;
		}
	}

	private buildMarkdownAssetFileName(source: string, index: number, mimeType: string): string {
		const sourcePath = source.startsWith("data:") ? "" : this.stripFragmentAndQuery(source);
		const rawFileName = sourcePath.split("/").pop() || "";
		const dotIndex = rawFileName.lastIndexOf(".");
		const rawBaseName =
			dotIndex > 0 ? rawFileName.slice(0, dotIndex) : rawFileName || `image-${index + 1}`;
		const rawExtension =
			dotIndex > 0
				? rawFileName.slice(dotIndex + 1).toLowerCase()
				: this.getDefaultExtensionForMimeType(mimeType);
		const baseName = rawBaseName
			.replace(/[\\/:*?"<>|]/g, "_")
			.replace(/\s+/g, " ")
			.trim();
		const extension = rawExtension.replace(/[^A-Za-z0-9_-]/g, "");
		return extension
			? `${baseName || `image-${index + 1}`}.${extension}`
			: baseName || `image-${index + 1}`;
	}

	private getDefaultExtensionForMimeType(mimeType: string): string {
		switch (
			String(mimeType || "")
				.trim()
				.toLowerCase()
		) {
			case "image/png":
				return "png";
			case "image/jpeg":
				return "jpg";
			case "image/gif":
				return "gif";
			case "image/webp":
				return "webp";
			case "image/avif":
				return "avif";
			case "image/svg+xml":
				return "svg";
			default:
				return "bin";
		}
	}

	private stripLeadingMarkdownHeading(markdown: string, title: string): string {
		const normalizedMarkdown = this.normalizeExportedMarkdown(markdown);
		const normalizedTitle = this.normalizeComparableReadingPointTitle(title);
		if (!normalizedMarkdown || !normalizedTitle) {
			return normalizedMarkdown;
		}

		const headingMatch = normalizedMarkdown.match(/^#\s+(.+?)\n+/);
		if (!headingMatch) {
			return normalizedMarkdown;
		}

		if (this.normalizeComparableReadingPointTitle(headingMatch[1] || "") !== normalizedTitle) {
			return normalizedMarkdown;
		}

		return this.normalizeExportedMarkdown(normalizedMarkdown.slice(headingMatch[0].length));
	}

	private prefixMarkdownLines(markdown: string, prefix: string): string {
		return markdown
			.split("\n")
			.map((line) => (line.trim().length > 0 ? `${prefix}${line}` : prefix.trimEnd()))
			.join("\n");
	}

	private prefixListItemMarkdown(
		content: string,
		firstPrefix: string,
		continuationPrefix: string
	): string {
		const normalizedContent = this.normalizeExportedMarkdown(content);
		if (!normalizedContent) {
			return firstPrefix.trimEnd();
		}
		const lines = normalizedContent.split("\n");
		return lines
			.map((line, index) => {
				if (index === 0) {
					return `${firstPrefix}${line}`;
				}
				return line ? `${continuationPrefix}${line}` : "";
			})
			.join("\n");
	}

	private renderInlineCodeSpan(text: string): string {
		const normalized = String(text || "")
			.replace(/\r\n?/g, " ")
			.trim();
		if (!normalized) {
			return "";
		}
		const tickCount = (normalized.match(/`+/g) || []).reduce(
			(max, current) => Math.max(max, current.length),
			1
		);
		const fence = "`".repeat(tickCount + 1);
		return `${fence}${normalized}${fence}`;
	}

	private normalizeInlineTextFragment(text: string): string {
		return String(text || "")
			.replace(/\u00a0/g, " ")
			.replace(/\s+/g, " ");
	}

	private normalizeInlineMarkdown(markdown: string): string {
		return String(markdown || "")
			.replace(/\r\n?/g, "\n")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n[ \t]+/g, "\n")
			.replace(/[ \t]{2,}/g, " ")
			.trim();
	}

	private normalizeExportedMarkdown(markdown: string): string {
		return String(markdown || "")
			.replace(/\r\n?/g, "\n")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n[ \t]+/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
	}

	private nodeProducesBlockMarkdown(node: Node): boolean {
		if (node.nodeType !== Node.ELEMENT_NODE) {
			return false;
		}
		const tag = this.getNodeLocalName(node as Element);
		return Boolean(tag) && MARKDOWN_BLOCK_TAGS.has(tag);
	}

	private getNodeLocalName(node: Element): string {
		return String(node.localName || node.tagName || "").toLowerCase();
	}

	private stripLeadingSectionTitle(text: string, title: string): string {
		const normalizedTitle = this.normalizeComparableReadingPointTitle(title);
		if (!normalizedTitle) {
			return text.trim();
		}

		const lines = text.split("\n");
		const firstMeaningfulIndex = lines.findIndex((line) => line.trim().length > 0);
		if (firstMeaningfulIndex < 0) {
			return "";
		}

		if (
			this.normalizeComparableReadingPointTitle(lines[firstMeaningfulIndex] || "") !==
			normalizedTitle
		) {
			return text.trim();
		}

		const remaining = lines.slice(firstMeaningfulIndex + 1);
		while (remaining.length > 0 && !remaining[0]?.trim()) {
			remaining.shift();
		}
		return remaining.join("\n").trim();
	}

	private normalizeReadingPointTitle(value: string): string {
		const normalized = String(value || "")
			.replace(/\s+/g, " ")
			.trim();
		return normalized || "未命名章节";
	}

	private normalizeComparableReadingPointTitle(value: string): string {
		return this.normalizeReadingPointTitle(value)
			.replace(/^#{1,6}\s+/, "")
			.toLowerCase();
	}

	private repairMarkupText(raw: string, mediaType: string, path: string): string {
		try {
			const parserType = this.getMarkupParserType(mediaType);
			const doc = this.parseMarkupDocument(raw, parserType, path, true);
			this.sanitizeFoliateLoaderDocument(doc);
			return parserType === "text/html"
				? doc.documentElement.outerHTML
				: new XMLSerializer().serializeToString(doc);
		} catch {
			return raw;
		}
	}

	/**
	 * Loader-stage sanitization keeps iframe-based reader text extraction intact while
	 * stripping executable script vectors before markup reaches Foliate's sandboxed frame.
	 */
	private sanitizeFoliateLoaderDocument(doc: Document): void {
		for (const element of Array.from(doc.querySelectorAll("script, object, embed"))) {
			element.remove();
		}
		for (const metaElement of Array.from(doc.querySelectorAll("meta[http-equiv]"))) {
			const httpEquiv = metaElement.getAttribute("http-equiv") || "";
			if (shouldRemoveHttpEquivMeta(httpEquiv)) {
				metaElement.remove();
			}
		}
		for (const element of Array.from(doc.querySelectorAll("*"))) {
			for (const attribute of Array.from(element.attributes)) {
				const attributeName = attribute.name;
				const attributeValue = attribute.value || "";
				if (/^on/i.test(attributeName)) {
					element.removeAttribute(attributeName);
					continue;
				}
				if (
					DANGEROUS_URL_ATTRIBUTES.includes(attributeName.toLowerCase()) &&
					SCRIPT_PROTOCOL_PATTERN.test(attributeValue)
				) {
					element.removeAttribute(attributeName);
				}
			}
		}
	}

	private parseMarkupDocument(
		raw: string,
		parserType: DOMParserSupportedType,
		path: string,
		allowHtmlFallback = false
	): Document {
		const primaryDoc = new DOMParser().parseFromString(raw, parserType);
		if (!this.hasParserError(primaryDoc)) {
			return primaryDoc;
		}
		if (!allowHtmlFallback || parserType === "text/html") {
			throw new EpubError("invalid_markup", `EPUB XML parse failed: ${path}`, {
				filePath: this.filePath,
				path,
				parserType,
			});
		}

		const htmlDoc = new DOMParser().parseFromString(raw, "text/html");
		const expectedRootNames = this.getExpectedRootLocalNames(path);
		const hasExpectedRoot =
			expectedRootNames.length === 0 ||
			expectedRootNames.some((localName) =>
				Boolean(this.findFirstElementByLocalName(htmlDoc, localName))
			);
		if (!hasExpectedRoot) {
			throw new EpubError("invalid_markup", `EPUB XML parse failed: ${path}`, {
				filePath: this.filePath,
				path,
				parserType,
			});
		}
		return htmlDoc;
	}

	private hasParserError(doc: Document): boolean {
		return Boolean(this.findFirstElementByLocalName(doc, "parsererror")?.textContent?.trim());
	}

	private getExpectedRootLocalNames(path: string): string[] {
		const normalizedPath = this.stripFragmentAndQuery(path).toLowerCase();
		if (normalizedPath.endsWith("container.xml")) {
			return ["container"];
		}
		if (normalizedPath.endsWith(".opf")) {
			return ["package"];
		}
		if (normalizedPath.endsWith(".ncx")) {
			return ["ncx"];
		}
		if (
			normalizedPath.endsWith(".xhtml") ||
			normalizedPath.endsWith(".html") ||
			normalizedPath.endsWith(".htm")
		) {
			return ["html"];
		}
		if (normalizedPath.endsWith(".svg")) {
			return ["svg"];
		}
		return [];
	}

	private getMarkupParserType(mediaType: string): DOMParserSupportedType {
		const normalizedMediaType = String(mediaType || "")
			.trim()
			.toLowerCase();
		if (normalizedMediaType.includes("svg")) {
			return "image/svg+xml";
		}
		if (normalizedMediaType.includes("xhtml")) {
			return "application/xhtml+xml";
		}
		return normalizedMediaType.includes("html") ? "text/html" : "application/xhtml+xml";
	}

	private blobToDataUrl(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(unknownPlainText(reader.result));
			reader.onerror = () =>
				reject(reader.error instanceof Error ? reader.error : new Error("FileReader failed"));
			reader.readAsDataURL(blob);
		});
	}

	private readFoliateMetadataValue(value: unknown): string {
		if (typeof value === "string") {
			return value.trim();
		}
		if (Array.isArray(value)) {
			for (const item of value) {
				const next = this.readFoliateMetadataValue(item);
				if (next) {
					return next;
				}
			}
			return "";
		}
		if (value && typeof value === "object") {
			if ("name" in value) {
				return this.readFoliateMetadataValue((value as { name?: unknown }).name);
			}
			for (const entryValue of Object.values(value as Record<string, unknown>)) {
				const next = this.readFoliateMetadataValue(entryValue);
				if (next) {
					return next;
				}
			}
		}
		return "";
	}

	private readFoliateMetadataValues(value: unknown): string[] {
		const results: string[] = [];
		const seen = new Set<string>();
		const push = (entry: string) => {
			const normalized = entry.trim();
			if (!normalized || seen.has(normalized)) {
				return;
			}
			seen.add(normalized);
			results.push(normalized);
		};
		const visit = (entry: unknown) => {
			if (typeof entry === "string") {
				push(entry);
				return;
			}
			if (Array.isArray(entry)) {
				for (const item of entry) {
					visit(item);
				}
				return;
			}
			if (entry && typeof entry === "object") {
				if ("name" in entry) {
					visit((entry as { name?: unknown }).name);
					return;
				}
				for (const value of Object.values(entry as Record<string, unknown>)) {
					visit(value);
				}
			}
		};
		visit(value);
		return results;
	}

	private async readPackageMetadataDocument(): Promise<Document | null> {
		if (!this.archive || !this.packageDocumentPath) {
			return null;
		}
		const packageEntry = this.findArchiveEntry(this.packageDocumentPath);
		if (!packageEntry) {
			return null;
		}
		const raw = await packageEntry.async("text");
		return this.parseMarkupDocument(raw, "application/xml", this.packageDocumentPath);
	}

	private findElementsByLocalName(
		root: Element | Document | null | undefined,
		localName: string
	): Element[] {
		if (!root) {
			return [];
		}
		const normalizedLocalName = localName.toLowerCase();
		const matches: Element[] = [];
		if (
			domInstanceOf(root, Element) &&
			(root.localName || root.tagName).toLowerCase() === normalizedLocalName
		) {
			matches.push(root);
		}
		matches.push(
			...Array.from(root.getElementsByTagNameNS("*", localName)).filter(
				(element) => (element.localName || element.tagName).toLowerCase() === normalizedLocalName
			)
		);
		return matches;
	}

	private readElementText(element: Element | null | undefined): string {
		return String(element?.textContent || "").replace(/\s+/g, " ").trim();
	}

	private readMetaElementValue(element: Element | null | undefined): string {
		if (!element) {
			return "";
		}
		return element.getAttribute("content")?.trim() || this.readElementText(element);
	}

	private readPackageMetadataFirstText(
		doc: Document | null,
		localNames: string[]
	): string {
		for (const localName of localNames) {
			for (const element of this.findElementsByLocalName(doc, localName)) {
				const text = this.readElementText(element);
				if (text) {
					return text;
				}
			}
		}
		return "";
	}

	private readPackageMetadataTexts(
		doc: Document | null,
		localNames: string[]
	): string[] {
		const values: string[] = [];
		const seen = new Set<string>();
		for (const localName of localNames) {
			for (const element of this.findElementsByLocalName(doc, localName)) {
				const text = this.readElementText(element);
				if (!text || seen.has(text)) {
					continue;
				}
				seen.add(text);
				values.push(text);
			}
		}
		return values;
	}

	private readPackageMetaProperty(doc: Document | null, properties: string[]): string {
		if (!doc) {
			return "";
		}
		const normalizedProperties = new Set(properties.map((value) => value.toLowerCase()));
		for (const meta of this.findElementsByLocalName(doc, "meta")) {
			const property = meta.getAttribute("property")?.trim().toLowerCase();
			if (!property || !normalizedProperties.has(property)) {
				continue;
			}
			const value = this.readMetaElementValue(meta);
			if (value) {
				return value;
			}
		}
		return "";
	}

	private readPackageMetaNameContent(doc: Document | null, names: string[]): string {
		if (!doc) {
			return "";
		}
		const normalizedNames = new Set(names.map((value) => value.toLowerCase()));
		for (const meta of this.findElementsByLocalName(doc, "meta")) {
			const name = meta.getAttribute("name")?.trim().toLowerCase();
			if (!name || !normalizedNames.has(name)) {
				continue;
			}
			const value = this.readMetaElementValue(meta);
			if (value) {
				return value;
			}
		}
		return "";
	}

	private readPackagePrimaryIdentifier(doc: Document | null): string {
		if (!doc) {
			return "";
		}
		const packageElement = this.findFirstElementByLocalName(doc, "package");
		const uniqueIdentifierId = packageElement?.getAttribute("unique-identifier")?.trim();
		const identifiers = this.findElementsByLocalName(doc, "identifier");
		if (uniqueIdentifierId) {
			const matchingElement = identifiers.find(
				(element) => element.getAttribute("id")?.trim() === uniqueIdentifierId
			);
			const matchingValue = this.readElementText(matchingElement);
			if (matchingValue) {
				return matchingValue;
			}
		}
		for (const identifier of identifiers) {
			const value = this.readElementText(identifier);
			if (value) {
				return value;
			}
		}
		return "";
	}

	private readPackageContributorByRole(doc: Document | null, roles: Set<string>): string {
		if (!doc) {
			return "";
		}
		const contributors = [
			...this.findElementsByLocalName(doc, "contributor"),
			...this.findElementsByLocalName(doc, "creator"),
		];
		for (const contributor of contributors) {
			const name = this.readElementText(contributor);
			if (!name) {
				continue;
			}
			const role = this.readPackageContributorRole(doc, contributor).toLowerCase();
			if (role && roles.has(role)) {
				return name;
			}
		}
		return "";
	}

	private readPackageContributorRole(doc: Document, contributor: Element): string {
		const directRole =
			contributor.getAttribute("role")?.trim() ||
			contributor.getAttribute("opf:role")?.trim() ||
			Array.from(contributor.attributes).find((attribute) => attribute.localName === "role")?.value?.trim() ||
			"";
		if (directRole) {
			return directRole;
		}
		const contributorId = contributor.getAttribute("id")?.trim();
		if (!contributorId) {
			return "";
		}
		for (const meta of this.findElementsByLocalName(doc, "meta")) {
			const refines = meta.getAttribute("refines")?.trim();
			const property = meta.getAttribute("property")?.trim().toLowerCase();
			if (refines !== `#${contributorId}` || property !== "role") {
				continue;
			}
			const role = this.readMetaElementValue(meta);
			if (role) {
				return role;
			}
		}
		return "";
	}

	private extractIsbn(value: string | undefined): string {
		const normalizedValue = String(value || "").trim();
		if (!normalizedValue) {
			return "";
		}
		const matches = normalizedValue.match(/(?:97[89][0-9\-\s]{10,20}|[0-9][0-9\-\s]{8,20}[0-9Xx])/g) || [];
		for (const match of matches) {
			const compact = match.replace(/[^0-9Xx]/g, "").toUpperCase();
			if (compact.length === 10 || compact.length === 13) {
				return compact;
			}
		}
		return "";
	}

	private findFirstElementByLocalName(
		root: Element | Document | null | undefined,
		localName: string
	): Element | null {
		if (!root) {
			return null;
		}
		const normalizedLocalName = localName.toLowerCase();
		if (
			domInstanceOf(root, Element) &&
			(root.localName || root.tagName).toLowerCase() === normalizedLocalName
		) {
			return root;
		}
		const elements = Array.from(root.getElementsByTagNameNS("*", localName)).filter(
			(element) => (element.localName || element.tagName).toLowerCase() === normalizedLocalName
		);
		return elements[0] || null;
	}

	private buildFragmentSearchOrder(preferredHrefs: string[]): number[] {
		const preferredIndices = preferredHrefs
			.map((href) => this.getSectionIndexForHref(href))
			.filter((index) => index >= 0);
		const noteLikeIndices = this.sectionDescriptors
			.filter((section) => this.isLikelyNoteSectionHref(section.href))
			.map((section) => section.index)
			.sort((left, right) => right - left);
		const allIndicesDescending = this.getBook().sections
			.map((_, index) => index)
			.reverse();
		return Array.from(new Set([...preferredIndices, ...noteLikeIndices, ...allIndicesDescending]));
	}

	private isLikelyNoteSectionHref(href: string): boolean {
		const normalizedHref = this.stripFragmentAndQuery(href).toLowerCase();
		return /(?:footnote|endnote|rearnote|backnote|notes?|reference|references|annotation|commentary|zhu|zhushi)/.test(
			normalizedHref
		);
	}

	private normalizeInternalHref(baseHref: string, rawHref: string): string {
		const normalizedRawHref = this.normalizeLocationString(rawHref);
		if (!normalizedRawHref) {
			return this.normalizeSectionHref(baseHref);
		}
		if (this.shouldKeepOriginalUrl(normalizedRawHref) && !normalizedRawHref.startsWith("#")) {
			return normalizedRawHref;
		}
		const target = this.splitHrefComponents(normalizedRawHref);
		const basePath = this.stripFragmentAndQuery(baseHref);
		const baseDirectory = this.dirname(basePath);
		const directPath = target.path ? this.normalizePath(target.path.replace(/^\/+/, "")) : "";
		if (directPath && !target.path.startsWith("/") && Boolean(this.findArchiveEntry(directPath))) {
			return `${directPath}${target.query}${target.fragment}`;
		}
		const resolvedPath = target.path
			? target.path.startsWith("/")
				? this.normalizePath(target.path.replace(/^\/+/, ""))
				: this.normalizePath(baseDirectory ? `${baseDirectory}/${target.path}` : target.path)
			: this.normalizePath(basePath);
		return `${resolvedPath}${target.query}${target.fragment}`;
	}

	private normalizeSectionHref(href: string): string {
		const normalizedHref = this.normalizeLocationString(href);
		if (!normalizedHref) {
			return "";
		}
		if (this.shouldKeepOriginalUrl(normalizedHref) && !normalizedHref.startsWith("#")) {
			return normalizedHref;
		}
		const strippedHref = this.stripFragmentAndQuery(normalizedHref);
		if (!strippedHref) {
			return "";
		}
		if (
			strippedHref.startsWith("/") ||
			strippedHref === this.packageDocumentPath ||
			Boolean(this.findArchiveEntry(strippedHref))
		) {
			return strippedHref;
		}
		return this.stripFragmentAndQuery(
			this.normalizeInternalHref(this.packageDocumentPath || normalizedHref, normalizedHref)
		);
	}

	private stripFragmentAndQuery(href: string): string {
		return this.normalizePath(this.splitHrefComponents(href).path);
	}

	private findArchiveEntry(path: string): JSZip.JSZipObject | null {
		if (!this.archive) {
			return null;
		}
		for (const candidate of this.getArchivePathCandidates(path)) {
			const entry = this.archive.file(candidate);
			if (entry) {
				return entry;
			}
		}
		for (const candidate of this.getArchivePathCandidates(path)) {
			const matchedPath = this.archiveEntryLookup.get(candidate.toLowerCase());
			if (!matchedPath) {
				continue;
			}
			const entry = this.archive.file(matchedPath);
			if (entry) {
				return entry;
			}
		}
		return null;
	}

	private rebuildArchiveEntryLookup(): void {
		this.archiveEntryLookup.clear();
		if (!this.archive) {
			return;
		}
		this.archive.forEach((relativePath, entry) => {
			if (entry.dir) {
				return;
			}
			const normalizedPath = this.normalizePath(relativePath);
			if (!normalizedPath) {
				return;
			}
			this.archiveEntryLookup.set(normalizedPath.toLowerCase(), relativePath);
			this.archiveEntryLookup.set(`/${normalizedPath}`.toLowerCase(), relativePath);
		});
	}

	private getArchivePathCandidates(path: string): string[] {
		const normalized = this.normalizePath(path);
		if (!normalized) {
			return [];
		}
		const candidates = new Set<string>([normalized]);
		if (normalized.startsWith("/")) {
			candidates.add(normalized.slice(1));
		} else {
			candidates.add(`/${normalized}`);
		}
		return Array.from(candidates).filter(Boolean);
	}

	private extractHrefFragment(href: string): string | null {
		const fragment = this.splitHrefComponents(href).fragment.replace(/^#/, "").trim();
		if (!fragment) {
			return null;
		}
		try {
			return decodeURIComponent(fragment);
		} catch {
			return fragment;
		}
	}

	private dirname(path: string): string {
		const normalized = this.normalizePath(path);
		const lastSlashIndex = normalized.lastIndexOf("/");
		return lastSlashIndex >= 0 ? normalized.slice(0, lastSlashIndex) : "";
	}

	private normalizePath(path: string): string {
		const normalized = String(path || "").replace(/\\/g, "/");
		const isAbsolute = normalized.startsWith("/");
		const parts = normalized.split("/");
		const output: string[] = [];
		for (const part of parts) {
			if (!part || part === ".") {
				continue;
			}
			if (part === "..") {
				if (output.length > 0) {
					output.pop();
				}
				continue;
			}
			output.push(part);
		}
		return `${isAbsolute ? "/" : ""}${output.join("/")}`;
	}

	private normalizeLocationString(value: string): string {
		let normalized = String(value || "")
			.replace(/%5B/gi, "[")
			.replace(/%5D/gi, "]")
			.replace(/%7C/gi, "|");
		if (normalized.includes("%")) {
			try {
				normalized = decodeURIComponent(normalized);
			} catch {
				// Keep original value when decoding fails.
			}
		}
		return normalized.trim();
	}

	private shouldKeepOriginalUrl(value: string): boolean {
		const normalized = value.trim().toLowerCase();
		return (
			normalized.startsWith("data:") ||
			normalized.startsWith("blob:") ||
			normalized.startsWith("//") ||
			/^[a-z][a-z0-9+.-]*:/i.test(normalized) ||
			normalized.startsWith("#")
		);
	}

	private isDocumentHrefLike(value: string): boolean {
		const path = this.stripFragmentAndQuery(value).toLowerCase();
		return (
			path.endsWith(".xhtml") ||
			path.endsWith(".html") ||
			path.endsWith(".htm") ||
			path.endsWith(".svg")
		);
	}

	private isRewritableDocumentMediaType(mediaType: string): boolean {
		const normalizedMediaType = String(mediaType || "")
			.trim()
			.toLowerCase();
		return normalizedMediaType.includes("html") || normalizedMediaType.includes("svg");
	}

	private inferMimeType(href: string): string {
		const path = this.stripFragmentAndQuery(href).toLowerCase();
		const manifestMediaType = this.manifestMediaTypeByHref.get(path);
		if (manifestMediaType) {
			return manifestMediaType;
		}
		if (path.endsWith(".xhtml") || path.endsWith(".html") || path.endsWith(".htm")) {
			return "application/xhtml+xml";
		}
		if (path.endsWith(".css")) {
			return "text/css";
		}
		if (path.endsWith(".js") || path.endsWith(".mjs")) {
			return "text/javascript";
		}
		if (path.endsWith(".svg")) {
			return "image/svg+xml";
		}
		if (path.endsWith(".png")) {
			return "image/png";
		}
		if (path.endsWith(".jpg") || path.endsWith(".jpeg")) {
			return "image/jpeg";
		}
		if (path.endsWith(".gif")) {
			return "image/gif";
		}
		if (path.endsWith(".webp")) {
			return "image/webp";
		}
		if (path.endsWith(".avif")) {
			return "image/avif";
		}
		if (path.endsWith(".mp3")) {
			return "audio/mpeg";
		}
		if (path.endsWith(".m4a")) {
			return "audio/mp4";
		}
		if (path.endsWith(".ogg") || path.endsWith(".oga")) {
			return "audio/ogg";
		}
		if (path.endsWith(".mp4") || path.endsWith(".m4v")) {
			return "video/mp4";
		}
		if (path.endsWith(".webm")) {
			return "video/webm";
		}
		if (path.endsWith(".ttf")) {
			return "font/ttf";
		}
		if (path.endsWith(".otf")) {
			return "font/otf";
		}
		if (path.endsWith(".woff")) {
			return "font/woff";
		}
		if (path.endsWith(".woff2")) {
			return "font/woff2";
		}
		if (path.endsWith(".xml")) {
			return "application/xml";
		}
		return "application/octet-stream";
	}

	private getGenericPublicationMimeType(extension: string): string {
		switch (extension) {
			case "mobi":
				return "application/x-mobipocket-ebook";
			case "azw3":
				return "application/vnd.amazon.mobi8-ebook";
			case "fb2":
				return "application/x-fictionbook+xml";
			case "fbz":
				return "application/x-zip-compressed-fb2";
			case "cbz":
				return "application/vnd.comicbook+zip";
			default:
				return "application/octet-stream";
		}
	}

	private readableTitleFromHref(href: string): string {
		const path = this.stripFragmentAndQuery(href);
		const lastSegment = path.split("/").pop() || path;
		const withoutExtension = lastSegment.replace(/\.[^.]+$/, "");
		const normalized = withoutExtension.replace(/[_-]+/g, " ").trim();
		if (!normalized) {
			return "章节";
		}
		try {
			return decodeURIComponent(normalized);
		} catch {
			return normalized;
		}
	}

	private splitHrefComponents(value: string): { path: string; query: string; fragment: string } {
		const normalized = this.normalizeLocationString(value);
		const hashIndex = normalized.indexOf("#");
		const queryIndex = normalized.indexOf("?");
		let pathEnd = normalized.length;
		if (queryIndex >= 0) {
			pathEnd = Math.min(pathEnd, queryIndex);
		}
		if (hashIndex >= 0) {
			pathEnd = Math.min(pathEnd, hashIndex);
		}
		const path = normalized.slice(0, pathEnd);
		const query =
			queryIndex >= 0
				? normalized.slice(
						queryIndex,
						hashIndex >= 0 && queryIndex < hashIndex ? hashIndex : undefined
				  )
				: "";
		const fragment = hashIndex >= 0 ? normalized.slice(hashIndex) : "";
		return { path, query, fragment };
	}

	private clamp(value: number, min: number, max: number): number {
		return Math.min(Math.max(value, min), max);
	}
}

async function readBinaryResourceViaFetch(
	href: string
): Promise<{ bytes: Uint8Array; mimeType: string }> {
	if (isBlobResourceUrl(href)) {
		return readBlobUrlAsArrayBuffer(href);
	}
	if (typeof window.fetch !== "function") {
		throw new Error("Failed to load binary resource");
	}

	const response = await window.fetch(href);
	if (!response.ok) {
		throw new Error(`Failed to load binary resource: ${response.status} ${response.statusText}`);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	return {
		bytes,
		mimeType: String(response.headers.get("content-type") || "application/octet-stream")
			.trim()
			.toLowerCase(),
	};
}
