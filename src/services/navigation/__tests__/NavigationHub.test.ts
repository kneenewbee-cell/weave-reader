vi.mock("obsidian", () => ({
	App: class MockApp {},
	WorkspaceLeaf: class MockWorkspaceLeaf {},
	normalizePath: (value: string) =>
		String(value || "")
			.replace(/\\/g, "/")
			.replace(/\/+/g, "/")
			.replace(/\/$/, ""),
}));

const {
	openBookForSourceNavigationMock,
	openEpubInPreferredLeafMock,
	ensureEpubFileAccessMock,
	ensureBookSourceLocationAccessMock,
	resolveSourceFilePathMock,
} = vi.hoisted(() => ({
	openBookForSourceNavigationMock: vi.fn(),
	openEpubInPreferredLeafMock: vi.fn(),
	ensureEpubFileAccessMock: vi.fn(() => true),
	ensureBookSourceLocationAccessMock: vi.fn(() => true),
	resolveSourceFilePathMock: vi.fn(async () => "Books/demo.epub"),
}));

vi.mock("../../../utils/epub-leaf-utils", () => ({
	openBookForSourceNavigation: openBookForSourceNavigationMock,
	openEpubInPreferredLeaf: openEpubInPreferredLeafMock,
}));

vi.mock("../../epub/epub-premium", () => ({
	ensureEpubFileAccess: ensureEpubFileAccessMock,
	ensureBookSourceLocationAccess: ensureBookSourceLocationAccessMock,
}));

vi.mock("../../epub/epub-storage-access", () => ({
	getEpubStorageService: () => ({
		resolveSourceFilePath: resolveSourceFilePathMock,
	}),
}));

vi.mock("../../epub/epub-vault-path", () => ({
	resolveEpubVaultPath: (_app: unknown, path: string) => path,
}));

vi.mock("../../../utils/i18n", () => ({
	i18n: { t: (key: string) => key },
}));

import { NavigationHub } from "../NavigationHub";

describe("NavigationHub", () => {
	const app = { vault: { getAbstractFileByPath: () => null } } as any;

	beforeEach(() => {
		openBookForSourceNavigationMock.mockReset();
		openEpubInPreferredLeafMock.mockReset();
		openBookForSourceNavigationMock.mockResolvedValue({ id: "leaf-source" });
		openEpubInPreferredLeafMock.mockResolvedValue({ id: "leaf-preferred" });
		ensureBookSourceLocationAccessMock.mockReturnValue(true);
		resolveSourceFilePathMock.mockResolvedValue("Books/demo.epub");
	});

	it("reuses preferred reader leaves when reuseLeaf policy is set", async () => {
		const hub = new NavigationHub(app);
		const result = await hub.navigate({
			kind: "book",
			resourcePath: "Books/demo.epub",
			locate: { cfi: "epubcfi(/6/2)", text: "Hello" },
			policy: { reuseLeaf: true, focus: true },
		});

		expect(result.success).toBe(true);
		expect(openEpubInPreferredLeafMock).toHaveBeenCalledWith(
			app,
			"Books/demo.epub",
			expect.objectContaining({
				filePath: "Books/demo.epub",
				pendingLocate: { cfi: "epubcfi(/6/2)", text: "Hello" },
				pendingCfi: "epubcfi(/6/2)",
				pendingText: "Hello",
			})
		);
		expect(openBookForSourceNavigationMock).not.toHaveBeenCalled();
	});

	it("uses preferred leaf policy for bookshelf-style opens", async () => {
		const hub = new NavigationHub(app);
		await hub.navigate({
			kind: "book",
			resourcePath: "Books/demo.epub",
			policy: { preferredLeaf: true, focus: true },
		});

		expect(openEpubInPreferredLeafMock).toHaveBeenCalledWith(
			app,
			"Books/demo.epub",
			expect.objectContaining({ filePath: "Books/demo.epub" })
		);
		expect(openBookForSourceNavigationMock).not.toHaveBeenCalled();
	});

	it("blocks located book navigation when premium source location is unavailable", async () => {
		ensureBookSourceLocationAccessMock.mockReturnValueOnce(false);
		const hub = new NavigationHub(app);
		const result = await hub.navigate({
			kind: "book",
			resourcePath: "Books/demo.epub",
			locate: { cfi: "epubcfi(/6/2)", text: "Hello" },
		});

		expect(result.success).toBe(false);
		expect(openBookForSourceNavigationMock).not.toHaveBeenCalled();
	});

	it("blocks located navigation for non-epub supported formats without a license", async () => {
		ensureBookSourceLocationAccessMock.mockReturnValueOnce(false);
		resolveSourceFilePathMock.mockResolvedValueOnce("Books/demo.cbz");
		const hub = new NavigationHub(app);
		const result = await hub.navigate({
			kind: "book",
			resourcePath: "Books/demo.cbz",
			locate: { cfi: "epubcfi(/6/2)", text: "Page 3" },
		});

		expect(result.success).toBe(false);
		expect(openBookForSourceNavigationMock).not.toHaveBeenCalled();
	});

	it("allows opening a book without a locate target when source location is unavailable", async () => {
		ensureBookSourceLocationAccessMock.mockReturnValue(false);
		const hub = new NavigationHub(app);
		const result = await hub.navigate({
			kind: "book",
			resourcePath: "Books/demo.mobi",
			policy: { preferredLeaf: true, focus: true },
		});

		expect(result.success).toBe(true);
		expect(openEpubInPreferredLeafMock).toHaveBeenCalled();
	});
});
