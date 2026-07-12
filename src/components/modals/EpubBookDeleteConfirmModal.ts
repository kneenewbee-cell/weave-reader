import { Modal, type App, setIcon } from "obsidian";
import { getBookFormatDisplayLabel } from "../../services/epub/book-format";
import type { BookMetadata } from "../../services/epub";
import { i18n } from "../../utils/i18n";

type EpubBookDeleteHighlightStats = {
	totalHighlights: number;
	commentCount: number;
	sourceFileCount: number;
	available: boolean;
};

type EpubBookDeleteConfirmModalOptions = {
	filePath: string;
	fileName: string;
	fileSize: number;
	metadata: BookMetadata;
	progress: number;
	highlightStats: EpubBookDeleteHighlightStats;
};

function formatFileSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "";
	}
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	if (bytes < 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function normalizeProgress(progress: number): number {
	if (!Number.isFinite(progress)) {
		return 0;
	}
	return Math.max(0, Math.min(100, Math.round(progress)));
}

function normalizeText(value: string | undefined): string {
	return String(value || "").trim();
}

export class EpubBookDeleteConfirmModal extends Modal {
	private readonly options: EpubBookDeleteConfirmModalOptions;
	private confirmed = false;
	private resolver: ((value: boolean) => void) | null = null;

	constructor(app: App, options: EpubBookDeleteConfirmModalOptions) {
		super(app);
		this.options = options;
	}

	openAndWait(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolver = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.modalEl.addClass("weave-epub-book-delete-modal");
		this.titleEl.setText(i18n.t("epub.bookshelf.bookDeleteModal.title"));
		this.contentEl.empty();
		this.buildLayout();
	}

	onClose(): void {
		this.modalEl.removeClass("weave-epub-book-delete-modal");
		this.contentEl.empty();
		this.resolver?.(this.confirmed);
		this.resolver = null;
	}

	private buildLayout(): void {
		const shell = this.contentEl.createDiv({ cls: "weave-epub-book-delete-shell" });
		this.buildHero(shell);
		this.buildStatsSection(shell);
		this.buildImpactSection(shell);
		this.buildFileSection(shell);
		this.buildActions(shell);
	}

	private buildHero(container: HTMLElement): void {
		const hero = container.createDiv({ cls: "weave-epub-book-info-hero" });
		const coverUrl = normalizeText(this.options.metadata.coverImage);
		if (coverUrl) {
			hero.createEl("img", {
				cls: "weave-epub-book-info-cover",
				attr: {
					src: coverUrl,
					alt: this.options.metadata.title || this.options.fileName,
				},
			});
		} else {
			const placeholder = hero.createDiv({ cls: "weave-epub-book-info-cover is-placeholder" });
			const iconEl = placeholder.createSpan({ cls: "weave-epub-book-info-cover-icon" });
			setIcon(iconEl, "book-open");
		}

		const content = hero.createDiv({ cls: "weave-epub-book-info-hero-content" });
		content.createDiv({
			cls: "weave-epub-book-info-title",
			text:
				this.options.metadata.title ||
				this.options.fileName ||
				i18n.t("epub.bookshelf.bookDeleteModal.untitledBook"),
		});
		const bylineParts = [
			normalizeText(this.options.metadata.author),
			normalizeText(this.options.metadata.translator)
				? i18n.t("epub.bookshelf.bookDeleteModal.translatorByline", {
						name: normalizeText(this.options.metadata.translator),
					})
				: "",
		].filter(Boolean);
		if (bylineParts.length > 0) {
			content.createDiv({
				cls: "weave-epub-book-info-byline",
				text: bylineParts.join(" · "),
			});
		}

		const chips = content.createDiv({ cls: "weave-epub-book-info-chips" });
		const chipValues = [
			getBookFormatDisplayLabel(this.options.filePath),
			normalizeText(this.options.metadata.publisher),
			i18n.t("epub.bookshelf.bookDeleteModal.progressRead", {
				progress: normalizeProgress(this.options.progress),
			}),
		].filter(Boolean);
		for (const value of chipValues) {
			chips.createDiv({ cls: "weave-epub-book-info-chip", text: value });
		}
		content.createDiv({
			cls: "weave-epub-book-delete-caption",
			text: i18n.t("epub.bookshelf.bookDeleteModal.confirmBody"),
		});
	}

	private buildStatsSection(container: HTMLElement): void {
		const section = container.createDiv({ cls: "weave-epub-book-info-section" });
		section.createDiv({
			cls: "weave-epub-book-info-section-title",
			text: i18n.t("epub.bookshelf.bookDeleteModal.sectionNoteStats"),
		});

		if (!this.options.highlightStats.available) {
			section.createDiv({
				cls: "weave-epub-book-delete-note",
				text: i18n.t("epub.bookshelf.bookDeleteModal.noteStatsUnavailable"),
			});
			return;
		}

		const stats = section.createDiv({ cls: "weave-epub-book-delete-stats" });
		this.createStatCard(
			stats,
			i18n.t("epub.bookshelf.bookDeleteModal.statLinkedExcerpts"),
			`${this.options.highlightStats.totalHighlights}`
		);
		this.createStatCard(
			stats,
			i18n.t("epub.bookshelf.bookDeleteModal.statExcerptsWithComments"),
			`${this.options.highlightStats.commentCount}`
		);
		this.createStatCard(
			stats,
			i18n.t("epub.bookshelf.bookDeleteModal.statSourceFiles"),
			`${this.options.highlightStats.sourceFileCount}`
		);
	}

	private buildImpactSection(container: HTMLElement): void {
		const section = container.createDiv({ cls: "weave-epub-book-info-section" });
		section.createDiv({
			cls: "weave-epub-book-info-section-title",
			text: i18n.t("epub.bookshelf.bookDeleteModal.sectionImpact"),
		});
		const list = section.createDiv({ cls: "weave-epub-book-delete-impact-list" });
		[
			i18n.t("epub.bookshelf.bookDeleteModal.impactDeleteFile"),
			i18n.t("epub.bookshelf.bookDeleteModal.impactClearShelf"),
			i18n.t("epub.bookshelf.bookDeleteModal.impactKeepNotes"),
		].forEach((text) => {
			list.createDiv({ cls: "weave-epub-book-delete-impact-item", text });
		});
	}

	private buildFileSection(container: HTMLElement): void {
		const section = container.createDiv({ cls: "weave-epub-book-info-section" });
		section.createDiv({
			cls: "weave-epub-book-info-section-title",
			text: i18n.t("epub.bookshelf.bookDeleteModal.sectionFile"),
		});
		const grid = section.createDiv({ cls: "weave-epub-book-info-grid" });
		[
			{
				label: i18n.t("epub.bookshelf.bookDeleteModal.fileName"),
				value: this.options.fileName,
				wide: true,
			},
			{
				label: i18n.t("epub.bookshelf.bookDeleteModal.format"),
				value: getBookFormatDisplayLabel(this.options.filePath),
			},
			{
				label: i18n.t("epub.bookshelf.bookDeleteModal.fileSize"),
				value: formatFileSize(this.options.fileSize),
			},
			{
				label: i18n.t("epub.bookshelf.bookDeleteModal.path"),
				value: this.options.filePath,
				wide: true,
				mono: true,
			},
		].forEach((field) => {
			if (!field.value) {
				return;
			}
			const item = grid.createDiv({ cls: "weave-epub-book-info-item" });
			if (field.wide) {
				item.addClass("is-wide");
			}
			if (field.mono) {
				item.addClass("is-mono");
			}
			item.createDiv({ cls: "weave-epub-book-info-label", text: field.label });
			item.createDiv({ cls: "weave-epub-book-info-value", text: field.value });
		});
	}

	private buildActions(container: HTMLElement): void {
		const actions = container.createDiv({ cls: "weave-epub-book-delete-actions" });
		const cancelButton = actions.createEl("button", {
			text: i18n.t("epub.bookshelf.bookDeleteModal.cancel"),
		});
		cancelButton.onclick = () => this.close();
		const confirmButton = actions.createEl("button", {
			text: i18n.t("epub.bookshelf.bookDeleteModal.confirm"),
			cls: "mod-warning",
		});
		confirmButton.onclick = () => {
			this.confirmed = true;
			this.close();
		};
	}

	private createStatCard(container: HTMLElement, label: string, value: string): void {
		const card = container.createDiv({ cls: "weave-epub-book-delete-stat" });
		card.createDiv({ cls: "weave-epub-book-delete-stat-value", text: value });
		card.createDiv({ cls: "weave-epub-book-delete-stat-label", text: label });
	}
}
