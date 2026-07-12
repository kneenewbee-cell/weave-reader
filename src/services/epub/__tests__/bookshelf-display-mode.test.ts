import { describe, expect, it } from "vitest";
import {
	DEFAULT_BOOKSHELF_DISPLAY_MODE,
	getBookshelfDisplayModeOption,
	normalizeBookshelfDisplayMode,
	resolveBookshelfViewMode,
} from "../bookshelf-display-mode";

describe("bookshelf-display-mode", () => {
	it("normalizes unknown values back to the adaptive default", () => {
		expect(normalizeBookshelfDisplayMode(undefined)).toBe(DEFAULT_BOOKSHELF_DISPLAY_MODE);
		expect(normalizeBookshelfDisplayMode("unexpected")).toBe(DEFAULT_BOOKSHELF_DISPLAY_MODE);
	});

	it("resolves adaptive mode by surface context", () => {
		expect(resolveBookshelfViewMode("adaptive", "sidebar")).toBe("list");
		expect(resolveBookshelfViewMode("adaptive", "main")).toBe("grid");
		expect(resolveBookshelfViewMode("covers", "main")).toBe("covers");
	});

	it("exposes readable metadata for menu and settings rendering", () => {
		expect(getBookshelfDisplayModeOption("covers")).toMatchObject({
			mode: "covers",
			label: "仅看封面",
		});
	});
});
