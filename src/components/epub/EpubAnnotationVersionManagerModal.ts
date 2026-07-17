import { App, Modal, Notice, setIcon } from "obsidian";
import { copyTextToClipboard } from "../../utils/clipboard-copy";
import {
	createEpubAnnotatedBookPackage,
	createEpubAnnotationVersion,
	deleteEpubAnnotationVersion,
	downloadEpubAnnotatedBookPackage,
	importEpubAnnotatedBookPackage,
	listEpubAnnotationVersions,
	notifyEpubAnnotationVersionChanged,
	pickEpubAnnotatedBookPackageArrayBuffer,
	renameEpubAnnotationVersion,
	switchEpubAnnotationVersion,
	type EpubAnnotationVersionSummary,
} from "../../services/epub";

export interface EpubAnnotationVersionManagerModalOptions {
	bookTitle?: string;
	bookId?: string;
	filePath?: string;
	bookDataDir?: string;
	annotationsPath?: string;
	onOpenDataFolder?: () => void | Promise<void>;
	onVersionChanged?: () => void | Promise<void>;
}

function appendIconButton(
	parent: HTMLElement,
	icon: string,
	label: string,
	onClick: () => void | Promise<void>,
	extraClass = "",
): HTMLButtonElement {
	const button = parent.createEl("button", {
		cls: `weave-annotation-version-action ${extraClass}`.trim(),
		attr: { type: "button" },
	});
	const iconEl = button.createSpan({ cls: "weave-annotation-version-action__icon" });
	setIcon(iconEl, icon);
	button.createSpan({ text: label });
	button.addEventListener("click", () => {
		void onClick();
	});
	return button;
}

function appendInfoRow(parent: HTMLElement, label: string, value: string): void {
	const row = parent.createDiv({ cls: "weave-annotation-version-row" });
	row.createDiv({ cls: "weave-annotation-version-row__label", text: label });
	row.createDiv({
		cls: "weave-annotation-version-row__value",
		text: value || "未生成",
	});
}

function formatDateTime(value: number): string {
	if (!value) {
		return "未记录";
	}
	try {
		return new Date(value).toLocaleString();
	} catch {
		return String(value);
	}
}

export class EpubAnnotationVersionManagerModal extends Modal {
	private readonly options: EpubAnnotationVersionManagerModalOptions;

	constructor(app: App, options: EpubAnnotationVersionManagerModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.modalEl.addClass("weave-annotation-version-modal");
		void this.render();
	}

	private async render(): Promise<void> {
		const {
			bookTitle = "当前书籍",
			bookId = "",
			filePath = "",
			bookDataDir = "",
			annotationsPath = "",
		} = this.options;
		this.setTitle("标注版本");
		this.contentEl.empty();

		const root = this.contentEl.createDiv({ cls: "weave-annotation-version" });
		root.createEl("p", {
			cls: "weave-annotation-version__intro",
			text: "每本书只启用一个当前标注版本。切换版本会立即刷新当前版本的 annotations.json，并让阅读器重新加载标注。",
		});

		const current = root.createDiv({ cls: "weave-annotation-version-card" });
		current.createEl("h3", { text: "本书数据" });
		appendInfoRow(current, "书名", bookTitle);
		appendInfoRow(current, "Book ID", bookId);
		appendInfoRow(current, "书籍文件", filePath);
		appendInfoRow(current, "数据目录", bookDataDir);
		appendInfoRow(current, "当前标注镜像", annotationsPath);

		const topActions = root.createDiv({ cls: "weave-annotation-version-actions" });
		appendIconButton(topActions, "plus", "新建空白版本", async () => {
			const name = window.prompt("请输入新标注版本名称", "新标注版本");
			if (!name?.trim()) {
				return;
			}
			const version = await createEpubAnnotationVersion(this.app, bookId, name, { setActive: true });
			notifyEpubAnnotationVersionChanged(bookId, {
				reason: "create",
				filePath,
				versionId: version.versionId,
			});
			await this.notifyVersionChanged("已新建并切换标注版本");
			await this.render();
		});
		appendIconButton(topActions, "copy-plus", "复制当前为新版本", async () => {
			const name = window.prompt("请输入新标注版本名称", "当前标注副本");
			if (!name?.trim()) {
				return;
			}
			const version = await createEpubAnnotationVersion(this.app, bookId, name, {
				setActive: true,
				copyFromActive: true,
			});
			notifyEpubAnnotationVersionChanged(bookId, {
				reason: "create",
				filePath,
				versionId: version.versionId,
			});
			await this.notifyVersionChanged("已复制并切换标注版本");
			await this.render();
		});
		appendIconButton(topActions, "folder-open", "打开数据目录", async () => {
			if (this.options.onOpenDataFolder) {
				await this.options.onOpenDataFolder();
				return;
			}
			new Notice("当前入口只能显示数据路径");
		});
		appendIconButton(topActions, "clipboard-copy", "复制标注数据路径", async () => {
			const copied = await copyTextToClipboard(annotationsPath);
			new Notice(copied ? "已复制标注数据路径" : "复制标注数据路径失败");
		});

		appendIconButton(topActions, "download", "导出书籍标注包", async () => {
			await this.exportAnnotatedBookPackage(bookId, filePath, bookTitle);
		});
		appendIconButton(topActions, "upload", "导入书籍标注包", async () => {
			await this.importAnnotatedBookPackage(bookId, filePath);
		});

		const versions = await listEpubAnnotationVersions(this.app, bookId);
		const list = root.createDiv({ cls: "weave-annotation-version-list" });
		list.createEl("h3", { text: "版本列表" });
		for (const version of versions) {
			this.renderVersionRow(list, version);
		}
	}

	private async exportAnnotatedBookPackage(
		bookId: string,
		filePath: string,
		bookTitle: string
	): Promise<void> {
		if (!bookId || !filePath) {
			new Notice("当前书籍数据还没有准备好");
			return;
		}
		try {
			const result = await createEpubAnnotatedBookPackage(this.app, {
				bookId,
				filePath,
				displayName: bookTitle || filePath,
			});
			downloadEpubAnnotatedBookPackage(result);
			new Notice(`已导出书籍标注包：${result.fileName}`);
		} catch (error) {
			new Notice(`导出书籍标注包失败：${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async importAnnotatedBookPackage(bookId: string, filePath: string): Promise<void> {
		if (!bookId || !filePath) {
			new Notice("当前书籍数据还没有准备好");
			return;
		}
		const arrayBuffer = await pickEpubAnnotatedBookPackageArrayBuffer();
		if (!arrayBuffer) {
			return;
		}
		try {
			const result = await importEpubAnnotatedBookPackage(this.app, arrayBuffer, {
				preferredBookId: bookId,
				targetBookPath: filePath,
				activateImportedAnnotations: true,
			});
			notifyEpubAnnotationVersionChanged(result.bookId, {
				reason: "import",
				filePath: result.bookPath,
				versionId: result.activeVersionId,
			});
			await this.notifyVersionChanged(
				`已导入书籍标注包：${result.importedAnnotationCount} 条标注，当前版本 ${result.activeVersionId}`
			);
			await this.render();
		} catch (error) {
			new Notice(`导入书籍标注包失败：${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private renderVersionRow(parent: HTMLElement, version: EpubAnnotationVersionSummary): void {
		const row = parent.createDiv({
			cls: `weave-annotation-version-item${version.active ? " is-active" : ""}`,
		});
		const main = row.createDiv({ cls: "weave-annotation-version-item__main" });
		main.createDiv({
			cls: "weave-annotation-version-item__title",
			text: version.active ? `${version.name}（当前）` : version.name,
		});
		main.createDiv({
			cls: "weave-annotation-version-item__meta",
			text: `${version.annotationCount} 条标注 · 更新于 ${formatDateTime(version.updatedAt)}`,
		});

		const actions = row.createDiv({ cls: "weave-annotation-version-item__actions" });
		if (!version.active) {
			appendIconButton(actions, "check", "切换", async () => {
				if (!window.confirm(`切换到「${version.name}」？当前阅读器会刷新显示这个版本的标注。`)) {
					return;
				}
				await switchEpubAnnotationVersion(this.app, this.options.bookId, version.versionId);
				notifyEpubAnnotationVersionChanged(this.options.bookId, {
					reason: "switch",
					filePath: this.options.filePath,
					versionId: version.versionId,
				});
				await this.notifyVersionChanged(`已切换到「${version.name}」`);
				await this.render();
			});
		}
		appendIconButton(actions, "pencil", "重命名", async () => {
			const name = window.prompt("请输入新的版本名称", version.name);
			if (!name?.trim() || name.trim() === version.name) {
				return;
			}
			await renameEpubAnnotationVersion(this.app, this.options.bookId, version.versionId, name.trim());
			new Notice("已重命名标注版本");
			await this.render();
		});
		if (version.versionId !== "default") {
			appendIconButton(actions, "trash-2", "删除", async () => {
				if (!window.confirm(`删除「${version.name}」？此操作会删除这个版本下的标注数据。`)) {
					return;
				}
				const deleted = await deleteEpubAnnotationVersion(this.app, this.options.bookId, version.versionId);
				if (deleted) {
					notifyEpubAnnotationVersionChanged(this.options.bookId, {
						reason: "delete",
						filePath: this.options.filePath,
						versionId: version.versionId,
					});
					await this.notifyVersionChanged("已删除标注版本");
					await this.render();
				} else {
					new Notice("删除标注版本失败");
				}
			}, "is-danger");
		}
	}

	private async notifyVersionChanged(message: string): Promise<void> {
		new Notice(message);
		if (this.options.onVersionChanged) {
			await this.options.onVersionChanged();
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
