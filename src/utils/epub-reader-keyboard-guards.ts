import { domInstanceOf } from "./dom-instance-of";

const INTERACTIVE_INPUT_TYPES = new Set([
	"text",
	"search",
	"email",
	"password",
	"url",
	"tel",
	"number",
	"date",
	"datetime-local",
	"month",
	"week",
	"time",
	"range",
	"color",
]);

/**
 * True when the event target is an editable or arrow-consuming form control.
 */
export function isInteractiveFormTarget(target: EventTarget | null): boolean {
	if (!domInstanceOf(target, HTMLElement)) {
		return false;
	}

	const control = target.closest("input, textarea, select, [contenteditable='true']");
	if (!control) {
		return false;
	}

	if (domInstanceOf(control, HTMLInputElement)) {
		const type = (control.type || "text").toLowerCase();
		if (type === "button" || type === "submit" || type === "reset" || type === "checkbox" || type === "radio") {
			return false;
		}
		return INTERACTIVE_INPUT_TYPES.has(type) || type === "";
	}

	return true;
}

export function isEventWithinElement(event: Event, element: HTMLElement | null | undefined): boolean {
	if (!element) {
		return false;
	}
	const target = event.target;
	if (!domInstanceOf(target, Node)) {
		return false;
	}
	return element === target || element.contains(target);
}

export type EpubPagedNavigationContext = {
	hasOpenBook: boolean;
	flowMode: "paginated" | "scrolled";
	paragraphModeEnabled: boolean;
	screenshotModeActive: boolean;
};

export function canHandleEpubPagedNavigation(ctx: EpubPagedNavigationContext): boolean {
	return (
		ctx.hasOpenBook &&
		ctx.flowMode === "paginated" &&
		!ctx.paragraphModeEnabled &&
		!ctx.screenshotModeActive
	);
}

export function shouldIgnoreEpubReaderShortcut(
	event: KeyboardEvent,
	options?: { allowInteractiveTargets?: boolean }
): boolean {
	if (event.defaultPrevented) {
		return true;
	}
	if (event.isComposing) {
		return true;
	}
	if (options?.allowInteractiveTargets) {
		return false;
	}
	return isInteractiveFormTarget(event.target);
}
