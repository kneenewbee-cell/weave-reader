import { EPUB_RUNTIME } from "./epub-runtime";

type EventTargetLike = Pick<Window, "dispatchEvent">;

export type EpubBookshelfDataChangedDetail = {
	bookPaths?: string[];
};

export type EpubBookshelfRefreshRequestDetail = {
	showNotice?: boolean;
};

export function dispatchEpubBookshelfDataChanged(
	target: EventTargetLike | undefined = typeof window !== "undefined" ? window : undefined,
	detail: EpubBookshelfDataChangedDetail = {}
): void {
	if (!target) {
		return;
	}
	target.dispatchEvent(
		new CustomEvent(EPUB_RUNTIME.events.bookshelfDataChanged, {
			detail,
		})
	);
}

export function dispatchEpubBookshelfRefreshRequest(
	target: EventTargetLike | undefined = typeof window !== "undefined" ? window : undefined,
	detail: EpubBookshelfRefreshRequestDetail = {}
): void {
	if (!target) {
		return;
	}
	target.dispatchEvent(
		new CustomEvent(EPUB_RUNTIME.events.bookshelfRefreshRequest, {
			detail,
		})
	);
}

/** Full rebuild: reload metadata and run prune-missing cleanup. */
export function dispatchEpubBookshelfFullRefresh(
	target: EventTargetLike | undefined = typeof window !== "undefined" ? window : undefined,
	detail: EpubBookshelfRefreshRequestDetail = {}
): void {
	dispatchEpubBookshelfDataChanged(target);
	dispatchEpubBookshelfRefreshRequest(target, detail);
}

export const BOOKSHELF_PROGRESS_CHANGED_DEBOUNCE_MS = 120;

export function readBookshelfDataChangedDetail(event: Event): EpubBookshelfDataChangedDetail {
	const detail = (event as CustomEvent<EpubBookshelfDataChangedDetail>).detail;
	if (!detail || typeof detail !== "object") {
		return {};
	}
	const bookPaths = Array.isArray(detail.bookPaths)
		? detail.bookPaths.map((path) => String(path || "").trim()).filter(Boolean)
		: undefined;
	return bookPaths?.length ? { bookPaths } : {};
}

export function readBookshelfRefreshRequestDetail(event: Event): EpubBookshelfRefreshRequestDetail {
	const detail = (event as CustomEvent<EpubBookshelfRefreshRequestDetail>).detail;
	if (!detail || typeof detail !== "object") {
		return {};
	}
	return {
		showNotice: detail.showNotice === true,
	};
}

export function createDebouncedBookshelfProgressChangedNotifier(options?: {
	target?: EventTargetLike;
	debounceMs?: number;
}): {
	notify: (bookPath?: string) => void;
	flush: () => void;
	dispose: () => void;
} {
	const target = options?.target ?? (typeof window !== "undefined" ? window : undefined);
	const debounceMs = options?.debounceMs ?? BOOKSHELF_PROGRESS_CHANGED_DEBOUNCE_MS;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const pendingBookPaths = new Set<string>();

	const emit = (): void => {
		const bookPaths = Array.from(pendingBookPaths);
		pendingBookPaths.clear();
		dispatchEpubBookshelfDataChanged(target, bookPaths.length > 0 ? { bookPaths } : {});
	};

	const flush = (): void => {
		if (timer !== null && typeof window !== "undefined") {
			window.clearTimeout(timer);
			timer = null;
		}
		emit();
	};

	const notify = (bookPath?: string): void => {
		if (!target || typeof window === "undefined") {
			return;
		}
		const normalizedPath = String(bookPath || "").trim();
		if (normalizedPath) {
			pendingBookPaths.add(normalizedPath);
		}
		if (timer !== null) {
			window.clearTimeout(timer);
		}
		timer = window.setTimeout(() => {
			timer = null;
			emit();
		}, debounceMs);
	};

	const dispose = (): void => {
		if (timer !== null && typeof window !== "undefined") {
			window.clearTimeout(timer);
			timer = null;
		}
		pendingBookPaths.clear();
	};

	return { notify, flush, dispose };
}
