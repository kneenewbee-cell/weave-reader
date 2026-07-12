import { i18n } from "../../utils/i18n";

export type BookshelfSurfaceContext = "main" | "sidebar";

export type BookshelfDisplayMode = "adaptive" | "list" | "grid" | "covers";

export type ResolvedBookshelfViewMode = Exclude<BookshelfDisplayMode, "adaptive">;

export interface BookshelfDisplayModeOption {
	mode: BookshelfDisplayMode;
	label: string;
	description: string;
	icon: string;
}

export const DEFAULT_BOOKSHELF_DISPLAY_MODE: BookshelfDisplayMode = "list";

const BOOKSHELF_DISPLAY_MODE_META: Array<Pick<BookshelfDisplayModeOption, "mode" | "icon">> = [
	{ mode: "adaptive", icon: "sparkles" },
	{ mode: "list", icon: "list" },
	{ mode: "grid", icon: "layout-grid" },
	{ mode: "covers", icon: "library" },
];

function buildBookshelfDisplayModeOption(mode: BookshelfDisplayMode, icon: string): BookshelfDisplayModeOption {
	return {
		mode,
		icon,
		label: i18n.t(`epub.displayMode.${mode}.label`),
		description: i18n.t(`epub.displayMode.${mode}.description`),
	};
}

export function getBookshelfDisplayModeOptions(): BookshelfDisplayModeOption[] {
	return BOOKSHELF_DISPLAY_MODE_META.map((option) =>
		buildBookshelfDisplayModeOption(option.mode, option.icon)
	);
}

export function normalizeBookshelfDisplayMode(value: unknown): BookshelfDisplayMode {
	return BOOKSHELF_DISPLAY_MODE_META.some((option) => option.mode === value)
		? (value as BookshelfDisplayMode)
		: DEFAULT_BOOKSHELF_DISPLAY_MODE;
}

export function resolveBookshelfViewMode(
	mode: BookshelfDisplayMode,
	surfaceContext: BookshelfSurfaceContext
): ResolvedBookshelfViewMode {
	if (mode === "adaptive") {
		return surfaceContext === "sidebar" ? "list" : "grid";
	}
	return mode;
}

export function getBookshelfDisplayModeOption(
	mode: BookshelfDisplayMode
): BookshelfDisplayModeOption {
	const resolvedMeta =
		BOOKSHELF_DISPLAY_MODE_META.find((option) => option.mode === mode) ?? BOOKSHELF_DISPLAY_MODE_META[0];
	return buildBookshelfDisplayModeOption(resolvedMeta.mode, resolvedMeta.icon);
}
