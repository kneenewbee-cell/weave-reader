import type {
	ReadingPackageBookFormat,
	ReadingPackageModuleKey,
} from "./reading-package-types";

export interface ReadingPackageExportModule {
	key: ReadingPackageModuleKey;
	label: string;
	defaultSelected: boolean;
}

const READING_PACKAGE_EXPORT_MODULE_KEYS: ReadingPackageModuleKey[] = [
	"book",
	"annotationSystem",
	"ink",
	"navigationState",
	"aiReadingNote",
];

export function hasSelectedReadingPackageModule(
	modules: Partial<Record<ReadingPackageModuleKey, unknown>> | null | undefined,
): boolean {
	return READING_PACKAGE_EXPORT_MODULE_KEYS.some((key) => modules?.[key] === true);
}

export function getReadingPackageExportModules(
	format: ReadingPackageBookFormat,
): ReadingPackageExportModule[] {
	const modules: ReadingPackageExportModule[] = [
		{
			key: "book",
			label: format === "pdf" ? "包含 PDF 原书" : "包含 EPUB 原书",
			defaultSelected: false,
		},
		{
			key: "annotationSystem",
			label: "标注体系",
			defaultSelected: true,
		},
	];

	if (format === "pdf") {
		modules.push({
			key: "ink",
			label: "手写/墨迹",
			defaultSelected: true,
		});
	}

	modules.push({
		key: "navigationState",
		label: "书签与进度",
		defaultSelected: true,
	});

	if (format === "epub") {
		modules.push({
			key: "aiReadingNote",
			label: "AI 阅读笔记",
			defaultSelected: true,
		});
	}

	return modules;
}
