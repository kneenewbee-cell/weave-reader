import type { ReaderColorScheme } from "./reader-theme-tokens";

export const READER_HIGHLIGHT_TINT_MAP: Record<ReaderColorScheme, Record<string, string>> = {
	light: {
		yellow: "rgb(250, 204, 21)",
		orange: "rgb(249, 115, 22)",
		red: "rgb(239, 68, 68)",
		magenta: "rgb(236, 72, 153)",
		purple: "rgb(139, 92, 246)",
		indigo: "rgb(79, 70, 229)",
		blue: "rgb(14, 165, 233)",
		teal: "rgb(20, 184, 166)",
		green: "rgb(34, 197, 94)",
		slate: "rgb(100, 116, 139)",
		cyan: "rgb(20, 184, 166)",
		pink: "rgb(236, 72, 153)",
		gray: "rgb(100, 116, 139)",
	},
	dark: {
		yellow: "rgb(255, 222, 89)",
		orange: "rgb(251, 146, 60)",
		red: "rgb(248, 113, 113)",
		magenta: "rgb(244, 114, 182)",
		purple: "rgb(196, 181, 253)",
		indigo: "rgb(129, 140, 248)",
		blue: "rgb(56, 189, 248)",
		teal: "rgb(45, 212, 191)",
		green: "rgb(74, 222, 128)",
		slate: "rgb(203, 213, 225)",
		cyan: "rgb(45, 212, 191)",
		pink: "rgb(244, 114, 182)",
		gray: "rgb(203, 213, 225)",
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
