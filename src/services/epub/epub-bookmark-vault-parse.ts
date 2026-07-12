import { parseYaml } from "obsidian";

export function parseEpubBookmarkVaultYamlBlock(content: string): Record<string, unknown> | null {
	const match = String(content || "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
	if (!match) {
		return null;
	}

	try {
		const parsed: unknown = parseYaml(match[1]);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return null;
		}
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

export function isEpubBookmarkVaultFrontmatter(frontmatter: Record<string, unknown>): boolean {
	return frontmatter.weave_epub_bookmark_file === true;
}
