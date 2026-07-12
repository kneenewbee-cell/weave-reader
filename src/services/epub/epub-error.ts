import { extractErrorMessage } from "../../types/utility-types";
import { i18n } from "../../utils/i18n";
import { logger } from "../../utils/logger";
import { BOOK_LOAD_HARD_TIMEOUT_MS } from "./book-load-session";
import { getBookFormatDisplayLabel, isSupportedBookPath } from "./book-format";

export type EpubErrorCode =
	| "file_not_found"
	| "load_timeout"
	| "invalid_archive"
	| "missing_container"
	| "missing_package_document"
	| "invalid_markup"
	| "invalid_cfi_target"
	| "render_failed"
	| "toc_load_failed"
	| "unknown";

export type EpubErrorOperation = "open" | "render" | "toc" | "navigate";

export class EpubError extends Error {
	readonly code: EpubErrorCode;
	readonly context?: Record<string, unknown>;

	constructor(code: EpubErrorCode, message: string, context?: Record<string, unknown>) {
		super(message);
		this.name = "EpubError";
		this.code = code;
		this.context = context;
	}
}

interface ClassifiedEpubError {
	code: EpubErrorCode;
	operation: EpubErrorOperation;
	userMessage: string;
	logMessage: string;
	context?: Record<string, unknown>;
}

function isEpubError(error: unknown): error is EpubError {
	return error instanceof EpubError;
}

export interface ClassifyEpubErrorOptions {
	filePath?: string;
}

export function classifyEpubError(
	error: unknown,
	operation: EpubErrorOperation = "open",
	options: ClassifyEpubErrorOptions = {}
): ClassifiedEpubError {
	const message = extractErrorMessage(error);
	const code = resolveEpubErrorCode(error, message, operation);
	const filePath = String(options.filePath || "").trim();
	return {
		code,
		operation,
		userMessage: buildUserMessage(code, operation, message, filePath),
		logMessage: buildLogMessage(code, operation, message, filePath),
		context: isEpubError(error) ? error.context : undefined,
	};
}

export function reportEpubError(
	error: unknown,
	operation: EpubErrorOperation = "open",
	options: ClassifyEpubErrorOptions = {}
): ClassifiedEpubError {
	const classified = classifyEpubError(error, operation, options);
	logger.error(classified.logMessage, {
		context: classified.context,
		error,
	});
	return classified;
}

function resolveEpubErrorCode(
	error: unknown,
	message: string,
	operation: EpubErrorOperation
): EpubErrorCode {
	if (isEpubError(error)) {
		return error.code;
	}

	const normalizedMessage = String(message || "").toLowerCase();
	if (
		normalizedMessage.includes("加载超时") ||
		normalizedMessage.includes("timeout") ||
		normalizedMessage.includes("timed out")
	) {
		return "load_timeout";
	}
	if (
		normalizedMessage.includes("corrupted zip") ||
		normalizedMessage.includes("end of data reached") ||
		normalizedMessage.includes("zip parse failed")
	) {
		return "invalid_archive";
	}
	if (
		normalizedMessage.includes("epub 文件不存在") ||
		normalizedMessage.includes("file not found")
	) {
		return "file_not_found";
	}
	if (normalizedMessage.includes("meta-inf/container.xml")) {
		return "missing_container";
	}
	if (
		normalizedMessage.includes("package 文档路径") ||
		normalizedMessage.includes("package document")
	) {
		return "missing_package_document";
	}
	if (normalizedMessage.includes("xml parse failed") || normalizedMessage.includes("parsererror")) {
		return "invalid_markup";
	}
	if (
		normalizedMessage.includes("invalid epub cfi target") ||
		normalizedMessage.includes("childnodes") ||
		normalizedMessage.includes("cfi")
	) {
		return operation === "render" ? "render_failed" : "invalid_cfi_target";
	}
	if (operation === "render") {
		return "render_failed";
	}
	if (operation === "toc") {
		return "toc_load_failed";
	}
	return "unknown";
}

function resolveBookFormatLabel(filePath: string): string | null {
	if (!filePath || !isSupportedBookPath(filePath)) {
		return null;
	}
	return getBookFormatDisplayLabel(filePath);
}

function buildUserMessage(
	code: EpubErrorCode,
	operation: EpubErrorOperation,
	rawMessage: string,
	filePath = ""
): string {
	const format = resolveBookFormatLabel(filePath);
	switch (code) {
		case "file_not_found":
			return i18n.t("epub.errors.fileNotFound");
		case "load_timeout":
			return i18n.t("epub.errors.loadTimeout", {
				format: format || "EPUB",
				seconds: String(Math.round(BOOK_LOAD_HARD_TIMEOUT_MS / 1000)),
			});
		case "invalid_archive":
			return i18n.t("epub.errors.invalidArchive");
		case "missing_container":
			return i18n.t("epub.errors.missingContainer");
		case "missing_package_document":
			return i18n.t("epub.errors.missingPackageDocument");
		case "invalid_markup":
			return operation === "toc"
				? i18n.t("epub.errors.invalidMarkupToc")
				: i18n.t("epub.errors.invalidMarkupOpen");
		case "invalid_cfi_target":
			return operation === "navigate"
				? i18n.t("epub.errors.invalidCfiNavigate")
				: i18n.t("epub.errors.invalidCfiFallback");
		case "render_failed":
			return i18n.t("epub.errors.renderFailed");
		case "toc_load_failed":
			return i18n.t("epub.errors.tocLoadFailed");
		default:
			if (rawMessage && rawMessage !== "未知错误" && rawMessage !== "Unknown error") {
				return i18n.t("epub.errors.unknownWithMessage", { message: rawMessage });
			}
			return i18n.t("epub.errors.unknown");
	}
}

function buildLogMessage(
	code: EpubErrorCode,
	operation: EpubErrorOperation,
	message: string,
	filePath = ""
): string {
	const format = resolveBookFormatLabel(filePath) || "EPUB";
	return `[${format}:${operation}:${code}] ${message}`;
}
