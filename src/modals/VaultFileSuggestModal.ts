import { App, FuzzySuggestModal, TFile, type FuzzyMatch } from "obsidian";
import {
	buildVaultFileSearchText,
	getVaultFileDisplayName,
	getVaultFileFolderNote,
	renderComplexSuggestion,
} from "./weaveComplexSuggestion";
import { ensureWeaveSuggestModalTheme, markLatestSuggestionContainer } from "./weaveSuggestModalTheme";

interface AnchorRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

interface VaultFileSuggestModalOptions {
	placeholder?: string;
	files?: TFile[];
	filter?: (file: TFile) => boolean;
	allowEmptySelection?: boolean;
	emptySelectionLabel?: string;
	emptySelectionDescription?: string;
	anchorRect?: AnchorRect;
	preferredWidth?: number;
	icon?: string;
	showFileIcon?: boolean;
	showFilePath?: boolean;
}

type VaultFileSuggestItem =
	| {
			kind: "file";
			file: TFile;
	  }
	| {
			kind: "empty";
			label: string;
			description?: string;
	  };

export type VaultFileSelectionResult =
	| { status: "cancelled" }
	| { status: "cleared" }
	| { status: "selected"; file: TFile };

export class VaultFileSuggestModal extends FuzzySuggestModal<VaultFileSuggestItem> {
	private readonly items: VaultFileSuggestItem[];
	private readonly anchorRect: AnchorRect | null;
	private readonly preferredWidth: number | null;
	private readonly icon: string;
	private readonly showFileIcon: boolean;
	private readonly showFilePath: boolean;
	private resolver: ((result: VaultFileSelectionResult) => void) | null = null;
	private selectedFile: TFile | null = null;
	private clearedSelection = false;
	private settled = false;
	private closeTimer: number | null = null;

	constructor(app: App, options: VaultFileSuggestModalOptions = {}) {
		super(app);
		this.anchorRect = options.anchorRect ?? null;
		this.preferredWidth = options.preferredWidth ?? null;
		this.icon = options.icon ?? "file";
		this.showFileIcon = options.showFileIcon ?? true;
		this.showFilePath = options.showFilePath ?? true;

		const files = (options.files ?? app.vault.getFiles()).filter((file) =>
			options.filter ? options.filter(file) : true
		);

		this.items = [
			...(options.allowEmptySelection
				? [
						{
							kind: "empty" as const,
							label: options.emptySelectionLabel ?? "清空当前选择",
							description: options.emptySelectionDescription ?? "不使用文件",
						},
				  ]
				: []),
			...files.map((file) => ({ kind: "file" as const, file })),
		];

		this.setPlaceholder(options.placeholder ?? "选择文件...");
	}

	onOpen(): void {
		void super.onOpen();
		ensureWeaveSuggestModalTheme();
		markLatestSuggestionContainer("weave-markdown-file-suggest-popover", {
			scopeEl: this.containerEl,
		});
		this.positionNearAnchor();
	}

	getItems(): VaultFileSuggestItem[] {
		return this.items;
	}

	getItemText(item: VaultFileSuggestItem): string {
		if (item.kind === "empty") {
			return `${item.label} ${item.description || ""}`.trim();
		}

		return buildVaultFileSearchText(item.file);
	}

	renderSuggestion(match: FuzzyMatch<VaultFileSuggestItem>, el: HTMLElement): void {
		const item = match.item;

		if (item.kind === "empty") {
			renderComplexSuggestion(el, {
				title: item.label,
				note: item.description,
				icon: "rotate-ccw",
			});
			return;
		}

		renderComplexSuggestion(el, {
			title: this.getDisplayName(item.file),
			note: this.showFilePath ? getVaultFileFolderNote(item.file.path) : undefined,
			icon: this.icon,
			showIcon: this.showFileIcon,
		});
	}

	private settle(result: VaultFileSelectionResult): void {
		if (this.settled) {
			return;
		}

		this.settled = true;
		if (this.closeTimer !== null) {
			window.clearTimeout(this.closeTimer);
			this.closeTimer = null;
		}

		const resolver = this.resolver;
		this.resolver = null;
		resolver?.(result);
	}

	onChooseItem(item: VaultFileSuggestItem): void {
		if (item.kind === "empty") {
			this.clearedSelection = true;
			this.selectedFile = null;
			this.settle({ status: "cleared" });
			return;
		}

		this.selectedFile = item.file;
		this.settle({ status: "selected", file: item.file });
	}

	onClose(): void {
		super.onClose();
		if (this.settled) {
			this.selectedFile = null;
			return;
		}

		if (this.closeTimer !== null) {
			window.clearTimeout(this.closeTimer);
		}

		this.closeTimer = window.setTimeout(() => {
			this.closeTimer = null;
			if (this.clearedSelection) {
				this.clearedSelection = false;
				this.selectedFile = null;
				this.settle({ status: "cleared" });
				return;
			}

			const selectedFile = this.selectedFile;
			this.selectedFile = null;
			if (selectedFile) {
				this.settle({ status: "selected", file: selectedFile });
				return;
			}

			this.settle({ status: "cancelled" });
		}, 0);
	}

	openAndSelect(): Promise<TFile | null> {
		return this.openAndGetSelection().then((result) => {
			if (result.status === "selected") {
				return result.file;
			}
			return null;
		});
	}

	openAndGetSelection(): Promise<VaultFileSelectionResult> {
		return new Promise((resolve) => {
			if (this.closeTimer !== null) {
				window.clearTimeout(this.closeTimer);
				this.closeTimer = null;
			}
			this.resolver = resolve;
			this.selectedFile = null;
			this.clearedSelection = false;
			this.settled = false;
			this.open();
		});
	}

	private getDisplayName(file: TFile): string {
		return getVaultFileDisplayName(file);
	}

	private positionNearAnchor(): void {
		if (!this.anchorRect || typeof window === "undefined") {
			return;
		}

		const anchorRect = this.anchorRect;
		const place = () => {
			const modalEl = this.modalEl;
			const containerEl = this.containerEl;
			if (!modalEl || !containerEl) {
				return;
			}

			const viewportWidth = window.innerWidth;
			const viewportHeight = window.innerHeight;
			const spacing = 8;
			const preferredWidth = Math.min(this.preferredWidth ?? 520, viewportWidth - 24);
			const maxHeight = Math.max(220, viewportHeight - anchorRect.bottom - spacing - 12);

			containerEl.classList.add("weave-suggest-modal-container--anchored");
			modalEl.classList.add("weave-suggest-modal--anchored");
			containerEl.setCssProps({
				"--weave-suggest-popover-z": "calc(var(--z-index-modal, 400) + 10)",
				"--weave-suggest-popover-max-height": `${Math.round(maxHeight)}px`,
			});
			modalEl.setCssProps({
				"--weave-suggest-popover-width": `${preferredWidth}px`,
				"--weave-suggest-popover-z": "calc(var(--z-index-modal, 400) + 10)",
				"--weave-suggest-popover-max-height": `${Math.round(maxHeight)}px`,
			});

			const modalRect = modalEl.getBoundingClientRect();
			const left = Math.max(12, Math.min(anchorRect.left, viewportWidth - modalRect.width - 12));
			const top = Math.min(anchorRect.bottom + spacing, viewportHeight - 12);

			modalEl.setCssProps({
				"--weave-suggest-popover-left": `${Math.round(left)}px`,
				"--weave-suggest-popover-top": `${Math.round(top)}px`,
			});
		};

		window.requestAnimationFrame(place);
	}
}
