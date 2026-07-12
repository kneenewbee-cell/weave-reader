import type { HighlightSourceLocator, ReaderHighlight } from "../reader-engine-types";
import {
	collectHighlightSourceLocators,
	getReaderHighlightIdentityKey,
} from "./highlight-identity";

export function normalizeHighlightSourcePath(path?: string | null): string {
	return String(path || "")
		.trim()
		.replace(/\\/g, "/");
}

function rebuildHighlightWithLocators(
	highlight: ReaderHighlight,
	locators: HighlightSourceLocator[]
): ReaderHighlight {
	const primary = locators[0];
	return {
		...highlight,
		sourceFile: primary?.sourceFile,
		sourceRef: primary?.sourceRef,
		excerptId: primary?.excerptId,
		sourceLocators: locators,
	};
}

export interface HighlightSourceOptimisticSyncResult {
	removed: ReaderHighlight[];
	updated: ReaderHighlight[];
}

export function computeHighlightSourceOptimisticSync(
	currentHighlights: ReaderHighlight[],
	changedSourcePath: string,
	remainingFromSource: ReaderHighlight[]
): HighlightSourceOptimisticSyncResult {
	const sourcePath = normalizeHighlightSourcePath(changedSourcePath);
	if (!sourcePath) {
		return { removed: [], updated: [] };
	}

	const remainingIdentityKeys = new Set<string>();
	for (const highlight of remainingFromSource) {
		const key = getReaderHighlightIdentityKey(highlight);
		if (key) {
			remainingIdentityKeys.add(key);
		}
	}

	const removed: ReaderHighlight[] = [];
	const updated: ReaderHighlight[] = [];

	for (const highlight of currentHighlights) {
		const locators = collectHighlightSourceLocators(highlight);
		const locatorsFromSource = locators.filter(
			(locator) => normalizeHighlightSourcePath(locator.sourceFile) === sourcePath
		);
		if (locatorsFromSource.length === 0) {
			continue;
		}

		const identityKey = getReaderHighlightIdentityKey(highlight);
		if (identityKey && remainingIdentityKeys.has(identityKey)) {
			continue;
		}

		const locatorsFromOtherSources = locators.filter(
			(locator) => normalizeHighlightSourcePath(locator.sourceFile) !== sourcePath
		);

		if (locatorsFromOtherSources.length > 0) {
			updated.push(rebuildHighlightWithLocators(highlight, locatorsFromOtherSources));
		} else {
			removed.push(highlight);
		}
	}

	return { removed, updated };
}

export function applyHighlightSourceOptimisticSyncResult(
	currentHighlights: ReaderHighlight[],
	result: HighlightSourceOptimisticSyncResult
): ReaderHighlight[] {
	if (result.removed.length === 0 && result.updated.length === 0) {
		return currentHighlights;
	}

	const removedKeys = new Set(
		result.removed
			.map((highlight) => getReaderHighlightIdentityKey(highlight))
			.filter((key) => key.length > 0)
	);
	const updatedByKey = new Map<string, ReaderHighlight>();
	for (const highlight of result.updated) {
		const key = getReaderHighlightIdentityKey(highlight);
		if (key) {
			updatedByKey.set(key, highlight);
		}
	}

	return currentHighlights
		.filter((highlight) => !removedKeys.has(getReaderHighlightIdentityKey(highlight)))
		.map((highlight) => {
			const key = getReaderHighlightIdentityKey(highlight);
			if (!key) {
				return highlight;
			}
			return updatedByKey.get(key) ?? highlight;
		});
}
