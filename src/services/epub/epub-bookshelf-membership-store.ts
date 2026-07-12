import { normalizePath } from "obsidian";

export interface EpubBookshelfMembershipEntry {
	path: string;
	addedAt: number;
	customCoverPath?: string;
}

export function normalizeBookshelfMembershipEntries(value: unknown): EpubBookshelfMembershipEntry[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((entry): entry is Partial<EpubBookshelfMembershipEntry> =>
			Boolean(entry && typeof entry === "object")
		)
		.map((entry) => ({
			path: normalizePath(String(entry.path || "").trim()),
			addedAt: typeof entry.addedAt === "number" ? entry.addedAt : 0,
			customCoverPath:
				typeof entry.customCoverPath === "string" && entry.customCoverPath.trim()
					? normalizePath(entry.customCoverPath.trim())
					: undefined,
		}))
		.filter((entry) => Boolean(entry.path));
}

export function dedupeBookshelfMembershipEntries(
	entries: EpubBookshelfMembershipEntry[]
): EpubBookshelfMembershipEntry[] {
	const byPath = new Map<string, EpubBookshelfMembershipEntry>();
	for (const entry of normalizeBookshelfMembershipEntries(entries)) {
		const existing = byPath.get(entry.path);
		if (!existing) {
			byPath.set(entry.path, entry);
			continue;
		}
		byPath.set(entry.path, {
			path: entry.path,
			addedAt: Math.min(existing.addedAt, entry.addedAt),
			customCoverPath: existing.customCoverPath || entry.customCoverPath,
		});
	}
	return Array.from(byPath.values()).sort(
		(a, b) => a.addedAt - b.addedAt || a.path.localeCompare(b.path, "zh-CN")
	);
}
