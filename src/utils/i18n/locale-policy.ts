import type { SupportedLanguage } from "./types";

/** Keys that must have a curated ja/ko/ru overlay (never rely on accidental MT). */
export const CURATED_OVERLAY_REQUIRED_PREFIXES = [
	"views.",
	"commands.",
	"notifications.",
	"epub.",
] as const;

const CHINESE_CHAR_PATTERN = /[\u3400-\u9fff]/;
const JAPANESE_KANA_PATTERN = /[\u3040-\u30ff]/;
const KOREAN_HANGUL_PATTERN = /[\uac00-\ud7af]/;
const RUSSIAN_CYRILLIC_PATTERN = /[\u0400-\u04FF]/;

export type CuratedOverlayLanguage = "ja-JP" | "ko-KR" | "ru-RU";

export function listCuratedOverlayCandidateKeys(template: Record<string, string>): string[] {
	return Object.keys(template)
		.filter((key) =>
			CURATED_OVERLAY_REQUIRED_PREFIXES.some((prefix) => key.startsWith(prefix))
		)
		.sort();
}

export function isCuratedOverlayKey(key: string): boolean {
	return CURATED_OVERLAY_REQUIRED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function containsChineseCharacters(value: string): boolean {
	return CHINESE_CHAR_PATTERN.test(value);
}

export function isAcceptableCuratedTranslation(
	language: CuratedOverlayLanguage,
	value: string,
	english: string,
	chinese?: string
): boolean {
	const trimmed = value.trim();
	if (!trimmed || trimmed === english) {
		return false;
	}
	if (/GLOSSARY|⟦|__PH_/.test(trimmed)) {
		return false;
	}

	if (language === "ja-JP") {
		if (chinese && trimmed === chinese) {
			return false;
		}
		// Curated Japanese may be kanji-heavy; never accept unchanged English.
		if (JAPANESE_KANA_PATTERN.test(trimmed) || hasJapaneseTypographicSignals(trimmed)) {
			return true;
		}
		return !/^[A-Za-z0-9\s\p{P}]+$/u.test(trimmed);
	}

	if (language === "ru-RU") {
		if (chinese && trimmed === chinese) {
			return false;
		}
		return RUSSIAN_CYRILLIC_PATTERN.test(trimmed);
	}

	if (containsChineseCharacters(trimmed) && !KOREAN_HANGUL_PATTERN.test(trimmed)) {
		return false;
	}
	if (chinese && trimmed === chinese) {
		return false;
	}

	return KOREAN_HANGUL_PATTERN.test(trimmed);
}

function hasJapaneseTypographicSignals(value: string): boolean {
	// Allow brand/product names that are intentionally Latin-only in Japanese UI copy.
	return /(プレミアム|ライセンス|読書|目次|ブックマーク|脚注|抜粋|有効|無効|無料|機能|閲覧|表示|設定|削除|確認|保存|著者|訳者|出版|説明|価格|主題|章|文字|形式|詳細|統計|追加|変更|キャンセル)/.test(
		value
	);
}

export function validateCuratedOverlay(
	language: CuratedOverlayLanguage,
	overlay: Record<string, string>,
	englishTemplate: Record<string, string>
): string[] {
	const issues: string[] = [];

	for (const key of listCuratedOverlayCandidateKeys(englishTemplate)) {
		const english = englishTemplate[key];
		const localized = overlay[key];
		if (!localized) {
			continue;
		}
		if (!isAcceptableCuratedTranslation(language, localized, english)) {
			issues.push(`${key}: rejected curated value "${localized}"`);
		}
	}

	for (const [key, localized] of Object.entries(overlay)) {
		if (!isCuratedOverlayKey(key)) {
			issues.push(`${key}: overlay key is outside curated prefixes`);
			continue;
		}
		const english = englishTemplate[key];
		if (!english) {
			issues.push(`${key}: unknown template key`);
			continue;
		}
		if (!localized) {
			issues.push(`${key}: empty overlay value`);
		}
	}

	return issues;
}

export function assertOverlayDoesNotCopyChinese(
	overlay: Record<string, string>,
	chineseTemplate: Record<string, string>,
	englishTemplate: Record<string, string>,
	language: SupportedLanguage
): string[] {
	return Object.entries(overlay)
		.filter(([key, value]) => {
			const chinese = chineseTemplate[key];
			const english = englishTemplate[key];
			if (!chinese || !english || chinese === english || value !== chinese) {
				return false;
			}
			if (language === "ja-JP") {
				return (
					!JAPANESE_KANA_PATTERN.test(value) && !hasJapaneseTypographicSignals(value)
				);
			}
			if (language === "ru-RU") {
				return !RUSSIAN_CYRILLIC_PATTERN.test(value);
			}
			return true;
		})
		.map(([key]) => `${language}:${key} copies zh-CN instead of a real translation`);
}
