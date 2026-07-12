import { DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_FOLDER } from "../../../config/epub-user-vault-folders";
import { normalizeVaultFolderPath } from "../../../utils/vault-folder-markdown-filter";

export interface ResolveBookNotesExportTemplateFolderOptions {
	/** 未加载用户设置时为 false，避免误用初始默认目录创建 Vault 文件夹 */
	allowDefaultFallback?: boolean;
}

export function resolveBookNotesExportTemplateFolder(
	settings?: { bookNotesExportTemplateFolder?: string | null } | null,
	options: ResolveBookNotesExportTemplateFolderOptions = {}
): string {
	const allowDefaultFallback = options.allowDefaultFallback !== false;
	const normalized = normalizeVaultFolderPath(settings?.bookNotesExportTemplateFolder);
	if (normalized) {
		return normalized;
	}
	if (!allowDefaultFallback) {
		return "";
	}
	return DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_FOLDER;
}
