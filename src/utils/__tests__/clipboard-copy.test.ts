import { describe, expect, it, vi } from "vitest";
import { copyTextToClipboard, focusElementById } from "../clipboard-copy";

describe("clipboard-copy", () => {
	it("copyTextToClipboard returns false for empty text", async () => {
		await expect(copyTextToClipboard("")).resolves.toBe(false);
		await expect(copyTextToClipboard("   ")).resolves.toBe(false);
	});

	it("copyTextToClipboard uses navigator.clipboard when available", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		await expect(copyTextToClipboard("hello")).resolves.toBe(true);
		expect(writeText).toHaveBeenCalledWith("hello");

		vi.unstubAllGlobals();
	});

	it("focusElementById returns false when element is missing", () => {
		expect(focusElementById("missing-activation-code-input")).toBe(false);
	});
});
