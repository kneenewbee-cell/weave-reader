import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEpubNavigationController } from "./useEpubNavigation";
import {
	READER_SOURCE_LOCATE_FOCUS_DURATION_MS,
	READER_SOURCE_LOCATE_OVERLAY_TIMING,
} from "../../services/ui/source-locate-overlay-timing";

describe("createEpubNavigationController locate overlay session", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"requestAnimationFrame",
			(callback: FrameRequestCallback): number =>
				window.setTimeout(() => callback(performance.now()), 0) as unknown as number
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("ignores stale overlay retries after a newer locate starts", async () => {
		const overlayRects = [
			new DOMRect(10, 20, 30, 40),
			new DOMRect(100, 200, 30, 40),
		];
		const showAtRect = vi.fn(() => true);
		let currentCfi = "cfi-1";

		const controller = createEpubNavigationController({
			getReaderReady: () => true,
			getReaderService: () => ({
				navigateAndHighlight: vi.fn(async () => undefined),
				navigateTo: vi.fn(),
				getCurrentPosition: () => ({ cfi: currentCfi }),
				getSourceLocateOverlayRect: (options: { cfi?: string }) => {
					if (options.cfi === "cfi-1") {
						return overlayRects[0];
					}
					if (options.cfi === "cfi-2") {
						return overlayRects[1];
					}
					return null;
				},
			}),
			getSourceLocateOverlay: () => ({ showAtRect }),
			getLocateOverlayLabel: () => "Locate",
		});

		controller.requestBookLocate({
			cfi: "cfi-1",
			flashStyle: "highlight",
			showLocateOverlay: true,
		});

		await vi.runOnlyPendingTimersAsync();

		currentCfi = "cfi-2";
		controller.requestBookLocate({
			cfi: "cfi-2",
			flashStyle: "highlight",
			showLocateOverlay: true,
		});

		const totalDelay =
			READER_SOURCE_LOCATE_OVERLAY_TIMING.initialDelayMs +
			READER_SOURCE_LOCATE_OVERLAY_TIMING.retryDelayMs *
				(READER_SOURCE_LOCATE_OVERLAY_TIMING.maxAttempts - 1);
		await vi.advanceTimersByTimeAsync(totalDelay + 50);

		expect(showAtRect).toHaveBeenCalledTimes(1);
		expect(showAtRect.mock.calls[0]?.[0]).toMatchObject({
			left: 100,
			top: 200,
		});
	});

	it("keeps the reader focus highlight visible longer than the locate bubble", async () => {
		const showAtRect = vi.fn(() => true);
		const controller = createEpubNavigationController({
			getReaderReady: () => true,
			getReaderService: () => ({
				navigateAndHighlight: vi.fn(async () => undefined),
				navigateTo: vi.fn(),
				getCurrentPosition: () => ({ cfi: "cfi-focus" }),
				getSourceLocateOverlayRect: () => new DOMRect(24, 36, 120, 20),
			}),
			getSourceLocateOverlay: () => ({ showAtRect }),
			getLocateOverlayLabel: () => "Locate",
		});

		controller.requestBookLocate({
			cfi: "cfi-focus",
			flashStyle: "highlight",
			flashColor: "yellow",
			showLocateOverlay: true,
		});

		const totalDelay =
			READER_SOURCE_LOCATE_OVERLAY_TIMING.initialDelayMs +
			READER_SOURCE_LOCATE_OVERLAY_TIMING.retryDelayMs *
				(READER_SOURCE_LOCATE_OVERLAY_TIMING.maxAttempts - 1);
		await vi.advanceTimersByTimeAsync(totalDelay + 50);

		const overlayDuration = showAtRect.mock.calls[0]?.[1]?.durationMs;
		expect(typeof overlayDuration).toBe("number");
		expect(overlayDuration).toBeLessThan(READER_SOURCE_LOCATE_FOCUS_DURATION_MS);
	});

	it("passes AI source range metadata to reader navigation", async () => {
		const navigateAndHighlight = vi.fn(async () => undefined);
		const controller = createEpubNavigationController({
			getReaderReady: () => true,
			getReaderService: () => ({
				navigateAndHighlight,
				navigateTo: vi.fn(),
				getCurrentPosition: () => ({ cfi: "readium:start" }),
				getSourceLocateOverlayRect: () => new DOMRect(24, 36, 120, 20),
			}),
			getSourceLocateOverlay: () => ({ showAtRect: vi.fn(() => true) }),
			getLocateOverlayLabel: () => "Locate",
		});

		controller.requestBookLocate({
			cfi: "readium:start",
			flashStyle: "pulse",
			flashColor: "yellow",
			rangeEndCfi: "readium:end",
			rangeCfis: ["readium:start", "readium:middle", "readium:end"],
			showLocateOverlay: true,
		});

		await vi.runOnlyPendingTimersAsync();

		expect(navigateAndHighlight).toHaveBeenCalledWith({
			cfi: "readium:start",
			href: undefined,
			text: "",
			flashStyle: "pulse",
			flashColor: "yellow",
			rangeEndCfi: "readium:end",
			rangeCfis: ["readium:start", "readium:middle", "readium:end"],
		});
	});

	it("accepts comma-separated AI source range metadata from event details", () => {
		const controller = createEpubNavigationController({
			getReaderReady: () => false,
			getReaderService: () => null,
		});

		const locate = controller.buildLocateFromEventDetail({
			cfi: "readium:start",
			flashStyle: "pulse",
			rangeEndCfi: "readium:end",
			rangeCfis: "readium:start, readium:middle, readium:end",
		});

		expect(locate?.rangeCfis).toEqual([
			"readium:start",
			"readium:middle",
			"readium:end",
		]);
	});
});
