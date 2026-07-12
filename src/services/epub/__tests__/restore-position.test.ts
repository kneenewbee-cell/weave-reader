import { describe, expect, it } from "vitest";
import { choosePreferredRestorePosition } from "../restore-position";

describe("choosePreferredRestorePosition", () => {
	it("prefers saved reading progress over manual last-open bookmark", () => {
		const result = choosePreferredRestorePosition(
			{
				chapterIndex: 2,
				cfi: "epubcfi(/6/10!/4/2/6)",
				percent: 9.2,
			},
			{
				chapterIndex: 0,
				cfi: "epubcfi(/6/2!/4/2/2)",
				percent: 0,
				title: "首页",
				preview: "首页",
				savedAt: 1710000000000,
			}
		);

		expect(result).toEqual({
			chapterIndex: 2,
			cfi: "epubcfi(/6/10!/4/2/6)",
			percent: 9.2,
		});
	});

	it("falls back to manual last-open bookmark when progress is absent", () => {
		const result = choosePreferredRestorePosition(null, {
			chapterIndex: 1,
			cfi: "epubcfi(/6/8!/4/2/4)",
			percent: 33.3,
			title: "第二章",
			preview: "第二章",
			savedAt: 1710000000001,
		});

		expect(result).toEqual({
			chapterIndex: 1,
			cfi: "epubcfi(/6/8!/4/2/4)",
			percent: 33.3,
			title: "第二章",
			preview: "第二章",
			savedAt: 1710000000001,
		});
	});

	it("returns null when neither position source is available", () => {
		expect(choosePreferredRestorePosition(null, null)).toBeNull();
	});
});
