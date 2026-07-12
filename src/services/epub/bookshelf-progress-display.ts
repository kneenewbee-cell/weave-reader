export type BookshelfProgressTone = "start" | "low" | "mid" | "high" | "near" | "complete";

export function clampBookshelfProgress(progress: number): number {
	if (!Number.isFinite(progress)) {
		return 0;
	}
	return Math.max(0, Math.min(100, Math.round(progress)));
}

export function resolveBookshelfProgressTone(progress: number): BookshelfProgressTone {
	const value = clampBookshelfProgress(progress);
	if (value >= 90) {
		return "complete";
	}
	if (value >= 70) {
		return "near";
	}
	if (value >= 45) {
		return "high";
	}
	if (value >= 25) {
		return "mid";
	}
	if (value >= 1) {
		return "low";
	}
	return "start";
}

export function getBookshelfProgressToneClass(progress: number): string {
	return `is-progress-${resolveBookshelfProgressTone(progress)}`;
}

export function formatBookshelfLastReadTime(timestamp: number): string {
	if (!Number.isFinite(timestamp) || timestamp <= 0) {
		return "";
	}
	try {
		return new Intl.DateTimeFormat(undefined, {
			month: "numeric",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		}).format(new Date(timestamp));
	} catch {
		return "";
	}
}
