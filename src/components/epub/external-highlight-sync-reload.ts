export interface ExternalHighlightSyncReloadOptions {
	canReload: () => boolean;
	onReload: (delayMs: number) => void;
	throttleMs?: number;
}

export function attachExternalHighlightSyncReload(
	options: ExternalHighlightSyncReloadOptions
): () => void {
	const throttleMs =
		typeof options.throttleMs === "number" && options.throttleMs > 0 ? options.throttleMs : 1200;
	let reloadTimer: ReturnType<typeof window.setTimeout> | null = null;
	let pendingDelayMs: number | null = null;

	const queueReload = (delayMs: number) => {
		if (!options.canReload()) {
			return;
		}

		pendingDelayMs =
			pendingDelayMs === null ? delayMs : Math.max(pendingDelayMs, delayMs);
		if (reloadTimer) {
			window.clearTimeout(reloadTimer);
		}
		reloadTimer = window.setTimeout(() => {
			reloadTimer = null;
			const delay = pendingDelayMs ?? delayMs;
			pendingDelayMs = null;
			if (!options.canReload()) {
				return;
			}
			options.onReload(delay);
		}, throttleMs);
	};

	const onVisibilityChange = () => {
		if (activeDocument.visibilityState === "visible") {
			queueReload(160);
		}
	};

	const onWindowFocus = () => {
		queueReload(200);
	};

	const onPageShow = () => {
		queueReload(120);
	};

	activeDocument.addEventListener("visibilitychange", onVisibilityChange);
	window.addEventListener("focus", onWindowFocus);
	window.addEventListener("pageshow", onPageShow);

	return () => {
		if (reloadTimer) {
			window.clearTimeout(reloadTimer);
			reloadTimer = null;
		}
		activeDocument.removeEventListener("visibilitychange", onVisibilityChange);
		window.removeEventListener("focus", onWindowFocus);
		window.removeEventListener("pageshow", onPageShow);
	};
}
