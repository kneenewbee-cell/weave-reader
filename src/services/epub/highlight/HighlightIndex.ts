import { EpubLinkService } from "../EpubLinkService";
import type { BacklinkHighlight } from "../EpubBacklinkHighlightService";
import { getReaderHighlightIdentityKey } from "./highlight-identity";

type IndexListener = (revision: number) => void;

export class HighlightIndex {
	private revision = 0;
	private byCfi = new Map<string, BacklinkHighlight[]>();
	private bySourcePath = new Map<string, BacklinkHighlight[]>();
	private readonly listeners = new Set<IndexListener>();

	getRevision(): number {
		return this.revision;
	}

	subscribe(listener: IndexListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	getSnapshot(): BacklinkHighlight[] {
		const results: BacklinkHighlight[] = [];
		for (const highlights of this.byCfi.values()) {
			results.push(...highlights);
		}
		return results;
	}

	getByCfi(cfiRange: string): BacklinkHighlight[] {
		const key = EpubLinkService.normalizeCfi(cfiRange);
		return key ? [...(this.byCfi.get(key) || [])] : [];
	}

	getBySource(sourcePath: string): BacklinkHighlight[] {
		const normalized = String(sourcePath || "").trim();
		return normalized ? [...(this.bySourcePath.get(normalized) || [])] : [];
	}

	buildFrom(highlights: BacklinkHighlight[]): void {
		this.byCfi.clear();
		this.bySourcePath.clear();
		for (const highlight of highlights) {
			this.upsert(highlight, { notify: false });
		}
		this.bumpRevision();
	}

	upsert(highlight: BacklinkHighlight, options: { notify?: boolean } = {}): void {
		const cfiKey = EpubLinkService.normalizeCfi(highlight.cfiRange);
		if (cfiKey) {
			const existing = this.byCfi.get(cfiKey) || [];
			const index = existing.findIndex(
				(entry) =>
					entry.sourceFile === highlight.sourceFile &&
					entry.sourceRef === highlight.sourceRef &&
					entry.excerptId === highlight.excerptId
			);
			if (index >= 0) {
				existing[index] = { ...existing[index], ...highlight };
			} else {
				existing.push(highlight);
			}
			this.byCfi.set(cfiKey, existing);
		}

		const sourceKey = String(highlight.sourceFile || "").trim();
		if (sourceKey) {
			const existing = this.bySourcePath.get(sourceKey) || [];
			const highlightIdentity = getReaderHighlightIdentityKey(highlight);
			const index = existing.findIndex(
				(entry) => getReaderHighlightIdentityKey(entry) === highlightIdentity
			);
			if (index >= 0) {
				existing[index] = { ...existing[index], ...highlight };
			} else {
				existing.push(highlight);
			}
			this.bySourcePath.set(sourceKey, existing);
		}

		if (options.notify !== false) {
			this.bumpRevision();
		}
	}

	removeByCfi(cfiRange: string): void {
		const key = EpubLinkService.normalizeCfi(cfiRange);
		if (!key) {
			return;
		}
		const removed = this.byCfi.get(key) || [];
		this.byCfi.delete(key);
		for (const highlight of removed) {
			const sourceKey = String(highlight.sourceFile || "").trim();
			if (!sourceKey) {
				continue;
			}
			const sourceEntries = this.bySourcePath.get(sourceKey) || [];
			const filtered = sourceEntries.filter(
				(entry) => EpubLinkService.normalizeCfi(entry.cfiRange) !== key
			);
			if (filtered.length > 0) {
				this.bySourcePath.set(sourceKey, filtered);
			} else {
				this.bySourcePath.delete(sourceKey);
			}
		}
		this.bumpRevision();
	}

	clear(): void {
		this.byCfi.clear();
		this.bySourcePath.clear();
		this.bumpRevision();
	}

	private bumpRevision(): void {
		this.revision += 1;
		for (const listener of this.listeners) {
			listener(this.revision);
		}
	}
}
