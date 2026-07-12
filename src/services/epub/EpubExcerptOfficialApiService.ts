import { normalizePath, type App } from "obsidian";
import type { Card } from "../../data/epub-bridge-types";
import { getLegacyWeavePlugin, type CompatiblePlugin } from "../../utils/plugin-access";
import type {
	EpubWeaveExcerptRemovalMode,
	EpubWeaveOfficialAPI,
	EpubWeaveOfficialAPIInfo,
	EpubWeaveRemoveExcerptInput,
	EpubWeaveRemoveExcerptResult,
} from "./epub-host";
import { EpubBacklinkHighlightService } from "./EpubBacklinkHighlightService";

type CompatibleWeaveCardStorage = {
	getCardByUUID?: (uuid: string) => Promise<Card | null | undefined> | Card | null | undefined;
	saveCard?: (card: Card) => Promise<void> | void;
	deleteCard?: (uuid: string) => Promise<boolean | { success?: boolean }> | boolean | { success?: boolean };
};

export class EpubExcerptOfficialApiService implements EpubWeaveOfficialAPI {
	private backlinkService: EpubBacklinkHighlightService;
	private hostPlugin: CompatiblePlugin | null;

	constructor(
		private readonly app: App,
		options?: {
			backlinkService?: EpubBacklinkHighlightService;
			hostPlugin?: CompatiblePlugin | null;
		}
	) {
		this.backlinkService =
			options?.backlinkService ?? new EpubBacklinkHighlightService(this.app);
		this.hostPlugin = options?.hostPlugin ?? getLegacyWeavePlugin(this.app);
	}

	getInfo(): EpubWeaveOfficialAPIInfo {
		return {
			apiName: "weave-epub-excerpts",
			apiVersion: "0.1.0",
			stage: "experimental",
			capabilities: {
				excerpts: {
					remove: true,
					supportsSidLocator: true,
					supportsExcerptId: true,
					supportsInteractiveUserChoice: true,
				},
			},
		};
	}

	async removeExcerpt(
		input: EpubWeaveRemoveExcerptInput
	): Promise<EpubWeaveRemoveExcerptResult> {
		const sourceFile = normalizePath(String(input.sourceFile || "").trim());
		const sourceRef = String(input.sourceRef || "").trim() || undefined;
		const cardId = String(input.cardId || "").trim() || this.extractCardIdFromSourceRef(sourceRef);
		const normalizedMode = this.normalizeMode(input.mode);

		if (!sourceFile) {
			return {
				success: false,
				action: "noop",
				affectedCardIds: [],
				error: "missing_source_file",
			};
		}

		if (!this.isStructuredCardDataSourcePath(sourceFile)) {
			const deleted = await this.backlinkService.deleteHighlight(
				sourceFile,
				input.cfiRange,
				input.epubFilePath,
				sourceRef,
				input.excerptId,
				normalizedMode === "auto" ? undefined : normalizedMode
			);
			return {
				success: deleted,
				action: deleted ? "excerpt-removed" : "noop",
				affectedCardIds: cardId ? [cardId] : [],
				sourceFile,
				sourceRef,
			};
		}

		const analysis = await this.backlinkService.inspectCardDataHighlightDeletion(
			sourceFile,
			input.cfiRange,
			input.epubFilePath,
			sourceRef,
			input.excerptId
		);

		if (!analysis?.matched) {
			return {
				success: false,
				action: "noop",
				affectedCardIds: cardId ? [cardId] : [],
				sourceFile,
				sourceRef,
				error: "excerpt_not_found",
			};
		}

		if (normalizedMode === "auto" && analysis.hasAdditionalContent) {
			return {
				success: false,
				action: "noop",
				affectedCardIds: cardId ? [cardId] : [],
				sourceFile,
				sourceRef,
				needsUserChoice: true,
				additionalContentPreview: analysis.additionalContentPreview,
				suggestedMode: analysis.recommendedMode,
			};
		}

		const effectiveMode =
			normalizedMode === "auto" ? analysis.recommendedMode : normalizedMode;

		if (effectiveMode === "delete-card" && cardId) {
			const deleted = await this.deleteCardThroughWeave(cardId);
			if (deleted) {
				return {
					success: true,
					action: "card-deleted",
					affectedCardIds: [cardId],
					sourceFile,
					sourceRef,
				};
			}
		}

		if (effectiveMode === "excerpt-only" && cardId) {
			const updated = await this.updateCardExcerptThroughWeave(cardId, input);
			if (updated) {
				return {
					success: true,
					action: "excerpt-removed",
					affectedCardIds: [cardId],
					sourceFile,
					sourceRef,
				};
			}
		}

		const deleted = await this.backlinkService.deleteHighlight(
			sourceFile,
			input.cfiRange,
			input.epubFilePath,
			sourceRef,
			input.excerptId,
			effectiveMode
		);
		return {
			success: deleted,
			action: deleted
				? effectiveMode === "delete-card"
					? "card-deleted"
					: "excerpt-removed"
				: "noop",
			affectedCardIds: cardId ? [cardId] : [],
			sourceFile,
			sourceRef,
		};
	}

	private async updateCardExcerptThroughWeave(
		cardId: string,
		input: EpubWeaveRemoveExcerptInput
	): Promise<boolean> {
		const storage = this.getHostDataStorage();
		if (
			!storage ||
			typeof storage.getCardByUUID !== "function" ||
			typeof storage.saveCard !== "function"
		) {
			return false;
		}

		const currentCard = await storage.getCardByUUID(cardId);
		if (!currentCard) {
			return false;
		}

		const analysis = await this.backlinkService.analyzeCardContentHighlightDeletion(
			String(currentCard.content || ""),
			input.cfiRange,
			input.epubFilePath,
			input.excerptId
		);
		if (!analysis.matched || analysis.remainingContent === currentCard.content) {
			return false;
		}

		await storage.saveCard({
			...currentCard,
			content: analysis.remainingContent,
			modified: new Date().toISOString(),
		});
		return true;
	}

	private async deleteCardThroughWeave(cardId: string): Promise<boolean> {
		const storage = this.getHostDataStorage();
		if (!storage || typeof storage.deleteCard !== "function") {
			return false;
		}

		const result = await storage.deleteCard(cardId);
		if (typeof result === "boolean") {
			return result;
		}
		if (result && typeof result === "object" && "success" in result) {
			const success = (result as { success?: boolean }).success;
			return success !== false;
		}
		return true;
	}

	private getHostDataStorage(): CompatibleWeaveCardStorage | null {
		const storage = this.hostPlugin?.dataStorage;
		return storage && typeof storage === "object"
			? (storage as CompatibleWeaveCardStorage)
			: null;
	}

	private normalizeMode(mode: EpubWeaveExcerptRemovalMode | undefined): EpubWeaveExcerptRemovalMode {
		return mode === "delete-card" || mode === "excerpt-only" ? mode : "auto";
	}

	private isStructuredCardDataSourcePath(sourcePath: string): boolean {
		const normalizedPath = normalizePath(String(sourcePath || "").trim()).toLowerCase();
		return normalizedPath.endsWith(".json") || normalizedPath.endsWith(".wdeck");
	}

	private extractCardIdFromSourceRef(sourceRef?: string): string | undefined {
		const normalized = String(sourceRef || "").trim();
		if (!normalized.startsWith("card:")) {
			return undefined;
		}
		const cardId = normalized.slice(5).trim();
		return cardId || undefined;
	}
}
