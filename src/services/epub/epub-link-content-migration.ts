import type { App, TFile } from "obsidian";
import { Notice } from "obsidian";
import { i18n } from "../../utils/i18n";
import { showObsidianConfirm } from "../../utils/obsidian-confirm";
import { EpubLinkService } from "./EpubLinkService";

const promptedMigrationPaths = new Set<string>();
const declinedMigrationPaths = new Set<string>();

export async function maybeMigrateEpubLinksInMarkdownFile(
	app: App,
	sourceFile: TFile,
	originalContent: string
): Promise<void> {
	const sourcePath = sourceFile.path;
	if (declinedMigrationPaths.has(sourcePath) || promptedMigrationPaths.has(sourcePath)) {
		return;
	}

	const legacyLinkCount = EpubLinkService.countLegacyEpubLinkMarkups(originalContent);
	if (legacyLinkCount <= 0) {
		await applyEpubLinkContentMigration(app, sourceFile, originalContent, { silent: true });
		return;
	}

	promptedMigrationPaths.add(sourcePath);

	const fileLabel = sourceFile.basename || sourcePath;
	const confirmed = await showObsidianConfirm(
		app,
		i18n.t("epub.reader.legacyLinkMigrationConfirmMessage", {
			count: legacyLinkCount,
			file: fileLabel,
		}),
		{
			title: i18n.t("epub.reader.legacyLinkMigrationConfirmTitle"),
			confirmText: i18n.t("epub.reader.legacyLinkMigrationConfirmButton"),
			cancelText: i18n.t("epub.reader.legacyLinkMigrationCancelButton"),
		}
	);

	if (!confirmed) {
		declinedMigrationPaths.add(sourcePath);
		return;
	}

	const migrated = await applyEpubLinkContentMigration(app, sourceFile, originalContent, {
		silent: false,
	});
	if (migrated) {
		new Notice(
			i18n.t("epub.reader.legacyLinkMigrationSuccess", {
				count: legacyLinkCount,
				file: fileLabel,
			})
		);
	}
}

async function applyEpubLinkContentMigration(
	app: App,
	sourceFile: TFile,
	originalContent: string,
	options: { silent: boolean }
): Promise<boolean> {
	try {
		const linkService = new EpubLinkService(app);
		const migration = await linkService.enrichEpubLinksWithSourceIdsInContent(
			originalContent,
			sourceFile.path
		);
		if (!migration.changed || migration.content === originalContent) {
			return false;
		}
		await app.vault.process(sourceFile, (content) =>
			content === originalContent ? migration.content : content
		);
		return true;
	} catch {
		if (!options.silent) {
			new Notice(i18n.t("epub.reader.legacyLinkMigrationFailed"));
		}
		return false;
	}
}

/** Resets in-memory migration prompt state (for tests). */
export function resetEpubLinkMigrationPromptStateForTests(): void {
	promptedMigrationPaths.clear();
	declinedMigrationPaths.clear();
}
