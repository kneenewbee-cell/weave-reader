import { afterEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import {
	aiConfigStore,
	customActionsForMenu,
	splitActionsForMenu,
} from "../../../stores/ai-config.store";

describe("ai-config store split menu compatibility", () => {
	afterEach(() => {
		aiConfigStore.destroy();
	});

	it("normalizes legacy custom split actions so they remain visible in menus", () => {
		const plugin = {
			settings: {
				aiConfig: {
					apiKeys: {},
					defaultProvider: "zhipu",
					customFormatActions: [],
					customSplitActions: [
						{
							id: "legacy-split-1",
							name: "旧版自定义拆分",
							systemPrompt: "system",
							userPromptTemplate: "user",
							splitConfig: {
								targetCount: 3,
								splitStrategy: "knowledge-point",
								outputFormat: "qa",
							},
							enabled: true,
						},
					],
				},
			},
			saveSettings: async () => undefined,
		};

		aiConfigStore.initialize(plugin as any);

		const state = aiConfigStore.getState();
		expect(state.customSplitActions).toHaveLength(1);
		expect(state.customSplitActions[0]).toMatchObject({
			id: "legacy-split-1",
			type: "split",
			category: "custom",
		});
		expect(get(splitActionsForMenu).map((action) => action.id)).toEqual(["legacy-split-1"]);
		expect(get(customActionsForMenu).split.map((action) => action.id)).toEqual(["legacy-split-1"]);
	});

	it("only exposes user-defined split actions in the split menu", () => {
		const plugin = {
			settings: {
				aiConfig: {
					apiKeys: {},
					defaultProvider: "zhipu",
					customFormatActions: [],
					customSplitActions: [
						{
							id: "custom-split-visible",
							name: "自定义拆分",
							type: "split",
							category: "custom",
							systemPrompt: "system",
							userPromptTemplate: "user",
							splitConfig: {
								targetCount: 2,
								splitStrategy: "knowledge-point",
								outputFormat: "qa",
							},
							enabled: true,
						},
						{
							id: "custom-split-disabled",
							name: "禁用拆分",
							type: "split",
							category: "custom",
							systemPrompt: "system",
							userPromptTemplate: "user",
							splitConfig: {
								targetCount: 2,
								splitStrategy: "knowledge-point",
								outputFormat: "qa",
							},
							enabled: false,
						},
					],
				},
			},
			saveSettings: async () => undefined,
		};

		aiConfigStore.initialize(plugin as any);

		const visibleIds = get(splitActionsForMenu).map((action) => action.id);
		expect(visibleIds).toEqual(["custom-split-visible"]);
		expect(visibleIds.some((id) => id.startsWith("official-"))).toBe(false);
	});
});
