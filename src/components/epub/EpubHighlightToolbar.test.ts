import { fireEvent, render, waitFor } from '@testing-library/svelte';

vi.mock('obsidian', async () => {
  return await vi.importActual<typeof import('../../tests/mocks/obsidian')>('../../tests/mocks/obsidian');
});

vi.mock('../../views/EpubView', () => ({ VIEW_TYPE_EPUB: 'epub' }));
vi.mock('../../views/EpubSidebarView', () => ({ VIEW_TYPE_EPUB_SIDEBAR: 'epub-sidebar' }));
vi.mock('../../views/EpubBookshelfSidebarView', () => ({
  VIEW_TYPE_EPUB_BOOKSHELF_SIDEBAR: 'epub-bookshelf-sidebar',
}));

import EpubHighlightToolbar from './EpubHighlightToolbar.svelte';
import type { EpubReaderEngine, EpubSemanticSettings, HighlightClickInfo } from '../../services/epub';

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

function createSemanticSettings(): EpubSemanticSettings {
  return {
    annotationSemanticsEnabled: true,
    semanticSchemeId: 'test',
    standardSemanticIds: ['definition'],
    annotationSemantics: [
      {
        id: 'theorem',
        label: '定理/结论',
        color: 'yellow',
        style: 'highlight',
        group: 'study',
        description: '定理',
        active: true,
      },
      {
        id: 'definition',
        label: '定义',
        color: 'blue',
        style: 'highlight',
        group: 'study',
        description: '定义',
        active: true,
      },
      {
        id: 'method',
        label: 'method',
        color: 'green',
        style: 'wavy',
        group: 'study',
        description: 'method',
        active: true,
      },
    ],
  };
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
        onChangeSemantic: vi.fn(),
        onEditComment: vi.fn(),
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
        onChangeSemantic: vi.fn(),
        onEditComment: vi.fn(),
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

  it('uses the selection semantic row structure when changing an existing annotation semantic', async () => {
    const onChangeSemantic = vi.fn();
    const { container } = render(EpubHighlightToolbar, {
      props: {
        info: { ...createInfo(), semanticId: 'theorem' },
        readerService: createReaderService(),
        readerUiMode: 'expert',
        semanticSettings: createSemanticSettings(),
        onDelete: vi.fn(),
        onTemporarilyReveal: vi.fn(),
        onChangeSemantic,
        onEditComment: vi.fn(),
        onCopyText: vi.fn(),
        onDismiss: vi.fn(),
      },
    });

    await fireEvent.click(container.querySelector('.semantic-action') as HTMLElement);

    const semanticRow = container.querySelector('.highlight-semantic-picker-row');
    expect(semanticRow).toHaveClass('weave-epub-expert-semantic-row');
    expect(semanticRow).not.toHaveClass('actions-row');
    expect(semanticRow?.closest('.highlight-actions-shell')).toBeNull();
    const definitionButton = container.querySelector('[data-semantic-id="definition"]') as HTMLButtonElement;
    expect(definitionButton).toHaveClass('weave-epub-semantic-chip');
    expect(definitionButton).toHaveAttribute('data-semantic-style', 'highlight');
    expect(definitionButton).toHaveAttribute(
      'style',
      expect.stringContaining('--weave-semantic-color:')
    );
    expect(definitionButton.querySelector('.weave-epub-semantic-dot')).toBeInTheDocument();
    expect(definitionButton.querySelector('.weave-epub-semantic-label')).toHaveTextContent('定义');

    const methodButton = container.querySelector('[data-semantic-id="method"]') as HTMLButtonElement;
    expect(methodButton).toHaveAttribute('data-semantic-style', 'wavy');

    await fireEvent.click(definitionButton);

    expect(onChangeSemantic).toHaveBeenCalledWith(
      expect.objectContaining({ semanticId: 'theorem' }),
      expect.objectContaining({ id: 'definition' })
    );
  });

  it('shows thought-specific actions without normal annotation controls for standalone thoughts', async () => {
    const onChangeSemantic = vi.fn();
    const onEditComment = vi.fn();
    const onDelete = vi.fn();
    const { container } = render(EpubHighlightToolbar, {
      props: {
        info: {
          ...createInfo(),
          presentation: 'thought',
          commentText: '独立想法',
          hasCommentDivider: true,
        },
        readerService: createReaderService(),
        semanticSettings: createSemanticSettings(),
        canvasAttached: true,
        onDelete,
        onTemporarilyReveal: vi.fn(),
        onChangeSemantic,
        onEditComment,
        onAddToCanvas: vi.fn(),
        onRemoveFromCanvas: vi.fn(),
        onCopyText: vi.fn(),
        onDismiss: vi.fn(),
      },
    });

    await waitFor(() => {
      expect(container.querySelector('.epub-highlight-toolbar.visible')).toBeInTheDocument();
    });

    expect(container.querySelector('.semantic-action')).toBeNull();
    expect(container.querySelector('.canvas-action')).toBeNull();
    expect(container.querySelector('.thought-edit-action')).toBeInTheDocument();
    expect(container.querySelector('.thought-convert-action')).toBeInTheDocument();
    expect(container.querySelector('.delete-action')).toBeInTheDocument();

    await fireEvent.click(container.querySelector('.thought-edit-action') as HTMLElement);
    expect(onEditComment).toHaveBeenCalledWith(expect.objectContaining({ presentation: 'thought' }));

    await fireEvent.click(container.querySelector('.thought-convert-action') as HTMLElement);
    const semanticRow = container.querySelector('.highlight-semantic-picker-row');
    expect(semanticRow).toBeInTheDocument();

    await fireEvent.click(container.querySelector('[data-semantic-id="definition"]') as HTMLElement);
    expect(onChangeSemantic).toHaveBeenCalledWith(
      expect.objectContaining({ presentation: 'thought' }),
      expect.objectContaining({ id: 'definition' })
    );
  });
});
