import type { BookNotesExportBuiltinTemplateId } from "./constants";

export interface BookNotesExportTemplateVariableGroup {
	id: string;
	labelKey: string;
	items: BookNotesExportTemplateVariableItem[];
}

export interface BookNotesExportTemplateVariableItem {
	token: string;
	labelKey: string;
	sampleKey: string;
}

export interface BookNotesExportTemplateSnippet {
	id: string;
	labelKey: string;
	content: string;
}

export const BOOK_NOTES_EXPORT_TEMPLATE_VARIABLE_GROUPS: BookNotesExportTemplateVariableGroup[] =
	[
		{
			id: "book",
			labelKey: "epub.settings.exportTemplateModal.variables.groups.book",
			items: [
				{
					token: "{{ book.title }}",
					labelKey: "epub.settings.exportTemplateModal.variables.book.title",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.bookTitle",
				},
				{
					token: "{{ book.author }}",
					labelKey: "epub.settings.exportTemplateModal.variables.book.author",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.bookAuthor",
				},
				{
					token: "{{ book.publisher }}",
					labelKey: "epub.settings.exportTemplateModal.variables.book.publisher",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.bookPublisher",
				},
				{
					token: "{{ book.filePath }}",
					labelKey: "epub.settings.exportTemplateModal.variables.book.filePath",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.bookFilePath",
				},
			],
		},
		{
			id: "export",
			labelKey: "epub.settings.exportTemplateModal.variables.groups.export",
			items: [
				{
					token: "{{ export.notesTitle }}",
					labelKey: "epub.settings.exportTemplateModal.variables.export.notesTitle",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.notesTitle",
				},
				{
					token: "{{ export.exportedAt }}",
					labelKey: "epub.settings.exportTemplateModal.variables.export.exportedAt",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.exportedAt",
				},
			],
		},
		{
			id: "chapter",
			labelKey: "epub.settings.exportTemplateModal.variables.groups.chapter",
			items: [
				{
					token: "{{ chapter.label }}",
					labelKey: "epub.settings.exportTemplateModal.variables.chapter.label",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.chapterLabel",
				},
				{
					token: "{{ chapter.title }}",
					labelKey: "epub.settings.exportTemplateModal.variables.chapter.title",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.chapterTitle",
				},
			],
		},
		{
			id: "highlight",
			labelKey: "epub.settings.exportTemplateModal.variables.groups.highlight",
			items: [
				{
					token: "{{ highlight.text }}",
					labelKey: "epub.settings.exportTemplateModal.variables.highlight.text",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.highlightText",
				},
				{
					token: "{{ highlight.commentText }}",
					labelKey: "epub.settings.exportTemplateModal.variables.highlight.commentText",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.commentText",
				},
				{
					token: "{{ highlight.pageLabel }}",
					labelKey: "epub.settings.exportTemplateModal.variables.highlight.pageLabel",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.pageLabel",
				},
				{
					token: "{{ highlight.citationInline }}",
					labelKey: "epub.settings.exportTemplateModal.variables.highlight.citationInline",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.citationInline",
				},
				{
					token: "{{ highlight.citationBlock }}",
					labelKey: "epub.settings.exportTemplateModal.variables.highlight.citationBlock",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.citationBlock",
				},
				{
					token: "{{ highlight.citationAcademic }}",
					labelKey: "epub.settings.exportTemplateModal.variables.highlight.citationAcademic",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.citationAcademic",
				},
				{
					token: "{{ highlight.createdTimeFormatted }}",
					labelKey: "epub.settings.exportTemplateModal.variables.highlight.createdTimeFormatted",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.createdTimeFormatted",
				},
				{
					token: "{{ highlight.blockquote }}",
					labelKey: "epub.settings.exportTemplateModal.variables.highlight.blockquote",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.blockquote",
				},
				{
					token: "{{ highlight.quoteBlock }}",
					labelKey: "epub.settings.exportTemplateModal.variables.highlight.quoteBlock",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.quoteBlock",
				},
				{
					token: "{{ highlight.epubLink }}",
					labelKey: "epub.settings.exportTemplateModal.variables.highlight.epubLink",
					sampleKey: "epub.settings.exportTemplateModal.variables.samples.epubLink",
				},
			],
		},
	];

export const BOOK_NOTES_EXPORT_TEMPLATE_LOOP_SNIPPETS: BookNotesExportTemplateSnippet[] = [
	{
		id: "for-chapters",
		labelKey: "epub.settings.exportTemplateModal.snippets.forChapters",
		content: "{% for chapter in chapters %}\n{% endfor %}",
	},
	{
		id: "for-highlights",
		labelKey: "epub.settings.exportTemplateModal.snippets.forHighlights",
		content:
			"{% for chapter in chapters %}\n{% for highlight in chapter.highlights %}\n{% endfor %}\n{% endfor %}",
	},
];

export const BOOK_NOTES_EXPORT_DIGEST_PRESET_IDS: BookNotesExportBuiltinTemplateId[] = [
	"digest-a",
	"digest-b",
	"citation-g",
];
