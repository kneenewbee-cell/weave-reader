import { normalizePath } from "obsidian";
import { unknownPlainText } from "./unknown-plain-text";
import { isSupportedBookPath } from "../services/epub/book-format";

export type WDeckPersistenceCardLike = {
	uuid?: string;
	deckId?: string;
	sourceFile?: string;
	customFields?: Record<string, unknown>;
};

const WDECK_PERSISTENCE_FIELD = "wdeck" as const;

export function isEpubSemanticSourcePath(path?: string | null): boolean {
	return isSupportedBookPath(normalizePath(String(path || "").trim()));
}

export function isPersistedCardStorageSourcePath(path?: string | null): boolean {
	const normalizedPath = normalizePath(String(path || "").trim());
	if (!normalizedPath || isEpubSemanticSourcePath(normalizedPath)) {
		return false;
	}
	const lower = normalizedPath.toLowerCase();
	return (
		lower.endsWith(".md") ||
		lower.endsWith(".canvas") ||
		lower.endsWith(".wdeck") ||
		lower.endsWith(".json")
	);
}

/**
 * Physical vault file that stores card/excerpt content (e.g. `.wdeck`), not the semantic EPUB path in `we_source`.
 */
export function readWDeckPersistenceSourcePath(card: WDeckPersistenceCardLike): string | undefined {
	const wdeckValue = card.customFields?.[WDECK_PERSISTENCE_FIELD];
	const wdeckMeta =
		wdeckValue && typeof wdeckValue === "object" ? (wdeckValue as { sourcePath?: unknown }) : null;
	const wdeckSourcePath = normalizePath(
		unknownPlainText(wdeckMeta?.sourcePath).trim()
	);
	if (wdeckSourcePath && isPersistedCardStorageSourcePath(wdeckSourcePath)) {
		return wdeckSourcePath;
	}

	const sourceFile = normalizePath(String(card.sourceFile || "").trim());
	if (sourceFile && isPersistedCardStorageSourcePath(sourceFile)) {
		return sourceFile;
	}

	return undefined;
}

/**
 * Ensure `customFields.wdeck.sourcePath` is set after a wdeck save without overwriting semantic `sourceFile`.
 */
export function ensureWDeckPersistenceMeta<T extends WDeckPersistenceCardLike>(
	card: T,
	sourcePath?: string | null
): T {
	const normalizedPath = normalizePath(String(sourcePath || readWDeckPersistenceSourcePath(card) || "").trim());
	if (!normalizedPath || !normalizedPath.toLowerCase().endsWith(".wdeck")) {
		return card;
	}

	const existingWdeck = card.customFields?.[WDECK_PERSISTENCE_FIELD];
	if (
		existingWdeck &&
		typeof existingWdeck === "object" &&
		normalizePath(String((existingWdeck as { sourcePath?: string }).sourcePath || "").trim()) ===
			normalizedPath
	) {
		return card;
	}

	return {
		...card,
		customFields: {
			...card.customFields,
			[WDECK_PERSISTENCE_FIELD]: {
				...(typeof existingWdeck === "object" && existingWdeck ? existingWdeck : {}),
				sourcePath: normalizedPath,
			},
		},
	};
}

export function isWDeckRuntimeCard(
	card: WDeckPersistenceCardLike,
	isWDeckDeckId?: (deckId: string) => boolean
): boolean {
	if (readWDeckPersistenceSourcePath(card)?.toLowerCase().endsWith(".wdeck")) {
		return true;
	}
	const deckId = String(card.deckId || "").trim();
	return Boolean(deckId && isWDeckDeckId?.(deckId));
}
