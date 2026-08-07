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
		render(BottomNav, {
			props: {
				onPrev: vi.fn(),
				onNext: vi.fn(),
				currentPage: 10,
				totalPages: 214,
				pageLabel: "第 10-11 / 214 页",
			},
		});

		expect(screen.getByText("第 10-11 / 214 页")).toBeInTheDocument();
		expect(screen.queryByText("第 10 / 214 页")).toBeNull();
	});
});
