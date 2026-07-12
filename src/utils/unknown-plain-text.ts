/**
 * Coerce unknown values (YAML, JSON, API payloads) to plain text without `[object Object]`.
 */
export function unknownPlainText(value: unknown, fallback = ""): string {
	if (value === null || value === undefined) {
		return fallback;
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value.map((item) => unknownPlainText(item)).join(" ");
	}
	try {
		return JSON.stringify(value);
	} catch {
		return fallback;
	}
}

export function errorPlainText(error: unknown, fallback = ""): string {
	if (error instanceof Error) {
		return error.message;
	}
	return unknownPlainText(error, fallback);
}
