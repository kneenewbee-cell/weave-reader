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
