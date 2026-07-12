import { ButtonComponent, Modal, setIcon } from "obsidian";
import type { App } from "obsidian";
import type {
	EpubBookshelfMembershipEntry,
	EpubScanIndexEntry,
} from "../../services/epub/EpubStorageService";
import { getBookExtensionFromPath } from "../../services/epub/book-format";
import { isPathAlreadyOnBookshelfForApp } from "../../services/epub/epub-vault-path";
import { i18n } from "../../utils/i18n";

type ImportStatusFilter = "pending" | "added";

interface EpubBookshelfImportModalOptions {
	entries: EpubScanIndexEntry[];
	membership: EpubBookshelfMembershipEntry[];
	onConfirm: (paths: string[]) => Promise<void> | void;
	title?: string;
}

export class EpubBookshelfImportModal extends Modal {
	private readonly entries: EpubScanIndexEntry[];
	private readonly membershipPaths: string[];
	private readonly onConfirm: (paths: string[]) => Promise<void> | void;
	private readonly title: string;
	private query = "";
	private statusFilter: ImportStatusFilter = "pending";
	private readonly selectedPaths = new Set<string>();
	private listContainer: HTMLElement | null = null;
	private summaryEl: HTMLElement | null = null;
	private confirmButton: ButtonComponent | null = null;
	private searchInputEl: HTMLInputElement | null = null;
	private filterPendingButton: HTMLButtonElement | null = null;
	private filterAddedButton: HTMLButtonElement | null = null;

	constructor(app: App, options: EpubBookshelfImportModalOptions) {
		super(app);
		this.entries = [...options.entries].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
		this.membershipPaths = options.membership.map((entry) => entry.path);
		this.onConfirm = options.onConfirm;
		this.title = options.title ?? i18n.t("epub.bookshelf.vaultScanTitle");
	}

	override onOpen(): void {
		this.modalEl.addClass("weave-epub-import-modal");
		this.titleEl.setText(this.title);
		this.render();
		window.setTimeout(() => this.searchInputEl?.focus(), 0);
	}

	override onClose(): void {
		this.contentEl.empty();
		this.listContainer = null;
		this.summaryEl = null;
		this.confirmButton = null;
		this.searchInputEl = null;
		this.filterPendingButton = null;
		this.filterAddedButton = null;
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("weave-epub-import-shell");

		const toolbar = contentEl.createDiv({ cls: "weave-epub-import-toolbar" });
		const toolbarRow = toolbar.createDiv({ cls: "weave-epub-import-toolbar-row" });
		const searchWrap = toolbarRow.createDiv({ cls: "weave-epub-import-search" });
		const searchIcon = searchWrap.createSpan({ cls: "weave-epub-import-search-icon" });
		setIcon(searchIcon, "search");

		this.searchInputEl = searchWrap.createEl("input", {
			type: "text",
			placeholder: i18n.t("epub.bookshelf.importModal.searchPlaceholder"),
			cls: "weave-epub-import-search-input",
		});
		this.searchInputEl.value = this.query;
		this.searchInputEl.addEventListener("input", () => {
			this.query = this.searchInputEl?.value.trim().toLowerCase() ?? "";
			this.renderList();
		});

		const filterGroup = toolbarRow.createDiv({ cls: "weave-epub-import-filter-group" });

		this.filterPendingButton = filterGroup.createEl("button", {
			type: "button",
			cls: "weave-epub-import-filter-btn",
		});
		const pendingIcon = this.filterPendingButton.createSpan({
			cls: "weave-epub-import-filter-btn-icon",
		});
		setIcon(pendingIcon, "inbox");
		this.filterPendingButton.setAttr("aria-label", i18n.t("epub.bookshelf.importModal.filterPending"));
		this.filterPendingButton.setAttr("title", i18n.t("epub.bookshelf.importModal.filterPending"));
		this.filterPendingButton.addEventListener("click", () => this.setStatusFilter("pending"));

		this.filterAddedButton = filterGroup.createEl("button", {
			type: "button",
			cls: "weave-epub-import-filter-btn",
		});
		const addedIcon = this.filterAddedButton.createSpan({
			cls: "weave-epub-import-filter-btn-icon",
		});
		setIcon(addedIcon, "check-circle");
		this.filterAddedButton.setAttr("aria-label", i18n.t("epub.bookshelf.importModal.filterAdded"));
		this.filterAddedButton.setAttr("title", i18n.t("epub.bookshelf.importModal.filterAdded"));
		this.filterAddedButton.addEventListener("click", () => this.setStatusFilter("added"));
		this.updateFilterButtons();

		this.summaryEl = contentEl.createDiv({ cls: "weave-epub-import-summary" });
		this.listContainer = contentEl.createDiv({ cls: "weave-epub-import-list" });
		this.renderList();

		const actionRow = contentEl.createDiv({ cls: "weave-epub-import-actions" });
		new ButtonComponent(actionRow)
			.setButtonText(i18n.t("epub.bookshelf.importModal.cancel"))
			.onClick(() => this.close());
		this.confirmButton = new ButtonComponent(actionRow)
			.setCta()
			.setButtonText(i18n.t("epub.bookshelf.importModal.confirm"))
			.onClick(async () => {
				const paths = Array.from(this.selectedPaths);
				if (paths.length === 0) {
					return;
				}
				await this.onConfirm(paths);
				this.close();
			});
		this.updateConfirmButton();
	}

	private setStatusFilter(filter: ImportStatusFilter): void {
		if (this.statusFilter === filter) {
			return;
		}
		this.statusFilter = filter;
		this.updateFilterButtons();
		this.renderList();
	}

	private updateFilterButtons(): void {
		const pendingActive = this.statusFilter === "pending";
		this.filterPendingButton?.toggleClass("is-active", pendingActive);
		this.filterAddedButton?.toggleClass("is-active", !pendingActive);
	}

	private isEntryAdded(entry: EpubScanIndexEntry): boolean {
		return isPathAlreadyOnBookshelfForApp(this.app, entry.path, this.membershipPaths);
	}

	private getPendingCount(): number {
		return this.entries.filter((entry) => !this.isEntryAdded(entry)).length;
	}

	private getAddedCount(): number {
		return this.entries.filter((entry) => this.isEntryAdded(entry)).length;
	}

	private getVisibleEntries(): EpubScanIndexEntry[] {
		return this.entries.filter((entry) => {
			const alreadyAdded = this.isEntryAdded(entry);
			if (this.statusFilter === "pending" ? alreadyAdded : !alreadyAdded) {
				return false;
			}
			if (!this.query) {
				return true;
			}
			const haystack = `${entry.name} ${entry.path}`.toLowerCase();
			return haystack.includes(this.query);
		});
	}

	private updateConfirmButton(): void {
		if (!this.confirmButton) {
			return;
		}
		const count = this.selectedPaths.size;
		this.confirmButton
			.setButtonText(
				count > 0
					? i18n.t("epub.bookshelf.importModal.confirmWithCount", { count })
					: i18n.t("epub.bookshelf.importModal.confirm")
			)
			.setDisabled(count === 0);
	}

	private renderList(): void {
		if (!this.listContainer || !this.summaryEl) {
			return;
		}

		const visibleEntries = this.getVisibleEntries();
		const pendingCount = this.getPendingCount();
		const addedCount = this.getAddedCount();
		this.summaryEl.setText(
			i18n.t("epub.bookshelf.importModal.summary", {
				total: this.entries.length,
				pending: pendingCount,
				added: addedCount,
				visible: visibleEntries.length,
				selected: this.selectedPaths.size,
			})
		);
		this.updateConfirmButton();

		this.listContainer.empty();
		if (visibleEntries.length === 0) {
			this.listContainer.createDiv({
				cls: "weave-epub-import-empty",
				text: this.getEmptyMessage(),
			});
			return;
		}

		for (const entry of visibleEntries) {
			const alreadyAdded = this.isEntryAdded(entry);
			const row = this.listContainer.createDiv({
				cls: `weave-epub-import-item ${alreadyAdded ? "is-added" : ""}`,
			});

			const toggle = () => {
				if (alreadyAdded) {
					return;
				}
				if (this.selectedPaths.has(entry.path)) {
					this.selectedPaths.delete(entry.path);
				} else {
					this.selectedPaths.add(entry.path);
				}
				this.renderList();
			};

			const selector = row.createDiv({ cls: "weave-epub-import-selector" });
			if (alreadyAdded) {
				const badge = selector.createDiv({ cls: "weave-epub-import-added-icon" });
				setIcon(badge, "check");
			} else {
				const checkbox = selector.createEl("input", {
					type: "checkbox",
					cls: "weave-epub-import-checkbox",
				});
				checkbox.checked = this.selectedPaths.has(entry.path);
				checkbox.addEventListener("click", (event) => event.stopPropagation());
				checkbox.addEventListener("change", () => toggle());
			}

			const body = row.createDiv({ cls: "weave-epub-import-body" });
			const titleLine = body.createDiv({ cls: "weave-epub-import-title-line" });
			titleLine.createSpan({
				cls: "weave-epub-import-name",
				text: this.getEntryDisplayName(entry),
			});
			titleLine.createSpan({
				cls: `weave-epub-import-status ${alreadyAdded ? "is-added" : "is-pending"}`,
				text: alreadyAdded
					? i18n.t("epub.bookshelf.importModal.statusAdded")
					: i18n.t("epub.bookshelf.importModal.statusPending"),
			});

			if (!alreadyAdded) {
				row.addEventListener("click", toggle);
			}
		}
	}

	private getEmptyMessage(): string {
		if (this.query) {
			return i18n.t("epub.bookshelf.importModal.emptySearch");
		}
		return this.statusFilter === "pending"
			? i18n.t("epub.bookshelf.importModal.emptyPending")
			: i18n.t("epub.bookshelf.importModal.emptyAdded");
	}

	private getEntryDisplayName(entry: EpubScanIndexEntry): string {
		const baseName =
			entry.name?.trim() || entry.path.split("/").pop() || entry.path;
		const extension = getBookExtensionFromPath(entry.path);
		if (!extension) {
			return baseName;
		}
		const suffix = `.${extension.toLowerCase()}`;
		if (baseName.toLowerCase().endsWith(suffix)) {
			return baseName;
		}
		return `${baseName}${suffix}`;
	}
}
