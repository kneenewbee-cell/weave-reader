import { fireEvent, waitFor } from "@testing-library/dom";
import type { EpubAnnotationVersionSummary } from "../../services/epub/epub-annotation-version-store";

const epubServiceMocks = vi.hoisted(() => ({
	createEpubAnnotatedBookPackage: vi.fn(),
	createEpubAnnotationVersion: vi.fn(),
	deleteEpubAnnotationVersion: vi.fn(),
	downloadEpubAnnotatedBookPackage: vi.fn(),
	importEpubAnnotatedBookPackage: vi.fn(),
	listEpubAnnotationVersions: vi.fn(),
	notifyEpubAnnotationVersionChanged: vi.fn(),
	pickEpubAnnotatedBookPackageArrayBuffer: vi.fn(),
	renameEpubAnnotationVersion: vi.fn(),
	resolveEpubHost: vi.fn(),
	switchEpubAnnotationVersion: vi.fn(),
}));

vi.mock("../../services/epub", () => epubServiceMocks);
vi.mock("../../stores/epub-active-document-store", () => ({
	epubActiveDocumentStore: {
		getActiveDocument: vi.fn(() => ""),
	},
}));
vi.mock("../modals/epub-annotated-book-package-import-result-options", () => ({
	shouldOfferOpenImportedBookAction: vi.fn(() => false),
}));
vi.mock("../../services/epub/epub-import-diagnostics", () => ({
	appendEpubImportDiagnostic: vi.fn(async () => undefined),
	summarizeEpubImportResult: vi.fn((result) => result),
}));
vi.mock("../../utils/clipboard-copy", () => ({
	copyTextToClipboard: vi.fn(async () => true),
}));

vi.mock("obsidian", () => {
	type ObsidianDomOptions = {
		cls?: string | string[];
		text?: string;
		attr?: Record<string, string | number | boolean | null>;
		type?: string;
	};

	function applyOptions(element: HTMLElement, options?: ObsidianDomOptions | string): void {
		if (!options) {
			return;
		}
		if (typeof options === "string") {
			element.className = options;
			return;
		}
		if (options.cls) {
			element.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
		}
		if (options.text) {
			element.textContent = options.text;
		}
		if (options.type) {
			(element as HTMLInputElement).type = options.type;
		}
		for (const [name, value] of Object.entries(options.attr || {})) {
			if (value != null) {
				element.setAttribute(name, String(value));
			}
		}
	}

	function createObsidianElement<K extends keyof HTMLElementTagNameMap>(
		tag: K,
		options?: ObsidianDomOptions | string,
	): HTMLElementTagNameMap[K] {
		const element = document.createElement(tag) as HTMLElementTagNameMap[K] & {
			empty: () => void;
			addClass: (...classNames: string[]) => void;
			removeClass: (...classNames: string[]) => void;
			createDiv: (options?: ObsidianDomOptions | string) => HTMLDivElement;
			createSpan: (options?: ObsidianDomOptions | string) => HTMLSpanElement;
			createEl: <T extends keyof HTMLElementTagNameMap>(
				childTag: T,
				options?: ObsidianDomOptions | string,
			) => HTMLElementTagNameMap[T];
		};
		applyOptions(element, options);
		element.empty = () => element.replaceChildren();
		element.addClass = (...classNames: string[]) => element.classList.add(...classNames);
		element.removeClass = (...classNames: string[]) => element.classList.remove(...classNames);
		element.createDiv = (childOptions) => {
			const child = createObsidianElement("div", childOptions);
			element.appendChild(child);
			return child;
		};
		element.createSpan = (childOptions) => {
			const child = createObsidianElement("span", childOptions);
			element.appendChild(child);
			return child;
		};
		element.createEl = (childTag, childOptions) => {
			const child = createObsidianElement(childTag, childOptions);
			element.appendChild(child);
			return child;
		};
		return element;
	}

	class Modal {
		app: unknown;
		modalEl: HTMLElement;
		contentEl: HTMLElement;
		titleEl: HTMLElement;

		constructor(app: unknown) {
			this.app = app;
			this.modalEl = createObsidianElement("div");
			this.contentEl = createObsidianElement("div");
			this.titleEl = createObsidianElement("div");
			this.modalEl.append(this.titleEl, this.contentEl);
			document.body.appendChild(this.modalEl);
		}

		setTitle(title: string): void {
			this.titleEl.textContent = title;
		}

		open(): this {
			this.onOpen();
			return this;
		}

		close(): this {
			this.onClose();
			this.modalEl.remove();
			return this;
		}

		onOpen(): void {}

		onClose(): void {}
	}

	return {
		App: class App {},
		Modal,
		Notice: vi.fn(),
		Platform: { isWin: true },
		normalizePath: vi.fn((path: string) => path.replace(/\\/g, "/")),
		setIcon: vi.fn((element: HTMLElement, icon: string) => {
			element.setAttribute("data-icon", icon);
		}),
	};
});

import { EpubAnnotationVersionManagerModal } from "./EpubAnnotationVersionManagerModal";
import { openEpubAnnotationVersionCreateMenu } from "./epub-annotation-version-create-menu";
import { Notice } from "obsidian";

function createVersionSummary(
	versionId: string,
	name: string,
	active = false,
): EpubAnnotationVersionSummary {
	return {
		bookId: "epub-book-demo",
		versionId,
		name,
		createdAt: 10,
		updatedAt: 20,
		annotationCount: 1,
		active,
	};
}

function createAnchor(): HTMLButtonElement {
	const anchor = document.createElement("button");
	document.body.appendChild(anchor);
	anchor.getBoundingClientRect = () => ({
		x: 100,
		y: 100,
		left: 100,
		top: 100,
		right: 220,
		bottom: 132,
		width: 120,
		height: 32,
		toJSON: () => ({}),
	});
	return anchor;
}

function createApp() {
	const folders = new Set<string>();
	return {
		vault: {
			adapter: {
				exists: vi.fn(async (path: string) => folders.has(path)),
				getFullPath: vi.fn((path: string) => `D:/ResOB/note/${path}`),
				mkdir: vi.fn(async (path: string) => {
					folders.add(path);
				}),
			},
		},
	};
}

function findButton(root: HTMLElement, label: string): HTMLButtonElement {
	const button = Array.from(root.querySelectorAll("button")).find((candidate) =>
		candidate.textContent?.includes(label)
	);
	if (!(button instanceof HTMLButtonElement)) {
		throw new Error(`Button not found: ${label}`);
	}
	return button;
}

describe("EpubAnnotationVersionManagerModal create menu", () => {
	afterEach(() => {
		document.body.replaceChildren();
		vi.restoreAllMocks();
	});

	it("wires blank creation from the recursive root menu", async () => {
		const anchor = createAnchor();
		const createBlank = vi.fn();

		openEpubAnnotationVersionCreateMenu(anchor, [], {
			createBlank,
			copyFromVersion: vi.fn(),
		});

		await fireEvent.click(document.querySelector('[data-create-mode="blank"]') as HTMLElement);

		expect(createBlank).toHaveBeenCalledTimes(1);
	});

	it("opens the copy submenu and wires each version as a copy source", async () => {
		const anchor = createAnchor();
		const versions = [
			createVersionSummary("default", "默认标注", true),
			createVersionSummary("review", "复习版"),
		];
		const copyFromVersion = vi.fn();

		openEpubAnnotationVersionCreateMenu(anchor, versions, {
			createBlank: vi.fn(),
			copyFromVersion,
		});

		await fireEvent.click(document.querySelector('[data-create-mode="copy"]') as HTMLElement);
		expect(document.querySelector('[data-version-id="review"]')).not.toBeNull();

		await fireEvent.click(document.querySelector('[data-version-id="review"]') as HTMLElement);

		expect(copyFromVersion).toHaveBeenCalledWith(versions[1]);
	});

	it("shows the built-in default version as only default before the user renames it", async () => {
		epubServiceMocks.listEpubAnnotationVersions.mockResolvedValue([
			createVersionSummary("default", "\u9ed8\u8ba4\u6807\u6ce8", true),
		]);
		const app = createApp();
		const modal = new EpubAnnotationVersionManagerModal(app as never, {
			bookId: "epub-book-demo",
			bookDataDir: "weave/epub-data/books/epub-book-demo",
		});

		await (modal as unknown as { render: () => Promise<void> }).render();

		expect(modal.contentEl.querySelector(".weave-annotation-version-item__title")?.textContent).toBe(
			"\u9ed8\u8ba4\uff08\u5f53\u524d\uff09",
		);
	});

	it("shows a renamed default version as the user name plus the default marker", async () => {
		epubServiceMocks.listEpubAnnotationVersions.mockResolvedValue([
			createVersionSummary("default", "6", true),
		]);
		const app = createApp();
		const modal = new EpubAnnotationVersionManagerModal(app as never, {
			bookId: "epub-book-demo",
			bookDataDir: "weave/epub-data/books/epub-book-demo",
		});

		await (modal as unknown as { render: () => Promise<void> }).render();

		expect(modal.contentEl.querySelector(".weave-annotation-version-item__title")?.textContent).toBe(
			"6\uff08\u9ed8\u8ba4\uff09\uff08\u5f53\u524d\uff09",
		);
	});

	it("renames a version through the plugin name modal instead of window.prompt", async () => {
		epubServiceMocks.listEpubAnnotationVersions.mockResolvedValue([
			createVersionSummary("default", "默认标注", true),
		]);
		epubServiceMocks.renameEpubAnnotationVersion.mockResolvedValue(true);
		const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("不应该使用这个");
		const app = createApp();
		const modal = new EpubAnnotationVersionManagerModal(app as never, {
			bookId: "epub-book-demo",
			bookDataDir: "weave/epub-data/books/epub-book-demo",
		});

		await (modal as unknown as { render: () => Promise<void> }).render();
		await fireEvent.click(findButton(modal.contentEl, "重命名"));
		const input = document.querySelector(".weave-annotation-version-name-input") as HTMLInputElement;
		expect(input).not.toBeNull();
		input.value = "复习版";
		await fireEvent.input(input);
		await fireEvent.click(
			document.querySelector(".weave-annotation-version-name-actions .mod-cta") as HTMLButtonElement,
		);

		await waitFor(() => {
			expect(epubServiceMocks.renameEpubAnnotationVersion).toHaveBeenCalledWith(
				app,
				"epub-book-demo",
				"default",
				"复习版",
			);
		});
		expect(promptSpy).not.toHaveBeenCalled();
	});

	it("explains that the default version keeps the default backend folder id when renamed", async () => {
		epubServiceMocks.listEpubAnnotationVersions.mockResolvedValue([
			createVersionSummary("default", "榛樿鏍囨敞", true),
		]);
		epubServiceMocks.renameEpubAnnotationVersion.mockResolvedValue(true);
		const app = createApp();
		const modal = new EpubAnnotationVersionManagerModal(app as never, {
			bookId: "epub-book-demo",
			bookDataDir: "weave/epub-data/books/epub-book-demo",
		});

		await (modal as unknown as { render: () => Promise<void> }).render();
		const renameButton = modal.contentEl.querySelector('[data-icon="pencil"]')?.closest("button");
		expect(renameButton).toBeInstanceOf(HTMLButtonElement);
		await fireEvent.click(renameButton as HTMLButtonElement);
		const input = document.querySelector(".weave-annotation-version-name-input") as HTMLInputElement;
		input.value = "6";
		await fireEvent.input(input);
		await fireEvent.click(
			document.querySelector(".weave-annotation-version-name-actions .mod-cta") as HTMLButtonElement,
		);

		await waitFor(() => {
			expect(Notice).toHaveBeenCalledWith("已重命名显示名称；默认版本文件夹固定为 default");
		});
	});

	it("shows a failure notice when a rename operation rejects", async () => {
		epubServiceMocks.listEpubAnnotationVersions.mockResolvedValue([
			createVersionSummary("default", "榛樿鏍囨敞", true),
		]);
		epubServiceMocks.renameEpubAnnotationVersion.mockRejectedValueOnce(new Error("folder locked"));
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const app = createApp();
		const modal = new EpubAnnotationVersionManagerModal(app as never, {
			bookId: "epub-book-demo",
			bookDataDir: "weave/epub-data/books/epub-book-demo",
		});

		await (modal as unknown as { render: () => Promise<void> }).render();
		const renameButton = modal.contentEl.querySelector('[data-icon="pencil"]')?.closest("button");
		expect(renameButton).toBeInstanceOf(HTMLButtonElement);
		await fireEvent.click(renameButton as HTMLButtonElement);
		const input = document.querySelector(".weave-annotation-version-name-input") as HTMLInputElement;
		input.value = "review";
		await fireEvent.input(input);
		await fireEvent.click(
			document.querySelector(".weave-annotation-version-name-actions .mod-cta") as HTMLButtonElement,
		);

		await waitFor(() => {
			expect(Notice).toHaveBeenCalled();
		});
		expect(warnSpy).toHaveBeenCalledWith(
			"[WeaveReader] Failed to rename EPUB annotation version:",
			expect.any(Error),
		);
		expect(epubServiceMocks.notifyEpubAnnotationVersionChanged).not.toHaveBeenCalledWith(
			"epub-book-demo",
			expect.objectContaining({ reason: "rename" }),
		);
	});

	it("deletes a non-default version through the plugin confirmation modal", async () => {
		epubServiceMocks.listEpubAnnotationVersions
			.mockResolvedValueOnce([
				createVersionSummary("default", "\u9ed8\u8ba4\u6807\u6ce8", true),
				createVersionSummary("review", "Review"),
			])
			.mockResolvedValueOnce([
				createVersionSummary("default", "\u9ed8\u8ba4\u6807\u6ce8", true),
			]);
		epubServiceMocks.deleteEpubAnnotationVersion.mockResolvedValue(true);
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		const onVersionChanged = vi.fn();
		const app = createApp();
		const modal = new EpubAnnotationVersionManagerModal(app as never, {
			bookId: "epub-book-demo",
			filePath: "Books/demo.epub",
			bookDataDir: "weave/epub-data/books/epub-book-demo",
			onVersionChanged,
		});

		await (modal as unknown as { render: () => Promise<void> }).render();
		const deleteButton = Array.from(modal.contentEl.querySelectorAll('[data-icon="trash-2"]'))
			.map((icon) => icon.closest("button"))
			.find((button) => button?.textContent?.includes("\u5220\u9664"));
		expect(deleteButton).toBeInstanceOf(HTMLButtonElement);
		await fireEvent.click(deleteButton as HTMLButtonElement);
		expect(document.querySelector(".weave-annotation-version-confirm-modal")).not.toBeNull();
		await fireEvent.click(
			document.querySelector(".weave-annotation-version-confirm-actions .mod-warning") as HTMLButtonElement,
		);

		await waitFor(() => {
			expect(epubServiceMocks.deleteEpubAnnotationVersion).toHaveBeenCalledWith(
				app,
				"epub-book-demo",
				"review",
			);
			expect(epubServiceMocks.notifyEpubAnnotationVersionChanged).toHaveBeenCalledWith(
				"epub-book-demo",
				expect.objectContaining({
					reason: "delete",
					filePath: "Books/demo.epub",
					versionId: "review",
				}),
			);
			expect(onVersionChanged).toHaveBeenCalledTimes(1);
		});
		expect(confirmSpy).not.toHaveBeenCalled();
	});

	it("resets the default version through the delete action instead of hiding the action", async () => {
		epubServiceMocks.listEpubAnnotationVersions
			.mockResolvedValueOnce([
				createVersionSummary("default", "6", true),
			])
			.mockResolvedValueOnce([
				createVersionSummary("default", "\u9ed8\u8ba4\u6807\u6ce8", true),
			]);
		epubServiceMocks.deleteEpubAnnotationVersion.mockResolvedValue(true);
		const app = createApp();
		const modal = new EpubAnnotationVersionManagerModal(app as never, {
			bookId: "epub-book-demo",
			filePath: "Books/demo.epub",
			bookDataDir: "weave/epub-data/books/epub-book-demo",
		});

		await (modal as unknown as { render: () => Promise<void> }).render();
		const resetButton = modal.contentEl.querySelector('[data-icon="trash-2"]')?.closest("button");
		expect(resetButton).toBeInstanceOf(HTMLButtonElement);
		expect(resetButton?.textContent).toContain("\u91cd\u7f6e");
		await fireEvent.click(resetButton as HTMLButtonElement);
		expect(document.querySelector(".weave-annotation-version-confirm-message")?.textContent).toContain(
			"\u91cd\u7f6e\u9ed8\u8ba4\u7248\u672c",
		);
		await fireEvent.click(
			document.querySelector(".weave-annotation-version-confirm-actions .mod-warning") as HTMLButtonElement,
		);

		await waitFor(() => {
			expect(epubServiceMocks.deleteEpubAnnotationVersion).toHaveBeenCalledWith(
				app,
				"epub-book-demo",
				"default",
			);
			expect(epubServiceMocks.notifyEpubAnnotationVersionChanged).toHaveBeenCalledWith(
				"epub-book-demo",
				expect.objectContaining({
					reason: "reset-default",
					filePath: "Books/demo.epub",
					versionId: "default",
				}),
			);
		});
	});

	it("opens the book data directory through Windows Explorer so it can come to the front", async () => {
		epubServiceMocks.listEpubAnnotationVersions.mockResolvedValue([
			createVersionSummary("default", "默认标注", true),
		]);
		const openPath = vi.fn(async () => "");
		const showItemInFolder = vi.fn();
		const execFile = vi.fn((_file: string, _args: string[], _options: unknown, callback?: () => void) => {
			callback?.();
		});
		Object.defineProperty(window, "require", {
			configurable: true,
			value: vi.fn((id: string) => {
				if (id === "child_process") {
					return { execFile };
				}
				if (id === "electron") {
					return { shell: { openPath, showItemInFolder } };
				}
				return null;
			}),
		});
		const app = createApp();
		const modal = new EpubAnnotationVersionManagerModal(app as never, {
			bookId: "epub-book-demo",
			bookDataDir: "weave/epub-data/books/epub-book-demo",
			annotationsPath: "weave/epub-data/books/epub-book-demo/annotations.json",
		});

		await (modal as unknown as { render: () => Promise<void> }).render();
		await fireEvent.click(findButton(modal.contentEl, "打开数据目录"));

		await waitFor(() => {
			expect(execFile).toHaveBeenCalledWith(
				"explorer.exe",
				["/select,D:\\ResOB\\note\\weave\\epub-data\\books\\epub-book-demo\\annotations.json"],
				expect.objectContaining({ windowsHide: false }),
				expect.any(Function),
			);
		});
		expect(openPath).not.toHaveBeenCalled();
		expect(showItemInFolder).not.toHaveBeenCalled();
	});

	it("does not spawn duplicate Explorer windows for repeated clicks on the same data folder", async () => {
		epubServiceMocks.listEpubAnnotationVersions.mockResolvedValue([
			createVersionSummary("default", "榛樿鏍囨敞", true),
		]);
		const execFile = vi.fn((_file: string, _args: string[], _options: unknown, callback?: () => void) => {
			callback?.();
		});
		Object.defineProperty(window, "require", {
			configurable: true,
			value: vi.fn((id: string) => (id === "child_process" ? { execFile } : null)),
		});
		const app = createApp();
		const modal = new EpubAnnotationVersionManagerModal(app as never, {
			bookId: "epub-book-demo",
			bookDataDir: "weave/epub-data/books/epub-book-demo",
			annotationsPath: "weave/epub-data/books/epub-book-demo/annotations.json",
		});

		await (modal as unknown as { render: () => Promise<void> }).render();
		const openButton = findButton(modal.contentEl, "打开数据目录");
		await fireEvent.click(openButton);
		await fireEvent.click(openButton);

		await waitFor(() => {
			expect(execFile).toHaveBeenCalledTimes(1);
		});
	});
});
