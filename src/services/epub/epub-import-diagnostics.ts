import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import { DirectoryUtils } from "../../utils/directory-utils";
import { logger } from "../../utils/logger";
import type { ImportEpubAnnotatedBookPackageResult } from "./epub-portable-book-package";

export const EPUB_IMPORT_MODAL_DEBUG_LOG_PATH = "weave/epub-data/debug/import-modal-debug.jsonl";
export const EPUB_IMPORT_PLUGIN_DEBUG_LOG_PATH = ".obsidian/plugins/weave-reader/state/import-modal-debug.jsonl";

const MAX_DEBUG_LOG_CHARS = 200_000;
const MAX_ARRAY_ITEMS = 50;
const MAX_DEPTH = 5;

type DiagnosticPayload = Record<string, unknown>;

function sanitizeDiagnosticValue(
	value: unknown,
	seen: WeakSet<object> = new WeakSet<object>(),
	depth = 0
): unknown {
	if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (typeof value === "function" || typeof value === "symbol") {
		return String(value);
	}
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack,
		};
	}
	if (typeof value !== "object") {
		return String(value);
	}
	if (seen.has(value)) {
		return "[Circular]";
	}
	if (depth >= MAX_DEPTH) {
		return Array.isArray(value) ? `[Array(${value.length})]` : "[Object]";
	}
	seen.add(value);
	if (Array.isArray(value)) {
		return value
			.slice(0, MAX_ARRAY_ITEMS)
			.map((item) => sanitizeDiagnosticValue(item, seen, depth + 1));
	}
	const output: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		output[key] = sanitizeDiagnosticValue(child, seen, depth + 1);
	}
	return output;
}

export function summarizeEpubImportResult(
	result: Partial<ImportEpubAnnotatedBookPackageResult> | null | undefined
): Record<string, unknown> {
	if (!result) {
		return {};
	}
	return {
		bookId: result.bookId,
		bookPath: result.bookPath ? normalizePath(result.bookPath) : result.bookPath,
		importedDataDir: result.importedDataDir ? normalizePath(result.importedDataDir) : result.importedDataDir,
		matchedExistingBook: result.matchedExistingBook,
		matchKind: result.matchKind,
		usedPreferredTarget: result.usedPreferredTarget,
		importedAnnotationVersionCount: result.importedAnnotationVersionCount,
		importedAnnotationCount: result.importedAnnotationCount,
		importedVersionIds: result.importedVersionIds,
		activeVersionId: result.activeVersionId,
		activatedImportedVersion: result.activatedImportedVersion,
	};
}

function getPluginDebugLogPath(app: App): string {
	const configDir = normalizePath(String(app.vault.configDir || ".obsidian").trim() || ".obsidian");
	return normalizePath(`${configDir}/plugins/weave-reader/state/import-modal-debug.jsonl`);
}

async function appendDiagnosticLine(app: App, path: string, line: string): Promise<void> {
	const adapter = app.vault.adapter;
	await DirectoryUtils.ensureDirForFile(adapter, path);
	const exists = await adapter.exists(path);
	let previous = exists ? await adapter.read(path) : "";
	if (previous.length > MAX_DEBUG_LOG_CHARS) {
		previous = previous.slice(-MAX_DEBUG_LOG_CHARS);
		const firstNewline = previous.indexOf("\n");
		if (firstNewline >= 0) {
			previous = previous.slice(firstNewline + 1);
		}
	}
	await adapter.write(
		path,
		previous && !previous.endsWith("\n") ? `${previous}\n${line}` : `${previous}${line}`
	);
}

export async function appendEpubImportDiagnostic(
	app: App,
	event: string,
	payload: DiagnosticPayload = {}
): Promise<void> {
	const entry = {
		at: new Date().toISOString(),
		event,
		payload: sanitizeDiagnosticValue(payload),
	};
	const nextLine = `${JSON.stringify(entry)}\n`;
	const paths = Array.from(new Set([
		EPUB_IMPORT_MODAL_DEBUG_LOG_PATH,
		getPluginDebugLogPath(app),
	]));
	const failures: unknown[] = [];
	for (const path of paths) {
		try {
			await appendDiagnosticLine(app, path, nextLine);
		} catch (error) {
			failures.push({ path, error });
		}
	}
	if (failures.length < paths.length) {
		return;
	}
	try {
		logger.warn("[EPUB import diagnostics] Failed to write every diagnostic log:", failures);
	} catch {
		// noop
	}
}

export function registerEpubImportNoticeDiagnostics(
	app: App,
	registerCleanup: (cleanup: () => void) => void
): void {
	if (typeof document === "undefined" || typeof MutationObserver === "undefined" || !document.body) {
		return;
	}
	const seen = new WeakSet<Node>();
	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			for (const node of Array.from(mutation.addedNodes)) {
				if (seen.has(node)) {
					continue;
				}
				seen.add(node);
				const text = String(node.textContent || "").trim();
				if (!text.includes("导入书籍标注包") && !text.includes("已导入书籍标注包")) {
					continue;
				}
				void appendEpubImportDiagnostic(app, "notice.detected", {
					text,
				});
			}
		}
	});
	observer.observe(document.body, { childList: true, subtree: true });
	registerCleanup(() => observer.disconnect());
}
