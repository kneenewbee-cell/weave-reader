import { normalizePath } from "obsidian";
import { logger } from "../../utils/logger";
import { EpubLinkService } from "./EpubLinkService";
import { createSupportedBookWikilinkRegex } from "./book-link-patterns";
import { isSupportedBookPath } from "./book-format";
import { EPUB_RUNTIME } from "./epub-runtime";

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const EPUB_PROTOCOL_LINK_PATTERN = new RegExp(
	`obsidian://(?:${EPUB_RUNTIME.protocol.allNames.map(escapeRegExp).join("|")})\\?[^\\s"'<>]*`,
	"gi"
);
const SUPPORTED_BOOK_WIKILINK_PATTERN = createSupportedBookWikilinkRegex("gi");

export function rewriteEpubReferences(
	content: string,
	oldPath: string,
	newPath: string
): {
	content: string;
	updatedLinks: number;
	changed: boolean;
} {
	let updatedLinks = 0;
	let changed = false;
	let nextContent = content;

	nextContent = nextContent.replace(
		SUPPORTED_BOOK_WIKILINK_PATTERN,
		(fullMatch, filePath: string, hash = "", alias = "") => {
			const remapped = remapEpubPath(filePath, oldPath, newPath);
			if (!remapped || remapped === filePath) {
				return fullMatch;
			}
			const rewrittenAlias = rewriteAlias(String(alias || ""), filePath, remapped);
			changed = true;
			updatedLinks += 1;
			return `[[${remapped}${hash || ""}${rewrittenAlias}]]`;
		}
	);

	nextContent = nextContent.replace(EPUB_PROTOCOL_LINK_PATTERN, (fullMatch) => {
		const rewritten = rewriteProtocolLink(fullMatch, oldPath, newPath);
		if (rewritten === fullMatch) {
			return fullMatch;
		}
		changed = true;
		updatedLinks += 1;
		return rewritten;
	});

	return {
		content: nextContent,
		updatedLinks,
		changed,
	};
}

function rewriteAlias(aliasSegment: string, oldFilePath: string, newFilePath: string): string {
	if (!aliasSegment.startsWith("|")) {
		return aliasSegment;
	}

	const oldShortName = EpubLinkService.extractShortBookName(oldFilePath);
	const newShortName = EpubLinkService.extractShortBookName(newFilePath);
	const aliasText = aliasSegment.slice(1);

	if (!aliasText || oldShortName === newShortName) {
		return aliasSegment;
	}

	if (aliasText === oldShortName) {
		return `|${newShortName}`;
	}

	if (aliasText.startsWith(`${oldShortName} > `)) {
		return `|${newShortName}${aliasText.slice(oldShortName.length)}`;
	}

	return aliasSegment;
}

function rewriteProtocolLink(link: string, oldPath: string, newPath: string): string {
	const { urlText, suffix } = splitProtocolLinkSuffix(link);

	try {
		const url = new URL(urlText);
		const rawFilePath = url.searchParams.get("file");
		if (!rawFilePath) {
			return link;
		}

		const decodedPath = decodeURIComponent(rawFilePath);
		const remapped = remapEpubPath(decodedPath, oldPath, newPath);
		if (!remapped || remapped === decodedPath) {
			return link;
		}

		const encodedRemapped = encodeURIComponent(remapped);
		const rewrittenUrlText = urlText.replace(/([?&]file=)([^&]*)/i, `$1${encodedRemapped}`);
		return `${rewrittenUrlText}${suffix}`;
	} catch (error) {
		logger.debug("[epub-path-rewrite] Failed to rewrite protocol link:", error);
		return link;
	}
}

function splitProtocolLinkSuffix(link: string): { urlText: string; suffix: string } {
	let urlText = link;
	let suffix = "";
	let openParens = 0;
	let closeParens = 0;

	for (const char of link) {
		if (char === "(") {
			openParens += 1;
		} else if (char === ")") {
			closeParens += 1;
		}
	}

	while (urlText.endsWith(")") && closeParens > openParens) {
		urlText = urlText.slice(0, -1);
		suffix = `)${suffix}`;
		closeParens -= 1;
	}

	return { urlText, suffix };
}

function remapEpubPath(filePath: string, oldPath: string, newPath: string): string | null {
	const normalizedFilePath = normalizePath(filePath || "");
	const normalizedOldPath = normalizePath(oldPath || "");
	const normalizedNewPath = normalizePath(newPath || "");

	if (
		!normalizedFilePath ||
		!normalizedOldPath ||
		!normalizedNewPath ||
		!isSupportedBookPath(normalizedFilePath)
	) {
		return null;
	}

	if (normalizedFilePath === normalizedOldPath) {
		return normalizedNewPath;
	}

	if (normalizedFilePath.startsWith(`${normalizedOldPath}/`)) {
		return `${normalizedNewPath}${normalizedFilePath.slice(normalizedOldPath.length)}`;
	}

	return null;
}
