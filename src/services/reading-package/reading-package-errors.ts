export function formatReadingPackageErrorLogArgs(
	filePath: string,
	error: unknown,
): string[] {
	return [
		`filePath=${filePath}`,
		error instanceof Error ? error.message : String(error),
	];
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function getReadingPackageExportNoticeMessage(error: unknown): string {
	const message = getErrorMessage(error);
	if (message === "reading-package-empty-selection") {
		return "请选择至少一项导出内容";
	}
	if (message === "reading-package-empty-content") {
		return "所选项目当前没有可导出的阅读数据；请勾选原书，或先创建标注、墨迹、书签/进度后再导出";
	}
	if (message === "reading-package-book-file-unavailable") {
		return "找不到原书文件，无法导出包含原书的阅读包";
	}
	return message;
}
