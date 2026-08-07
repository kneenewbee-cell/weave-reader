import { App, Modal, Setting } from "obsidian";
import type { ReadingPackageImportResult } from "../../services/reading-package";

const MODULE_LABELS: Record<string, string> = {
	book: "原书文件",
	annotationSystem: "标注体系",
	ink: "手写/墨迹",
	navigationState: "书签与进度",
	aiReadingNote: "AI 阅读笔记",
};

export function showReadingPackageImportResultModal(
	app: App,
	result: ReadingPackageImportResult,
): void {
	new ReadingPackageImportResultModal(app, result).open();
}

class ReadingPackageImportResultModal extends Modal {
	constructor(
		app: App,
		private readonly result: ReadingPackageImportResult,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("阅读包导入完成");
		this.contentEl.empty();
		const imported =
			this.result.importedModules.map((key) => MODULE_LABELS[key] || key).join("、") ||
			"无新增数据";
		this.contentEl.createEl("p", { text: `目标书籍：${this.result.bookPath}` });
		this.contentEl.createEl("p", { text: `已导入：${imported}` });
		this.contentEl.createEl("p", {
			text: `备份文件：${this.result.backupPaths.length} 个`,
		});
		new Setting(this.contentEl).addButton((button) => {
			button.setCta().setButtonText("完成").onClick(() => this.close());
		});
	}
}
