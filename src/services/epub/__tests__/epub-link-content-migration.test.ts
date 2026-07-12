vi.mock("obsidian", () => ({
	App: class MockApp {},
	TFile: class MockTFile {},
	Notice: class MockNotice {
		constructor(_message?: string) {}
	},
	normalizePath: (value: string) => String(value || "").replace(/\\/g, "/"),
}));

const { showObsidianConfirmMock, enrichMock } = vi.hoisted(() => ({
	showObsidianConfirmMock: vi.fn(async () => true),
	enrichMock: vi.fn(async () => ({ content: "migrated", changed: true, updatedLinks: 1 })),
}));

vi.mock("../../../utils/obsidian-confirm", () => ({
	showObsidianConfirm: showObsidianConfirmMock,
}));

vi.mock("../../../utils/i18n", () => ({
	i18n: {
		t: (key: string, vars?: Record<string, unknown>) =>
			`${key}:${JSON.stringify(vars || {})}`,
	},
}));

vi.mock("../EpubLinkService", () => ({
	EpubLinkService: class MockEpubLinkService {
		constructor(_app: unknown) {}
		enrichEpubLinksWithSourceIdsInContent = enrichMock;
		static countLegacyEpubLinkMarkups(content: string) {
			return content.includes("&text=") ? 1 : 0;
		}
	},
}));

import { TFile } from "obsidian";
import {
	maybeMigrateEpubLinksInMarkdownFile,
	resetEpubLinkMigrationPromptStateForTests,
} from "../epub-link-content-migration";

describe("epub-link-content-migration", () => {
	beforeEach(() => {
		resetEpubLinkMigrationPromptStateForTests();
		showObsidianConfirmMock.mockReset();
		enrichMock.mockReset();
		enrichMock.mockResolvedValue({ content: "migrated", changed: true, updatedLinks: 1 });
	});

	it("prompts before migrating legacy epub links", async () => {
		showObsidianConfirmMock.mockResolvedValueOnce(true);
		const process = vi.fn(async (_file: TFile, updater: (content: string) => string) =>
			updater("legacy")
		);
		const app = {
			vault: {
				process,
			},
		};
		const file = new TFile();
		file.path = "Notes/demo.md";
		file.basename = "demo";

		await maybeMigrateEpubLinksInMarkdownFile(
			app as any,
			file,
			"[[Books/demo.epub#weave-cfi=readium:abc&text=Hello|demo]]"
		);

		expect(showObsidianConfirmMock).toHaveBeenCalledTimes(1);
		expect(enrichMock).toHaveBeenCalledTimes(1);
		expect(process).toHaveBeenCalledTimes(1);
	});

	it("skips writing when the user declines legacy migration", async () => {
		showObsidianConfirmMock.mockResolvedValueOnce(false);
		const process = vi.fn();
		const app = { vault: { process } };
		const file = new TFile();
		file.path = "Notes/demo.md";
		file.basename = "demo";

		await maybeMigrateEpubLinksInMarkdownFile(
			app as any,
			file,
			"[[Books/demo.epub#weave-cfi=readium:abc&text=Hello|demo]]"
		);

		expect(showObsidianConfirmMock).toHaveBeenCalledTimes(1);
		expect(enrichMock).not.toHaveBeenCalled();
		expect(process).not.toHaveBeenCalled();
	});

	it("silently backfills source ids when no legacy links remain", async () => {
		const process = vi.fn(async (_file: TFile, updater: (content: string) => string) =>
			updater("current")
		);
		const app = { vault: { process } };
		const file = new TFile();
		file.path = "Notes/demo.md";
		file.basename = "demo";

		await maybeMigrateEpubLinksInMarkdownFile(
			app as any,
			file,
			"[[Books/demo.epub#weave-cfi=readium:abc|demo]]"
		);

		expect(showObsidianConfirmMock).not.toHaveBeenCalled();
		expect(enrichMock).toHaveBeenCalledTimes(1);
		expect(process).toHaveBeenCalledTimes(1);
	});
});
