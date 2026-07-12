import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachExternalHighlightSyncReload } from "./external-highlight-sync-reload";

describe("attachExternalHighlightSyncReload", () => {
	let cleanup: (() => void) | null = null;

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		cleanup?.();
		cleanup = null;
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("reloads when the document becomes visible again", () => {
		const onReload = vi.fn();
		cleanup = attachExternalHighlightSyncReload({
			canReload: () => true,
			onReload,
			throttleMs: 10,
		});

		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
		document.dispatchEvent(new Event("visibilitychange"));
		vi.advanceTimersByTime(10);

		expect(onReload).toHaveBeenCalledWith(160);
	});

	it("reloads on window focus and pageshow with trailing debounce", () => {
		const onReload = vi.fn();
		cleanup = attachExternalHighlightSyncReload({
			canReload: () => true,
			onReload,
			throttleMs: 10,
		});

		window.dispatchEvent(new Event("focus"));
		vi.advanceTimersByTime(10);
		expect(onReload).toHaveBeenCalledTimes(1);
		expect(onReload).toHaveBeenCalledWith(200);

		window.dispatchEvent(new Event("pageshow"));
		vi.advanceTimersByTime(10);
		expect(onReload).toHaveBeenCalledTimes(2);
		expect(onReload).toHaveBeenLastCalledWith(120);
	});

	it("coalesces rapid re-entry events into one trailing reload", () => {
		const onReload = vi.fn();
		cleanup = attachExternalHighlightSyncReload({
			canReload: () => true,
			onReload,
			throttleMs: 1000,
		});

		window.dispatchEvent(new Event("focus"));
		window.dispatchEvent(new Event("pageshow"));

		vi.advanceTimersByTime(1000);

		expect(onReload).toHaveBeenCalledTimes(1);
		expect(onReload).toHaveBeenCalledWith(200);
	});

	it("removes listeners during cleanup", () => {
		const onReload = vi.fn();
		cleanup = attachExternalHighlightSyncReload({
			canReload: () => true,
			onReload,
		});

		cleanup();
		cleanup = null;

		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
		document.dispatchEvent(new Event("visibilitychange"));
		window.dispatchEvent(new Event("focus"));
		window.dispatchEvent(new Event("pageshow"));

		expect(onReload).not.toHaveBeenCalled();
	});
});
