import { normalizePath, type App, type WorkspaceLeaf } from "obsidian";
import {
	openBookForSourceNavigation,
	openEpubInPreferredLeaf,
} from "../../utils/epub-leaf-utils";
import { openFileWithExistingLeaf } from "../../utils/workspace-navigation";
import { logger } from "../../utils/logger";
import { ensureBookSourceLocationAccess, ensureEpubFileAccess } from "../epub/epub-premium";
import { hasBookLocateTarget } from "./navigation-intent";
import { resolveEpubVaultPath } from "../epub/epub-vault-path";
import { getEpubStorageService } from "../epub/epub-storage-access";
import { resolveEpubHost } from "../epub/epub-host";
import { SourceNavigationService } from "../ui/SourceNavigationService";
import { i18n } from "../../utils/i18n";
import type { NavigationIntent, NavigationResult, PendingLocateState } from "./navigation-intent";

export interface NavigationHubOptions {
	getSourceNavigationOpenInNewTab?: () => boolean;
	getEnableDebugMode?: () => boolean;
}

function buildBookViewState(
	filePath: string,
	locate?: NavigationIntent["locate"]
): Record<string, unknown> {
	const pendingLocate = locateToPendingState(locate);
	const state: Record<string, unknown> = { filePath };
	if (pendingLocate) {
		state.pendingLocate = pendingLocate;
		state.pendingCfi = pendingLocate.cfi || "";
		state.pendingText = pendingLocate.text || "";
	}
	return state;
}

function locateToPendingState(locate?: NavigationIntent["locate"]): PendingLocateState | null {
	if (!locate) {
		return null;
	}
	const cfi = String(locate.cfi || "").trim();
	const href = String(locate.href || "").trim();
	const text = locate.text || "";
	if (!cfi && !href) {
		return null;
	}
	return {
		cfi: cfi || undefined,
		href: href || undefined,
		text,
		flashStyle: locate.flashStyle,
		flashColor: locate.flashColor,
		showLocateOverlay: locate.showLocateOverlay,
	};
}

export class NavigationHub {
	private readonly sourceNavigation: SourceNavigationService;

	constructor(
		private readonly app: App,
		private readonly options: NavigationHubOptions = {}
	) {
		this.sourceNavigation = new SourceNavigationService(app);
	}

	async navigate(intent: NavigationIntent): Promise<NavigationResult> {
		const startedAt = this.options.getEnableDebugMode?.() ? performance.now() : 0;
		try {
			let result: NavigationResult;
			switch (intent.kind) {
				case "book":
					result = await this.navigateBook(intent);
					break;
				case "markdown":
					result = await this.navigateMarkdown(intent);
					break;
				case "json":
					result = await this.navigateJson(intent);
					break;
				case "canvas":
					result = await this.navigateCanvas(intent);
					break;
				case "card":
					result = await this.navigateCard(intent);
					break;
				default:
					result = { success: false, error: `Unknown navigation kind: ${String((intent as { kind?: string }).kind ?? "unknown")}` };
			}
			if (startedAt > 0) {
				logger.debug(
					`[NavigationHub] navigate ${intent.kind} ${intent.resourcePath} in ${(performance.now() - startedAt).toFixed(1)}ms success=${result.success}`
				);
			}
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error("[NavigationHub] navigate failed:", error);
			return { success: false, error: message };
		}
	}

	private resolveOpenInNewTab(intent: NavigationIntent): boolean {
		if (intent.policy?.openInNewTab !== undefined) {
			return intent.policy.openInNewTab;
		}
		return this.options.getSourceNavigationOpenInNewTab?.() ?? true;
	}

	private async navigateBook(intent: NavigationIntent): Promise<NavigationResult> {
		if (
			hasBookLocateTarget(intent.locate) &&
			!ensureBookSourceLocationAccess(
				this.app,
				i18n.t("epub.reader.sourceLocationFeatureNotice")
			)
		) {
			return { success: false, error: "premium_unavailable" };
		}

		const normalizedLinkPath = normalizePath(String(intent.resourcePath || "").trim());
		const vaultPath =
			resolveEpubVaultPath(this.app, normalizedLinkPath, intent.context?.sourceMarkdownPath) ||
			normalizedLinkPath;
		const storageService = getEpubStorageService(this.app);
		const resolvedFilePath = await storageService.resolveSourceFilePath(
			intent.context?.sourceId,
			vaultPath
		);
		if (!resolvedFilePath) {
			logger.warn("[NavigationHub] Unable to resolve book path:", {
				filePath: normalizedLinkPath,
				vaultPath,
				sourceId: intent.context?.sourceId,
			});
			return { success: false, error: "unresolved_path" };
		}
		if (!ensureEpubFileAccess(this.app, resolvedFilePath)) {
			return { success: false, error: "access_denied" };
		}

		const viewState = buildBookViewState(resolvedFilePath, intent.locate);
		const focus = intent.policy?.focus !== false;
		let leaf: WorkspaceLeaf | null;

		if (intent.policy?.preferredLeaf || intent.policy?.reuseLeaf) {
			leaf = await openEpubInPreferredLeaf(this.app, resolvedFilePath, viewState);
		} else {
			leaf = await openBookForSourceNavigation(this.app, resolvedFilePath, viewState, { focus });
		}

		if (!leaf) {
			return { success: false, error: "no_leaf" };
		}
		return { success: true, leaf };
	}

	private async navigateMarkdown(intent: NavigationIntent): Promise<NavigationResult> {
		const openInNewTab = this.resolveOpenInNewTab(intent);
		const focus = intent.policy?.focus !== false;
		const contextPath = intent.context?.epubFilePath || intent.resourcePath;
		const candidates = intent.locate?.candidates || [];
		const label = i18n.t("epub.reader.locateSourcePosition");
		const leaf = await this.sourceNavigation.openMarkdownLinkAndLocate(
			intent.resourcePath,
			contextPath,
			candidates,
			{
				label,
				icon: "map-pinned",
				openInNewTab,
				focus,
				delayMs: 220,
			}
		);
		return { success: Boolean(leaf), leaf };
	}

	private async navigateJson(intent: NavigationIntent): Promise<NavigationResult> {
		const openInNewTab = this.resolveOpenInNewTab(intent);
		const focus = intent.policy?.focus !== false;
		const leaf = await openFileWithExistingLeaf(this.app, intent.resourcePath, {
			openInNewTab,
			focus,
		});
		return { success: Boolean(leaf), leaf };
	}

	private async navigateCanvas(intent: NavigationIntent): Promise<NavigationResult> {
		const openInNewTab = this.resolveOpenInNewTab(intent);
		const focus = intent.policy?.focus !== false;
		const candidates = intent.locate?.candidates || [];
		const leaf = await this.sourceNavigation.openCanvasAndLocate(
			intent.resourcePath,
			candidates,
			intent.context?.nodeId,
			{
				label: i18n.t("epub.reader.locateSourcePosition"),
				icon: "map-pinned",
				openInNewTab,
				focus,
				delayMs: intent.policy?.preferredLeaf ? 500 : 320,
			}
		);
		return { success: Boolean(leaf), leaf };
	}

	private async navigateCard(intent: NavigationIntent): Promise<NavigationResult> {
		const host = resolveEpubHost(this.app);
		if (!host?.openCardBacklinkFromEpub) {
			return { success: false, error: "card_host_unavailable" };
		}
		await host.openCardBacklinkFromEpub(intent.resourcePath);
		return { success: true };
	}
}
