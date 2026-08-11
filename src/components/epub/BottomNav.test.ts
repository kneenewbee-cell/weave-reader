import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import BottomNav from "./BottomNav.svelte";

vi.mock("obsidian", async () => {
	return await vi.importActual<typeof import("../../tests/mocks/obsidian")>(
		"../../tests/mocks/obsidian"
	);
});

describe("BottomNav", () => {
	it("prefers a screen page label over legacy current and total text", () => {
		const screenLabel = "\u7b2c 10-11 / 214 \u9875";

		render(BottomNav, {
			props: {
				onPrev: vi.fn(),
				onNext: vi.fn(),
				currentPage: 10,
				totalPages: 214,
				pageLabel: screenLabel,
			},
		});

		expect(screen.getByText(screenLabel)).toBeInTheDocument();
		expect(screen.queryByText("\u7b2c 10 / 214 \u9875")).toBeNull();
	});

	it("uses the screen page label in vertical side navigation", () => {
		const screenLabel = "\u7b2c 10-11 / 214 \u9875";

		render(BottomNav, {
			props: {
				onPrev: vi.fn(),
				onNext: vi.fn(),
				currentPage: 10,
				totalPages: 214,
				pageLabel: screenLabel,
				vertical: true,
			},
		});

		expect(screen.getByText(screenLabel)).toBeInTheDocument();
		expect(screen.queryByText("10")).toBeNull();
		expect(screen.queryByText("214")).toBeNull();
	});

	it("shows pending screen page text without enabling page input", async () => {
		const onJumpToPage = vi.fn();

		render(BottomNav, {
			props: {
				onPrev: vi.fn(),
				onNext: vi.fn(),
				onJumpToPage,
				currentPage: 0,
				totalPages: 0,
				pageLabel: "\u7cbe\u786e\u9875\u7801\u8ba1\u7b97\u4e2d",
			},
		});

		expect(screen.getByText("\u7cbe\u786e\u9875\u7801\u8ba1\u7b97\u4e2d")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "\u7cbe\u786e\u9875\u7801\u8ba1\u7b97\u4e2d" })
		).toBeNull();
		expect(screen.queryByLabelText("\u8df3\u8f6c\u9875\u6570")).toBeNull();
	});
});
