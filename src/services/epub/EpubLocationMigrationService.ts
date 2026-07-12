import type { App } from "obsidian";
import { logger } from "../../utils/logger";
import { EpubIrResumePointAccess } from "./epub-ir-resume-point-access";
import type { EpubStorageService } from "./EpubStorageService";
import { flushEpubStoragePendingProgress } from "./EpubStorageService";
import type { EpubReaderEngine } from "./reader-engine-types";

export interface EpubLocationMigrationSummary {
	progressMigrated: boolean;
	resumePointsMigrated: number;
}

const EMPTY_SUMMARY: EpubLocationMigrationSummary = {
	progressMigrated: false,
	resumePointsMigrated: 0,
};

export class EpubLocationMigrationService {
	private readonly app: App;
	private readonly storageService: EpubStorageService;
	private readonly readerService: EpubReaderEngine;

	constructor(app: App, storageService: EpubStorageService, readerService: EpubReaderEngine) {
		this.app = app;
		this.storageService = storageService;
		this.readerService = readerService;
	}

	async migrateBookData(bookId: string, filePath: string): Promise<EpubLocationMigrationSummary> {
		if (typeof this.readerService.canonicalizeLocation !== "function") {
			return { ...EMPTY_SUMMARY };
		}

		const summary: EpubLocationMigrationSummary = {
			...EMPTY_SUMMARY,
			progressMigrated: await this.migrateReadingProgress(bookId),
		};

		summary.resumePointsMigrated = await this.migrateResumePoints(filePath);

		if (summary.progressMigrated || summary.resumePointsMigrated > 0) {
			logger.info("[EpubLocationMigrationService] Migrated legacy EPUB locations:", {
				bookId,
				filePath,
				...summary,
			});
		}

		return summary;
	}

	private async migrateReadingProgress(bookId: string): Promise<boolean> {
		const progress = await this.storageService.loadProgress(bookId);
		if (!progress?.cfi) {
			return false;
		}

		const nextCfi = await this.canonicalizeLocation(progress.cfi);
		if (!nextCfi || nextCfi === progress.cfi) {
			return false;
		}

		await this.storageService.saveProgress(bookId, {
			...progress,
			cfi: nextCfi,
		});
		await flushEpubStoragePendingProgress(this.storageService);
		return true;
	}

	private async migrateResumePoints(filePath: string): Promise<number> {
		const resumeAccess = new EpubIrResumePointAccess(this.app);
		const tasks = await resumeAccess.listResumePointsByEpub(filePath, this.storageService);
		let migratedCount = 0;

		for (const task of tasks) {
			if (!task.resumeCfi) {
				continue;
			}

			const nextCfi = await this.canonicalizeLocation(task.resumeCfi);
			if (!nextCfi || nextCfi === task.resumeCfi) {
				continue;
			}

			if (await resumeAccess.updateResumeCfi(task.id, nextCfi)) {
				migratedCount += 1;
			}
		}

		return migratedCount;
	}

	private async canonicalizeLocation(cfi: string, textHint?: string): Promise<string | null> {
		if (!cfi || typeof this.readerService.canonicalizeLocation !== "function") {
			return null;
		}

		try {
			return await this.readerService.canonicalizeLocation(cfi, textHint);
		} catch (error) {
			logger.warn("[EpubLocationMigrationService] Failed to canonicalize location:", {
				cfi,
				error,
			});
			return null;
		}
	}
}
