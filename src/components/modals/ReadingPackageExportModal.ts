import { App, Modal, Setting, type ToggleComponent } from "obsidian";
import {
	getReadingPackageExportModules,
	type ReadingPackageBookFormat,
	type ReadingPackageModuleSelection,
} from "../../services/reading-package";

export function openReadingPackageExportModal(
	app: App,
	options: { bookFormat: ReadingPackageBookFormat },
): Promise<ReadingPackageModuleSelection | null> {
	return new Promise((resolve) => {
		new ReadingPackageExportModal(app, options.bookFormat, resolve).open();
	});
}

class ReadingPackageExportModal extends Modal {
	private readonly selection: ReadingPackageModuleSelection = {
		book: false,
		annotationSystem: false,
		ink: false,
		navigationState: false,
		aiReadingNote: false,
	};

	constructor(
		app: App,
		private readonly bookFormat: ReadingPackageBookFormat,
		private readonly finish: (value: ReadingPackageModuleSelection | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("导出阅读包");
		this.contentEl.empty();
		for (const module of getReadingPackageExportModules(this.bookFormat)) {
			this.selection[module.key] = module.defaultSelected;
			new Setting(this.contentEl)
				.setName(module.label)
				.addToggle((toggle: ToggleComponent) => {
					toggle.setValue(module.defaultSelected);
					toggle.onChange((value) => {
						this.selection[module.key] = value;
					});
				});
		}
		new Setting(this.contentEl)
			.addButton((button) => {
				button.setButtonText("取消").onClick(() => {
					this.close();
					this.finish(null);
				});
			})
			.addButton((button) => {
				button.setCta().setButtonText("导出").onClick(() => {
					this.close();
					this.finish({ ...this.selection });
				});
			});
	}
}
