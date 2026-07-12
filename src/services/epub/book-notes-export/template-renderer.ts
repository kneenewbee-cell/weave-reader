import nunjucks from "nunjucks";
import type { BookNotesExportContext } from "./export-context";

export interface RenderBookNotesTemplateOptions {
	templateSource: string;
	context: BookNotesExportContext;
	trimBlocks?: boolean;
}

interface NunjucksRenderer {
	renderString: (template: string, context: BookNotesExportContext) => string;
}

interface NunjucksModule {
	configure: (options: {
		autoescape: boolean;
		trimBlocks: boolean;
		lstripBlocks: boolean;
		throwOnUndefined: boolean;
	}) => NunjucksRenderer;
}

const nunjucksModule = nunjucks as unknown as NunjucksModule;

function createBookNotesTemplateRenderer(trimBlocks: boolean): NunjucksRenderer {
	return nunjucksModule.configure({
		autoescape: false,
		trimBlocks,
		lstripBlocks: trimBlocks,
		throwOnUndefined: false,
	});
}

export function renderBookNotesTemplate(options: RenderBookNotesTemplateOptions): string {
	const templateSource = String(options.templateSource || "").trim();
	if (!templateSource) {
		throw new Error("Export template is empty");
	}

	const renderer = createBookNotesTemplateRenderer(options.trimBlocks !== false);
	const rendered = renderer.renderString(templateSource, options.context);
	return rendered.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function formatBookNotesTemplateError(error: unknown): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message.trim();
	}
	return "Failed to render export template";
}
