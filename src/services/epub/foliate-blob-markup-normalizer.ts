import { unknownPlainText } from "../../utils/unknown-plain-text";
import {
	isBlobResourceUrl,
	prefetchBlobUrlsFromText,
	readBlobUrlAsArrayBuffer,
	readBlobUrlAsText,
	readResourceUrlAsBinary,
	readResourceUrlAsText,
} from "../../utils/blob-url-text";
import "../../utils/blob-url-registry";
import {
	sanitizeLegacyAuthorColorAttributes,
	stripAuthorColorDeclarations,
	stripInlineAuthorColorStyles,
} from "../../utils/epub-author-color-sanitizer";
import { logger } from "../../utils/logger";

const REMOTE_RESOURCE_URL_PATTERN = /^(?:https?:)?\/\//i;
const ACTIVE_CONTENT_SELECTOR = "script, iframe, object, embed";
const SCRIPT_PROTOCOL_PATTERN = /^\s*(?:javascript|vbscript)\s*:/i;
const DANGEROUS_URL_ATTRIBUTES = ["href", "src", "xlink:href", "formaction"];

function getMarkupParserType(mediaType: string): DOMParserSupportedType {
	const normalizedMediaType = String(mediaType || "")
		.trim()
		.toLowerCase();
	if (normalizedMediaType.includes("svg")) {
		return "image/svg+xml";
	}
	if (normalizedMediaType.includes("xhtml")) {
		return "application/xhtml+xml";
	}
	return normalizedMediaType.includes("html") ? "text/html" : "application/xhtml+xml";
}

function inferMarkupMediaType(markup: string): string {
	const normalized = String(markup || "").trim().toLowerCase();
	if (/<html[^>]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/1999\/xhtml["']/i.test(normalized)) {
		return "application/xhtml+xml";
	}
	return "text/html";
}

function parseFoliateMarkupDocument(raw: string, parserType: DOMParserSupportedType): Document {
	const primaryDoc = new DOMParser().parseFromString(raw, parserType);
	if (!primaryDoc.querySelector("parsererror")) {
		return primaryDoc;
	}
	if (parserType === "text/html") {
		return primaryDoc;
	}
	return new DOMParser().parseFromString(raw, "text/html");
}

function shouldRemoveHttpEquivMeta(httpEquiv: string): boolean {
	const normalized = httpEquiv.trim().toLowerCase();
	return normalized === "refresh" || normalized === "content-security-policy";
}

function sanitizeFoliateDocument(doc: Document): void {
	for (const element of Array.from(doc.querySelectorAll(ACTIVE_CONTENT_SELECTOR))) {
		element.remove();
	}

	for (const metaElement of Array.from(doc.querySelectorAll("meta[http-equiv]"))) {
		const httpEquiv = metaElement.getAttribute("http-equiv") || "";
		if (shouldRemoveHttpEquivMeta(httpEquiv)) {
			metaElement.remove();
		}
	}

	for (const element of Array.from(doc.querySelectorAll("*"))) {
		for (const attribute of Array.from(element.attributes)) {
			const attributeName = attribute.name;
			const attributeValue = attribute.value || "";
			if (/^on/i.test(attributeName)) {
				element.removeAttribute(attributeName);
				continue;
			}
			if (
				DANGEROUS_URL_ATTRIBUTES.includes(attributeName.toLowerCase()) &&
				SCRIPT_PROTOCOL_PATTERN.test(attributeValue)
			) {
				element.removeAttribute(attributeName);
			}
		}
	}

	sanitizeInlineColorStyles(doc);
	sanitizeLegacyAuthorColorAttributes(doc);
}

function sanitizeInlineColorStyles(doc: Document): void {
	for (const element of Array.from(doc.querySelectorAll("[style]"))) {
		const style = element.getAttribute("style");
		if (!style) {
			continue;
		}

		const sanitized = stripInlineAuthorColorStyles(style);
		if (sanitized) {
			element.setAttribute("style", sanitized);
		} else {
			element.removeAttribute("style");
		}
	}
}

function isRemoteResourceUrl(value: string): boolean {
	return REMOTE_RESOURCE_URL_PATTERN.test(String(value || "").trim());
}

async function readTextResource(href: string): Promise<string> {
	try {
		if (isBlobResourceUrl(href)) {
			return await readBlobUrlAsText(href);
		}
		return await readResourceUrlAsText(href);
	} catch (error) {
		if (!isBlobResourceUrl(href)) {
			logger.warn("[foliate-blob-markup-normalizer] Failed to read transformed resource:", {
				href,
				error,
			});
		}
		return "";
	}
}

async function readBinaryResource(
	href: string
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
	try {
		if (isBlobResourceUrl(href)) {
			return await readBlobUrlAsArrayBuffer(href);
		}
		return await readResourceUrlAsBinary(href);
	} catch (error) {
		if (!isBlobResourceUrl(href)) {
			logger.warn("[foliate-blob-markup-normalizer] Failed to read transformed binary resource:", {
				href,
				error,
			});
		}
		return null;
	}
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(unknownPlainText(reader.result));
		reader.onerror = () =>
			reject(reader.error instanceof Error ? reader.error : new Error("FileReader failed"));
		reader.readAsDataURL(blob);
	});
}

async function readBlobResourceAsDataUrl(href: string): Promise<string | null> {
	const binary = await readBinaryResource(href);
	if (!binary || binary.bytes.length === 0) {
		return null;
	}
	return blobToDataUrl(
		new Blob([binary.bytes], {
			type: binary.mimeType || "application/octet-stream",
		})
	);
}

async function inlineBlobCssUrls(cssText: string, visited = new Set<string>()): Promise<string> {
	const urlPattern = /url\(\s*(['"]?)(blob:[^'")]+)\1\s*\)/gi;
	let output = cssText;
	for (const match of Array.from(cssText.matchAll(urlPattern))) {
		const blobHref = (match[2] || "").trim();
		if (!blobHref.startsWith("blob:") || visited.has(blobHref)) {
			continue;
		}
		visited.add(blobHref);
		const dataUrl = await readBlobResourceAsDataUrl(blobHref);
		if (!dataUrl) {
			continue;
		}
		output = output.replace(match[0], `url("${dataUrl}")`);
	}
	return output;
}

async function inlineBlobCssImports(cssText: string, visited = new Set<string>()): Promise<string> {
	const importPattern = /@import\s+(?:url\()?['"]?([^'")]+)['"]?\)?\s*;/gi;
	let output = cssText;
	for (const match of Array.from(cssText.matchAll(importPattern))) {
		const importHref = (match[1] || "").trim();
		if (!importHref.startsWith("blob:") || visited.has(importHref)) {
			continue;
		}
		visited.add(importHref);
		const importedCss = await readTextResource(importHref);
		if (!importedCss) {
			output = output.replace(match[0], "");
			continue;
		}
		const expanded = await inlineBlobCssImports(importedCss, visited);
		output = output.replace(match[0], expanded);
	}
	return output;
}

function stripUnsupportedExternalCss(cssText: string): string {
	let output = cssText.replace(
		/@import\s+(?:url\()?['"]?([^'")]+)['"]?\)?\s*;/gi,
		(match, href: string) => (isRemoteResourceUrl(href) ? "" : match)
	);

	output = output.replace(/@font-face\s*{[\s\S]*?}/gi, (block) => {
		const sanitizedBlock = block.replace(/src\s*:\s*([^;]+);/gi, (_match, sources: string) => {
			const sanitizedSources = sources
				.replace(
					/\s*,?\s*url\((['"]?)(?:https?:)?\/\/[^)]+?\1\)(?:\s+format\((?:[^)]+)\))?\s*,?/gi,
					", "
				)
				.replace(/\s*,\s*,+/g, ", ")
				.replace(/^\s*,\s*|\s*,\s*$/g, "")
				.trim();
			return sanitizedSources ? `src: ${sanitizedSources};` : "";
		});

		return /src\s*:/.test(sanitizedBlock) ? sanitizedBlock : "";
	});

	return output;
}

async function normalizeFoliateCssText(cssText: string): Promise<string> {
	await prefetchBlobUrlsFromText(cssText);
	const importedCss = await inlineBlobCssImports(cssText);
	const inlinedUrls = await inlineBlobCssUrls(importedCss);
	const withoutRemoteResources = stripUnsupportedExternalCss(inlinedUrls);
	return stripAuthorColorDeclarations(withoutRemoteResources);
}

function createInlineStylesheetElement(
	doc: Document,
	cssText: string,
	linkElement?: Element | null
): HTMLStyleElement {
	const styleElement = doc.createElement("style");
	styleElement.setAttribute("type", "text/css");
	styleElement.setAttribute("data-weave-inline-stylesheet", "true");
	const media = linkElement?.getAttribute("media");
	if (media) {
		styleElement.setAttribute("media", media);
	}
	styleElement.textContent = cssText;
	return styleElement;
}

async function inlineFoliateBlobImages(doc: Document): Promise<void> {
	for (const imageElement of Array.from(doc.querySelectorAll("img[src]"))) {
		const href = imageElement.getAttribute("src") || "";
		if (!href.startsWith("blob:")) {
			continue;
		}
		const dataUrl = await readBlobResourceAsDataUrl(href);
		if (dataUrl) {
			imageElement.setAttribute("src", dataUrl);
		}
	}
}

async function inlineFoliateBlobInlineStyles(doc: Document): Promise<void> {
	for (const element of Array.from(doc.querySelectorAll("[style]"))) {
		const styleValue = element.getAttribute("style");
		if (!styleValue || !/blob:/i.test(styleValue)) {
			continue;
		}
		const inlinedStyle = await inlineBlobCssUrls(styleValue);
		if (inlinedStyle.trim()) {
			element.setAttribute("style", inlinedStyle);
		} else {
			element.removeAttribute("style");
		}
	}
}

/**
 * Inline foliate blob stylesheets/images and strip EPUB CSP meta tags so
 * `iframe.srcdoc` chapters do not attempt blocked `blob:` stylesheet loads.
 */
export async function inlineFoliateBlobMarkup(
	markup: string,
	mediaType?: string
): Promise<string> {
	await prefetchBlobUrlsFromText(markup);
	const resolvedMediaType = mediaType || inferMarkupMediaType(markup);
	const parserType = getMarkupParserType(resolvedMediaType);
	let doc: Document;
	try {
		doc = parseFoliateMarkupDocument(markup, parserType);
	} catch {
		return markup;
	}

	sanitizeFoliateDocument(doc);

	for (const styleElement of Array.from(doc.querySelectorAll("style"))) {
		if (styleElement.textContent) {
			styleElement.textContent = await normalizeFoliateCssText(styleElement.textContent);
		}
	}

	for (const linkElement of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
		const href = linkElement.getAttribute("href") || "";
		if (isRemoteResourceUrl(href)) {
			linkElement.remove();
			continue;
		}
		if (!href.startsWith("blob:")) {
			continue;
		}
		const cssText = await readTextResource(href);
		if (!cssText) {
			linkElement.remove();
			continue;
		}
		const inlinedCss = await normalizeFoliateCssText(cssText);
		linkElement.replaceWith(createInlineStylesheetElement(doc, inlinedCss, linkElement));
	}

	await inlineFoliateBlobImages(doc);
	await inlineFoliateBlobInlineStyles(doc);

	return parserType === "text/html"
		? doc.documentElement.outerHTML
		: new XMLSerializer().serializeToString(doc);
}

export { shouldRemoveHttpEquivMeta };
