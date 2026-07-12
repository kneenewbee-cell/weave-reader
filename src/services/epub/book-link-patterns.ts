import { SUPPORTED_BOOK_EXTENSIONS } from "./supported-book-extensions";

function escapeRegExpForBookPattern(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Path segment inside `[[...]]` for any supported book extension (incl. `.fb2.zip`).
 * Greedy basename match + `#` lookahead so filenames may contain `()` and other dots.
 */
export const SUPPORTED_BOOK_WIKILINK_PATH_PATTERN = `[^\\\\#\\n]+\\.(?:fb2\\.zip|(?:${SUPPORTED_BOOK_EXTENSIONS.map(
	escapeRegExpForBookPattern
).join("|")}))(?=#)`;

/**
 * Matches Obsidian wikilinks to vault books. Hash and alias may contain `]` inside CFI payloads.
 */
export function createSupportedBookWikilinkRegex(flags = "gi"): RegExp {
	return new RegExp(
		`\\[\\[(${SUPPORTED_BOOK_WIKILINK_PATH_PATTERN})(#(?:(?!\\]\\]).)*)?(\\|(?:(?!\\]\\]).)+)?\\]\\]`,
		flags
	);
}
