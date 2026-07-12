import { EpubIrResumePointAccess } from '../epub-ir-resume-point-access';

function createAdapter(files: Record<string, string>) {
	return {
		exists: vi.fn(async (path: string) => Object.prototype.hasOwnProperty.call(files, path)),
		read: vi.fn(async (path: string) => files[path]),
		write: vi.fn(async (path: string, content: string | object) => {
			files[path] = typeof content === "string" ? content : JSON.stringify(content);
		}),
	};
}

function createApp(files: Record<string, string>) {
	const adapter = createAdapter(files);
	return {
		vault: { adapter },
	} as any;
}

describe('EpubIrResumePointAccess', () => {
	it('updates resume CFI in point storage files', async () => {
		const files: Record<string, string> = {
			'weave/incremental-reading/registry/point-files-index.json': JSON.stringify({
				files: [{ file: 'points/demo.json' }],
			}),
			'weave/incremental-reading/points/demo.json': JSON.stringify({
				schemaVersion: 1,
				points: [
					{
						id: 'epubbm-1',
						pointType: 'chapter-entry',
						materialId: 'source-1',
						source: { id: 'source-1', type: 'epub', path: 'Books/demo.epub', title: 'Demo' },
						timestamps: { createdAt: '2020-01-01', updatedAt: '2020-01-01' },
						trace: {
							locatorType: 'epub-chapter',
							locator: { resumeCfi: 'old-cfi' },
							traceState: 'verified',
							traceConfidence: 1,
							fallbackLocators: [],
						},
						parameterContext: {
							materialClass: 'epub',
							scheduleProfileRef: 'default',
							classificationSource: 'manual',
							isOverride: false,
						},
						schedule: {
							status: 'active',
							priorityScore: 0,
							manualPriority: 0,
							intervalDays: 0,
						},
						relations: { topicIds: [], linkedCardIds: [], linkedNotePaths: [] },
						userData: { title: 'Demo', tags: [], isStarred: false },
						stats: {
							impressionCount: 0,
							reviewCount: 0,
							extractCount: 0,
							cardCreatedCount: 0,
							noteCreatedCount: 0,
							totalReadingTimeMs: 0,
						},
						audit: { createdBy: 'test', origin: { type: 'epub-bookmark' } },
					},
				],
			}),
		};

		const access = new EpubIrResumePointAccess(createApp(files));
		const storageService = {
			ensureSourceIdentity: vi.fn(async () => ({ sourceId: 'source-1' })),
		} as any;

		const points = await access.listResumePointsByEpub('Books/demo.epub', storageService);
		expect(points).toEqual([
			{
				id: 'epubbm-1',
				epubFilePath: 'Books/demo.epub',
				sourceId: 'source-1',
				resumeCfi: 'old-cfi',
			},
		]);

		expect(await access.updateResumeCfi('epubbm-1', 'new-cfi')).toBe(true);
		const updated = JSON.parse(files['weave/incremental-reading/points/demo.json']);
		expect(updated.points[0].trace.locator.resumeCfi).toBe('new-cfi');
	});

	it('falls back to legacy epub-bookmark-tasks.json', async () => {
		const files: Record<string, string> = {
			'weave/incremental-reading/epub-bookmark-tasks.json': JSON.stringify([
				{
					id: 'legacy-1',
					epubFilePath: 'Books/demo.epub',
					resumeCfi: 'legacy-cfi',
				},
			]),
		};

		const access = new EpubIrResumePointAccess(createApp(files));
		const storageService = {
			ensureSourceIdentity: vi.fn(async () => null),
		} as any;

		const points = await access.listResumePointsByEpub('Books/demo.epub', storageService);
		expect(points).toEqual([
			{
				id: 'legacy-1',
				epubFilePath: 'Books/demo.epub',
				sourceId: undefined,
				resumeCfi: 'legacy-cfi',
			},
		]);

		expect(await access.updateResumeCfi('legacy-1', 'next-cfi')).toBe(true);
		const updated = JSON.parse(files['weave/incremental-reading/epub-bookmark-tasks.json']);
		expect(updated[0].resumeCfi).toBe('next-cfi');
	});
});
