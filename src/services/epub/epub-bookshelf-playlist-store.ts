import { normalizePath } from "obsidian";

export interface EpubBookshelfPlaylist {
	id: string;
	name: string;
	bookPaths: string[];
	createdAt: number;
	updatedAt: number;
}

export function createBookshelfPlaylistId(): string {
	return `playlist-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeBookshelfPlaylistBookPaths(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const seen = new Set<string>();
	const paths: string[] = [];
	for (const entry of value) {
		const path = normalizePath(String(entry || "").trim());
		if (!path || seen.has(path)) {
			continue;
		}
		seen.add(path);
		paths.push(path);
	}
	return paths;
}

export function normalizeBookshelfPlaylists(value: unknown): EpubBookshelfPlaylist[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((entry): entry is Partial<EpubBookshelfPlaylist> =>
			Boolean(entry && typeof entry === "object")
		)
		.map((entry) => {
			const createdAt = typeof entry.createdAt === "number" ? entry.createdAt : Date.now();
			const updatedAt = typeof entry.updatedAt === "number" ? entry.updatedAt : createdAt;
			return {
				id: String(entry.id || "").trim(),
				name: String(entry.name || "").trim(),
				bookPaths: normalizeBookshelfPlaylistBookPaths(entry.bookPaths),
				createdAt,
				updatedAt,
			};
		})
		.filter((entry) => Boolean(entry.id) && Boolean(entry.name));
}

export function sortBookshelfPlaylists(playlists: EpubBookshelfPlaylist[]): EpubBookshelfPlaylist[] {
	return [...playlists].sort(
		(a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, "zh-CN")
	);
}

export function pruneBookshelfPlaylistPaths(
	playlist: EpubBookshelfPlaylist,
	validPaths: ReadonlySet<string>
): EpubBookshelfPlaylist {
	const bookPaths = playlist.bookPaths.filter((path) => validPaths.has(path));
	if (
		bookPaths.length === playlist.bookPaths.length &&
		bookPaths.every((path, index) => path === playlist.bookPaths[index])
	) {
		return playlist;
	}
	return {
		...playlist,
		bookPaths,
		updatedAt: Date.now(),
	};
}

export function remapBookshelfVaultPath(
	filePath: string,
	oldPath: string,
	newPath: string
): string | null {
	const normalizedFilePath = normalizePath(String(filePath || "").trim());
	const normalizedOldPath = normalizePath(String(oldPath || "").trim());
	const normalizedNewPath = normalizePath(String(newPath || "").trim());

	if (!normalizedFilePath || !normalizedOldPath || !normalizedNewPath) {
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

export function remapBookshelfPlaylistBookPaths(
	bookPaths: string[],
	oldPath: string,
	newPath: string
): string[] {
	const seen = new Set<string>();
	const remappedPaths: string[] = [];

	for (const bookPath of bookPaths) {
		const remappedPath = remapBookshelfVaultPath(bookPath, oldPath, newPath) || bookPath;
		if (!remappedPath || seen.has(remappedPath)) {
			continue;
		}
		seen.add(remappedPath);
		remappedPaths.push(remappedPath);
	}

	return remappedPaths;
}

export function remapBookshelfPlaylists(
	playlists: EpubBookshelfPlaylist[],
	oldPath: string,
	newPath: string
): { playlists: EpubBookshelfPlaylist[]; changed: boolean } {
	let changed = false;
	const nextPlaylists = playlists.map((playlist) => {
		const bookPaths = remapBookshelfPlaylistBookPaths(playlist.bookPaths, oldPath, newPath);
		if (
			bookPaths.length === playlist.bookPaths.length
			&& bookPaths.every((path, index) => path === playlist.bookPaths[index])
		) {
			return playlist;
		}

		changed = true;
		return {
			...playlist,
			bookPaths,
			updatedAt: Date.now(),
		};
	});

	return { playlists: nextPlaylists, changed };
}

export function removeBookPathFromBookshelfPlaylists(
	playlists: EpubBookshelfPlaylist[],
	bookPath: string
): { playlists: EpubBookshelfPlaylist[]; changed: boolean } {
	const normalizedPath = normalizePath(String(bookPath || "").trim());
	if (!normalizedPath) {
		return { playlists, changed: false };
	}

	let changed = false;
	const nextPlaylists = playlists.map((playlist) => {
		const bookPaths = playlist.bookPaths.filter((path) => path !== normalizedPath);
		if (bookPaths.length === playlist.bookPaths.length) {
			return playlist;
		}

		changed = true;
		return {
			...playlist,
			bookPaths,
			updatedAt: Date.now(),
		};
	});

	return { playlists: nextPlaylists, changed };
}

export function collectBookshelfPlaylistAssignedPaths(
	playlists: EpubBookshelfPlaylist[]
): Set<string> {
	const assignedPaths = new Set<string>();
	for (const playlist of playlists) {
		for (const path of playlist.bookPaths) {
			assignedPaths.add(path);
		}
	}
	return assignedPaths;
}

export function isBookAssignedToBookshelfPlaylist(
	path: string,
	playlists: EpubBookshelfPlaylist[]
): boolean {
	const normalizedPath = normalizePath(String(path || "").trim());
	if (!normalizedPath) {
		return false;
	}
	return collectBookshelfPlaylistAssignedPaths(playlists).has(normalizedPath);
}
