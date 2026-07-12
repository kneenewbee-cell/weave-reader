import {
	BOOK_LOAD_HARD_TIMEOUT_MS,
	BOOK_LOAD_LARGE_FILE_BYTES,
	BOOK_LOAD_LARGE_FILE_TIMEOUT_STEP_MS,
	BOOK_LOAD_MAX_HARD_TIMEOUT_MS,
	BOOK_LOAD_SLOW_WARNING_MS,
	buildBookLoadSlowWarningMessage,
	buildBookLoadTimeoutMessage,
	resolveBookLoadHardTimeoutMs,
	runBookLoadSession,
} from "../book-load-session";

describe("book-load-session", () => {
	it("resolves before the hard timeout when loading finishes quickly", async () => {
		await expect(
			runBookLoadSession({
				filePath: "Books/comic.cbz",
				loadPromise: Promise.resolve("ok"),
			})
		).resolves.toBe("ok");
	});

	it("fires the slow-load callback and then rejects at the hard timeout", async () => {
		vi.useFakeTimers();
		const onSlowLoad = vi.fn();

		const pending = runBookLoadSession({
			filePath: "Books/comic.cbz",
			loadPromise: new Promise(() => undefined),
			onSlowLoad,
		});
		const handled = pending.catch((error: unknown) => error);

		await vi.advanceTimersByTimeAsync(BOOK_LOAD_SLOW_WARNING_MS);
		expect(onSlowLoad).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(
			BOOK_LOAD_HARD_TIMEOUT_MS - BOOK_LOAD_SLOW_WARNING_MS
		);

		const result = await handled;
		expect(result).toBeInstanceOf(Error);
		expect(String(result)).toMatch(/CBZ/);

		vi.useRealTimers();
	});

	it("uses the book format label in slow and timeout messages", () => {
		expect(buildBookLoadSlowWarningMessage("Books/comic.cbz")).toContain("CBZ");
		expect(buildBookLoadTimeoutMessage("Books/comic.cbz", "reader")).toContain("CBZ");
	});

	it("extends the hard timeout for large vault books", () => {
		expect(resolveBookLoadHardTimeoutMs(10 * 1024 * 1024)).toBe(BOOK_LOAD_HARD_TIMEOUT_MS);
		expect(resolveBookLoadHardTimeoutMs(BOOK_LOAD_LARGE_FILE_BYTES + 1)).toBe(
			BOOK_LOAD_HARD_TIMEOUT_MS + BOOK_LOAD_LARGE_FILE_TIMEOUT_STEP_MS
		);
		expect(resolveBookLoadHardTimeoutMs(BOOK_LOAD_LARGE_FILE_BYTES * 5)).toBe(
			BOOK_LOAD_HARD_TIMEOUT_MS + 4 * BOOK_LOAD_LARGE_FILE_TIMEOUT_STEP_MS
		);
	});
});
