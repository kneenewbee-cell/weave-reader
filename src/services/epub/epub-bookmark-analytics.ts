import type { ReaderHighlightInput } from "./reader-engine-types";
import {
	DEFAULT_EPUB_EXCERPT_SETTINGS,
	type EpubExcerptSettings,
} from "./epub-excerpt-settings";
import type {
	EpubBookmarkAnalytics,
	EpubBookmarkExcerptIndexRow,
} from "./epub-bookmark-page-types";
import {
	isHighlightCountedAsConcealed,
	shouldIncludeHighlightInSidebarSnapshot,
} from "./reader-annotation-model";
import { unknownPlainText } from "../../utils/unknown-plain-text";

const HIGHLIGHT_COLORS = new Set(["yellow", "green", "blue", "red", "purple"]);

export type EpubBookmarkAnalyticsBuildOptions = Pick<
	EpubExcerptSettings,
	"strikethroughDisplayMode" | "showStrikethroughInSidebar"
>;

function normalizePreviewText(value: string, maxLength = 48): string {
	const normalized = String(value || "")
		.replace(/\s+/g, " ")
		.trim();
	if (!normalized) {
		return "";
	}
	if (normalized.length <= maxLength) {
		return normalized;
	}
	return `${normalized.slice(0, maxLength)}…`;
}

function serializeEpubBookmarkAnalyticsForCompare(
	analytics?: EpubBookmarkAnalytics | null
): string {
	if (!analytics) {
		return "";
	}
	const { updatedAt: _updatedAt, ...rest } = analytics;
	void _updatedAt;
	return JSON.stringify(rest);
}

export function areEpubBookmarkAnalyticsEquivalent(
	left?: EpubBookmarkAnalytics | null,
	right?: EpubBookmarkAnalytics | null
): boolean {
	return (
		serializeEpubBookmarkAnalyticsForCompare(left) ===
		serializeEpubBookmarkAnalyticsForCompare(right)
	);
}

export type ParseEpubBookmarkAnalyticsOptions = {
	highlightCount?: number;
	excerptNoteCount?: number;
	updatedAt?: number;
	fallback?: EpubBookmarkAnalytics;
};

/** Parse bookmark analytics from YAML `analytics` block and optional flat count fields. */
export function parseEpubBookmarkAnalytics(
	value: unknown,
	options?: ParseEpubBookmarkAnalyticsOptions
): EpubBookmarkAnalytics | null {
	const flatCounts = {
		highlightCount: options?.highlightCount,
		excerptNoteCount: options?.excerptNoteCount,
	};
	const fallback = options?.fallback;

	if (!value || typeof value !== "object") {
		if (!flatCounts.highlightCount && !flatCounts.excerptNoteCount && !fallback) {
			return null;
		}
		return {
			updatedAt: options?.updatedAt ?? fallback?.updatedAt ?? Date.now(),
			highlightCount: flatCounts.highlightCount ?? fallback?.highlightCount ?? 0,
			highlightsByColor: fallback?.highlightsByColor ?? {},
			excerptNoteCount: flatCounts.excerptNoteCount ?? fallback?.excerptNoteCount ?? 0,
			commentCount: fallback?.commentCount ?? 0,
			concealedCount: fallback?.concealedCount ?? 0,
			referenceHeatMax: fallback?.referenceHeatMax,
			topChaptersByHighlights: fallback?.topChaptersByHighlights ?? [],
			linkedNotePaths: fallback?.linkedNotePaths ?? [],
			recentExcerpts: fallback?.recentExcerpts,
		};
	}

	const record = value as Record<string, unknown>;
	const highlightCount =
		flatCounts.highlightCount ??
		(typeof record.highlightCount === "number"
			? Math.max(0, record.highlightCount)
			: fallback?.highlightCount ?? 0);
	const highlightsByColor =
		record.highlightsByColor && typeof record.highlightsByColor === "object"
			? (record.highlightsByColor as Partial<Record<string, number>>)
			: fallback?.highlightsByColor ?? {};
	const topChaptersByHighlights = Array.isArray(record.topChaptersByHighlights)
		? record.topChaptersByHighlights
				.map((item) => {
					if (!item || typeof item !== "object") {
						return null;
					}
					const chapter = item as Record<string, unknown>;
					const title = unknownPlainText(chapter.title).trim();
					const count = typeof chapter.count === "number" ? chapter.count : 0;
					if (!title || count <= 0) {
						return null;
					}
					return { title, count };
				})
				.filter((item): item is { title: string; count: number } => Boolean(item))
		: fallback?.topChaptersByHighlights ?? [];
	const linkedNotePaths = Array.isArray(record.linkedNotePaths)
		? record.linkedNotePaths.map((item) => String(item || "").trim()).filter(Boolean)
		: fallback?.linkedNotePaths ?? [];
	const recentExcerpts = Array.isArray(record.recentExcerpts)
		? record.recentExcerpts
				.map((item) => {
					if (!item || typeof item !== "object") {
						return null;
					}
					const excerpt = item as Record<string, unknown>;
					const chapterTitle = unknownPlainText(excerpt.chapterTitle).trim();
					const preview = unknownPlainText(excerpt.preview).trim();
					if (!chapterTitle || !preview) {
						return null;
					}
					return {
						chapterTitle,
						preview,
						notePath:
							typeof excerpt.notePath === "string" ? excerpt.notePath.trim() : undefined,
						createdTime:
							typeof excerpt.createdTime === "number" ? excerpt.createdTime : 0,
					};
				})
				.filter(
					(
						item
					): item is {
						chapterTitle: string;
						preview: string;
						notePath?: string;
						createdTime: number;
					} => Boolean(item)
				)
		: fallback?.recentExcerpts;

	return {
		updatedAt:
			typeof record.updatedAt === "number"
				? record.updatedAt
				: options?.updatedAt ?? fallback?.updatedAt ?? Date.now(),
		highlightCount,
		highlightsByColor,
		excerptNoteCount:
			flatCounts.excerptNoteCount ??
			(typeof record.excerptNoteCount === "number"
				? Math.max(0, record.excerptNoteCount)
				: fallback?.excerptNoteCount ?? linkedNotePaths.length),
		commentCount:
			typeof record.commentCount === "number"
				? Math.max(0, record.commentCount)
				: fallback?.commentCount ?? 0,
		concealedCount:
			typeof record.concealedCount === "number"
				? Math.max(0, record.concealedCount)
				: fallback?.concealedCount ?? 0,
		referenceHeatMax:
			typeof record.referenceHeatMax === "number" && record.referenceHeatMax > 0
				? record.referenceHeatMax
				: fallback?.referenceHeatMax,
		topChaptersByHighlights,
		linkedNotePaths,
		recentExcerpts: recentExcerpts && recentExcerpts.length > 0 ? recentExcerpts : undefined,
	};
}

/** Read bookmark analytics from vault frontmatter flat counts and nested `analytics` block. */
export function readEpubBookmarkAnalyticsFromFrontmatter(
	frontmatter: Record<string, unknown>
): EpubBookmarkAnalytics | undefined {
	return (
		parseEpubBookmarkAnalytics(frontmatter.analytics, {
			highlightCount:
				typeof frontmatter["highlight-count"] === "number"
					? frontmatter["highlight-count"]
					: undefined,
			excerptNoteCount:
				typeof frontmatter["excerpt-note-count"] === "number"
					? frontmatter["excerpt-note-count"]
					: undefined,
			updatedAt:
				typeof frontmatter.updatedAt === "number" ? frontmatter.updatedAt : undefined,
		}) ?? undefined
	);
}

function resolveAnalyticsBuildOptions(
	options?: EpubBookmarkAnalyticsBuildOptions
): EpubBookmarkAnalyticsBuildOptions {
	return {
		strikethroughDisplayMode:
			options?.strikethroughDisplayMode ??
			DEFAULT_EPUB_EXCERPT_SETTINGS.strikethroughDisplayMode,
		showStrikethroughInSidebar:
			options?.showStrikethroughInSidebar ??
			DEFAULT_EPUB_EXCERPT_SETTINGS.showStrikethroughInSidebar,
	};
}

function shouldSkipHighlightForAnalytics(
	highlight: ReaderHighlightInput,
	options: EpubBookmarkAnalyticsBuildOptions
): "concealed" | "hidden" | null {
	if (
		isHighlightCountedAsConcealed(highlight, options.strikethroughDisplayMode)
	) {
		return "concealed";
	}
	if (
		!shouldIncludeHighlightInSidebarSnapshot(
			highlight,
			options.showStrikethroughInSidebar
		)
	) {
		return "hidden";
	}
	return null;
}

export function buildEpubBookmarkAnalytics(
	highlights: ReaderHighlightInput[],
	now = Date.now(),
	options?: EpubBookmarkAnalyticsBuildOptions
): EpubBookmarkAnalytics {
	const analyticsOptions = resolveAnalyticsBuildOptions(options);
	const highlightsByColor: Partial<Record<string, number>> = {};
	const chapterCounts = new Map<string, number>();
	const linkedNotePaths = new Set<string>();
	let highlightCount = 0;
	let commentCount = 0;
	let concealedCount = 0;
	let referenceHeatMax = 0;

	for (const highlight of highlights) {
		const skipReason = shouldSkipHighlightForAnalytics(highlight, analyticsOptions);
		if (skipReason === "concealed") {
			concealedCount += 1;
			continue;
		}
		if (skipReason === "hidden") {
			continue;
		}

		highlightCount += 1;
		const color = String(highlight.color || "").trim().toLowerCase();
		if (HIGHLIGHT_COLORS.has(color)) {
			highlightsByColor[color] = (highlightsByColor[color] || 0) + 1;
		}

		if (String(highlight.commentText || "").trim()) {
			commentCount += 1;
		}

		const chapterTitle = String(highlight.chapterTitle || "").trim() || "未命名章节";
		chapterCounts.set(chapterTitle, (chapterCounts.get(chapterTitle) || 0) + 1);

		const sourceFile = String(highlight.sourceFile || "").trim();
		if (sourceFile) {
			linkedNotePaths.add(sourceFile);
		}

		const heat = typeof highlight.referenceHeat === "number" ? highlight.referenceHeat : 0;
		if (heat > referenceHeatMax) {
			referenceHeatMax = heat;
		}
	}

	const topChaptersByHighlights = Array.from(chapterCounts.entries())
		.map(([title, count]) => ({ title, count }))
		.sort((left, right) => right.count - left.count || left.title.localeCompare(right.title, "zh-CN"))
		.slice(0, 5);

	const recentExcerpts = buildEpubBookmarkExcerptIndex(highlights, 5, analyticsOptions).map(
		(row) => ({
			chapterTitle: row.chapterTitle,
			preview: row.preview,
			notePath: row.notePath,
			createdTime: row.createdTime,
		})
	);

	return {
		updatedAt: now,
		highlightCount,
		highlightsByColor,
		excerptNoteCount: linkedNotePaths.size,
		commentCount,
		concealedCount,
		referenceHeatMax: referenceHeatMax > 0 ? referenceHeatMax : undefined,
		topChaptersByHighlights,
		linkedNotePaths: Array.from(linkedNotePaths)
			.sort((left, right) => left.localeCompare(right, "zh-CN"))
			.slice(0, 12),
		recentExcerpts,
	};
}

function buildEpubBookmarkExcerptIndex(
	highlights: ReaderHighlightInput[],
	maxRows = 5,
	options?: EpubBookmarkAnalyticsBuildOptions
): EpubBookmarkExcerptIndexRow[] {
	const analyticsOptions = resolveAnalyticsBuildOptions(options);
	const rows: EpubBookmarkExcerptIndexRow[] = [];

	for (const highlight of highlights) {
		if (shouldSkipHighlightForAnalytics(highlight, analyticsOptions)) {
			continue;
		}
		const preview = normalizePreviewText(highlight.text || highlight.commentText || "");
		if (!preview) {
			continue;
		}
		rows.push({
			chapterTitle: String(highlight.chapterTitle || "").trim() || "未命名章节",
			preview,
			notePath: String(highlight.sourceFile || "").trim() || undefined,
			createdTime: typeof highlight.createdTime === "number" ? highlight.createdTime : 0,
		});
	}

	return rows
		.sort((left, right) => (right.createdTime || 0) - (left.createdTime || 0))
		.slice(0, maxRows);
}
