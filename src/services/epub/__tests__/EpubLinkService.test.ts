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
	setIcon: vi.fn(),
	normalizePath: (value: string) => String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, ''),
}));

const { navigateMock, ensureBookSourceLocationAccessMock, ensureSourceIdentityMock } = vi.hoisted(() => ({
	navigateMock: vi.fn(async () => ({ success: true, leaf: { id: "leaf-1" } })),
	ensureBookSourceLocationAccessMock: vi.fn(() => true),
	ensureSourceIdentityMock: vi.fn(async () => ({
		sourceId: "epubsrc-test123456789",
		sourceFingerprint: "demo-fingerprint",
	})),
}));

vi.mock('../../navigation/navigation-hub-access', () => ({
	getNavigationHub: () => ({
		navigate: navigateMock,
	}),
}));

vi.mock('../epub-storage-access', () => ({
	getEpubStorageService: () => ({
		ensureSourceIdentity: ensureSourceIdentityMock,
		resolveSupportedBookFilePath: vi.fn(() => "Books/demo.epub"),
	}),
}));

vi.mock('../epub-premium', () => ({
	ensureBookSourceLocationAccess: ensureBookSourceLocationAccessMock,
}));

import { TFile } from 'obsidian';
import { EpubLinkService } from '../EpubLinkService';
import { EPUB_RUNTIME } from '../epub-runtime';
import { PREMIUM_FEATURES } from '../../premium/PremiumFeatureGuard';

const encodeCompactField = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');

const buildCompactReadiumLocator = (href: string, progression: string, highlight?: string): string => {
	const fields = ['loc', encodeCompactField(href), progression, '', '', highlight ? encodeCompactField(highlight) : ''];
	while (fields.length > 1 && fields[fields.length - 1] === '') {
		fields.pop();
	}
	return `readium:${fields.join('~')}`;
};

describe('EpubLinkService legacy link compatibility', () => {
	it('routes note-to-book navigation through NavigationHub', async () => {
		navigateMock.mockReset();
		ensureBookSourceLocationAccessMock.mockReturnValue(true);
		navigateMock.mockResolvedValueOnce({ success: true, leaf: { id: 'leaf-1' } });
		const app = {} as any;
		const service = new EpubLinkService(app);

		await service.navigateToEpubLocation('Books/demo.epub', 'epubcfi(/6/2)', 'Hello');

		expect(navigateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'book',
				resourcePath: 'Books/demo.epub',
				locate: { cfi: 'epubcfi(/6/2)', text: 'Hello' },
			})
		);
	});

	it('does not navigate to book locations when source location is unavailable', async () => {
		navigateMock.mockReset();
		ensureBookSourceLocationAccessMock.mockReturnValueOnce(false);
		const app = {} as any;
		const service = new EpubLinkService(app);

		await service.navigateToEpubLocation('Books/demo.cbz', 'epubcfi(/6/2)', 'Page 3');

		expect(navigateMock).not.toHaveBeenCalled();
	});

	it('extracts the first EPUB wikilink for both current and legacy hash formats', () => {
		const current = '前文 [[Books/demo.epub#weave-cfi=readium%3Aabc|Demo]] 后文';
		const legacyDash = '前文 [[Books/demo.epub#tuanki-cfi-epubcfi(/6/2[chapter-1]!/4/4)|Demo]] 后文';
		const legacyEquals = '前文 [[Books/demo.epub#tuanki-cfi=epubcfi(/6/2[chapter-1]!/4/4)|Demo]] 后文';

		expect(EpubLinkService.extractFirstEpubLinkMarkup(current)).toBe('[[Books/demo.epub#weave-cfi=readium%3Aabc|Demo]]');
		expect(EpubLinkService.extractFirstEpubLinkMarkup(legacyDash)).toBe('[[Books/demo.epub#tuanki-cfi-epubcfi(/6/2[chapter-1]!/4/4)|Demo]]');
		expect(EpubLinkService.extractFirstEpubLinkMarkup(legacyEquals)).toBe('[[Books/demo.epub#tuanki-cfi=epubcfi(/6/2[chapter-1]!/4/4)|Demo]]');
	});

	it('parses FB2 wikilinks with relative attachment paths and parentheses in filenames', () => {
		const markup =
			'[[../../附件/史蒂夫 · 乔布斯传 (修订版) = Steve Jobs A Biography ([美] 沃尔特 · 艾萨克森 (Walter Isaacson) 著 管延圻 etc.) (z-library.sk, 1lib.sk, z-lib.sk).fb2#weave-cfi=epubcfi(/6/22!/4/2/18,/1:0,/1:18)&text=1972%E5%B9%B4%E6%98%A5%E5%A4%A9%EF%BC%8C%E4%B9%94%E5%B8%83%E6%96%AF%E5%8D%B3%E5%B0%86%E9%AB%98%E4%B8%AD%E6%AF%95%E4%B8%9A%E6%97%B6&chapter=10|史蒂夫 · 乔布斯传]]';

		expect(EpubLinkService.extractFirstEpubLinkMarkup(markup)).toBe(markup);
		expect(EpubLinkService.parseLinkMarkup(markup)).toEqual({
			filePath: '../../附件/史蒂夫 · 乔布斯传 (修订版) = Steve Jobs A Biography ([美] 沃尔特 · 艾萨克森 (Walter Isaacson) 著 管延圻 etc.) (z-library.sk, 1lib.sk, z-lib.sk).fb2',
			cfi: 'epubcfi(/6/22!/4/2/18,/1:0,/1:18)',
			text: '1972年春天，乔布斯即将高中毕业时',
			chapter: 10,
		});
	});

	it('extracts the first book wikilink for non-epub supported formats', () => {
		const txtLink = '[[Books/novel.txt#weave-cfi=epubcfi(/6/2)&text=Hello|novel]]';
		const mobiLink = '[[Books/demo.mobi#weave-loc=compact|demo]]';

		expect(EpubLinkService.extractFirstEpubLinkMarkup(`前文 ${txtLink} 后文`)).toBe(txtLink);
		expect(EpubLinkService.extractFirstEpubLinkMarkup(`前文 ${mobiLink} 后文`)).toBe(mobiLink);
		expect(EpubLinkService.collectEpubLinkMarkups(`混合 ${txtLink} ${mobiLink}`)).toEqual([
			txtLink,
			mobiLink,
		]);
	});

	it('extracts legacy protocol EPUB links and resolves their file paths', () => {
		const protocolLink = '[EPUB来源](obsidian://weave-epub?vault=Vault&file=Books%2Fdemo.epub&cfi=epubcfi(/6/2)&text=Hello)';

		expect(EpubLinkService.extractFirstEpubLinkMarkup(protocolLink)).toBe(protocolLink);
		expect(EpubLinkService.extractFilePathFromEpubLinkMarkup(protocolLink)).toBe('Books/demo.epub');
	});

	it('parses both legacy tuanki subpaths and readium subpaths', () => {
		expect(EpubLinkService.parseEpubLink('#tuanki-cfi-epubcfi(/6/2[chapter-1]!/4/4)')).toEqual({
			filePath: '',
			cfi: 'epubcfi(/6/2[chapter-1]!/4/4)',
			text: '',
			chapter: undefined,
		});

		expect(EpubLinkService.parseEpubLink('#tuanki-cfi=epubcfi(/6/2[chapter-1]!/4/4)')).toEqual({
			filePath: '',
			cfi: 'epubcfi(/6/2[chapter-1]!/4/4)',
			text: '',
			chapter: undefined,
		});

		expect(EpubLinkService.parseEpubLink('#weave-cfi=readium%3Aabc&chapter=3&text=Hello%20world')).toEqual({
			filePath: '',
			cfi: 'readium:abc',
			text: 'Hello world',
			chapter: 3,
		});
	});

	it('parses complete EPUB link markup for both current wikilinks and legacy protocol links', () => {
		expect(EpubLinkService.parseLinkMarkup('[[Books/demo.epub#weave-cfi=readium%3Aabc&chapter=3&text=Hello%20world|Demo]]')).toEqual({
			filePath: 'Books/demo.epub',
			cfi: 'readium:abc',
			text: 'Hello world',
			chapter: 3,
		});

		expect(EpubLinkService.parseLinkMarkup('[EPUB来源](obsidian://weave-epub?vault=Vault&file=Books%2Fdemo.epub&cfi=epubcfi(/6/2)&text=Hello)')).toEqual({
			filePath: 'Books/demo.epub',
			cfi: 'epubcfi(/6/2)',
			text: 'Hello',
			chapter: undefined,
		});
	});

	it('builds vault-internal locator hrefs for post-processor navigation', () => {
		expect(
			EpubLinkService.buildEpubLocatorHref(
				'Books/demo.epub',
				'epubcfi(/6/2)',
				'Hello',
				3,
				'epubsrc-demo',
				'excerpt-fixed'
			)
		).toBe('Books/demo.epub#weave-cfi=epubcfi(/6/2)&sid=epubsrc-demo&eid=excerpt-fixed');
		expect(
			EpubLinkService.buildEpubLocatorHref(
				'Books/demo.epub',
				'epubcfi(/6/2)',
				'Hello',
				3,
				'epubsrc-demo',
				undefined,
				{ includeChapter: true }
			)
		).toBe('Books/demo.epub#weave-cfi=epubcfi(/6/2)&chapter=3&sid=epubsrc-demo');
	});

	it('builds canonical obsidian protocol links without vault restrictions', () => {
		const service = new EpubLinkService({} as any);
		const href = service.buildObsidianProtocolHref('附件/百年孤独.epub', 'epubcfi(/6/18!/4/2)', {
			chapter: 8,
			sourceId: 'epubsrc-b37d62ebb025f244ebc01ee6',
		});

		expect(href.startsWith(`obsidian://${EPUB_RUNTIME.protocol.primaryName}?`)).toBe(true);
		expect(href).not.toMatch(/vault=/i);
		expect(href).toContain('file=');
		expect(href).toContain('cfi=');
		expect(href).toContain('chapter=8');
		expect(href).toContain('sid=epubsrc-b37d62ebb025f244ebc01ee6');

		const markdown = service.buildProtocolMarkdownLink(
			'附件/百年孤独.epub',
			'epubcfi(/6/18!/4/2)',
			'Hello',
			8,
			'part0007',
			'epubsrc-b37d62ebb025f244ebc01ee6'
		);
		expect(markdown).toMatch(
			new RegExp(`^\\[[^\\]]+part0007[^\\]]*\\]\\(obsidian://${EPUB_RUNTIME.protocol.primaryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?`)
		);
		expect(EpubLinkService.parseLinkMarkup(markdown)).toEqual({
			filePath: '附件/百年孤独.epub',
			cfi: 'epubcfi(/6/18!/4/2)',
			text: '',
			chapter: 8,
			sourceId: 'epubsrc-b37d62ebb025f244ebc01ee6',
		});
	});

	it('treats only vault-bound protocol links as legacy', () => {
		const legacy =
			'[EPUB来源](obsidian://weave-epub?vault=Vault&file=Books%2Fdemo.epub&cfi=epubcfi(/6/2)&text=Hello)';
		const canonical = `[百年孤独](obsidian://${EPUB_RUNTIME.protocol.primaryName}?file=Books%2Fdemo.epub&cfi=epubcfi(/6/2)&chapter=8&sid=epubsrc-demo)`;

		expect(EpubLinkService.isLegacyProtocolHref(legacy)).toBe(true);
		expect(EpubLinkService.isLegacyEpubLinkMarkup(legacy)).toBe(true);
		expect(EpubLinkService.isLegacyProtocolHref(canonical)).toBe(false);
		expect(EpubLinkService.isLegacyEpubLinkMarkup(canonical)).toBe(false);
	});

	it('does not migrate canonical protocol links to wikilinks', () => {
		const service = new EpubLinkService({} as any);
		const canonical = `[百年孤独](obsidian://${EPUB_RUNTIME.protocol.primaryName}?file=Books%2Fdemo.epub&cfi=epubcfi(/6/2)&chapter=8&sid=epubsrc-demo)`;
		const migrated = service.migrateLegacyEpubLinksInContent(`前文 ${canonical} 后文`);

		expect(migrated.changed).toBe(false);
		expect(migrated.content).toBe(`前文 ${canonical} 后文`);
	});

	it('uses canonical vault paths for portable links and relative paths only when a source note is provided', () => {
		const bookFile = new TFile();
		const app = {
			vault: {
				getAbstractFileByPath: (path: string) => (path === 'Books/demo.epub' ? bookFile : null),
			},
			fileManager: {
				generateMarkdownLink: vi.fn(() => '[[../Books/demo.epub]]'),
			},
		};
		const service = new EpubLinkService(app as any);

		expect(service.buildEpubLink('Books/demo.epub', 'readium:abc', 'Hello')).toMatch(
			/^\[\[Books\/demo\.epub#weave-cfi=/
		);
		expect(app.fileManager.generateMarkdownLink).not.toHaveBeenCalled();

		const relative = service.buildEpubLink(
			'Books/demo.epub',
			'readium:abc',
			'Hello',
			undefined,
			undefined,
			'Notes/deep/note.md'
		);
		expect(relative).toMatch(/^\[\[\.\.\/Books\/demo\.epub#weave-cfi=/);
		expect(app.fileManager.generateMarkdownLink).toHaveBeenCalled();
	});

	it('builds compact cfi-only wikilinks for new excerpts', () => {
		const service = new EpubLinkService({} as any);

		const built = service.buildEpubLink(
			'Books/demo.epub',
			'readium:abc',
			'Hello world',
			3,
			'Part 1 | Intro ]]'
		);

		expect(built).toMatch(/^\[\[Books\/demo\.epub#weave-cfi=/);
		expect(built).not.toContain('&text=');
		expect(EpubLinkService.parseLinkMarkup(built)).toEqual({
			filePath: 'Books/demo.epub',
			cfi: 'readium:abc',
			text: '',
			chapter: undefined,
			sourceId: undefined,
			excerptId: undefined,
		});
	});

	it('preserves source identity inside epub source links', () => {
		const service = new EpubLinkService({} as any);
		const built = service.buildEpubLink(
			'Books/demo.epub',
			'epubcfi(/6/2)',
			'Hello',
			undefined,
			undefined,
			undefined,
			'epubsrc-fixed'
		);

		expect(built).toMatch(/^\[\[Books\/demo\.epub#weave-cfi=.*&sid=epubsrc-fixed\|demo\]\]$/);
		expect(built).not.toContain('&text=');
		expect(EpubLinkService.parseLinkMarkup(built)).toEqual({
			filePath: 'Books/demo.epub',
			cfi: 'epubcfi(/6/2)',
			text: '',
			chapter: undefined,
			sourceId: 'epubsrc-fixed',
		});
	});

	it('preserves excerpt identity inside epub source links', () => {
		const service = new EpubLinkService({} as any);
		const built = service.buildEpubLink(
			'Books/demo.epub',
			'epubcfi(/6/4)',
			'Hello excerpt',
			undefined,
			undefined,
			undefined,
			'epubsrc-fixed',
			'excerpt-fixed'
		);

		expect(built).toMatch(/&sid=epubsrc-fixed&eid=excerpt-fixed\|demo\]\]$/);
		expect(built).not.toContain('&text=');
		expect(EpubLinkService.parseLinkMarkup(built)).toEqual({
			filePath: 'Books/demo.epub',
			cfi: 'epubcfi(/6/4)',
			text: '',
			chapter: undefined,
			sourceId: 'epubsrc-fixed',
			excerptId: 'excerpt-fixed',
		});
	});

	it('keeps compact readium locators short without duplicating text payloads', () => {
		const service = new EpubLinkService({} as any);
		const compactLocator = buildCompactReadiumLocator('OPS/text/chapter1.xhtml', '0.125', 'Hello world');

		expect(EpubLinkService.extractEmbeddedTextFromReadiumLocator(compactLocator)).toBe('Hello world');
		expect(EpubLinkService.parseEpubLink(`#weave-cfi=${compactLocator}&chapter=3`)).toEqual({
			filePath: '',
			cfi: compactLocator,
			text: 'Hello world',
			chapter: 3,
		});
		expect(service.buildEpubLink(
			'Books/demo.epub',
			compactLocator,
			'Hello world',
			3,
			'Part 1',
		)).toMatch(/^\[\[Books\/demo\.epub#weave-cfi=/);
	});

	it('renders quote blocks with chapter and timestamp outside the link body', () => {
		const service = new EpubLinkService({} as any);

		expect(service.buildQuoteBlock(
			'Books/demo.epub',
			'readium:abc',
			'Hello world',
			14,
			'red',
			'根据意图评判我们的行动',
			'2026-03-26 19:08',
			undefined,
			'epubsrc-demo',
			'excerpt-fixed'
		)).toMatch(
			/^> \[!EPUB\|red\] \[\[Books\/demo\.epub#weave-cfi=readium:abc(?:&[^|]+)*&eid=excerpt-fixed\|demo\]\] \[根据意图评判我们的行动\] 2026-03-26 19:08\n> Hello world\n$/
		);
		expect(service.buildQuoteBlock(
			'Books/demo.epub',
			'readium:abc',
			'Hello world',
			14,
			'red',
			'根据意图评判我们的行动',
			'2026-03-26 19:08',
			undefined,
			'epubsrc-demo',
			'excerpt-fixed'
		)).not.toContain('&text=');
	});

	it('builds and parses combined highlight color and style metadata', () => {
		expect(EpubLinkService.buildHighlightCalloutMeta('blue', 'underline')).toBe('blue+underline');
		expect(EpubLinkService.buildHighlightCalloutMeta('pink', 'wavy')).toBe('pink+wavy');
		expect(EpubLinkService.buildHighlightCalloutMeta('orange', undefined, 'exam point')).toBe('orange+semantic:exam%20point');
		expect(EpubLinkService.parseHighlightCalloutMeta('purple+wavy')).toEqual({
			color: 'purple',
			style: 'wavy',
		});
		expect(EpubLinkService.parseHighlightCalloutMeta('orange+semantic:exam%20point')).toEqual({
			color: 'orange',
			style: undefined,
			semanticId: 'exam point',
		});
		expect(EpubLinkService.parseHighlightCalloutMeta('underline red')).toEqual({
			color: 'red',
			style: 'underline',
		});
	});

	it('renders styled quote blocks with color and style metadata', () => {
		const service = new EpubLinkService({} as any);

		expect(service.buildQuoteBlock(
			'Books/demo.epub',
			'readium:styled',
			'Underline me',
			2,
			'green',
			'第二章',
			undefined,
			undefined,
			undefined,
			undefined,
			'underline'
		)).toMatch(
			/^> \[!EPUB\|green\+underline\] \[\[Books\/demo\.epub#weave-cfi=readium:styled(?:&[^|]+)*\|demo\]\] \[第二章\]\n> Underline me\n$/
		);
	});

	it('renders strikethrough quote blocks with markdown deletion source text', () => {
		const service = new EpubLinkService({} as any);

		expect(service.buildQuoteBlock(
			'Books/demo.epub',
			'readium:hidden',
			'Hide me',
			5,
			'purple',
			'第五章',
			undefined,
			undefined,
			undefined,
			undefined,
			'strikethrough'
		)).toMatch(
			/^> \[!EPUB\|purple\+strikethrough\] \[\[Books\/demo\.epub#weave-cfi=readium:hidden(?:&[^|]+)*\|demo\]\] \[第五章\]\n> ~~Hide me~~\n$/
		);
	});

	it('detects and migrates legacy epub links inside content', () => {
		const service = new EpubLinkService({} as any);
		const content = [
			'前文 [[Books/demo.epub#weave-cfi=readium%3Aabc&chapter=3&text=Hello%20world|摘录]]',
			'[EPUB来源](obsidian://weave-epub?vault=Vault&file=Books%2Fdemo.epub&cfi=epubcfi(/6/2)&text=Hello)',
			'后文 [[Books/demo.epub#weave-cfi=readium:xyz|demo]]',
		].join('\n');

		expect(
			EpubLinkService.isLegacyEpubLinkMarkup(
				'[[Books/demo.epub#weave-cfi=readium%3Aabc&chapter=3&text=Hello%20world|摘录]]'
			)
		).toBe(true);
		expect(
			EpubLinkService.isLegacyEpubLinkMarkup('[[Books/demo.epub#weave-cfi=readium:xyz|demo]]')
		).toBe(false);

		const migrated = service.migrateLegacyEpubLinksInContent(content);
		expect(migrated.changed).toBe(true);
		expect(migrated.updatedLinks).toBe(2);
		const lines = migrated.content.split('\n');
		expect(lines[0]).toMatch(/^前文 \[\[Books\/demo\.epub#weave-cfi=readium:abc(?:&[^|]+)*\|demo\]\]$/);
		expect(lines[0]).not.toContain('&text=');
		expect(lines[1]).toMatch(/^\[\[Books\/demo\.epub#weave-cfi=epubcfi\(\/6\/2\)(?:&[^|]+)*\|demo\]\]$/);
		expect(lines[1]).not.toContain('&text=');
		expect(lines[2]).toBe('后文 [[Books/demo.epub#weave-cfi=readium:xyz|demo]]');
		expect(EpubLinkService.parseLinkMarkup(lines[0].replace(/^前文 /, ''))).toEqual({
			filePath: 'Books/demo.epub',
			cfi: 'readium:abc',
			text: '',
			chapter: undefined,
			sourceId: undefined,
			excerptId: undefined,
		});
		expect(EpubLinkService.parseLinkMarkup(lines[1])).toEqual({
			filePath: 'Books/demo.epub',
			cfi: 'epubcfi(/6/2)',
			text: '',
			chapter: undefined,
			sourceId: undefined,
			excerptId: undefined,
		});
	});

	it('enriches existing epub links with source ids without changing the locator', async () => {
		const writtenFiles = new Map<string, string>();
		const service = new EpubLinkService({} as any);

		const result = await service.enrichEpubLinksWithSourceIdsInContent(
			'前文 [[Books/demo.epub#weave-cfi=readium:abc|demo]] 后文'
		);

		expect(result.changed).toBe(true);
		expect(result.updatedLinks).toBe(1);
		expect(result.content).toMatch(/\[\[Books\/demo\.epub#weave-cfi=readium:abc&sid=epubsrc-/);
	});

	it('migrates legacy protocol epub links to new wikilinks before backfilling source ids', async () => {
		const writtenFiles = new Map<string, string>();
		const service = new EpubLinkService({} as any);

		const result = await service.enrichEpubLinksWithSourceIdsInContent(
			'[EPUB来源](obsidian://weave-epub?vault=Vault&file=Books%2Fdemo.epub&cfi=epubcfi(/6/2)&text=Hello)',
			'Notes/demo.md'
		);

		expect(result.changed).toBe(true);
		expect(result.updatedLinks).toBe(2);
		expect(result.content).toMatch(
			/^\[\[Books\/demo\.epub#weave-cfi=epubcfi\(\/6\/2\)(?:&[^|]+)*&sid=epubsrc-[^|]+\|demo\]\]$/
		);
		expect(result.content).not.toContain('&text=');
	});

	it('compresses long epubcfi locators with weave-loc payloads', () => {
		const service = new EpubLinkService({} as any);
		const longCfi =
			'epubcfi(/6/22!/4[8IL20-1efb9360294f40a08e8dc1dedc51b416]/8,/1:0,/1:20)';

		const built = service.buildEpubLink(
			'Books/demo.epub',
			longCfi,
			'伊壁鸠鲁不要智者去预料和操心未来。',
			10,
			undefined,
			undefined,
			'epubsrc-demo',
			'we-abc123',
			{ preferCompactLocator: true }
		);

		expect(built).toContain('#weave-loc=');
		expect(built).not.toContain('&text=');
		expect(built).toContain('&eid=we-abc123');
		expect(EpubLinkService.parseLinkMarkup(built)).toEqual({
			filePath: 'Books/demo.epub',
			cfi: longCfi,
			text: '',
			chapter: undefined,
			sourceId: 'epubsrc-demo',
			excerptId: 'we-abc123',
		});
	});

	it('keeps callout source links short even when quote body contains nested epub links', () => {
		const service = new EpubLinkService({} as any);
		const nestedBody =
			'伊壁鸠鲁不要智者去预料和操心未来。\n[!EPUB|green] [[10-项目/Tuanki开发/随桥鸟飞行  复杂系统的奇境 (乔治•帕里西) (Z-Library).epub#weave-cfi=epubcfi(/6/54!/4/4,/1:0,/1:40)&sid=epubsrc-mowyj7am112pwe|随桥鸟飞行]]';

		const quoteBlock = service.buildQuoteBlock(
			'附件/蒙田随笔全集.epub',
			'epubcfi(/6/22!/4[8IL20-1efb9360294f40a08e8dc1dedc51b416]/8,/1:0,/1:20)',
			nestedBody,
			10,
			'green',
			'part0011 split 0000',
			'2026-05-10 09:17',
			'Notes/demo.md',
			'epubsrc-montaigne',
			'we-montaigne'
		);

		const headerLine = quoteBlock.split('\n')[0] || '';
		expect(headerLine.length).toBeLessThan(320);
		expect(headerLine).not.toContain('&text=');
		expect(headerLine).toContain('&eid=we-montaigne');
		expect(quoteBlock).toContain(nestedBody.split('\n')[0]);
		expect(quoteBlock).not.toMatch(/\^we-montaigne/);
	});

	it('builds selection toolbar copy links without duplicating quote text in vault wikilinks', () => {
		const service = new EpubLinkService({} as any);
		const vaultLink = service.buildSelectionCopyLink(
			'vaultWikilink',
			'Books/demo.epub',
			'epubcfi(/6/22!/4/8,/1:0,/1:20)',
			'Hello world',
			{ chapterIndex: 3, sourceId: 'epubsrc-demo' }
		);

		expect(vaultLink).toMatch(/^\[\[Books\/demo\.epub#/);
		expect(vaultLink).not.toContain('&text=');
		expect(vaultLink).toContain('&chapter=3');
		expect(vaultLink).toContain('&sid=epubsrc-demo');
	});
});
