export const DEFAULT_CONTINUOUS_READING_POSITION_AUTO_SAVE_ENABLED = true;
export const DEFAULT_CONTINUOUS_READING_POSITION_AUTO_SAVE_PAGES = 5;
export const MIN_CONTINUOUS_READING_POSITION_AUTO_SAVE_PAGES = 1;
export const MAX_CONTINUOUS_READING_POSITION_AUTO_SAVE_PAGES = 200;

export function normalizeContinuousReadingPositionAutoSaveEnabled(value: unknown): boolean {
	return value !== false;
}

export function normalizeContinuousReadingPositionAutoSavePages(value: unknown): number {
	const numericValue =
		typeof value === "string"
			? Number(value.trim())
			: typeof value === "number"
				? value
				: Number.NaN;

	if (!Number.isFinite(numericValue)) {
		return DEFAULT_CONTINUOUS_READING_POSITION_AUTO_SAVE_PAGES;
	}

	return clamp(
		Math.round(numericValue),
		MIN_CONTINUOUS_READING_POSITION_AUTO_SAVE_PAGES,
		MAX_CONTINUOUS_READING_POSITION_AUTO_SAVE_PAGES
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
