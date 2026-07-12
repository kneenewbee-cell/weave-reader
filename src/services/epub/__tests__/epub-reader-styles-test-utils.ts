import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EPUB_STYLE_PARTS = [
	"epub-tokens.css",
	"epub-glass.css",
	"epub-toolbar.css",
	"epub-nav-sidebar.css",
	"epub-highlights.css",
	"epub-progress-ring.css",
] as const;

export function readEpubReaderStylesheet(rootDir = process.cwd()): string {
	const stylesDir = resolve(rootDir, "src/styles/epub");
	return EPUB_STYLE_PARTS.map((part) =>
		readFileSync(resolve(stylesDir, part), "utf8")
	).join("\n");
}
