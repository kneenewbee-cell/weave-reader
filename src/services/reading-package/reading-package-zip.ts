import JSZip from "jszip";
import {
	normalizeReadingPackageManifest,
	type ReadingPackageManifestV2,
} from "./reading-package-types";

export function writeReadingPackageManifest(
	zip: JSZip,
	manifest: ReadingPackageManifestV2,
): void {
	zip.file("manifest.json", JSON.stringify(manifest, null, 2));
}

export async function readReadingPackageManifest(
	zip: JSZip,
): Promise<ReadingPackageManifestV2 | null> {
	const text = await zip.file("manifest.json")?.async("string");
	if (!text) {
		return null;
	}
	try {
		return normalizeReadingPackageManifest(JSON.parse(text));
	} catch {
		return null;
	}
}
