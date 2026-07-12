import type { App, TFile } from "obsidian";
import { Notice, normalizePath } from "obsidian";
import { getPluginPaths } from "../../config/paths";
import { DirectoryUtils } from "../../utils/directory-utils";
import { i18n } from "../../utils/i18n";
import { logger } from "../../utils/logger";
import { showObsidianConfirm } from "../../utils/obsidian-confirm";
import { ensureEpubBookmarkCoverPath } from "./epub-bookmark-cover";
import { deriveEpubBookmarkDisplayTitle } from "./epub-bookmark-display-title";
import { readEpubBookmarkAnalyticsFromFrontmatter } from "./epub-bookmark-analytics";
import { EPUB_BOOKMARK_FILE_FORMAT_V3 } from "./epub-bookmark-page-types";
import { renderEpubBookmarkFileContent } from "./epub-bookmark-page-render";
import { EPUB_BOOKMARK_DATA_FILE_PREFIX } from "./epub-bookmark-folder-path";
import {
	isEpubBookmarkVaultFrontmatter,
	parseEpubBookmarkVaultYamlBlock,
} from "./epub-bookmark-vault-parse";
import { resolveEpubBookmarkFolderForApp } from "./epub-bookmark-vault-path";
import { EpubLinkService } from "./EpubLinkService";

const BACKUP_ROOT_SEGMENT = "epub-bookmarks";
const MIGRATION_STATE_FILE = "epub-bookmark-v3-state.json";

export interface EpubBookmarkMigrationBackupEntry {
	id: string;
	createdAt: number;
	fileCount: number;
	bookmarkFolder: string;
	label: string;
}

export interface EpubBookmarkMigrationState {
	v3MigrationCompletedAt: number | null;
	v3MigrationDeclinedAt: number | null;
	lastBackupId: string | null;
	backups: EpubBookmarkMigrationBackupEntry[];
}

interface ParsedBookmarkMigrationFile {
	path: string;
	rawContent: string;
	format: string;
	frontmatter: Record<string, unknown>;
}

function createDefaultMigrationState(): EpubBookmarkMigrationState {
	return {
		v3MigrationCompletedAt: null,
		v3MigrationDeclinedAt: null,
		lastBackupId: null,
		backups: [],
	};
}

function getMigrationStatePath(app: App): string {
	return normalizePath(`${getPluginPaths(app).cache.root}/migration/${MIGRATION_STATE_FILE}`);
}

function getBackupRootPath(app: App): string {
	return normalizePath(`${getPluginPaths(app).backups}/${BACKUP_ROOT_SEGMENT}`);
}

function toBackupFileName(vaultPath: string): string {
	return vaultPath.replace(/[/\\]/g, "__");
}

function formatBackupLabel(entry: EpubBookmarkMigrationBackupEntry): string {
	const date = new Date(entry.createdAt);
	const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
		date.getDate()
	).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(
		date.getMinutes()
	).padStart(2, "0")}`;
	return `${stamp} · ${entry.fileCount} ${i18n.t("epub.migration.bookmarkDataPage.files")}`;
}

function readFrontmatterString(value: unknown, fallback = ""): string {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return fallback;
}

function isBookmarkDataFile(file: TFile, bookmarkFolder: string): boolean {
	if (file.extension !== "md") {
		return false;
	}
	const normalizedFolder = normalizePath(bookmarkFolder);
	return (
		file.path.startsWith(`${normalizedFolder}/`) &&
		file.name.startsWith(EPUB_BOOKMARK_DATA_FILE_PREFIX)
	);
}

function resolveBookmarkFolder(app: App): string {
	return resolveEpubBookmarkFolderForApp(app);
}

function parseBookmarkMigrationFile(path: string, rawContent: string): ParsedBookmarkMigrationFile | null {
	const frontmatter = parseEpubBookmarkVaultYamlBlock(rawContent);
	if (!frontmatter || !isEpubBookmarkVaultFrontmatter(frontmatter)) {
		return null;
	}

	return {
		path,
		rawContent,
		format: readFrontmatterString(frontmatter.format),
		frontmatter,
	};
}

function needsV3Migration(parsed: ParsedBookmarkMigrationFile): boolean {
	return parsed.format !== EPUB_BOOKMARK_FILE_FORMAT_V3;
}

async function readMigrationState(app: App): Promise<EpubBookmarkMigrationState> {
	const statePath = getMigrationStatePath(app);
	const adapter = app.vault.adapter;
	try {
		if (!(await adapter.exists(statePath))) {
			return createDefaultMigrationState();
		}
		const raw = await adapter.read(statePath);
		const parsed = JSON.parse(raw) as Partial<EpubBookmarkMigrationState>;
		return {
			...createDefaultMigrationState(),
			...parsed,
			backups: Array.isArray(parsed.backups)
				? parsed.backups.filter(
						(entry): entry is EpubBookmarkMigrationBackupEntry =>
							Boolean(entry && typeof entry === "object" && typeof entry.id === "string")
					)
				: [],
		};
	} catch (error) {
		logger.warn("[EpubBookmarkMigration] Failed to read migration state:", error);
		return createDefaultMigrationState();
	}
}

async function writeMigrationState(app: App, state: EpubBookmarkMigrationState): Promise<void> {
	const statePath = getMigrationStatePath(app);
	await DirectoryUtils.ensureDirForFile(app.vault.adapter, statePath);
	await app.vault.adapter.write(statePath, JSON.stringify(state, null, 2));
}

export async function inspectEpubBookmarkV3Migration(app: App): Promise<{
	pendingCount: number;
	bookmarkFolder: string;
}> {
	const bookmarkFolder = resolveBookmarkFolder(app);
	let count = 0;
	for (const file of app.vault.getFiles()) {
		if (!isBookmarkDataFile(file, bookmarkFolder)) {
			continue;
		}
		const raw = await app.vault.read(file);
		const parsed = parseBookmarkMigrationFile(file.path, raw);
		if (parsed && needsV3Migration(parsed)) {
			count += 1;
		}
	}

	return { pendingCount: count, bookmarkFolder };
}

async function collectPendingMigrationFiles(app: App, bookmarkFolder: string): Promise<
	Array<{ file: TFile; parsed: ParsedBookmarkMigrationFile }>
> {
	const pending: Array<{ file: TFile; parsed: ParsedBookmarkMigrationFile }> = [];
	for (const file of app.vault.getFiles()) {
		if (!isBookmarkDataFile(file, bookmarkFolder)) {
			continue;
		}
		const raw = await app.vault.read(file);
		const parsed = parseBookmarkMigrationFile(file.path, raw);
		if (parsed && needsV3Migration(parsed)) {
			pending.push({ file, parsed });
		}
	}
	return pending;
}

export async function createEpubBookmarkMigrationBackup(
	app: App,
	bookmarkFolder: string,
	filePaths: string[]
): Promise<EpubBookmarkMigrationBackupEntry> {
	const adapter = app.vault.adapter;
	const backupId = `v3-${Date.now()}`;
	const backupDir = normalizePath(`${getBackupRootPath(app)}/${backupId}/files`);
	await DirectoryUtils.ensureDirRecursive(adapter, backupDir);

	for (const filePath of filePaths) {
		const normalizedPath = normalizePath(filePath);
		if (!(await adapter.exists(normalizedPath))) {
			continue;
		}
		const raw = await adapter.read(normalizedPath);
		const backupFilePath = normalizePath(`${backupDir}/${toBackupFileName(normalizedPath)}`);
		await adapter.write(backupFilePath, raw);
	}

	const entry: EpubBookmarkMigrationBackupEntry = {
		id: backupId,
		createdAt: Date.now(),
		fileCount: filePaths.length,
		bookmarkFolder,
		label: "",
	};
	entry.label = formatBackupLabel(entry);

	const manifestPath = normalizePath(`${getBackupRootPath(app)}/${backupId}/manifest.json`);
	await adapter.write(
		manifestPath,
		JSON.stringify(
			{
				id: entry.id,
				createdAt: entry.createdAt,
				fileCount: entry.fileCount,
				bookmarkFolder: entry.bookmarkFolder,
				files: filePaths.map((path) => ({
					vaultPath: path,
					backupName: toBackupFileName(path),
				})),
			},
			null,
			2
		)
	);

	const state = await readMigrationState(app);
	state.backups = [entry, ...state.backups.filter((item) => item.id !== entry.id)].slice(0, 20);
	state.lastBackupId = entry.id;
	await writeMigrationState(app, state);
	return entry;
}

async function migrateSingleBookmarkFile(
	app: App,
	file: TFile,
	parsed: ParsedBookmarkMigrationFile,
	bookmarkFolder: string,
	linkService: EpubLinkService
): Promise<void> {
	const frontmatter = parsed.frontmatter;
	const bookTitle = readFrontmatterString(frontmatter.bookTitle, file.basename).trim();
	const bookAuthor =
		typeof frontmatter.bookAuthor === "string" ? frontmatter.bookAuthor : undefined;
	const bookPath = normalizePath(readFrontmatterString(frontmatter.bookPath).trim());
	const stableKey = readFrontmatterString(frontmatter.stableKey).trim();
	const displayTitle =
		typeof frontmatter.displayTitle === "string" && frontmatter.displayTitle.trim()
			? frontmatter.displayTitle.trim()
			: deriveEpubBookmarkDisplayTitle({ bookTitle, bookAuthor, bookPath });

	const coverPath =
		(await ensureEpubBookmarkCoverPath(app, {
			bookPath,
			stableKey,
			bookmarkFolder,
			existingCoverPath:
				typeof frontmatter.coverPath === "string" ? frontmatter.coverPath : undefined,
		})) ||
		(typeof frontmatter.coverPath === "string" ? frontmatter.coverPath : undefined);

	const analytics = readEpubBookmarkAnalyticsFromFrontmatter(frontmatter);
	const user =
		frontmatter.user && typeof frontmatter.user === "object"
			? (frontmatter.user as Record<string, unknown>)
			: {
					tags: [],
					rating: null,
					priority: "",
					notes: "",
				};

	const content = renderEpubBookmarkFileContent(
		{
			stableKey,
			bookId: readFrontmatterString(frontmatter.bookId).trim(),
			sourceId: typeof frontmatter.sourceId === "string" ? frontmatter.sourceId : undefined,
			sourceFingerprint:
				typeof frontmatter.sourceFingerprint === "string"
					? frontmatter.sourceFingerprint
					: undefined,
			bookPath,
			displayTitle,
			bookTitle,
			bookAuthor,
			bookLanguage:
				typeof frontmatter.bookLanguage === "string" ? frontmatter.bookLanguage : undefined,
			publisher: typeof frontmatter.publisher === "string" ? frontmatter.publisher : undefined,
			isbn: typeof frontmatter.isbn === "string" ? frontmatter.isbn : undefined,
			publishDate:
				typeof frontmatter.publishDate === "string" ? frontmatter.publishDate : undefined,
			subjects: Array.isArray(frontmatter.subjects)
				? frontmatter.subjects.map((item) => String(item || "").trim()).filter(Boolean)
				: undefined,
			description:
				typeof frontmatter.description === "string" ? frontmatter.description : undefined,
			translator:
				typeof frontmatter.translator === "string" ? frontmatter.translator : undefined,
			coverPath,
			wordCount: typeof frontmatter.wordCount === "number" ? frontmatter.wordCount : undefined,
			chapterCount:
				typeof frontmatter.chapterCount === "number" ? frontmatter.chapterCount : undefined,
			updatedAt: typeof frontmatter.updatedAt === "number" ? frontmatter.updatedAt : Date.now(),
			bookmarks: Array.isArray(frontmatter.bookmarks)
				? (frontmatter.bookmarks as Array<Record<string, unknown>>).map((bookmark) => ({
						id: typeof bookmark.id === "string" ? bookmark.id : undefined,
						cfi: readFrontmatterString(bookmark.cfi),
						chapterIndex:
							typeof bookmark.chapterIndex === "number" ? bookmark.chapterIndex : 0,
						percent: typeof bookmark.percent === "number" ? bookmark.percent : 0,
						chapterTitle: readFrontmatterString(bookmark.chapterTitle),
						pageNumber:
							typeof bookmark.pageNumber === "number" ? bookmark.pageNumber : undefined,
						totalPages:
							typeof bookmark.totalPages === "number" ? bookmark.totalPages : undefined,
						createdAt: typeof bookmark.createdAt === "number" ? bookmark.createdAt : 0,
						preview: typeof bookmark.preview === "string" ? bookmark.preview : undefined,
					}))
				: [],
			readingState:
				frontmatter.readingState && typeof frontmatter.readingState === "object"
					? (frontmatter.readingState as {
							currentPosition: {
								chapterIndex: number;
								cfi: string;
								percent: number;
							};
							readingStats: Record<string, unknown>;
						})
					: undefined,
			analytics,
			user: user as {
				tags?: string[];
				rating?: number | null;
				priority?: string;
				notes?: string;
			},
		},
		linkService
	);

	await app.vault.modify(file, content.endsWith("\n") ? content : `${content}\n`);
}

export async function runEpubBookmarkV3Migration(app: App): Promise<{
	migratedCount: number;
	backup: EpubBookmarkMigrationBackupEntry;
}> {
	const bookmarkFolder = resolveBookmarkFolder(app);
	const pending = await collectPendingMigrationFiles(app, bookmarkFolder);
	if (pending.length === 0) {
		throw new Error(i18n.t("epub.migration.bookmarkDataPage.nothingToMigrate"));
	}

	const backup = await createEpubBookmarkMigrationBackup(
		app,
		bookmarkFolder,
		pending.map((entry) => entry.file.path)
	);

	const linkService = new EpubLinkService(app);
	let migratedCount = 0;
	for (const entry of pending) {
		try {
			await migrateSingleBookmarkFile(
				app,
				entry.file,
				entry.parsed,
				bookmarkFolder,
				linkService
			);
			migratedCount += 1;
		} catch (error) {
			logger.warn("[EpubBookmarkMigration] Failed to migrate bookmark file:", {
				path: entry.file.path,
				error,
			});
		}
	}

	const state = await readMigrationState(app);
	state.v3MigrationCompletedAt = Date.now();
	state.v3MigrationDeclinedAt = null;
	await writeMigrationState(app, state);

	return { migratedCount, backup };
}

let migrationPromptScheduled = false;

export async function maybePromptEpubBookmarkV3Migration(app: App): Promise<void> {
	if (migrationPromptScheduled) {
		return;
	}
	migrationPromptScheduled = true;

	try {
		const state = await readMigrationState(app);
		const { pendingCount, bookmarkFolder } = await inspectEpubBookmarkV3Migration(app);
		if (pendingCount <= 0) {
			return;
		}

		if (state.v3MigrationDeclinedAt) {
			return;
		}

		const confirmed = await showObsidianConfirm(
			app,
			i18n.t("epub.migration.bookmarkDataPage.promptMessage", {
				count: pendingCount,
				folder: bookmarkFolder,
			}),
			{
				title: i18n.t("epub.migration.bookmarkDataPage.promptTitle"),
				confirmText: i18n.t("epub.migration.bookmarkDataPage.promptConfirm"),
				cancelText: i18n.t("epub.migration.bookmarkDataPage.promptCancel"),
				confirmClass: "mod-cta",
			}
		);

		if (!confirmed) {
			const nextState = await readMigrationState(app);
			nextState.v3MigrationDeclinedAt = Date.now();
			await writeMigrationState(app, nextState);
			return;
		}

		const { migratedCount, backup } = await runEpubBookmarkV3Migration(app);
		new Notice(
			i18n.t("epub.migration.bookmarkDataPage.success", {
				count: migratedCount,
				backupId: backup.id,
			}),
			6000
		);
	} catch (error) {
		logger.warn("[EpubBookmarkMigration] Migration prompt flow failed:", error);
		new Notice(i18n.t("epub.migration.bookmarkDataPage.failed"));
	}
}

export function resetEpubBookmarkMigrationPromptStateForTests(): void {
	migrationPromptScheduled = false;
}
