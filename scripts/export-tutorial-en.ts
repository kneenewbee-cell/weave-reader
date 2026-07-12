import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve("src/components/epub/tutorial-locales");
mkdirSync(dir, { recursive: true });

const enPath = resolve(dir, "en-US.json");
const enContent = readFileSync(enPath, "utf8");
JSON.parse(enContent);
console.log("en-US tutorial validated at", enPath);
