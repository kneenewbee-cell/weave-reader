import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  notices,
  navigationHubNavigateMock,
  ensureEpubFileAccessMock,
  ensureBookOnBookshelfMock,
  storageCtorMock,
} = vi.hoisted(() => ({
  notices: [] as string[],
  navigationHubNavigateMock: vi.fn(async () => ({ success: true, leaf: { id: 'leaf-1' } })),
  ensureEpubFileAccessMock: vi.fn(() => true),
  ensureBookOnBookshelfMock: vi.fn(),
  storageCtorMock: vi.fn(),
}));

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<typeof import('obsidian')>('obsidian');

  class MockTFile {
    path: string;
    extension: string;
    basename: string;
    name: string;
    stat: { size: number; mtime: number };
    parent: { path: string } | null;

    constructor(path: string) {
      this.path = path;
      this.extension = path.split('.').pop() || '';
      this.basename = path.split('/').pop()?.replace(/\.[^.]+$/, '') || path;
      this.name = path.split('/').pop() || path;
      this.stat = { size: 1024, mtime: 1710000000000 };
      const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      this.parent = folder ? { path: folder } : null;
    }
  }

  return {
    ...actual,
    Notice: class MockNotice {
      constructor(message?: string) {
        notices.push(String(message || ''));
      }
    },
    Plugin: class MockPlugin {},
    TFile: MockTFile,
  };
});

vi.mock('../../navigation/navigation-hub-access', () => ({
  getNavigationHub: () => ({
    navigate: navigationHubNavigateMock,
  }),
}));

vi.mock('../epub-premium', () => ({
  ensureEpubFileAccess: ensureEpubFileAccessMock,
}));

vi.mock('../EpubStorageService', () => ({
  EpubStorageService: vi.fn().mockImplementation(() => {
    storageCtorMock();
    return {
      ensureBookOnBookshelf: ensureBookOnBookshelfMock,
    };
  }),
}));

vi.mock('../../../views/EpubView', () => ({
  VIEW_TYPE_EPUB: 'weave-epub-reader-standalone',
  EpubView: class MockEpubView {},
}));

vi.mock('../../../views/EpubSidebarView', () => ({
  VIEW_TYPE_EPUB_SIDEBAR: 'weave-epub-sidebar-standalone',
  EpubSidebarView: class MockEpubSidebarView {},
}));

vi.mock('../../../views/EpubBookshelfSidebarView', () => ({
  VIEW_TYPE_EPUB_BOOKSHELF_SIDEBAR: 'weave-epub-bookshelf-sidebar-standalone',
  EpubBookshelfSidebarView: class MockEpubBookshelfSidebarView {},
}));

import { TFile } from 'obsidian';
import { EpubStorageService } from '../EpubStorageService';
import { openEpubAiReadingNote, openEpubReader, registerEpubWorkspaceViews } from '../epub-plugin-support';
import { getEpubDualWindowSession } from '../epub-dual-window-workspace';
import { EPUB_RUNTIME } from '../epub-runtime';

function createVaultFile(path: string): TFile {
  const normalizedPath = path.replace(/\\/g, '/');
  const extension = normalizedPath.split('.').pop() || '';
  const basename = normalizedPath.split('/').pop()?.replace(/\.[^.]+$/, '') || normalizedPath;
  const folder = normalizedPath.includes('/')
    ? normalizedPath.slice(0, normalizedPath.lastIndexOf('/'))
    : '';

  return Object.assign(Object.create(TFile.prototype), {
    path: normalizedPath,
    extension,
    basename,
    name: normalizedPath.split('/').pop() || normalizedPath,
    stat: { size: 1024, mtime: 1710000000000 },
    parent: folder ? { path: folder } : null,
  });
}

function createApp(filePath = 'Books/demo.epub') {
  return {
    vault: {
      getAbstractFileByPath: vi.fn((path: string) => {
        if (path.replace(/\\/g, '/') === filePath) {
          return createVaultFile(filePath);
        }
        return null;
      }),
    },
  } as any;
}

describe('epub-plugin-support openEpubReader', () => {
  beforeEach(() => {
    notices.length = 0;
    navigationHubNavigateMock.mockReset();
    navigationHubNavigateMock.mockResolvedValue({ success: true, leaf: { id: 'leaf-1' } });
    ensureEpubFileAccessMock.mockReset();
    ensureEpubFileAccessMock.mockReturnValue(true);
    ensureBookOnBookshelfMock.mockReset();
    storageCtorMock.mockReset();
  });

  it('opens a supported book without implicitly adding it to the bookshelf', async () => {
    const app = createApp();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    await openEpubReader(
      app,
      'Books/demo.epub',
      '[Standalone EPUB]',
      'missing',
      'failed'
    );

    expect(ensureEpubFileAccessMock).toHaveBeenCalledWith(app, 'Books/demo.epub');
    expect(navigationHubNavigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'book',
        resourcePath: 'Books/demo.epub',
        policy: { preferredLeaf: true, focus: true },
      })
    );
    expect(EpubStorageService).not.toHaveBeenCalled();
    expect(storageCtorMock).not.toHaveBeenCalled();
    expect(ensureBookOnBookshelfMock).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({
      type: EPUB_RUNTIME.events.bookshelfDataChanged,
    }));
    expect(notices).toEqual([]);
  });
});

describe('epub-plugin-support openEpubAiReadingNote', () => {
  it('opens AI reading notes in the dedicated EPUB AI reading note view', async () => {
    const noteFile = createVaultFile('AI阅读笔记/demo - AI阅读.md');
    const leaf = {
      setViewState: vi.fn(async () => undefined),
    };
    const app = {
      workspace: {
        getLeavesOfType: vi.fn(() => []),
        getLeaf: vi.fn(() => leaf),
        revealLeaf: vi.fn(),
      },
    } as any;

    await openEpubAiReadingNote(app, noteFile, {
      sourceFile: 'Books/demo.epub',
      openMode: 'existing',
      focus: true,
    });

    expect(leaf.setViewState).toHaveBeenCalledWith({
      type: EPUB_RUNTIME.viewTypes.aiReadingNote,
      active: true,
      state: {
        notePath: 'AI阅读笔记/demo - AI阅读.md',
        sourceFile: 'Books/demo.epub',
      },
    });
    expect(app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
  });

  it('opens AI reading notes in a registered EPUB dual-window session', async () => {
    const noteFile = createVaultFile('AI阅读笔记/demo - AI阅读.md');
    const readerLeaf = {
      containerEl: document.createElement('div'),
      view: {
        containerEl: document.createElement('div'),
        contentEl: document.createElement('div'),
        getCurrentFilePath: () => 'Books/demo.epub',
      },
      getViewState: vi.fn(() => ({
        type: EPUB_RUNTIME.viewTypes.reader,
        state: { filePath: 'Books/demo.epub' },
      })),
      setViewState: vi.fn(async () => undefined),
    };
    const noteLeaf = {
      containerEl: document.createElement('div'),
      view: {
        containerEl: document.createElement('div'),
        contentEl: document.createElement('div'),
      },
      getViewState: vi.fn(() => ({
        type: EPUB_RUNTIME.viewTypes.aiReadingNote,
        state: {
          notePath: noteFile.path,
          sourceFile: 'Books/demo.epub',
          dualWindowMode: true,
        },
      })),
      setViewState: vi.fn(async () => undefined),
    };
    const existingAiNoteLeaf = {
      getViewState: vi.fn(() => ({
        type: EPUB_RUNTIME.viewTypes.aiReadingNote,
        state: {
          notePath: noteFile.path,
          sourceFile: 'Books/demo.epub',
        },
      })),
      detach: vi.fn(async () => undefined),
    };
    const app = {
      workspace: {
        getLeavesOfType: vi.fn((viewType: string) => {
          if (viewType === EPUB_RUNTIME.viewTypes.reader) {
            return [readerLeaf];
          }
          if (viewType === EPUB_RUNTIME.viewTypes.aiReadingNote) {
            return noteLeaf.setViewState.mock.calls.length > 0
              ? [noteLeaf, existingAiNoteLeaf]
              : [existingAiNoteLeaf];
          }
          return [];
        }),
        getLeaf: vi.fn(() => noteLeaf),
        revealLeaf: vi.fn(),
      },
      vault: {
        configDir: '.obsidian',
        getAbstractFileByPath: vi.fn((path: string) =>
          path === 'Books/demo.epub' ? createVaultFile(path) : null
        ),
      },
    } as any;

    await openEpubAiReadingNote(app, noteFile, {
      bookId: 'book-1',
      sourceFile: 'Books/demo.epub',
      openMode: 'right-split',
      dualWindowMode: true,
      focus: false,
    });

    expect(noteLeaf.setViewState).toHaveBeenCalledWith({
      type: EPUB_RUNTIME.viewTypes.aiReadingNote,
      active: false,
      state: {
        bookId: 'book-1',
        notePath: 'AI阅读笔记/demo - AI阅读.md',
        sourceFile: 'Books/demo.epub',
        dualWindowMode: true,
      },
    });
    expect(getEpubDualWindowSession(app, 'Books/demo.epub')).toMatchObject({
      mode: 'book-ai-reading-note',
      bookId: 'book-1',
      filePath: 'Books/demo.epub',
      notePath: 'AI阅读笔记/demo - AI阅读.md',
    });
    expect(noteLeaf.containerEl.classList.contains('weave-epub-annotation-note-dual-window-view')).toBe(true);
    expect(existingAiNoteLeaf.detach).toHaveBeenCalledOnce();
  });
});

describe('epub-plugin-support workspace registration', () => {
  beforeEach(() => {
    notices.length = 0;
  });

  it('registers PDF files to the PDF reader view and keeps EPUB-like formats on the EPUB reader', () => {
    const registerView = vi.fn();
    const registerExtensions = vi.fn();
    const host = {
      app: createApp(),
      registerView,
      registerExtensions,
    };
    const pdfReaderViewType = (EPUB_RUNTIME.viewTypes as Record<string, string>).pdfReader;
    const epubReaderViewType = 'weave-epub-reader-standalone';

    registerEpubWorkspaceViews(host as any, '[Standalone EPUB]', 'Weave Reader');

    expect(registerView).toHaveBeenCalledWith(pdfReaderViewType, expect.any(Function));
    const epubRegisteredExtensions = registerExtensions.mock.calls
      .filter((call) => call[1] === epubReaderViewType)
      .flatMap((call) => call[0]);
    expect(epubRegisteredExtensions).toEqual(expect.arrayContaining(['epub', 'txt']));
    expect(epubRegisteredExtensions).not.toContain('pdf');
    expect(registerExtensions).toHaveBeenCalledWith(['pdf'], pdfReaderViewType);
  });
});
