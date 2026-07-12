import { App, Modal } from "obsidian";

export type EpubBookRenameModalOptions = {
	title: string;
	label: string;
	placeholder: string;
	hint?: string;
	confirmLabel: string;
	cancelLabel: string;
	initialTitle: string;
};

export class EpubBookRenameModal extends Modal {
	private readonly options: EpubBookRenameModalOptions;
	private nextTitle = "";
	private confirmed = false;
	private resolver: ((value: string | null) => void) | null = null;
	private confirmButton: HTMLButtonElement | null = null;
	private titleInput: HTMLInputElement | null = null;

	constructor(app: App, options: EpubBookRenameModalOptions) {
		super(app);
		this.options = options;
		this.nextTitle = options.initialTitle;
	}

	openAndWait(): Promise<string | null> {
		return new Promise((resolve) => {
			this.resolver = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.modalEl.addClass("weave-epub-book-rename-modal");
		this.titleEl.setText(this.options.title);
		this.contentEl.empty();

		const shell = this.contentEl.createDiv({ cls: "weave-epub-book-rename-shell" });
		const field = shell.createDiv({ cls: "weave-epub-book-rename-field" });
		field.createDiv({ cls: "weave-epub-book-rename-label", text: this.options.label });

		this.titleInput = field.createEl("input", {
			cls: "weave-epub-book-rename-input",
			type: "text",
			attr: {
				placeholder: this.options.placeholder,
				spellcheck: "false",
			},
		});
		this.titleInput.value = this.options.initialTitle;
		this.titleInput.addEventListener("input", () => {
			this.nextTitle = this.titleInput?.value ?? "";
			this.syncConfirmState();
		});
		this.titleInput.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				this.tryConfirm();
			}
		});

		const hint = this.options.hint?.trim();
		if (hint) {
			shell.createDiv({ cls: "weave-epub-book-rename-hint", text: hint });
		}

		const actions = shell.createDiv({ cls: "weave-epub-book-rename-actions" });
		const cancelButton = actions.createEl("button", { text: this.options.cancelLabel });
		cancelButton.addEventListener("click", () => this.close());

		this.confirmButton = actions.createEl("button", {
			cls: "mod-cta",
			text: this.options.confirmLabel,
		});
		this.confirmButton.addEventListener("click", () => this.tryConfirm());

		this.syncConfirmState();
		window.setTimeout(() => {
			this.titleInput?.focus();
			this.titleInput?.select();
		}, 0);
	}

	onClose(): void {
		this.modalEl.removeClass("weave-epub-book-rename-modal");
		this.contentEl.empty();
		const trimmed = this.nextTitle.trim();
		this.resolver?.(this.confirmed && trimmed ? trimmed : null);
		this.resolver = null;
		this.confirmButton = null;
		this.titleInput = null;
	}

	private syncConfirmState(): void {
		if (!this.confirmButton) {
			return;
		}
		const trimmed = this.nextTitle.trim();
		const unchanged = trimmed === this.options.initialTitle.trim();
		this.confirmButton.disabled = !trimmed || unchanged;
	}

	private tryConfirm(): void {
		const trimmed = this.nextTitle.trim();
		if (!trimmed || trimmed === this.options.initialTitle.trim()) {
			return;
		}
		this.confirmed = true;
		this.close();
	}
}
