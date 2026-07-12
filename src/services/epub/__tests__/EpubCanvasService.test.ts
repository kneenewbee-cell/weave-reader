const mockGetCanvasExcerptAnchorState = vi.hoisted(() =>
	vi.fn(async () => ({
		lockedNodeId: null,
		lastCreatedNodeId: null,
		layoutDirection: 'down' as const,
	}))
);

vi.mock('../canvas-excerpt-anchor', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../canvas-excerpt-anchor')>();
	return {
		...actual,
		getCanvasExcerptAnchorState: mockGetCanvasExcerptAnchorState,
		getCanvasExcerptLayoutDirection: vi.fn(async () => 'down' as const),
		setCanvasExcerptLastCreatedNode: vi.fn(async () => undefined),
		setCanvasExcerptLayoutDirection: vi.fn(async () => ({
			lockedNodeId: null,
			lastCreatedNodeId: null,
			layoutDirection: 'down' as const,
		})),
	};
});

vi.mock('obsidian', () => ({
	App: class MockApp {},
	TFile: class MockTFile {
		path: string;
		constructor(path = '') {
			this.path = path;
		}
	},
	TFolder: class MockTFolder {
		path: string;
		constructor(path = '') {
			this.path = path;
		}
	},
	ItemView: class MockItemView {},
	WorkspaceLeaf: class MockWorkspaceLeaf {},
	MarkdownView: class MockMarkdownView {},
	Notice: vi.fn(),
	Menu: class MockMenu {},
	Modal: class MockModal {},
	Plugin: class MockPlugin {},
	PluginSettingTab: class MockPluginSettingTab {},
	Platform: { isMobile: false },
	setIcon: vi.fn(),
	normalizePath: (value: string) => String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, ''),
}));

import { TFile, TFolder } from 'obsidian';
import { EpubCanvasService } from '../EpubCanvasService';
import { estimateCanvasTextNodeSize } from '../canvas-text-node-size';
import type { CanvasData, CanvasEdge, CanvasNode } from '../canvas-types';
import { NODE_GAP_X, NODE_GAP_Y } from '../canvas-types';

function createNode(id: string, x = 0, y = 0): CanvasNode {
	return {
		id,
		type: 'text',
		text: id,
		x,
		y,
		width: 300,
		height: 120,
	};
}

function createMockApp(initialFiles: Record<string, string>, canvasLeaves: any[] = []) {
	const files = new Map<string, string>(Object.entries(initialFiles));
	const folderSet = new Set<string>();
	for (const filePath of files.keys()) {
		const segments = filePath.split('/').filter(Boolean);
		let current = '';
		for (const segment of segments.slice(0, -1)) {
			current = current ? `${current}/${segment}` : segment;
			folderSet.add(current);
		}
	}

	const app: any = {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => {
				if (files.has(path)) {
					return new (TFile as any)(path);
				}
				if (folderSet.has(path)) {
					return new (TFolder as any)(path);
				}
				return null;
			}),
			read: vi.fn(async (file: { path: string }) => {
				const value = files.get(file.path);
				if (value === undefined) {
					throw new Error(`Missing file: ${file.path}`);
				}
				return value;
			}),
			modify: vi.fn(async (file: { path: string }, content: string) => {
				files.set(file.path, content);
			}),
			create: vi.fn(async (path: string, content: string) => {
				files.set(path, content);
				const segments = path.split('/').filter(Boolean);
				let current = '';
				for (const segment of segments.slice(0, -1)) {
					current = current ? `${current}/${segment}` : segment;
					folderSet.add(current);
				}
				return { path };
			}),
			createFolder: vi.fn(async (path: string) => {
				folderSet.add(path);
				return { path };
			}),
		},
		workspace: {
			getLeavesOfType: vi.fn((type: string) => (type === 'canvas' ? canvasLeaves : [])),
		},
	};

	return { app, files };
}

function readCanvas(files: Map<string, string>, path: string): CanvasData {
	return JSON.parse(files.get(path) || '{"nodes":[],"edges":[]}') as CanvasData;
}

describe('EpubCanvasService', () => {
	beforeEach(() => {
		mockGetCanvasExcerptAnchorState.mockResolvedValue({
			lockedNodeId: null,
			lastCreatedNodeId: null,
			layoutDirection: 'down',
		});
	});

	it('does not create orphan edges when the stored anchor node no longer exists', async () => {
		const canvasPath = 'Mind.canvas';
		const { app, files } = createMockApp({
			[canvasPath]: JSON.stringify({
				nodes: [createNode('root')],
				edges: [],
			} satisfies CanvasData),
		});
		const service = new EpubCanvasService(app);
		service.setCanvasPath(canvasPath);
		service.setAnchor({ nodeId: 'missing-node', parentNodeId: 'root' });

		const created = await service.addRawTextNode('Fresh note');

		expect(created).not.toBeNull();

		const saved = readCanvas(files, canvasPath);
		expect(saved.nodes).toHaveLength(2);
		expect(saved.edges).toHaveLength(0);
	});

	it('ignores canvas edge selections so new EPUB notes do not attach to non-node ids', async () => {
		const canvasPath = 'Mind.canvas';
		const edge: CanvasEdge = {
			id: 'edge-1',
			fromNode: 'root',
			toNode: 'child',
			fromSide: 'bottom',
			toSide: 'top',
		};
		const canvasData: CanvasData = {
			nodes: [createNode('root'), createNode('child', 0, 160)],
			edges: [edge],
		};
		const canvasLeaves = [
			{
				view: {
					file: { path: canvasPath },
					canvas: {
						selection: new Set([{ id: 'edge-1' }]),
						getData: () => canvasData,
					},
				},
			},
		];
		const { app, files } = createMockApp({
			[canvasPath]: JSON.stringify(canvasData),
		}, canvasLeaves);
		const service = new EpubCanvasService(app);
		service.setCanvasPath(canvasPath);

		await service.addRawTextNode('Detached note');

		const saved = readCanvas(files, canvasPath);
		expect(saved.nodes).toHaveLength(3);
		expect(saved.edges).toHaveLength(1);
		expect(saved.edges[0]).toEqual(edge);
	});

	it('chains excerpt nodes from the selected node when selection stays unchanged', async () => {
		const canvasPath = 'Mind.canvas';
		const hub = createNode('hub', 100, 100);
		const canvasData: CanvasData = {
			nodes: [hub],
			edges: [],
		};
		const { app, files } = createMockApp({
			[canvasPath]: JSON.stringify(canvasData),
		});
		const canvasLeaves = [
			{
				view: {
					file: { path: canvasPath },
					canvas: {
						selection: new Set([{ id: 'hub' }]),
						getData: () => readCanvas(files, canvasPath),
					},
				},
			},
		];
		app.workspace.getLeavesOfType = vi.fn((type: string) => (type === 'canvas' ? canvasLeaves : []));
		const service = new EpubCanvasService(app);
		service.setCanvasPath(canvasPath);

		const first = await service.addRawTextNode('First excerpt');
		mockGetCanvasExcerptAnchorState.mockResolvedValue({
			lockedNodeId: null,
			lastCreatedNodeId: first!.id,
			layoutDirection: 'down',
		});
		const second = await service.addRawTextNode('Second excerpt');

		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(service.getLastInsertAnchorMode()).toBe('chain');

		const saved = readCanvas(files, canvasPath);
		expect(saved.nodes).toHaveLength(3);
		expect(saved.edges).toHaveLength(2);
		expect(saved.edges).toContainEqual(
			expect.objectContaining({ fromNode: 'hub', toNode: first!.id })
		);
		expect(saved.edges).toContainEqual(
			expect.objectContaining({ fromNode: first!.id, toNode: second!.id })
		);
		expect(second!.y).toBeGreaterThan(first!.y);
		expect(second!.x).toBe(first!.x);
	});

	it('branches from a re-selected ancestor instead of extending a deeper chain tip', async () => {
		const canvasPath = 'Branch.canvas';
		const nodeA = createNode('a', 100, 100);
		const nodeB = createNode('b', 100, 300);
		const nodeC = createNode('c', 100, 500);
		const canvasData: CanvasData = {
			nodes: [nodeA, nodeB, nodeC],
			edges: [
				{
					id: 'edge-ab',
					fromNode: 'a',
					toNode: 'b',
					fromSide: 'bottom',
					toSide: 'top',
				},
				{
					id: 'edge-bc',
					fromNode: 'b',
					toNode: 'c',
					fromSide: 'bottom',
					toSide: 'top',
				},
			],
		};
		const { app, files } = createMockApp({
			[canvasPath]: JSON.stringify(canvasData),
		});
		const canvasLeaves = [
			{
				view: {
					file: { path: canvasPath },
					canvas: {
						selection: new Set([{ id: 'a' }]),
						getData: () => readCanvas(files, canvasPath),
					},
				},
			},
		];
		app.workspace.getLeavesOfType = vi.fn((type: string) => (type === 'canvas' ? canvasLeaves : []));
		mockGetCanvasExcerptAnchorState.mockResolvedValue({
			lockedNodeId: null,
			lastCreatedNodeId: 'c',
			layoutDirection: 'down',
		});
		const service = new EpubCanvasService(app);
		service.setCanvasPath(canvasPath);
		(
			service as unknown as { insertSelectionSnapshotByCanvas: Map<string, string> }
		).insertSelectionSnapshotByCanvas.set(canvasPath, 'a');

		const branch = await service.addRawTextNode('Branch excerpt');

		expect(branch).not.toBeNull();
		expect(service.getLastInsertAnchorMode()).toBe('selection');

		const saved = readCanvas(files, canvasPath);
		expect(saved.nodes).toHaveLength(4);
		expect(saved.edges).toHaveLength(3);
		expect(saved.edges).toContainEqual(
			expect.objectContaining({ fromNode: 'a', toNode: branch!.id })
		);
		expect(saved.edges.some((edge) => edge.fromNode === 'c')).toBe(false);
		expect(branch!.x).toBeGreaterThan(nodeB.x);
		expect(branch!.y).toBe(nodeB.y);
	});

	it('adds sibling excerpt nodes under a pinned hub even when the last excerpt stays selected', async () => {
		const canvasPath = 'Pinned.canvas';
		const hub = createNode('hub', 100, 100);
		const canvasData: CanvasData = {
			nodes: [hub],
			edges: [],
		};
		const { app, files } = createMockApp({
			[canvasPath]: JSON.stringify(canvasData),
		});
		const canvasLeaves = [
			{
				view: {
					file: { path: canvasPath },
					canvas: {
						selection: new Set<{ id?: string }>(),
						getData: () => readCanvas(files, canvasPath),
					},
				},
			},
		];
		app.workspace.getLeavesOfType = vi.fn((type: string) => (type === 'canvas' ? canvasLeaves : []));
		mockGetCanvasExcerptAnchorState.mockResolvedValue({
			lockedNodeId: 'hub',
			lastCreatedNodeId: null,
			layoutDirection: 'down',
		});
		const service = new EpubCanvasService(app);
		service.setCanvasPath(canvasPath);

		const first = await service.addRawTextNode('Pinned excerpt 1');
		canvasLeaves[0].view.canvas.selection = new Set([{ id: first!.id }]);
		mockGetCanvasExcerptAnchorState.mockResolvedValue({
			lockedNodeId: 'hub',
			lastCreatedNodeId: first!.id,
			layoutDirection: 'down',
		});

		const second = await service.addRawTextNode('Pinned excerpt 2');
		const third = await service.addRawTextNode('Pinned excerpt 3');

		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(third).not.toBeNull();
		expect(service.getLastInsertAnchorMode()).toBe('locked');
		expect(service.getAnchor()?.nodeId).toBe('hub');

		const saved = readCanvas(files, canvasPath);
		expect(saved.nodes).toHaveLength(4);
		expect(saved.edges).toHaveLength(3);
		expect(saved.edges.every((edge) => edge.fromNode === 'hub')).toBe(true);
		expect(saved.edges.map((edge) => edge.toNode).sort()).toEqual(
			[first!.id, second!.id, third!.id].sort()
		);
		expect(first!.x).toBe(100);
		expect(first!.y).toBe(260);
		expect(second!.x).toBe(first!.x + first!.width + NODE_GAP_X);
		expect(second!.y).toBe(first!.y);
		expect(third!.x).toBe(second!.x + second!.width + NODE_GAP_X);
		expect(third!.y).toBe(first!.y);
	});

	it('adds pinned hub children in a vertical column when direction is right', async () => {
		const canvasPath = 'PinnedRight.canvas';
		const hub = createNode('hub', 100, 100);
		const { app, files } = createMockApp({
			[canvasPath]: JSON.stringify({ nodes: [hub], edges: [] } satisfies CanvasData),
		});
		const canvasLeaves = [
			{
				view: {
					file: { path: canvasPath },
					canvas: {
						selection: new Set<{ id?: string }>(),
						getData: () => readCanvas(files, canvasPath),
					},
				},
			},
		];
		app.workspace.getLeavesOfType = vi.fn((type: string) => (type === 'canvas' ? canvasLeaves : []));
		mockGetCanvasExcerptAnchorState.mockResolvedValue({
			lockedNodeId: 'hub',
			lastCreatedNodeId: null,
			layoutDirection: 'right',
		});
		const service = new EpubCanvasService(app);
		service.setCanvasPath(canvasPath);

		const first = await service.addRawTextNode('Right excerpt 1');
		const second = await service.addRawTextNode('Right excerpt 2');

		expect(first!.x).toBe(450);
		expect(first!.y).toBe(100);
		expect(second!.x).toBe(first!.x);
		expect(second!.y).toBe(first!.y + first!.height + NODE_GAP_Y);

		const saved = readCanvas(files, canvasPath);
		expect(saved.edges.every((edge) => edge.fromNode === 'hub')).toBe(true);
	});

	it('keeps branch lane placement stable when unrelated canvas nodes occupy the lane area', async () => {
		const canvasPath = 'PinnedStable.canvas';
		const hub = createNode('hub', 100, 100);
		const noise = createNode('noise', 450, 260);
		const { app, files } = createMockApp({
			[canvasPath]: JSON.stringify({
				nodes: [hub, noise],
				edges: [],
			} satisfies CanvasData),
		});
		const canvasLeaves = [
			{
				view: {
					file: { path: canvasPath },
					canvas: {
						selection: new Set<{ id?: string }>(),
						getData: () => readCanvas(files, canvasPath),
					},
				},
			},
		];
		app.workspace.getLeavesOfType = vi.fn((type: string) => (type === 'canvas' ? canvasLeaves : []));
		mockGetCanvasExcerptAnchorState.mockResolvedValue({
			lockedNodeId: 'hub',
			lastCreatedNodeId: null,
			layoutDirection: 'right',
		});
		const service = new EpubCanvasService(app);
		service.setCanvasPath(canvasPath);

		const first = await service.addRawTextNode('Lane excerpt 1');
		const second = await service.addRawTextNode('Lane excerpt 2');

		expect(first!.x).toBe(450);
		expect(first!.y).toBe(100);
		expect(second!.x).toBe(450);
		expect(second!.y).toBe(first!.y + first!.height + NODE_GAP_Y);
		expect(files.get(canvasPath)).not.toContain('"x":900');
	});

	it('uses content-based node size when adding canvas text nodes', async () => {
		const canvasPath = 'Sized.canvas';
		const { app, files } = createMockApp({
			[canvasPath]: JSON.stringify({ nodes: [], edges: [] } satisfies CanvasData),
		});
		const service = new EpubCanvasService(app);
		service.setCanvasPath(canvasPath);

		const short = await service.addRawTextNode('Brief note');
		const longBody = Array.from({ length: 6 }, () => '> Another excerpt line').join('\n');
		const long = await service.addRawTextNode(`> [!EPUB] [[Book.epub#cfi|Title]]\n${longBody}`);

		expect(short).not.toBeNull();
		expect(long).not.toBeNull();
		expect(short!.height).toBe(estimateCanvasTextNodeSize('Brief note').height);
		expect(long!.height).toBe(estimateCanvasTextNodeSize(`> [!EPUB] [[Book.epub#cfi|Title]]\n${longBody}`).height);
		expect(long!.height).toBeGreaterThan(short!.height);

		const saved = readCanvas(files, canvasPath);
		expect(saved.nodes[0]?.width).toBe(short!.width);
		expect(saved.nodes[1]?.height).toBe(long!.height);
	});

	it('persists highlight style metadata when adding styled EPUB excerpt nodes to canvas', async () => {
		const canvasPath = 'Styled.canvas';
		const { app, files } = createMockApp({
			[canvasPath]: JSON.stringify({
				nodes: [],
				edges: [],
			} satisfies CanvasData),
		});
		const service = new EpubCanvasService(app);
		service.setCanvasPath(canvasPath);

		const created = await service.addExcerptNode(
			'Styled excerpt',
			'readium:styled',
			'Books/demo.epub',
			2,
			'第二章',
			'green',
			undefined,
			'epubsrc-demo',
			'underline'
		);

		expect(created).not.toBeNull();

		const saved = readCanvas(files, canvasPath);
		expect(saved.nodes).toHaveLength(1);
		expect(saved.nodes[0]?.text).toContain('> [!EPUB|green+underline]');
		expect(saved.nodes[0]?.text).toContain(
			'[[Books/demo.epub#weave-cfi=readium:styled'
		);
		expect(saved.nodes[0]?.text).toContain('&sid=epubsrc-demo&eid=');
	});
});
