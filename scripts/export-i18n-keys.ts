import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appShellEpubTranslations } from "../src/utils/i18n/resources/app-shell-epub";
import { epubTranslations } from "../src/utils/i18n/resources/epub";
import { flattenTranslationLeafKeys, mergeTranslationTrees } from "../src/utils/i18n/flat-locale";

const enCatalog = mergeTranslationTrees(
	appShellEpubTranslations["en-US"],
	epubTranslations["en-US"]
);

const flat = flattenTranslationLeafKeys(enCatalog);
const outPath = resolve(process.cwd(), "src/utils/i18n/flat-locales/en-US.template.json");

writeFileSync(outPath, `${JSON.stringify(flat, null, 2)}\n`, "utf8");
console.log(`Wrote ${Object.keys(flat).length} keys to ${outPath}`);
