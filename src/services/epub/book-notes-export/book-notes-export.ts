import type { App } from "obsidian";
import type { EpubBook } from "../types";
import type { ReaderHighlight } from "../reader-engine-types";
import { EpubLinkService } from "../EpubLinkService";
import type { BookNotesExportLegacyTemplate } from "./constants";
import {
	buildBookNotesExportContext,
	type BuildBookNotesExportContextInput,
} from "./export-context";
import { loadBookNotesExportTemplateSource } from "./install-templates";
import { formatBookNotesPrintPageLabel } from "./page-label";
import { buildBookNotesExportPreviewContext } from "./preview-fixture";
import {
	formatBookNotesTemplateError,
	renderBookNotesTemplate,
} from "./template-renderer";

export interface RenderBookNotesMarkdownInput {
	app: App;
	book: EpubBook;
	filePath: string;
	highlights: ReaderHighlight[];
	templatePath?: string | null;
	templateFolder?: string | null;
	legacyTemplate?: BookNotesExportLegacyTemplate;
	trimBlocks?: boolean;
	labels: BuildBookNotesExportContextInput["labels"];
	formatTimestamp: (date: Date) => string;
	resolvePageNumber?: (highlight: ReaderHighlight) => Promise<number | undefined>;
}

export async function enrichHighlightsWithPageNumbers(
	highlights: ReaderHighlight[],
	resolvePageNumber?: (highlight: ReaderHighlight) => Promise<number | undefined>
): Promise<ReaderHighlight[]> {
	if (!resolvePageNumber) {
		return highlights;
	}

	return await Promise.all(
		highlights.map(async (highlight) => {
			if (String(highlight.pageLabel || "").trim()) {
				return highlight;
			}
			try {
				const pageNumber = await resolvePageNumber(highlight);
				if (typeof pageNumber !== "number" || !Number.isFinite(pageNumber) || pageNumber <= 0) {
					return highlight;
				}
				return {
					...highlight,
					pageNumber,
					pageLabel: formatBookNotesPrintPageLabel(pageNumber),
				};
			} catch {
				return highlight;
			}
		})
	);
}

export async function renderBookNotesMarkdown(
	input: RenderBookNotesMarkdownInput
): Promise<string> {
	const linkService = new EpubLinkService(input.app);
	const highlights = await enrichHighlightsWithPageNumbers(
		input.highlights,
		input.resolvePageNumber
	);
	const context = buildBookNotesExportContext({
		book: input.book,
		filePath: input.filePath,
		highlights,
		linkService,
		labels: input.labels,
		formatTimestamp: input.formatTimestamp,
	});

	const { source } = await loadBookNotesExportTemplateSource(input.app, {
		templatePath: input.templatePath,
		templateFolder: input.templateFolder,
		legacyTemplate: input.legacyTemplate,
	});

	try {
		return renderBookNotesTemplate({
			templateSource: source,
			context,
			trimBlocks: input.trimBlocks,
		});
	} catch (error) {
		throw new Error(formatBookNotesTemplateError(error));
	}
}

export function renderBookNotesTemplatePreview(
	templateSource: string,
	options: {
		trimBlocks?: boolean;
		labels?: BuildBookNotesExportContextInput["labels"];
	} = {}
): string {
	const context = buildBookNotesExportPreviewContext();
	return renderBookNotesTemplate({
		templateSource,
		context,
		trimBlocks: options.trimBlocks,
	});
}

export {
	ensureDefaultBookNotesExportTemplates,
	isBuiltinBookNotesExportTemplatePath,
	isMarkdownVaultFile,
	loadBookNotesExportTemplateSource,
	resolveBuiltinTemplatePath,
	resolveLegacyTemplatePath,
} from "./install-templates";
export { buildBookNotesExportLabelsFromTranslator } from "./export-labels";
export { buildBookNotesExportPreviewContext } from "./preview-fixture";
export { replaceBookNotesExportSection, wrapBookNotesExportSection } from "./marker-append";
export {
	DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_PATH,
	DEFAULT_CALLOUT_TEMPLATE_PATH,
	DEFAULT_CITATION_G_TEMPLATE_PATH,
	DEFAULT_CLASSIC_TEMPLATE_PATH,
	DEFAULT_DIGEST_A_TEMPLATE_PATH,
	DEFAULT_DIGEST_B_TEMPLATE_PATH,
} from "./constants";
export type {
	BookNotesExportBuiltinTemplateId,
	BookNotesExportLegacyTemplate,
} from "./constants";
