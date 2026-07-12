import { describe, expect, it } from "vitest";
import {
	matchesBookshelfPlaylistSearchQuery,
	matchesBookshelfSearchQuery,
	type BookshelfSearchBookFields,
} from "../bookshelf-search-match";
import { parseSearchQuery } from "../../../utils/search-parser";

describe("bookshelf-search-match", () => {
	it("matches playlists by name using the same query parser as books", () => {
		const query = parseSearchQuery("科幻");
		const bookFields: BookshelfSearchBookFields[] = [];

		expect(
			matchesBookshelfPlaylistSearchQuery("我的科幻书单", bookFields, query)
		).toBe(true);
		expect(
			matchesBookshelfPlaylistSearchQuery("日本文学", bookFields, query)
		).toBe(false);
	});

	it("matches playlists when a contained book matches advanced filters", () => {
		const query = parseSearchQuery("author:张三");
		const bookFields: BookshelfSearchBookFields[] = [
			{
				displayTitle: "示例书",
				metaText: "",
				statsLine: "",
				name: "sample.epub",
				folder: "Books",
				author: "张三",
				formatLabel: "EPUB",
				readingStatus: "未开始",
				localizedReadingStatus: "Unread",
				path: "Books/sample.epub",
				addedAt: 0,
			},
		];

		expect(matchesBookshelfPlaylistSearchQuery("任意名称", bookFields, query)).toBe(true);
		expect(
			matchesBookshelfSearchQuery(
				{
					...bookFields[0],
					author: "李四",
				},
				query
			)
		).toBe(false);
	});
});
