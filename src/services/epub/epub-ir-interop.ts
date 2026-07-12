import type { App } from "obsidian";
import { FoliateVaultPublicationParser } from "./FoliateVaultPublicationParser";
import { EpubLinkService } from "./EpubLinkService";
import type { TocItem } from "./types";

/**
 * 供 standalone IR 导入流程读取书籍目录。
 * 契约：在插件实例上暴露同名方法 `loadPublicationTocItems`。
 */
export async function loadPublicationTocItems(app: App, filePath: string): Promise<TocItem[]> {
	const parser = new FoliateVaultPublicationParser(app);
	try {
		const loaded = await parser.load(filePath, { tocOnly: true });
		return loaded.tocItems;
	} finally {
		parser.dispose();
	}
}

export interface NavigateToPublicationChapterOptions {
	sourceId?: string;
	sourceMarkdownPath?: string;
}

/**
 * 供 IR 等协作者跳转到书籍目录章节（无 CFI 时）。
 * 契约：插件实例方法 `navigateToPublicationChapter`。
 */
export async function navigateToPublicationChapter(
	app: App,
	filePath: string,
	tocHref: string,
	options: NavigateToPublicationChapterOptions = {}
): Promise<void> {
	const linkService = new EpubLinkService(app);
	await linkService.navigateToEpubChapter(filePath, tocHref, options);
}

export function buildPublicationChapterMarkdownLink(
	app: App,
	filePath: string,
	tocHref: string,
	chapterTitle?: string,
	sourceId?: string,
	chapterIndex?: number
): string {
	const linkService = new EpubLinkService(app);
	return linkService.buildProtocolMarkdownLinkForChapter(
		filePath,
		tocHref,
		chapterTitle,
		sourceId,
		chapterIndex
	);
}
