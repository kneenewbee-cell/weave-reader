import { render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EpubReaderView from './EpubReaderView.svelte';
import type { EpubBook, EpubReaderSettings } from '../../services/epub/types';
import type { EpubReaderEngine, ReaderHighlight } from '../../services/epub/reader-engine-types';

vi.mock('obsidian', async () => {
	return await vi.importActual<typeof import('../../tests/mocks/obsidian')>(
		'../../tests/mocks/obsidian'
	);
});

vi.mock('../../services/epub', () => ({
	flushEpubPendingProgress: vi.fn(async () => undefined),
}));

function createBook(): EpubBook {
	return {
		id: 'epub-book-test',
		filePath: 'Books/book.epub',
		metadata: {
			title: 'Book',
			author: 'Author',
			chapterCount: 1,
		},
		currentPosition: {
			chapterIndex: 0,
			cfi: '',
			percent: 0,
		},
		readingStats: {
			totalReadTime: 0,
			lastReadTime: 0,
			createdTime: 0,
		},
	};
}

function createReaderService() {
	const service = {
		engineType: 'foliate',
		renderTo: vi.fn(async (container: HTMLElement) => {
			container.replaceChildren(document.createElement('div'));
		}),
		getPaginationInfo: vi.fn(async () => ({ currentPage: 1, totalPages: 10 })),
		getReadingProgress: vi.fn(() => 0),
		getCurrentChapterTitle: vi.fn(() => 'Chapter 1'),
		getCurrentChapterIndex: vi.fn(() => 0),
		getCurrentPosition: vi.fn(() => ({ chapterIndex: 0, cfi: '', percent: 0 })),
		getCurrentCFI: vi.fn(() => ''),
		goToLocation: vi.fn(async () => undefined),
		applyHighlights: vi.fn(async () => undefined),
		isLayoutChanging: vi.fn(() => false),
		resize: vi.fn(),
		applyReaderAppearance: vi.fn(async () => undefined),
		onRelocated: vi.fn(() => () => undefined),
		setLayoutMode: vi.fn(async () => undefined),
	} as unknown as EpubReaderEngine & {
		renderTo: ReturnType<typeof vi.fn>;
		applyHighlights: ReturnType<typeof vi.fn>;
	};
	return service;
}

function createHighlight(text: string): ReaderHighlight {
	return {
		cfiRange: `epubcfi(/6/2!/4/2/1:${text.length})`,
		color: 'yellow',
		text,
		chapterIndex: 0,
		sourceFile: 'weave/epub-data/books/epub-book-test/annotations.json',
	};
}

function createSettings(): EpubReaderSettings {
	return {
		theme: 'light',
		fontSize: 16,
		fontFamily: 'serif',
		lineHeight: 1.6,
		letterSpacing: 0,
		pageMargin: 24,
		widthMode: 'full',
		layoutMode: 'paginated',
		flowMode: 'paginated',
		paragraphModeEnabled: false,
		showScrolledSideNav: true,
	} as EpubReaderSettings;
}

describe('EpubReaderView annotation version reload', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = '';
	});

	it('re-renders the reader and recollects JSON highlights when renderKey changes', async () => {
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 800,
			bottom: 600,
			width: 800,
			height: 600,
			toJSON: () => ({}),
		} as DOMRect);

		const oldHighlight = createHighlight('old annotation');
		const newHighlight = createHighlight('new annotation');
		const readerService = createReaderService();
		const annotationService = {
			collectAllHighlights: vi
				.fn()
				.mockResolvedValueOnce([oldHighlight])
				.mockResolvedValueOnce([newHighlight]),
		};

		const props = {
			filePath: 'Books/book.epub',
			book: createBook(),
			readerService,
			storageService: {},
			annotationService,
			backlinkService: {},
			settings: createSettings(),
			excerptSettings: { strikethroughDisplayMode: 'strikethrough' },
			canUseReadingProgress: false,
			canUseExcerptNotes: true,
			annotationBookId: 'portable-book-id',
			renderKey: 0,
		};

		const view = render(EpubReaderView, { props });

		await waitFor(() => expect(readerService.renderTo).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(readerService.applyHighlights).toHaveBeenLastCalledWith([
			oldHighlight,
		]));

		await view.rerender({ ...props, renderKey: 1 });

		await waitFor(() => expect(readerService.renderTo).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(readerService.applyHighlights).toHaveBeenLastCalledWith([
			newHighlight,
		]));
		expect(annotationService.collectAllHighlights).toHaveBeenNthCalledWith(
			1,
			'portable-book-id',
			'Books/book.epub',
			props.backlinkService
		);
		expect(annotationService.collectAllHighlights).toHaveBeenNthCalledWith(
			2,
			'portable-book-id',
			'Books/book.epub',
			props.backlinkService
		);
		expect(annotationService.collectAllHighlights).toHaveBeenCalledTimes(2);
	});
});
