import { describe, expect, it, vi } from "vitest";

import {
	getCompatibleAISelectedTextPanelHost,
	getCompatibleDataStorage,
	getInheritedLicensesFromLegacyWeave,
	getCompatibleReadingMaterialManager,
	getCompatibleWeaveParentFolderFromSettingsOwner,
} from "../../../utils/plugin-access";

describe("plugin-access compatibility fallbacks", () => {
	it("falls back to Weave readingMaterialManager when standalone plugin exists but lacks the capability", () => {
		const legacyManager = {
			getAllMaterials: vi.fn(async () => []),
		};
		const app = {
			plugins: {
				getPlugin: (pluginId: string) => {
					if (pluginId === "weave-epub-reader") {
						return {};
					}
					if (pluginId === "weave") {
						return { readingMaterialManager: legacyManager };
					}
					return null;
				},
			},
		} as any;

		expect(getCompatibleReadingMaterialManager(app)).toBe(legacyManager);
	});

	it("falls back to Weave dataStorage when standalone plugin exists but lacks the capability", () => {
		const legacyDataStorage = {
			getAllCards: vi.fn(async () => []),
		};
		const app = {
			plugins: {
				getPlugin: (pluginId: string) => {
					if (pluginId === "weave-epub-reader") {
						return {};
					}
					if (pluginId === "weave") {
						return { dataStorage: legacyDataStorage };
					}
					return null;
				},
			},
		} as any;

		expect(getCompatibleDataStorage(app)).toBe(legacyDataStorage);
	});

	it("falls back to Weave AI selected text host when standalone plugin lacks AI capability", () => {
		const legacyDataStorage = {
			getDecks: vi.fn(async () => []),
			saveCard: vi.fn(async () => ({ success: true })),
		};
		const app = {
			plugins: {
				getPlugin: (pluginId: string) => {
					if (pluginId === "weave-epub-reader") {
						return {
							settings: {},
						};
					}
					if (pluginId === "weave") {
						return {
							settings: {},
							dataStorage: legacyDataStorage,
						};
					}
					return null;
				},
			},
		} as any;

		const host = getCompatibleAISelectedTextPanelHost(app);
		expect(host?.app).toBe(app);
		expect(host?.dataStorage).toBe(legacyDataStorage);
	});

	it("prefers the host that actually exposes visible split actions when both plugins support AI", () => {
		const standaloneDataStorage = {
			getDecks: vi.fn(async () => []),
			saveCard: vi.fn(async () => ({ success: true })),
		};
		const legacyDataStorage = {
			getDecks: vi.fn(async () => []),
			saveCard: vi.fn(async () => ({ success: true })),
		};
		const legacySettings = {
			aiConfig: {
				customSplitActions: [
					{
						id: "legacy-split-action",
						name: "知识点拆分",
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
		};
		const app = {
			plugins: {
				getPlugin: (pluginId: string) => {
					if (pluginId === "weave-epub-reader") {
						return {
							settings: {},
							dataStorage: standaloneDataStorage,
						};
					}
					if (pluginId === "weave") {
						return {
							settings: legacySettings,
							dataStorage: legacyDataStorage,
						};
					}
					return null;
				},
			},
		} as any;

		const host = getCompatibleAISelectedTextPanelHost(app);
		expect(host?.settings).toBe(legacySettings);
		expect(host?.dataStorage).toBe(legacyDataStorage);
	});

	it("prefers the current plugin settings owner weaveParentFolder before app-level fallback", () => {
		const owner = {
			settings: {
				weaveParentFolder: "CurrentPluginRoot",
			},
			app: {
				plugins: {
					getPlugin: (pluginId: string) => {
						if (pluginId === "weave-epub-reader") {
							return {
								settings: {
									weaveParentFolder: "StandaloneRoot",
								},
							};
						}
						return null;
					},
				},
			},
		} as any;

	expect(getCompatibleWeaveParentFolderFromSettingsOwner(owner)).toBe("CurrentPluginRoot");
	});

	it("reads inherited licenses directly from the legacy Weave plugin effective state", () => {
		const sharedLicense = {
			activationCode: "shared-license",
			isActivated: true,
			activatedAt: "2026-05-01T00:00:00.000Z",
			deviceFingerprint: "device-fingerprint",
			expiresAt: "2099-05-01T00:00:00.000Z",
			productVersion: "1.0.0",
			licenseType: "lifetime" as const,
			entitlements: ["weave-premium", "epub-premium"],
			issuedProductId: "weave",
			source: "local" as const,
		};
		const app = {
			plugins: {
				getPlugin: (pluginId: string) => {
					if (pluginId === "weave") {
						return {
							manifest: {
								id: "weave",
							},
							getEffectiveLicenseState: () => ({
								product: "weave",
								localLicenses: [sharedLicense],
								inheritedLicenses: [],
								activeLicenses: [sharedLicense],
								entitlements: ["weave-premium", "epub-premium"],
								primaryLicense: sharedLicense,
								isPremiumActive: true,
							}),
						};
					}
					return null;
				},
			},
		} as any;

		const licenses = getInheritedLicensesFromLegacyWeave(app);

		expect(licenses).toHaveLength(1);
		expect(licenses[0]?.activationCode).toBe("shared-license");
		expect(licenses[0]?.source).toBe("inherited");
		expect(licenses[0]?.sourcePluginId).toBe("weave");
		expect(licenses[0]?.entitlements).toEqual(["weave-premium", "epub-premium"]);
	});
});
