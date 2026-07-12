export interface ReadingPositionAutoSaveTrackerState {
	trackedBookId: string;
	lastObservedPage: number;
	visitedPagesSinceSave: number[];
}

export interface ReadingPositionAutoSaveTrackerOptions {
	bookId: string;
	currentPage: number;
	enabled: boolean;
	pages: number;
}

export interface ReadingPositionAutoSaveTrackerResult {
	nextState: ReadingPositionAutoSaveTrackerState;
	shouldPersist: boolean;
}

export function createReadingPositionAutoSaveTrackerState(
	bookId: string,
	currentPage = 0
): ReadingPositionAutoSaveTrackerState {
	const normalizedPage = normalizePageNumber(currentPage);
	return {
		trackedBookId: String(bookId || ""),
		lastObservedPage: normalizedPage,
		visitedPagesSinceSave: normalizedPage > 0 ? [normalizedPage] : [],
	};
}

export function advanceReadingPositionAutoSaveTracker(
	state: ReadingPositionAutoSaveTrackerState,
	options: ReadingPositionAutoSaveTrackerOptions
): ReadingPositionAutoSaveTrackerResult {
	const bookId = String(options.bookId || "");
	const currentPage = normalizePageNumber(options.currentPage);
	const normalizedPages = normalizeThresholdPages(options.pages);
	const normalizedState = normalizeState(state, bookId);

	if (
		bookId !== normalizedState.trackedBookId
		|| normalizedState.lastObservedPage <= 0
		|| currentPage <= 0
	) {
		return {
			nextState: createReadingPositionAutoSaveTrackerState(bookId, currentPage),
			shouldPersist: false,
		};
	}

	if (!options.enabled) {
		return {
			nextState: {
				...normalizedState,
				trackedBookId: bookId,
				lastObservedPage: currentPage,
			},
			shouldPersist: false,
		};
	}

	if (Math.abs(currentPage - normalizedState.lastObservedPage) > getResetGap(normalizedPages)) {
		return {
			nextState: createReadingPositionAutoSaveTrackerState(bookId, currentPage),
			shouldPersist: false,
		};
	}

	const visitedPages = new Set<number>(normalizedState.visitedPagesSinceSave);
	visitedPages.add(currentPage);
	const visitedPagesSinceSave = Array.from(visitedPages).sort((left, right) => left - right);

	if (visitedPagesSinceSave.length - 1 >= normalizedPages) {
		return {
			nextState: createReadingPositionAutoSaveTrackerState(bookId, currentPage),
			shouldPersist: true,
		};
	}

	return {
		nextState: {
			trackedBookId: bookId,
			lastObservedPage: currentPage,
			visitedPagesSinceSave,
		},
		shouldPersist: false,
	};
}

function normalizeState(
	state: ReadingPositionAutoSaveTrackerState,
	bookId: string
): ReadingPositionAutoSaveTrackerState {
	if (!state || typeof state !== "object") {
		return createReadingPositionAutoSaveTrackerState(bookId, 0);
	}

	const visitedPages = Array.isArray(state.visitedPagesSinceSave)
		? state.visitedPagesSinceSave.map((page) => normalizePageNumber(page)).filter((page) => page > 0)
		: [];
	const normalizedLastObservedPage = normalizePageNumber(state.lastObservedPage);
	const effectiveVisitedPages = visitedPages.length > 0
		? Array.from(new Set(visitedPages)).sort((left, right) => left - right)
		: normalizedLastObservedPage > 0
			? [normalizedLastObservedPage]
			: [];

	return {
		trackedBookId: String(state.trackedBookId || bookId || ""),
		lastObservedPage: normalizedLastObservedPage,
		visitedPagesSinceSave: effectiveVisitedPages,
	};
}

function normalizePageNumber(page: unknown): number {
	return typeof page === "number" && Number.isFinite(page) && page > 0 ? Math.round(page) : 0;
}

function normalizeThresholdPages(pages: unknown): number {
	return typeof pages === "number" && Number.isFinite(pages) && pages > 0 ? Math.round(pages) : 1;
}

function getResetGap(pages: number): number {
	return Math.max(8, pages * 2);
}
