import { render, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('obsidian', async () => {
  return await vi.importActual<typeof import('../../tests/mocks/obsidian')>('../../tests/mocks/obsidian');
});

vi.mock('../../views/EpubView', () => ({ VIEW_TYPE_EPUB: 'epub' }));
vi.mock('../../views/EpubSidebarView', () => ({ VIEW_TYPE_EPUB_SIDEBAR: 'epub-sidebar' }));
vi.mock('../../views/EpubBookshelfSidebarView', () => ({
  VIEW_TYPE_EPUB_BOOKSHELF_SIDEBAR: 'epub-bookshelf-sidebar',
}));

import { App } from 'obsidian';
import SelectionToolbar from './SelectionToolbar.svelte';
import type { EpubReaderEngine, EpubSemanticSettings } from '../../services/epub';

function createReaderService(): EpubReaderEngine {
  return {
    onSelectionChange: () => () => undefined,
    onHighlightClick: () => () => undefined,
  } as unknown as EpubReaderEngine;
}

function createSemanticSettings(): EpubSemanticSettings {
  const entries = [
    ['definition', '定义', 'blue', 'highlight'],
    ['quote', '引用', 'teal', 'underline'],
    ['theme', '主题', 'yellow', 'highlight'],
    ['person', '人物', 'magenta', 'highlight'],
    ['event', '事件', 'orange', 'wavy'],
    ['question', '疑问', 'purple', 'underline'],
  ] as const;

  return {
    annotationSemanticsEnabled: true,
    semanticSchemeId: 'test',
    standardSemanticIds: entries.map(([id]) => id),
    annotationSemantics: entries.map(([id, label, color, style]) => ({
      id,
      label,
      color,
      style,
      group: 'study',
      active: true,
    })),
  };
}

function createBoundsEl(): HTMLElement {
  const boundsEl = document.createElement('div');
  Object.defineProperty(boundsEl, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(boundsEl, 'clientHeight', { configurable: true, value: 600 });
  boundsEl.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  document.body.appendChild(boundsEl);
  return boundsEl;
}

describe('SelectionToolbar', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows only semantic annotation actions in standard mode', async () => {
    const { container } = render(SelectionToolbar, {
      props: {
        app: new App(),
        readerService: createReaderService(),
        book: null,
        readerUiMode: 'standard',
        semanticSettings: createSemanticSettings(),
        boundsEl: createBoundsEl(),
        externalSelection: {
          text: 'selected text',
          cfiRange: '/6/2!/4/2',
          rect: new DOMRect(120, 80, 180, 24),
        },
        onExtractToCard: vi.fn(),
        onCreateReadingPoint: vi.fn(),
        onEditThought: vi.fn(),
        onOpenAIMenu: vi.fn(),
      },
    });

    await waitFor(() => {
      expect(container.querySelector('.epub-selection-toolbar.visible')).toBeInTheDocument();
    });

    expect(container.querySelectorAll('.weave-epub-standard-semantic-btn')).toHaveLength(6);
    expect(container.querySelector('.selection-actions-row')).toHaveClass('selection-standard-semantic-row');
    expect(container.querySelector('.weave-epub-standard-highlight-btn')).toBeNull();
    expect(container.querySelector('.comment-action')).toBeNull();
    expect(container.querySelector('.selection-actions-more')).toBeNull();
    expect(container.querySelector('.weave-epub-expert-strikethrough-btn')).toBeNull();
    expect(container.querySelectorAll('.selection-actions-row > .action-item')).toHaveLength(6);
  });

  it('defines a compact two-row layout for standard mode semantic chips', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/epub/epub-nav-sidebar.css'), 'utf8');
    const match = css.match(
      /\.epub-reader-root\[data-reader-ui-mode="standard"\]\s+\.epub-selection-toolbar\s+\.selection-standard-semantic-row\s*\{(?<body>[^}]+)\}/
    );

    expect(match?.groups?.body).toContain('flex-wrap: wrap');
    expect(match?.groups?.body).toContain('width: 178px');
    expect(match?.groups?.body).toContain('max-height: 52px');
  });
});
