import { TAbstractFile, TFile, normalizePath } from "obsidian";
import { i18n } from "../../utils/i18n";
import {
	SUPPORTED_BOOK_EXTENSIONS,
	type SupportedBookExtension,
} from "./supported-book-extensions";

export { SUPPORTED_BOOK_EXTENSIONS, type SupportedBookExtension };

const SUPPORTED_BOOK_EXTENSION_SET = new Set<string>(SUPPORTED_BOOK_EXTENSIONS);

export function isSupportedBookWikilinkMarkup(markup: string): boolean {
	const normalized = String(markup || "").trim();
	if (!normalized.startsWith("[[") || !normalized.endsWith("]]")) {
		return false;
	}
	const inner = normalized.slice(2, -2);
	const hashIndex = inner.indexOf("#");
	if (hashIndex < 0) {
		return false;
	}
	const filePath = inner.slice(0, hashIndex).split("|")[0]?.trim() || "";
	if (!isSupportedBookPath(filePath)) {
		return false;
	}
	return hasSupportedBookLocatorSubpath(inner.slice(hashIndex));
}

export function normalizeBookExtension(value: string): string {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/^\.+/, "");
}

export function getBookExtensionFromPath(filePath: string): string {
	const normalizedPath = normalizePath(String(filePath || ""));
	const fileName = normalizedPath.split("/").pop() || normalizedPath;
	const normalizedFileName = fileName.toLowerCase();
	if (normalizedFileName.endsWith(".fb2.zip") || normalizedFileName.endsWith(".fbz")) {
		return "fbz";
	}
	const dotIndex = fileName.lastIndexOf(".");
	return dotIndex >= 0 ? normalizeBookExtension(fileName.slice(dotIndex + 1)) : "";
}

export function getBookFormatDisplayLabel(extensionOrPath: string): string {
	const normalized = isSupportedBookPath(extensionOrPath)
		? getBookExtensionFromPath(extensionOrPath)
		: normalizeBookExtension(extensionOrPath);

	switch (normalized) {
		case "epub":
			return "EPUB";
		case "mobi":
			return "MOBI";
		case "azw3":
			return "AZW3";
		case "fb2":
			return "FB2";
		case "fbz":
			return "FB2.ZIP";
		case "cbz":
			return "CBZ";
		case "txt":
			return "TXT";
		default:
			return normalized ? normalized.toUpperCase() : i18n.t("epub.common.unknownFormat");
	}
}

export function isSupportedBookExtension(value: string): value is SupportedBookExtension {
	return SUPPORTED_BOOK_EXTENSION_SET.has(normalizeBookExtension(value));
}

/** Book formats available without Premium license (EPUB + TXT). */
export function isFreeBookFormat(filePathOrExtension: string): boolean {
	const extension = isSupportedBookPath(filePathOrExtension)
		? getBookExtensionFromPath(filePathOrExtension)
		: normalizeBookExtension(filePathOrExtension);
	return extension === "epub" || extension === "txt";
}

export function isSupportedBookPath(filePath: string): boolean {
	return isSupportedBookExtension(getBookExtensionFromPath(filePath));
}

export function isSupportedBookFile(file: TAbstractFile | null | undefined): file is TFile {
	if (!file) {
		return false;
	}

	if (file instanceof TFile) {
		return isSupportedBookPath(file.path);
	}

	// Fallback for test doubles / cross-realm file objects that still expose a valid vault path.
	const fallbackPath = (file as { path?: unknown }).path;
	return typeof fallbackPath === "string" && isSupportedBookPath(fallbackPath);
}

export function stripSupportedBookExtension(value: string): string {
	return String(value || "")
		.trim()
		.replace(/\.fb2\.zip$/i, "")
		.replace(/\.(epub|mobi|azw3|fb2|fbz|cbz|txt)$/i, "");
}

export function usesPlainTextBookAdapter(extensionOrPath: string): boolean {
	const normalized = isSupportedBookPath(extensionOrPath)
		? getBookExtensionFromPath(extensionOrPath)
		: normalizeBookExtension(extensionOrPath);
	return normalized === "txt";
}

export function usesFoliateGenericBookLoader(extensionOrPath: string): boolean {
	const normalized = isSupportedBookPath(extensionOrPath)
		? getBookExtensionFromPath(extensionOrPath)
		: normalizeBookExtension(extensionOrPath);
	return normalized !== "" && normalized !== "epub" && normalized !== "txt";
}

const SUPPORTED_BOOK_LOCATOR_MARKERS = [
	"weave-loc=",
	"weave-cfi=",
	"tuanki-cfi=",
	"tuanki-cfi-",
] as const;

export function hasSupportedBookLocatorSubpath(subpath: string): boolean {
	const normalized = String(subpath || "").trim();
	if (!normalized) {
		return false;
	}
	const hashContent = normalized.startsWith("#") ? normalized.slice(1) : normalized;
	return SUPPORTED_BOOK_LOCATOR_MARKERS.some((marker) => hashContent.includes(marker));
}

export function splitSupportedBookLocatorHref(
	href: string
): { filePath: string; subpath: string } | null {
	const normalized = String(href || "").trim();
	const hashIdx = normalized.indexOf("#");
	if (hashIdx === -1) {
		return null;
	}
	const filePath = normalized.substring(0, hashIdx);
	if (!isSupportedBookPath(filePath)) {
		return null;
	}
	const subpath = normalized.substring(hashIdx);
	if (!hasSupportedBookLocatorSubpath(subpath)) {
		return null;
	}
	return { filePath, subpath };
}

export function isSupportedBookLocatorHref(href: string): boolean {
	return splitSupportedBookLocatorHref(href) !== null;
}
