import { Notice, Plugin, TFile, type App, type WorkspaceLeaf } from "obsidian";
import type { EpubViewHost } from "../../views/epub-view-host";
import { readMapLikeRegistryValue, type AppWithViewRegistry } from "../../types/obsidian-extensions";
import { getNavigationHub } from "../navigation/navigation-hub-access";
import { logger } from "../../utils/logger";
import {
	EpubBookshelfSidebarView,
	VIEW_TYPE_EPUB_BOOKSHELF_SIDEBAR,
} from "../../views/EpubBookshelfSidebarView";
import { EpubSidebarView, VIEW_TYPE_EPUB_SIDEBAR } from "../../views/EpubSidebarView";
import { EpubView, VIEW_TYPE_EPUB } from "../../views/EpubView";
import { createEpubLinkPostProcessor } from "./EpubLinkPostProcessor";
import { EpubLinkService } from "./EpubLinkService";
import { isSupportedBookFile, SUPPORTED_BOOK_EXTENSIONS } from "./book-format";
import { EPUB_RUNTIME } from "./epub-runtime";
import { ensureEpubFileAccess } from "./epub-premium";

type EpubPluginHost = EpubViewHost & Plugin;

export function getRegisteredViewTypeForExtension(app: App, extension: string): string | null {
	const normalizedExtension = extension.trim().toLowerCase();
	if (!normalizedExtension) {
		return null;
	}

	const typeByExtension = (app as App & AppWithViewRegistry).viewRegistry?.typeByExtension;
	const mapped = readMapLikeRegistryValue(typeByExtension, normalizedExtension);
	return typeof mapped === "string" ? mapped : null;
}

export function registerExtensionsSafely(
	plugin: Plugin,
	app: App,
	extensions: string[],
	viewType: string,
	logPrefix: string,
	ownerName: string
): void {
	for (const extension of extensions) {
		const normalizedExtension = extension.trim().toLowerCase();
		if (!normalizedExtension) {
			continue;
		}

		const existingViewType = getRegisteredViewTypeForExtension(app, normalizedExtension);
		if (existingViewType === viewType) {
			logger.info(`${logPrefix} 扩展 .${normalizedExtension} 已绑定到 ${viewType}，跳过重复注册`);
			continue;
		}

		if (existingViewType && existingViewType !== viewType) {
			logger.warn(
				`${logPrefix} 扩展 .${normalizedExtension} 已绑定到 ${existingViewType}，${ownerName}将继续启动但不接管该扩展`
			);
			continue;
		}

		try {
			plugin.registerExtensions([normalizedExtension], viewType);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/Attempting to register an existing file extension/i.test(message)) {
				const reboundViewType =
					getRegisteredViewTypeForExtension(app, normalizedExtension) ?? "unknown";
				logger.warn(
					`${logPrefix} 扩展 .${normalizedExtension} 注册时检测到宿主冲突（当前绑定: ${reboundViewType}），${ownerName}将继续启动`
				);
				continue;
			}

			throw error;
		}
	}
}

export function registerEpubWorkspaceViews(
	host: EpubPluginHost,
	logPrefix: string,
	ownerName: string
): void {
	host.registerView(VIEW_TYPE_EPUB, (leaf) => new EpubView(leaf, host));
	host.registerView(
		VIEW_TYPE_EPUB_BOOKSHELF_SIDEBAR,
		(leaf) => new EpubBookshelfSidebarView(leaf, host)
	);
	host.registerView(VIEW_TYPE_EPUB_SIDEBAR, (leaf) => new EpubSidebarView(leaf, host));
	registerExtensionsSafely(
		host,
		host.app,
		[...SUPPORTED_BOOK_EXTENSIONS],
		VIEW_TYPE_EPUB,
		logPrefix,
		ownerName
	);
}

export function registerEpubProtocolHandler(plugin: Plugin, app: App, logPrefix: string): void {
	plugin.registerObsidianProtocolHandler(EPUB_RUNTIME.protocol.primaryName, async (params) => {
		const parsed = EpubLinkService.parseProtocolParams(params);
		if (!parsed) {
			logger.warn(`${logPrefix} Invalid params:`, params);
			return;
		}

		const linkService = new EpubLinkService(app);
		if (parsed.tocHref && !parsed.cfi) {
			await linkService.navigateToEpubChapter(parsed.filePath, parsed.tocHref, {
				sourceId: parsed.sourceId,
			});
			return;
		}

		if (!parsed.cfi) {
			await linkService.navigateToEpubBook(parsed.filePath, parsed.sourceId);
			return;
		}

		await linkService.navigateToEpubLocation(
			parsed.filePath,
			parsed.cfi,
			parsed.text,
			parsed.sourceId,
			undefined,
			{
				flashStyle: parsed.flashStyle,
				flashColor: parsed.flashColor,
				showLocateOverlay: parsed.showLocateOverlay,
			}
		);
	});
}

export function registerEpubMarkdownPostProcessor(plugin: Plugin, app: App): void {
	plugin.registerMarkdownPostProcessor(createEpubLinkPostProcessor(app));
}

export async function openEpubBookshelf(
	app: App,
	logPrefix: string,
	failureNotice: string
): Promise<void> {
	try {
		const workspace = app.workspace;
		let leaf: WorkspaceLeaf | null =
			workspace.getLeavesOfType(VIEW_TYPE_EPUB_BOOKSHELF_SIDEBAR)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getLeftLeaf(false);
		}
		if (!leaf) {
			logger.error(`${logPrefix} openEpubBookshelf: cannot create leaf`);
			return;
		}

		await leaf.setViewState({
			type: VIEW_TYPE_EPUB_BOOKSHELF_SIDEBAR,
			active: true,
		});
		void workspace.revealLeaf(leaf);
	} catch (error) {
		logger.error(`${logPrefix} openEpubBookshelf failed:`, error);
		new Notice(failureNotice);
	}
}

export async function openEpubReader(
	app: App,
	filePath: string,
	logPrefix: string,
	missingFileNotice: string,
	failureNotice: string
): Promise<void> {
	try {
		const targetFile = app.vault.getAbstractFileByPath(String(filePath || "").trim());
		if (!(targetFile instanceof TFile) || !isSupportedBookFile(targetFile)) {
			new Notice(missingFileNotice);
			return;
		}
		if (!ensureEpubFileAccess(app, targetFile.path)) {
			return;
		}

		const result = await getNavigationHub(app).navigate({
			kind: "book",
			resourcePath: targetFile.path,
			policy: { preferredLeaf: true, focus: true },
		});
		if (!result.success || !result.leaf) {
			logger.error(`${logPrefix} openEpubReader: cannot create leaf`);
			return;
		}
	} catch (error) {
		logger.error(`${logPrefix} openEpubReader failed:`, error);
		new Notice(failureNotice);
	}
}
