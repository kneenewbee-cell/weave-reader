import type { TranslationKey } from "./types";

export function flattenTranslationLeafKeys(
	tree: TranslationKey,
	prefix = ""
): Record<string, string> {
	const flat: Record<string, string> = {};

	for (const [key, value] of Object.entries(tree)) {
		const nextKey = prefix ? `${prefix}.${key}` : key;
		if (typeof value === "string") {
			flat[nextKey] = value;
			continue;
		}
		if (value && typeof value === "object" && !Array.isArray(value)) {
			Object.assign(flat, flattenTranslationLeafKeys(value, nextKey));
		}
	}

	return flat;
}

export function unflattenTranslationLeafKeys(flat: Record<string, string>): TranslationKey {
	const root: TranslationKey = {};

	for (const [key, value] of Object.entries(flat)) {
		const parts = key.split(".").filter(Boolean);
		if (parts.length === 0) {
			continue;
		}

		let current: TranslationKey = root;
		for (let index = 0; index < parts.length - 1; index += 1) {
			const part = parts[index];
			const existing = current[part];
			if (!existing || typeof existing === "string") {
				current[part] = {};
			}
			current = current[part] as TranslationKey;
		}

		current[parts.at(-1)!] = value;
	}

	return root;
}

export function mergeFlatLocaleOverlay(
	base: TranslationKey,
	flatOverlay: Record<string, string>
): TranslationKey {
	const overlayTree = unflattenTranslationLeafKeys(flatOverlay);
	return mergeTranslationTrees(base, overlayTree);
}

export function mergeTranslationTrees(base: TranslationKey, override?: TranslationKey): TranslationKey {
	if (!override) {
		return { ...base };
	}

	const merged: TranslationKey = { ...base };

	for (const [key, overrideValue] of Object.entries(override)) {
		const baseValue = merged[key];

		if (
			baseValue &&
			typeof baseValue === "object" &&
			!Array.isArray(baseValue) &&
			overrideValue &&
			typeof overrideValue === "object" &&
			!Array.isArray(overrideValue)
		) {
			merged[key] = mergeTranslationTrees(baseValue, overrideValue);
			continue;
		}

		merged[key] = overrideValue;
	}

	return merged;
}
