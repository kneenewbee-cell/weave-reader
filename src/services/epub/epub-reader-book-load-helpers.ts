import type { TFile } from "obsidian";
import type { EpubBook, ReadingPosition } from "./types";

export function canReuseExistingBook(
	existingBook: EpubBook | null,
	vaultFile: TFile
): existingBook is EpubBook {
	if (!existingBook) {
		return false;
	}

	const storedSize =
		typeof existingBook.sourceSize === "number" && Number.isFinite(existingBook.sourceSize)
			? existingBook.sourceSize
			: null;
	const storedMtime =
		typeof existingBook.sourceMtime === "number" && Number.isFinite(existingBook.sourceMtime)
			? existingBook.sourceMtime
			: null;

	if (storedSize === null && storedMtime === null) {
		return true;
	}

	if (storedSize !== null && storedSize !== vaultFile.stat.size) {
		return false;
	}

	if (storedMtime !== null && storedMtime !== vaultFile.stat.mtime) {
		return false;
	}

	return true;
}

export interface ResolveBookLoadRestoredPositionOptions {
	hasProgressCapability: boolean;
	reusableBook: EpubBook | null;
	loadedBook: EpubBook;
	loadProgress: (bookId: string, book: EpubBook) => Promise<ReadingPosition | null | undefined>;
}

export async function resolveBookLoadRestoredPosition(
	options: ResolveBookLoadRestoredPositionOptions
): Promise<ReadingPosition | null> {
	const { hasProgressCapability, reusableBook, loadedBook, loadProgress } = options;
	if (!hasProgressCapability) {
		return null;
	}
	if (reusableBook?.currentPosition?.cfi) {
		return reusableBook.currentPosition;
	}
	const migratedProgress = await loadProgress(loadedBook.id, loadedBook);
	return migratedProgress ?? null;
}
