import { describe, expect, it } from "vitest";
import { EpubSettingsTab } from "./EpubSettingsTab";

describe("EpubSettingsTab", () => {
	it("uses the full settings tab display renderer instead of declarative setting definitions", () => {
		const tab = new EpubSettingsTab({} as never, {} as never);

		expect("getSettingDefinitions" in tab).toBe(false);
	});
});
