import { AbstractInputSuggest, App, TFile } from "obsidian";
import { resolveSuggestionContainerForAnchor } from "./suggestion-container-scope";

export const WEAVE_VAULT_FILE_SEARCH_ROOT_CLASS = "weave-vault-file-search";
export const WEAVE_VAULT_FILE_SUGGEST_CONTAINER_CLASS = "weave-vault-file-suggest-container";
export const WEAVE_VAULT_FILE_SUGGEST_ITEM_CLASS = "weave-vault-file-suggest-item";

export interface VaultMarkdownFileSuggestOptions {
	filter?: (file: TFile) => boolean;
	onSelectFile: (file: TFile) => void;
	limit?: number;
}

const DEFAULT_SUGGESTION_LIMIT = 80;

export class VaultMarkdownFileSuggest extends AbstractInputSuggest<TFile> {
	private readonly inputElement: HTMLInputElement;
	private readonly options: VaultMarkdownFileSuggestOptions;
	private readonly limit: number;
	private filter?: (file: TFile) => boolean;
	private readonly handleLayoutSync = (): void => {
		this.syncSuggestionContainerLayout();
	};

	constructor(app: App, inputEl: HTMLInputElement, options: VaultMarkdownFileSuggestOptions) {
		super(app, inputEl);
		this.inputElement = inputEl;
		this.options = options;
		this.filter = options.filter;
		this.limit =
			typeof options.limit === "number" && Number.isFinite(options.limit)
				? Math.max(1, Math.floor(options.limit))
				: DEFAULT_SUGGESTION_LIMIT;
		this.inputElement.addEventListener("input", this.handleLayoutSync);
		this.inputElement.addEventListener("focus", this.handleLayoutSync);
	}

	updateFilter(filter?: (file: TFile) => boolean): void {
		this.filter = filter;
	}

	destroy(): void {
		this.inputElement.removeEventListener("input", this.handleLayoutSync);
		this.inputElement.removeEventListener("focus", this.handleLayoutSync);
		this.close();
	}

	getSuggestions(inputStr: string): TFile[] {
		const query = String(inputStr || "").trim().toLowerCase();
		const files = this.getCandidateFiles();
		const filtered = query
			? files.filter(
					(file) =>
						file.basename.toLowerCase().includes(query) ||
						file.path.toLowerCase().includes(query)
			  )
			: files;

		const suggestions = filtered
			.sort((left, right) => left.basename.localeCompare(right.basename, "zh-CN"))
			.slice(0, this.limit);
		this.syncSuggestionContainerLayout();
		return suggestions;
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.empty();
		el.addClass(WEAVE_VAULT_FILE_SUGGEST_ITEM_CLASS);
		el.createDiv({
			cls: "weave-vault-file-suggest-item__label",
			text: file.basename,
		});
	}

	selectSuggestion(file: TFile): void {
		this.inputElement.value = file.basename;
		this.options.onSelectFile(file);
		this.close();
	}

	private getCandidateFiles(): TFile[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => (this.filter ? this.filter(file) : true));
	}

	private syncSuggestionContainerLayout(): void {
		if (typeof document === "undefined") {
			return;
		}

		window.requestAnimationFrame(() => {
			const anchor =
				this.inputElement.closest(`.${WEAVE_VAULT_FILE_SEARCH_ROOT_CLASS}`) ?? this.inputElement;
			const container = resolveSuggestionContainerForAnchor(anchor);
			if (!container) {
				return;
			}

			const rect = anchor.getBoundingClientRect();
			const width = Math.max(Math.round(rect.width), 0);
			container.style.width = `${width}px`;
			container.style.minWidth = `${width}px`;
			container.style.maxWidth = `${width}px`;
			container.style.left = `${Math.round(rect.left)}px`;
			container.classList.add(WEAVE_VAULT_FILE_SUGGEST_CONTAINER_CLASS);
		});
	}
}

export function getVaultFileBasename(filePath: string | null | undefined): string {
	const normalized = String(filePath || "").trim();
	if (!normalized) {
		return "";
	}
	const segments = normalized.split("/").filter(Boolean);
	return segments[segments.length - 1] || normalized;
}
