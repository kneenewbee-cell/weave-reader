import type { ReaderColorScheme } from "./reader-theme-tokens";

export const READER_THEME_HOST_CLASS = "weave-epub-reader-theme-host";
export const READER_HOST_SURFACE_BG_VAR = "--weave-reader-host-bg";
export const READER_HOST_SURFACE_FG_VAR = "--weave-reader-host-fg";

function assertSafeCssColor(value: string, fallback: string): string {
	const trimmed = String(value || "").trim();
	if (!trimmed || /[;{}]/.test(trimmed)) {
		return fallback;
	}
	return trimmed;
}

function normalizeHostColorScheme(value: ReaderColorScheme): ReaderColorScheme {
	return value === "dark" ? "dark" : "light";
}

/** Injected into foliate chapter documents via `<style>` — avoids `element.style.*` assignment. */
export function buildReaderHostSurfaceCss(
	background: string,
	textColor: string,
	colorScheme: ReaderColorScheme
): string {
	const safeBackground = assertSafeCssColor(background, "rgb(255, 255, 255)");
	const safeTextColor = assertSafeCssColor(textColor, "rgb(28, 29, 31)");
	const safeScheme = normalizeHostColorScheme(colorScheme);
	return `:root, :root body {
	color-scheme: ${safeScheme};
	background-color: ${safeBackground};
	color: ${safeTextColor};
}`;
}

export function applyReaderHostSurfaceTokens(
	target: HTMLElement,
	background: string,
	textColor: string,
	colorScheme: ReaderColorScheme
): void {
	target.classList.add(READER_THEME_HOST_CLASS);
	target.style.setProperty(READER_HOST_SURFACE_BG_VAR, background);
	target.style.setProperty(READER_HOST_SURFACE_FG_VAR, textColor);
	target.style.setProperty("color-scheme", normalizeHostColorScheme(colorScheme));
}
