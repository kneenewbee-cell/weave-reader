import { describe, expect, it } from "vitest";
import {
	buildPersistedTocChapterMarkSettings,
	normalizeTocChapterMarkColor,
	normalizeTocChapterMarkSettings,
	resolveTocChapterMarkDefinitions,
} from "../epub-toc-chapter-mark-settings";

const labels = {
	important: "Important",
	question: "Needs review",
	mastered: "Mastered",
	incremental: "Incremental reading",
};

describe("epub-toc-chapter-mark-settings", () => {
	it("normalizes partial settings and invalid values", () => {
		expect(
			normalizeTocChapterMarkSettings({
				important: { label: "  Core  ", color: "#f00" },
				question: { label: "", color: "bad" },
				mastered: { color: "#30a768" },
			})
		).toEqual({
			important: { label: "Core", color: "#ff0000" },
			mastered: { color: "#30a768" },
		});
	});

	it("resolves defaults and overrides together", () => {
		const resolved = resolveTocChapterMarkDefinitions(
			{
				important: { label: "Core", color: "#112233" },
			},
			labels
		);
		expect(resolved[0]).toMatchObject({
			mark: "important",
			label: "Core",
			color: "#112233",
		});
		expect(resolved[1]?.label).toBe("Needs review");
	});

	it("persists only values that differ from defaults", () => {
		const draft = resolveTocChapterMarkDefinitions(
			{
				important: { label: "Core", color: "#112233" },
			},
			labels
		);
		expect(buildPersistedTocChapterMarkSettings(draft, labels)).toEqual({
			important: { label: "Core", color: "#112233" },
		});
	});

	it("normalizes short hex colors", () => {
		expect(normalizeTocChapterMarkColor("#abc")).toBe("#aabbcc");
	});
});
