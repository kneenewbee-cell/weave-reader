#!/usr/bin/env python3
"""
Build curated ja/ko/ru overlays from:
1) manual overrides (highest priority)
2) acceptable entries in legacy flat-locales drafts (if present)
3) otherwise omitted so runtime falls back to en-US

Never emits a full 838-key machine translation catalog.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "src/utils/i18n/flat-locales/en-US.template.json"
ZH_SNAPSHOT = ROOT / "scripts/curated-overlay-data/zh-CN.snapshot.json"
OUT_DIR = ROOT / "src/utils/i18n/overlays"
LEGACY_JA = ROOT / "src/utils/i18n/flat-locales/ja-JP.json"
LEGACY_KO = ROOT / "src/utils/i18n/flat-locales/ko-KR.json"
MANUAL_DATA_DIR = ROOT / "scripts/curated-overlay-data"


def load_manual_files(language_code: str) -> dict[str, str]:
	merged: dict[str, str] = {}
	for path in sorted(MANUAL_DATA_DIR.glob(f"manual-{language_code}*.json")):
		merged.update(json.loads(path.read_text(encoding="utf-8")))
	return merged

PREFIXES = [
	"views.",
	"commands.",
	"notifications.",
	"epub.",
]

JA_KANA = re.compile(r"[\u3040-\u30ff]")
KO_HANGUL = re.compile(r"[\uac00-\ud7af]")
RU_CYRILLIC = re.compile(r"[\u0400-\u04FF]")
BROKEN = re.compile(r"GLOSSARY|⟦|__PH_")
JA_SIGNAL = re.compile(
	r"(プレミアム|ライセンス|読書|目次|ブックマーク|脚注|抜粋|無料|有料|機能|閲覧|表示|設定|削除|確認|保存)"
)


def candidate_keys(template: dict[str, str]) -> list[str]:
	return sorted(key for key in template if any(key.startswith(prefix) for prefix in PREFIXES))


def is_acceptable(language: str, value: str, english: str, chinese: str | None = None) -> bool:
	if not value or value == english:
		return False
	if BROKEN.search(value):
		return False
	if language == "ja-JP":
		if chinese and value == chinese:
			return False
		return bool(JA_KANA.search(value)) or bool(JA_SIGNAL.search(value))
	if language == "ru-RU":
		if chinese and value == chinese:
			return False
		return bool(RU_CYRILLIC.search(value))
	if chinese and value == chinese:
		return False
	return bool(KO_HANGUL.search(value))


def load_json(path: Path) -> dict[str, str]:
	if not path.exists():
		return {}
	return json.loads(path.read_text(encoding="utf-8"))


def build_overlay(
	language: str,
	legacy_path: Path,
	manual_code: str,
	template: dict[str, str],
	chinese_template: dict[str, str],
) -> dict[str, str]:
	legacy = load_json(legacy_path)
	manual = load_manual_files(manual_code)
	overlay: dict[str, str] = {}

	for key in candidate_keys(template):
		english = template[key]
		chinese = chinese_template.get(key)
		manual_candidate = manual.get(key)
		if manual_candidate and manual_candidate != english:
			overlay[key] = manual_candidate
			continue
		legacy_candidate = legacy.get(key)
		if legacy_candidate and is_acceptable(language, legacy_candidate, english, chinese):
			overlay[key] = legacy_candidate

	return dict(sorted(overlay.items()))


def main() -> None:
	template = json.loads(TEMPLATE.read_text(encoding="utf-8"))
	if not ZH_SNAPSHOT.exists():
		raise SystemExit(
			"Missing zh-CN.snapshot.json. Run: npm run i18n:export-zh-snapshot"
		)
	chinese_template = json.loads(ZH_SNAPSHOT.read_text(encoding="utf-8"))
	OUT_DIR.mkdir(parents=True, exist_ok=True)

	LEGACY_RU = ROOT / "src/utils/i18n/flat-locales/ru-RU.json"

	ja = build_overlay("ja-JP", LEGACY_JA, "ja", template, chinese_template)
	ko = build_overlay("ko-KR", LEGACY_KO, "ko", template, chinese_template)
	ru = build_overlay("ru-RU", LEGACY_RU, "ru", template, chinese_template)

	(OUT_DIR / "ja-JP.json").write_text(json.dumps(ja, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
	(OUT_DIR / "ko-KR.json").write_text(json.dumps(ko, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
	(OUT_DIR / "ru-RU.json").write_text(json.dumps(ru, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

	required = candidate_keys(template)
	print(f"template curated candidates: {len(required)}")
	print(f"ja overlay: {len(ja)} ({len(ja) / len(required) * 100:.1f}% coverage)")
	print(f"ko overlay: {len(ko)} ({len(ko) / len(required) * 100:.1f}% coverage)")
	print(f"ru overlay: {len(ru)} ({len(ru) / len(required) * 100:.1f}% coverage)")


if __name__ == "__main__":
	main()
