import type { BuildBookNotesExportContextInput } from "./export-context";
import { formatBookNotesPrintPageLabel } from "./page-label";

export type BookNotesExportLabelTranslator = (
	key: string,
	vars?: Record<string, string | number>
) => string;

export function buildBookNotesExportLabelsFromTranslator(
	t: BookNotesExportLabelTranslator
): BuildBookNotesExportContextInput["labels"] {
	return {
		notesTitle: t("epub.reader.notesTitle"),
		chapterLabel: (number: number) => t("epub.reader.chapterLabel", { number }),
		unlocatedChapter: t("epub.reader.unlocatedChapter"),
		excerptHeading: (number: number) => t("epub.reader.excerptHeading", { number }),
		highlight: t("epub.reader.highlight"),
		concealed: t("epub.reader.concealed"),
		underline: t("epub.reader.underline"),
		strikethrough: t("epub.reader.strikethrough"),
		wavy: t("epub.reader.wavy"),
		emptyExcerpt: t("epub.reader.emptyExcerpt"),
		metaColor: (value: string) => t("epub.reader.exportMeta.color", { value }),
		metaStyle: (value: string) => t("epub.reader.exportMeta.style", { value }),
		metaTime: (value: string) => t("epub.reader.exportMeta.time", { value }),
		metaSource: (value: string) => t("epub.reader.exportMeta.source", { value }),
		formatPageLabel: (pageNumber: number | undefined, pageLabel: string) => {
			const normalizedLabel = String(pageLabel || "").trim();
			if (normalizedLabel) {
				return normalizedLabel;
			}
			return formatBookNotesPrintPageLabel(pageNumber);
		},
		citationInline: (parts) =>
			t("epub.export.citation.inline", {
				book: parts.bookTitle,
				chapter: parts.chapterLabel,
				page: parts.pageLabel || t("epub.export.citation.pageUnknown"),
			}),
		citationBlock: (parts) =>
			t("epub.export.citation.block", {
				book: parts.bookTitle,
				chapter: parts.chapterLabel,
				page: parts.pageLabel || t("epub.export.citation.pageUnknown"),
			}),
		citationAcademic: (parts) =>
			t("epub.export.citation.academic", {
				author: parts.author || t("epub.export.citation.unknownAuthor"),
				book: parts.bookTitle,
				chapter: parts.chapterTitle || parts.chapterLabel,
				page: parts.pageLabel || t("epub.export.citation.pageUnknown"),
				time: parts.createdTimeFormatted,
			}),
	};
}
