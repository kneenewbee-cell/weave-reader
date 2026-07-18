import { App, Modal, Notice, setIcon } from "obsidian";
import {
	listEpubAnnotationVersions,
	type EpubAnnotationVersionSummary,
} from "../../services/epub";
import {
	isCompleteEpubAnnotationCompareSelection,
	resolveDefaultEpubAnnotationCompareSelection,
	selectEpubAnnotationCompareVersionSlot,
	type EpubAnnotationCompareVersionSelection,
	type EpubAnnotationCompareVersionSlot,
} from "./epub-annotation-compare-version-selection";

export interface EpubAnnotationCompareVersionSelectModalOptions {
	bookId: string;
	bookTitle?: string;
	onConfirm: (selection: EpubAnnotationCompareVersionSelection) => void | Promise<void>;
}

const TEXT = {
	title: "\u9009\u62e9\u5bf9\u6bd4\u7684\u6807\u6ce8\u7248\u672c",
	intro: "\u4e3b\u9875\u6253\u5f00\u53ef\u7f16\u8f91\u7a97\u53e3\uff0c\u526f\u9875\u6253\u5f00\u53ea\u8bfb\u5bf9\u6bd4\u7a97\u53e3\u3002",
	slotEditable: "\u4e3b\u9875\u53ef\u7f16\u8f91",
	slotReadonly: "\u526f\u9875\u53ea\u8bfb",
	activeSuffix: "\uff08\u5f53\u524d\uff09",
	openCompare: "\u6253\u5f00\u5bf9\u6bd4",
	cancel: "\u53d6\u6d88",
	notEnoughVersions: "\u81f3\u5c11\u9700\u8981\u4e24\u4e2a\u6807\u6ce8\u7248\u672c\u624d\u80fd\u5bf9\u6bd4",
	selectionIncomplete: "\u8bf7\u9009\u62e9\u4e24\u4e2a\u4e0d\u540c\u7684\u6807\u6ce8\u7248\u672c",
	loadFailed: "\u6807\u6ce8\u7248\u672c\u5217\u8868\u52a0\u8f7d\u5931\u8d25",
};

function formatDateTime(value: number): string {
	if (!value) {
		return "\u672a\u8bb0\u5f55";
	}
	try {
		return new Date(value).toLocaleString();
	} catch {
		return String(value);
	}
}

function slotName(slot: EpubAnnotationCompareVersionSlot): string {
	return slot === "editable" ? TEXT.slotEditable : TEXT.slotReadonly;
}

export class EpubAnnotationCompareVersionSelectModal extends Modal {
	private readonly options: EpubAnnotationCompareVersionSelectModalOptions;
	private versions: EpubAnnotationVersionSummary[] = [];
	private selection: EpubAnnotationCompareVersionSelection = {
		editableVersionId: "",
		readonlyVersionId: "",
	};
	private confirmButton: HTMLButtonElement | null = null;

	constructor(app: App, options: EpubAnnotationCompareVersionSelectModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.modalEl.addClass("weave-annotation-compare-modal");
		void this.loadAndRender();
	}

	private async loadAndRender(): Promise<void> {
		this.setTitle(TEXT.title);
		this.contentEl.empty();
		try {
			this.versions = await listEpubAnnotationVersions(this.app, this.options.bookId);
			this.selection = resolveDefaultEpubAnnotationCompareSelection(this.versions);
			this.render();
		} catch (error) {
			console.warn("[WeaveReader] Failed to load annotation compare versions:", error);
			this.contentEl.createEl("p", { text: TEXT.loadFailed });
		}
	}

	private render(): void {
		this.contentEl.empty();
		const root = this.contentEl.createDiv({ cls: "weave-annotation-compare-select" });
		root.createEl("p", {
			cls: "weave-annotation-compare-select__intro",
			text: this.options.bookTitle ? `${this.options.bookTitle}\n${TEXT.intro}` : TEXT.intro,
		});

		const header = root.createDiv({ cls: "weave-annotation-compare-select__header" });
		header.createSpan();
		header.createSpan({ text: TEXT.slotEditable });
		header.createSpan({ text: TEXT.slotReadonly });

		const list = root.createDiv({ cls: "weave-annotation-compare-select__list" });
		for (const version of this.versions) {
			this.renderVersionRow(list, version);
		}
		if (this.versions.length < 2) {
			list.createDiv({
				cls: "weave-annotation-compare-select__empty",
				text: TEXT.notEnoughVersions,
			});
		}

		const footer = root.createDiv({ cls: "weave-annotation-compare-select__footer" });
		const cancelButton = footer.createEl("button", {
			cls: "mod-muted",
			attr: { type: "button" },
			text: TEXT.cancel,
		});
		cancelButton.addEventListener("click", () => this.close());

		this.confirmButton = footer.createEl("button", {
			cls: "mod-cta",
			attr: { type: "button" },
			text: TEXT.openCompare,
		});
		this.confirmButton.addEventListener("click", () => {
			void this.confirm();
		});
		this.refreshConfirmButton();
	}

	private renderVersionRow(parent: HTMLElement, version: EpubAnnotationVersionSummary): void {
		const row = parent.createDiv({
			cls: `weave-annotation-compare-select__row${version.active ? " is-active" : ""}`,
		});
		const main = row.createDiv({ cls: "weave-annotation-compare-select__main" });
		main.createDiv({
			cls: "weave-annotation-compare-select__title",
			text: `${version.name}${version.active ? TEXT.activeSuffix : ""}`,
		});
		main.createDiv({
			cls: "weave-annotation-compare-select__meta",
			text: `${version.annotationCount} \u6761\u6807\u6ce8 · ${formatDateTime(version.updatedAt)}`,
		});
		this.appendSlotRadio(row, version, "editable");
		this.appendSlotRadio(row, version, "readonly");
	}

	private appendSlotRadio(
		parent: HTMLElement,
		version: EpubAnnotationVersionSummary,
		slot: EpubAnnotationCompareVersionSlot
	): void {
		const label = parent.createEl("label", {
			cls: "weave-annotation-compare-select__slot",
			attr: { title: slotName(slot) },
		});
		const input = label.createEl("input", {
			attr: {
				type: "radio",
				name: `weave-annotation-compare-${slot}`,
				value: version.versionId,
			},
		});
		input.checked = slot === "editable"
			? this.selection.editableVersionId === version.versionId
			: this.selection.readonlyVersionId === version.versionId;
		const icon = label.createSpan({ cls: "weave-annotation-compare-select__slot-icon" });
		setIcon(icon, slot === "editable" ? "circle-dot" : "circle");
		input.addEventListener("change", () => {
			this.selection = selectEpubAnnotationCompareVersionSlot(
				this.versions,
				this.selection,
				slot,
				version.versionId
			);
			this.render();
		});
	}

	private refreshConfirmButton(): void {
		if (!this.confirmButton) {
			return;
		}
		this.confirmButton.disabled = !isCompleteEpubAnnotationCompareSelection(this.selection);
	}

	private async confirm(): Promise<void> {
		if (!isCompleteEpubAnnotationCompareSelection(this.selection)) {
			new Notice(TEXT.selectionIncomplete);
			return;
		}
		await this.options.onConfirm(this.selection);
		this.close();
	}
}
