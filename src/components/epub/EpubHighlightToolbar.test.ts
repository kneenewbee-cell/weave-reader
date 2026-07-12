import { render, waitFor } from '@testing-library/svelte';

vi.mock('obsidian', async () => {
  return await vi.importActual<typeof import('../../tests/mocks/obsidian')>('../../tests/mocks/obsidian');
});

import EpubHighlightToolbar from './EpubHighlightToolbar.svelte';
import type { EpubReaderEngine, HighlightClickInfo } from '../../services/epub';

function createInfo(): HighlightClickInfo {
  return {
    cfiRange: '/6/2[chapter]!/4/2/6',
    color: 'yellow',
    text: '测试高亮',
    sourceFile: 'Notes/test.md',
    rect: {
      top: 24,
      left: 48,
      bottom: 44,
      right: 148,
      width: 100,
      height: 20,
    },
  };
}

function createReaderService(frameDocuments: Document[] = []): EpubReaderEngine {
  return {
    getVisibleFrames: () => frameDocuments.map((document) => ({
      frameDocument: document,
      window: document.defaultView || window,
      cfiFromRange: () => null,
    })),
  } as unknown as EpubReaderEngine;
}

describe('EpubHighlightToolbar', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('dismisses when clicking outside in the host document', async () => {
    const onDismiss = vi.fn();

    render(EpubHighlightToolbar, {
      props: {
        info: createInfo(),
        readerService: createReaderService(),
        onDelete: vi.fn(),
        onTemporarilyReveal: vi.fn(),
        onChangeColor: vi.fn(),
        onChangeStyle: vi.fn(),
        onEditComment: vi.fn(),
        onBacklink: vi.fn(),
        onExtractToCard: vi.fn(),
        onCopyText: vi.fn(),
        onDismiss,
      },
    });

    await waitFor(() => {
      expect(document.querySelector('.epub-highlight-toolbar.visible')).toBeInTheDocument();
    });

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses when clicking outside in a visible reader frame document', async () => {
    const onDismiss = vi.fn();
    const frameDocument = document.implementation.createHTMLDocument('reader-frame');

    render(EpubHighlightToolbar, {
      props: {
        info: createInfo(),
        readerService: createReaderService([frameDocument]),
        onDelete: vi.fn(),
        onTemporarilyReveal: vi.fn(),
        onChangeColor: vi.fn(),
        onChangeStyle: vi.fn(),
        onEditComment: vi.fn(),
        onBacklink: vi.fn(),
        onExtractToCard: vi.fn(),
        onCopyText: vi.fn(),
        onDismiss,
      },
    });

    await waitFor(() => {
      expect(document.querySelector('.epub-highlight-toolbar.visible')).toBeInTheDocument();
    });

    const outside = frameDocument.createElement('div');
    frameDocument.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
