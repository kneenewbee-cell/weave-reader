vi.mock('obsidian', () => ({
	App: class MockApp {},
	TFile: class MockTFile {},
	ItemView: class MockItemView {},
	WorkspaceLeaf: class MockWorkspaceLeaf {},
	normalizePath: (value: string) =>
		String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, ''),
}));

vi.mock('../../../views/EpubView', () => ({
	VIEW_TYPE_EPUB: 'weave-epub-reader',
}));

vi.mock('../../../stores/epub-active-document-store', () => ({
	epubActiveDocumentStore: {
		getActiveDocument: () => '',
	},
}));

vi.mock('../epub-storage-access', () => ({
	getEpubStorageService: vi.fn(),
}));

const { resolveSupportedBookFilePathMock, epubVaultPathsReferToSameBookMock } = vi.hoisted(() => ({
	resolveSupportedBookFilePathMock: vi.fn(),
	epubVaultPathsReferToSameBookMock: vi.fn(),
}));

vi.mock('../epub-vault-path', () => ({
	resolveSupportedBookFilePath: resolveSupportedBookFilePathMock,
	epubVaultPathsReferToSameBook: epubVaultPathsReferToSameBookMock,
}));

import {
	findOpenEpubLeaf,
	openBookForSourceNavigation,
	pathsReferToSameOpenBook,
} from '../../../utils/epub-leaf-utils';

const VIEW_TYPE_EPUB = 'weave-epub-reader';

describe('epub-leaf-utils source navigation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		epubVaultPathsReferToSameBookMock.mockImplementation(
			(left: string, right: string) => left === right
		);
	});

	it('matches open reader leaves by canonical book path', () => {
		resolveSupportedBookFilePathMock.mockReturnValue('Books/demo.mobi');
		const openLeaf = {
			view: {
				getCurrentFilePath: () => 'Books/demo.mobi',
			},
		};
		const app = {
			workspace: {
				getLeavesOfType: vi.fn(() => [openLeaf]),
			},
			viewRegistry: {
				typeByExtension: {
					get: vi.fn(() => VIEW_TYPE_EPUB),
				},
			},
		} as any;

		expect(findOpenEpubLeaf(app, '附件/demo.mobi')).toBe(openLeaf);
		expect(pathsReferToSameOpenBook('Books/demo.mobi', 'Books/demo.mobi')).toBe(true);
	});

	it('reuses an existing reader leaf when navigating from a note', async () => {
		resolveSupportedBookFilePathMock.mockReturnValue('Books/demo.mobi');
		const existingLeaf = {
			setViewState: vi.fn(async () => undefined),
		};
		const newTabLeaf = {
			setViewState: vi.fn(async () => undefined),
		};
		const app = {
			workspace: {
				getLeavesOfType: vi.fn(() => [existingLeaf]),
				getLeaf: vi.fn(() => newTabLeaf),
				setActiveLeaf: vi.fn(),
				revealLeaf: vi.fn(),
			},
			viewRegistry: {
				typeByExtension: {
					get: vi.fn(() => VIEW_TYPE_EPUB),
				},
			},
		} as any;
		(existingLeaf as any).view = {
			getCurrentFilePath: () => 'Books/demo.mobi',
		};

		const result = await openBookForSourceNavigation(app, 'Books/demo.mobi', {
			pendingCfi: 'epubcfi(/6/2)',
			pendingText: 'Quote',
		});

		expect(result).toBe(existingLeaf);
		expect(app.workspace.getLeaf).not.toHaveBeenCalled();
		expect(existingLeaf.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE_EPUB,
			active: true,
			state: {
				filePath: 'Books/demo.mobi',
				pendingCfi: 'epubcfi(/6/2)',
				pendingText: 'Quote',
			},
		});
	});

	it('opens source navigation in a new tab when the book is not already open', async () => {
		resolveSupportedBookFilePathMock.mockReturnValue('Books/new.mobi');
		const newTabLeaf = {
			setViewState: vi.fn(async () => undefined),
		};
		const app = {
			workspace: {
				getLeavesOfType: vi.fn(() => []),
				getLeaf: vi.fn(() => newTabLeaf),
				setActiveLeaf: vi.fn(),
				revealLeaf: vi.fn(),
			},
			viewRegistry: {
				typeByExtension: {
					get: vi.fn(() => VIEW_TYPE_EPUB),
				},
			},
		} as any;

		const result = await openBookForSourceNavigation(app, 'Books/new.mobi', {
			pendingCfi: 'epubcfi(/6/4)',
		});

		expect(result).toBe(newTabLeaf);
		expect(app.workspace.getLeaf).toHaveBeenCalledWith('tab');
		expect(newTabLeaf.setViewState).toHaveBeenCalled();
	});
});
