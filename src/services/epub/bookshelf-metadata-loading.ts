export interface BookshelfDisplayMetadata {
	title?: string;
	author?: string;
	translator?: string;
	publisher?: string;
	wordCount?: number;
	chapterCount?: number;
}

export interface BookshelfPublicationParseState {
	isPdf: boolean;
	hasCachedCover: boolean;
	metadataParseAttempted: boolean;
	meta?: BookshelfDisplayMetadata | null;
}

function normalizeText(value: string | undefined): string {
	return typeof value === "string" ? value.trim() : "";
}

function hasPositiveCount(value: number | undefined): boolean {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function hasBookshelfDisplayDetails(
	meta: BookshelfDisplayMetadata | null | undefined
): boolean {
	if (!meta) {
		return false;
	}

	const hasByline = Boolean(
		normalizeText(meta.author) ||
		normalizeText(meta.translator) ||
		normalizeText(meta.publisher)
	);
	const hasStats = hasPositiveCount(meta.wordCount) || hasPositiveCount(meta.chapterCount);
	return hasByline && hasStats;
}

export function shouldParseBookshelfPublication(state: BookshelfPublicationParseState): boolean {
	if (state.isPdf) {
		return false;
	}

	if (!state.hasCachedCover) {
		return true;
	}

	if (state.metadataParseAttempted) {
		return false;
	}

	return !hasBookshelfDisplayDetails(state.meta);
}

export function mergeBookshelfDisplayMetadata<T extends BookshelfDisplayMetadata>(
	existing: T,
	metadata: Partial<BookshelfDisplayMetadata> | null | undefined
): { metadata: T; changed: boolean } {
	if (!metadata) {
		return { metadata: existing, changed: false };
	}

	const next: T = { ...existing };
	let changed = false;

	const title = normalizeText(metadata.title);
	if (!normalizeText(existing.title) && title) {
		next.title = title;
		changed = true;
	}

	const author = normalizeText(metadata.author);
	if (author && author !== normalizeText(existing.author)) {
		next.author = author;
		changed = true;
	}

	const publisher = normalizeText(metadata.publisher);
	if (publisher && publisher !== normalizeText(existing.publisher)) {
		next.publisher = publisher;
		changed = true;
	}

	const translator = normalizeText(metadata.translator);
	if (translator && translator !== normalizeText(existing.translator)) {
		next.translator = translator;
		changed = true;
	}

	if (hasPositiveCount(metadata.wordCount) && metadata.wordCount !== existing.wordCount) {
		next.wordCount = metadata.wordCount;
		changed = true;
	}

	if (hasPositiveCount(metadata.chapterCount) && metadata.chapterCount !== existing.chapterCount) {
		next.chapterCount = metadata.chapterCount;
		changed = true;
	}

	return { metadata: next, changed };
}
