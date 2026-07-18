import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	normalizePath: (value: string) =>
		String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, ""),
}));

import {
	EPUB_IMPORT_MODAL_DEBUG_LOG_PATH,
	EPUB_IMPORT_PLUGIN_DEBUG_LOG_PATH,
	appendEpubImportDiagnostic,
	summarizeEpubImportResult,
} from "../epub-import-diagnostics";

function createAppHarness() {
	const files = new Map<string, string>();
	const folders = new Set<string>();
	const adapter = {
		exists: async (path: string) => files.has(path) || folders.has(path),
		mkdir: async (path: string) => {
			folders.add(path);
		},
		read: async (path: string) => files.get(path) || "",
		write: async (path: string, text: string) => {
			files.set(path, text);
		},
	};
	return {
		app: { vault: { adapter } },
		files,
		folders,
	};
}

describe("epub-import-diagnostics", () => {
	it("writes import modal diagnostics as JSONL without throwing on Error payloads", async () => {
		const { app, files, folders } = createAppHarness();

		await appendEpubImportDiagnostic(app as never, "modal.open-error", {
			source: "bookshelf.import-top",
			error: new Error("boom"),
		});

		expect(folders.has("weave")).toBe(true);
		expect(folders.has("weave/epub-data")).toBe(true);
		expect(folders.has("weave/epub-data/debug")).toBe(true);

		const text = files.get(EPUB_IMPORT_MODAL_DEBUG_LOG_PATH) || "";
		const entry = JSON.parse(text.trim());
		expect(entry.event).toBe("modal.open-error");
		expect(entry.payload.source).toBe("bookshelf.import-top");
		expect(entry.payload.error.message).toBe("boom");

		const pluginText = files.get(EPUB_IMPORT_PLUGIN_DEBUG_LOG_PATH) || "";
		const pluginEntry = JSON.parse(pluginText.trim());
		expect(pluginEntry.event).toBe("modal.open-error");
		expect(pluginEntry.payload.error.message).toBe("boom");
	});

	it("falls back to the plugin debug path when the weave debug path cannot be written", async () => {
		const { app, files } = createAppHarness();
		const originalWrite = (app as never as {
			vault: { adapter: { write: (path: string, text: string) => Promise<void> } };
		}).vault.adapter.write;
		(app as never as {
			vault: { adapter: { write: (path: string, text: string) => Promise<void> } };
		}).vault.adapter.write = async (path: string, text: string) => {
			if (path === EPUB_IMPORT_MODAL_DEBUG_LOG_PATH) {
				throw new Error("primary-write-failed");
			}
			await originalWrite(path, text);
		};

		await appendEpubImportDiagnostic(app as never, "plugin.onload", {
			id: "weave-reader",
		});

		expect(files.has(EPUB_IMPORT_MODAL_DEBUG_LOG_PATH)).toBe(false);
		const pluginText = files.get(EPUB_IMPORT_PLUGIN_DEBUG_LOG_PATH) || "";
		const pluginEntry = JSON.parse(pluginText.trim());
		expect(pluginEntry.event).toBe("plugin.onload");
		expect(pluginEntry.payload.id).toBe("weave-reader");
	});

	it("summarizes import results without storing bulky package data", () => {
		expect(summarizeEpubImportResult({
			bookId: "epub-book-demo",
			bookPath: "Books/demo.epub",
			importedDataDir: "weave/epub-data/books/epub-book-demo",
			matchedExistingBook: true,
			matchKind: "file",
			usedPreferredTarget: false,
			importedAnnotationVersionCount: 2,
			importedAnnotationCount: 7,
			importedVersionIds: ["default", "imported-default"],
			activeVersionId: "imported-default",
			activatedImportedVersion: true,
		})).toEqual({
			bookId: "epub-book-demo",
			bookPath: "Books/demo.epub",
			importedDataDir: "weave/epub-data/books/epub-book-demo",
			matchedExistingBook: true,
			matchKind: "file",
			usedPreferredTarget: false,
			importedAnnotationVersionCount: 2,
			importedAnnotationCount: 7,
			importedVersionIds: ["default", "imported-default"],
			activeVersionId: "imported-default",
			activatedImportedVersion: true,
		});
	});
});
