import type { App } from "obsidian";
import { FoliateReaderService } from "./FoliateReaderService";
import type { EpubReaderEngine, EpubReaderEngineType } from "./reader-engine-types";

export const DEFAULT_EPUB_READER_ENGINE: EpubReaderEngineType = "foliate";

export function createEpubReaderEngine(
	app: App,
	_engineType: EpubReaderEngineType = DEFAULT_EPUB_READER_ENGINE
): EpubReaderEngine {
	return new FoliateReaderService(app);
}
