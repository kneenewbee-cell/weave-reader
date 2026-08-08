import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import TableOfContents from "./TableOfContents.svelte";

vi.mock("obsidian", async () => {
	return await vi.importActual<typeof import("../../tests/mocks/obsidian")>(
		"../../tests/mocks/obsidian"
	);
});

describe("TableOfContents", () => {
	it("uses the current bottom-nav page for the active toc item", () => {
		render(TableOfContents, {
			props: {
				items: [
					{
						id: "chapter",
						label: "Chapter",
						href: "chapter.xhtml",
						level: 1,
						screenPageNumber: 1,
						subitems: [
							{
								id: "current",
								label: "Current section",
								href: "chapter.xhtml#current",
								level: 2,
								screenPageNumber: 84,
							},
						],
					},
				],
				activeHref: "chapter.xhtml#current",
				activePageNumber: 104,
				autoScrollToActive: false,
				onNavigate: vi.fn(),
			},
		});

		expect(screen.getByText("104")).toBeInTheDocument();
		expect(screen.queryByText("84")).toBeNull();
	});

	it("keeps estimated page numbers for non-active toc items", () => {
		const { container } = render(TableOfContents, {
			props: {
				items: [
					{
						id: "chapter",
						label: "Chapter",
						href: "chapter.xhtml",
						level: 1,
						screenPageNumber: 1,
						subitems: [
							{
								id: "current",
								label: "Current section",
								href: "chapter.xhtml#current",
								level: 2,
								screenPageNumber: 84,
							},
							{
								id: "next",
								label: "Next section",
								href: "chapter.xhtml#next",
								level: 2,
								screenPageNumber: 130,
							},
						],
					},
				],
				activeHref: "chapter.xhtml#current",
				activePageNumber: 104,
				autoScrollToActive: false,
				onNavigate: vi.fn(),
			},
		});

		const pages = Array.from(container.querySelectorAll(".toc-page")).map((element) =>
			element.textContent?.trim()
		);
		expect(pages).toEqual(["1", "104", "130"]);
	});
});
