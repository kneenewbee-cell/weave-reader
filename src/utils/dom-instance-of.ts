/**
 * Cross-window DOM type checks (Obsidian popout windows and EPUB/XML iframes).
 * Use Obsidian's Element#instanceOf when it is a real function; otherwise fall back
 * to native instanceof (EPUB chapter documents, tests, and partial host patches).
 */
export function domInstanceOf<T>(value: unknown, type: { new (): T }): value is T {
	if (value !== null && typeof value === "object" && "instanceOf" in value) {
		const checker = (value as { instanceOf?: (ctor: { new (): T }) => boolean }).instanceOf;
		if (typeof checker === "function") {
			return checker.call(value, type);
		}
	}
	return value instanceof type;
}
