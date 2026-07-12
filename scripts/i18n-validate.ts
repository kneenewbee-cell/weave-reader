import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	assertOverlayDoesNotCopyChinese,
	listCuratedOverlayCandidateKeys,
	validateCuratedOverlay,
} from "../src/utils/i18n/locale-policy";

const zhSnapshot = JSON.parse(
	readFileSync(resolve("scripts/curated-overlay-data/zh-CN.snapshot.json"), "utf8")
) as Record<string, string>;

const template = JSON.parse(
	readFileSync(resolve("src/utils/i18n/flat-locales/en-US.template.json"), "utf8")
) as Record<string, string>;

const jaOverlay = JSON.parse(
	readFileSync(resolve("src/utils/i18n/overlays/ja-JP.json"), "utf8")
) as Record<string, string>;

const koOverlay = JSON.parse(
	readFileSync(resolve("src/utils/i18n/overlays/ko-KR.json"), "utf8")
) as Record<string, string>;

const ruOverlay = JSON.parse(
	readFileSync(resolve("src/utils/i18n/overlays/ru-RU.json"), "utf8")
) as Record<string, string>;

const requiredPremiumKeys = Object.keys(template).filter((key) => key.startsWith("epub.premium."));

const requiredBookshelfModalKeys = Object.keys(template).filter(
	(key) =>
		key.startsWith("epub.bookshelf.importModal.") ||
		key.startsWith("epub.bookshelf.bookDeleteModal.") ||
		key.startsWith("epub.bookshelf.bookInfoModal.") ||
		key.startsWith("epub.bookshelf.rename.")
);

function assertKeysPresent(overlay: Record<string, string>, keys: string[], label: string): string[] {
	return keys.filter((key) => !overlay[key]).map((key) => `${label} missing required overlay: ${key}`);
}

const issues = [
	...validateCuratedOverlay("ja-JP", jaOverlay, template),
	...validateCuratedOverlay("ko-KR", koOverlay, template),
	...validateCuratedOverlay("ru-RU", ruOverlay, template),
	...assertKeysPresent(jaOverlay, requiredPremiumKeys, "ja-JP"),
	...assertKeysPresent(koOverlay, requiredPremiumKeys, "ko-KR"),
	...assertKeysPresent(ruOverlay, requiredPremiumKeys, "ru-RU"),
	...assertKeysPresent(jaOverlay, requiredBookshelfModalKeys, "ja-JP"),
	...assertKeysPresent(koOverlay, requiredBookshelfModalKeys, "ko-KR"),
	...assertKeysPresent(ruOverlay, requiredBookshelfModalKeys, "ru-RU"),
	...assertOverlayDoesNotCopyChinese(jaOverlay, zhSnapshot, template, "ja-JP"),
	...assertOverlayDoesNotCopyChinese(koOverlay, zhSnapshot, template, "ko-KR"),
	...assertOverlayDoesNotCopyChinese(ruOverlay, zhSnapshot, template, "ru-RU"),
];

const candidates = listCuratedOverlayCandidateKeys(template);
console.log(`Curated candidates: ${candidates.length}`);
console.log(`ja overlay: ${Object.keys(jaOverlay).length}`);
console.log(`ko overlay: ${Object.keys(koOverlay).length}`);
console.log(`ru overlay: ${Object.keys(ruOverlay).length}`);

if (issues.length > 0) {
	console.error(issues.join("\n"));
	process.exit(1);
}

console.log("i18n validation passed");
