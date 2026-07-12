import { describe, expect, it } from "vitest";
import {
	DEFAULT_MOBILE_READER_SETTINGS,
	DEFAULT_READER_SETTINGS,
	normalizeEpubReaderSettingsForDevice,
} from "../reader-settings";

describe("normalizeEpubReaderSettingsForDevice", () => {
	it("preserves explicit mobile paginated mode while keeping a single-page layout", () => {
		expect(
			normalizeEpubReaderSettingsForDevice("mobile", {
				lineHeight: 1.82,
				viewportSidePadding: 14,
				widthMode: "full",
				layoutMode: "paginated",
				flowMode: "paginated",
				showScrolledSideNav: false,
				footnoteClickAction: "navigate",
				showTopSticker: false,
				topStickerLayout: "sidebar",
			})
		).toEqual({
			...DEFAULT_MOBILE_READER_SETTINGS,
			lineHeight: 1.82,
			viewportSidePadding: 14,
			widthMode: "full",
			layoutMode: "paginated",
			flowMode: "paginated",
			showScrolledSideNav: false,
			footnoteClickAction: "navigate",
			showTopSticker: false,
			topStickerLayout: "sidebar",
		});
	});

	it("falls back to the device defaults for invalid values", () => {
		expect(
			normalizeEpubReaderSettingsForDevice("mobile", {
				lineHeight: 0,
				viewportSidePadding: Number.NaN,
				widthMode: "wide" as never,
				layoutMode: "double",
				flowMode: "paginated",
				showScrolledSideNav: undefined,
				footnoteClickAction: "noop" as never,
				showTopSticker: "hidden" as never,
				topStickerLayout: "floating" as never,
			})
		).toEqual({
			...DEFAULT_MOBILE_READER_SETTINGS,
			layoutMode: "paginated",
			flowMode: "paginated",
		});
	});

	it("migrates retired container width mode to fit on desktop paginated layout", () => {
		expect(
			normalizeEpubReaderSettingsForDevice("desktop", {
				...DEFAULT_READER_SETTINGS,
				widthMode: "container" as unknown as never,
			})
		).toEqual({
			...DEFAULT_READER_SETTINGS,
			widthMode: "fit",
		});
	});

	it("preserves explicit fit width mode on desktop paginated layout", () => {
		expect(
			normalizeEpubReaderSettingsForDevice("desktop", {
				...DEFAULT_READER_SETTINGS,
				widthMode: "fit",
			})
		).toEqual({
			...DEFAULT_READER_SETTINGS,
			widthMode: "fit",
		});
	});

	it("preserves explicit edge width mode on desktop paginated layout", () => {
		expect(
			normalizeEpubReaderSettingsForDevice("desktop", {
				...DEFAULT_READER_SETTINGS,
				widthMode: "edge",
			})
		).toEqual({
			...DEFAULT_READER_SETTINGS,
			widthMode: "edge",
		});
	});

	it("forces desktop double-page mode to use fit width", () => {
		expect(
			normalizeEpubReaderSettingsForDevice("desktop", {
				...DEFAULT_READER_SETTINGS,
				layoutMode: "double",
				widthMode: "standard",
			})
		).toEqual({
			...DEFAULT_READER_SETTINGS,
			layoutMode: "double",
			widthMode: "fit",
		});
	});
});
