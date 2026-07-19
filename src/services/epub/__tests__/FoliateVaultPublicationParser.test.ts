import JSZip from "jszip";
import { TFile } from "obsidian";
import * as blobUrlText from "../../../utils/blob-url-text";
import { FoliateVaultPublicationParser } from "../FoliateVaultPublicationParser";

const { makeBookMock } = vi.hoisted(() => ({
  makeBookMock: vi.fn(),
}));

vi.mock("foliate-js/view.js", () => ({
  makeBook: makeBookMock,
}));

async function createLegacyHtmXhtmlEpubBuffer(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Legacy HTM XHTML</dc:title>
    <dc:creator>Author H</dc:creator>
    <dc:contributor opf:role="trl" xmlns:opf="http://www.idpf.org/2007/opf">Translator T</dc:contributor>
    <dc:publisher>Test Press</dc:publisher>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="BookID">ISBN 978-7-123-45678-9</dc:identifier>
    <dc:description>这是一段用于测试的简介。</dc:description>
    <dc:date>2024-04</dc:date>
    <dc:subject>科幻</dc:subject>
    <dc:subject>经典</dc:subject>
    <dc:rights>All rights reserved</dc:rights>
    <meta name="calibre:series" content="测试系列" />
    <meta name="price" content="¥49.00" />
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="chapter-1" href="Text/00001.htm" media-type="application/xhtml+xml" />
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter-1" />
  </spine>
</package>`
  );
  zip.file(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head></head>
  <docTitle><text>Legacy HTM XHTML</text></docTitle>
  <navMap>
    <navPoint id="np-1" playOrder="1">
      <navLabel><text>Chapter 1</text></navLabel>
      <content src="Text/00001.htm"/>
    </navPoint>
  </navMap>
</ncx>`
  );
  zip.file(
    "OEBPS/Text/00001.htm",
    `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-cn">
<head>
  <meta content="text/html; charset=utf-8" http-equiv="Content-Type"/>
  <title/>
</head>
<body>
  <h1 id="chapter">Chapter 1</h1>
  <p id="para">Selection text for HTM XHTML testing.</p>
</body>
</html>`
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

async function createSampleCbzBuffer(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("001.jpg", "cover");
  zip.file("002.jpg", "page");
  return zip.generateAsync({ type: "arraybuffer" });
}

function createMockApp(binary: ArrayBuffer, filePath = "Books/legacy-htm.epub") {
  const name = filePath.split("/").pop() || "book";
  const extension = name.includes(".") ? name.split(".").pop() || "" : "";
  const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
  const parentPath = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
  const file = Object.assign(Object.create(TFile.prototype), {
    path: filePath,
    name,
    basename,
    extension,
    parent: { path: parentPath },
    stat: {
      size: binary.byteLength,
      mtime: Date.now(),
      ctime: Date.now(),
    },
  });

  return {
    vault: {
      getAbstractFileByPath: () => file,
      readBinary: async () => binary,
    },
  };
}

describe("FoliateVaultPublicationParser", () => {
  afterEach(() => {
    makeBookMock.mockReset();
    vi.restoreAllMocks();
  });

  it("keeps .htm XHTML spine documents valid when OPF declares application/xhtml+xml", async () => {
    let parser: FoliateVaultPublicationParser | null = null;
    try {
      const binary = await createLegacyHtmXhtmlEpubBuffer();
      parser = new FoliateVaultPublicationParser(createMockApp(binary) as any);
      const loaded = await parser.load("Books/legacy-htm.epub");
      const doc = await parser.getBook().sections[0]?.createDocument?.();

      expect(doc).toBeTruthy();
      expect(doc?.querySelector("parsererror")).toBeNull();
      expect(doc?.documentElement.localName).toBe("html");
      expect(doc?.querySelector("#para")?.textContent).toContain(
        "Selection text for HTM XHTML testing."
      );
      expect(loaded.metadata).toMatchObject({
        title: "Legacy HTM XHTML",
        author: "Author H",
        translator: "Translator T",
        publisher: "Test Press",
        language: "zh-CN",
        identifier: "ISBN 978-7-123-45678-9",
        isbn: "9787123456789",
        description: "这是一段用于测试的简介。",
        publishDate: "2024-04",
        subjects: ["科幻", "经典"],
        series: "测试系列",
        rights: "All rights reserved",
        price: "¥49.00",
      });
    } finally {
      parser?.dispose();
    }
  });

  it("routes cbz files through foliate generic makeBook with the comic book MIME type", async () => {
    const binary = await createSampleCbzBuffer();
    const parser = new FoliateVaultPublicationParser(
      createMockApp(binary, "Books/sample.cbz") as any
    );
    const parserAny = parser as any;
    const fakeBook = {
      metadata: {
        title: "Sample CBZ",
        author: "",
      },
      toc: [],
      sections: [],
    };

    makeBookMock.mockResolvedValue(fakeBook);
    vi.spyOn(parserAny, "attachHtmlTransformPipeline").mockImplementation(() => {});
    vi.spyOn(parserAny, "buildMetadata").mockImplementation(() => {
      parserAny.metadata = {
        title: "Sample CBZ",
        author: "",
        chapterCount: 0,
        isFixedLayout: true,
      };
    });
    vi.spyOn(parserAny, "buildTocItems").mockImplementation(() => {
      parserAny.tocItems = [];
    });
    vi.spyOn(parserAny, "buildSectionDescriptors").mockResolvedValue(undefined);
    vi.spyOn(parserAny, "hydrateTocPageNumbers").mockResolvedValue(undefined);
    vi.spyOn(parserAny, "extractCoverDataUrl").mockResolvedValue(null);

    try {
      const loaded = await parser.load("Books/sample.cbz");

      expect(makeBookMock).toHaveBeenCalledTimes(1);
      const [fileArg] = makeBookMock.mock.calls[0] ?? [];
      expect(fileArg).toBeInstanceOf(File);
      expect(fileArg.name).toBe("sample.cbz");
      expect(fileArg.type).toBe("application/vnd.comicbook+zip");
      expect(loaded.fileName).toBe("sample.cbz");
      expect(loaded.metadata.title).toBe("Sample CBZ");
      expect(loaded.book).toBe(fakeBook);
    } finally {
      parser.dispose();
    }
  });

  it("can skip cover extraction during first-paint publication loading", async () => {
    const binary = await createSampleCbzBuffer();
    const parser = new FoliateVaultPublicationParser(
      createMockApp(binary, "Books/sample.cbz") as any
    );
    const parserAny = parser as any;
    const fakeBook = {
      metadata: {
        title: "Sample CBZ",
        author: "",
      },
      toc: [],
      sections: [],
    };

    makeBookMock.mockResolvedValue(fakeBook);
    vi.spyOn(parserAny, "attachHtmlTransformPipeline").mockImplementation(() => {});
    vi.spyOn(parserAny, "buildMetadata").mockImplementation(() => {
      parserAny.metadata = {
        title: "Sample CBZ",
        author: "",
        chapterCount: 0,
        isFixedLayout: true,
      };
    });
    vi.spyOn(parserAny, "buildTocItems").mockImplementation(() => {
      parserAny.tocItems = [];
    });
    vi.spyOn(parserAny, "buildSectionDescriptors").mockResolvedValue(undefined);
    vi.spyOn(parserAny, "hydrateTocPageNumbers").mockResolvedValue(undefined);
    const coverSpy = vi
      .spyOn(parserAny, "extractCoverDataUrl")
      .mockRejectedValue(new Error("cover extraction should be skipped"));

    try {
      const loaded = await parser.load("Books/sample.cbz", { skipCoverImage: true } as any);

      expect(coverSpy).not.toHaveBeenCalled();
      expect(loaded.coverImage).toBeUndefined();
      expect(loaded.metadata.title).toBe("Sample CBZ");
    } finally {
      parser.dispose();
    }
  });

  it("loads generic MOBI sections through section.load so locator DOM matches the reader", async () => {
    const parser = new FoliateVaultPublicationParser({} as any);
    const parserAny = parser as any;
    const createDocument = vi.fn(async () => {
      const doc = document.implementation.createHTMLDocument("draft");
      doc.body.innerHTML = "<p>draft-only</p>";
      return doc;
    });
    const readerMarkup =
      '<html><head><style>blockquote{margin:0}</style></head><body><p id="reader">reader-aligned</p></body></html>';
    const load = vi.fn(async () => "blob:reader-aligned-section");
    const readBlobSpy = vi
      .spyOn(blobUrlText, "readBlobUrlAsText")
      .mockResolvedValue(readerMarkup);
    parserAny.currentBook = {
      sections: [{ id: 0, load, createDocument }],
    };
    parserAny.sectionDescriptors = [{ index: 0, href: "0", title: "Chapter 1" }];

    try {
      const doc = await parserAny.getRawDocumentFromGenericSection(0);

      expect(load).toHaveBeenCalledTimes(1);
      expect(readBlobSpy).toHaveBeenCalledWith("blob:reader-aligned-section");
      expect(createDocument).not.toHaveBeenCalled();
      expect(doc?.querySelector("#reader")?.textContent).toBe("reader-aligned");

      const cached = await parserAny.getRawDocumentFromGenericSection(0);
      expect(load).toHaveBeenCalledTimes(1);
      expect(cached).toBe(doc);
    } finally {
      readBlobSpy.mockRestore();
    }
  });
});
