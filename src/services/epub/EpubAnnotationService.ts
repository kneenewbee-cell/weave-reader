import { t } from "../../utils/i18n";
import { generateCardUUID } from "../identifier/WeaveIDGenerator";
import type { EpubBacklinkHighlightService } from "./EpubBacklinkHighlightService";
import { EpubLinkService } from "./EpubLinkService";
import { isEpubGeneratedAnnotationNotePath } from "./epub-portable-data-location";
import {
	getReaderHighlightIdentityKey,
	mergeReaderHighlightsByIdentity,
} from "./highlight/highlight-identity";
import {
	findSameAnnotationRange,
	getAnnotationSemanticKey,
} from "./annotation-range-policy";
import type { EpubStorageService } from "./EpubStorageService";
import type { HighlightSourceLocator, ReaderHighlight } from "./reader-engine-types";
import { resolveDisplayProgress } from "./book-progress";
import {
	loadEffectiveEpubSemanticProfile,
	readEffectiveEpubPortableAnnotations,
	writeBookEpubPortableAnnotations,
} from "./semantic/semantic-store";
import {
	activeSemanticEntries,
	resolveAnnotationPresentation,
	toReaderAnnotationStyle,
} from "./semantic/profiles";
import type { ConcealedText, HighlightColor } from "./types";

export type EpubPortableHighlightSaveResult =
	| {
			kind: "create";
			current: ReaderHighlight;
	  }
	| {
			kind: "replace";
			previous: ReaderHighlight;
			current: ReaderHighlight;
	  }
	| {
			kind: "duplicate";
			current: ReaderHighlight;
	  }
	| {
			kind: "noop";
	  };

export class EpubAnnotationService {
	private storageService: EpubStorageService;
	private clearedLegacyHighlightBooks = new Set<string>();
	private collectedHighlightsCache = new Map<string, ReaderHighlight[]>();
	private inflightCollectedHighlights = new Map<string, Promise<ReaderHighlight[]>>();

	constructor(storageService: EpubStorageService) {
		this.storageService = storageService;
	}

	invalidateCollectedHighlightsCache(bookId?: string, filePath?: string): void {
		const normalizedBookId = String(bookId || "").trim();
		const normalizedFilePath = String(filePath || "").trim();
		if (!normalizedBookId && !normalizedFilePath) {
			this.collectedHighlightsCache.clear();
			this.inflightCollectedHighlights.clear();
			return;
		}

		for (const key of Array.from(this.collectedHighlightsCache.keys())) {
			if (this.matchesCollectedHighlightsCacheKey(key, normalizedBookId, normalizedFilePath)) {
				this.collectedHighlightsCache.delete(key);
			}
		}
		for (const key of Array.from(this.inflightCollectedHighlights.keys())) {
			if (this.matchesCollectedHighlightsCacheKey(key, normalizedBookId, normalizedFilePath)) {
				this.inflightCollectedHighlights.delete(key);
			}
		}
	}

	async createConcealedText(
		bookId: string,
		text: string,
		chapterIndex: number,
		cfiRange: string,
		mode: ConcealedText["mode"] = "mask"
	): Promise<ConcealedText> {
		const concealedText: ConcealedText = {
			id: generateCardUUID(),
			text,
			mode,
			chapterIndex,
			cfiRange,
			createdTime: Date.now(),
		};

		await this.storageService.addConcealedText(bookId, concealedText);
		return concealedText;
	}

	async deleteConcealedTextByCfi(bookId: string, cfiRange: string): Promise<void> {
		const normalizedTarget = EpubLinkService.normalizeCfi(cfiRange);
		const concealedTexts = await this.storageService.loadConcealedTexts(bookId);
		const filtered = concealedTexts.filter(
			(item) => EpubLinkService.normalizeCfi(item.cfiRange) !== normalizedTarget
		);
		await this.storageService.saveConcealedTexts(bookId, filtered);
	}

	async getConcealedTexts(bookId: string): Promise<ConcealedText[]> {
		return await this.storageService.loadConcealedTexts(bookId);
	}

	async exportToMarkdown(
		bookId: string,
		options: {
			filePath?: string;
			backlinkService?: EpubBacklinkHighlightService;
		} = {}
	): Promise<string> {
		const book = await this.storageService.getBook(bookId);
		if (!book) {
			throw new Error("Book not found");
		}

		const liveHighlights =
			options.backlinkService && (options.filePath || book.filePath)
				? await this.collectAllHighlights(
						bookId,
						options.filePath || book.filePath,
						options.backlinkService
				  )
				: [];
		const highlights = liveHighlights.filter(
			(item): item is ReaderHighlight & { color: HighlightColor; text: string } =>
				item.presentation === "highlight" && item.color !== "mask" && typeof item.text === "string"
		);
		const linkService = new EpubLinkService(this.storageService.getApp());

		let markdown = `# ${book.metadata.title} - ${t("epub.export.readingNotes")}\n\n`;
		markdown += `## ${t("epub.export.bookInfo")}\n\n`;
		markdown += `- **${t("epub.export.author")}**: ${book.metadata.author}\n`;
		if (book.metadata.publisher) {
			markdown += `- **${t("epub.export.publisher")}**: ${book.metadata.publisher}\n`;
		}
		if (book.metadata.isbn) {
			markdown += `- **ISBN**: ${book.metadata.isbn}\n`;
		}
		markdown += `- **${t("epub.export.readingProgress")}**: ${resolveDisplayProgress(book)}%\n`;
		markdown += "\n";

		if (highlights.length > 0) {
			markdown += `## ${t("epub.export.highlights")}\n\n`;
			const sortedHighlights = [...highlights].sort((a, b) => {
				const timeA = typeof a.createdTime === "number" ? a.createdTime : 0;
				const timeB = typeof b.createdTime === "number" ? b.createdTime : 0;
				if (timeA !== timeB) {
					return timeA - timeB;
				}
				const chapterA =
					typeof a.chapterIndex === "number" ? a.chapterIndex : Number.MAX_SAFE_INTEGER;
				const chapterB =
					typeof b.chapterIndex === "number" ? b.chapterIndex : Number.MAX_SAFE_INTEGER;
				if (chapterA !== chapterB) {
					return chapterA - chapterB;
				}
				return a.text.localeCompare(b.text, "zh-CN");
			});

			for (const highlight of sortedHighlights) {
				markdown += linkService.buildQuoteBlock(
					options.filePath || book.filePath,
					highlight.cfiRange,
					highlight.text,
					highlight.chapterIndex,
					highlight.color,
					highlight.chapterTitle,
					this.formatHighlightTimestamp(highlight.createdTime),
					undefined,
					book.sourceId,
					highlight.excerptId,
					highlight.style,
					EpubLinkService.MAX_CHAPTER_LABEL_LENGTH,
					highlight.semanticId
				);
				markdown += "\n";
			}
		}

		return markdown;
	}

	private formatHighlightTimestamp(timestamp?: number): string | undefined {
		if (!timestamp || !Number.isFinite(timestamp)) {
			return undefined;
		}
		const date = new Date(timestamp);
		if (Number.isNaN(date.getTime())) {
			return undefined;
		}
		const y = date.getFullYear();
		const mo = String(date.getMonth() + 1).padStart(2, "0");
		const d = String(date.getDate()).padStart(2, "0");
		const h = String(date.getHours()).padStart(2, "0");
		const mi = String(date.getMinutes()).padStart(2, "0");
		return `${y}-${mo}-${d} ${h}:${mi}`;
	}

	private buildCollectedHighlightsCacheKey(
		bookId: string,
		filePath: string,
		boundCanvasPath?: string | null
	): string {
		return [
			String(bookId || "").trim(),
			String(filePath || "").trim(),
			String(boundCanvasPath || "").trim(),
		].join("::");
	}

	private matchesCollectedHighlightsCacheKey(
		key: string,
		bookId?: string,
		filePath?: string
	): boolean {
		const [cachedBookId = "", cachedFilePath = ""] = key.split("::");
		if (bookId && cachedBookId !== bookId) {
			return false;
		}
		if (filePath && cachedFilePath !== filePath) {
			return false;
		}
		return true;
	}

	private cloneCollectedHighlights(highlights: ReaderHighlight[]): ReaderHighlight[] {
		return highlights.map((highlight) => {
			const sourceLocators = Array.isArray(highlight.sourceLocators)
				? highlight.sourceLocators.map((locator) => ({ ...locator }))
				: undefined;
			return {
				...highlight,
				...(sourceLocators ? { sourceLocators } : {}),
			};
		});
	}

	private getApp() {
		return typeof this.storageService.getApp === "function"
			? this.storageService.getApp()
			: null;
	}

	private isActiveSemanticAnnotation(annotation: unknown, profile?: unknown): boolean {
		if (!annotation || typeof annotation !== "object") {
			return false;
		}
		const semanticId = String((annotation as { semanticId?: unknown }).semanticId || "").trim();
		if (!semanticId || !profile) {
			return true;
		}
		return (activeSemanticEntries(profile) as Array<{ id?: unknown }>).some(
			(entry) => String(entry?.id || "").trim() === semanticId
		);
	}

	private async loadEffectiveSemanticProfile(bookId: string): Promise<unknown | null> {
		const app = this.getApp();
		if (!app) {
			return null;
		}
		try {
			return (await loadEffectiveEpubSemanticProfile(app, bookId, {})).effectiveProfile;
		} catch (error) {
			console.warn("[EpubAnnotationService] Failed to load semantic profile:", error);
			return null;
		}
	}

	private normalizePortableAnnotation(annotation: unknown, profile?: unknown): ReaderHighlight | null {
		if (!annotation || typeof annotation !== "object") {
			return null;
		}
		const presentedAnnotation = profile
			? resolveAnnotationPresentation(annotation, profile)
			: annotation as Record<string, unknown>;
		const cfiRange = EpubLinkService.normalizeCfi(
			String((presentedAnnotation as { cfiRange?: unknown }).cfiRange || "").trim()
		);
		const text = String((presentedAnnotation as { text?: unknown }).text || "").trim();
		if (!cfiRange || !text) {
			return null;
		}
		const color = String((presentedAnnotation as { color?: unknown }).color || "yellow")
			.trim()
			.toLowerCase() as HighlightColor;
		const rawStyle = String((presentedAnnotation as { style?: unknown }).style || "").trim();
		const style = toReaderAnnotationStyle(rawStyle);
		const semanticId = String((presentedAnnotation as { semanticId?: unknown }).semanticId || "").trim();
		const semanticLabel = String((presentedAnnotation as { semanticLabel?: unknown }).semanticLabel || "").trim();
		const semanticGroup = String((presentedAnnotation as { semanticGroup?: unknown }).semanticGroup || "").trim();
		const semanticDescription = String(
			(presentedAnnotation as { semanticDescription?: unknown }).semanticDescription || ""
		).trim();
		const semanticSource = String((presentedAnnotation as { semanticSource?: unknown }).semanticSource || "").trim();
		const chapterTitle = String((presentedAnnotation as { chapterTitle?: unknown }).chapterTitle || "").trim();
		const chapterRootTitle = String(
			(presentedAnnotation as { chapterRootTitle?: unknown }).chapterRootTitle || ""
		).trim();
		const chapterPath = Array.isArray((presentedAnnotation as { chapterPath?: unknown }).chapterPath)
			? ((presentedAnnotation as { chapterPath?: unknown[] }).chapterPath || [])
					.map((entry) => String(entry || "").trim())
					.filter(Boolean)
			: [];
		const chapterHref = String((presentedAnnotation as { chapterHref?: unknown }).chapterHref || "").trim();
		const commentText = String((presentedAnnotation as { commentText?: unknown }).commentText || "").trim();
		const chapterIndex = (presentedAnnotation as { chapterIndex?: unknown }).chapterIndex;
		const spineIndex = (presentedAnnotation as { spineIndex?: unknown }).spineIndex;
		const createdTime = (presentedAnnotation as { createdTime?: unknown }).createdTime;
		const updatedAt = (presentedAnnotation as { updatedAt?: unknown }).updatedAt;

		return {
			cfiRange,
			color,
			...(style ? { style } : {}),
			...(semanticId ? { semanticId } : {}),
			...(semanticLabel ? { semanticLabel } : {}),
			...(semanticGroup ? { semanticGroup } : {}),
			...(semanticDescription ? { semanticDescription } : {}),
			...(semanticSource ? { semanticSource } : {}),
			text,
			...(commentText ? { commentText } : {}),
			...((presentedAnnotation as { hasCommentDivider?: unknown }).hasCommentDivider === true
				? { hasCommentDivider: true }
				: {}),
			...(typeof chapterIndex === "number" && Number.isFinite(chapterIndex) ? { chapterIndex } : {}),
			...(chapterTitle ? { chapterTitle } : {}),
			...(chapterRootTitle ? { chapterRootTitle } : {}),
			...(chapterPath.length > 0 ? { chapterPath } : {}),
			...(chapterHref ? { chapterHref } : {}),
			...(typeof spineIndex === "number" && Number.isFinite(spineIndex) ? { spineIndex } : {}),
			...(typeof createdTime === "number" && Number.isFinite(createdTime) ? { createdTime } : {}),
			...(typeof updatedAt === "number" && Number.isFinite(updatedAt) ? { updatedAt } : {}),
			presentation: "highlight",
		};
	}

	private async loadPortableHighlights(
		bookId: string,
		effectiveProfile?: unknown | null
	): Promise<ReaderHighlight[]> {
		const app = this.getApp();
		if (!app) {
			return [];
		}
		try {
			const [resolvedProfile, payload] =
				effectiveProfile === undefined
					? await Promise.all([
							this.loadEffectiveSemanticProfile(bookId),
							readEffectiveEpubPortableAnnotations(app, bookId),
						])
					: [effectiveProfile, await readEffectiveEpubPortableAnnotations(app, bookId)];
			return payload.annotations
				.map((annotation) => this.normalizePortableAnnotation(annotation, resolvedProfile))
				.filter((highlight): highlight is ReaderHighlight => Boolean(highlight));
		} catch (error) {
			console.warn("[EpubAnnotationService] Failed to load portable annotations:", error);
			return [];
		}
	}

	private getPortableHighlightRemovalKey(
		existing: ReaderHighlight[],
		target: ReaderHighlight
	): string {
		const targetKey = getReaderHighlightIdentityKey(target);
		if (!targetKey) {
			return "";
		}
		if (existing.some((item) => getReaderHighlightIdentityKey(item) === targetKey)) {
			return targetKey;
		}

		const targetCfi = EpubLinkService.normalizeCfi(target.cfiRange);
		const targetSemanticId = String(target.semanticId || "").trim();
		if (!targetCfi || !targetSemanticId) {
			return targetKey;
		}
		const sameSemanticRange = existing.filter((item) => (
			EpubLinkService.normalizeCfi(item.cfiRange) === targetCfi &&
			String(item.semanticId || "").trim() === targetSemanticId
		));
		if (sameSemanticRange.length !== 1) {
			return targetKey;
		}
		return getReaderHighlightIdentityKey(sameSemanticRange[0]) || targetKey;
	}

	async savePortableHighlight(bookId: string, highlight: ReaderHighlight): Promise<void> {
		await this.savePortableHighlightWithPolicy(bookId, highlight);
	}

	async savePortableHighlightWithPolicy(
		bookId: string,
		highlight: ReaderHighlight
	): Promise<EpubPortableHighlightSaveResult> {
		const app = this.getApp();
		if (!app || !String(bookId || "").trim()) {
			return { kind: "noop" };
		}
		try {
			const [profileResult, payload] = await Promise.all([
				loadEffectiveEpubSemanticProfile(app, bookId, {}),
				readEffectiveEpubPortableAnnotations(app, bookId),
			]);
			const normalizedIncoming = this.normalizePortableAnnotation(highlight, profileResult.effectiveProfile);
			if (!normalizedIncoming) {
				return { kind: "noop" };
			}
			const existing = payload.annotations
				.map((annotation) => this.normalizePortableAnnotation(annotation, profileResult.effectiveProfile))
				.filter((item): item is ReaderHighlight => Boolean(item));
			const sameRange = findSameAnnotationRange(existing, normalizedIncoming);
			if (sameRange) {
				if (getAnnotationSemanticKey(sameRange) === getAnnotationSemanticKey(normalizedIncoming)) {
					return {
						kind: "duplicate",
						current: sameRange,
					};
				}
				const sameRangeKey = getReaderHighlightIdentityKey(sameRange);
				const remaining = existing.filter(
					(item) => getReaderHighlightIdentityKey(item) !== sameRangeKey
				);
				const merged = mergeReaderHighlightsByIdentity(remaining, [normalizedIncoming]);
				await writeBookEpubPortableAnnotations(app, bookId, merged);
				this.invalidateCollectedHighlightsCache(bookId);
				return {
					kind: "replace",
					previous: sameRange,
					current: normalizedIncoming,
				};
			}
			const merged = mergeReaderHighlightsByIdentity(existing, [normalizedIncoming]);
			await writeBookEpubPortableAnnotations(app, bookId, merged);
			this.invalidateCollectedHighlightsCache(bookId);
			return {
				kind: "create",
				current: normalizedIncoming,
			};
		} catch (error) {
			console.warn("[EpubAnnotationService] Failed to save portable annotation:", error);
			return { kind: "noop" };
		}
	}

	async removePortableHighlight(bookId: string, highlight: ReaderHighlight): Promise<ReaderHighlight | null> {
		const app = this.getApp();
		if (!app || !String(bookId || "").trim()) {
			return null;
		}
		try {
			const [profileResult, payload] = await Promise.all([
				loadEffectiveEpubSemanticProfile(app, bookId, {}),
				readEffectiveEpubPortableAnnotations(app, bookId),
			]);
			const normalizedTarget = this.normalizePortableAnnotation(highlight, profileResult.effectiveProfile);
			if (!normalizedTarget) {
				return null;
			}
			const existing = payload.annotations
				.map((annotation) => this.normalizePortableAnnotation(annotation, profileResult.effectiveProfile))
				.filter((item): item is ReaderHighlight => Boolean(item));
			const targetKey = this.getPortableHighlightRemovalKey(existing, normalizedTarget);
			if (!targetKey) {
				return null;
			}
			let removed: ReaderHighlight | null = null;
			const remaining = existing.filter((item) => {
				if (getReaderHighlightIdentityKey(item) !== targetKey) {
					return true;
				}
				removed = removed || item;
				return false;
			});
			if (!removed) {
				return null;
			}
			await writeBookEpubPortableAnnotations(app, bookId, remaining);
			this.invalidateCollectedHighlightsCache(bookId);
			return removed;
		} catch (error) {
			console.warn("[EpubAnnotationService] Failed to remove portable annotation:", error);
			return null;
		}
	}

	async replacePortableHighlight(
		bookId: string,
		before: ReaderHighlight,
		after: ReaderHighlight
	): Promise<{ previous: ReaderHighlight | null; current: ReaderHighlight } | null> {
		const app = this.getApp();
		if (!app || !String(bookId || "").trim()) {
			return null;
		}
		try {
			const [profileResult, payload] = await Promise.all([
				loadEffectiveEpubSemanticProfile(app, bookId, {}),
				readEffectiveEpubPortableAnnotations(app, bookId),
			]);
			const normalizedBefore = this.normalizePortableAnnotation(before, profileResult.effectiveProfile);
			const normalizedAfter = this.normalizePortableAnnotation(after, profileResult.effectiveProfile);
			if (!normalizedAfter) {
				return null;
			}
			const beforeKey = normalizedBefore ? getReaderHighlightIdentityKey(normalizedBefore) : "";
			let previous: ReaderHighlight | null = null;
			const remaining = payload.annotations
				.map((annotation) => this.normalizePortableAnnotation(annotation, profileResult.effectiveProfile))
				.filter((item): item is ReaderHighlight => Boolean(item))
				.filter((item) => {
					if (beforeKey && getReaderHighlightIdentityKey(item) === beforeKey) {
						previous = previous || item;
						return false;
					}
					return true;
				});
			const merged = mergeReaderHighlightsByIdentity(remaining, [normalizedAfter]);
			await writeBookEpubPortableAnnotations(app, bookId, merged);
			this.invalidateCollectedHighlightsCache(bookId);
			return {
				previous,
				current: normalizedAfter,
			};
		} catch (error) {
			console.warn("[EpubAnnotationService] Failed to replace portable annotation:", error);
			return null;
		}
	}

	private async clearLegacyHighlightCache(bookId: string): Promise<void> {
		if (this.clearedLegacyHighlightBooks.has(bookId)) {
			return;
		}
		await this.storageService.removeLegacyHighlights(bookId);
		this.clearedLegacyHighlightBooks.add(bookId);
	}

	private collectHighlightSourceLocators(highlight: {
		sourceFile?: string;
		sourceRef?: string;
		excerptId?: string;
		sourceLocators?: HighlightSourceLocator[];
	}): HighlightSourceLocator[] {
		const locators: HighlightSourceLocator[] = [];
		const primarySourceFile = String(highlight.sourceFile || "").trim();
		if (primarySourceFile) {
			locators.push({
				sourceFile: primarySourceFile,
				sourceRef: highlight.sourceRef,
				...(highlight.excerptId ? { excerptId: highlight.excerptId } : {}),
			});
		}
		for (const locator of highlight.sourceLocators || []) {
			const sourceFile = String(locator?.sourceFile || "").trim();
			if (!sourceFile) continue;
			locators.push({
				sourceFile,
				sourceRef: locator.sourceRef,
				...(locator.excerptId ? { excerptId: locator.excerptId } : {}),
			});
		}
		return this.mergeHighlightSourceLocators([], locators);
	}

	private isGeneratedAnnotationNoteSourcePath(sourcePath: unknown): boolean {
		return isEpubGeneratedAnnotationNotePath(sourcePath);
	}

	private excludeGeneratedAnnotationNoteLocators(
		locators: HighlightSourceLocator[]
	): HighlightSourceLocator[] {
		return locators.filter(
			(locator) => !this.isGeneratedAnnotationNoteSourcePath(locator.sourceFile)
		);
	}

	private mergeHighlightSourceLocators(
		existing: HighlightSourceLocator[],
		incoming: HighlightSourceLocator[]
	): HighlightSourceLocator[] {
		const merged = new Map<string, HighlightSourceLocator>();
		for (const locator of [...existing, ...incoming]) {
			const sourceFile = String(locator?.sourceFile || "").trim();
			if (!sourceFile) continue;
			const normalizedRef = String(locator?.sourceRef || "").trim();
			const normalizedExcerptId = String(locator?.excerptId || "").trim();
			const key = `${sourceFile}::${normalizedRef}::${normalizedExcerptId}`;
			if (!merged.has(key)) {
				merged.set(key, {
					sourceFile,
					sourceRef: normalizedRef || undefined,
					...(normalizedExcerptId ? { excerptId: normalizedExcerptId } : {}),
				});
			}
		}
		return Array.from(merged.values());
	}

	private selectPrimarySourceLocator(
		locators: HighlightSourceLocator[]
	): HighlightSourceLocator | null {
		if (locators.length === 0) {
			return null;
		}

		const cardLocator = locators.find(
			(locator) => typeof locator.sourceRef === "string" && locator.sourceRef.startsWith("card:")
		);
		if (cardLocator) {
			return cardLocator;
		}

		const referencedLocator = locators.find(
			(locator) => typeof locator.sourceRef === "string" && locator.sourceRef.trim().length > 0
		);
		if (referencedLocator) {
			return referencedLocator;
		}

		const markdownLocator = locators.find((locator) => locator.sourceFile.endsWith(".md"));
		if (markdownLocator) {
			return markdownLocator;
		}

		const canvasLocator = locators.find((locator) => locator.sourceFile.endsWith(".canvas"));
		if (canvasLocator) {
			return canvasLocator;
		}

		const wdeckLocator = locators.find((locator) => locator.sourceFile.endsWith(".wdeck"));
		if (wdeckLocator) {
			return wdeckLocator;
		}

		const jsonLocator = locators.find((locator) => locator.sourceFile.endsWith(".json"));
		if (jsonLocator) {
			return jsonLocator;
		}

		return locators[0] || null;
	}

	async collectAllHighlights(
		bookId: string,
		filePath: string,
		backlinkService: EpubBacklinkHighlightService,
		options?: { additionalSourcePaths?: string[]; diskIncremental?: boolean }
	): Promise<ReaderHighlight[]> {
		const boundCanvasPath = await this.storageService.getCanvasBinding(bookId);
		const hasAdditionalSourcePaths =
			Array.isArray(options?.additionalSourcePaths) && options.additionalSourcePaths.length > 0;
		const additionalSourcePaths = options?.additionalSourcePaths || [];
		const useDiskIncremental =
			options?.diskIncremental === true && additionalSourcePaths.length > 0;
		const cacheKey = this.buildCollectedHighlightsCacheKey(bookId, filePath, boundCanvasPath);
		if (!hasAdditionalSourcePaths) {
			const cached = this.collectedHighlightsCache.get(cacheKey);
			if (cached) {
				return this.cloneCollectedHighlights(cached);
			}

			const inflight = this.inflightCollectedHighlights.get(cacheKey);
			if (inflight) {
				return this.cloneCollectedHighlights(await inflight);
			}
		}

		const loadPromise = (async () => {
			const allHighlightsByKey = new Map<string, ReaderHighlight>();
			// 历史版本会把 EPUB 高亮重复写入本地 highlights.json，导致源摘录删除后界面仍残留。
			// 现在统一以 md/canvas/卡片中的真实摘录为准，因此这里直接移除遗留缓存文件。
			await this.clearLegacyHighlightCache(bookId);

			const effectiveSemanticProfile = await this.loadEffectiveSemanticProfile(bookId);
			const portableHighlights = await this.loadPortableHighlights(bookId, effectiveSemanticProfile);
			for (const portableHighlight of portableHighlights) {
				const identity = getReaderHighlightIdentityKey(portableHighlight);
				if (identity) {
					allHighlightsByKey.set(identity, portableHighlight);
				}
			}

			const backlinkHighlights = useDiskIncremental
				? await backlinkService.refreshBookHighlightsIncremental(
						filePath,
						additionalSourcePaths,
						boundCanvasPath
				  )
				: await backlinkService.collectHighlights(
						filePath,
						boundCanvasPath,
						hasAdditionalSourcePaths ? options : undefined
				  );
			for (const bh of backlinkHighlights) {
				if (!this.isActiveSemanticAnnotation(bh, effectiveSemanticProfile)) {
					continue;
				}
				const incomingLocators = this.excludeGeneratedAnnotationNoteLocators(
					this.collectHighlightSourceLocators(bh)
				);
				if (incomingLocators.length === 0) {
					continue;
				}
				const incomingIdentity = getReaderHighlightIdentityKey(bh);
				const existing = allHighlightsByKey.get(incomingIdentity);
				if (existing) {
					existing.sourceLocators = this.mergeHighlightSourceLocators(
						existing.sourceLocators || [],
						incomingLocators
					);
					if (existing.chapterIndex === undefined && bh.chapterIndex !== undefined) {
						existing.chapterIndex = bh.chapterIndex;
					}
					if (!existing.chapterTitle && bh.chapterTitle) {
						existing.chapterTitle = bh.chapterTitle;
					}
					if (!existing.chapterRootTitle && bh.chapterRootTitle) {
						existing.chapterRootTitle = bh.chapterRootTitle;
					}
					if ((!existing.chapterPath || existing.chapterPath.length === 0) && bh.chapterPath?.length) {
						existing.chapterPath = bh.chapterPath;
					}
					if (!existing.chapterHref && bh.chapterHref) {
						existing.chapterHref = bh.chapterHref;
					}
					if (existing.spineIndex === undefined && bh.spineIndex !== undefined) {
						existing.spineIndex = bh.spineIndex;
					}
					if (existing.style === undefined && bh.style !== undefined) {
						existing.style = bh.style;
					}
					if (!existing.semanticId && bh.semanticId) {
						existing.semanticId = bh.semanticId;
						existing.semanticLabel = bh.semanticLabel;
						existing.semanticGroup = bh.semanticGroup;
						existing.semanticDescription = bh.semanticDescription;
						existing.semanticSource = bh.semanticSource;
					}
					if (bh.commentText !== undefined) {
						existing.commentText = bh.commentText;
					}
					if (bh.hasCommentDivider !== undefined) {
						existing.hasCommentDivider = bh.hasCommentDivider;
					}
					if (existing.createdTime === undefined && bh.createdTime !== undefined) {
						existing.createdTime = bh.createdTime;
					}
					const primaryLocator = this.selectPrimarySourceLocator(existing.sourceLocators);
					if (primaryLocator) {
						existing.sourceFile = primaryLocator.sourceFile;
						existing.sourceRef = primaryLocator.sourceRef;
						existing.excerptId = primaryLocator.excerptId;
					}
				} else {
					const primaryLocator = this.selectPrimarySourceLocator(incomingLocators);
					allHighlightsByKey.set(incomingIdentity, {
						cfiRange: bh.cfiRange,
						color: bh.color,
						style: bh.style,
						semanticId: bh.semanticId,
						semanticLabel: bh.semanticLabel,
						semanticGroup: bh.semanticGroup,
						semanticDescription: bh.semanticDescription,
						semanticSource: bh.semanticSource,
						text: bh.text,
						commentText: bh.commentText,
						hasCommentDivider: bh.hasCommentDivider,
						chapterIndex: bh.chapterIndex,
						chapterTitle: bh.chapterTitle,
						chapterRootTitle: bh.chapterRootTitle,
						chapterPath: bh.chapterPath,
						chapterHref: bh.chapterHref,
						spineIndex: bh.spineIndex,
						sourceFile: primaryLocator?.sourceFile || bh.sourceFile,
						sourceRef: primaryLocator?.sourceRef || bh.sourceRef,
						excerptId: primaryLocator?.excerptId || bh.excerptId,
						sourceLocators: incomingLocators,
						createdTime: bh.createdTime,
						presentation: "highlight",
					});
				}
			}

			const allHighlights = Array.from(allHighlightsByKey.values());
			for (const concealedText of await this.getConcealedTexts(bookId)) {
				allHighlights.push({
					cfiRange: concealedText.cfiRange,
					color: "mask",
					text: concealedText.text,
					createdTime: concealedText.createdTime,
					presentation: "conceal",
				});
			}

			const snapshot = this.cloneCollectedHighlights(allHighlights);
			if (!hasAdditionalSourcePaths) {
				this.collectedHighlightsCache.set(cacheKey, snapshot);
			}
			return snapshot;
		})();

		if (!hasAdditionalSourcePaths) {
			this.inflightCollectedHighlights.set(cacheKey, loadPromise);
		}
		try {
			return this.cloneCollectedHighlights(await loadPromise);
		} finally {
			if (this.inflightCollectedHighlights.get(cacheKey) === loadPromise) {
				this.inflightCollectedHighlights.delete(cacheKey);
			}
		}
	}
}
