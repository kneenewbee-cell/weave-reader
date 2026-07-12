export const SUPPORTED_BOOK_EXTENSIONS = [
	"epub",
	"mobi",
	"azw3",
	"fb2",
	"fbz",
	"cbz",
	"txt",
] as const;

export type SupportedBookExtension = (typeof SUPPORTED_BOOK_EXTENSIONS)[number];
