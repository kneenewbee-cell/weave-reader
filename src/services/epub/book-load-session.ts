import { getBookFormatDisplayLabel } from "./book-format";
import { i18n } from "../../utils/i18n";

/** Expected upper bound for normal CBZ / archive open on typical hardware. */
export const BOOK_LOAD_SLOW_WARNING_MS = 15_000;
/** Absolute safety cap for typical books; real loads should finish well before this. */
export const BOOK_LOAD_HARD_TIMEOUT_MS = 45_000;
/** Hard timeout ceiling for very large vault books. */
export const BOOK_LOAD_MAX_HARD_TIMEOUT_MS = 300_000;
/** File size above which load timeouts scale up (50 MiB). */
export const BOOK_LOAD_LARGE_FILE_BYTES = 50 * 1024 * 1024;
/** Extra hard-timeout budget per 50 MiB above {@link BOOK_LOAD_LARGE_FILE_BYTES}. */
export const BOOK_LOAD_LARGE_FILE_TIMEOUT_STEP_MS = 60_000;

export type BookLoadTimeoutMessageContext = "reader" | "error";

export function resolveBookLoadHardTimeoutMs(fileSizeBytes?: number | null): number {
	const normalizedSize =
		typeof fileSizeBytes === "number" && Number.isFinite(fileSizeBytes) && fileSizeBytes > 0
			? fileSizeBytes
			: 0;
	if (normalizedSize <= BOOK_LOAD_LARGE_FILE_BYTES) {
		return BOOK_LOAD_HARD_TIMEOUT_MS;
	}

	const extraSteps = Math.ceil(
		(normalizedSize - BOOK_LOAD_LARGE_FILE_BYTES) / BOOK_LOAD_LARGE_FILE_BYTES
	);
	return Math.min(
		BOOK_LOAD_MAX_HARD_TIMEOUT_MS,
		BOOK_LOAD_HARD_TIMEOUT_MS + extraSteps * BOOK_LOAD_LARGE_FILE_TIMEOUT_STEP_MS
	);
}

export class BookLoadCancelledError extends Error {
	constructor() {
		super("Book load cancelled");
		this.name = "BookLoadCancelledError";
	}
}

export function buildBookLoadTimeoutMessage(
	filePath: string,
	context: BookLoadTimeoutMessageContext = "reader",
	hardTimeoutMs: number = BOOK_LOAD_HARD_TIMEOUT_MS
): string {
	const format = getBookFormatDisplayLabel(filePath);
	const seconds = String(Math.round(hardTimeoutMs / 1000));
	return context === "reader"
		? i18n.t("epub.reader.loadTimeout", { format, seconds })
		: i18n.t("epub.errors.loadTimeout", { format, seconds });
}

export function buildBookLoadSlowWarningMessage(filePath: string): string {
	const format = getBookFormatDisplayLabel(filePath);
	const seconds = String(Math.round(BOOK_LOAD_SLOW_WARNING_MS / 1000));
	return i18n.t("epub.reader.loadSlowWarning", { format, seconds });
}

export interface RunBookLoadSessionOptions<T> {
	filePath: string;
	loadPromise: Promise<T>;
	fileSizeBytes?: number | null;
	onSlowLoad?: () => void;
	isCancelled?: () => boolean;
}

export async function runBookLoadSession<T>(options: RunBookLoadSessionOptions<T>): Promise<T> {
	const { filePath, loadPromise, onSlowLoad, isCancelled, fileSizeBytes } = options;
	const hardTimeoutMs = resolveBookLoadHardTimeoutMs(fileSizeBytes);
	let slowWarningTimer: ReturnType<typeof window.setTimeout> | undefined;
	let hardTimeoutTimer: ReturnType<typeof window.setTimeout> | undefined;

	const throwIfCancelled = (): void => {
		if (isCancelled?.()) {
			throw new BookLoadCancelledError();
		}
	};

	try {
		return await Promise.race([
			loadPromise.then((result) => {
				throwIfCancelled();
				return result;
			}),
			new Promise<never>((_, reject) => {
				slowWarningTimer = window.setTimeout(() => {
					if (!isCancelled?.()) {
						onSlowLoad?.();
					}
				}, BOOK_LOAD_SLOW_WARNING_MS);
				hardTimeoutTimer = window.setTimeout(() => {
					reject(new Error(buildBookLoadTimeoutMessage(filePath, "reader", hardTimeoutMs)));
				}, hardTimeoutMs);
			}),
		]);
	} finally {
		if (slowWarningTimer !== undefined) {
			window.clearTimeout(slowWarningTimer);
		}
		if (hardTimeoutTimer !== undefined) {
			window.clearTimeout(hardTimeoutTimer);
		}
	}
}
