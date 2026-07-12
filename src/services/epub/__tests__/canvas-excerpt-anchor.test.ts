import { describe, expect, it } from 'vitest';
import {
	avoidNodeOverlap,
	calculateChainNodePosition,
	calculateMindMapHubNodePosition,
	normalizeCanvasExcerptAnchorRecord,
	normalizeCanvasExcerptAnchorsMap,
	readCanvasExcerptAnchorStateFromCache,
	resolveCanvasExcerptAnchorNodeId,
} from '../canvas-excerpt-anchor';
import type { CanvasNode } from '../canvas-types';

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

describe('canvas-excerpt-anchor', () => {
	it('prefers locked anchor over selection', () => {
		const resolution = resolveCanvasExcerptAnchorNodeId(
			{ lockedNodeId: 'lock', lastCreatedNodeId: 'last' },
			['selected'],
			new Set(['lock', 'selected', 'last'])
		);
		expect(resolution).toEqual({ nodeId: 'lock', mode: 'locked' });
	});

	it('uses a single selected node when selection changed since last insert', () => {
		const resolution = resolveCanvasExcerptAnchorNodeId(
			{ lockedNodeId: null, lastCreatedNodeId: 'last' },
			['selected'],
			new Set(['selected', 'last']),
			''
		);
		expect(resolution).toEqual({ nodeId: 'selected', mode: 'selection' });
	});

	it('continues the selection chain when lastCreated is a direct child of the selection', () => {
		const resolution = resolveCanvasExcerptAnchorNodeId(
			{ lockedNodeId: null, lastCreatedNodeId: 'last' },
			['selected'],
			new Set(['selected', 'last']),
			'selected',
			[{ id: 'edge-1', fromNode: 'selected', toNode: 'last', fromSide: 'bottom', toSide: 'top' }]
		);
		expect(resolution).toEqual({ nodeId: 'last', mode: 'chain' });
	});

	it('restarts from the selected node when lastCreated is only a deeper descendant', () => {
		const resolution = resolveCanvasExcerptAnchorNodeId(
			{ lockedNodeId: null, lastCreatedNodeId: 'c' },
			['a'],
			new Set(['a', 'b', 'c']),
			'a',
			[
				{ id: 'edge-ab', fromNode: 'a', toNode: 'b', fromSide: 'bottom', toSide: 'top' },
				{ id: 'edge-bc', fromNode: 'b', toNode: 'c', fromSide: 'bottom', toSide: 'top' },
			]
		);
		expect(resolution).toEqual({ nodeId: 'a', mode: 'selection' });
	});

	it('lays out pinned hub siblings in a row below the hub', () => {
		const hub = createNode('hub', 100, 200);
		const firstChild = createNode('child-a', 100, 360);
		const position = calculateMindMapHubNodePosition(hub, [firstChild], 'down');
		expect(position).toEqual({ x: 450, y: 360 });
		expect(calculateMindMapHubNodePosition(hub, [firstChild], 'down')).toEqual(position);
	});

	it('extends the selection chain along the configured down direction', () => {
		const hub = createNode('hub', 100, 200);
		const firstChild = createNode('child-a', 100, 360);
		expect(calculateChainNodePosition(hub, 'down')).toEqual({ x: 100, y: 360 });
		expect(calculateChainNodePosition(firstChild, 'down')).toEqual({ x: 100, y: 520 });
		expect(calculateMindMapHubNodePosition(hub, [], 'down')).toEqual({ x: 100, y: 360 });
		expect(calculateMindMapHubNodePosition(hub, [firstChild], 'down')).toEqual({
			x: 450,
			y: 360,
		});
	});

	it('lays out right-direction siblings in a column beside the hub', () => {
		const hub = createNode('hub', 100, 200);
		const firstChild = createNode('child-a', 450, 200);
		const position = calculateMindMapHubNodePosition(hub, [firstChild], 'right');
		expect(position).toEqual({ x: 450, y: 360 });
	});

	it('accumulates right-direction lane spacing from actual sibling height', () => {
		const hub = createNode('hub', 100, 100);
		const tallChild: CanvasNode = {
			...createNode('child-a', 450, 100),
			height: 240,
		};
		const position = calculateMindMapHubNodePosition(hub, [tallChild], 'right');
		expect(position).toEqual({ x: 450, y: 380 });
	});

	it('ignores off-lane siblings when appending to the branch lane', () => {
		const hub = createNode('hub', 100, 100);
		const inLaneChild = createNode('child-a', 450, 100);
		const offLaneChild = createNode('child-b', 900, 500);
		const position = calculateMindMapHubNodePosition(
			hub,
			[inLaneChild, offLaneChild],
			'right'
		);
		expect(position).toEqual({ x: 450, y: 260 });
	});

	it('aligns branch siblings beside chain-placed direct children', () => {
		const hub = createNode('hub', 100, 100);
		const chainChild = createNode('child-a', 100, 300);
		const position = calculateMindMapHubNodePosition(hub, [chainChild], 'down');
		expect(position).toEqual({ x: 450, y: 300 });
	});

	it('advances within the lane when the next slot overlaps a moved sibling', () => {
		const hub = createNode('hub', 100, 100);
		const blockingChild = createNode('child-a', 450, 100);
		const position = calculateMindMapHubNodePosition(hub, [blockingChild], 'right', {
			width: 300,
			height: 120,
		});
		expect(position).toEqual({ x: 450, y: 260 });
	});

	it('does not shift lane placement for unrelated canvas nodes', () => {
		const hub = createNode('hub', 100, 100);
		const firstChild = createNode('child-a', 450, 100);
		const unrelated = createNode('noise', 450, 260);
		const position = calculateMindMapHubNodePosition(hub, [firstChild], 'right', {
			width: 300,
			height: 120,
		});
		expect(position).toEqual({ x: 450, y: 260 });
		expect(unrelated.x).toBe(450);
	});

	it('nudges candidate positions away from occupied nodes', () => {
		const occupied = createNode('occupied', 100, 360);
		const position = avoidNodeOverlap(
			{ x: 100, y: 360 },
			{ width: 300, height: 120 },
			[occupied],
			'down'
		);
		expect(position.x).toBeGreaterThan(occupied.x);
	});

	it('ignores canvas group nodes when avoiding overlap', () => {
		const group: CanvasNode = {
			id: 'group-1',
			type: 'group',
			x: 0,
			y: 0,
			width: 800,
			height: 600,
		};
		const position = avoidNodeOverlap(
			{ x: 100, y: 360 },
			{ width: 300, height: 120 },
			[group],
			'down'
		);
		expect(position).toEqual({ x: 100, y: 360 });
	});

	it('normalizes persisted anchor map keys and values', () => {
		expect(
			normalizeCanvasExcerptAnchorsMap({
				'Canvas/demo.canvas': { lockedNodeId: 'a', lastCreatedNodeId: 'b', layoutDirection: 'right' },
				'': { lockedNodeId: 'x' },
			})
		).toEqual({
			'Canvas/demo.canvas': { lockedNodeId: 'a', lastCreatedNodeId: 'b', layoutDirection: 'right' },
		});
	});

	it('returns default anchor state when cache is empty', () => {
		expect(readCanvasExcerptAnchorStateFromCache({} as any, 'Demo.canvas')).toEqual({
			lockedNodeId: null,
			lastCreatedNodeId: null,
			layoutDirection: 'down',
		});
	});

	it('normalizes empty anchor records', () => {
		expect(normalizeCanvasExcerptAnchorRecord({})).toEqual({
			lockedNodeId: null,
			lastCreatedNodeId: null,
			layoutDirection: 'down',
		});
	});
});
