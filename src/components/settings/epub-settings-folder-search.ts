import { Setting } from "obsidian";
import { FolderSuggest } from "../../utils/FolderSuggest";
import type {
	SettingsCleanupFn,
} from "./epub-settings-types";

export function mountFolderSearchSetting(options: {
	setting: Setting;
	placeholder: string;
	value: string;
	onInput: (value: string) => void;
	onCommit: (value: string) => void | Promise<void>;
	onEscape: () => string;
	app: import("obsidian").App;
	cleanupFns: SettingsCleanupFn[];
}): void {
	const { setting, placeholder, value, onInput, onCommit, onEscape, app, cleanupFns } = options;

	setting.addSearch((search) => {
		search.setPlaceholder(placeholder);
		search.setValue(value);
		search.onChange((nextValue) => {
			onInput(nextValue);
		});

		const inputEl = search.inputEl;
		const suggest = new FolderSuggest(app, inputEl);

		const handleFocus = () => {
			inputEl.dispatchEvent(new Event("input", { bubbles: true }));
		};

		const handleBlur = () => {
			void onCommit(inputEl.value);
		};

		const handleKeydown = (event: KeyboardEvent) => {
			if (event.key === "Enter") {
				event.preventDefault();
				void onCommit(inputEl.value);
				return;
			}

			if (event.key === "Escape") {
				const resetValue = onEscape();
				onInput(resetValue);
				search.setValue(resetValue);
				inputEl.blur();
			}
		};

		inputEl.addEventListener("focus", handleFocus);
		inputEl.addEventListener("blur", handleBlur);
		inputEl.addEventListener("keydown", handleKeydown);

		cleanupFns.push(() => inputEl.removeEventListener("focus", handleFocus));
		cleanupFns.push(() => inputEl.removeEventListener("blur", handleBlur));
		cleanupFns.push(() => inputEl.removeEventListener("keydown", handleKeydown));
		cleanupFns.push(() => suggest.close());
	});
}
