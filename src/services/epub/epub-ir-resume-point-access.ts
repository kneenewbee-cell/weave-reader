import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import { getV2PathsFromApp } from "../../config/paths";
import type { IRPoint, IRPointFileData, IRPointFileIndex } from "../../types/ir-point-storage-types";
import { safeReadJson, safeWriteJson } from "../../utils/safe-json-io";
import { logger } from "../../utils/logger";
import type { EpubStorageService } from "./EpubStorageService";

export interface EpubIrResumePointRecord {
	id: string;
	epubFilePath: string;
	sourceId?: string;
	resumeCfi?: string;
}

type LegacyEpubBookmarkTask = {
	id: string;
	epubFilePath: string;
	sourceId?: string;
	resumeCfi?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEpubBookmarkPoint(point: IRPoint): boolean {
	if (point.id.startsWith("epubbm-")) {
		return true;
	}

	const originType = point.audit?.origin?.type;
	if (originType === "epub-bookmark") {
		return true;
	}

	if (point.trace?.locatorType === "epub-chapter") {
		return true;
	}

	return point.pointType === "chapter-entry" && point.source?.type === "epub";
}

function readResumeCfiFromPoint(point: IRPoint): string | undefined {
	const locator = point.trace?.locator;
	const resumeCfi =
		locator && typeof locator.resumeCfi === "string" ? locator.resumeCfi.trim() : "";
	return resumeCfi || undefined;
}

function matchesEpubPath(
	taskPath: string,
	sourceId: string | undefined,
	targetPath: string,
	targetSourceId?: string
): boolean {
	const normalizedTaskPath = normalizePath(String(taskPath || "").trim());
	const normalizedTargetPath = normalizePath(String(targetPath || "").trim());
	if (normalizedTaskPath && normalizedTaskPath === normalizedTargetPath) {
		return true;
	}

	return Boolean(
		targetSourceId &&
			sourceId &&
			String(sourceId).trim() === String(targetSourceId).trim()
	);
}

export class EpubIrResumePointAccess {
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	async listResumePointsByEpub(
		epubFilePath: string,
		epubStorageService: EpubStorageService
	): Promise<EpubIrResumePointRecord[]> {
		const normalizedPath = normalizePath(String(epubFilePath || "").trim());
		if (!normalizedPath) {
			return [];
		}

		const sourceEntry = await epubStorageService.ensureSourceIdentity(normalizedPath);
		const targetSourceId = sourceEntry?.sourceId;
		const fromPoints = await this.listFromPointStorage(normalizedPath, targetSourceId);
		if (fromPoints.length > 0) {
			return fromPoints;
		}

		return await this.listFromLegacyTaskFile(normalizedPath, targetSourceId);
	}

	async updateResumeCfi(pointId: string, cfi: string): Promise<boolean> {
		const normalizedId = String(pointId || "").trim();
		const normalizedCfi = String(cfi || "").trim();
		if (!normalizedId || !normalizedCfi) {
			return false;
		}

		if (await this.updatePointStorageResumeCfi(normalizedId, normalizedCfi)) {
			return true;
		}

		return await this.updateLegacyTaskResumeCfi(normalizedId, normalizedCfi);
	}

	private async listFromPointStorage(
		epubFilePath: string,
		sourceId?: string
	): Promise<EpubIrResumePointRecord[]> {
		const paths = getV2PathsFromApp(this.app);
		const adapter = this.app.vault.adapter;
		const indexPath = paths.ir.pointFilesIndex;
		if (!(await adapter.exists(indexPath))) {
			return [];
		}

		const index = await safeReadJson<IRPointFileIndex | null>(adapter, indexPath, this.app);
		const files = Array.isArray(index?.files) ? index.files : [];
		const results: EpubIrResumePointRecord[] = [];

		for (const entry of files) {
			const relativeFile = String(entry?.file || "").trim();
			if (!relativeFile) {
				continue;
			}

			const absolutePath = normalizePath(`${paths.ir.root}/${relativeFile}`);
			if (!(await adapter.exists(absolutePath))) {
				continue;
			}

			const fileData = await safeReadJson<IRPointFileData | null>(adapter, absolutePath, this.app);
			const points = Array.isArray(fileData?.points) ? fileData.points : [];
			for (const point of points) {
				if (!point?.id || !isEpubBookmarkPoint(point)) {
					continue;
				}

				const epubPath = String(point.source?.path || "").trim();
				if (!matchesEpubPath(epubPath, point.materialId, epubFilePath, sourceId)) {
					continue;
				}

				results.push({
					id: point.id,
					epubFilePath: epubPath || epubFilePath,
					sourceId: point.materialId,
					resumeCfi: readResumeCfiFromPoint(point),
				});
			}
		}

		return results;
	}

	private async updatePointStorageResumeCfi(pointId: string, cfi: string): Promise<boolean> {
		const paths = getV2PathsFromApp(this.app);
		const adapter = this.app.vault.adapter;
		const indexPath = paths.ir.pointFilesIndex;
		if (!(await adapter.exists(indexPath))) {
			return false;
		}

		const index = await safeReadJson<IRPointFileIndex | null>(adapter, indexPath, this.app);
		const files = Array.isArray(index?.files) ? index.files : [];

		for (const entry of files) {
			const relativeFile = String(entry?.file || "").trim();
			if (!relativeFile) {
				continue;
			}

			const absolutePath = normalizePath(`${paths.ir.root}/${relativeFile}`);
			if (!(await adapter.exists(absolutePath))) {
				continue;
			}

			const fileData = await safeReadJson<IRPointFileData | null>(adapter, absolutePath, this.app);
			if (!fileData || !Array.isArray(fileData.points)) {
				continue;
			}

			const pointIndex = fileData.points.findIndex((point) => point?.id === pointId);
			if (pointIndex < 0) {
				continue;
			}

			const point = fileData.points[pointIndex];
			if (!isEpubBookmarkPoint(point)) {
				continue;
			}

			const locator = {
				...(point.trace?.locator && typeof point.trace.locator === "object"
					? point.trace.locator
					: {}),
				resumeCfi: cfi,
			};
			const nowIso = new Date().toISOString();
			fileData.points[pointIndex] = {
				...point,
				trace: {
					...point.trace,
					locator,
				},
				timestamps: {
					...point.timestamps,
					lastInteractionAt: nowIso,
					updatedAt: nowIso,
				},
			};
			fileData.updatedAt = nowIso;

			await safeWriteJson(adapter, absolutePath, JSON.stringify(fileData), this.app);
			return true;
		}

		return false;
	}

	private async listFromLegacyTaskFile(
		epubFilePath: string,
		sourceId?: string
	): Promise<EpubIrResumePointRecord[]> {
		const paths = getV2PathsFromApp(this.app);
		const adapter = this.app.vault.adapter;
		const legacyPath = paths.ir.epubBookmarkTasks;
		if (!(await adapter.exists(legacyPath))) {
			return [];
		}

		const raw = await safeReadJson<unknown>(adapter, legacyPath, this.app);
		const tasks = Array.isArray(raw) ? raw : [];
		const results: EpubIrResumePointRecord[] = [];

		for (const item of tasks) {
			if (!isRecord(item) || typeof item.id !== "string") {
				continue;
			}

			const task = item as LegacyEpubBookmarkTask;
			const taskPath = String(task.epubFilePath || "").trim();
			if (!matchesEpubPath(taskPath, task.sourceId, epubFilePath, sourceId)) {
				continue;
			}

			results.push({
				id: task.id,
				epubFilePath: taskPath,
				sourceId: typeof task.sourceId === "string" ? task.sourceId : undefined,
				resumeCfi:
					typeof task.resumeCfi === "string" && task.resumeCfi.trim()
						? task.resumeCfi.trim()
						: undefined,
			});
		}

		return results;
	}

	private async updateLegacyTaskResumeCfi(pointId: string, cfi: string): Promise<boolean> {
		const paths = getV2PathsFromApp(this.app);
		const adapter = this.app.vault.adapter;
		const legacyPath = paths.ir.epubBookmarkTasks;
		if (!(await adapter.exists(legacyPath))) {
			return false;
		}

		const raw = await safeReadJson<unknown>(adapter, legacyPath, this.app);
		if (!Array.isArray(raw)) {
			return false;
		}

		let updated = false;
		const nextTasks: unknown[] = [];
		for (const item of raw) {
			if (isRecord(item) && item.id === pointId) {
				updated = true;
				nextTasks.push({
					...item,
					resumeCfi: cfi,
					resumeUpdatedAt: Date.now(),
					updatedAt:
						typeof item.updatedAt === "number" ? Date.now() : item.updatedAt,
				});
				continue;
			}
			nextTasks.push(item);
		}

		if (!updated) {
			return false;
		}

		await safeWriteJson(adapter, legacyPath, JSON.stringify(nextTasks), this.app);
		logger.debug("[EpubIrResumePointAccess] Updated legacy EPUB bookmark resume CFI", {
			pointId,
		});
		return true;
	}
}
