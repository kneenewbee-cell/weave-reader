import type { DateRange, SearchQuery } from "../../utils/search-parser";

export interface BookshelfSearchBookFields {
	displayTitle: string;
	metaText: string;
	statsLine: string;
	name: string;
	folder: string;
	author: string;
	translator?: string;
	publisher?: string;
	formatLabel: string;
	readingStatus: string;
	localizedReadingStatus: string;
	path: string;
	addedAt: number;
}

function normalizeSearchText(value: string | undefined): string {
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function buildBookshelfSearchableValues(book: BookshelfSearchBookFields): string[] {
	return [
		book.displayTitle,
		book.metaText,
		book.statsLine,
		book.name,
		book.folder,
		book.author,
		book.translator || "",
		book.publisher || "",
		book.formatLabel,
		book.readingStatus,
		book.localizedReadingStatus,
	];
}

function matchesSearchTermList(values: string[], terms: string[]): boolean {
	if (terms.length === 0) {
		return true;
	}

	return terms.every((term) => {
		const normalizedTerm = normalizeSearchText(term);
		if (!normalizedTerm) {
			return true;
		}
		return values.some((value) => normalizeSearchText(value).includes(normalizedTerm));
	});
}

function matchesExcludedSearchTerms(values: string[], terms: string[]): boolean {
	if (terms.length === 0) {
		return true;
	}

	return terms.every((term) => {
		const normalizedTerm = normalizeSearchText(term);
		if (!normalizedTerm) {
			return true;
		}
		return values.every((value) => !normalizeSearchText(value).includes(normalizedTerm));
	});
}

function matchesFieldValues(target: string | undefined, values: string[]): boolean {
	if (values.length === 0) {
		return true;
	}

	const normalizedTarget = normalizeSearchText(target);
	if (!normalizedTarget) {
		return false;
	}

	return values.some((value) => {
		const normalizedValue = normalizeSearchText(value);
		return normalizedValue ? normalizedTarget.includes(normalizedValue) : false;
	});
}

function excludesFieldValues(target: string | undefined, values: string[]): boolean {
	if (values.length === 0) {
		return true;
	}

	const normalizedTarget = normalizeSearchText(target);
	if (!normalizedTarget) {
		return true;
	}

	return values.every((value) => {
		const normalizedValue = normalizeSearchText(value);
		return normalizedValue ? !normalizedTarget.includes(normalizedValue) : true;
	});
}

function parseDateBoundary(value: string, boundary: "start" | "end"): number | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return null;
	}

	const timestamp = new Date(
		boundary === "start" ? `${value}T00:00:00.000` : `${value}T23:59:59.999`
	).getTime();
	return Number.isFinite(timestamp) ? timestamp : null;
}

function matchesDateRange(timestamp: number, range: DateRange): boolean {
	if (!Number.isFinite(timestamp) || timestamp <= 0) {
		return false;
	}

	const from = range.from ? parseDateBoundary(range.from, "start") : null;
	if (range.from && from === null) {
		return false;
	}

	const to = range.to ? parseDateBoundary(range.to, "end") : null;
	if (range.to && to === null) {
		return false;
	}

	if (from !== null && timestamp < from) {
		return false;
	}

	if (to !== null && timestamp > to) {
		return false;
	}

	return true;
}

function matchesDateRanges(timestamp: number, ranges: DateRange[]): boolean {
	if (ranges.length === 0) {
		return true;
	}

	return ranges.some((range) => matchesDateRange(timestamp, range));
}

export function matchesBookshelfPlaylistSearchQuery(
	playlistName: string,
	bookFields: BookshelfSearchBookFields[],
	query: SearchQuery
): boolean {
	if (!query.raw.trim()) {
		return true;
	}

	const playlistFields: BookshelfSearchBookFields = {
		displayTitle: playlistName,
		metaText: playlistName,
		statsLine: "",
		name: playlistName,
		folder: "",
		author: "",
		formatLabel: "",
		readingStatus: "",
		localizedReadingStatus: "",
		path: "",
		addedAt: 0,
	};

	if (matchesBookshelfSearchQuery(playlistFields, query)) {
		return true;
	}

	return bookFields.some((book) => matchesBookshelfSearchQuery(book, query));
}

export function matchesBookshelfSearchQuery(
	book: BookshelfSearchBookFields,
	query: SearchQuery
): boolean {
	if (!query.raw.trim()) {
		return true;
	}

	const searchableValues = buildBookshelfSearchableValues(book);
	const formatSearchTarget = `${book.formatLabel} ${book.path.split(".").pop() || ""}`.trim();
	const statusTarget = `${book.readingStatus} ${book.localizedReadingStatus}`;

	return (
		matchesSearchTermList(searchableValues, query.text)
		&& matchesExcludedSearchTerms(searchableValues, query.excludeText)
		&& matchesFieldValues(statusTarget, query.statuses)
		&& excludesFieldValues(statusTarget, query.excludeStatuses)
		&& matchesFieldValues(book.author, query.authors)
		&& matchesFieldValues(book.publisher, query.publishers)
		&& matchesFieldValues(formatSearchTarget, query.formats)
		&& matchesDateRanges(book.addedAt, query.dateRanges)
	);
}
