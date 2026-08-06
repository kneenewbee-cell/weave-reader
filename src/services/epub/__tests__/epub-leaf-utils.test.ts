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

vi.mock('../../../views/PdfView', () => ({
	VIEW_TYPE_PDF: 'weave-pdf-reader',
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
	resolveRegisteredEpubViewType,
} from '../../../utils/epub-leaf-utils';

const VIEW_TYPE_EPUB = 'weave-epub-reader';
const VIEW_TYPE_PDF = 'weave-pdf-reader';

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

	it('directly locates an already mounted reader leaf without resetting view state', async () => {
		resolveSupportedBookFilePathMock.mockReturnValue('Books/demo.mobi');
		const navigateToBookLocate = vi.fn(() => true);
		const existingLeaf = {
			setViewState: vi.fn(async () => undefined),
			view: {
				getCurrentFilePath: () => 'Books/demo.mobi',
				navigateToBookLocate,
			},
		};
		const splitLeaf = {
			setViewState: vi.fn(async () => undefined),
		};
		const app = {
			workspace: {
				getLeavesOfType: vi.fn(() => [existingLeaf]),
				getLeaf: vi.fn(() => splitLeaf),
				setActiveLeaf: vi.fn(),
				revealLeaf: vi.fn(),
			},
			viewRegistry: {
				typeByExtension: {
					get: vi.fn(() => VIEW_TYPE_EPUB),
				},
			},
		} as any;

		const result = await openBookForSourceNavigation(app, 'Books/demo.mobi', {
			pendingLocate: {
				cfi: 'epubcfi(/6/2)',
				text: 'Quote',
				flashStyle: 'pulse',
				showLocateOverlay: true,
			},
		});

		expect(result).toBe(existingLeaf);
		expect(navigateToBookLocate).toHaveBeenCalledWith({
			cfi: 'epubcfi(/6/2)',
			text: 'Quote',
			flashStyle: 'pulse',
			showLocateOverlay: true,
		});
		expect(existingLeaf.setViewState).not.toHaveBeenCalled();
		expect(app.workspace.getLeaf).not.toHaveBeenCalled();
		expect(app.workspace.setActiveLeaf).toHaveBeenCalledWith(existingLeaf, { focus: true });
	});

	it('opens source navigation in a right split when the book is not already open', async () => {
		resolveSupportedBookFilePathMock.mockReturnValue('Books/new.mobi');
		const splitLeaf = {
			setViewState: vi.fn(async () => undefined),
		};
		const app = {
			workspace: {
				getLeavesOfType: vi.fn(() => []),
				getLeaf: vi.fn(() => splitLeaf),
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

		expect(result).toBe(splitLeaf);
		expect(app.workspace.getLeaf).toHaveBeenCalledWith('split', 'vertical');
		expect(splitLeaf.setViewState).toHaveBeenCalled();
	});

	it('prefers the Weave PDF reader for PDFs even when the pdf extension is already registered elsewhere', () => {
		const app = {
			viewRegistry: {
				typeByExtension: {
					get: vi.fn((extension: string) => extension === 'pdf' ? 'pdf' : VIEW_TYPE_EPUB),
				},
				viewByType: new Map([
					[VIEW_TYPE_EPUB, {}],
					[VIEW_TYPE_PDF, {}],
				]),
			},
		} as any;

		expect(resolveRegisteredEpubViewType(app, 'Books/paper.pdf')).toBe(VIEW_TYPE_PDF);
	});
});
