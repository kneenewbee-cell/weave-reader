import type { App } from "obsidian";
import { EpubLinkService } from "./EpubLinkService";
import type { EpubBacklinkHighlightService, BacklinkHighlight } from "./EpubBacklinkHighlightService";
import { buildEpubMarkdownLocateCandidates } from "../ui/source-locate-candidates";
import { logger } from "../../utils/logger";

/**
 * 引用来源信息
 */
export type ReferenceSourceType = "markdown" | "canvas" | "card";

export interface ReferenceSourceInfo {
	key: string;
	file: string;
	type: ReferenceSourceType;
	sourceRef?: string;
	excerptId?: string;
	nodeId?: string;
	createdAt?: number;
	displayName: string;
	folderPath: string;
	locateCandidates: string[];
}

export interface ReferenceStatsSummary {
	uniqueFileCount: number;
	timeSpanDays: number | null;
	typeCounts: Record<ReferenceSourceType, number>;
}

/**
 * 引用统计数据
 */
export interface ReferenceStats {
	cfi: string;
	text: string;
	referenceCount: number;
	sources: ReferenceSourceInfo[];
	firstReferenceDate?: number;
	lastReferenceDate?: number;
	referenceHeat: number; // 0-100
	summary: ReferenceStatsSummary;
}

/**
 * EPUB 引用统计服务
 * 负责计算每个高亮的引用次数和来源分布
 */
export class EpubReferenceStatsService {
	private app: App;
	private backlinkService: EpubBacklinkHighlightService;
	private statsCache = new Map<
		string,
		{
			stats: Map<string, ReferenceStats>;
			timestamp: number;
		}
	>();
	private readonly CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

	constructor(app: App, backlinkService: EpubBacklinkHighlightService) {
		this.app = app;
		this.backlinkService = backlinkService;
	}

	/**
	 * 计算指定 EPUB 文件的引用统计
	 */
	async computeReferenceStats(
		epubFilePath: string,
		boundCanvasPath?: string | null,
		filter?: { minCreatedTime?: number } | null,
	): Promise<Map<string, ReferenceStats>> {
		const minCreatedTime =
			typeof filter?.minCreatedTime === "number" &&
			Number.isFinite(filter.minCreatedTime) &&
			filter.minCreatedTime > 0
				? filter.minCreatedTime
				: undefined;

		// 检查缓存
		const cached = this.getCachedStats(epubFilePath, boundCanvasPath, minCreatedTime);
		if (cached) {
			logger.debug("[EpubReferenceStatsService] Cache hit for", epubFilePath);
			return cached;
		}

		const highlights = await this.backlinkService.collectHighlights(epubFilePath, boundCanvasPath);
		return this.computeReferenceStatsFromHighlights(
			highlights,
			epubFilePath,
			boundCanvasPath,
			filter
		);
	}

	computeReferenceStatsFromHighlights(
		highlights: BacklinkHighlight[],
		epubFilePath: string,
		boundCanvasPath?: string | null,
		filter?: { minCreatedTime?: number } | null
	): Map<string, ReferenceStats> {
		const minCreatedTime =
			typeof filter?.minCreatedTime === "number" &&
			Number.isFinite(filter.minCreatedTime) &&
			filter.minCreatedTime > 0
				? filter.minCreatedTime
				: undefined;

		const cached = this.getCachedStats(epubFilePath, boundCanvasPath, minCreatedTime);
		if (cached) {
			return cached;
		}

		const statsByCfi = this.buildStatsMapFromHighlights(
			highlights,
			epubFilePath,
			minCreatedTime
		);
		this.setCachedStats(epubFilePath, statsByCfi, boundCanvasPath, minCreatedTime);
		return statsByCfi;
	}

	private buildStatsMapFromHighlights(
		highlights: BacklinkHighlight[],
		epubFilePath: string,
		minCreatedTime?: number
	): Map<string, ReferenceStats> {
		const statsByCfi = new Map<string, ReferenceStats>();

		for (const highlight of highlights) {
			if (
				minCreatedTime !== undefined &&
				(typeof highlight.createdTime !== "number" ||
					!Number.isFinite(highlight.createdTime) ||
					highlight.createdTime < minCreatedTime)
			) {
				continue;
			}

			const normalizedCfi = EpubLinkService.normalizeCfi(highlight.cfiRange);
			const existing = statsByCfi.get(normalizedCfi);

			if (!existing) {
				statsByCfi.set(normalizedCfi, {
					cfi: normalizedCfi,
					text: highlight.text,
					referenceCount: 1,
					sources: [this.extractSourceInfo(highlight, epubFilePath)],
					firstReferenceDate: highlight.createdTime,
					lastReferenceDate: highlight.createdTime,
					referenceHeat: 0,
					summary: this.createEmptySummary(),
				});
			} else {
				existing.referenceCount++;
				existing.sources.push(this.extractSourceInfo(highlight, epubFilePath));
				existing.lastReferenceDate = Math.max(
					existing.lastReferenceDate || 0,
					highlight.createdTime || 0
				);
			}
		}

		for (const stats of statsByCfi.values()) {
			stats.sources = this.sortSources(stats.sources);
			stats.referenceHeat = this.calculateReferenceHeat(stats);
			stats.summary = this.buildSummary(stats.sources);
		}

		logger.debug(
			`[EpubReferenceStatsService] Computed stats for ${epubFilePath}: ${statsByCfi.size} unique highlights`
		);

		return statsByCfi;
	}

	/**
	 * 获取指定 CFI 的引用统计
	 */
	async getStatsForCfi(
		epubFilePath: string,
		cfi: string,
		boundCanvasPath?: string | null,
		filter?: { minCreatedTime?: number } | null,
	): Promise<ReferenceStats | null> {
		const allStats = await this.computeReferenceStats(epubFilePath, boundCanvasPath, filter);
		const normalizedCfi = EpubLinkService.normalizeCfi(cfi);
		return allStats.get(normalizedCfi) || null;
	}

	/**
	 * 清除缓存
	 */
	clearCache(epubFilePath?: string): void {
		if (epubFilePath) {
			// 清除特定文件的缓存
			const keysToDelete: string[] = [];
			for (const key of this.statsCache.keys()) {
				if (key.startsWith(`${epubFilePath}::`)) {
					keysToDelete.push(key);
				}
			}
			for (const key of keysToDelete) {
				this.statsCache.delete(key);
			}
		} else {
			// 清除所有缓存
			this.statsCache.clear();
		}
	}

	/**
	 * 从高亮中提取来源信息
	 */
	private extractSourceInfo(highlight: BacklinkHighlight, epubFilePath: string): ReferenceSourceInfo {
		const sourceType = this.detectSourceType(highlight.sourceFile);
		const normalizedSourceFile = String(highlight.sourceFile || "").trim();
		const normalizedCfi = EpubLinkService.normalizeCfi(highlight.cfiRange);
		const nodeId = sourceType === "canvas" ? this.normalizeCanvasNodeId(highlight.sourceRef) : undefined;

		return {
			key: this.buildSourceKey(normalizedSourceFile, highlight.sourceRef, highlight.excerptId, highlight.createdTime),
			file: normalizedSourceFile,
			type: sourceType,
			sourceRef: highlight.sourceRef,
			excerptId: highlight.excerptId,
			nodeId,
			createdAt: highlight.createdTime,
			displayName: this.getFileName(normalizedSourceFile),
			folderPath: this.getFolderPath(normalizedSourceFile),
			locateCandidates: buildEpubMarkdownLocateCandidates({
				epubFilePath,
				encodedCfi: EpubLinkService.encodeCfiForWikilink(normalizedCfi),
				rawCfi: highlight.cfiRange,
				excerptText: highlight.text,
				createdTime: highlight.createdTime,
				sourceRef: highlight.sourceRef,
				excerptId: highlight.excerptId,
			}),
		};
	}

	/**
	 * 检测来源类型
	 */
	private detectSourceType(filePath: string): ReferenceSourceType {
		if (filePath.endsWith(".md")) return "markdown";
		if (filePath.endsWith(".canvas")) return "canvas";
		return "card";
	}

	private sortSources(sources: ReferenceSourceInfo[]): ReferenceSourceInfo[] {
		return [...sources].sort((left, right) => {
			const leftTime = typeof left.createdAt === "number" ? left.createdAt : 0;
			const rightTime = typeof right.createdAt === "number" ? right.createdAt : 0;
			if (leftTime !== rightTime) {
				return rightTime - leftTime;
			}
			if (left.type !== right.type) {
				return left.type.localeCompare(right.type);
			}
			return left.file.localeCompare(right.file, "zh-CN");
		});
	}

	private createEmptySummary(): ReferenceStatsSummary {
		return {
			uniqueFileCount: 0,
			timeSpanDays: null,
			typeCounts: {
				markdown: 0,
				canvas: 0,
				card: 0,
			},
		};
	}

	private buildSummary(sources: ReferenceSourceInfo[]): ReferenceStatsSummary {
		const uniqueFiles = new Set<string>();
		const typeCounts: Record<ReferenceSourceType, number> = {
			markdown: 0,
			canvas: 0,
			card: 0,
		};
		const validDates: number[] = [];

		for (const source of sources) {
			uniqueFiles.add(source.file);
			typeCounts[source.type] += 1;
			if (typeof source.createdAt === "number" && Number.isFinite(source.createdAt) && source.createdAt > 0) {
				validDates.push(source.createdAt);
			}
		}

		let timeSpanDays: number | null = null;
		if (validDates.length > 0) {
			const earliest = Math.min(...validDates);
			const latest = Math.max(...validDates);
			timeSpanDays = Math.ceil((latest - earliest) / (1000 * 60 * 60 * 24));
		}

		return {
			uniqueFileCount: uniqueFiles.size,
			timeSpanDays,
			typeCounts,
		};
	}

	private buildSourceKey(
		file: string,
		sourceRef?: string,
		excerptId?: string,
		createdAt?: number
	): string {
		return [file, sourceRef || "", excerptId || "", String(createdAt || 0)].join("::");
	}

	private getFileName(path: string): string {
		return path.split("/").pop() || path;
	}

	private getFolderPath(path: string): string {
		const lastSlash = path.lastIndexOf("/");
		return lastSlash >= 0 ? path.substring(0, lastSlash) : "";
	}

	private normalizeCanvasNodeId(sourceRef?: string): string | undefined {
		if (!sourceRef) return undefined;
		if (sourceRef.startsWith("canvas-file-node:")) return sourceRef.slice("canvas-file-node:".length);
		if (sourceRef.startsWith("canvas-node:")) return sourceRef.slice("canvas-node:".length);
		if (sourceRef.startsWith("canvas:")) return sourceRef.slice("canvas:".length);
		return sourceRef;
	}

	/**
	 * 计算引用热度（考虑时间衰减）
	 * 返回 0-100 的分数
	 */
	private calculateReferenceHeat(stats: ReferenceStats): number {
		const now = Date.now();
		const daysSinceLastRef = (now - (stats.lastReferenceDate || 0)) / (1000 * 60 * 60 * 24);

		// 基础分数：引用次数（最多50分）
		let score = Math.min(stats.referenceCount * 10, 50);

		// 时间衰减：最近引用的权重更高（最多50分）
		// 使用指数衰减，30天半衰期
		const timeDecay = Math.exp(-daysSinceLastRef / 30);
		score += timeDecay * 50;

		return Math.min(Math.round(score), 100);
	}

	/**
	 * 获取缓存的统计数据
	 */
	private getCachedStats(
		epubFilePath: string,
		boundCanvasPath?: string | null,
		minCreatedTime?: number,
	): Map<string, ReferenceStats> | null {
		const key = this.getCacheKey(epubFilePath, boundCanvasPath, minCreatedTime);
		const cached = this.statsCache.get(key);

		if (!cached) return null;

		const age = Date.now() - cached.timestamp;
		if (age > this.CACHE_TTL) {
			this.statsCache.delete(key);
			return null;
		}

		return cached.stats;
	}

	/**
	 * 设置缓存的统计数据
	 */
	private setCachedStats(
		epubFilePath: string,
		stats: Map<string, ReferenceStats>,
		boundCanvasPath?: string | null,
		minCreatedTime?: number,
	): void {
		const key = this.getCacheKey(epubFilePath, boundCanvasPath, minCreatedTime);
		this.statsCache.set(key, {
			stats,
			timestamp: Date.now(),
		});
	}

	/**
	 * 生成缓存键
	 */
	private getCacheKey(
		epubFilePath: string,
		boundCanvasPath?: string | null,
		minCreatedTime?: number,
	): string {
		const timeSeg =
			typeof minCreatedTime === "number" && Number.isFinite(minCreatedTime)
				? String(Math.floor(minCreatedTime))
				: "";
		return `${epubFilePath}::${boundCanvasPath || ""}::${timeSeg}`;
	}
}
