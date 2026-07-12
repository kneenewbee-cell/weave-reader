import { domInstanceOf } from "./dom-instance-of";

/**
 * Copy text to the system clipboard via navigator.clipboard.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
	const trimmed = String(text || "").trim();
	if (!trimmed) {
		return false;
	}

	try {
		if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(trimmed);
			return true;
		}
	} catch {
		return false;
	}

	return false;
}

/**
 * Focus an element in the active document by id (settings / modal UI).
 */
export function focusElementById(
	elementId: string,
	options: { preventScroll?: boolean } = {}
): boolean {
	const element = activeDocument.getElementById(elementId);
	if (!element || !domInstanceOf(element, HTMLElement)) {
		return false;
	}

	try {
		element.focus({ preventScroll: options.preventScroll ?? true });
	} catch {
		element.focus();
	}
	return true;
}
