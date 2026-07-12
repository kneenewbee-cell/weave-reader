import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { appShellEpubTranslations } from "../src/utils/i18n/resources/app-shell-epub";
import { epubTranslations } from "../src/utils/i18n/resources/epub";
import { flattenTranslationLeafKeys, mergeTranslationTrees } from "../src/utils/i18n/flat-locale";

const zhCatalog = mergeTranslationTrees(
	appShellEpubTranslations["zh-CN"],
	epubTranslations["zh-CN"]
);

const flat = flattenTranslationLeafKeys(zhCatalog);
const outDir = resolve(process.cwd(), "scripts/curated-overlay-data");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "zh-CN.snapshot.json");
writeFileSync(outPath, `${JSON.stringify(flat, null, 2)}\n`, "utf8");
console.log(`Wrote ${Object.keys(flat).length} zh-CN keys to ${outPath}`);
