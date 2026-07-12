import { describe, expect, it, vi } from "vitest";
import { EPUB_RUNTIME } from "../epub-runtime";
import {
	createDebouncedBookshelfProgressChangedNotifier,
	dispatchEpubBookshelfDataChanged,
	dispatchEpubBookshelfFullRefresh,
	dispatchEpubBookshelfRefreshRequest,
	readBookshelfDataChangedDetail,
	readBookshelfRefreshRequestDetail,
} from "../bookshelf-data-events";

describe("bookshelf-data-events", () => {
	it("dispatches bookshelfDataChanged with optional book paths", () => {
		const dispatchEvent = vi.fn();
		dispatchEpubBookshelfDataChanged({ dispatchEvent }, { bookPaths: ["Books/demo.epub"] });
		expect(dispatchEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				type: EPUB_RUNTIME.events.bookshelfDataChanged,
				detail: { bookPaths: ["Books/demo.epub"] },
			})
		);
	});

	it("dispatches both events for a full bookshelf refresh", () => {
		const dispatchEvent = vi.fn();
		dispatchEpubBookshelfFullRefresh({ dispatchEvent });
		expect(dispatchEvent).toHaveBeenCalledTimes(2);
		expect(dispatchEvent.mock.calls.map(([event]) => event.type)).toEqual([
			EPUB_RUNTIME.events.bookshelfDataChanged,
			EPUB_RUNTIME.events.bookshelfRefreshRequest,
		]);
	});

	it("debounces progress notifications and includes pending book paths", () => {
		vi.useFakeTimers();
		const dispatchEvent = vi.fn();
		const notifier = createDebouncedBookshelfProgressChangedNotifier({
			target: { dispatchEvent },
			debounceMs: 120,
		});

		notifier.notify("Books/a.epub");
		notifier.notify("Books/b.epub");
		expect(dispatchEvent).not.toHaveBeenCalled();

		vi.advanceTimersByTime(120);
		expect(dispatchEvent).toHaveBeenCalledTimes(1);
		expect(dispatchEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				type: EPUB_RUNTIME.events.bookshelfDataChanged,
				detail: { bookPaths: ["Books/a.epub", "Books/b.epub"] },
			})
		);

		notifier.dispose();
		vi.useRealTimers();
	});

	it("flush emits immediately and clears pending debounce", () => {
		vi.useFakeTimers();
		const dispatchEvent = vi.fn();
		const notifier = createDebouncedBookshelfProgressChangedNotifier({
			target: { dispatchEvent },
			debounceMs: 120,
		});

		notifier.notify("Books/demo.epub");
		notifier.flush();
		expect(dispatchEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				detail: { bookPaths: ["Books/demo.epub"] },
			})
		);

		vi.advanceTimersByTime(120);
		expect(dispatchEvent).toHaveBeenCalledTimes(1);

		notifier.dispose();
		vi.useRealTimers();
	});

	it("reads refresh request detail safely", () => {
		expect(
			readBookshelfRefreshRequestDetail(
				new CustomEvent(EPUB_RUNTIME.events.bookshelfRefreshRequest, {
					detail: { showNotice: true },
				})
			)
		).toEqual({ showNotice: true });
		expect(readBookshelfRefreshRequestDetail(new Event("test"))).toEqual({});
	});

	it("reads data-changed detail safely", () => {
		expect(
			readBookshelfDataChangedDetail(
				new CustomEvent(EPUB_RUNTIME.events.bookshelfDataChanged, {
					detail: { bookPaths: [" Books/demo.epub ", ""] },
				})
			)
		).toEqual({ bookPaths: ["Books/demo.epub"] });
	});
});
