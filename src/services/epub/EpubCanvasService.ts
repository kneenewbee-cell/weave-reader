import { Notice, TFile, TFolder, type App, normalizePath } from "obsidian";
import { i18n } from "../../utils/i18n";
import { logger } from "../../utils/logger";
import { generateCardUUID } from "../identifier/WeaveIDGenerator";
import {
	buildCanvasSelectionSnapshotKey,
	calculateChainNodePosition,
	calculateMindMapHubNodePosition,
	filterPlacementObstacleNodes,
	getCanvasExcerptAnchorState,
	getCanvasExcerptLayoutDirection,
	getDirectChildNodes,
	readBoundCanvasSelection,
	resolveCanvasExcerptAnchorNodeId,
	setCanvasExcerptLastCreatedNode,
	setCanvasExcerptLayoutDirection,
	type CanvasExcerptAnchorMode,
} from "./canvas-excerpt-anchor";
import { estimateCanvasTextNodeSize } from "./canvas-text-node-size";
import { EpubLinkService } from "./EpubLinkService";
import type {
	CanvasAnchor,
	CanvasData,
	CanvasEdge,
	CanvasLayoutDirection,
	CanvasNode,
	CanvasSide,
} from "./canvas-types";
import type { EpubHighlightStyle } from "./types";
import {
	HIGHLIGHT_TO_CANVAS_COLOR,
	NODE_GAP_X,
	NODE_GAP_Y,
} from "./canvas-types";

export class EpubCanvasService {
	private app: App;
	private linkService: EpubLinkService;
	private canvasPath: string | null = null;
	private anchor: CanvasAnchor | null = null;
	private layoutDirection: CanvasLayoutDirection = "down";
	private lastInsertAnchorMode: CanvasExcerptAnchorMode | null = null;
	private insertHubNodeId: string | null = null;
	private insertSelectionSnapshotByCanvas = new Map<string, string>();

	constructor(app: App) {
		this.app = app;
		this.linkService = new EpubLinkService(app);
	}

	getCanvasPath(): string | null {
		return this.canvasPath;
	}

	setCanvasPath(path: string | null): void {
		this.canvasPath = path;
		if (!path) {
			this.insertSelectionSnapshotByCanvas.clear();
			return;
		}
		void this.syncLayoutDirectionFromStorage(path);
	}

	getLayoutDirection(): CanvasLayoutDirection {
		return this.layoutDirection;
	}

	applyLayoutDirection(dir: CanvasLayoutDirection): void {
		this.layoutDirection = dir;
	}

	setLayoutDirection(dir: CanvasLayoutDirection): void {
		this.applyLayoutDirection(dir);
		if (!this.canvasPath) {
			return;
		}
		void setCanvasExcerptLayoutDirection(this.app, this.canvasPath, dir).catch((error) => {
			logger.warn("[EpubCanvasService] Failed to persist canvas layout direction:", error);
		});
	}

	getAnchor(): CanvasAnchor | null {
		return this.anchor;
	}

	setAnchor(anchor: CanvasAnchor | null): void {
		this.anchor = anchor;
	}

	getLastInsertAnchorMode(): CanvasExcerptAnchorMode | null {
		return this.lastInsertAnchorMode;
	}

	isActive(): boolean {
		return this.canvasPath !== null;
	}

	async createCanvas(canvasPath: string): Promise<void> {
		const normalizedPath = this.normalizeCanvasPath(canvasPath);
		await this.ensureVaultFolderExists(this.getParentFolderPath(normalizedPath));
		const emptyCanvas: CanvasData = { nodes: [], edges: [] };
		await this.writeVaultTextFile(normalizedPath, JSON.stringify(emptyCanvas));
		this.canvasPath = normalizedPath;
	}

	async readCanvas(): Promise<CanvasData> {
		if (!this.canvasPath) {
			return { nodes: [], edges: [] };
		}

		const file = this.app.vault.getAbstractFileByPath(this.canvasPath);
		if (!(file instanceof TFile)) {
			return { nodes: [], edges: [] };
		}

		try {
			const content = await this.app.vault.read(file);
			return JSON.parse(content) as CanvasData;
		} catch (e) {
			logger.warn("[EpubCanvasService] Failed to read canvas:", e);
			return { nodes: [], edges: [] };
		}
	}

	private async writeCanvas(data: CanvasData): Promise<void> {
		if (!this.canvasPath) return;
		await this.ensureVaultFolderExists(this.getParentFolderPath(this.canvasPath));
		await this.writeVaultTextFile(this.canvasPath, JSON.stringify(data));
	}

	private normalizeCanvasPath(canvasPath: string): string {
		const raw = String(canvasPath || "").trim();
		if (!raw) {
			throw new Error("Canvas path is required");
		}
		const withExtension = raw.endsWith(".canvas") ? raw : `${raw}.canvas`;
		return normalizePath(withExtension);
	}

	private getParentFolderPath(filePath: string): string {
		const lastSlashIndex = filePath.lastIndexOf("/");
		return lastSlashIndex > 0 ? filePath.slice(0, lastSlashIndex) : "";
	}

	private async ensureVaultFolderExists(folderPath: string): Promise<void> {
		const normalizedFolderPath = normalizePath(String(folderPath || "").trim());
		if (!normalizedFolderPath) {
			return;
		}

		const existing = this.app.vault.getAbstractFileByPath(normalizedFolderPath);
		if (existing instanceof TFolder) {
			return;
		}
		if (existing && !(existing instanceof TFolder)) {
			throw new Error(`Path exists and is not a folder: ${normalizedFolderPath}`);
		}

		const segments = normalizedFolderPath.split("/").filter(Boolean);
		let currentPath = "";
		for (const segment of segments) {
			currentPath = currentPath ? `${currentPath}/${segment}` : segment;
			const currentEntry = this.app.vault.getAbstractFileByPath(currentPath);
			if (currentEntry instanceof TFolder) {
				continue;
			}
			if (currentEntry && !(currentEntry instanceof TFolder)) {
				throw new Error(`Path exists and is not a folder: ${currentPath}`);
			}
			await this.app.vault.createFolder(currentPath);
		}
	}

	private async writeVaultTextFile(path: string, content: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
			return;
		}
		if (existing) {
			throw new Error(`Path exists and is not a file: ${path}`);
		}
		await this.app.vault.create(path, content);
	}

	async addExcerptNode(
		text: string,
		cfiRange: string,
		filePath: string,
		chapterIndex?: number,
		chapterTitle?: string,
		color?: string,
		timestamp?: string,
		sourceId?: string,
		style?: EpubHighlightStyle,
		chapterLabelMaxLength?: number,
		semanticId?: string
	): Promise<CanvasNode | null> {
		if (!this.canvasPath) return null;

		const noteContent = this.linkService.buildQuoteBlock(
			filePath,
			cfiRange,
			text,
			chapterIndex,
			color,
			chapterTitle,
			timestamp,
			this.canvasPath || undefined,
			sourceId,
			undefined,
			style,
			chapterLabelMaxLength,
			semanticId
		);

		return this.insertCanvasTextNode(noteContent, color, "add excerpt node");
	}

	async addRawTextNode(content: string, color?: string): Promise<CanvasNode | null> {
		return this.insertCanvasTextNode(content, color, "add raw text node");
	}

	async hasExcerptNodeForCfi(cfiRange: string): Promise<boolean> {
		const targetCfi = EpubLinkService.normalizeCfi(String(cfiRange || "").trim());
		if (!targetCfi || !this.canvasPath) {
			return false;
		}
		const data = await this.readCanvas();
		return data.nodes.some((node) => this.nodeContainsExcerptCfi(node, targetCfi));
	}

	async removeExcerptNodesByCfi(cfiRange: string): Promise<number> {
		const targetCfi = EpubLinkService.normalizeCfi(String(cfiRange || "").trim());
		if (!targetCfi || !this.canvasPath) {
			return 0;
		}
		try {
			const data = await this.readCanvas();
			const removeNodeIds = new Set(
				data.nodes
					.filter((node) => this.nodeContainsExcerptCfi(node, targetCfi))
					.map((node) => node.id)
			);
			if (removeNodeIds.size === 0) {
				return 0;
			}
			data.nodes = data.nodes.filter((node) => !removeNodeIds.has(node.id));
			data.edges = data.edges.filter(
				(edge) => !removeNodeIds.has(edge.fromNode) && !removeNodeIds.has(edge.toNode)
			);
			await this.writeCanvas(data);
			return removeNodeIds.size;
		} catch (e) {
			logger.error("[EpubCanvasService] Failed to remove excerpt nodes:", e);
			new Notice(i18n.t("views.epubView.notice.canvasAddNodeFailed"));
			return 0;
		}
	}

	private nodeContainsExcerptCfi(node: CanvasNode, normalizedTargetCfi: string): boolean {
		if (node.type !== "text" || !node.text) {
			return false;
		}
		for (const markup of EpubLinkService.collectEpubLinkMarkups(node.text)) {
			const parsed = EpubLinkService.parseLinkMarkup(markup);
			if (parsed && EpubLinkService.normalizeCfi(parsed.cfi) === normalizedTargetCfi) {
				return true;
			}
		}
		return false;
	}

	private async insertCanvasTextNode(
		text: string,
		color: string | undefined,
		logLabel: string
	): Promise<CanvasNode | null> {
		if (!this.canvasPath) return null;

		try {
			const data = await this.readCanvas();
			await this.prepareInsertAnchor(data);

			const nodeId = this.generateNodeId();
			const canvasColor = color ? HIGHLIGHT_TO_CANVAS_COLOR[color] : undefined;
			const nodeSize = estimateCanvasTextNodeSize(text);
			const position = this.calculateNodePosition(data, nodeSize);

			const node: CanvasNode = {
				id: nodeId,
				type: "text",
				text,
				x: position.x,
				y: position.y,
				width: nodeSize.width,
				height: nodeSize.height,
				...(canvasColor && { color: canvasColor }),
			};

			data.nodes.push(node);

			const parentId = this.resolveParentNodeId(data);
			if (parentId) {
				const sides = this.getEdgeSides();
				const edge: CanvasEdge = {
					id: this.generateNodeId(),
					fromNode: parentId,
					toNode: nodeId,
					fromSide: sides.fromSide,
					toSide: sides.toSide,
				};
				data.edges.push(edge);
			}

			await this.writeCanvas(data);
			await this.finalizeInsertAnchor(nodeId, parentId);

			return node;
		} catch (e) {
			logger.error(`[EpubCanvasService] Failed to ${logLabel}:`, e);
			new Notice(i18n.t("views.epubView.notice.canvasAddNodeFailed"));
			return null;
		}
	}

	private resolveParentNodeId(data: CanvasData): string | null {
		return this.resolveInsertHubNode(data)?.id || null;
	}

	private resolveInsertHubNode(data: CanvasData): CanvasNode | null {
		const hubNodeId = String(this.insertHubNodeId || this.anchor?.nodeId || "").trim();
		if (!hubNodeId) {
			return null;
		}
		return data.nodes.find((node) => node.id === hubNodeId) || null;
	}

	private getEdgeSides(): { fromSide: CanvasSide; toSide: CanvasSide } {
		switch (this.layoutDirection) {
			case "down":
				return { fromSide: "bottom", toSide: "top" };
			case "up":
				return { fromSide: "top", toSide: "bottom" };
			case "right":
				return { fromSide: "right", toSide: "left" };
			case "left":
				return { fromSide: "left", toSide: "right" };
		}
	}

	private calculateNodePosition(
		data: CanvasData,
		nodeSize: { width: number; height: number }
	): { x: number; y: number } {
		const anchorNode = this.resolveInsertHubNode(data);
		if (!anchorNode) {
			return this.calculateRootPosition(data, nodeSize);
		}

		if (this.lastInsertAnchorMode === "chain") {
			return calculateChainNodePosition(anchorNode, this.layoutDirection, nodeSize);
		}

		const existingChildren = getDirectChildNodes(data, anchorNode.id);
		return calculateMindMapHubNodePosition(
			anchorNode,
			existingChildren,
			this.layoutDirection,
			nodeSize
		);
	}

	private getInsertSelectionSnapshot(): string | null {
		if (!this.canvasPath) {
			return null;
		}
		return this.insertSelectionSnapshotByCanvas.get(this.canvasPath) ?? null;
	}

	private rememberInsertSelectionSnapshot(selectionNodeIds: string[]): void {
		if (!this.canvasPath) {
			return;
		}
		this.insertSelectionSnapshotByCanvas.set(
			this.canvasPath,
			buildCanvasSelectionSnapshotKey(selectionNodeIds)
		);
	}

	private calculateRootPosition(
		data: CanvasData,
		nodeSize: { width: number; height: number }
	): { x: number; y: number } {
		const placementNodes = filterPlacementObstacleNodes(data.nodes);
		if (placementNodes.length === 0) {
			return { x: 0, y: 0 };
		}

		switch (this.layoutDirection) {
			case "down": {
				let maxY = -Infinity;
				for (const node of placementNodes) {
					const bottom = node.y + node.height;
					if (bottom > maxY) maxY = bottom;
				}
				return { x: 0, y: maxY + NODE_GAP_Y };
			}
			case "up": {
				let minY = Infinity;
				for (const node of placementNodes) {
					if (node.y < minY) minY = node.y;
				}
				return { x: 0, y: minY - nodeSize.height - NODE_GAP_Y };
			}
			case "right": {
				let maxX = -Infinity;
				for (const node of placementNodes) {
					const right = node.x + node.width;
					if (right > maxX) maxX = right;
				}
				return { x: maxX + NODE_GAP_X, y: 0 };
			}
			case "left": {
				let minX = Infinity;
				for (const node of placementNodes) {
					if (node.x < minX) minX = node.x;
				}
				return { x: minX - nodeSize.width - NODE_GAP_X, y: 0 };
			}
		}
	}

	private async syncLayoutDirectionFromStorage(canvasPath: string): Promise<void> {
		try {
			this.layoutDirection = await getCanvasExcerptLayoutDirection(this.app, canvasPath);
		} catch (error) {
			logger.warn("[EpubCanvasService] Failed to load canvas layout direction:", error);
		}
	}

	private async prepareInsertAnchor(data: CanvasData): Promise<void> {
		if (!this.canvasPath) {
			this.anchor = null;
			this.insertHubNodeId = null;
			this.lastInsertAnchorMode = null;
			return;
		}

		await this.syncLayoutDirectionFromStorage(this.canvasPath);

		const selection = readBoundCanvasSelection(this.app, this.canvasPath);
		let anchorState = {
			lockedNodeId: null,
			lastCreatedNodeId: null,
			layoutDirection: this.layoutDirection,
		};
		try {
			anchorState = await getCanvasExcerptAnchorState(this.app, this.canvasPath);
			if (anchorState.layoutDirection) {
				this.layoutDirection = anchorState.layoutDirection;
			}
		} catch (error) {
			logger.warn("[EpubCanvasService] Failed to load canvas excerpt anchor state:", error);
		}

		const validNodeIds = new Set(
			data.nodes.map((node) => String(node.id || "").trim()).filter(Boolean)
		);
		const resolution = resolveCanvasExcerptAnchorNodeId(
			anchorState,
			selection?.nodeIds ?? [],
			validNodeIds,
			this.getInsertSelectionSnapshot(),
			data.edges
		);
		this.lastInsertAnchorMode = resolution.mode;
		if (!resolution.nodeId) {
			this.anchor = null;
			this.insertHubNodeId = null;
			return;
		}

		let parentNodeId: string | null = null;
		if (resolution.mode === "locked") {
			parentNodeId = resolution.nodeId;
		} else {
			const parentEdge = data.edges.find((edge) => edge.toNode === resolution.nodeId);
			if (parentEdge) {
				parentNodeId = parentEdge.fromNode;
			}
		}

		this.insertHubNodeId = resolution.mode === "locked" ? resolution.nodeId : null;
		this.anchor = {
			nodeId: resolution.nodeId,
			parentNodeId,
		};
	}

	private async finalizeInsertAnchor(nodeId: string, parentId: string | null): Promise<void> {
		const hubNodeId = String(this.insertHubNodeId || "").trim();
		if (hubNodeId && this.lastInsertAnchorMode === "locked") {
			this.anchor = {
				nodeId: hubNodeId,
				parentNodeId: hubNodeId,
			};
		} else {
			this.anchor = {
				nodeId,
				parentNodeId: parentId,
			};
			this.insertHubNodeId = null;
		}
		if (!this.canvasPath) {
			return;
		}
		try {
			await setCanvasExcerptLastCreatedNode(this.app, this.canvasPath, nodeId);
		} catch (error) {
			logger.warn("[EpubCanvasService] Failed to persist canvas excerpt last-created node:", error);
		}

		const selection = readBoundCanvasSelection(this.app, this.canvasPath);
		this.rememberInsertSelectionSnapshot(selection?.nodeIds ?? []);
	}

	async listCanvasFiles(): Promise<string[]> {
		const files = this.app.vault.getFiles();
		return files
			.filter((f) => f.extension === "canvas")
			.map((f) => f.path)
			.sort();
	}

	private generateNodeId(): string {
		return generateCardUUID().replace(/-/g, "").substring(0, 16);
	}
}
