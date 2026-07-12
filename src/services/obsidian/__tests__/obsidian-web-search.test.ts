import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import {
	buildFallbackWebSearchUrl,
	DEFAULT_WEB_SEARCH_URL,
	resolveObsidianWebSearchUrl,
} from "../obsidian-web-search";

describe("obsidian-web-search", () => {
	it("builds a fallback search URL from the default template", () => {
		expect(buildFallbackWebSearchUrl("hello world")).toBe(
			"https://www.google.com/search?q=hello%20world"
		);
	});

	it("returns empty url for blank queries", () => {
		expect(buildFallbackWebSearchUrl("   ")).toBe("");
		expect(resolveObsidianWebSearchUrl({} as App, "  ")).toBe("");
	});

	it("uses Web Viewer getSearchEngineUrl when available", () => {
		const getSearchEngineUrl = vi.fn((query: string) => `https://duck.example/?q=${query}`);
		const app = {
			internalPlugins: {
				getEnabledPluginById: () => ({
					instance: { getSearchEngineUrl },
				}),
			},
		} as unknown as App;

		expect(resolveObsidianWebSearchUrl(app, "obsidian")).toBe(
			"https://duck.example/?q=obsidian"
		);
		expect(getSearchEngineUrl).toHaveBeenCalledWith("obsidian");
	});

	it("falls back when getSearchEngineUrl throws", () => {
		const app = {
			internalPlugins: {
				getPluginById: () => ({
					instance: {
						getSearchEngineUrl: () => {
							throw new Error("broken");
						},
					},
				}),
			},
		} as unknown as App;

		expect(resolveObsidianWebSearchUrl(app, "test")).toBe(
			buildFallbackWebSearchUrl("test", DEFAULT_WEB_SEARCH_URL)
		);
	});
});
