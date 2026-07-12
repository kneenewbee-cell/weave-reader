/** Safe filename for vault export paths (strip OS-forbidden characters). */
export function sanitizeExportFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\.md$/, "");
}
