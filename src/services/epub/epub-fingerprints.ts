import { normalizePath } from "obsidian";
import JSZip from "jszip";

export interface EpubFingerprints {
	fileFingerprint: string;
	packageFingerprint: string;
	contentFingerprint: string;
}

export interface PartialEpubFingerprints {
	fileFingerprint?: string;
	packageFingerprint?: string;
	contentFingerprint?: string;
}

type ManifestItem = {
	id: string;
	href: string;
	mediaType: string;
	properties: string;
};

function toUint8Array(value: ArrayBuffer | Uint8Array): Uint8Array {
	return value instanceof Uint8Array ? value : new Uint8Array(value);
}

async function sha256Hex(value: string | ArrayBuffer | Uint8Array): Promise<string> {
	const bytes =
		typeof value === "string"
			? new TextEncoder().encode(value)
			: toUint8Array(value);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function computeEpubFileFingerprint(
	epubBinary: ArrayBuffer | Uint8Array
): Promise<string> {
	return sha256Hex(toUint8Array(epubBinary));
}

export async function computeEpubFingerprints(
	epubBinary: ArrayBuffer | Uint8Array
): Promise<EpubFingerprints> {
	const bytes = toUint8Array(epubBinary);
	const [fileFingerprint, zip] = await Promise.all([
		computeEpubFileFingerprint(bytes),
		JSZip.loadAsync(bytes),
	]);
	const [packageFingerprint, contentFingerprint] = await Promise.all([
		computePackageFingerprint(zip),
		computeContentFingerprint(zip),
	]);
	return {
		fileFingerprint,
		packageFingerprint,
		contentFingerprint,
	};
}

export async function computeAvailableEpubFingerprints(
	epubBinary: ArrayBuffer | Uint8Array
): Promise<PartialEpubFingerprints> {
	const fileFingerprint = await computeEpubFileFingerprint(epubBinary);
	try {
		return await computeEpubFingerprints(epubBinary);
	} catch {
		return { fileFingerprint };
	}
}

async function computePackageFingerprint(zip: JSZip): Promise<string> {
	const entries = Object.values(zip.files)
		.filter((entry) => !entry.dir)
		.map((entry) => ({
			entry,
			path: normalizePath(entry.name),
		}))
		.sort((a, b) => a.path.localeCompare(b.path));

	const lines: string[] = [];
	for (const { entry, path } of entries) {
		const bytes = await entry.async("uint8array");
		lines.push(`${path}\t${bytes.byteLength}\t${await sha256Hex(bytes)}`);
	}
	return sha256Hex(lines.join("\n"));
}

async function computeContentFingerprint(zip: JSZip): Promise<string> {
	const opfPath = await readOpfPath(zip);
	const opfText = opfPath ? await zip.file(opfPath)?.async("string") : "";
	if (!opfPath || !opfText) {
		return sha256Hex("");
	}

	const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
	const manifest = parseManifestItems(opfText);
	const spineIds = parseSpineItemRefs(opfText);
	const spineTexts: string[] = [];

	for (const idRef of spineIds) {
		const item = manifest.get(idRef);
		if (!item || !isReadableSpineItem(item)) {
			continue;
		}
		const href = resolveRelativePath(opfDir, item.href);
		const html = await zip.file(href)?.async("string");
		if (!html) {
			continue;
		}
		const text = normalizeVisibleText(extractVisibleHtmlText(html));
		if (text) {
			spineTexts.push(text);
		}
	}

	if (spineTexts.length === 0) {
		for (const entry of Object.values(zip.files)
			.filter((file) => !file.dir && /\.(xhtml|html?|xml)$/i.test(file.name))
			.sort((a, b) => normalizePath(a.name).localeCompare(normalizePath(b.name)))) {
			const text = normalizeVisibleText(extractVisibleHtmlText(await entry.async("string")));
			if (text) {
				spineTexts.push(text);
			}
		}
	}

	return sha256Hex(spineTexts.join("\n\n---spine-item---\n\n"));
}

async function readOpfPath(zip: JSZip): Promise<string> {
	const container = await zip.file("META-INF/container.xml")?.async("string");
	if (!container) {
		return "";
	}
	const rootfile = /<rootfile\b[^>]*\bfull-path=["']([^"']+)["'][^>]*>/i.exec(container);
	return rootfile ? normalizePath(decodeXmlEntities(rootfile[1])) : "";
}

function parseAttributes(value: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const attrPattern = /([\w:.-]+)\s*=\s*(["'])(.*?)\2/g;
	let match: RegExpExecArray | null;
	while ((match = attrPattern.exec(value))) {
		attrs[match[1].toLowerCase()] = decodeXmlEntities(match[3]);
	}
	return attrs;
}

function parseManifestItems(opfText: string): Map<string, ManifestItem> {
	const manifest = new Map<string, ManifestItem>();
	const itemPattern = /<item\b([^>]*)\/?>/gi;
	let match: RegExpExecArray | null;
	while ((match = itemPattern.exec(opfText))) {
		const attrs = parseAttributes(match[1]);
		const id = String(attrs.id || "").trim();
		const href = String(attrs.href || "").trim();
		if (!id || !href) {
			continue;
		}
		manifest.set(id, {
			id,
			href,
			mediaType: String(attrs["media-type"] || "").trim().toLowerCase(),
			properties: String(attrs.properties || "").trim().toLowerCase(),
		});
	}
	return manifest;
}

function parseSpineItemRefs(opfText: string): string[] {
	const itemRefs: string[] = [];
	const itemRefPattern = /<itemref\b([^>]*)\/?>/gi;
	let match: RegExpExecArray | null;
	while ((match = itemRefPattern.exec(opfText))) {
		const attrs = parseAttributes(match[1]);
		const idRef = String(attrs.idref || "").trim();
		if (idRef) {
			itemRefs.push(idRef);
		}
	}
	return itemRefs;
}

function isReadableSpineItem(item: ManifestItem): boolean {
	if (item.properties.split(/\s+/).includes("nav")) {
		return false;
	}
	return (
		item.mediaType.includes("xhtml") ||
		item.mediaType.includes("html") ||
		/\.(xhtml|html?)$/i.test(item.href)
	);
}

function resolveRelativePath(baseDir: string, href: string): string {
	const decodedHref = decodeXmlEntities(href).split("#")[0];
	const combined = baseDir ? `${baseDir}/${decodedHref}` : decodedHref;
	const parts: string[] = [];
	for (const part of normalizePath(combined).split("/")) {
		if (!part || part === ".") {
			continue;
		}
		if (part === "..") {
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return parts.join("/");
}

function extractVisibleHtmlText(html: string): string {
	const withoutHidden = String(html || "")
		.replace(/<head\b[\s\S]*?<\/head>/gi, " ")
		.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[\s\S]*?<\/style>/gi, " ")
		.replace(/<svg\b[\s\S]*?<\/svg>/gi, " ");
	const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(withoutHidden);
	const body = bodyMatch ? bodyMatch[1] : withoutHidden;
	return body
		.replace(/<br\b[^>]*>/gi, "\n")
		.replace(/<\/(p|div|li|h[1-6]|section|article|blockquote|tr|table|ul|ol)>/gi, "\n")
		.replace(/<[^>]+>/g, " ");
}

function normalizeVisibleText(text: string): string {
	return decodeXmlEntities(text)
		.normalize("NFKC")
		.replace(/[\u200B-\u200D\uFEFF]/g, "")
		.replace(/\s+/g, " ")
		.replace(/\s+([,.;:!?\uFF0C\u3002\uFF1B\uFF1A\uFF01\uFF1F\u3001])/g, "$1")
		.replace(/\s+([,.;:!?，。；：！？、])/g, "$1")
		.trim();
}

function decodeXmlEntities(value: string): string {
	return String(value || "")
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_match, code) =>
			String.fromCodePoint(Number.parseInt(code, 16))
		);
}
