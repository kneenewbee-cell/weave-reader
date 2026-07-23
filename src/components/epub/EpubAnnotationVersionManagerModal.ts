import { App, Modal, Notice, Platform, normalizePath, setIcon } from "obsidian";
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
	resolveEpubHost,
	switchEpubAnnotationVersion,
	type EpubAnnotationVersionSummary,
	type ImportEpubAnnotatedBookPackageResult,
} from "../../services/epub";
import { stripSupportedBookExtension } from "../../services/epub/book-format";
import {
	appendEpubImportDiagnostic,
	summarizeEpubImportResult,
} from "../../services/epub/epub-import-diagnostics";
import { epubActiveDocumentStore } from "../../stores/epub-active-document-store";
import { DirectoryUtils } from "../../utils/directory-utils";
import { shouldOfferOpenImportedBookAction } from "../modals/epub-annotated-book-package-import-result-options";
import {
	openEpubAnnotationVersionCreateMenu,
	type EpubAnnotationVersionCreateMenuHandle,
} from "./epub-annotation-version-create-menu";

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
	onClick: (event: MouseEvent) => void | Promise<void>,
	extraClass = "",
): HTMLButtonElement {
	const button = parent.createEl("button", {
		cls: `weave-annotation-version-action ${extraClass}`.trim(),
		attr: { type: "button" },
	});
	const iconEl = button.createSpan({ cls: "weave-annotation-version-action__icon" });
	setIcon(iconEl, icon);
	button.createSpan({ text: label });
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		void onClick(event);
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

const DEFAULT_VERSION_ID = "default";
const DEFAULT_VERSION_DISPLAY_NAME = "\u9ed8\u8ba4";
const DEFAULT_VERSION_ORIGINAL_NAMES = new Set([
	"",
	"\u9ed8\u8ba4",
	"\u9ed8\u8ba4\u6807\u6ce8",
]);
const DEFAULT_VERSION_MARKER = "\uff08\u9ed8\u8ba4\uff09";
const CURRENT_VERSION_MARKER = "\uff08\u5f53\u524d\uff09";

function formatVersionDisplayTitle(version: EpubAnnotationVersionSummary): string {
	const rawName = String(version.name || "").trim();
	const baseTitle = version.versionId === DEFAULT_VERSION_ID
		? (DEFAULT_VERSION_ORIGINAL_NAMES.has(rawName)
			? DEFAULT_VERSION_DISPLAY_NAME
			: `${rawName || DEFAULT_VERSION_DISPLAY_NAME}${DEFAULT_VERSION_MARKER}`)
		: (rawName || version.versionId);
	return version.active ? `${baseTitle}${CURRENT_VERSION_MARKER}` : baseTitle;
}

interface ElectronShellLike {
	openPath?: (path: string) => Promise<string>;
	showItemInFolder?: (path: string) => void;
}

interface ChildProcessLike {
	execFile?: (
		file: string,
		args: string[],
		options: { windowsHide?: boolean },
		callback?: (error?: unknown) => void
	) => unknown;
}

function getWindowRequire(): ((id: string) => unknown) | null {
	try {
		const requireFn = (window as unknown as { require?: (id: string) => unknown }).require;
		return typeof requireFn === "function" ? requireFn : null;
	} catch {
		return null;
	}
}

function getElectronShell(): ElectronShellLike | null {
	try {
		const requireFn = getWindowRequire();
		const electron = typeof requireFn === "function"
			? requireFn("electron") as { shell?: ElectronShellLike }
			: null;
		return electron?.shell || null;
	} catch {
		return null;
	}
}

function getChildProcess(): ChildProcessLike | null {
	try {
		const requireFn = getWindowRequire();
		return typeof requireFn === "function"
			? requireFn("child_process") as ChildProcessLike
			: null;
	} catch {
		return null;
	}
}

function resolveVaultSystemPath(app: App, vaultPath: string): string {
	const normalizedPath = normalizePath(vaultPath || "");
	const adapter = app.vault.adapter as typeof app.vault.adapter & {
		getFullPath?: (path: string) => string;
	};
	if (typeof adapter.getFullPath === "function") {
		try {
			return adapter.getFullPath(normalizedPath);
		} catch {
			return normalizedPath;
		}
	}
	return normalizedPath;
}

function toWindowsExplorerPath(systemPath: string): string {
	return String(systemPath || "").replace(/\//g, "\\");
}

function openWindowsExplorerPath(systemPath: string, revealSystemPath = ""): boolean {
	if (!Platform.isWin) {
		return false;
	}
	const childProcess = getChildProcess();
	if (!childProcess || typeof childProcess.execFile !== "function") {
		return false;
	}
	const normalizedSystemPath = toWindowsExplorerPath(systemPath);
	const normalizedRevealPath = toWindowsExplorerPath(revealSystemPath || "");
	const args = normalizedRevealPath && normalizedRevealPath !== normalizedSystemPath
		? [`/select,${normalizedRevealPath}`]
		: [normalizedSystemPath];
	try {
		childProcess.execFile("explorer.exe", args, { windowsHide: false }, () => undefined);
		return true;
	} catch {
		return false;
	}
}

async function openSystemFolderForVaultPath(
	app: App,
	vaultPath: string,
	revealVaultPath = ""
): Promise<boolean> {
	const systemPath = resolveVaultSystemPath(app, vaultPath);
	const revealSystemPath = resolveVaultSystemPath(app, revealVaultPath || vaultPath);
	if (openWindowsExplorerPath(systemPath, revealSystemPath)) {
		return true;
	}

	const shell = getElectronShell();
	if (!shell) {
		return false;
	}
	if (typeof shell.openPath === "function") {
		try {
			const errorMessage = await shell.openPath(systemPath);
			if (!errorMessage) {
				if (typeof shell.showItemInFolder === "function") {
					shell.showItemInFolder(revealSystemPath);
				}
				return true;
			}
		} catch {
			// Fall through to showItemInFolder when available.
		}
	}
	if (typeof shell.showItemInFolder === "function") {
		try {
			shell.showItemInFolder(revealSystemPath);
			return true;
		} catch {
			return false;
		}
	}
	return false;
}

interface EpubAnnotationVersionNameModalOptions {
	title: string;
	label: string;
	initialName: string;
	confirmLabel: string;
	cancelLabel: string;
}

class EpubAnnotationVersionNameModal extends Modal {
	private readonly modalOptions: EpubAnnotationVersionNameModalOptions;
	private nextName = "";
	private confirmed = false;
	private resolver: ((value: string | null) => void) | null = null;
	private confirmButton: HTMLButtonElement | null = null;
	private nameInput: HTMLInputElement | null = null;

	constructor(app: App, options: EpubAnnotationVersionNameModalOptions) {
		super(app);
		this.modalOptions = options;
		this.nextName = options.initialName;
	}

	openAndWait(): Promise<string | null> {
		return new Promise((resolve) => {
			this.resolver = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.modalEl.addClass("weave-annotation-version-name-modal");
		this.setTitle(this.modalOptions.title);
		this.contentEl.empty();

		const shell = this.contentEl.createDiv({ cls: "weave-annotation-version-name-shell" });
		const field = shell.createDiv({ cls: "weave-annotation-version-name-field" });
		field.createDiv({ cls: "weave-annotation-version-name-label", text: this.modalOptions.label });

		this.nameInput = field.createEl("input", {
			cls: "weave-annotation-version-name-input",
			type: "text",
			attr: {
				spellcheck: "false",
			},
		});
		this.nameInput.value = this.modalOptions.initialName;
		this.nameInput.addEventListener("input", () => {
			this.nextName = this.nameInput?.value ?? "";
			this.syncConfirmState();
		});
		this.nameInput.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				this.tryConfirm();
			}
		});

		const actions = shell.createDiv({ cls: "weave-annotation-version-name-actions" });
		const cancelButton = actions.createEl("button", {
			attr: { type: "button" },
			text: this.modalOptions.cancelLabel,
		});
		cancelButton.addEventListener("click", () => this.close());

		this.confirmButton = actions.createEl("button", {
			cls: "mod-cta",
			attr: { type: "button" },
			text: this.modalOptions.confirmLabel,
		});
		this.confirmButton.addEventListener("click", () => this.tryConfirm());

		this.syncConfirmState();
		window.setTimeout(() => {
			this.nameInput?.focus();
			this.nameInput?.select();
		}, 0);
	}

	onClose(): void {
		this.modalEl.removeClass("weave-annotation-version-name-modal");
		this.contentEl.empty();
		const trimmed = this.nextName.trim();
		this.resolver?.(this.confirmed && trimmed ? trimmed : null);
		this.resolver = null;
		this.confirmButton = null;
		this.nameInput = null;
	}

	private syncConfirmState(): void {
		if (!this.confirmButton) {
			return;
		}
		this.confirmButton.disabled = !this.nextName.trim();
	}

	private tryConfirm(): void {
		if (!this.nextName.trim()) {
			return;
		}
		this.confirmed = true;
		this.close();
	}
}

function requestEpubAnnotationVersionName(
	app: App,
	options: EpubAnnotationVersionNameModalOptions,
): Promise<string | null> {
	return new EpubAnnotationVersionNameModal(app, options).openAndWait();
}

interface EpubAnnotationVersionConfirmModalOptions {
	title: string;
	message: string;
	confirmLabel: string;
	cancelLabel: string;
}

class EpubAnnotationVersionConfirmModal extends Modal {
	private readonly modalOptions: EpubAnnotationVersionConfirmModalOptions;
	private confirmed = false;
	private resolver: ((value: boolean) => void) | null = null;

	constructor(app: App, options: EpubAnnotationVersionConfirmModalOptions) {
		super(app);
		this.modalOptions = options;
	}

	openAndWait(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolver = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.modalEl.addClass("weave-annotation-version-confirm-modal");
		this.setTitle(this.modalOptions.title);
		this.contentEl.empty();

		const shell = this.contentEl.createDiv({ cls: "weave-annotation-version-confirm-shell" });
		shell.createDiv({
			cls: "weave-annotation-version-confirm-message",
			text: this.modalOptions.message,
		});

		const actions = shell.createDiv({ cls: "weave-annotation-version-confirm-actions" });
		const cancelButton = actions.createEl("button", {
			attr: { type: "button" },
			text: this.modalOptions.cancelLabel,
		});
		cancelButton.addEventListener("click", () => this.close());

		const confirmButton = actions.createEl("button", {
			cls: "mod-warning",
			attr: { type: "button" },
			text: this.modalOptions.confirmLabel,
		});
		confirmButton.addEventListener("click", () => {
			this.confirmed = true;
			this.close();
		});
		window.setTimeout(() => confirmButton.focus(), 0);
	}

	onClose(): void {
		this.modalEl.removeClass("weave-annotation-version-confirm-modal");
		this.contentEl.empty();
		this.resolver?.(this.confirmed);
		this.resolver = null;
	}
}

function requestEpubAnnotationVersionConfirmation(
	app: App,
	options: EpubAnnotationVersionConfirmModalOptions,
): Promise<boolean> {
	return new EpubAnnotationVersionConfirmModal(app, options).openAndWait();
}

export class EpubAnnotationVersionManagerModal extends Modal {
	private readonly options: EpubAnnotationVersionManagerModalOptions;
	private createVersionMenu: EpubAnnotationVersionCreateMenuHandle | null = null;
	private lastOpenDataFolderKey = "";
	private lastOpenDataFolderAt = 0;

	constructor(app: App, options: EpubAnnotationVersionManagerModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.modalEl.addClass("weave-annotation-version-modal");
		void this.render();
	}

	private async render(): Promise<void> {
		this.closeCreateVersionMenu();
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

		const versions = await listEpubAnnotationVersions(this.app, bookId);
		const topActions = root.createDiv({ cls: "weave-annotation-version-actions" });
		appendIconButton(topActions, "plus", "新建一个版本", (event) => {
			this.openCreateVersionMenu(event.currentTarget as HTMLElement, bookId, filePath, versions);
		});
		appendIconButton(topActions, "folder-open", "打开数据目录", async () => {
			if (this.options.onOpenDataFolder) {
				await this.options.onOpenDataFolder();
				return;
			}
			await this.openDataFolder(bookDataDir, annotationsPath);
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

		const list = root.createDiv({ cls: "weave-annotation-version-list" });
		list.createEl("h3", { text: "版本列表" });
		for (const version of versions) {
			this.renderVersionRow(list, version);
		}
	}

	private openCreateVersionMenu(
		anchor: HTMLElement,
		bookId: string,
		filePath: string,
		versions: EpubAnnotationVersionSummary[],
	): void {
		this.closeCreateVersionMenu();
		this.createVersionMenu = openEpubAnnotationVersionCreateMenu(anchor, versions, {
			createBlank: () => this.createBlankVersion(bookId, filePath),
			copyFromVersion: (version) => this.createVersionFromExistingVersion(bookId, filePath, version),
		});
	}

	private closeCreateVersionMenu(): void {
		this.createVersionMenu?.close();
		this.createVersionMenu = null;
	}

	private async createBlankVersion(bookId: string, filePath: string): Promise<void> {
		this.closeCreateVersionMenu();
		if (!bookId) {
			new Notice("当前书籍数据还没有准备好");
			return;
		}
		const name = await requestEpubAnnotationVersionName(this.app, {
			title: "新建空白版本",
			label: "版本名称",
			initialName: "新标注版本",
			confirmLabel: "创建",
			cancelLabel: "取消",
		});
		if (!name) {
			return;
		}
		const version = await createEpubAnnotationVersion(this.app, bookId, name, { setActive: true });
		notifyEpubAnnotationVersionChanged(bookId, {
			reason: "create",
			filePath,
			versionId: version.versionId,
		});
		await this.notifyVersionChanged("已新建并切换空白标注版本");
		await this.render();
	}

	private async createVersionFromExistingVersion(
		bookId: string,
		filePath: string,
		sourceVersion: EpubAnnotationVersionSummary,
	): Promise<void> {
		this.closeCreateVersionMenu();
		if (!bookId) {
			new Notice("当前书籍数据还没有准备好");
			return;
		}
		const name = await requestEpubAnnotationVersionName(this.app, {
			title: "从已有版本复制",
			label: `复制来源：${sourceVersion.name}`,
			initialName: `${sourceVersion.name} 副本`,
			confirmLabel: "复制",
			cancelLabel: "取消",
		});
		if (!name) {
			return;
		}
		const version = await createEpubAnnotationVersion(this.app, bookId, name, {
			setActive: true,
			copyFromVersionId: sourceVersion.versionId,
		});
		notifyEpubAnnotationVersionChanged(bookId, {
			reason: "create",
			filePath,
			versionId: version.versionId,
		});
		await this.notifyVersionChanged(`已从「${sourceVersion.name}」复制并切换标注版本`);
		await this.render();
	}

	private async openDataFolder(bookDataDir: string, revealPath = ""): Promise<void> {
		const normalizedDir = normalizePath(String(bookDataDir || "").trim());
		if (!normalizedDir) {
			new Notice("当前书籍数据目录还没有准备好");
			return;
		}
		const openKey = `${normalizedDir}\n${normalizePath(String(revealPath || "").trim())}`;
		const timestamp = Date.now();
		if (openKey === this.lastOpenDataFolderKey && timestamp - this.lastOpenDataFolderAt < 2500) {
			new Notice("数据目录已打开");
			return;
		}
		this.lastOpenDataFolderKey = openKey;
		this.lastOpenDataFolderAt = timestamp;
		try {
			await DirectoryUtils.ensureDirRecursive(this.app.vault.adapter, normalizedDir);
			if (await openSystemFolderForVaultPath(this.app, normalizedDir, revealPath)) {
				new Notice("已打开数据目录");
				return;
			}
			const copied = await copyTextToClipboard(normalizedDir);
			new Notice(copied ? "无法直接打开，已复制数据目录路径" : "打开数据目录失败");
		} catch (error) {
			this.lastOpenDataFolderAt = 0;
			console.warn("[WeaveReader] Failed to open EPUB annotation data folder:", error);
			new Notice("打开数据目录失败");
		}
	}

	private async renameVersion(version: EpubAnnotationVersionSummary): Promise<void> {
		const name = await requestEpubAnnotationVersionName(this.app, {
			title: "重命名标注版本",
			label: "版本名称",
			initialName: version.name,
			confirmLabel: "重命名",
			cancelLabel: "取消",
		});
		const trimmedName = name?.trim();
		if (!trimmedName || trimmedName === version.name) {
			return;
		}
		let renamed = false;
		try {
			renamed = await renameEpubAnnotationVersion(this.app, this.options.bookId, version.versionId, trimmedName);
		} catch (error) {
			console.warn("[WeaveReader] Failed to rename EPUB annotation version:", error);
		}
		if (!renamed) {
			new Notice("重命名标注版本失败");
			return;
		}
		notifyEpubAnnotationVersionChanged(this.options.bookId, {
			reason: "rename",
			filePath: this.options.filePath,
			versionId: version.versionId,
		});
		await this.notifyVersionChanged(
			version.versionId === "default"
				? "已重命名显示名称；默认版本文件夹固定为 default"
				: "已重命名标注版本"
		);
		await this.render();
	}

	private async deleteVersion(version: EpubAnnotationVersionSummary): Promise<void> {
		const isDefaultVersion = version.versionId === DEFAULT_VERSION_ID;
		const confirmed = await requestEpubAnnotationVersionConfirmation(this.app, {
			title: isDefaultVersion ? "重置默认版本" : "删除标注版本",
			message: isDefaultVersion
				? "重置默认版本？显示名会恢复为默认，默认版本下的标注会被清空。"
				: `删除「${version.name}」？此操作会删除这个版本下的标注数据。`,
			confirmLabel: isDefaultVersion ? "重置" : "删除",
			cancelLabel: "取消",
		});
		if (!confirmed) {
			return;
		}
		let deleted = false;
		try {
			deleted = await deleteEpubAnnotationVersion(this.app, this.options.bookId, version.versionId);
		} catch (error) {
			console.warn("[WeaveReader] Failed to delete EPUB annotation version:", error);
		}
		if (!deleted) {
			new Notice("删除标注版本失败");
			return;
		}
		notifyEpubAnnotationVersionChanged(this.options.bookId, {
			reason: isDefaultVersion ? "reset-default" : "delete",
			filePath: this.options.filePath,
			versionId: version.versionId,
		});
		await this.notifyVersionChanged(isDefaultVersion ? "已重置默认版本" : "已删除标注版本");
		await this.render();
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

	private getImportResultBookTitle(filePath: string): string {
		const normalizedPath = normalizePath(String(filePath || "").trim());
		return (
			stripSupportedBookExtension(normalizedPath.split("/").pop() || "") ||
			normalizedPath ||
			this.options.bookTitle ||
			"当前书籍"
		);
	}

	private async showAnnotatedBookPackageImportResultModal(
		result: ImportEpubAnnotatedBookPackageResult,
		requested: { title?: string; path?: string }
	): Promise<void> {
		const targetPath = normalizePath(String(result.bookPath || "").trim());
		const activePath = normalizePath(String(epubActiveDocumentStore.getActiveDocument() || "").trim());
		const shouldOfferOpenBook = shouldOfferOpenImportedBookAction({
			activeBookPath: activePath,
			targetBookPath: targetPath,
		});
		const host = resolveEpubHost(this.app);
		const canOpenBook = shouldOfferOpenBook && typeof host?.openEpubReader === "function";
		await appendEpubImportDiagnostic(this.app, "version-manager.modal.before-open", {
			activePath,
			targetPath,
			requested,
			shouldOfferOpenBook,
			canOpenBook,
			result: summarizeEpubImportResult(result),
		});
		try {
			const { EpubAnnotatedBookPackageImportResultModal } = await import(
				"../modals/EpubAnnotatedBookPackageImportResultModal"
			);
			await appendEpubImportDiagnostic(this.app, "version-manager.modal.component-loaded", {
				targetPath,
			});
			new EpubAnnotatedBookPackageImportResultModal(this.app, {
				targetBookTitle: this.getImportResultBookTitle(targetPath),
				targetBookPath: targetPath,
				requestedBookTitle: requested.title,
				requestedBookPath: requested.path,
				importedAnnotationCount: result.importedAnnotationCount,
				importedAnnotationVersionCount: result.importedAnnotationVersionCount,
				activeVersionId: result.activeVersionId,
				activatedImportedVersion: result.activatedImportedVersion,
				matchedExistingBook: result.matchedExistingBook,
				matchKind: result.matchKind,
				usedPreferredTarget: result.usedPreferredTarget,
				onOpenBook: canOpenBook ? () => host?.openEpubReader?.(targetPath) : undefined,
			}).open();
			await appendEpubImportDiagnostic(this.app, "version-manager.modal.opened", {
				targetPath,
				activeVersionId: result.activeVersionId,
			});
		} catch (error) {
			await appendEpubImportDiagnostic(this.app, "version-manager.modal.open-error", {
				targetPath,
				error,
			});
			throw error;
		}
	}

	private async importAnnotatedBookPackage(bookId: string, filePath: string): Promise<void> {
		await appendEpubImportDiagnostic(this.app, "version-manager.import.start", {
			bookId,
			filePath: normalizePath(String(filePath || "").trim()),
		});
		if (!bookId || !filePath) {
			new Notice("当前书籍数据还没有准备好");
			return;
		}
		const arrayBuffer = await pickEpubAnnotatedBookPackageArrayBuffer();
		if (!arrayBuffer) {
			await appendEpubImportDiagnostic(this.app, "version-manager.import.cancelled", {
				bookId,
				filePath: normalizePath(String(filePath || "").trim()),
			});
			return;
		}
		try {
			await appendEpubImportDiagnostic(this.app, "version-manager.import.picked", {
				bookId,
				filePath: normalizePath(String(filePath || "").trim()),
				arrayBufferBytes: arrayBuffer.byteLength,
			});
			const result = await importEpubAnnotatedBookPackage(this.app, arrayBuffer, {
				preferredBookId: bookId,
				targetBookPath: filePath,
				activateImportedAnnotations: true,
			});
			await appendEpubImportDiagnostic(this.app, "version-manager.import.success", {
				bookId,
				filePath: normalizePath(String(filePath || "").trim()),
				result: summarizeEpubImportResult(result),
			});
			notifyEpubAnnotationVersionChanged(result.bookId, {
				reason: "import",
				filePath: result.bookPath,
				versionId: result.activeVersionId,
			});
			await this.showAnnotatedBookPackageImportResultModal(result, {
				title: this.options.bookTitle || filePath,
				path: filePath,
			});
			if (this.options.onVersionChanged) {
				await this.options.onVersionChanged();
			}
			await this.render();
			await appendEpubImportDiagnostic(this.app, "version-manager.import.modal-complete", {
				bookId,
				result: summarizeEpubImportResult(result),
			});
		} catch (error) {
			await appendEpubImportDiagnostic(this.app, "version-manager.import.error", {
				bookId,
				filePath: normalizePath(String(filePath || "").trim()),
				error,
			});
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
			text: formatVersionDisplayTitle(version),
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
			await this.renameVersion(version);
		});
		appendIconButton(
			actions,
			"trash-2",
			version.versionId === DEFAULT_VERSION_ID ? "重置" : "删除",
			async () => {
				await this.deleteVersion(version);
			},
			"is-danger",
		);
	}

	private async notifyVersionChanged(message: string): Promise<void> {
		new Notice(message);
		if (this.options.onVersionChanged) {
			await this.options.onVersionChanged();
		}
	}

	onClose(): void {
		this.closeCreateVersionMenu();
		this.contentEl.empty();
	}
}
