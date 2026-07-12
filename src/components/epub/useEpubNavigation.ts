import type { BookLocateIntent, PendingLocateState } from "../../services/navigation/navigation-intent";
import { bookLocateFromPending } from "../../services/navigation/navigation-intent";
import type { EpubReaderEngine } from "../../services/epub";
import { normalizeBookLocateText } from "../../services/epub/epub-source-navigation-text-hint";
import { READER_SOURCE_LOCATE_OVERLAY_TIMING } from "../../services/ui/source-locate-overlay-timing";

export interface EpubNavigationControllerOptions {
	getReaderReady: () => boolean;
	getReaderService: () => EpubReaderEngine;
	getSourceLocateOverlay: () => {
		showAtRect: (
			rect: DOMRect,
			options: { label: string; icon: string; durationMs?: number }
		) => boolean;
	};
	getLocateOverlayLabel: () => string;
	onPendingChange?: (hasPending: boolean) => void;
}

export function createEpubNavigationController(options: EpubNavigationControllerOptions) {
	let pendingBookLocate: BookLocateIntent | null = null;
	let locateOverlaySession = 0;
	const {
		initialDelayMs: locateOverlayInitialDelayMs,
		retryDelayMs: locateOverlayRetryDelayMs,
		maxAttempts: locateOverlayMaxAttempts,
	} = READER_SOURCE_LOCATE_OVERLAY_TIMING;

	function beginLocateOverlaySession(): number {
		locateOverlaySession += 1;
		return locateOverlaySession;
	}

	function isLocateOverlaySessionActive(session: number): boolean {
		return session === locateOverlaySession;
	}

	function notifyPendingChange(): void {
		options.onPendingChange?.(Boolean(pendingBookLocate));
	}

	function sanitizeBookLocateIntent(nav: BookLocateIntent): BookLocateIntent {
		return {
			...nav,
			text: normalizeBookLocateText(nav),
		};
	}

	function buildOverlayLocateIntent(
		nav: BookLocateIntent,
		resolvedCfi: string
	): BookLocateIntent {
		return sanitizeBookLocateIntent({
			...nav,
			cfi: resolvedCfi || nav.cfi,
		});
	}

	function resolveBookLocateOverlayRect(nav: BookLocateIntent): DOMRect | null {
		return options.getReaderService().getSourceLocateOverlayRect({
			cfi: nav.cfi,
			href: nav.href,
			text: nav.text,
		});
	}

	function waitForReaderLayoutFrames(): Promise<void> {
		return new Promise((resolve) => {
			window.requestAnimationFrame(() => {
				window.requestAnimationFrame(() => resolve());
			});
		});
	}

	function showBookLocateOverlay(
		nav: BookLocateIntent,
		attempt = 0,
		session = locateOverlaySession
	): void {
		const delay = attempt === 0 ? locateOverlayInitialDelayMs : locateOverlayRetryDelayMs;
		window.setTimeout(() => {
			if (!isLocateOverlaySessionActive(session)) {
				return;
			}
			const rect = resolveBookLocateOverlayRect(nav);
			if (rect) {
				if (!isLocateOverlaySessionActive(session)) {
					return;
				}
				options.getSourceLocateOverlay().showAtRect(rect, {
					label: options.getLocateOverlayLabel(),
					icon: "map-pinned",
					durationMs: 2200,
				});
				return;
			}
			if (attempt + 1 < locateOverlayMaxAttempts) {
				showBookLocateOverlay(nav, attempt + 1, session);
			}
		}, delay);
	}

	async function applyBookLocate(nav: BookLocateIntent): Promise<void> {
		const overlaySession = beginLocateOverlaySession();
		const readerService = options.getReaderService();
		const locateIntent = sanitizeBookLocateIntent(nav);
		try {
			if (locateIntent.flashStyle && locateIntent.flashStyle !== "none") {
				await readerService.navigateAndHighlight({
					cfi: locateIntent.cfi,
					href: locateIntent.href,
					text: locateIntent.text,
					flashStyle: locateIntent.flashStyle,
					flashColor: locateIntent.flashColor,
				});
			} else {
				await readerService.navigateTo({
					cfi: locateIntent.cfi,
					href: locateIntent.href,
					text: locateIntent.text,
				});
			}
			if (locateIntent.showLocateOverlay && isLocateOverlaySessionActive(overlaySession)) {
				const resolvedCfi = String(readerService.getCurrentPosition()?.cfi || locateIntent.cfi || "").trim();
				await waitForReaderLayoutFrames();
				if (!isLocateOverlaySessionActive(overlaySession)) {
					return;
				}
				showBookLocateOverlay(
					buildOverlayLocateIntent(locateIntent, resolvedCfi),
					0,
					overlaySession
				);
			}
		} catch {
			/* caller logs */
		}
	}

	function requestBookLocate(nav: BookLocateIntent): void {
		const locateIntent = sanitizeBookLocateIntent(nav);
		if (!locateIntent.cfi && !locateIntent.href) {
			return;
		}
		if (!options.getReaderReady()) {
			pendingBookLocate = locateIntent;
			notifyPendingChange();
			return;
		}
		void applyBookLocate(locateIntent);
	}

	function flushPendingBookLocate(): void {
		if (!pendingBookLocate) {
			return;
		}
		const nav = pendingBookLocate;
		pendingBookLocate = null;
		notifyPendingChange();
		void applyBookLocate(nav);
	}

	function flushPendingLocateFromProps(
		pendingLocate: PendingLocateState | null,
		pendingCfi: string,
		pendingText: string
	): void {
		const fromLocate = bookLocateFromPending(pendingLocate);
		if (fromLocate) {
			requestBookLocate({
				...fromLocate,
				flashStyle: fromLocate.flashStyle ?? "highlight",
				showLocateOverlay: fromLocate.showLocateOverlay ?? true,
			});
			return;
		}
		const legacyCfi = String(pendingCfi || "").trim();
		if (legacyCfi) {
			requestBookLocate({
				cfi: legacyCfi,
				text: pendingText || "",
				flashStyle: "highlight",
				showLocateOverlay: true,
			});
		}
	}

	function buildLocateFromEventDetail(detail: Record<string, unknown>): BookLocateIntent | null {
		const nav: BookLocateIntent = {};
		if (typeof detail.cfi === "string" && detail.cfi) {
			nav.cfi = detail.cfi;
		} else if (typeof detail.href === "string" && detail.href) {
			nav.href = detail.href;
		}
		if (typeof detail.text === "string" && detail.text.trim()) {
			nav.text = detail.text.trim();
		}
		if (detail.flashStyle === "pulse" || detail.flashStyle === "highlight" || detail.flashStyle === "none") {
			nav.flashStyle = detail.flashStyle;
		}
		if (typeof detail.flashColor === "string" && detail.flashColor.trim()) {
			nav.flashColor = detail.flashColor.trim();
		}
		if (typeof detail.showLocateOverlay === "boolean") {
			nav.showLocateOverlay = detail.showLocateOverlay;
		}
		if (!nav.cfi && !nav.href) {
			return null;
		}
		return sanitizeBookLocateIntent(nav);
	}

	return {
		requestBookLocate,
		applyBookLocate,
		flushPendingBookLocate,
		flushPendingLocateFromProps,
		buildLocateFromEventDetail,
		hasPendingBookLocate: () => Boolean(pendingBookLocate),
	};
}
