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

import { TFile } from 'obsidian';
import { EpubStorageService } from '../EpubStorageService';
import { openEpubReader } from '../epub-plugin-support';
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
