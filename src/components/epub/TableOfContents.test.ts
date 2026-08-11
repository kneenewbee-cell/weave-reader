import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import TableOfContents from "./TableOfContents.svelte";

vi.mock("obsidian", async () => {
	return await vi.importActual<typeof import("../../tests/mocks/obsidian")>(
		"../../tests/mocks/obsidian"
	);
});

describe("TableOfContents", () => {
	it("hides item and active page numbers by default", () => {
		render(TableOfContents, {
			props: {
				items: [
					{
						id: "chapter-11",
						label: "第十一章",
						href: "chapter-11.xhtml",
						level: 1,
						pageNumber: 119,
						screenPageNumber: 119,
					},
				],
				activeHref: "chapter-11.xhtml",
				autoScrollToActive: false,
				onNavigate: vi.fn(),
			},
		});

		expect(screen.getByText("第十一章")).toBeInTheDocument();
		expect(screen.queryByText("119")).toBeNull();
	});
});
