import { domInstanceOf } from "../../utils/dom-instance-of";
import {
	readObsidianColorScheme,
	readObsidianCssVar,
	type ReaderColorScheme,
} from "./reader-theme-tokens";
import {
	applyReaderHostSurfaceTokens,
	READER_THEME_HOST_CLASS,
} from "./reader-host-surface-css";

export interface ReaderThemeHostSurfaceInput {
	styleSource: HTMLElement;
	renderContainer: HTMLElement | null;
	foliateView: HTMLElement | null;
	renderer?: HTMLElement | null;
	colorScheme?: ReaderColorScheme;
}

export function applyReaderThemeHostSurfaces(input: ReaderThemeHostSurfaceInput): void {
	const background = readObsidianCssVar(input.styleSource, "--background-primary", "rgb(255, 255, 255)");
	const textColor = readObsidianCssVar(input.styleSource, "--text-normal", "rgb(28, 29, 31)");
	const colorScheme = input.colorScheme ?? readObsidianColorScheme();
	const targets = [input.renderContainer, input.foliateView, input.renderer ?? null].filter(
		Boolean
	) as HTMLElement[];

	for (const target of targets) {
		if (!domInstanceOf(target, HTMLElement) || !target.style) {
			continue;
		}
		applyReaderHostSurfaceTokens(target, background, textColor, colorScheme);
	}

	for (const iframe of Array.from(input.renderContainer?.querySelectorAll("iframe") || [])) {
		if (!domInstanceOf(iframe, HTMLIFrameElement)) {
			continue;
		}
		applyReaderHostSurfaceTokens(iframe, background, textColor, colorScheme);
	}
}

export { READER_THEME_HOST_CLASS };
