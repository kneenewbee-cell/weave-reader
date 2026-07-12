import type { EpubExcerptSettings } from "./epub-excerpt-settings";
import { EPUB_RUNTIME } from "./epub-runtime";

export function notifyExcerptSettingsChanged(settings?: EpubExcerptSettings): void {
	if (typeof window === "undefined") {
		return;
	}
	window.dispatchEvent(
		new CustomEvent(EPUB_RUNTIME.events.excerptSettingsChanged, {
			detail: settings ? { settings } : undefined,
		})
	);
}
