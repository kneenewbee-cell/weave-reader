/**
 * Subset of Obsidian community bot blocking rules (errors only).
 * Full recommended config is too strict for incremental cleanup; this gate matches bot blockers.
 */
import { defineConfig } from "eslint/config";
import globals from "globals";
import tsparser from "@typescript-eslint/parser";
import tseslint from "@typescript-eslint/eslint-plugin";
import obsidianmd from "eslint-plugin-obsidianmd";

const obsidianBrowserGlobals = {
	...globals.browser,
	activeDocument: "readonly",
	activeWindow: "readonly",
};

const gateRules = {
	"obsidianmd/no-static-styles-assignment": "error",
	"@typescript-eslint/no-deprecated": "error",
	"no-restricted-globals": [
		"error",
		{
			name: "app",
			message:
				"Avoid using the global app object. Instead use the reference provided by your plugin instance.",
		},
		"warn",
		{
			name: "fetch",
			message:
				"Use the built-in `requestUrl` function instead of `fetch` for network requests in Obsidian.",
		},
		{
			name: "localStorage",
			message:
				"Prefer `App#saveLocalStorage` / `App#loadLocalStorage` functions to write / read localStorage data that's unique to a vault.",
		},
	],
};

export default defineConfig([
	{
		ignores: [
			"dist/**",
			"src/**/*.test.ts",
			"src/**/*.spec.ts",
			"src/**/__tests__/**",
			"src/demo/**",
			"src/tests/**",
		],
	},
	{
		files: ["src/**/*.ts"],
		plugins: {
			obsidianmd,
			"@typescript-eslint": tseslint,
		},
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				project: "./tsconfig.eslint.obsidian.json",
				tsconfigRootDir: import.meta.dirname,
			},
			globals: obsidianBrowserGlobals,
		},
		rules: gateRules,
	},
	{
		files: ["src/services/epub/vendor/**/*.ts"],
		rules: {
			"no-restricted-globals": "off",
			"@typescript-eslint/no-deprecated": "off",
		},
	},
]);
