import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { openObsidianVaultSearch } from "../obsidian-vault-search";

describe("obsidian-vault-search", () => {
	it("opens global search with trimmed query", () => {
		const openGlobalSearch = vi.fn();
		const app = {
			internalPlugins: {
				getPluginById: () => ({
					instance: { openGlobalSearch },
				}),
			},
		} as unknown as App;

		expect(openObsidianVaultSearch(app, "  hello  ")).toBe(true);
		expect(openGlobalSearch).toHaveBeenCalledWith("hello");
	});

	it("returns false when global search is unavailable", () => {
		expect(openObsidianVaultSearch({} as App, "hello")).toBe(false);
		expect(openObsidianVaultSearch({} as App, "   ")).toBe(false);
	});
});
