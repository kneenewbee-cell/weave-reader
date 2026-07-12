/** Reader iframe needs longer settle time before overlay rects resolve reliably. */
export const READER_SOURCE_LOCATE_OVERLAY_TIMING = {
	initialDelayMs: 120,
	retryDelayMs: 120,
	maxAttempts: 12,
} as const;

/** Source-locate focus ring in reader body; excerpt highlights stay visible underneath. */
export const READER_SOURCE_LOCATE_FOCUS_DURATION_MS = 1500;

/** Markdown preview/editor overlay can retry sooner once DOM blocks exist. */
export const MARKDOWN_SOURCE_LOCATE_OVERLAY_TIMING = {
	initialDelayMs: 40,
	initialDelayMsFromView: 60,
	retryDelayMs: 90,
	maxAttempts: 8,
} as const;
