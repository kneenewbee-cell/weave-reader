import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type StandaloneEpubPlugin from "../../main";
import { i18n } from "../../utils/i18n";
import EpubDataManagementModal from "./EpubDataManagementModal.svelte";

export interface EpubDataManagementModalObsidianOptions {
	plugin: StandaloneEpubPlugin;
	onClose?: () => void;
}

export class EpubDataManagementModalObsidian extends Modal {
	private component: Parameters<typeof unmount>[0] | null = null;
	private readonly options: EpubDataManagementModalObsidianOptions;

	constructor(app: App, options: EpubDataManagementModalObsidianOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		this.setTitle(i18n.t("epub.dataManagement.title"));
		this.modalEl.addClass("weave-epub-data-management-modal");
		this.contentEl.addClass("weave-epub-data-management-modal-content");

		this.component = mount(EpubDataManagementModal, {
			target: this.contentEl,
			props: {
				plugin: this.options.plugin,
				onClose: () => this.close(),
			},
		});
	}

	onClose() {
		if (this.component) {
			void unmount(this.component);
			this.component = null;
		}

		this.contentEl.empty();
		this.options.onClose?.();
	}
}
