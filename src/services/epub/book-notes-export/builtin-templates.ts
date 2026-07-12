import type { BookNotesExportBuiltinTemplateId } from "./constants";
import {
	DEFAULT_CALLOUT_TEMPLATE_FILE,
	DEFAULT_CITATION_G_TEMPLATE_FILE,
	DEFAULT_CLASSIC_TEMPLATE_FILE,
	DEFAULT_DIGEST_A_TEMPLATE_FILE,
	DEFAULT_DIGEST_B_TEMPLATE_FILE,
} from "./constants";

export const BUILTIN_BOOK_NOTES_EXPORT_TEMPLATES: Record<
	BookNotesExportBuiltinTemplateId,
	{ fileName: string; content: string }
> = {
	classic: {
		fileName: DEFAULT_CLASSIC_TEMPLATE_FILE,
		content: `# {{ export.notesTitle }}

{% for chapter in chapters -%}
## {{ chapter.label }}

{% for highlight in chapter.highlights -%}
{{ highlight.excerptHeading }}

{{ highlight.blockquote }}
{% if highlight.metaLines.length -%}
{% for line in highlight.metaLines -%}
{{ line }}
{% endfor -%}
{% endif -%}
{% endfor -%}
{% endfor -%}`,
	},
	callout: {
		fileName: DEFAULT_CALLOUT_TEMPLATE_FILE,
		content: `# {{ export.notesTitle }}

{% for chapter in chapters -%}
## {{ chapter.label }}

{% for highlight in chapter.highlights -%}
### {{ highlight.styleLabel }}

{{ highlight.quoteBlock }}
{% endfor -%}
{% endfor -%}`,
	},
	"digest-a": {
		fileName: DEFAULT_DIGEST_A_TEMPLATE_FILE,
		content: `# {{ export.notesTitle }}

{% for chapter in chapters -%}
{% for highlight in chapter.highlights -%}
{{ highlight.text }}{{ highlight.citationInline }}
{{ highlight.createdTimeFormatted }}

{% endfor -%}
{% endfor -%}`,
	},
	"digest-b": {
		fileName: DEFAULT_DIGEST_B_TEMPLATE_FILE,
		content: `# {{ export.notesTitle }}

{% for chapter in chapters -%}
{% for highlight in chapter.highlights -%}
{{ highlight.text }}

{{ highlight.citationBlock }}
{{ highlight.createdTimeFormatted }}

{% endfor -%}
{% endfor -%}`,
	},
	"citation-g": {
		fileName: DEFAULT_CITATION_G_TEMPLATE_FILE,
		content: `# {{ export.notesTitle }}

{% for chapter in chapters -%}
{% for highlight in chapter.highlights -%}
"{{ highlight.text }}"
{{ highlight.citationAcademic }}

{% endfor -%}
{% endfor -%}`,
	},
};

export function getBuiltinBookNotesExportTemplate(
	templateId: BookNotesExportBuiltinTemplateId
): string {
	return BUILTIN_BOOK_NOTES_EXPORT_TEMPLATES[templateId].content;
}

export function getBuiltinBookNotesExportTemplateFileName(
	templateId: BookNotesExportBuiltinTemplateId
): string {
	return BUILTIN_BOOK_NOTES_EXPORT_TEMPLATES[templateId].fileName;
}

export function resolveBuiltinTemplateIdByFileName(
	fileName: string
): BookNotesExportBuiltinTemplateId | null {
	const normalized = String(fileName || "").trim().toLowerCase();
	for (const templateId of Object.keys(
		BUILTIN_BOOK_NOTES_EXPORT_TEMPLATES
	) as BookNotesExportBuiltinTemplateId[]) {
		if (BUILTIN_BOOK_NOTES_EXPORT_TEMPLATES[templateId].fileName.toLowerCase() === normalized) {
			return templateId;
		}
	}
	return null;
}
