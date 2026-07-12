import type { EpubReaderLocalDataFile, EpubScanIndexEntry } from "./epub-local-data-types";

export interface PeeledEmbeddedScanIndexResult {
	data: EpubReaderLocalDataFile;
	embeddedScanIndex: EpubScanIndexEntry[] | null;
}

export function peelEmbeddedScanIndexFromUnifiedData(
	normalized: EpubReaderLocalDataFile
): PeeledEmbeddedScanIndexResult {
	if (!Array.isArray(normalized.scanIndex)) {
		return { data: normalized, embeddedScanIndex: null };
	}
	const embeddedScanIndex = normalized.scanIndex;
	return {
		data: { ...normalized, scanIndex: undefined },
		embeddedScanIndex,
	};
}
