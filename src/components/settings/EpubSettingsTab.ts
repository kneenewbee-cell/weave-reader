import { App, PluginSettingTab } from "obsidian";
import { mount, unmount, type Component as SvelteComponent } from "svelte";
import type StandaloneEpubPlugin from "../../main";

export class EpubSettingsTab extends PluginSettingTab {
	plugin: StandaloneEpubPlugin;
	private svelteRoot: ReturnType<typeof mount> | null = null;

	constructor(app: App, plugin: StandaloneEpubPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions() {
		return [
			{
				type: "render" as const,
				render: (containerEl: HTMLElement) => {
					void this.renderPanelInto(containerEl);
				},
			},
		];
	}

	display(): void {
		void this.renderPanelInto(this.containerEl);
	}

	hide(): void {
		this.unmountPanel();
		this.containerEl.empty();
	}

	private unmountPanel(): void {
		if (!this.svelteRoot) {
			return;
		}
		void unmount(this.svelteRoot);
		this.svelteRoot = null;
	}

	private async renderPanelInto(containerEl: HTMLElement): Promise<void> {
		this.unmountPanel();

		containerEl.empty();

		const { default: Component } = await import("./EpubSettingsPanel.svelte");
		this.svelteRoot = mount(Component as SvelteComponent, {
			target: containerEl,
			props: {
				plugin: this.plugin,
			},
		});
	}
}
