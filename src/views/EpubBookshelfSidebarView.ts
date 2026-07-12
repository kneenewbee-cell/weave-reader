import { type EventRef, ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { EPUB_RUNTIME } from "../services/epub";
import { resolveRecentEpubPath } from "../utils/epub-leaf-utils";
import { i18n, syncI18nLanguage } from "../utils/i18n";
import { logger } from "../utils/logger";
import { getViewSurfaceTokens } from "../utils/view-location-utils";
import type { EpubViewHost } from "./epub-view-host";
import { VIEW_TYPE_EPUB_SIDEBAR } from "./EpubSidebarView";

export const VIEW_TYPE_EPUB_BOOKSHELF_SIDEBAR = EPUB_RUNTIME.viewTypes.bookshelfSidebar;

export class EpubBookshelfSidebarView extends ItemView {
	private component: object | null = null;
	private plugin: EpubViewHost;
	private layoutChangeRef: EventRef | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: EpubViewHost) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_EPUB_BOOKSHELF_SIDEBAR;
	}

	getDisplayText(): string {
		return i18n.t("views.epubBookshelfSidebar.title");
	}

	getIcon(): string {
		return "library";
	}

	async onOpen(): Promise<void> {
		syncI18nLanguage();
		this.contentEl.empty();
		this.contentEl.addClass("weave-epub-sidebar-view", "weave-epub-bookshelf-sidebar-view");
		this.applySurfaceContext();
		this.layoutChangeRef = this.app.workspace.on("layout-change", () => {
			this.applySurfaceContext();
		});

		try {
			const { mount } = await import("svelte");
			const { default: BookshelfView } = await import("../components/epub/BookshelfView.svelte");

			this.component = mount(BookshelfView, {
				target: this.contentEl,
				props: {
					app: this.app,
					onClose: () => this.closeBookshelf(),
					onBack: () => this.returnToRecentBookDirectory(),
					onSwitchBook: async (filePath: string) => {
						if (typeof this.plugin.openEpubReader === "function") {
							await this.plugin.openEpubReader(filePath);
						}
					},
				},
			});

			logger.debug("[EpubBookshelfSidebarView] Bookshelf component mounted");
		} catch (error) {
			logger.error("[EpubBookshelfSidebarView] Failed to mount bookshelf:", error);
			this.contentEl.empty();
			this.contentEl.createDiv({
				cls: "epub-error",
				text: i18n.t("views.epubBookshelfSidebar.loadFailed"),
			});
		}
	}

	private async closeBookshelf(): Promise<void> {
		await this.leaf.setViewState({
			type: VIEW_TYPE_EPUB_SIDEBAR,
			active: true,
		});
		void this.app.workspace.revealLeaf(this.leaf);
	}

	private async returnToRecentBookDirectory(): Promise<void> {
		try {
			const recentPath = await resolveRecentEpubPath(this.app);
			await this.closeBookshelf();

			if (!recentPath) {
				new Notice(i18n.t("views.epubView.notice.noRecentBook"));
				return;
			}

			if (typeof this.plugin.openEpubReader === "function") {
				await this.plugin.openEpubReader(recentPath);
			}
		} catch (error) {
			logger.error("[EpubBookshelfSidebarView] Failed to return to EPUB sidebar:", error);
			new Notice(i18n.t("views.epubBookshelfSidebar.returnToRecentBookFailed"));
		}
	}

	private applySurfaceContext(): void {
		const surfaceTokens = getViewSurfaceTokens(this.leaf);
		const targets = [this.contentEl, this.contentEl.parentElement].filter(Boolean) as HTMLElement[];

		for (const target of targets) {
			target.dataset.weaveSurfaceContext = surfaceTokens.context;
			target.style.setProperty("--weave-surface-background", surfaceTokens.surfaceBackground);
			target.style.setProperty("--weave-elevated-background", surfaceTokens.elevatedBackground);
		}
	}

	async onClose(): Promise<void> {
		if (this.layoutChangeRef) {
			this.app.workspace.offref(this.layoutChangeRef);
			this.layoutChangeRef = null;
		}

		if (this.component) {
			const { unmount } = await import("svelte");
			try {
				void unmount(this.component);
			} catch {
				/* ignore */
			}
			this.component = null;
		}
	}
}
