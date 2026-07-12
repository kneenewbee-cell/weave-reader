import { setIcon } from "obsidian";

export function obsidianIcon(node: HTMLElement, name: string) {
	setIcon(node, name);
	return {
		update(newName: string) {
			node.replaceChildren();
			setIcon(node, newName);
		},
	};
}
