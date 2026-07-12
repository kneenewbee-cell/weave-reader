import { describe, expect, it } from "vitest";
import {
	bookLocateFromPending,
	hasBookLocateTarget,
	pendingLocateFromLegacyState,
} from "../navigation-intent";

describe("navigation-intent locate helpers", () => {
	it("detects when a locate payload targets a book position", () => {
		expect(hasBookLocateTarget(null)).toBe(false);
		expect(hasBookLocateTarget({})).toBe(false);
		expect(hasBookLocateTarget({ cfi: "epubcfi(/6/2)" })).toBe(true);
		expect(hasBookLocateTarget({ href: "chapter1.xhtml" })).toBe(true);
	});

	it("builds book locate intents from pending locate state", () => {
		expect(
			bookLocateFromPending({
				cfi: "epubcfi(/6/2)",
				text: "Hello",
			})
		).toEqual({
			cfi: "epubcfi(/6/2)",
			href: undefined,
			text: "Hello",
			flashStyle: undefined,
			flashColor: undefined,
			showLocateOverlay: undefined,
		});
	});

	it("reads legacy pending CFI fields", () => {
		expect(
			pendingLocateFromLegacyState({
				pendingCfi: "epubcfi(/6/4)",
				pendingText: "World",
			})
		).toEqual({
			cfi: "epubcfi(/6/4)",
			text: "World",
		});
	});
});
