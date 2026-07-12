import { describe, expect, it, vi } from "vitest";
import {
	collectStableDeviceComponents,
	DEVICE_FINGERPRINT_VERSION,
	generateStableDeviceFingerprint,
} from "../device-fingerprint";

describe("device-fingerprint", () => {
	it("uses cross-plugin install id in stable components", () => {
		vi.stubGlobal("require", (id: string) => {
			if (id === "electron") {
				return { app: { getPath: () => "C:/tmp/obsidian-user-data" } };
			}
			if (id === "fs") {
				return {
					readFileSync: () => "11111111-2222-4333-8444-555555555555",
				};
			}
			if (id === "path") {
				return { join: (...parts: string[]) => parts.join("/") };
			}
			if (id === "os") {
				return {
					platform: () => "win32",
					arch: () => "x64",
					hostname: () => "desktop",
				};
			}
			throw new Error(`unexpected require: ${id}`);
		});

		const components = collectStableDeviceComponents({} as never);
		expect(components.some((value) => value.startsWith("weave-install:"))).toBe(true);
		expect(DEVICE_FINGERPRINT_VERSION).toBe(4);
	});

	it("generates deterministic fingerprint for the same install id", async () => {
		vi.stubGlobal("require", (id: string) => {
			if (id === "electron") {
				return { app: { getPath: () => "C:/tmp/obsidian-user-data" } };
			}
			if (id === "fs") {
				return {
					readFileSync: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
				};
			}
			if (id === "path") {
				return { join: (...parts: string[]) => parts.join("/") };
			}
			if (id === "os") {
				return {
					platform: () => "win32",
					arch: () => "x64",
					hostname: () => "desktop",
				};
			}
			throw new Error(`unexpected require: ${id}`);
		});

		const app = {} as never;
		const first = await generateStableDeviceFingerprint(app);
		const second = await generateStableDeviceFingerprint(app);
		expect(first).toBe(second);
		expect(first).toHaveLength(64);
	});
});
