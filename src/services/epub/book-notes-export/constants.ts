import { DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_FOLDER } from "../../../config/epub-user-vault-folders";

export const BOOK_NOTES_EXPORT_MARKER_START = "<!-- weave-epub-excerpts:start -->";
export const BOOK_NOTES_EXPORT_MARKER_END = "<!-- weave-epub-excerpts:end -->";

export { DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_FOLDER };

export const DEFAULT_CLASSIC_TEMPLATE_FILE = "excerpt-classic.md";
export const DEFAULT_CALLOUT_TEMPLATE_FILE = "excerpt-callout.md";
export const DEFAULT_DIGEST_A_TEMPLATE_FILE = "excerpt-digest-a.md";
export const DEFAULT_DIGEST_B_TEMPLATE_FILE = "excerpt-digest-b.md";
export const DEFAULT_CITATION_G_TEMPLATE_FILE = "excerpt-citation-g.md";

export const DEFAULT_CLASSIC_TEMPLATE_PATH = `${DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_FOLDER}/${DEFAULT_CLASSIC_TEMPLATE_FILE}`;
export const DEFAULT_CALLOUT_TEMPLATE_PATH = `${DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_FOLDER}/${DEFAULT_CALLOUT_TEMPLATE_FILE}`;
export const DEFAULT_DIGEST_A_TEMPLATE_PATH = `${DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_FOLDER}/${DEFAULT_DIGEST_A_TEMPLATE_FILE}`;
export const DEFAULT_DIGEST_B_TEMPLATE_PATH = `${DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_FOLDER}/${DEFAULT_DIGEST_B_TEMPLATE_FILE}`;
export const DEFAULT_CITATION_G_TEMPLATE_PATH = `${DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_FOLDER}/${DEFAULT_CITATION_G_TEMPLATE_FILE}`;

export const DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_FILE = DEFAULT_DIGEST_B_TEMPLATE_FILE;
export const DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_PATH = DEFAULT_DIGEST_B_TEMPLATE_PATH;

export type BookNotesExportLegacyTemplate = "classic" | "callout";

export type BookNotesExportBuiltinTemplateId =
	| BookNotesExportLegacyTemplate
	| "digest-a"
	| "digest-b"
	| "citation-g";

export const BOOK_NOTES_EXPORT_BUILTIN_TEMPLATE_IDS: BookNotesExportBuiltinTemplateId[] = [
	"classic",
	"callout",
	"digest-a",
	"digest-b",
	"citation-g",
];
