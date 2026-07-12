import { describe, expect, it } from "vitest";
import {
	canHandleEpubPagedNavigation,
	isEventWithinElement,
	isInteractiveFormTarget,
	shouldIgnoreEpubReaderShortcut,
} from "../epub-reader-keyboard-guards";

describe("epub-reader-keyboard-guards", () => {
	it("detects interactive form targets", () => {
		const textarea = document.createElement("textarea");
		document.body.appendChild(textarea);
		expect(isInteractiveFormTarget(textarea)).toBe(true);
		textarea.remove();

		const button = document.createElement("button");
		document.body.appendChild(button);
		expect(isInteractiveFormTarget(button)).toBe(false);
		button.remove();
	});

	it("scopes events to a container element", () => {
		const root = document.createElement("div");
		const child = document.createElement("span");
		root.appendChild(child);
		document.body.appendChild(root);

		expect(isEventWithinElement({ target: child } as Event, root)).toBe(true);
		expect(isEventWithinElement({ target: document.body } as Event, root)).toBe(false);
		root.remove();
	});

	it("gates paged navigation by reader context", () => {
		expect(
			canHandleEpubPagedNavigation({
				hasOpenBook: true,
				flowMode: "paginated",
				paragraphModeEnabled: false,
				screenshotModeActive: false,
			})
		).toBe(true);

		expect(
			canHandleEpubPagedNavigation({
				hasOpenBook: true,
				flowMode: "scrolled",
				paragraphModeEnabled: false,
				screenshotModeActive: false,
			})
		).toBe(false);

		expect(
			canHandleEpubPagedNavigation({
				hasOpenBook: true,
				flowMode: "paginated",
				paragraphModeEnabled: true,
				screenshotModeActive: false,
			})
		).toBe(false);
	});

	it("ignores shortcuts while composing or on form controls", () => {
		const textarea = document.createElement("textarea");
		document.body.appendChild(textarea);
		const event = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true });
		Object.defineProperty(event, "target", { value: textarea });

		expect(shouldIgnoreEpubReaderShortcut(event)).toBe(true);
		textarea.remove();
	});
});
