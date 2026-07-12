import { describe, expect, it } from "vitest";
import { getVaultFileBasename } from "../../utils/VaultMarkdownFileSuggest";

describe("VaultMarkdownFileSuggest helpers", () => {
	it("returns basename from vault path", () => {
		expect(getVaultFileBasename("Books/templates/excerpt-classic.md")).toBe(
			"excerpt-classic.md"
		);
		expect(getVaultFileBasename("")).toBe("");
	});
});
