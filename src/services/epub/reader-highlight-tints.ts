import type { ReaderColorScheme } from "./reader-theme-tokens";

export const READER_HIGHLIGHT_TINT_MAP: Record<ReaderColorScheme, Record<string, string>> = {
	light: {
		yellow: "rgb(250, 204, 21)",
		green: "rgb(22, 163, 74)",
		blue: "rgb(37, 99, 235)",
		red: "rgb(220, 38, 38)",
		purple: "rgb(147, 51, 234)",
		orange: "rgb(234, 88, 12)",
		cyan: "rgb(8, 145, 178)",
		pink: "rgb(219, 39, 119)",
		gray: "rgb(107, 114, 128)",
	},
	dark: {
		yellow: "rgb(255, 222, 89)",
		green: "rgb(74, 222, 128)",
		blue: "rgb(96, 165, 250)",
		red: "rgb(248, 113, 113)",
		purple: "rgb(196, 181, 253)",
		orange: "rgb(251, 146, 60)",
		cyan: "rgb(103, 232, 249)",
		pink: "rgb(244, 114, 182)",
		gray: "rgb(209, 213, 219)",
	},
};

export function resolveReaderHighlightTint(
	colorScheme: ReaderColorScheme,
	color?: string
): string {
	const palette = READER_HIGHLIGHT_TINT_MAP[colorScheme];
	if (!color) {
		return palette.yellow;
	}
	return palette[color] || color;
}
