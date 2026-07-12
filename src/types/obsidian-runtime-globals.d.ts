/**
 * Runtime Obsidian DOM / popout globals (1.8+ activeWindow; Node helpers from newer API typings).
 * Keeps community lint typed without raising minAppVersion to 1.13.
 */
export {};

declare module "obsidian" {
	interface PluginSettingTab {
		getSettingDefinitions?(): Array<{
			type: "render";
			render: (containerEl: HTMLElement) => void;
		}>;
	}
}

declare global {
	interface DomElementInfo {
		cls?: string | string[];
		text?: string | DocumentFragment;
		attr?: Record<string, string | number | boolean | null>;
		title?: string;
		parent?: Node;
		value?: string;
		type?: string;
		prepend?: boolean;
		placeholder?: string;
		href?: string;
	}

	interface Node {
		instanceOf<T>(type: new () => T): this is T;
		doc: Document;
		win: Window;
		createEl<K extends keyof HTMLElementTagNameMap>(
			tag: K,
			o?: DomElementInfo | string,
			callback?: (el: HTMLElementTagNameMap[K]) => void
		): HTMLElementTagNameMap[K];
		createDiv(
			o?: DomElementInfo | string,
			callback?: (el: HTMLDivElement) => void
		): HTMLDivElement;
		createSpan(
			o?: DomElementInfo | string,
			callback?: (el: HTMLSpanElement) => void
		): HTMLSpanElement;
	}

	interface UIEvent extends Event {
		instanceOf<T>(type: new (...args: unknown[]) => T): this is T;
		win: Window;
		doc: Document;
	}

	interface Document {
		win: Window;
	}

	interface Window {
		activeWindow: Window;
		activeDocument: Document;
		createEl<K extends keyof HTMLElementTagNameMap>(
			tag: K,
			o?: DomElementInfo | string,
			callback?: (el: HTMLElementTagNameMap[K]) => void
		): HTMLElementTagNameMap[K];
		createDiv(
			o?: DomElementInfo | string,
			callback?: (el: HTMLDivElement) => void
		): HTMLDivElement;
		createSpan(
			o?: DomElementInfo | string,
			callback?: (el: HTMLSpanElement) => void
		): HTMLSpanElement;
	}

	const activeWindow: Window;
	const activeDocument: Document;

	function createEl<K extends keyof HTMLElementTagNameMap>(
		tag: K,
		o?: DomElementInfo | string,
		callback?: (el: HTMLElementTagNameMap[K]) => void
	): HTMLElementTagNameMap[K];

	function createDiv(
		o?: DomElementInfo | string,
		callback?: (el: HTMLDivElement) => void
	): HTMLDivElement;

	function createSpan(
		o?: DomElementInfo | string,
		callback?: (el: HTMLSpanElement) => void
	): HTMLSpanElement;
}
