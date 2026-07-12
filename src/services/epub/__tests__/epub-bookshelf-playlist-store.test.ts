import { describe, expect, it } from "vitest";
import {
	collectBookshelfPlaylistAssignedPaths,
	normalizeBookshelfPlaylists,
	pruneBookshelfPlaylistPaths,
	remapBookshelfPlaylists,
	remapBookshelfVaultPath,
	removeBookPathFromBookshelfPlaylists,
	sortBookshelfPlaylists,
} from "../epub-bookshelf-playlist-store";

describe("epub-bookshelf-playlist-store", () => {
	it("normalizes playlist entries and dedupes book paths", () => {
		const playlists = normalizeBookshelfPlaylists([
			{
				id: " playlist-1 ",
				name: " 日本文学 ",
				bookPaths: ["Books/a.epub", "Books/a.epub", " Books/b.epub "],
				createdAt: 10,
				updatedAt: 20,
			},
			{ id: "", name: "Invalid", bookPaths: [] },
		]);

		expect(playlists).toEqual([
			{
				id: "playlist-1",
				name: "日本文学",
				bookPaths: ["Books/a.epub", "Books/b.epub"],
				createdAt: 10,
				updatedAt: 20,
			},
		]);
	});

	it("prunes missing book paths against bookshelf membership", () => {
		const playlist = pruneBookshelfPlaylistPaths(
			{
				id: "playlist-1",
				name: "Sci-fi",
				bookPaths: ["Books/a.epub", "Books/missing.epub"],
				createdAt: 1,
				updatedAt: 1,
			},
			new Set(["Books/a.epub"])
		);

		expect(playlist.bookPaths).toEqual(["Books/a.epub"]);
		expect(playlist.updatedAt).toBeGreaterThan(1);
	});

	it("sorts playlists by updatedAt descending", () => {
		const sorted = sortBookshelfPlaylists([
			{
				id: "a",
				name: "A",
				bookPaths: [],
				createdAt: 1,
				updatedAt: 5,
			},
			{
				id: "b",
				name: "B",
				bookPaths: [],
				createdAt: 1,
				updatedAt: 12,
			},
		]);

		expect(sorted.map((playlist) => playlist.id)).toEqual(["b", "a"]);
	});

	it("collects assigned book paths across playlists", () => {
		const assigned = collectBookshelfPlaylistAssignedPaths([
			{
				id: "a",
				name: "A",
				bookPaths: ["Books/a.epub", "Books/b.epub"],
				createdAt: 1,
				updatedAt: 1,
			},
			{
				id: "b",
				name: "B",
				bookPaths: ["Books/b.epub", "Books/c.epub"],
				createdAt: 1,
				updatedAt: 1,
			},
		]);

		expect([...assigned].sort()).toEqual(["Books/a.epub", "Books/b.epub", "Books/c.epub"]);
	});

	it("remaps playlist book paths when a vault file is renamed", () => {
		const { playlists, changed } = remapBookshelfPlaylists(
			[
				{
					id: "playlist-1",
					name: "Sci-fi",
					bookPaths: ["Books/old.epub", "Books/other.epub"],
					createdAt: 1,
					updatedAt: 1,
				},
			],
			"Books/old.epub",
			"Books/new.epub"
		);

		expect(changed).toBe(true);
		expect(playlists[0]?.bookPaths).toEqual(["Books/new.epub", "Books/other.epub"]);
		expect(remapBookshelfVaultPath("Library/Books/old.epub", "Library", "Archive")).toBe(
			"Archive/Books/old.epub"
		);
	});

	it("removes a deleted book path from all playlists", () => {
		const { playlists, changed } = removeBookPathFromBookshelfPlaylists(
			[
				{
					id: "playlist-1",
					name: "Sci-fi",
					bookPaths: ["Books/a.epub", "Books/b.epub"],
					createdAt: 1,
					updatedAt: 1,
				},
				{
					id: "playlist-2",
					name: "Essays",
					bookPaths: ["Books/b.epub"],
					createdAt: 1,
					updatedAt: 1,
				},
			],
			"Books/b.epub"
		);

		expect(changed).toBe(true);
		expect(playlists[0]?.bookPaths).toEqual(["Books/a.epub"]);
		expect(playlists[1]?.bookPaths).toEqual([]);
	});
});
