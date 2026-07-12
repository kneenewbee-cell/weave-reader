import type { EpubLastOpenBookmark, ReadingPosition } from "./types";

export function choosePreferredRestorePosition(
	progress: ReadingPosition | null | undefined,
	lastOpenBookmark: EpubLastOpenBookmark | null | undefined
): ReadingPosition | EpubLastOpenBookmark | null {
	if (progress?.cfi) {
		return progress;
	}

	if (lastOpenBookmark?.cfi) {
		return lastOpenBookmark;
	}

	return null;
}
