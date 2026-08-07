export function formatReadingPackageErrorLogArgs(
	filePath: string,
	error: unknown,
): string[] {
	return [
		`filePath=${filePath}`,
		error instanceof Error ? error.message : String(error),
	];
}
