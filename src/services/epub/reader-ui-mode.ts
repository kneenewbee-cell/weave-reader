export type EpubReaderUiMode = "minimal" | "standard" | "expert";

export const EPUB_READER_UI_MODES: readonly EpubReaderUiMode[] = [
	"minimal",
	"standard",
	"expert",
] as const;

export const DEFAULT_EPUB_READER_UI_MODE: EpubReaderUiMode = "standard";
export const EPUB_READER_UI_MODE_CHANGED_EVENT = "weave-reader-ui-mode-changed";

export function normalizeEpubReaderUiMode(
	value: unknown,
	expertModeEnabled?: unknown
): EpubReaderUiMode {
	const mode = String(value || "").trim().toLowerCase();
	if ((EPUB_READER_UI_MODES as readonly string[]).includes(mode)) {
		return mode as EpubReaderUiMode;
	}
	if (mode === "simple" || mode === "reading") {
		return "minimal";
	}
	return expertModeEnabled === true ? "expert" : DEFAULT_EPUB_READER_UI_MODE;
}

export function notifyEpubReaderUiModeChanged(mode: EpubReaderUiMode): void {
	if (typeof window === "undefined") {
		return;
	}
	window.dispatchEvent(
		new CustomEvent(EPUB_READER_UI_MODE_CHANGED_EVENT, {
			detail: { mode },
		})
	);
}

export function readEpubReaderUiModeChange(event: Event): EpubReaderUiMode | null {
	const detail = (event as CustomEvent<{ mode?: unknown }>).detail;
	if (!detail || !("mode" in detail)) {
		return null;
	}
	return normalizeEpubReaderUiMode(detail.mode);
}
