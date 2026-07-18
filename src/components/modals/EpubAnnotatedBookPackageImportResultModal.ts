import { ButtonComponent, Modal, setIcon } from "obsidian";
import type { App } from "obsidian";
import type { EpubAnnotatedBookPackageMatchKind } from "../../services/epub";
import { i18n } from "../../utils/i18n";
import { isEpubAnnotatedBookImportMatchedDifferentBook } from "./epub-annotated-book-package-import-result-options";

export interface EpubAnnotatedBookPackageImportResultModalOptions {
	targetBookTitle: string;
	targetBookPath: string;
	requestedBookTitle?: string;
	requestedBookPath?: string;
	importedAnnotationCount: number;
	importedAnnotationVersionCount: number;
	activeVersionId: string;
	activatedImportedVersion: boolean;
	matchedExistingBook: boolean;
	matchKind: EpubAnnotatedBookPackageMatchKind;
	usedPreferredTarget: boolean;
	onOpenBook?: () => Promise<void> | void;
}

const MATCH_REASON_KEY: Record<EpubAnnotatedBookPackageMatchKind, string> = {
	fileFingerprint: "epub.bookshelf.importResult.match.fileFingerprint",
	packageFingerprint: "epub.bookshelf.importResult.match.packageFingerprint",
	contentFingerprint: "epub.bookshelf.importResult.match.contentFingerprint",
	"preferred-fallback": "epub.bookshelf.importResult.match.preferredFallback",
	"new-book": "epub.bookshelf.importResult.match.newBook",
};

function cleanText(value: string | undefined, fallback: string): string {
	return String(value || "").trim() || fallback;
}

export class EpubAnnotatedBookPackageImportResultModal extends Modal {
	private readonly options: EpubAnnotatedBookPackageImportResultModalOptions;

	constructor(app: App, options: EpubAnnotatedBookPackageImportResultModalOptions) {
		super(app);
		this.options = options;
	}

	override onOpen(): void {
		this.modalEl.addClass("weave-epub-annotation-import-result-modal");
		this.titleEl.setText(i18n.t("epub.bookshelf.importResult.title"));
		this.contentEl.empty();
		this.render();
	}

	override onClose(): void {
		this.modalEl.removeClass("weave-epub-annotation-import-result-modal");
		this.contentEl.empty();
	}

	private render(): void {
		const shell = this.contentEl.createDiv({ cls: "weave-epub-annotation-import-result-shell" });
		this.renderHero(shell);
		this.renderTargetSection(shell);
		this.renderActionRow(shell);
	}

	private renderHero(container: HTMLElement): void {
		const hero = container.createDiv({ cls: "weave-epub-annotation-import-result-hero" });
		const iconWrap = hero.createDiv({ cls: "weave-epub-annotation-import-result-icon" });
		setIcon(iconWrap, "check-circle");

		const body = hero.createDiv({ cls: "weave-epub-annotation-import-result-hero-body" });
		body.createDiv({
			cls: "weave-epub-annotation-import-result-headline",
			text: i18n.t("epub.bookshelf.importResult.headline", {
				count: this.options.importedAnnotationCount,
				version: this.options.activeVersionId,
			}),
		});
		body.createDiv({
			cls: "weave-epub-annotation-import-result-caption",
			text: this.options.activatedImportedVersion
				? i18n.t("epub.bookshelf.importResult.activated")
				: i18n.t("epub.bookshelf.importResult.notActivated"),
		});

		const stats = body.createDiv({ cls: "weave-epub-annotation-import-result-stats" });
		this.createStat(stats, i18n.t("epub.bookshelf.importResult.statAnnotations"), `${this.options.importedAnnotationCount}`);
		this.createStat(stats, i18n.t("epub.bookshelf.importResult.statVersions"), `${this.options.importedAnnotationVersionCount}`);
	}

	private renderTargetSection(container: HTMLElement): void {
		const section = container.createDiv({ cls: "weave-epub-book-info-section" });
		section.createDiv({
			cls: "weave-epub-book-info-section-title",
			text: i18n.t("epub.bookshelf.importResult.targetSection"),
		});

		const targetTitle = cleanText(
			this.options.targetBookTitle,
			i18n.t("epub.bookshelf.importResult.untitledBook")
		);
		const grid = section.createDiv({ cls: "weave-epub-book-info-grid" });
		this.createInfoItem(grid, i18n.t("epub.bookshelf.importResult.targetBook"), targetTitle);
		this.createInfoItem(
			grid,
			i18n.t("epub.bookshelf.importResult.matchReason"),
			i18n.t(MATCH_REASON_KEY[this.options.matchKind])
		);
		this.createInfoItem(
			grid,
			i18n.t("epub.bookshelf.importResult.targetPath"),
			this.options.targetBookPath,
			["is-wide", "is-mono"]
		);

		if (
			isEpubAnnotatedBookImportMatchedDifferentBook({
				requestedBookPath: this.options.requestedBookPath,
				targetBookPath: this.options.targetBookPath,
			})
		) {
			const requestedTitle = cleanText(
				this.options.requestedBookTitle,
				i18n.t("epub.bookshelf.importResult.untitledBook")
			);
			section.createDiv({
				cls: "weave-epub-annotation-import-result-note is-warning",
				text: i18n.t("epub.bookshelf.importResult.matchedDifferentBook", {
					target: targetTitle,
					requested: requestedTitle,
				}),
			});
		} else if (this.options.usedPreferredTarget) {
			section.createDiv({
				cls: "weave-epub-annotation-import-result-note",
				text: i18n.t("epub.bookshelf.importResult.matchedRequestedBook"),
			});
		}
	}

	private renderActionRow(container: HTMLElement): void {
		const actions = container.createDiv({ cls: "weave-epub-annotation-import-result-actions" });
		if (this.options.onOpenBook) {
			new ButtonComponent(actions)
				.setCta()
				.setButtonText(i18n.t("epub.bookshelf.importResult.openBook"))
				.onClick(async () => {
					await this.options.onOpenBook?.();
					this.close();
				});
		}
		new ButtonComponent(actions)
			.setButtonText(
				this.options.onOpenBook
					? i18n.t("epub.bookshelf.importResult.stayHere")
					: i18n.t("epub.bookshelf.importResult.close")
			)
			.onClick(() => this.close());
	}

	private createInfoItem(
		container: HTMLElement,
		label: string,
		value: string,
		classes: string[] = []
	): void {
		const item = container.createDiv({ cls: "weave-epub-book-info-item" });
		for (const className of classes) {
			item.addClass(className);
		}
		item.createDiv({ cls: "weave-epub-book-info-label", text: label });
		item.createDiv({ cls: "weave-epub-book-info-value", text: value });
	}

	private createStat(container: HTMLElement, label: string, value: string): void {
		const stat = container.createDiv({ cls: "weave-epub-annotation-import-result-stat" });
		stat.createDiv({ cls: "weave-epub-annotation-import-result-stat-value", text: value });
		stat.createDiv({ cls: "weave-epub-annotation-import-result-stat-label", text: label });
	}
}
