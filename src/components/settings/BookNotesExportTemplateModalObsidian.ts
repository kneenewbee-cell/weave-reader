import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type StandaloneEpubPlugin from "../../main";
import BookNotesExportTemplateModal from "./BookNotesExportTemplateModal.svelte";

export interface BookNotesExportTemplateModalObsidianOptions {
	plugin: StandaloneEpubPlugin;
	onClose?: () => void;
}

type CloseGuard = () => boolean | Promise<boolean>;

export class BookNotesExportTemplateModalObsidian extends Modal {
	private component: Parameters<typeof unmount>[0] | null = null;
	private readonly options: BookNotesExportTemplateModalObsidianOptions;
	private closeGuard: CloseGuard | null = null;

	constructor(app: App, options: BookNotesExportTemplateModalObsidianOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.modalEl.addClass("weave-epub-export-template-modal");
		this.contentEl.addClass("weave-epub-export-template-modal-content");

		this.component = mount(BookNotesExportTemplateModal, {
			target: this.contentEl,
			props: {
				plugin: this.options.plugin,
				onClose: () => this.close(),
				registerCloseGuard: (guard: CloseGuard) => {
					this.closeGuard = guard;
				},
			},
		});
	}

	close(): void {
		void this.confirmAndClose();
	}

	private async confirmAndClose(): Promise<void> {
		if (this.closeGuard) {
			const allowed = await this.closeGuard();
			if (!allowed) {
				return;
			}
		}
		super.close();
	}

	onClose(): void {
		if (this.component) {
			void unmount(this.component);
			this.component = null;
		}

		this.contentEl.empty();
		this.closeGuard = null;
		this.options.onClose?.();
	}
}
