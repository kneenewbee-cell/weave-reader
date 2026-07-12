import { EpubLinkService } from "./EpubLinkService";

const SOURCE_SUFFIX_PATTERN =
	/\s*(?:\([^)]*(?:z-library|1lib\.sk|z-lib\.sk)[^)]*\)|\(Z-Library\))\s*\d*\s*$/i;

function stripTrailingCopyIndex(title: string): string {
	return String(title || "")
		.replace(/\s+\d+\s*$/, "")
		.trim();
}

function stripAuthorSuffix(title: string, author?: string): string {
	const normalizedAuthor = String(author || "").trim();
	if (!normalizedAuthor) {
		return title;
	}

	const authorVariants = new Set<string>([
		normalizedAuthor,
		normalizedAuthor.replace(/[·•]/g, "-"),
		normalizedAuthor.replace(/[·•-]/g, " "),
	]);

	for (const variant of authorVariants) {
		if (!variant) {
			continue;
		}
		const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const pattern = new RegExp(`\\s*[\\(（][^)）]*${escaped}[^)）]*[\\)）]\\s*$`, "i");
		const next = title.replace(pattern, "").trim();
		if (next && next !== title) {
			return next;
		}
	}

	return title;
}

function shortenLongTitle(title: string): string {
	if (title.length <= 48) {
		return title;
	}
	const beforeParen = title.split(/[(（]/)[0]?.trim() || "";
	if (beforeParen.length >= 4 && beforeParen.length < title.length) {
		return beforeParen;
	}
	return `${title.slice(0, 45).trim()}…`;
}

export function deriveEpubBookmarkDisplayTitle(input: {
	bookTitle: string;
	bookAuthor?: string;
	bookPath?: string;
}): string {
	let title = String(input.bookTitle || "").trim();
	if (!title && input.bookPath) {
		title = EpubLinkService.extractShortBookName(input.bookPath).replace(/\.\.\.$/, "").trim();
	}

	title = stripTrailingCopyIndex(title.replace(SOURCE_SUFFIX_PATTERN, "").trim());
	title = stripAuthorSuffix(title, input.bookAuthor);
	title = stripTrailingCopyIndex(title);

	if (!title && input.bookPath) {
		title = EpubLinkService.extractShortBookName(input.bookPath).replace(/\.\.\.$/, "").trim();
	}

	return shortenLongTitle(title || "EPUB 书籍");
}

export function buildEpubBookmarkLinkAlias(input: {
	displayTitle: string;
	bookPath?: string;
}): string {
	const displayTitle = String(input.displayTitle || "").trim();
	if (displayTitle) {
		return displayTitle;
	}
	if (input.bookPath) {
		return EpubLinkService.extractShortBookName(input.bookPath);
	}
	return "EPUB";
}
