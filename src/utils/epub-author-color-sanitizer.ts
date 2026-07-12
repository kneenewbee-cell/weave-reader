const INLINE_AUTHOR_COLOR_PATTERN =
	/\b(?:color|background-color|-webkit-text-fill-color)\s*:\s*[^;]+;?|\bbackground\s*:\s*(?!(?:url|linear-gradient|radial-gradient|conic-gradient|repeating-))[^;]+;?/gi;

const AUTHOR_COLOR_DECLARATION_PATTERN =
	/\b(?:color|background-color|-webkit-text-fill-color)\s*:\s*[^;]+;?|\bbackground\s*:\s*(?!(?:url|linear-gradient|radial-gradient|conic-gradient|repeating-))[^;]+;?/gi;

export function stripInlineAuthorColorStyles(styleValue: string): string {
	return String(styleValue || "")
		.replace(INLINE_AUTHOR_COLOR_PATTERN, "")
		.replace(/\s{2,}/g, " ")
		.replace(/;\s*;/g, ";")
		.replace(/^\s*;\s*|\s*;\s*$/g, "")
		.trim();
}

function stripDeclarationsFromLeafBlock(declarations: string): string {
	return declarations.replace(AUTHOR_COLOR_DECLARATION_PATTERN, "").trim();
}

export function stripAuthorColorDeclarations(cssText: string): string {
	let result = "";
	let index = 0;
	const source = String(cssText || "");

	while (index < source.length) {
		const openBrace = source.indexOf("{", index);
		if (openBrace === -1) {
			result += source.slice(index);
			break;
		}

		result += source.slice(index, openBrace + 1);
		let depth = 1;
		let cursor = openBrace + 1;
		while (cursor < source.length && depth > 0) {
			const char = source[cursor];
			if (char === "{") {
				depth += 1;
			} else if (char === "}") {
				depth -= 1;
			}
			cursor += 1;
		}

		if (depth !== 0) {
			result += source.slice(openBrace + 1);
			break;
		}

		const inner = source.slice(openBrace + 1, cursor - 1);
		if (inner.includes("{")) {
			result += stripAuthorColorDeclarations(inner);
		} else {
			const stripped = stripDeclarationsFromLeafBlock(inner);
			if (stripped) {
				result += stripped;
			}
		}
		result += "}";
		index = cursor;
	}

	return result;
}

export function sanitizeLegacyAuthorColorAttributes(root: ParentNode): void {
	for (const element of Array.from(root.querySelectorAll("[bgcolor], [color]"))) {
		element.removeAttribute("bgcolor");
		element.removeAttribute("color");
	}

	for (const fontElement of Array.from(root.querySelectorAll("font[color]"))) {
		fontElement.removeAttribute("color");
	}
}
