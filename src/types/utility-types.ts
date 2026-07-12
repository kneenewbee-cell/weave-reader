export function isErrorWithMessage(error: unknown): error is { message: string } {
	return (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof (error as Record<string, unknown>).message === "string"
	);
}

export function extractErrorMessage(error: unknown): string {
	if (typeof error === "string") {
		return error;
	}

	if (isErrorWithMessage(error)) {
		return error.message;
	}

	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof (error as { message?: unknown }).message === "string"
	) {
		return (error as { message: string }).message;
	}

	return "未知错误";
}
