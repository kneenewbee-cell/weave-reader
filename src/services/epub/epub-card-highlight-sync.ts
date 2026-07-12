import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import { emit as emitCardEditEvent, on as onCardEditEvent } from "../../events/CardEditEventBus";
import type { Card } from "../../data/epub-bridge-types";
import {
	ensureWDeckPersistenceMeta,
	readWDeckPersistenceSourcePath,
} from "../../utils/wdeck-card-persistence";
import { getEpubRuntime } from "./epub-runtime";
import type { EpubBacklinkHighlightService } from "./EpubBacklinkHighlightService";
import { EpubLinkService } from "./EpubLinkService";
import { resolveEpubHighlightPersistenceSourcePath } from "./epub-highlight-source-path";

export type EpubSavedCardSnapshot = Pick<Card, "uuid" | "content"> & {
	deckId?: string;
	sourceFile?: string;
	sourceKind?: string;
	sourceSubunitKey?: string;
	customFields?: Record<string, unknown>;
	/** Vault path where excerpt content is stored; never the semantic EPUB path from `we_source`. */
	persistenceSourcePath?: string;
};

export function getEpubHighlightSyncPersistencePath(
	card: EpubSavedCardSnapshot
): string | undefined {
	const explicit = normalizePath(String(card.persistenceSourcePath || "").trim());
	if (explicit) {
		return explicit;
	}
	return resolveEpubHighlightPersistenceSourcePath(card);
}

export function buildEpubHighlightSyncSnapshot(card: EpubSavedCardSnapshot): EpubSavedCardSnapshot {
	const persistenceSourcePath = getEpubHighlightSyncPersistencePath(card);
	if (!persistenceSourcePath) {
		return card;
	}
	return {
		...card,
		persistenceSourcePath,
	};
}

export interface EpubHighlightSyncRequestDetail {
	epubFilePath?: string;
	card?: EpubSavedCardSnapshot;
	delayMs?: number;
	reloadOnly?: boolean;
}

export interface EpubCardHighlightSyncBridgeOptions {
	app: App;
	getEpubFilePath: () => string | undefined;
	getBookSourceId: () => string | undefined;
	isActive: () => boolean;
	backlinkService: EpubBacklinkHighlightService;
	onCardSaved: (card: EpubSavedCardSnapshot) => void | Promise<void>;
}

export function cardContentMayContainEpubLocator(content: string): boolean {
	const normalized = String(content || "");
	if (!normalized) {
		return false;
	}
	if (
		normalized.includes("[!EPUB") ||
		normalized.includes("weave-cfi=") ||
		normalized.includes("weave-loc=") ||
		normalized.includes("tuanki-cfi")
	) {
		return true;
	}
	return Boolean(EpubLinkService.extractFirstEpubLinkMarkup(normalized));
}

export function dispatchEpubHighlightSyncRequested(
	detail: EpubHighlightSyncRequestDetail = {}
): void {
	if (typeof window === "undefined") {
		return;
	}
	window.dispatchEvent(
		new CustomEvent(getEpubRuntime().events.highlightSyncRequested, { detail })
	);
}

/**
 * Notify open EPUB readers after a card is persisted to weave deck storage.
 */
export function notifyEpubHighlightSyncForSavedCard(card: EpubSavedCardSnapshot): void {
	if (!cardContentMayContainEpubLocator(String(card.content || ""))) {
		return;
	}
	void emitCardEditEvent("card:saved", {
		card: buildEpubHighlightSyncSnapshot(card),
		success: true,
	});
}

/**
 * Prepare a saved wdeck/memory card for EPUB highlight sync metadata.
 */
export function prepareCardForEpubHighlightSync(card: Card): EpubSavedCardSnapshot {
	const persistenceSourcePath = readWDeckPersistenceSourcePath(card);
	const withMeta = persistenceSourcePath
		? ensureWDeckPersistenceMeta(card, persistenceSourcePath)
		: card;
	return buildEpubHighlightSyncSnapshot(withMeta);
}

/**
 * Listen only for persisted card saves (`card:saved` from storage).
 */
export function attachEpubCardHighlightSyncBridge(
	options: EpubCardHighlightSyncBridgeOptions
): () => void {
	const handleCardSaved = async (card: EpubSavedCardSnapshot) => {
		if (!options.isActive()) {
			return;
		}
		const epubFilePath = options.getEpubFilePath();
		if (!epubFilePath) {
			return;
		}
		const referencesTarget = await options.backlinkService.savedCardReferencesEpubFile(
			card,
			epubFilePath,
			options.getBookSourceId()
		);
		if (!referencesTarget) {
			return;
		}
		await options.onCardSaved(card);
	};

	const unsubscribeCardSaved = onCardEditEvent("card:saved", ({ card, success }) => {
		if (!success) {
			return;
		}
		void handleCardSaved(card);
	});

	return () => {
		unsubscribeCardSaved();
	};
}
