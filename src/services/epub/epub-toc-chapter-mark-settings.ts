import type { EpubTocChapterMark } from "./epub-toc-chapter-mark";
import { EPUB_TOC_CHAPTER_MARK_ORDER } from "./epub-toc-chapter-mark";

export interface EpubTocChapterMarkAppearanceOverride {
	label?: string;
	color?: string;
}

export type EpubTocChapterMarkSettings = Partial<
	Record<EpubTocChapterMark, EpubTocChapterMarkAppearanceOverride>
>;

export interface ResolvedEpubTocChapterMarkDefinition {
	mark: EpubTocChapterMark;
	label: string;
	color: string;
}

export interface TocChapterMarkDefaultLabels {
	important: string;
	question: string;
	mastered: string;
	incremental: string;
}

export const DEFAULT_TOC_CHAPTER_MARK_COLORS: Record<EpubTocChapterMark, string> = {
	important: "#e93147",
	question: "#e5a500",
	mastered: "#30a768",
	incremental: "#0084ff",
};

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function buildTocChapterMarkDefaultLabels(
	translate: (key: string) => string
): TocChapterMarkDefaultLabels {
	return {
		important: translate("epub.toc.markImportant"),
		question: translate("epub.toc.markQuestion"),
		mastered: translate("epub.toc.markMastered"),
		incremental: translate("epub.toc.markIncremental"),
	};
}

export function normalizeTocChapterMarkColor(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (!HEX_COLOR_PATTERN.test(trimmed)) {
		return undefined;
	}
	if (trimmed.length === 4) {
		const [, r, g, b] = trimmed;
		return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
	}
	return trimmed.toLowerCase();
}

export function normalizeTocChapterMarkLabel(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed || undefined;
}

export function normalizeTocChapterMarkSettings(value: unknown): EpubTocChapterMarkSettings {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}

	const normalized: EpubTocChapterMarkSettings = {};
	for (const mark of EPUB_TOC_CHAPTER_MARK_ORDER) {
		const raw = (value as Record<string, unknown>)[mark];
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			continue;
		}
		const record = raw as Record<string, unknown>;
		const label = normalizeTocChapterMarkLabel(record.label);
		const color = normalizeTocChapterMarkColor(record.color);
		if (!label && !color) {
			continue;
		}
		normalized[mark] = {
			...(label ? { label } : {}),
			...(color ? { color } : {}),
		};
	}
	return normalized;
}

function resolveDefaultLabel(mark: EpubTocChapterMark, labels: TocChapterMarkDefaultLabels): string {
	switch (mark) {
		case "important":
			return labels.important;
		case "question":
			return labels.question;
		case "mastered":
			return labels.mastered;
		case "incremental":
			return labels.incremental;
	}
}

export function resolveTocChapterMarkDefinitions(
	settings: EpubTocChapterMarkSettings | null | undefined,
	labels: TocChapterMarkDefaultLabels
): ResolvedEpubTocChapterMarkDefinition[] {
	const normalizedSettings = normalizeTocChapterMarkSettings(settings);
	return EPUB_TOC_CHAPTER_MARK_ORDER.map((mark) => {
		const override = normalizedSettings[mark];
		return {
			mark,
			label: override?.label || resolveDefaultLabel(mark, labels),
			color:
				override?.color ||
				DEFAULT_TOC_CHAPTER_MARK_COLORS[mark] ||
				DEFAULT_TOC_CHAPTER_MARK_COLORS.important,
		};
	});
}

export function buildPersistedTocChapterMarkSettings(
	draft: ReadonlyArray<Pick<ResolvedEpubTocChapterMarkDefinition, "mark" | "label" | "color">>,
	labels: TocChapterMarkDefaultLabels
): EpubTocChapterMarkSettings {
	const persisted: EpubTocChapterMarkSettings = {};

	for (const row of draft) {
		const defaultLabel = resolveDefaultLabel(row.mark, labels);
		const defaultColor = DEFAULT_TOC_CHAPTER_MARK_COLORS[row.mark];
		const label = normalizeTocChapterMarkLabel(row.label);
		const color = normalizeTocChapterMarkColor(row.color);
		const next: EpubTocChapterMarkAppearanceOverride = {};

		if (label && label !== defaultLabel) {
			next.label = label;
		}
		if (color && color !== defaultColor) {
			next.color = color;
		}
		if (Object.keys(next).length > 0) {
			persisted[row.mark] = next;
		}
	}

	return persisted;
}

export function resolveTocChapterMarkDefinitionMap(
	settings: EpubTocChapterMarkSettings | null | undefined,
	labels: TocChapterMarkDefaultLabels
): Map<EpubTocChapterMark, ResolvedEpubTocChapterMarkDefinition> {
	return new Map(
		resolveTocChapterMarkDefinitions(settings, labels).map((definition) => [
			definition.mark,
			definition,
		])
	);
}
