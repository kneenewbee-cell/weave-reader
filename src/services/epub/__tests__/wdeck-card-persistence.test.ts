import { describe, expect, it } from "vitest";
import {
	ensureWDeckPersistenceMeta,
	readWDeckPersistenceSourcePath,
} from "../../../utils/wdeck-card-persistence";

describe("wdeck-card-persistence", () => {
	it("reads persistence path from customFields.wdeck.sourcePath", () => {
		expect(
			readWDeckPersistenceSourcePath({
				sourceFile: "Books/demo.epub",
				customFields: {
					wdeck: { sourcePath: "weave/memory/deck-files/demo_01.wdeck" },
				},
			})
		).toBe("weave/memory/deck-files/demo_01.wdeck");
	});

	it("ensures wdeck sourcePath without replacing epub semantic sourceFile", () => {
		const prepared = ensureWDeckPersistenceMeta(
			{
				uuid: "card-1",
				sourceFile: "Books/demo.epub",
			},
			"weave/memory/deck-files/demo_01.wdeck"
		);
		const preparedWithMeta = prepared as typeof prepared & {
			customFields?: { wdeck?: { sourcePath?: string } };
		};

		expect(prepared.sourceFile).toBe("Books/demo.epub");
		expect(preparedWithMeta.customFields?.wdeck?.sourcePath).toBe(
			"weave/memory/deck-files/demo_01.wdeck"
		);
	});
});
