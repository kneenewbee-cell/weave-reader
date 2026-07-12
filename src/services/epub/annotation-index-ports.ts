import type { EpubAnnotationService } from "./EpubAnnotationService";
import type { EpubBacklinkHighlightService } from "./EpubBacklinkHighlightService";
import type {
	EpubHighlightSnapshotContextInput,
	EpubHighlightViewSnapshotService,
} from "./EpubHighlightViewSnapshotService";
import type { EpubReaderEngine } from "./reader-engine-types";

/** Narrow ports used by {@link EpubAnnotationIndexService} to avoid tight service coupling. */
export interface EpubAnnotationSnapshotPort {
	buildContextKey(input: EpubHighlightSnapshotContextInput): string;
	getCachedSnapshot(input: EpubHighlightSnapshotContextInput): unknown;
	hydrateFromDisk(input: EpubHighlightSnapshotContextInput): Promise<void>;
	revalidateSnapshot(
		input: EpubHighlightSnapshotContextInput & {
			annotationService: EpubAnnotationService;
			backlinkService: EpubAnnotationBacklinkPort;
			readerService?: EpubReaderEngine | null;
			highlightRevision?: number;
		}
	): Promise<void>;
}

export interface EpubAnnotationBacklinkPort {
	collectHighlights(filePath: string, canvasPath?: string | null): Promise<unknown>;
}

export interface EpubAnnotationPrefetchPorts {
	annotationService?: EpubAnnotationService;
	backlinkService?: EpubAnnotationBacklinkPort;
	readerService?: EpubReaderEngine | null;
	highlightRevision?: number;
}

export type EpubAnnotationSnapshotServicePort = Pick<
	EpubHighlightViewSnapshotService,
	"buildContextKey" | "getCachedSnapshot" | "hydrateFromDisk" | "revalidateSnapshot"
>;

export type EpubAnnotationBacklinkServicePort = Pick<
	EpubBacklinkHighlightService,
	"collectHighlights"
>;
