import { normalizePath, type App, type Plugin, type WorkspaceLeaf } from "obsidian";
import type { CanvasData, CanvasLayoutDirection, CanvasNode, CanvasEdge } from "./canvas-types";
import {
	DEFAULT_NODE_HEIGHT,
	DEFAULT_NODE_WIDTH,
	NODE_GAP_X,
	NODE_GAP_Y,
} from "./canvas-types";
import { getEpubStorageService } from "./epub-storage-access";
import type { CanvasExcerptAnchorRecord } from "./EpubStorageService";

export type CanvasExcerptAnchorMode = "locked" | "selection" | "chain" | "root";

export interface CanvasExcerptAnchorResolution {
	nodeId: string | null;
	mode: CanvasExcerptAnchorMode;
}

export interface BoundCanvasSelection {
	canvasPath: string;
	nodeIds: string[];
}

const DEFAULT_LAYOUT_DIRECTION: CanvasLayoutDirection = "down";
const anchorCacheByApp = new WeakMap<App, Map<string, CanvasExcerptAnchorRecord>>();

export const WEAVE_EPUB_CANVAS_LAYOUT_DIRECTION_EVENT = "weave-epub-canvas-layout-direction" as const;

export type WeaveEpubCanvasLayoutDirectionPayload = {
	canvasPath: string;
	direction: CanvasLayoutDirection;
};

function getAnchorCache(app: App): Map<string, CanvasExcerptAnchorRecord> {
	let cache = anchorCacheByApp.get(app);
	if (!cache) {
		cache = new Map();
		anchorCacheByApp.set(app, cache);
	}
	return cache;
}

export function normalizeCanvasLayoutDirection(value: unknown): CanvasLayoutDirection {
	const raw = typeof value === "string" ? value.trim() : "";
	if (raw === "down" || raw === "right" || raw === "up" || raw === "left") {
		return raw;
	}
	return DEFAULT_LAYOUT_DIRECTION;
}

function readOptionalStringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function normalizeCanvasExcerptAnchorRecord(
	value: unknown
): CanvasExcerptAnchorRecord {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	const lockedNodeId = readOptionalStringField(record.lockedNodeId);
	const lastCreatedNodeId = readOptionalStringField(record.lastCreatedNodeId);
	return {
		lockedNodeId: lockedNodeId || null,
		lastCreatedNodeId: lastCreatedNodeId || null,
		layoutDirection: normalizeCanvasLayoutDirection(record.layoutDirection),
	};
}

export function normalizeCanvasExcerptAnchorsMap(
	value: unknown
): Record<string, CanvasExcerptAnchorRecord> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.map(([canvasPath, record]) => {
				const normalizedPath = normalizePath(String(canvasPath || "").trim());
				if (!normalizedPath) {
					return null;
				}
				return [normalizedPath, normalizeCanvasExcerptAnchorRecord(record)] as const;
			})
			.filter((entry): entry is [string, CanvasExcerptAnchorRecord] => Boolean(entry))
	);
}

export async function getCanvasExcerptAnchorState(
	app: App,
	canvasPath: string
): Promise<CanvasExcerptAnchorRecord> {
	const normalizedPath = normalizePath(String(canvasPath || "").trim());
	if (!normalizedPath) {
		return {
			lockedNodeId: null,
			lastCreatedNodeId: null,
			layoutDirection: DEFAULT_LAYOUT_DIRECTION,
		};
	}

	const cached = readCanvasExcerptAnchorStateFromCache(app, normalizedPath);
	if (getAnchorCache(app).has(normalizedPath)) {
		return cached;
	}

	const loaded = await getEpubStorageService(app).getCanvasExcerptAnchor(normalizedPath);
	getAnchorCache(app).set(normalizedPath, { ...loaded });
	return { ...loaded };
}

export function readCanvasExcerptAnchorStateFromCache(
	app: App,
	canvasPath: string
): CanvasExcerptAnchorRecord {
	const normalizedPath = normalizePath(String(canvasPath || "").trim());
	if (!normalizedPath) {
		return {
			lockedNodeId: null,
			lastCreatedNodeId: null,
			layoutDirection: DEFAULT_LAYOUT_DIRECTION,
		};
	}

	const cached = getAnchorCache(app).get(normalizedPath);
	if (cached) {
		return { ...cached };
	}

	return {
		lockedNodeId: null,
		lastCreatedNodeId: null,
		layoutDirection: DEFAULT_LAYOUT_DIRECTION,
	};
}

export function readCanvasExcerptLayoutDirectionFromCache(
	app: App,
	canvasPath: string
): CanvasLayoutDirection {
	return readCanvasExcerptAnchorStateFromCache(app, canvasPath).layoutDirection ?? DEFAULT_LAYOUT_DIRECTION;
}

export async function warmCanvasExcerptAnchorCache(app: App, canvasPath: string): Promise<void> {
	const normalizedPath = normalizePath(String(canvasPath || "").trim());
	if (!normalizedPath || getAnchorCache(app).has(normalizedPath)) {
		return;
	}
	await getCanvasExcerptAnchorState(app, normalizedPath);
}

export async function getCanvasExcerptLayoutDirection(
	app: App,
	canvasPath: string
): Promise<CanvasLayoutDirection> {
	const state = await getCanvasExcerptAnchorState(app, canvasPath);
	return state.layoutDirection ?? DEFAULT_LAYOUT_DIRECTION;
}

export async function setCanvasExcerptAnchorLock(
	app: App,
	canvasPath: string,
	nodeId: string | null
): Promise<CanvasExcerptAnchorRecord> {
	const normalizedPath = normalizePath(String(canvasPath || "").trim());
	const normalizedNodeId = String(nodeId || "").trim() || null;
	const current = await getCanvasExcerptAnchorState(app, normalizedPath);
	const next: CanvasExcerptAnchorRecord = {
		...current,
		lockedNodeId: normalizedNodeId,
	};
	await getEpubStorageService(app).setCanvasExcerptAnchor(normalizedPath, next);
	getAnchorCache(app).set(normalizedPath, { ...next });
	return next;
}

export async function setCanvasExcerptLastCreatedNode(
	app: App,
	canvasPath: string,
	nodeId: string | null
): Promise<void> {
	const normalizedPath = normalizePath(String(canvasPath || "").trim());
	const normalizedNodeId = String(nodeId || "").trim() || null;
	const current = await getCanvasExcerptAnchorState(app, normalizedPath);
	const next: CanvasExcerptAnchorRecord = {
		...current,
		lastCreatedNodeId: normalizedNodeId,
	};
	await getEpubStorageService(app).setCanvasExcerptAnchor(normalizedPath, next);
	getAnchorCache(app).set(normalizedPath, { ...next });
}

export async function setCanvasExcerptLayoutDirection(
	app: App,
	canvasPath: string,
	direction: CanvasLayoutDirection
): Promise<CanvasExcerptAnchorRecord> {
	const normalizedPath = normalizePath(String(canvasPath || "").trim());
	const current = await getCanvasExcerptAnchorState(app, normalizedPath);
	const next: CanvasExcerptAnchorRecord = {
		...current,
		layoutDirection: normalizeCanvasLayoutDirection(direction),
	};
	await getEpubStorageService(app).setCanvasExcerptAnchor(normalizedPath, next);
	getAnchorCache(app).set(normalizedPath, { ...next });
	app.workspace.trigger(WEAVE_EPUB_CANVAS_LAYOUT_DIRECTION_EVENT, {
		canvasPath: normalizedPath,
		direction: next.layoutDirection,
	} satisfies WeaveEpubCanvasLayoutDirectionPayload);
	return next;
}

export function registerCanvasExcerptAnchorCacheWarmup(plugin: Plugin): void {
	const app = plugin.app;
	const warmActiveCanvasCache = () => {
		const canvasPath = resolveActiveCanvasFilePath(app);
		if (canvasPath) {
			void warmCanvasExcerptAnchorCache(app, canvasPath);
		}
	};

	plugin.registerEvent(app.workspace.on("layout-change", warmActiveCanvasCache));
	plugin.registerEvent(app.workspace.on("active-leaf-change", warmActiveCanvasCache));
}

export function getDirectChildNodes(data: CanvasData, parentNodeId: string): CanvasNode[] {
	const parentId = String(parentNodeId || "").trim();
	if (!parentId) {
		return [];
	}
	const childIds = [
		...new Set(
			data.edges
				.filter((edge) => edge.fromNode === parentId)
				.map((edge) => edge.toNode)
		),
	];
	return childIds
		.map((childId) => data.nodes.find((node) => node.id === childId))
		.filter((node): node is CanvasNode => Boolean(node));
}

export function isCanvasPlacementObstacleNode(node: CanvasNode): boolean {
	return node.type !== "group";
}

export function filterPlacementObstacleNodes(nodes: CanvasNode[]): CanvasNode[] {
	return nodes.filter(isCanvasPlacementObstacleNode);
}

function rectanglesOverlap(
	a: { x: number; y: number; width: number; height: number },
	b: { x: number; y: number; width: number; height: number },
	gap = 8
): boolean {
	return !(
		a.x + a.width + gap <= b.x ||
		b.x + b.width + gap <= a.x ||
		a.y + a.height + gap <= b.y ||
		b.y + b.height + gap <= a.y
	);
}

export function avoidNodeOverlap(
	candidate: { x: number; y: number },
	nodeSize: { width: number; height: number },
	existingNodes: CanvasNode[],
	layoutDirection: CanvasLayoutDirection,
	maxAttempts = 32
): { x: number; y: number } {
	let position = { ...candidate };
	const obstacleNodes = filterPlacementObstacleNodes(existingNodes);
	const spreadStep =
		layoutDirection === "down" || layoutDirection === "up"
			? DEFAULT_NODE_WIDTH + NODE_GAP_X
			: DEFAULT_NODE_HEIGHT + NODE_GAP_Y;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const rect = { ...position, ...nodeSize };
		const overlaps = obstacleNodes.some((node) => rectanglesOverlap(rect, node));
		if (!overlaps) {
			return position;
		}

		switch (layoutDirection) {
			case "down":
			case "up":
				position = { x: candidate.x + (attempt + 1) * spreadStep, y: candidate.y };
				break;
			case "right":
			case "left":
				position = { x: candidate.x, y: candidate.y + (attempt + 1) * spreadStep };
				break;
		}
	}

	return position;
}

export function buildCanvasSelectionSnapshotKey(selectionNodeIds: string[]): string {
	return selectionNodeIds
		.map((nodeId) => String(nodeId || "").trim())
		.filter(Boolean)
		.sort()
		.join("|");
}

function nodeBottom(node: CanvasNode): number {
	return node.y + node.height;
}

function nodeRight(node: CanvasNode): number {
	return node.x + node.width;
}

interface BranchLaneGeometry {
	fixedX: number | null;
	fixedY: number | null;
	spreadAxis: "x" | "y";
	origin: { x: number; y: number };
}

const LANE_ALIGN_TOLERANCE = 16;

function resolveBranchLaneGeometry(
	hubNode: CanvasNode,
	layoutDirection: CanvasLayoutDirection
): BranchLaneGeometry {
	switch (layoutDirection) {
		case "down":
			return {
				fixedX: null,
				fixedY: hubNode.y + hubNode.height + NODE_GAP_Y,
				spreadAxis: "x",
				origin: { x: hubNode.x, y: hubNode.y + hubNode.height + NODE_GAP_Y },
			};
		case "up":
			return {
				fixedX: null,
				fixedY: hubNode.y - DEFAULT_NODE_HEIGHT - NODE_GAP_Y,
				spreadAxis: "x",
				origin: { x: hubNode.x, y: hubNode.y - DEFAULT_NODE_HEIGHT - NODE_GAP_Y },
			};
		case "right":
			return {
				fixedX: hubNode.x + hubNode.width + NODE_GAP_X,
				fixedY: null,
				spreadAxis: "y",
				origin: { x: hubNode.x + hubNode.width + NODE_GAP_X, y: hubNode.y },
			};
		case "left":
			return {
				fixedX: hubNode.x - DEFAULT_NODE_WIDTH - NODE_GAP_X,
				fixedY: null,
				spreadAxis: "y",
				origin: { x: hubNode.x - DEFAULT_NODE_WIDTH - NODE_GAP_X, y: hubNode.y },
			};
	}
}

function isSiblingInBranchLane(sibling: CanvasNode, lane: BranchLaneGeometry): boolean {
	if (lane.fixedX != null) {
		return Math.abs(sibling.x - lane.fixedX) <= LANE_ALIGN_TOLERANCE;
	}
	return Math.abs(sibling.y - lane.fixedY!) <= LANE_ALIGN_TOLERANCE;
}

function advanceAlongBranchLane(
	position: { x: number; y: number },
	nodeSize: { width: number; height: number },
	lane: BranchLaneGeometry
): { x: number; y: number } {
	if (lane.spreadAxis === "y") {
		return { x: position.x, y: position.y + nodeSize.height + NODE_GAP_Y };
	}
	return { x: position.x + nodeSize.width + NODE_GAP_X, y: position.y };
}

function computeBranchLaneOrigin(
	existingChildren: CanvasNode[],
	lane: BranchLaneGeometry
): { x: number; y: number } {
	const inLaneSiblings = existingChildren.filter((child) => isSiblingInBranchLane(child, lane));
	const siblings = inLaneSiblings.length > 0 ? inLaneSiblings : existingChildren;
	if (siblings.length === 0) {
		return { ...lane.origin };
	}

	if (lane.spreadAxis === "y") {
		const laneX = lane.fixedX ?? lane.origin.x;
		let maxBottom = -Infinity;
		for (const sibling of siblings) {
			maxBottom = Math.max(maxBottom, nodeBottom(sibling));
		}
		return { x: laneX, y: maxBottom + NODE_GAP_Y };
	}

	const laneY = lane.fixedY ?? lane.origin.y;
	let maxRight = -Infinity;
	let spreadY = laneY;
	for (const sibling of siblings) {
		maxRight = Math.max(maxRight, nodeRight(sibling));
		if (inLaneSiblings.length === 0) {
			spreadY = sibling.y;
		}
	}
	return { x: maxRight + NODE_GAP_X, y: spreadY };
}

/**
 * Mind-map branch lane layout:
 * - fixed lane coordinate on the primary axis (right/left => x, down/up => y)
 * - siblings accumulate on the perpendicular axis using actual child bounds
 * - collision checks only consider direct hub children, never the whole canvas
 */
export function calculateMindMapHubNodePosition(
	hubNode: CanvasNode,
	existingChildren: CanvasNode[],
	layoutDirection: CanvasLayoutDirection,
	nodeSize: { width: number; height: number } = {
		width: DEFAULT_NODE_WIDTH,
		height: DEFAULT_NODE_HEIGHT,
	}
): { x: number; y: number } {
	const lane = resolveBranchLaneGeometry(hubNode, layoutDirection);
	let position = computeBranchLaneOrigin(existingChildren, lane);
	const maxAttempts = Math.max(existingChildren.length + 8, 8);

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const candidateRect = { ...position, ...nodeSize };
		const blocked = existingChildren.some((sibling) =>
			rectanglesOverlap(candidateRect, sibling)
		);
		if (!blocked) {
			return position;
		}
		position = advanceAlongBranchLane(position, nodeSize, lane);
	}

	return position;
}

/**
 * Chain layout for selected-node mode: each new node extends along the layout direction
 * from the current chain tip (selected node, then last excerpt).
 */
export function calculateChainNodePosition(
	anchorNode: CanvasNode,
	layoutDirection: CanvasLayoutDirection,
	nodeSize: { width: number; height: number } = {
		width: DEFAULT_NODE_WIDTH,
		height: DEFAULT_NODE_HEIGHT,
	}
): { x: number; y: number } {
	switch (layoutDirection) {
		case "down":
			return { x: anchorNode.x, y: nodeBottom(anchorNode) + NODE_GAP_Y };
		case "up":
			return { x: anchorNode.x, y: anchorNode.y - nodeSize.height - NODE_GAP_Y };
		case "right":
			return { x: nodeRight(anchorNode) + NODE_GAP_X, y: anchorNode.y };
		case "left":
			return { x: anchorNode.x - nodeSize.width - NODE_GAP_X, y: anchorNode.y };
	}
}

export function isDirectCanvasChildEdge(
	edges: readonly CanvasEdge[],
	parentNodeId: string,
	childNodeId: string
): boolean {
	const parentId = String(parentNodeId || "").trim();
	const childId = String(childNodeId || "").trim();
	if (!parentId || !childId) {
		return false;
	}
	return edges.some((edge) => edge.fromNode === parentId && edge.toNode === childId);
}

export function resolveCanvasExcerptAnchorNodeId(
	state: CanvasExcerptAnchorRecord,
	selectionNodeIds: string[],
	validNodeIds: ReadonlySet<string>,
	selectionSnapshotAtLastInsert: string | null = null,
	edges: readonly CanvasEdge[] = []
): CanvasExcerptAnchorResolution {
	const lockedNodeId = String(state.lockedNodeId || "").trim();
	if (lockedNodeId && validNodeIds.has(lockedNodeId)) {
		return { nodeId: lockedNodeId, mode: "locked" };
	}

	const selectedNodeIds = selectionNodeIds.filter((nodeId) => validNodeIds.has(nodeId));
	const selectionKey = buildCanvasSelectionSnapshotKey(selectedNodeIds);
	const selectionChangedSinceLastInsert =
		selectionKey !== String(selectionSnapshotAtLastInsert ?? "");

	const lastCreatedNodeId = String(state.lastCreatedNodeId || "").trim();
	const hasLastCreated = Boolean(lastCreatedNodeId && validNodeIds.has(lastCreatedNodeId));
	const singleSelectedNodeId =
		selectedNodeIds.length === 1 ? selectedNodeIds[0] : undefined;

	if (singleSelectedNodeId && selectionChangedSinceLastInsert) {
		return { nodeId: singleSelectedNodeId, mode: "selection" };
	}

	if (
		hasLastCreated &&
		!selectionChangedSinceLastInsert &&
		singleSelectedNodeId &&
		isDirectCanvasChildEdge(edges, singleSelectedNodeId, lastCreatedNodeId)
	) {
		return { nodeId: lastCreatedNodeId, mode: "chain" };
	}

	if (singleSelectedNodeId) {
		return { nodeId: singleSelectedNodeId, mode: "selection" };
	}

	return { nodeId: null, mode: "root" };
}

function getPreferredCanvasLeaf(app: App): WorkspaceLeaf | null {
	const canvasLeaves = app.workspace.getLeavesOfType("canvas");
	if (canvasLeaves.length === 0) {
		return null;
	}

	const recentLeaf = app.workspace.getMostRecentLeaf?.() ?? null;
	if (
		recentLeaf &&
		(recentLeaf.view as { getViewType?: () => string } | undefined)?.getViewType?.() === "canvas"
	) {
		return recentLeaf;
	}

	return canvasLeaves.find((leaf) => leaf === recentLeaf) ?? canvasLeaves[0] ?? null;
}

export function resolveActiveCanvasFilePath(app: App): string | null {
	const preferredLeaf = getPreferredCanvasLeaf(app);
	const view = preferredLeaf?.view as { file?: { path?: string; extension?: string } } | undefined;
	const canvasPath = String(view?.file?.path || "").trim();
	if (!canvasPath || view?.file?.extension !== "canvas") {
		return null;
	}
	return canvasPath;
}

export function readBoundCanvasSelection(
	app: App,
	boundCanvasPath: string | null
): BoundCanvasSelection | null {
	if (!boundCanvasPath) {
		return null;
	}

	try {
		const normalizedBoundPath = normalizePath(boundCanvasPath);
		const canvasLeaves = app.workspace.getLeavesOfType("canvas");
		for (const leaf of canvasLeaves) {
			const canvasView = leaf.view as {
				file?: { path?: string };
				canvas?: {
					selection?: Set<{ id?: string }>;
					getData?: () => CanvasData;
				};
			};
			if (!canvasView?.canvas) {
				continue;
			}

			const filePath = String(canvasView.file?.path || "").trim();
			if (normalizePath(filePath) !== normalizedBoundPath) {
				continue;
			}

			const selection = canvasView.canvas.selection;
			if (!selection || selection.size === 0) {
				return { canvasPath: normalizedBoundPath, nodeIds: [] };
			}

			const data = canvasView.canvas.getData?.();
			const validNodeIds = new Set(
				(Array.isArray(data?.nodes) ? data.nodes : [])
					.map((node: CanvasNode) => String(node.id || "").trim())
					.filter(Boolean)
			);
			const nodeIds: string[] = [];
			for (const item of Array.from(selection.values())) {
				const nodeId = String(item?.id || "").trim();
				if (nodeId && validNodeIds.has(nodeId) && !nodeIds.includes(nodeId)) {
					nodeIds.push(nodeId);
				}
			}
			return { canvasPath: normalizedBoundPath, nodeIds };
		}
	} catch {
		return { canvasPath: normalizePath(boundCanvasPath), nodeIds: [] };
	}

	return null;
}
