import { normalizePath } from "obsidian";

function escapeHtmlAttribute(value: unknown): string {
	return String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export function retargetAiReadingNoteSourceFile(markdown: string, sourceFile: string): string {
	const escaped = escapeHtmlAttribute(normalizePath(sourceFile));
	return String(markdown || "").replace(
		/\sdata-source-file="[^"]*"/gi,
		` data-source-file="${escaped}"`,
	);
}

function collectAiReadingSectionKeys(markdown: string): Set<string> {
	const keys = new Set<string>();
	for (const match of String(markdown || "").matchAll(
		/<!--\s*weave-epub-ai-reading:start key="([^"]+)"\s*-->/g,
	)) {
		if (match[1]) {
			keys.add(match[1]);
		}
	}
	return keys;
}

function collectAiReadingGeneratedSections(markdown: string): string[] {
	return Array.from(
		String(markdown || "").matchAll(
			/<!--\s*weave-epub-ai-reading:start key="([^"]+)"\s*-->[\s\S]*?<!--\s*weave-epub-ai-reading:end key="\1"\s*-->/g,
		),
		(match) => match[0],
	);
}

export function mergeAiReadingNoteMarkdown(
	localMarkdown: string,
	importedMarkdown: string,
): string {
	const local = String(localMarkdown || "").trim();
	const imported = String(importedMarkdown || "").trim();
	if (!local) {
		return imported ? `${imported}\n` : "";
	}
	if (!imported) {
		return `${local}\n`;
	}
	const localKeys = collectAiReadingSectionKeys(local);
	const sectionsToAppend = collectAiReadingGeneratedSections(imported).filter((section) => {
		const key = section.match(/key="([^"]+)"/)?.[1] || "";
		return Boolean(key && !localKeys.has(key));
	});
	if (sectionsToAppend.length === 0) {
		return `${local}\n`;
	}
	return `${local}\n\n${sectionsToAppend.join("\n\n")}\n`;
}
