/**
 * Full Obsidian community recommended rules audit (recommendedWithLocalesEn).
 * Used for prioritization metrics across all production src TypeScript files.
 */
import { defineConfig } from "eslint/config";
import globals from "globals";
import tsparser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";

const obsidianBrowserGlobals = {
	...globals.browser,
	activeDocument: "readonly",
	activeWindow: "readonly",
};

export default defineConfig([
	{
		ignores: [
			"dist/**",
			"backup-before-migration/**",
			"src/**/*.test.ts",
			"src/**/*.spec.ts",
			"src/**/__tests__/**",
			"src/demo/**",
			"src/tests/**",
			"src/test-integration.ts",
		],
	},
	...obsidianmd.configs.recommendedWithLocalesEn,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				project: "./tsconfig.eslint.obsidian.json",
				tsconfigRootDir: import.meta.dirname,
			},
			globals: obsidianBrowserGlobals,
		},
	},
	{
		files: ["src/config/**/*.ts"],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
	{
		files: ["src/services/epub/foliate-runtime-patches.ts"],
		rules: {
			// Prototype descriptor patching must call native iframe.src accessors via Reflect.apply.
			"@typescript-eslint/unbound-method": "off",
		},
	},
	{
		files: ["src/**/*.ts"],
		rules: {
			"obsidianmd/ui/sentence-case": [
				"error",
				{
					brands: ["Weave", "Obsidian", "Markdown"],
					acronyms: [
						"AI",
						"API",
						"HTTP",
						"HTTPS",
						"IR",
						"PDF",
						"EPUB",
						"PDF++",
						"UUID",
						"URL",
						"YAML",
					],
				},
			],
		},
	},
	{
		files: [
			"src/utils/obsidian-document-dom.ts",
			"src/services/epub/FoliateReaderService.ts",
			"src/services/epub/foliate-blob-markup-normalizer.ts",
		],
		rules: {
			// EPUB foliate section/XML documents use doc.createElement fallbacks where doc.win
			// is unavailable; createEl("style") is separately blocked by no-forbidden-elements.
			"obsidianmd/prefer-create-el": "off",
		},
	},
]);
