vi.mock('obsidian', () => ({
	App: class MockApp {},
	TFile: class MockTFile {},
	ItemView: class MockItemView {},
	WorkspaceLeaf: class MockWorkspaceLeaf {},
	MarkdownView: class MockMarkdownView {},
	Notice: class MockNotice {
		constructor(_message?: string) {}
	},
	Menu: class MockMenu {},
	Modal: class MockModal {},
	Plugin: class MockPlugin {},
	PluginSettingTab: class MockPluginSettingTab {},
	Platform: { isMobile: false },
	MarkdownPostProcessorContext: class MarkdownPostProcessorContext {},
	setIcon: vi.fn(),
	normalizePath: (value: string) => String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, ''),
}));

import { createEpubLinkPostProcessor } from '../EpubLinkPostProcessor';
import { EpubLinkService } from '../EpubLinkService';
import {
	EPUB_DUAL_WINDOW_ANNOTATION_EVENT,
} from '../epub-dual-window';
import { registerEpubHost, unregisterEpubHost } from '../epub-host';

beforeAll(() => {
	Object.defineProperty(HTMLElement.prototype, 'addClass', {
		configurable: true,
		value(this: HTMLElement, className: string) {
			this.classList.add(className);
		},
	});
	Object.defineProperty(HTMLElement.prototype, 'removeClass', {
		configurable: true,
		value(this: HTMLElement, className: string) {
			this.classList.remove(className);
		},
	});
	Object.defineProperty(HTMLElement.prototype, 'empty', {
		configurable: true,
		value(this: HTMLElement) {
			this.replaceChildren();
		},
	});
	Object.defineProperty(HTMLElement.prototype, 'createSpan', {
		configurable: true,
		value(this: HTMLElement, options?: { cls?: string; text?: string }) {
			const span = document.createElement('span');
			if (options?.cls) {
				span.className = options.cls;
			}
			if (options?.text) {
				span.textContent = options.text;
			}
			this.appendChild(span);
			return span;
		},
	});
});

describe('EpubLinkPostProcessor', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('applies derived EPUB callout color and style attributes for combined metadata', () => {
		const container = document.createElement('div');
		container.innerHTML = [
			'<div class="callout" data-callout="epub" data-callout-metadata="purple+wavy"></div>',
			'<div class="callout" data-callout="epub" data-callout-metadata="underline red"></div>',
			'<div class="callout" data-callout="epub"></div>',
		].join('');

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, {} as any);

		const callouts = Array.from(container.querySelectorAll<HTMLElement>('.callout[data-callout="epub"]'));
		expect(callouts[0]?.getAttribute('data-weave-epub-color')).toBe('purple');
		expect(callouts[0]?.getAttribute('data-weave-epub-style')).toBe('wavy');
		expect(callouts[1]?.getAttribute('data-weave-epub-color')).toBe('red');
		expect(callouts[1]?.getAttribute('data-weave-epub-style')).toBe('underline');
		expect(callouts[2]?.hasAttribute('data-weave-epub-color')).toBe(false);
		expect(callouts[2]?.hasAttribute('data-weave-epub-style')).toBe(false);
	});

	it('does not double-bind EPUB link click handlers when the same element is processed repeatedly', async () => {
		const navigateSpy = vi
			.spyOn(EpubLinkService.prototype, 'navigateToEpubLocation')
			.mockResolvedValue(undefined);

		const container = document.createElement('div');
		container.innerHTML = '<a class="internal-link" href="Books/demo.epub#weave-cfi=readium%3Aabc&text=Hello%20world">Demo</a>';

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, {} as any);
		processor(container, {} as any);

		const link = container.querySelector('a');
		expect(link).not.toBeNull();

		link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(navigateSpy).toHaveBeenCalledTimes(1);
		expect(navigateSpy).toHaveBeenCalledWith(
			'Books/demo.epub',
			'readium:abc',
			'Hello world',
			undefined,
			undefined
		);
	});

	it('binds MOBI excerpt source links and routes clicks through navigateToEpubLocation', async () => {
		const navigateSpy = vi
			.spyOn(EpubLinkService.prototype, 'navigateToEpubLocation')
			.mockResolvedValue(undefined);

		const container = document.createElement('div');
		container.innerHTML = [
			'<div class="callout" data-callout="epub" data-callout-metadata="red">',
			'  <div class="callout-title">',
			'    <a class="internal-link" href="附件/demo.mobi#weave-cfi=epubcfi(/6/62!/4/12,/1:0,/1:136)">Jobs</a>',
			'  </div>',
			'  <div class="callout-content">',
			'    <blockquote><p>七月，李·克劳接到史蒂夫·乔布斯的电话。</p></blockquote>',
			'  </div>',
			'</div>',
		].join('');

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, {} as any);

		const link = container.querySelector('a');
		expect(link).not.toBeNull();

		link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(navigateSpy).toHaveBeenCalledTimes(1);
		expect(navigateSpy).toHaveBeenCalledWith(
			'附件/demo.mobi',
			'epubcfi(/6/62!/4/12,/1:0,/1:136)',
			'',
			undefined,
			undefined
		);
	});

	it('ignores edited callout quote text for weave-loc links and navigates by CFI only', async () => {
		const navigateSpy = vi
			.spyOn(EpubLinkService.prototype, 'navigateToEpubLocation')
			.mockResolvedValue(undefined);

		const container = document.createElement('div');
		container.innerHTML = [
			'<div class="callout" data-callout="epub" data-callout-metadata="blue">',
			'  <div class="callout-title">',
			'    <a class="internal-link" href="附件/demo.epub#weave-loc=compact-locator&eid=excerpt-fixed&sid=epubsrc-demo">Demo</a>',
			'  </div>',
			'  <div class="callout-content">',
			'    <blockquote><p>User edited excerpt body that no longer matches the book.</p></blockquote>',
			'  </div>',
			'</div>',
		].join('');

		vi.spyOn(EpubLinkService, 'parseEpubLink').mockReturnValue({
			filePath: '',
			cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:9)',
			text: '',
			sourceId: 'epubsrc-demo',
			excerptId: 'excerpt-fixed',
		});

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, {} as any);

		const link = container.querySelector('a');
		expect(link).not.toBeNull();

		link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(navigateSpy).toHaveBeenCalledTimes(1);
		expect(navigateSpy).toHaveBeenCalledWith(
			'附件/demo.epub',
			'epubcfi(/6/2!/4/2,/1:0,/1:9)',
			'',
			'epubsrc-demo',
			undefined
		);
	});

	it('rewrites protocol markdown links to internal locator hrefs before navigation', async () => {
		const navigateSpy = vi
			.spyOn(EpubLinkService.prototype, 'navigateToEpubLocation')
			.mockResolvedValue(undefined);

		const container = document.createElement('div');
		container.innerHTML =
			'<a class="external-link" href="obsidian://weave-epub?file=Books%2Fdemo.epub&cfi=epubcfi(/6/2)&chapter=3&sid=epubsrc-demo">Demo</a>';

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, {} as any);

		const link = container.querySelector('a');
		expect(link).not.toBeNull();
		expect(link!.getAttribute('href')).toBe(
			'Books/demo.epub#weave-cfi=epubcfi(/6/2)&chapter=3&sid=epubsrc-demo'
		);
		expect(link!.classList.contains('internal-link')).toBe(true);

		link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(navigateSpy).toHaveBeenCalledTimes(1);
		expect(navigateSpy).toHaveBeenCalledWith(
			'Books/demo.epub',
			'epubcfi(/6/2)',
			'',
			'epubsrc-demo',
			undefined
		);
	});

	it('preserves annotation note styled snippet links for native protocol handling', async () => {
		const navigateSpy = vi
			.spyOn(EpubLinkService.prototype, 'navigateToEpubLocation')
			.mockResolvedValue(undefined);

		const container = document.createElement('div');
		container.innerHTML = [
			'<div class="weave-annotation-note-line">',
			'  <a href="obsidian://weave-epub?file=Books%2Fdemo.epub&cfi=epubcfi(/6/2)&chapter=3&sid=epubsrc-demo">',
			'    <mark style="background: rgba(255, 224, 102, 0.62);">Styled text</mark>',
			'  </a>',
			'</div>',
		].join('');

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, {} as any);

		const link = container.querySelector('a');
		expect(link).not.toBeNull();
		expect(link!.getAttribute('href')).toContain('obsidian://weave-epub');
		expect(link!.classList.contains('weave-epub-link')).toBe(false);
		expect(container.querySelector('mark')?.textContent).toBe('Styled text');
		expect(navigateSpy).not.toHaveBeenCalled();
	});

	it('adds chapter and semantic filters to annotation notes', () => {
		const container = document.createElement('div');
		container.className = 'markdown-rendered';
		container.innerHTML = [
			'<div class="weave-annotation-note-root" data-book-id="book-1"></div>',
			'<h2 class="weave-annotation-note-chapter" data-chapter-key="chapter-0">第一章</h2>',
			'<div class="weave-annotation-note-line" data-chapter-key="chapter-0" data-chapter-title="第一章" data-semantic-id="theorem" data-semantic-label="定理" data-annotation-text="alpha theorem">alpha</div>',
			'<div class="weave-annotation-note-line" data-chapter-key="chapter-0" data-chapter-title="第一章" data-semantic-id="mistake" data-semantic-label="易错" data-annotation-text="beta mistake">beta</div>',
			'<h2 class="weave-annotation-note-chapter" data-chapter-key="chapter-1">第二章</h2>',
			'<div class="weave-annotation-note-line" data-chapter-key="chapter-1" data-chapter-title="第二章" data-semantic-id="theorem" data-semantic-label="定理" data-annotation-text="gamma theorem">gamma</div>',
		].join('');

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, { sourcePath: 'weave/epub-data/books/book-1/annotations.md' } as any);

		const toolbar = container.querySelector<HTMLElement>('.weave-annotation-note-filter');
		expect(toolbar).not.toBeNull();
		expect(toolbar?.querySelector('.weave-annotation-note-filter-style')).toBeNull();

		const chapterSelect = toolbar!.querySelector<HTMLSelectElement>('.weave-annotation-note-filter-chapter');
		const semanticSelect = toolbar!.querySelector<HTMLSelectElement>('.weave-annotation-note-filter-semantic');
		const searchInput = toolbar!.querySelector<HTMLInputElement>('.weave-annotation-note-filter-search');
		const count = toolbar!.querySelector<HTMLElement>('.weave-annotation-note-filter-count');
		expect(chapterSelect?.options.length).toBe(3);
		expect(semanticSelect?.options.length).toBe(3);
		expect(count?.textContent).toBe('3 / 3');

		semanticSelect!.value = 'mistake';
		semanticSelect!.dispatchEvent(new Event('change'));
		expect(container.querySelectorAll('.weave-annotation-note-line:not(.is-hidden)').length).toBe(1);
		expect(count?.textContent).toBe('1 / 3');

		semanticSelect!.value = '';
		chapterSelect!.value = 'chapter-1';
		chapterSelect!.dispatchEvent(new Event('change'));
		expect(container.querySelectorAll('.weave-annotation-note-line:not(.is-hidden)').length).toBe(1);
		expect(container.querySelector<HTMLElement>('.weave-annotation-note-chapter[data-chapter-key="chapter-0"]')?.classList.contains('is-hidden')).toBe(true);

		searchInput!.value = 'alpha';
		searchInput!.dispatchEvent(new Event('input'));
		expect(container.querySelectorAll('.weave-annotation-note-line:not(.is-hidden)').length).toBe(0);
		expect(count?.textContent).toBe('0 / 3');
	});

	it('binds the annotation note dual-window button to the EPUB host', () => {
		const openEpubAnnotationNote = vi.fn(async () => undefined);
		const app = { plugins: { getPlugin: vi.fn(() => null) } } as any;
		registerEpubHost(app, { openEpubAnnotationNote });
		try {
			const container = document.createElement('div');
			container.className = 'markdown-rendered';
			container.innerHTML = [
				'<button class="weave-annotation-note-dual-window" type="button" data-weave-dual-window-action="open">双窗模式</button>',
				'<div class="weave-annotation-note-root" data-book-id="book-1" data-source-file="Books/demo.epub" data-dual-window-mode="false"></div>',
				'<div class="weave-annotation-note-line" data-cfi-range="epubcfi(/6/2)" data-chapter-key="chapter-0" data-chapter-title="第一章" data-semantic-id="theorem" data-semantic-label="定理" data-annotation-text="alpha theorem">alpha</div>',
			].join('');

			const processor = createEpubLinkPostProcessor(app);
			processor(container, { sourcePath: 'weave/epub-data/books/book-1/annotations.md' } as any);
			container.querySelector<HTMLButtonElement>('.weave-annotation-note-dual-window')?.click();

			expect(openEpubAnnotationNote).toHaveBeenCalledWith({
				bookId: 'book-1',
				filePath: 'Books/demo.epub',
				dualWindowMode: true,
				openMode: 'right-split',
				focus: false,
			});
		} finally {
			unregisterEpubHost(app);
		}
	});

	it('keeps the annotation note dual-window button working when the button renders after the marker', () => {
		const openEpubAnnotationNote = vi.fn(async () => undefined);
		const app = { plugins: { getPlugin: vi.fn(() => null) } } as any;
		registerEpubHost(app, { openEpubAnnotationNote });
		try {
			const page = document.createElement('div');
			page.className = 'markdown-rendered';
			page.innerHTML = '<div class="weave-annotation-note-root" data-book-id="book-1" data-source-file="Books/demo.epub" data-dual-window-mode="false"></div>';

			const processor = createEpubLinkPostProcessor(app);
			processor(page, { sourcePath: 'weave/epub-data/books/book-1/annotations.md' } as any);

			const lateButton = document.createElement('button');
			lateButton.className = 'weave-annotation-note-dual-window';
			lateButton.type = 'button';
			lateButton.dataset.weaveDualWindowAction = 'open';
			lateButton.textContent = '双窗模式';
			page.appendChild(lateButton);
			lateButton.click();

			expect(openEpubAnnotationNote).toHaveBeenCalledWith({
				bookId: 'book-1',
				filePath: 'Books/demo.epub',
				dualWindowMode: true,
				openMode: 'right-split',
				focus: false,
			});
		} finally {
			unregisterEpubHost(app);
		}
	});

	it('binds a chunked annotation note dual-window button without a nearby marker', () => {
		const openEpubAnnotationNote = vi.fn(async () => undefined);
		const app = { plugins: { getPlugin: vi.fn(() => null) } } as any;
		registerEpubHost(app, { openEpubAnnotationNote });
		try {
			const buttonChunk = document.createElement('div');
			buttonChunk.className = 'el-button';
			buttonChunk.innerHTML =
				'<button class="weave-annotation-note-dual-window" type="button" data-weave-dual-window-action="open" data-book-id="book-1" data-source-file="Books/demo.epub">双窗模式</button>';

			const processor = createEpubLinkPostProcessor(app);
			processor(buttonChunk, { sourcePath: 'weave/epub-data/books/book-1/annotations.md' } as any);
			buttonChunk.querySelector<HTMLButtonElement>('.weave-annotation-note-dual-window')?.click();

			expect(openEpubAnnotationNote).toHaveBeenCalledWith({
				bookId: 'book-1',
				filePath: 'Books/demo.epub',
				dualWindowMode: true,
				openMode: 'right-split',
				focus: false,
			});
		} finally {
			unregisterEpubHost(app);
		}
	});

	it('dispatches dual-window annotation hover events from annotation note lines', () => {
		const app = { plugins: { getPlugin: vi.fn(() => null) } } as any;
		const events: CustomEvent[] = [];
		const listener = (event: Event) => events.push(event as CustomEvent);
		window.addEventListener(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, listener);
		try {
			const container = document.createElement('div');
			container.className = 'markdown-rendered';
			container.innerHTML = [
				'<div class="weave-annotation-note-root" data-book-id="book-1" data-source-file="Books/demo.epub" data-dual-window-mode="true"></div>',
				'<div class="weave-annotation-note-line" data-annotation-id="anno-1" data-cfi-range="epubcfi(/6/2)" data-chapter-key="chapter-0" data-chapter-title="第一章" data-semantic-id="theorem" data-semantic-label="定理" data-annotation-text="alpha theorem">alpha</div>',
			].join('');

			const processor = createEpubLinkPostProcessor(app);
			processor(container, { sourcePath: 'weave/epub-data/books/book-1/annotations.md' } as any);
			const line = container.querySelector<HTMLElement>('.weave-annotation-note-line');
			line?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
			line?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));

			expect(events.map((event) => event.detail.phase)).toEqual(['enter', 'leave']);
			expect(events[0]?.detail).toMatchObject({
				bookId: 'book-1',
				filePath: 'Books/demo.epub',
				cfiRange: 'epubcfi(/6/2)',
				annotationId: 'anno-1',
				semanticId: 'theorem',
				text: 'alpha theorem',
			});
		} finally {
			window.removeEventListener(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, listener);
		}
	});

	it('dispatches dual-window annotation hover events for note lines rendered after the marker', () => {
		const app = { plugins: { getPlugin: vi.fn(() => null) } } as any;
		const events: CustomEvent[] = [];
		const listener = (event: Event) => events.push(event as CustomEvent);
		window.addEventListener(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, listener);
		try {
			const page = document.createElement('div');
			page.className = 'markdown-rendered';
			page.innerHTML = '<div class="weave-annotation-note-root" data-book-id="book-1" data-source-file="Books/demo.epub" data-dual-window-mode="true"></div>';

			const processor = createEpubLinkPostProcessor(app);
			processor(page, { sourcePath: 'weave/epub-data/books/book-1/annotations.md' } as any);

			const lateLine = document.createElement('div');
			lateLine.className = 'weave-annotation-note-line';
			lateLine.dataset.annotationId = 'anno-late';
			lateLine.dataset.cfiRange = 'epubcfi(/6/4)';
			lateLine.dataset.semanticId = 'method';
			lateLine.dataset.annotationText = 'late annotation';
			lateLine.textContent = 'late';
			page.appendChild(lateLine);
			lateLine.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
			lateLine.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));

			expect(events.map((event) => event.detail.phase)).toEqual(['enter', 'leave']);
			expect(events[0]?.detail).toMatchObject({
				bookId: 'book-1',
				filePath: 'Books/demo.epub',
				cfiRange: 'epubcfi(/6/4)',
				annotationId: 'anno-late',
				semanticId: 'method',
				text: 'late annotation',
			});
		} finally {
			window.removeEventListener(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, listener);
		}
	});

	it('dispatches dual-window annotation hover events from a chunked line without a nearby marker', () => {
		const app = { plugins: { getPlugin: vi.fn(() => null) } } as any;
		const events: CustomEvent[] = [];
		const listener = (event: Event) => events.push(event as CustomEvent);
		window.addEventListener(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, listener);
		try {
			const lineChunk = document.createElement('div');
			lineChunk.className = 'el-div';
			lineChunk.innerHTML =
				'<div class="weave-annotation-note-line" data-book-id="book-1" data-source-file="Books/demo.epub" data-annotation-id="anno-1" data-cfi-range="epubcfi(/6/2)" data-semantic-id="theorem" data-annotation-text="alpha theorem">alpha</div>';

			const processor = createEpubLinkPostProcessor(app);
			processor(lineChunk, { sourcePath: 'weave/epub-data/books/book-1/annotations.md' } as any);
			const line = lineChunk.querySelector<HTMLElement>('.weave-annotation-note-line');
			line?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
			line?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));

			expect(events.map((event) => event.detail.phase)).toEqual(['enter', 'leave']);
			expect(events[0]?.detail).toMatchObject({
				bookId: 'book-1',
				filePath: 'Books/demo.epub',
				cfiRange: 'epubcfi(/6/2)',
				annotationId: 'anno-1',
				semanticId: 'theorem',
				text: 'alpha theorem',
			});
		} finally {
			window.removeEventListener(EPUB_DUAL_WINDOW_ANNOTATION_EVENT, listener);
		}
	});

	it('mounts annotation note filters after Obsidian renders note chunks separately', async () => {
		vi.useFakeTimers();
		try {
			const page = document.createElement('div');
			page.className = 'markdown-rendered';
			document.body.appendChild(page);

			const markerChunk = document.createElement('div');
			markerChunk.innerHTML = '<div class="weave-annotation-note-root" data-book-id="book-1"></div>';
			page.appendChild(markerChunk);

			const processor = createEpubLinkPostProcessor({} as any);
			processor(markerChunk, { sourcePath: 'weave/epub-data/books/book-1/annotations.md' } as any);
			expect(page.querySelector('.weave-annotation-note-filter')).toBeNull();

			const linesChunk = document.createElement('div');
			linesChunk.innerHTML = [
				'<h2 class="weave-annotation-note-chapter" data-chapter-key="chapter-0">第一章</h2>',
				'<div class="weave-annotation-note-line" data-chapter-key="chapter-0" data-chapter-title="第一章" data-semantic-id="theorem" data-semantic-label="定理" data-annotation-text="alpha theorem">alpha</div>',
			].join('');
			page.appendChild(linesChunk);

			await vi.advanceTimersByTimeAsync(400);
			expect(page.querySelector('.weave-annotation-note-filter')).not.toBeNull();
		} finally {
			document.body.innerHTML = '';
			vi.useRealTimers();
		}
	});

	it('refreshes annotation note filter options when later rendered chunks add chapters', async () => {
		const page = document.createElement('div');
		page.className = 'markdown-rendered';
		document.body.appendChild(page);
		try {
			const firstChunk = document.createElement('div');
			firstChunk.innerHTML = [
				'<div class="weave-annotation-note-root" data-book-id="book-1"></div>',
				'<h2 class="weave-annotation-note-chapter" data-chapter-key="chapter-0">第一章</h2>',
				'<div class="weave-annotation-note-line" data-chapter-key="chapter-0" data-chapter-title="第一章" data-semantic-id="theorem" data-semantic-label="定理" data-annotation-text="alpha">alpha</div>',
			].join('');
			page.appendChild(firstChunk);

			const processor = createEpubLinkPostProcessor({} as any);
			processor(firstChunk, { sourcePath: 'weave/epub-data/books/book-1/annotations.md' } as any);

			const chapterSelect = page.querySelector<HTMLSelectElement>('.weave-annotation-note-filter-chapter');
			expect(Array.from(chapterSelect?.options || []).map((option) => option.textContent)).toEqual([
				'全部章节',
				'第一章',
			]);

			const secondChunk = document.createElement('div');
			secondChunk.innerHTML = [
				'<h2 class="weave-annotation-note-chapter" data-chapter-key="chapter-1">第二章</h2>',
				'<div class="weave-annotation-note-line" data-chapter-key="chapter-1" data-chapter-title="第二章" data-semantic-id="mistake" data-semantic-label="易错" data-annotation-text="beta">beta</div>',
			].join('');
			page.appendChild(secondChunk);
			processor(secondChunk, { sourcePath: 'weave/epub-data/books/book-1/annotations.md' } as any);
			await Promise.resolve();

			expect(Array.from(chapterSelect?.options || []).map((option) => option.textContent)).toEqual([
				'全部章节',
				'第一章',
				'第二章',
			]);
			expect(page.querySelector('.weave-annotation-note-filter-count')?.textContent).toBe('2 / 2');
		} finally {
			document.body.innerHTML = '';
		}
	});

	it('supports legacy tuanki-cfi equals links even when the anchor is not marked as an internal link', async () => {
		const navigateSpy = vi
			.spyOn(EpubLinkService.prototype, 'navigateToEpubLocation')
			.mockResolvedValue(undefined);

		const container = document.createElement('div');
		container.innerHTML = '<a href="Books/demo.epub#tuanki-cfi=epubcfi(/6/2[chapter-1]!/4/4)">Legacy</a>';

		const processor = createEpubLinkPostProcessor({} as any);
		processor(container, {} as any);

		const link = container.querySelector('a');
		expect(link).not.toBeNull();

		link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(navigateSpy).toHaveBeenCalledTimes(1);
		expect(navigateSpy).toHaveBeenCalledWith(
			'Books/demo.epub',
			'epubcfi(/6/2[chapter-1]!/4/4)',
			'',
			undefined,
			undefined
		);
	});
});
