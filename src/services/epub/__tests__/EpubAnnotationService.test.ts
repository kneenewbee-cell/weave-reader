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

import { EpubAnnotationService } from '../EpubAnnotationService';
import { PROFILE_FORMAT, PROFILE_VERSION } from '../semantic/profiles';
import {
	clearBookEpubPortableSemanticAnnotations,
	readEffectiveEpubPortableAnnotations,
} from '../semantic/semantic-store';

function createPortableMockApp(files: Record<string, unknown>, folders: string[] = []) {
	const normalize = (value: string) => String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
	const serialized = new Map(
		Object.entries(files).map(([path, value]) => [normalize(path), JSON.stringify(value)])
	);
	const folderSet = new Set(folders.map((folder) => normalize(folder)));
	return {
		vault: {
			adapter: {
				exists: vi.fn(async (path: string) => serialized.has(normalize(path)) || folderSet.has(normalize(path))),
				read: vi.fn(async (path: string) => serialized.get(normalize(path)) ?? ''),
				write: vi.fn(async (path: string, value: string) => {
					serialized.set(normalize(path), value);
				}),
				mkdir: vi.fn(async (path: string) => {
					folderSet.add(normalize(path));
				}),
				list: vi.fn(async (path: string) => {
					const root = normalize(path);
					const prefix = `${root}/`;
					const childFolders = Array.from(folderSet)
						.filter((folder) => folder.startsWith(prefix))
						.filter((folder) => !folder.slice(prefix.length).includes('/'));
					return { files: [], folders: childFolders };
				}),
			},
		},
	};
}

describe('EpubAnnotationService', () => {
	it('replaces an existing portable annotation when the same range receives a different semantic', async () => {
		const bookId = 'epub-book-replace';
		const app = createPortableMockApp({
			'weave/epub-data/semantic-profiles/default.json': {
				format: PROFILE_FORMAT,
				version: PROFILE_VERSION,
				scope: 'global',
				annotationSemanticsEnabled: true,
				semanticSchemeId: 'custom',
				semantics: [
					{
						id: 'important',
						label: '重点',
						color: 'yellow',
						style: 'highlight',
						group: 'study',
						source: 'custom',
						active: true,
					},
					{
						id: 'question',
						label: '疑问',
						color: 'purple',
						style: 'wavy',
						group: 'study',
						source: 'custom',
						active: true,
					},
				],
			},
			[`weave/epub-data/books/${bookId}/annotations.json`]: {
				format: 'weave-reader-annotations/v1',
				version: 1,
				bookId,
				annotations: [
					{
						cfiRange: 'epubcfi(/6/2!/4/2)',
						semanticId: 'important',
						text: 'Marked text',
						chapterIndex: 1,
						chapterTitle: 'Chapter one',
						createdTime: 100,
					},
				],
			},
		});
		const storageService = {
			getApp: vi.fn(() => app),
			removeLegacyHighlights: vi.fn(async () => {}),
			getCanvasBinding: vi.fn(async () => null),
		} as any;
		const service = new EpubAnnotationService(storageService);

		const result = await service.savePortableHighlightWithPolicy(bookId, {
			cfiRange: 'epubcfi(/6/2!/4/2)',
			color: 'purple',
			style: 'wavy',
			text: 'Marked text',
			semanticId: 'question',
			semanticLabel: '疑问',
			chapterIndex: 1,
			chapterTitle: 'Chapter one',
			createdTime: 200,
			presentation: 'highlight',
		});

		expect(result.kind).toBe('replace');
		expect(result.previous?.semanticId).toBe('important');
		expect(result.current.semanticId).toBe('question');
		const payload = await readEffectiveEpubPortableAnnotations(app as any, bookId);
		expect(payload.annotations).toHaveLength(1);
		expect(payload.annotations[0]).toMatchObject({
			semanticId: 'question',
			text: 'Marked text',
		});
	});

	it('does not duplicate an existing portable annotation with the same range and semantic', async () => {
		const bookId = 'epub-book-duplicate';
		const app = createPortableMockApp({
			[`weave/epub-data/books/${bookId}/annotations.json`]: {
				format: 'weave-reader-annotations/v1',
				version: 1,
				bookId,
				annotations: [
					{
						cfiRange: 'epubcfi(/6/2!/4/2)',
						semanticId: 'important',
						color: 'yellow',
						text: 'Marked text',
						createdTime: 100,
					},
				],
			},
		});
		const storageService = {
			getApp: vi.fn(() => app),
			removeLegacyHighlights: vi.fn(async () => {}),
			getCanvasBinding: vi.fn(async () => null),
		} as any;
		const service = new EpubAnnotationService(storageService);

		const result = await service.savePortableHighlightWithPolicy(bookId, {
			cfiRange: 'epubcfi(/6/2!/4/2)',
			color: 'yellow',
			text: 'Marked text',
			semanticId: 'important',
			createdTime: 200,
			presentation: 'highlight',
		});

		expect(result.kind).toBe('duplicate');
		const payload = await readEffectiveEpubPortableAnnotations(app as any, bookId);
		expect(payload.annotations).toHaveLength(1);
		expect(payload.annotations[0]).toMatchObject({
			semanticId: 'important',
			createdTime: 100,
		});
	});

	it('keeps partially overlapping portable annotations as separate records', async () => {
		const bookId = 'epub-book-overlap';
		const app = createPortableMockApp({
			[`weave/epub-data/books/${bookId}/annotations.json`]: {
				format: 'weave-reader-annotations/v1',
				version: 1,
				bookId,
				annotations: [
					{
						cfiRange: 'epubcfi(/6/2!/4/2,/6/2!/4/10)',
						semanticId: 'important',
						color: 'yellow',
						text: 'Text from one to ten',
						createdTime: 100,
					},
				],
			},
		});
		const storageService = {
			getApp: vi.fn(() => app),
			removeLegacyHighlights: vi.fn(async () => {}),
			getCanvasBinding: vi.fn(async () => null),
		} as any;
		const service = new EpubAnnotationService(storageService);

		const result = await service.savePortableHighlightWithPolicy(bookId, {
			cfiRange: 'epubcfi(/6/2!/4/5,/6/2!/4/15)',
			color: 'purple',
			text: 'Text from five to fifteen',
			semanticId: 'question',
			createdTime: 101,
			presentation: 'highlight',
		});

		expect(result.kind).toBe('create');
		const payload = await readEffectiveEpubPortableAnnotations(app as any, bookId);
		expect(payload.annotations).toHaveLength(2);
		expect(payload.annotations.map((annotation: any) => annotation.semanticId)).toEqual([
			'important',
			'question',
		]);
	});

	it('replaces one portable annotation by identity so comments can be updated', async () => {
		const bookId = 'epub-book-comment';
		const app = createPortableMockApp({
			[`weave/epub-data/books/${bookId}/annotations.json`]: {
				format: 'weave-reader-annotations/v1',
				version: 1,
				bookId,
				annotations: [
					{
						cfiRange: 'epubcfi(/6/2!/4/2)',
						semanticId: 'important',
						color: 'yellow',
						text: 'Marked text',
						createdTime: 100,
					},
				],
			},
		});
		const storageService = {
			getApp: vi.fn(() => app),
			removeLegacyHighlights: vi.fn(async () => {}),
			getCanvasBinding: vi.fn(async () => null),
		} as any;
		const service = new EpubAnnotationService(storageService);

		const result = await service.replacePortableHighlight(
			bookId,
			{
				cfiRange: 'epubcfi(/6/2!/4/2)',
				color: 'yellow',
				text: 'Marked text',
				semanticId: 'important',
				createdTime: 100,
				presentation: 'highlight',
			},
			{
				cfiRange: 'epubcfi(/6/2!/4/2)',
				color: 'yellow',
				text: 'Marked text',
				semanticId: 'important',
				commentText: 'New comment',
				hasCommentDivider: true,
				createdTime: 100,
				presentation: 'highlight',
			}
		);

		expect(result.previous?.commentText).toBeUndefined();
		expect(result.current.commentText).toBe('New comment');
		const payload = await readEffectiveEpubPortableAnnotations(app as any, bookId);
		expect(payload.annotations).toHaveLength(1);
		expect(payload.annotations[0]).toMatchObject({
			semanticId: 'important',
			commentText: 'New comment',
			hasCommentDivider: true,
		});
	});

	it('removes one portable annotation by reader highlight identity', async () => {
		const bookId = 'epub-book-undo';
		const app = createPortableMockApp({
			'weave/epub-data/semantic-profiles/default.json': {
				format: PROFILE_FORMAT,
				version: PROFILE_VERSION,
				scope: 'global',
				annotationSemanticsEnabled: true,
				semanticSchemeId: 'custom',
				semantics: [
					{
						id: 'important',
						label: '重点',
						color: 'yellow',
						style: 'highlight',
						group: 'study',
						source: 'custom',
						active: true,
					},
					{
						id: 'question',
						label: '疑问',
						color: 'purple',
						style: 'wavy',
						group: 'study',
						source: 'custom',
						active: true,
					},
				],
			},
			[`weave/epub-data/books/${bookId}/annotations.json`]: {
				format: 'weave-reader-annotations/v1',
				version: 1,
				bookId,
				annotations: [
					{
						cfiRange: 'epubcfi(/6/2!/4/2)',
						semanticId: 'important',
						text: 'Marked text',
						chapterIndex: 1,
						chapterTitle: 'Chapter one',
						createdTime: 100,
					},
					{
						cfiRange: 'epubcfi(/6/4!/4/2)',
						semanticId: 'question',
						text: 'Other text',
						chapterIndex: 1,
						chapterTitle: 'Chapter one',
						createdTime: 101,
					},
				],
			},
		});
		const storageService = {
			getApp: vi.fn(() => app),
			removeLegacyHighlights: vi.fn(async () => {}),
			getCanvasBinding: vi.fn(async () => null),
		} as any;
		const service = new EpubAnnotationService(storageService);

		const removed = await service.removePortableHighlight(bookId, {
			cfiRange: 'epubcfi(/6/2!/4/2)',
			color: 'yellow',
			text: 'Marked text',
			semanticId: 'important',
			presentation: 'highlight',
		});

		expect(removed).toMatchObject({
			cfiRange: 'epubcfi(/6/2!/4/2)',
			semanticId: 'important',
			text: 'Marked text',
			chapterIndex: 1,
			chapterTitle: 'Chapter one',
		});
		const payload = await readEffectiveEpubPortableAnnotations(app as any, bookId);
		expect(payload.annotations).toHaveLength(1);
		expect(payload.annotations[0]).toMatchObject({
			cfiRange: 'epubcfi(/6/4!/4/2)',
			semanticId: 'question',
			text: 'Other text',
		});
	});

	it('clears legacy stored highlights at most once per book and keeps backlink highlights as the live source', async () => {
		let concealedTexts: any[] = [];

		const storageService = {
			removeLegacyHighlights: vi.fn(async () => {}),
			loadConcealedTexts: vi.fn(async () => concealedTexts),
			saveConcealedTexts: vi.fn(async (_bookId: string, nextConcealedTexts: typeof concealedTexts) => {
				concealedTexts = nextConcealedTexts;
			}),
			getCanvasBinding: vi.fn(async () => null),
		} as any;

		const backlinkHighlights = [
			{
				cfiRange: 'epubcfi(/6/2[chapter-1]!/4/2)',
				color: 'green',
				text: 'Live highlight',
				sourceFile: 'Notes/demo.md',
				sourceRef: 'block-ref',
				createdTime: 2,
				presentation: 'highlight',
			},
		];
		const backlinkService = {
			collectHighlights: vi.fn(async () => backlinkHighlights),
		} as any;

		const service = new EpubAnnotationService(storageService);

		await expect(service.collectAllHighlights('book-1', 'Books/demo.epub', backlinkService)).resolves.toEqual([
			{
				...backlinkHighlights[0],
				sourceLocators: [
					{
						sourceFile: 'Notes/demo.md',
						sourceRef: 'block-ref',
					},
				],
			},
		]);
		expect(storageService.removeLegacyHighlights).toHaveBeenCalledTimes(1);

		await expect(service.collectAllHighlights('book-1', 'Books/demo.epub', backlinkService)).resolves.toEqual([
			{
				...backlinkHighlights[0],
				sourceLocators: [
					{
						sourceFile: 'Notes/demo.md',
						sourceRef: 'block-ref',
					},
				],
			},
		]);
		expect(backlinkService.collectHighlights).toHaveBeenCalledTimes(1);

		service.invalidateCollectedHighlightsCache('book-1', 'Books/demo.epub');

		await expect(service.collectAllHighlights('book-1', 'Books/demo.epub', backlinkService)).resolves.toEqual([
			{
				...backlinkHighlights[0],
				sourceLocators: [
					{
						sourceFile: 'Notes/demo.md',
						sourceRef: 'block-ref',
					},
				],
			},
		]);
		expect(backlinkService.collectHighlights).toHaveBeenCalledTimes(2);
	});

	it('loads portable annotations from the only legacy book folder when the current runtime book id is empty', async () => {
		const currentBookId = 'epub-book-rv441q';
		const legacyBookId = 'epub-book-i6zqes';
		const app = createPortableMockApp(
			{
				'weave/epub-data/index.json': {
					books: {
						[currentBookId]: { bookId: currentBookId },
					},
				},
				'weave/epub-data/semantic-profiles/default.json': {
					format: PROFILE_FORMAT,
					version: PROFILE_VERSION,
					scope: 'global',
					annotationSemanticsEnabled: true,
					semanticSchemeId: 'custom',
					semantics: [
						{
							id: 'important',
							label: 'Important',
							color: 'blue',
							style: 'underline',
							group: 'study',
							description: 'Portable semantic mapping',
							showInStandard: true,
							source: 'preset',
							active: true,
						},
					],
					standardSemanticIds: ['important'],
					updatedAt: 1,
				},
				[`weave/epub-data/books/${legacyBookId}/annotations.json`]: {
					format: 'weave-reader-annotations/v1',
					version: 1,
					bookId: legacyBookId,
					updatedAt: 2,
					annotations: [
						{
							cfiRange: 'epubcfi(/6/4)',
							semanticId: 'important',
							text: 'Portable highlight',
							chapterIndex: 1,
							chapterTitle: 'Chapter',
							createdTime: 3,
						},
					],
				},
			},
			[
				'weave/epub-data/books',
				`weave/epub-data/books/${currentBookId}`,
				`weave/epub-data/books/${legacyBookId}`,
			]
		);

		const storageService = {
			getApp: vi.fn(() => app),
			removeLegacyHighlights: vi.fn(async () => {}),
			loadConcealedTexts: vi.fn(async () => []),
			getCanvasBinding: vi.fn(async () => null),
		} as any;
		const backlinkService = {
			collectHighlights: vi.fn(async () => []),
		} as any;
		const service = new EpubAnnotationService(storageService);

		await expect(service.collectAllHighlights(currentBookId, 'Books/demo.epub', backlinkService)).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'epubcfi(/6/4)',
				text: 'Portable highlight',
				semanticId: 'important',
				semanticLabel: 'Important',
				color: 'blue',
				style: 'underline',
				presentation: 'highlight',
			}),
		]);
	});

	it('clears effective portable annotations and prevents old book id fallback', async () => {
		const currentBookId = 'epub-book-rv441q';
		const legacyBookId = 'epub-book-i6zqes';
		const app = createPortableMockApp(
			{
				'weave/epub-data/index.json': {
					books: {
						[currentBookId]: { bookId: currentBookId },
					},
				},
				[`weave/epub-data/books/${legacyBookId}/annotations.json`]: {
					format: 'weave-reader-annotations/v1',
					version: 1,
					bookId: legacyBookId,
					updatedAt: 2,
					annotations: [
						{
							cfiRange: 'epubcfi(/6/4)',
							semanticId: 'important',
							text: 'Old semantic highlight',
							createdTime: 3,
						},
						{
							cfiRange: 'epubcfi(/6/6)',
							color: 'yellow',
							style: 'wavy',
							text: 'Old plain highlight',
							createdTime: 4,
						},
					],
				},
			},
			[
				'weave/epub-data/books',
				`weave/epub-data/books/${currentBookId}`,
				`weave/epub-data/books/${legacyBookId}`,
			]
		) as any;

		await expect(readEffectiveEpubPortableAnnotations(app, currentBookId)).resolves.toMatchObject({
			bookId: currentBookId,
			annotations: [
				expect.objectContaining({ semanticId: 'important' }),
				expect.objectContaining({ style: 'wavy' }),
			],
		});

		await expect(clearBookEpubPortableSemanticAnnotations(app, currentBookId)).resolves.toBe(2);
		await expect(readEffectiveEpubPortableAnnotations(app, currentBookId)).resolves.toMatchObject({
			bookId: currentBookId,
			annotations: [],
			authoritative: true,
		});
	});

	it('does not render portable semantic annotations outside the active scheme', async () => {
		const bookId = 'epub-book-current';
		const app = createPortableMockApp(
			{
				'weave/epub-data/index.json': {
					books: {
						[bookId]: { bookId },
					},
				},
				'weave/epub-data/semantic-profiles/default.json': {
					format: PROFILE_FORMAT,
					version: PROFILE_VERSION,
					scope: 'global',
					annotationSemanticsEnabled: true,
					semanticSchemeId: 'custom',
					semantics: [
						{
							id: 'important',
							label: 'Important',
							color: 'blue',
							style: 'underline',
							group: 'study',
							description: 'Current scheme semantic',
							showInStandard: true,
							source: 'preset',
							active: true,
						},
						{
							id: 'theorem',
							label: 'Theorem',
							color: 'red',
							style: 'wavy',
							group: 'archived',
							description: 'Archived semantic from a previous scheme',
							showInStandard: false,
							source: 'preset',
							active: false,
						},
					],
					standardSemanticIds: ['important'],
					updatedAt: 1,
				},
				[`weave/epub-data/books/${bookId}/annotations.json`]: {
					format: 'weave-reader-annotations/v1',
					version: 1,
					bookId,
					updatedAt: 2,
					annotations: [
						{
							cfiRange: 'epubcfi(/6/4)',
							semanticId: 'important',
							text: 'Current scheme highlight',
							createdTime: 3,
						},
						{
							cfiRange: 'epubcfi(/6/6)',
							semanticId: 'theorem',
							text: 'Old scheme highlight',
							createdTime: 4,
						},
						{
							cfiRange: 'epubcfi(/6/8)',
							semanticId: 'drug-dose',
							text: 'Unknown scheme highlight',
							createdTime: 5,
						},
					],
				},
			},
			['weave/epub-data/books', `weave/epub-data/books/${bookId}`]
		);

		const storageService = {
			getApp: vi.fn(() => app),
			removeLegacyHighlights: vi.fn(async () => {}),
			loadConcealedTexts: vi.fn(async () => []),
			getCanvasBinding: vi.fn(async () => null),
		} as any;
		const backlinkService = {
			collectHighlights: vi.fn(async () => []),
		} as any;
		const service = new EpubAnnotationService(storageService);

		await expect(service.collectAllHighlights(bookId, 'Books/demo.epub', backlinkService)).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'epubcfi(/6/4)',
				text: 'Current scheme highlight',
				semanticId: 'important',
				color: 'blue',
				style: 'underline',
			}),
		]);
	});

	it('does not render backlink semantic annotations outside the active scheme', async () => {
		const bookId = 'epub-book-current';
		const app = createPortableMockApp(
			{
				'weave/epub-data/index.json': {
					books: {
						[bookId]: { bookId },
					},
				},
				'weave/epub-data/semantic-profiles/default.json': {
					format: PROFILE_FORMAT,
					version: PROFILE_VERSION,
					scope: 'global',
					annotationSemanticsEnabled: true,
					semanticSchemeId: 'custom',
					semantics: [
						{
							id: 'important',
							label: 'Important',
							color: 'blue',
							style: 'underline',
							group: 'study',
							description: 'Current scheme semantic',
							showInStandard: true,
							source: 'preset',
							active: true,
						},
						{
							id: 'theorem',
							label: 'Theorem',
							color: 'red',
							style: 'wavy',
							group: 'archived',
							description: 'Archived semantic from a previous scheme',
							showInStandard: false,
							source: 'preset',
							active: false,
						},
					],
					standardSemanticIds: ['important'],
					updatedAt: 1,
				},
			},
			['weave/epub-data/books', `weave/epub-data/books/${bookId}`]
		);
		const storageService = {
			getApp: vi.fn(() => app),
			removeLegacyHighlights: vi.fn(async () => {}),
			loadConcealedTexts: vi.fn(async () => []),
			getCanvasBinding: vi.fn(async () => null),
		} as any;
		const backlinkService = {
			collectHighlights: vi.fn(async () => [
				{
					cfiRange: 'epubcfi(/6/4)',
					color: 'blue',
					style: 'underline',
					semanticId: 'important',
					text: 'Current backlink highlight',
					sourceFile: 'Notes/demo.md',
				},
				{
					cfiRange: 'epubcfi(/6/6)',
					color: 'red',
					style: 'wavy',
					semanticId: 'theorem',
					text: 'Old backlink highlight',
					sourceFile: 'Notes/demo.md',
				},
			]),
		} as any;
		const service = new EpubAnnotationService(storageService);

		await expect(service.collectAllHighlights(bookId, 'Books/demo.epub', backlinkService)).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'epubcfi(/6/4)',
				text: 'Current backlink highlight',
				semanticId: 'important',
			}),
		]);
	});

	it('keeps separate highlights for the same coarse cfi when excerpt ids differ', async () => {
		const storageService = {
			removeLegacyHighlights: vi.fn(async () => {}),
			loadConcealedTexts: vi.fn(async () => []),
			getCanvasBinding: vi.fn(async () => null),
		} as any;

		const backlinkService = {
			collectHighlights: vi.fn(async () => [
				{
					cfiRange: 'epubcfi(/6/26)',
					color: 'yellow',
					text: '第一段摘录',
					excerptId: 'excerpt-a',
					sourceFile: 'Notes/demo.md',
					createdTime: 1,
				},
				{
					cfiRange: 'epubcfi(/6/26)',
					color: 'green',
					text: '第二段摘录',
					excerptId: 'excerpt-b',
					sourceFile: 'Notes/demo.md',
					createdTime: 2,
				},
			]),
		} as any;

		const service = new EpubAnnotationService(storageService);

		await expect(service.collectAllHighlights('book-1', 'Books/demo.txt', backlinkService)).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'epubcfi(/6/26)',
				text: '第一段摘录',
				excerptId: 'excerpt-a',
			}),
			expect.objectContaining({
				cfiRange: 'epubcfi(/6/26)',
				text: '第二段摘录',
				excerptId: 'excerpt-b',
			}),
		]);
	});

	it('merges all source locators for the same cfi and preserves the preferred primary source', async () => {
		const storageService = {
			removeLegacyHighlights: vi.fn(async () => {}),
			loadConcealedTexts: vi.fn(async () => []),
			getCanvasBinding: vi.fn(async () => null),
		} as any;

		const backlinkService = {
			collectHighlights: vi.fn(async () => [
				{
					cfiRange: 'readium:shared',
					color: 'green',
					text: 'Shared highlight',
					sourceFile: 'Notes/demo.md',
					createdTime: 2,
				},
				{
					cfiRange: 'readium:shared',
					color: 'green',
					style: 'wavy',
					text: 'Shared highlight',
					commentText: '想法正文',
					hasCommentDivider: true,
					sourceFile: 'weave/memory/deck-files/demo_01.wdeck',
					sourceRef: 'card:card-a',
					createdTime: 2,
				},
			]),
		} as any;

		const service = new EpubAnnotationService(storageService);

		await expect(service.collectAllHighlights('book-1', 'Books/demo.epub', backlinkService)).resolves.toEqual([
			{
				cfiRange: 'readium:shared',
				color: 'green',
				style: 'wavy',
				text: 'Shared highlight',
				commentText: '想法正文',
				hasCommentDivider: true,
				sourceFile: 'weave/memory/deck-files/demo_01.wdeck',
				sourceRef: 'card:card-a',
				sourceLocators: [
					{
						sourceFile: 'Notes/demo.md',
						sourceRef: undefined,
					},
					{
						sourceFile: 'weave/memory/deck-files/demo_01.wdeck',
						sourceRef: 'card:card-a',
					},
				],
				createdTime: 2,
				presentation: 'highlight',
			},
		]);
	});

	it('prefers canvas file-node locators as the primary backlink target when present alongside a markdown excerpt source', async () => {
		const storageService = {
			removeLegacyHighlights: vi.fn(async () => {}),
			loadConcealedTexts: vi.fn(async () => []),
			getCanvasBinding: vi.fn(async () => null),
		} as any;

		const backlinkService = {
			collectHighlights: vi.fn(async () => [
				{
					cfiRange: 'readium:canvas-shared',
					color: 'purple',
					text: 'Canvas shared highlight',
					sourceFile: 'Notes/demo.md',
					excerptId: 'excerpt-fixed',
					sourceLocators: [
						{
							sourceFile: 'Canvas/demo.canvas',
							sourceRef: 'canvas-file-node:file-node-1',
							excerptId: 'excerpt-fixed',
						},
					],
					createdTime: 3,
				},
			]),
		} as any;

		const service = new EpubAnnotationService(storageService);

		await expect(service.collectAllHighlights('book-1', 'Books/demo.epub', backlinkService)).resolves.toEqual([
			{
				cfiRange: 'readium:canvas-shared',
				color: 'purple',
				text: 'Canvas shared highlight',
				sourceFile: 'Canvas/demo.canvas',
				sourceRef: 'canvas-file-node:file-node-1',
				excerptId: 'excerpt-fixed',
				sourceLocators: [
					{
						sourceFile: 'Notes/demo.md',
						sourceRef: undefined,
						excerptId: 'excerpt-fixed',
					},
					{
						sourceFile: 'Canvas/demo.canvas',
						sourceRef: 'canvas-file-node:file-node-1',
						excerptId: 'excerpt-fixed',
					},
				],
				createdTime: 3,
				presentation: 'highlight',
			},
		]);
	});

	it('exports book highlights to markdown as complete epub quote blocks with metadata', async () => {
		const storageService = {
			getApp: vi.fn(() => ({
				vault: {
					getAbstractFileByPath: vi.fn(() => null),
				},
				fileManager: {
					generateMarkdownLink: vi.fn(),
				},
			})),
			getBook: vi.fn(async () => ({
				id: 'book-1',
				filePath: 'Books/demo.epub',
				sourceId: 'epubsrc-demo',
				metadata: {
					title: '示例 EPUB',
					author: '张三',
					publisher: '测试出版社',
				},
				currentPosition: {
					percent: 42,
				},
			})),
			removeLegacyHighlights: vi.fn(async () => {}),
			loadConcealedTexts: vi.fn(async () => []),
			getCanvasBinding: vi.fn(async () => null),
		} as any;

		const backlinkService = {
			collectHighlights: vi.fn(async () => [
				{
					cfiRange: 'epubcfi(/6/4)',
					color: 'yellow',
					text: '第一条高亮',
					chapterIndex: 2,
					chapterTitle: '雪夜的故事',
					sourceFile: 'Notes/demo.md',
					excerptId: 'excerpt-a',
					semanticId: 'important',
					semanticLabel: '重点',
					createdTime: new Date('2026-04-27T13:32:00').getTime(),
					presentation: 'highlight',
				},
				{
					cfiRange: 'epubcfi(/6/6)',
					color: 'blue',
					text: '第二条高亮',
					chapterIndex: 3,
					chapterTitle: '晨光',
					sourceFile: 'Notes/demo.md',
					excerptId: 'excerpt-b',
					createdTime: new Date('2026-04-28T09:15:00').getTime(),
					presentation: 'highlight',
				},
			]),
		} as any;

		const service = new EpubAnnotationService(storageService);

		const markdown = await service.exportToMarkdown('book-1', {
			filePath: 'Books/demo.epub',
			backlinkService,
		});

		expect(markdown).toContain('# 示例 EPUB - 阅读笔记');
		expect(markdown).toContain('- **作者**: 张三');
		expect(markdown).toContain('- **出版社**: 测试出版社');
		expect(markdown).toContain('- **阅读进度**: 42%');
		expect(markdown).toContain('## 高亮');
		expect(markdown).toMatch(
			/> \[!EPUB\|yellow\+semantic:important\] \[\[Books\/demo\.epub#weave-cfi=epubcfi\(\/6\/4\).*&sid=epubsrc-demo&eid=excerpt-a\|demo\]\] \[雪夜的故事\] 2026-04-27 13:32\n> 第一条高亮\n/
		);
		expect(markdown).toMatch(
			/> \[!EPUB\|blue\] \[\[Books\/demo\.epub#weave-cfi=epubcfi\(\/6\/6\).*&sid=epubsrc-demo&eid=excerpt-b\|demo\]\] \[晨光\] 2026-04-28 09:15\n> 第二条高亮\n/
		);
		expect(markdown).not.toContain('&text=');
		expect(markdown).toContain('> 第一条高亮');
		expect(markdown).toContain('> 第二条高亮');
	});
});
