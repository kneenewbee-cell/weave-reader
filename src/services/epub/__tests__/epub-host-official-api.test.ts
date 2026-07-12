import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../epub-runtime", () => ({
	getEpubRuntime: () => ({
		pluginId: "weave-epub-reader",
	}),
}));

import {
	registerEpubHost,
	resolveEpubWeaveOfficialAPI,
	unregisterEpubHost,
} from "../epub-host";

describe("resolveEpubWeaveOfficialAPI", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("prefers the locally registered host official API when available", () => {
		const localApi = {
			getInfo: vi.fn(() => ({
				apiName: "weave-domain",
				apiVersion: "0.2.0",
			})),
		};
		const runtimePlugin = {
			getOfficialAPI: vi.fn(() => ({
				getInfo: () => ({ apiName: "runtime-api" }),
			})),
		};
		const app = {
			plugins: {
				getPlugin: vi.fn((pluginId: string) =>
					pluginId === "weave-epub-reader" ? runtimePlugin : null,
				),
			},
		} as any;

		registerEpubHost(app, {
			getOfficialAPI: () => localApi,
		} as any);
		const resolved = resolveEpubWeaveOfficialAPI(app);
		unregisterEpubHost(app);

		expect(resolved).toBe(localApi);
		expect(localApi.getInfo).not.toHaveBeenCalled();
	});

	it("falls back to legacy weaveDomainService when the host does not expose getOfficialAPI", () => {
		const legacyApi = {
			getInfo: () => ({
				apiName: "weave-domain",
				apiVersion: "0.2.0",
			}),
		};
		const app = {
			plugins: {
				getPlugin: vi.fn((pluginId: string) => {
					if (pluginId === "weave") {
						return {
							weaveDomainService: legacyApi,
						};
					}
					return null;
				}),
			},
		} as any;

		expect(resolveEpubWeaveOfficialAPI(app)).toBe(legacyApi);
	});
});
