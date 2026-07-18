import { normalizePath } from "obsidian";

export interface EpubAnnotatedBookImportPathComparison {
	activeBookPath?: string;
	requestedBookPath?: string;
	targetBookPath?: string;
}

function normalizeImportPath(value: unknown): string {
	return normalizePath(String(value || "").trim());
}

function pathsMatch(left: unknown, right: unknown): boolean {
	const normalizedLeft = normalizeImportPath(left);
	const normalizedRight = normalizeImportPath(right);
	return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function shouldOfferOpenImportedBookAction(
	input: EpubAnnotatedBookImportPathComparison
): boolean {
	const targetBookPath = normalizeImportPath(input.targetBookPath);
	if (!targetBookPath) {
		return false;
	}
	const activeBookPath = normalizeImportPath(input.activeBookPath);
	return !activeBookPath || !pathsMatch(activeBookPath, targetBookPath);
}

export function isEpubAnnotatedBookImportMatchedDifferentBook(
	input: EpubAnnotatedBookImportPathComparison
): boolean {
	const requestedBookPath = normalizeImportPath(input.requestedBookPath);
	const targetBookPath = normalizeImportPath(input.targetBookPath);
	return Boolean(requestedBookPath && targetBookPath && !pathsMatch(requestedBookPath, targetBookPath));
}
