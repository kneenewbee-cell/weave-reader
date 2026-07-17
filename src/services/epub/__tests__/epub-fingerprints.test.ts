import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { computeEpubFingerprints } from "../epub-fingerprints";

async function createTestEpub(options: {
	chapterHtml: string;
	styleCss?: string;
	comment?: string;
	addOrder?: "normal" | "reverse";
}): Promise<ArrayBuffer> {
	const zip = new JSZip();
	const entries: Array<[string, string]> = [
		[
			"mimetype",
			"application/epub+zip",
		],
		[
			"META-INF/container.xml",
			`<?xml version="1.0"?>
			<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
				<rootfiles>
					<rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
				</rootfiles>
			</container>`,
		],
		[
			"OPS/content.opf",
			`<?xml version="1.0"?>
			<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
				<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
					<dc:title>Fingerprint Demo</dc:title>
					<dc:language>en</dc:language>
					<dc:identifier id="bookid">urn:uuid:fingerprint-demo</dc:identifier>
				</metadata>
				<manifest>
					<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" />
					<item id="style" href="style.css" media-type="text/css" />
				</manifest>
				<spine>
					<itemref idref="chapter" />
				</spine>
			</package>`,
		],
		[
			"OPS/chapter.xhtml",
			options.chapterHtml,
		],
		[
			"OPS/style.css",
			options.styleCss || "body { color: black; }",
		],
	];
	for (const [name, content] of options.addOrder === "reverse" ? entries.reverse() : entries) {
		zip.file(name, content);
	}
	return await zip.generateAsync({
		type: "arraybuffer",
		comment: options.comment,
	});
}

describe("epub-fingerprints", () => {
	it("keeps package and content fingerprints stable when the zip container changes", async () => {
		const chapterHtml = `<html><body><p>Hello world.</p><p>Second paragraph.</p></body></html>`;
		const first = await computeEpubFingerprints(
			await createTestEpub({ chapterHtml, addOrder: "normal" })
		);
		const repacked = await computeEpubFingerprints(
			await createTestEpub({ chapterHtml, addOrder: "reverse", comment: "different zip shell" })
		);

		expect(repacked.fileFingerprint).not.toBe(first.fileFingerprint);
		expect(repacked.packageFingerprint).toBe(first.packageFingerprint);
		expect(repacked.contentFingerprint).toBe(first.contentFingerprint);
	});

	it("changes the package fingerprint but not the content fingerprint for non-text asset changes", async () => {
		const chapterHtml = `<html><body><p>Hello world.</p><p>Second paragraph.</p></body></html>`;
		const first = await computeEpubFingerprints(
			await createTestEpub({ chapterHtml, styleCss: "body { color: black; }" })
		);
		const restyled = await computeEpubFingerprints(
			await createTestEpub({ chapterHtml, styleCss: "body { color: blue; }" })
		);

		expect(restyled.fileFingerprint).not.toBe(first.fileFingerprint);
		expect(restyled.packageFingerprint).not.toBe(first.packageFingerprint);
		expect(restyled.contentFingerprint).toBe(first.contentFingerprint);
	});

	it("normalizes visible spine text for the content fingerprint", async () => {
		const first = await computeEpubFingerprints(
			await createTestEpub({
				chapterHtml: `<html><body><p>Hello <strong>world</strong>.</p><p>Second paragraph.</p></body></html>`,
			})
		);
		const remarked = await computeEpubFingerprints(
			await createTestEpub({
				chapterHtml: `<html><body><div>Hello    world.</div><section>Second\nparagraph.</section></body></html>`,
			})
		);

		expect(remarked.packageFingerprint).not.toBe(first.packageFingerprint);
		expect(remarked.contentFingerprint).toBe(first.contentFingerprint);
	});
});
