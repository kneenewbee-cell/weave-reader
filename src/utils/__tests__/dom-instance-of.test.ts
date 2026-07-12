import { describe, expect, it } from "vitest";
import { domInstanceOf } from "../dom-instance-of";

describe("domInstanceOf", () => {
	it("uses native instanceof when instanceOf is missing", () => {
		const element = document.createElement("div");
		expect(domInstanceOf(element, HTMLElement)).toBe(true);
		expect(domInstanceOf(element, HTMLAnchorElement)).toBe(false);
	});

	it("falls back to instanceof when instanceOf is not callable", () => {
		const element = document.createElement("span");
		Object.defineProperty(element, "instanceOf", {
			value: "not-a-function",
			configurable: true,
		});
		expect(domInstanceOf(element, HTMLElement)).toBe(true);
	});

	it("uses Element#instanceOf when provided by the host", () => {
		const element = document.createElement("p");
		const spy = vi.fn(() => true);
		Object.defineProperty(element, "instanceOf", {
			value: spy,
			configurable: true,
		});
		expect(domInstanceOf(element, HTMLElement)).toBe(true);
		expect(spy).toHaveBeenCalledWith(HTMLElement);
	});
});
