import { normalizePath, TFile, type App } from "obsidian";
import { EpubLinkService } from "../epub/EpubLinkService";
import { getCompatibleDataStorage } from "../../utils/plugin-access";
import { logger } from "../../utils/logger";

type EpubCardLike = {
	uuid: string;
	content?: string;
	modified?: string;
};

export type EpubDataCheckStatus = "ok" | "warning" | "error";

export type EpubDataCheckResult = {
	type: "epub_source_link_migration" | "epub_markdown_source_id_backfill";
	status: EpubDataCheckStatus;
	count: number;
	items: string[];
	message: string;
};

export type EpubDataFixResult = {
	type: EpubDataCheckResult["type"];
	success: number;
	failed: number;
	errors: Array<{ uuid: string; error: string }>;
};

type SaveCardResult = { success?: boolean; error?: string };

export class EpubDataManagementService {
	constructor(private readonly app: App) {}

	async check(type: EpubDataCheckResult["type"]): Promise<EpubDataCheckResult> {
		switch (type) {
			case "epub_source_link_migration":
				return this.checkEpubSourceLinkMigration();
			case "epub_markdown_source_id_backfill":
				return this.checkEpubMarkdownSourceIdBackfill();
			default:
				return {
					type,
					status: "ok",
					count: 0,
					items: [],
					message: "未实现的检测项",
				};
		}
	}

	async fix(
		type: EpubDataCheckResult["type"],
		options: { allowHighRisk?: boolean } = {}
	): Promise<EpubDataFixResult> {
		void options;
		switch (type) {
			case "epub_source_link_migration":
				return this.fixEpubSourceLinkMigration();
			case "epub_markdown_source_id_backfill":
				return this.fixEpubMarkdownSourceIdBackfill();
			default:
				return { type, success: 0, failed: 0, errors: [] };
		}
	}

	private async getCards(): Promise<EpubCardLike[]> {
		const dataStorage = getCompatibleDataStorage(this.app);
		if (!dataStorage?.getAllCards) {
			return [];
		}
		const cards = await dataStorage.getAllCards();
		return Array.isArray(cards) ? (cards as EpubCardLike[]) : [];
	}

	private async saveCard(card: EpubCardLike): Promise<SaveCardResult> {
		const dataStorage = getCompatibleDataStorage(this.app);
		if (!dataStorage?.saveCard) {
			return { success: false, error: "Weave 数据存储不可用" };
		}
		const result = await dataStorage.saveCard(card);
		if (result && typeof result === "object" && "success" in result) {
			return result as SaveCardResult;
		}
		return { success: true };
	}

	private findEpubMarkdownLinksNeedingSourceId(content: string): string[] {
		if (!content) {
			return [];
		}

		const matches = new Set<string>();
		for (const markup of EpubLinkService.collectEpubLinkMarkups(content)) {
			const parsed = EpubLinkService.parseLinkMarkup(markup);
			if (!parsed?.filePath || parsed.sourceId) {
				continue;
			}
			matches.add(markup);
		}

		return Array.from(matches);
	}

	private async listVaultMarkdownPaths(): Promise<string[]> {
		const rawConfigDir = String(this.app.vault?.configDir || "").trim();
		const configDirPrefix = rawConfigDir ? `${normalizePath(rawConfigDir)}/` : "";
		if (typeof this.app.vault?.getMarkdownFiles === "function") {
			return this.app.vault
				.getMarkdownFiles()
				.map((file) => normalizePath(String(file?.path || "").trim()))
				.filter((path) => path.length > 0 && (!configDirPrefix || !path.startsWith(configDirPrefix)))
				.sort((left, right) => left.localeCompare(right, "zh-CN"));
		}

		return [];
	}

	private async checkEpubSourceLinkMigration(): Promise<EpubDataCheckResult> {
		const needsMigration: string[] = [];
		const epubLinkService = new EpubLinkService(this.app);
		const cards = await this.getCards();

		for (const card of cards) {
			if (!card.content) continue;
			const migrationResult = await epubLinkService.enrichEpubLinksWithSourceIdsInContent(card.content);
			if (migrationResult.changed) {
				needsMigration.push(card.uuid);
			}
		}

		return {
			type: "epub_source_link_migration",
			status: needsMigration.length > 0 ? "warning" : "ok",
			count: needsMigration.length,
			items: needsMigration,
			message:
				needsMigration.length > 0
					? `发现 ${needsMigration.length} 张卡片包含旧 EPUB 溯源链接格式`
					: "EPUB 溯源链接格式正常",
		};
	}

	private async checkEpubMarkdownSourceIdBackfill(): Promise<EpubDataCheckResult> {
		try {
			const adapter = this.app.vault.adapter;
			const items: string[] = [];

			for (const filePath of await this.listVaultMarkdownPaths()) {
				const content = await adapter.read(filePath);
				if (this.findEpubMarkdownLinksNeedingSourceId(content).length > 0) {
					items.push(filePath);
				}
			}

			return {
				type: "epub_markdown_source_id_backfill",
				status: items.length > 0 ? "warning" : "ok",
				count: items.length,
				items,
				message:
					items.length > 0
						? `发现 ${items.length} 个 Markdown 文件包含缺少 sourceId 的 EPUB 链接`
						: "Markdown 中的 EPUB 链接 sourceId 状态正常",
			};
		} catch (error) {
			logger.error("[EpubDataManagement] EPUB Markdown sourceId 回填检测失败", error);
			return {
				type: "epub_markdown_source_id_backfill",
				status: "error",
				count: 0,
				items: [],
				message: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private async fixEpubSourceLinkMigration(): Promise<EpubDataFixResult> {
		let success = 0;
		let failed = 0;
		const errors: Array<{ uuid: string; error: string }> = [];
		const epubLinkService = new EpubLinkService(this.app);
		const cards = await this.getCards();

		for (const card of cards) {
			if (!card.content) continue;

			const migrationResult = await epubLinkService.enrichEpubLinksWithSourceIdsInContent(card.content);
			if (!migrationResult.changed) {
				continue;
			}

			try {
				const updatedCard = {
					...card,
					content: migrationResult.content,
					modified: new Date().toISOString(),
				};
				const result = await this.saveCard(updatedCard);
				if (result.success) {
					success++;
				} else {
					failed++;
					errors.push({ uuid: card.uuid, error: result.error || "保存失败" });
				}
			} catch (error) {
				failed++;
				errors.push({ uuid: card.uuid, error: String(error) });
			}
		}

		return {
			type: "epub_source_link_migration",
			success,
			failed,
			errors,
		};
	}

	private async fixEpubMarkdownSourceIdBackfill(): Promise<EpubDataFixResult> {
		let success = 0;
		let failed = 0;
		const errors: Array<{ uuid: string; error: string }> = [];
		const adapter = this.app.vault.adapter;
		const epubLinkService = new EpubLinkService(this.app);

		for (const filePath of await this.listVaultMarkdownPaths()) {
			try {
				const content = await adapter.read(filePath);
				if (this.findEpubMarkdownLinksNeedingSourceId(content).length === 0) {
					continue;
				}

				const migration = await epubLinkService.enrichEpubLinksWithSourceIdsInContent(
					content,
					filePath
				);
				if (!migration.changed || migration.content === content) {
					failed++;
					errors.push({
						uuid: filePath,
						error: "EPUB sourceId 回填未完成",
					});
					continue;
				}

				const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
				if (abstractFile instanceof TFile) {
					await this.app.vault.process(abstractFile, (current) =>
						current === content ? migration.content : current
					);
				} else {
					await adapter.write(filePath, migration.content);
				}

				success++;
			} catch (error) {
				failed++;
				errors.push({
					uuid: filePath,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return {
			type: "epub_markdown_source_id_backfill",
			success,
			failed,
			errors,
		};
	}
}
