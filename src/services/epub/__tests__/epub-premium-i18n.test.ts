import { beforeEach, describe, expect, it } from "vitest";
import { PREMIUM_FEATURES } from "../../premium/PremiumFeatureGuard";
import { currentLanguage, initI18n } from "../../../utils/i18n";
import { getEpubPremiumFeaturePreviewContent } from "../epub-premium";
import { get } from "svelte/store";

describe("getEpubPremiumFeaturePreviewContent i18n", () => {
	beforeEach(() => {
		initI18n();
	});

	it("uses English copy for the popover header when Obsidian language is English", () => {
		currentLanguage.set("en-US");
		const preview = getEpubPremiumFeaturePreviewContent(
			PREMIUM_FEATURES.EPUB_READING_REFERENCE
		);
		expect(preview.title).toBe("Reading reference point");
		expect(preview.description).toContain("Manually record a reference reading position");
		expect(preview.title).not.toMatch(/[\u4e00-\u9fff]/);
	});

	it("uses Chinese copy when Obsidian language is Chinese", () => {
		currentLanguage.set("zh-CN");
		const preview = getEpubPremiumFeaturePreviewContent(
			PREMIUM_FEATURES.EPUB_READING_REFERENCE
		);
		expect(preview.title).toBe("参考阅读点");
		expect(get(currentLanguage)).toBe("zh-CN");
	});
});
