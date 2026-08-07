import { describe, expect, it } from "vitest";
import {
	formatReadingPackageErrorLogArgs,
	getReadingPackageExportNoticeMessage,
} from "../../reading-package";

describe("reading package error formatting", () => {
	it("does not include circular runtime objects in log arguments", () => {
		const circular: Record<string, unknown> = {};
		circular.window = circular;
		const error = new Error("export failed") as Error & { runtime?: unknown };
		error.runtime = circular;

		const args = formatReadingPackageErrorLogArgs("Books/demo.epub", error);

		expect(() => JSON.stringify(args)).not.toThrow();
		expect(args).toEqual(expect.arrayContaining(["filePath=Books/demo.epub", "export failed"]));
		expect(args.some((arg) => arg === error)).toBe(false);
	});

	it("explains empty exported reading package content in user-facing Chinese", () => {
		expect(getReadingPackageExportNoticeMessage(new Error("reading-package-empty-content")))
			.toContain("没有可导出的阅读数据");
	});
});
