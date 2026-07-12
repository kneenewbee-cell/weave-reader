import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
	buildLicenseSyncFingerprint,
	registerLicenseSyncBridge,
	WEAVE_LICENSE_CHANGED_WORKSPACE_EVENT,
} from "../license-sync-bridge";
import { resolveEffectiveLicenseState, cloneLicenseAsInherited } from "../license-state";
import { LICENSED_PRODUCTS } from "../license-state";
import type { LicenseInfo } from "../../types/license";

function createLicense(activationCode: string, entitlements: LicenseInfo["entitlements"] = ["epub-premium"]): LicenseInfo {
	return {
		activationCode,
		isActivated: true,
		activatedAt: "2026-05-01T00:00:00.000Z",
		deviceFingerprint: "device",
		expiresAt: "2099-05-01T00:00:00.000Z",
		productVersion: "1.0.0",
		licenseType: "lifetime",
		entitlements,
		issuedProductId: "weave-epub-reader",
		source: "local",
	};
}

function createTarget(overrides?: {
	allowInheritedLicenses?: boolean;
	localLicenses?: LicenseInfo[];
	inheritedLicenses?: LicenseInfo[];
	weaveInstalled?: boolean;
}) {
	const localLicenses = overrides?.localLicenses ?? [];
	const inheritedLicenses = overrides?.inheritedLicenses ?? [];
	const refreshPremiumState = vi.fn(async () => {});

	const pluginShell = {
		app: {
			plugins: {
				getPlugin: vi.fn((id: string) => (overrides?.weaveInstalled !== false && id === "weave" ? {} : null)),
			},
			workspace: {
				on: vi.fn(() => ({ unregister: vi.fn() })),
				onLayoutReady: vi.fn((callback: () => void) => callback()),
				trigger: vi.fn(),
			},
		},
		registerEvent: vi.fn(),
		registerDomEvent: vi.fn(),
	};

	const target = {
		app: pluginShell.app,
		settings: {
			allowInheritedLicenses: overrides?.allowInheritedLicenses ?? true,
		},
		getEffectiveLicenseState() {
			return resolveEffectiveLicenseState({
				product: LICENSED_PRODUCTS.EPUB,
				localLicenses,
				inheritedLicenses:
					target.settings.allowInheritedLicenses === false ? [] : inheritedLicenses,
			});
		},
		refreshPremiumState,
	};

	return {
		target,
		pluginShell,
		refreshPremiumState,
		localLicenses,
		inheritedLicenses,
	};
}

describe("license-sync-bridge", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("exports the weave license changed event name", () => {
		expect(WEAVE_LICENSE_CHANGED_WORKSPACE_EVENT).toBe("Weave:license-changed");
	});

	it("builds a stable fingerprint from local and inherited licenses", () => {
		const weaveLicense = cloneLicenseAsInherited(
			createLicense("weave-shared", ["weave-premium", "epub-premium"]),
			"weave"
		);
		const { target } = createTarget({
			inheritedLicenses: [weaveLicense],
		});

		const first = buildLicenseSyncFingerprint(target);
		const second = buildLicenseSyncFingerprint(target);
		expect(first).toBe(second);
		expect(first).toContain("weave-shared");
	});

	it("changes fingerprint when inherited licenses are disabled", () => {
		const weaveLicense = cloneLicenseAsInherited(
			createLicense("weave-shared", ["weave-premium", "epub-premium"]),
			"weave"
		);
		const { target } = createTarget({
			inheritedLicenses: [weaveLicense],
		});

		const before = buildLicenseSyncFingerprint(target);
		target.settings.allowInheritedLicenses = false;
		const after = buildLicenseSyncFingerprint(target);
		expect(before).not.toBe(after);
	});

	it("refreshes premium state when weave license changed event fires", async () => {
		const { target, pluginShell, refreshPremiumState } = createTarget();
		registerLicenseSyncBridge(pluginShell as any, target, { debounceMs: 50 });
		await vi.advanceTimersByTimeAsync(50);

		expect(refreshPremiumState).toHaveBeenCalledTimes(1);

		const workspaceOn = pluginShell.app.workspace.on as ReturnType<typeof vi.fn>;
		const licenseHandler = workspaceOn.mock.calls.find(
			(call) => call[0] === WEAVE_LICENSE_CHANGED_WORKSPACE_EVENT
		)?.[1] as () => void;

		expect(licenseHandler).toBeTypeOf("function");
		licenseHandler();
		await vi.advanceTimersByTimeAsync(50);
		expect(refreshPremiumState).toHaveBeenCalledTimes(2);
	});

	it("skips passive refresh when license fingerprint is unchanged", async () => {
		const { target, pluginShell, refreshPremiumState } = createTarget();
		registerLicenseSyncBridge(pluginShell as any, target, { debounceMs: 50 });
		await vi.advanceTimersByTimeAsync(50);

		expect(refreshPremiumState).toHaveBeenCalledTimes(1);

		const focusHandler = (pluginShell.registerDomEvent as ReturnType<typeof vi.fn>).mock.calls.find(
			(call) => call[1] === "focus"
		)?.[2] as () => void;

		focusHandler();
		await vi.advanceTimersByTimeAsync(50);
		expect(refreshPremiumState).toHaveBeenCalledTimes(1);
	});

	it("passive refresh runs when inherited license appears", async () => {
		const weaveLicense = cloneLicenseAsInherited(
			createLicense("weave-shared", ["weave-premium", "epub-premium"]),
			"weave"
		);
		const { target, pluginShell, refreshPremiumState, inheritedLicenses } = createTarget();
		registerLicenseSyncBridge(pluginShell as any, target, { debounceMs: 50 });
		await vi.advanceTimersByTimeAsync(50);

		expect(refreshPremiumState).toHaveBeenCalledTimes(1);

		inheritedLicenses.push(weaveLicense);

		const focusHandler = (pluginShell.registerDomEvent as ReturnType<typeof vi.fn>).mock.calls.find(
			(call) => call[1] === "focus"
		)?.[2] as () => void;

		focusHandler();
		await vi.advanceTimersByTimeAsync(50);
		expect(refreshPremiumState).toHaveBeenCalledTimes(2);
	});
});
