import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

vi.mock('obsidian', async () => {
  return await vi.importActual<typeof import('../../tests/mocks/obsidian')>('../../tests/mocks/obsidian');
});

import AnnotationDisambiguationMenu from './AnnotationDisambiguationMenu.svelte';
import type { EpubReaderEngine, HighlightClickInfo } from '../../services/epub';
import type { AnnotationDisambiguationCandidate } from './AnnotationDisambiguationMenu.svelte';

function createInfo(label: string, left = 10): HighlightClickInfo {
  return {
    cfiRange: `/6/2!/4/${left}`,
    color: 'yellow',
    semanticId: label,
    semanticLabel: label,
    text: `${label} text`,
    sourceFile: '',
    rect: {
      top: 20,
      left,
      bottom: 40,
      right: left + 80,
      width: 80,
      height: 20,
    },
  };
}

function createCandidate(label: string, left = 10): AnnotationDisambiguationCandidate {
  const info = createInfo(label, left);
  return {
    id: `${label}-${left}`,
    label,
    description: `${label} description`,
    color: '#ffe58a',
    info,
  };
}

function createReaderService(frameDocuments: Document[] = []): EpubReaderEngine {
  return {
    getVisibleFrames: () =>
      frameDocuments.map((frameDocument) => ({
        frameDocument,
        window: frameDocument.defaultView || window,
        cfiFromRange: () => null,
      })),
  } as unknown as EpubReaderEngine;
}

describe('AnnotationDisambiguationMenu', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('previews on hover and selects the chosen annotation', async () => {
    const important = createCandidate('重点', 10);
    const question = createCandidate('疑问', 12);
    const onPreview = vi.fn();
    const onSelect = vi.fn();

    render(AnnotationDisambiguationMenu, {
      props: {
        readerService: createReaderService(),
        anchor: important.info,
        candidates: [important, question],
        onPreview,
        onSelect,
        onDismiss: vi.fn(),
      },
    });

    const questionButton = screen.getByRole('button', { name: '疑问' });
    await fireEvent.mouseEnter(questionButton);
    expect(onPreview).toHaveBeenLastCalledWith(question);

    await fireEvent.mouseLeave(questionButton);
    expect(onPreview).toHaveBeenLastCalledWith(null);

    await fireEvent.click(questionButton);
    expect(onSelect).toHaveBeenCalledWith(question);
  });

  it('dismisses when clicking outside inside a visible reader frame document', async () => {
    const important = createCandidate('閲嶇偣', 10);
    const question = createCandidate('鐤戦棶', 12);
    const frameDocument = document.implementation.createHTMLDocument('reader-frame');
    const outside = frameDocument.createElement('button');
    outside.textContent = 'outside reader';
    frameDocument.body.appendChild(outside);
    const onPreview = vi.fn();
    const onDismiss = vi.fn();

    render(AnnotationDisambiguationMenu, {
      props: {
        readerService: createReaderService([frameDocument]),
        anchor: important.info,
        candidates: [important, question],
        onPreview,
        onSelect: vi.fn(),
        onDismiss,
      },
    });

    await tick();
    await tick();
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
