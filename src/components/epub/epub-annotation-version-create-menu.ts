import { setIcon } from "obsidian";
import type { EpubAnnotationVersionSummary } from "../../services/epub/epub-annotation-version-store";

interface CreateVersionMenuActions {
	createBlank: () => void | Promise<void>;
	copyFromVersion: (version: EpubAnnotationVersionSummary) => void | Promise<void>;
}

export interface EpubAnnotationVersionCreateMenuHandle {
	close: () => void;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function appendMenuButton(
	parent: HTMLElement,
	icon: string,
	label: string,
	onClick: (event: MouseEvent) => void | Promise<void>,
	options: {
		className?: string;
		data?: Record<string, string>;
		trailing?: string;
	} = {},
): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = ["weave-annotation-version-recursive-menu__item", options.className || ""]
		.filter(Boolean)
		.join(" ");
	button.setAttribute("role", "menuitem");
	for (const [name, value] of Object.entries(options.data || {})) {
		button.dataset[name] = value;
	}
	const iconEl = document.createElement("span");
	iconEl.className = "weave-annotation-version-recursive-menu__icon";
	setIcon(iconEl, icon);
	button.appendChild(iconEl);
	const labelEl = document.createElement("span");
	labelEl.className = "weave-annotation-version-recursive-menu__label";
	labelEl.textContent = label;
	button.appendChild(labelEl);
	if (options.trailing) {
		const trailingEl = document.createElement("span");
		trailingEl.className = "weave-annotation-version-recursive-menu__trailing";
		trailingEl.textContent = options.trailing;
		button.appendChild(trailingEl);
	}
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		void onClick(event);
	});
	parent.appendChild(button);
	return button;
}

function positionMenu(menu: HTMLElement, x: number, y: number): void {
	const margin = 8;
	const width = menu.offsetWidth || 220;
	const height = menu.offsetHeight || 96;
	menu.style.left = `${clamp(x, margin, Math.max(margin, window.innerWidth - width - margin))}px`;
	menu.style.top = `${clamp(y, margin, Math.max(margin, window.innerHeight - height - margin))}px`;
}

export function openEpubAnnotationVersionCreateMenu(
	anchor: HTMLElement,
	versions: EpubAnnotationVersionSummary[],
	actions: CreateVersionMenuActions,
): EpubAnnotationVersionCreateMenuHandle {
	const rootMenu = document.createElement("div");
	rootMenu.className = "weave-annotation-version-recursive-menu";
	rootMenu.setAttribute("role", "menu");

	const copyMenu = document.createElement("div");
	copyMenu.className = "weave-annotation-version-recursive-menu weave-annotation-version-recursive-menu--submenu";
	copyMenu.setAttribute("role", "menu");
	copyMenu.hidden = true;

	let closed = false;
	function close(): void {
		if (closed) {
			return;
		}
		closed = true;
		rootMenu.remove();
		copyMenu.remove();
		document.removeEventListener("pointerdown", onOutsidePointerDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("resize", close, true);
		window.removeEventListener("scroll", close, true);
	}
	function onOutsidePointerDown(event: PointerEvent): void {
		const target = event.target;
		if (!(target instanceof Node)) {
			close();
			return;
		}
		if (rootMenu.contains(target) || copyMenu.contains(target) || anchor.contains(target)) {
			return;
		}
		close();
	}
	function onKeyDown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			close();
		}
	}
	const showCopyMenu = (trigger: HTMLElement) => {
		copyMenu.replaceChildren();
		if (versions.length === 0) {
			const empty = document.createElement("div");
			empty.className = "weave-annotation-version-recursive-menu__empty";
			empty.textContent = "暂无可复制版本";
			copyMenu.appendChild(empty);
		} else {
			for (const version of versions) {
				appendMenuButton(
					copyMenu,
					version.active ? "check" : "copy",
					`${version.name}${version.active ? "（当前）" : ""}`,
					() => {
						close();
						return actions.copyFromVersion(version);
					},
					{ data: { versionId: version.versionId } },
				);
			}
		}
		copyMenu.hidden = false;
		const triggerRect = trigger.getBoundingClientRect();
		document.body.appendChild(copyMenu);
		const preferredLeft = triggerRect.right + 6;
		const measuredWidth = copyMenu.offsetWidth || 220;
		const left =
			preferredLeft + measuredWidth + 8 > window.innerWidth
				? triggerRect.left - measuredWidth - 6
				: preferredLeft;
		positionMenu(copyMenu, left, triggerRect.top);
	};

	appendMenuButton(rootMenu, "file-plus", "空白版本", () => {
		close();
		return actions.createBlank();
	}, { data: { createMode: "blank" } });

	const copyButton = appendMenuButton(
		rootMenu,
		"copy-plus",
		"从已有版本复制",
		(event) => showCopyMenu(event.currentTarget as HTMLElement),
		{ data: { createMode: "copy" }, trailing: "›" },
	);
	copyButton.addEventListener("pointerenter", () => showCopyMenu(copyButton));

	document.body.appendChild(rootMenu);
	const anchorRect = anchor.getBoundingClientRect();
	positionMenu(rootMenu, anchorRect.left, anchorRect.bottom + 6);
	document.addEventListener("pointerdown", onOutsidePointerDown, true);
	document.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("resize", close, true);
	window.addEventListener("scroll", close, true);
	return { close };
}
