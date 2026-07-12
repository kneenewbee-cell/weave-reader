import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const paginatorPath = path.resolve(process.cwd(), "node_modules/foliate-js/paginator.js");

describe("foliate paginator runtime patch", () => {
	it("guards scrolled re-render when iframe document is not ready", () => {
		expect(fs.existsSync(paginatorPath)).toBe(true);
		const source = fs.readFileSync(paginatorPath, "utf8");
		expect(source).toContain("weave-epub-reader scrolled render guards");
		expect(source).toContain("if (!el?.style) return");
		expect(source).toContain("if (!doc?.documentElement || !doc.body) return");
		expect(source).toContain("if (width <= 0 || height <= 0) return");
	});
});
