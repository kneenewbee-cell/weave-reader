import { Notice, Plugin, TFile, normalizePath, type App, type WorkspaceLeaf } from "obsidian";
import type { EpubViewHost } from "../../views/epub-view-host";
import { readMapLikeRegistryValue, type AppWithViewRegistry } from "../../types/obsidian-extensions";
import { getNavigationHub } from "../navigation/navigation-hub-access";
import { logger } from "../../utils/logger";
import {
	EpubBookshelfSidebarView,
	VIEW_TYPE_EPUB_BOOKSHELF_SIDEBAR,
} from "../../views/EpubBookshelfSidebarView";
import {
	EpubAiReadingNoteView,
	VIEW_TYPE_EPUB_AI_READING_NOTE,
} from "../../views/EpubAiReadingNoteView";
import { EpubSidebarView, VIEW_TYPE_EPUB_SIDEBAR } from "../../views/EpubSidebarView";
import { EpubView, VIEW_TYPE_EPUB } from "../../views/EpubView";
import { PdfView, VIEW_TYPE_PDF } from "../../views/PdfView";
import { createEpubLinkPostProcessor } from "./EpubLinkPostProcessor";
import { EpubLinkService } from "./EpubLinkService";
import { isPdfBookFormat, isSupportedBookFile, SUPPORTED_BOOK_EXTENSIONS } from "./book-format";
import { EPUB_RUNTIME } from "./epub-runtime";
import { ensureEpubFileAccess } from "./epub-premium";
import { findOpenEpubLeaf } from "../../utils/epub-leaf-utils";
import {
	markEpubDualWindowPaneRoles,
	registerEpubDualWindowSession,
} from "./epub-dual-window-workspace";

type EpubPluginHost = EpubViewHost & Plugin;

function findOpenAiReadingNoteLeaf(app: App, notePath: string): WorkspaceLeaf | null {
	const targetPath = normalizePath(String(notePath || "").trim());
	if (!targetPath) {
		return null;
	}
	for (const leaf of app.workspace.getLeavesOfType(VIEW_TYPE_EPUB_AI_READING_NOTE)) {
		try {
			const state = leaf.getViewState?.()?.state as Record<string, unknown> | undefined;
			if (normalizePath(String(state?.notePath || "").trim()) === targetPath) {
				return leaf;
			}
		} catch {
			continue;
		}
	}
	return null;
}

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
	host.registerView(VIEW_TYPE_EPUB_AI_READING_NOTE, (leaf) => new EpubAiReadingNoteView(leaf));
	host.registerView(VIEW_TYPE_PDF, (leaf) => new PdfView(leaf));
	host.registerView(
		VIEW_TYPE_EPUB_BOOKSHELF_SIDEBAR,
		(leaf) => new EpubBookshelfSidebarView(leaf, host)
	);
	host.registerView(VIEW_TYPE_EPUB_SIDEBAR, (leaf) => new EpubSidebarView(leaf, host));
	const pdfBookExtensions = SUPPORTED_BOOK_EXTENSIONS.filter((extension) =>
		isPdfBookFormat(extension)
	);
	const foliateBookExtensions = SUPPORTED_BOOK_EXTENSIONS.filter(
		(extension) => !isPdfBookFormat(extension)
	);
	registerExtensionsSafely(
		host,
		host.app,
		[...foliateBookExtensions],
		VIEW_TYPE_EPUB,
		logPrefix,
		ownerName
	);
	registerExtensionsSafely(
		host,
		host.app,
		[...pdfBookExtensions],
		VIEW_TYPE_PDF,
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

		await linkService.navigateToEpubLocation(
			parsed.filePath,
			parsed.cfi,
			parsed.text,
			parsed.sourceId
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

export async function openEpubAiReadingNote(
	app: App,
	noteFile: TFile,
	options: {
		bookId?: string;
		sourceFile?: string;
		dualWindowMode?: boolean;
		openMode?: "existing" | "right-split";
		focus?: boolean;
	} = {},
): Promise<WorkspaceLeaf | null> {
	const { openMode = "existing", focus = true } = options;
	const notePath = String(noteFile.path || "").trim();
	const sourceFile = String(options.sourceFile || "").trim();
	const isDualWindowMode =
		options.dualWindowMode === true && openMode === "right-split" && Boolean(sourceFile);
	const existingLeaf =
		openMode === "existing"
			? app.workspace.getLeavesOfType(VIEW_TYPE_EPUB_AI_READING_NOTE).find((leaf) => {
					const state = leaf.getViewState?.()?.state as
						| { notePath?: unknown }
						| undefined;
					return String(state?.notePath || "").trim() === notePath;
				}) ?? null
			: null;
	const previousDualModeSourceLeaf =
		isDualWindowMode ? findOpenAiReadingNoteLeaf(app, notePath) : null;
	const leaf =
		existingLeaf ||
		(openMode === "right-split"
			? app.workspace.getLeaf("split", "vertical")
			: app.workspace.getLeaf(false));
	if (!leaf) {
		return null;
	}

	await leaf.setViewState({
		type: VIEW_TYPE_EPUB_AI_READING_NOTE,
		active: focus,
		state: {
			...(options.bookId ? { bookId: String(options.bookId).trim() } : {}),
			notePath,
			sourceFile,
			...(isDualWindowMode ? { dualWindowMode: true } : {}),
		},
	});
	if (isDualWindowMode) {
		const readerLeaf = findOpenEpubLeaf(app, sourceFile);
		registerEpubDualWindowSession(app, {
			mode: "book-ai-reading-note",
			bookId: String(options.bookId || sourceFile).trim(),
			filePath: sourceFile,
			notePath,
		});
		markEpubDualWindowPaneRoles(readerLeaf, leaf);
		if (
			previousDualModeSourceLeaf &&
			previousDualModeSourceLeaf !== leaf &&
			previousDualModeSourceLeaf !== readerLeaf
		) {
			await previousDualModeSourceLeaf.detach();
		}
		if (readerLeaf) {
			void app.workspace.revealLeaf(readerLeaf);
		}
	}
	if (focus) {
		void app.workspace.revealLeaf(leaf);
	}
	return leaf;
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
