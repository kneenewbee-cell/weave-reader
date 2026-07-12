import { errorPlainText } from "../../utils/unknown-plain-text";

export interface EpubLocalReaderDataSkeleton {
	version: 1;
	updatedAt: number;
	bookCatalogStoredLocally?: boolean;
	readerSettings?: Record<string, unknown>;
	canvasBindings?: Record<string, string>;
	books?: Record<string, unknown>;
}

export function createEmptyEpubLocalReaderData(): EpubLocalReaderDataSkeleton {
	return {
		version: 1,
		updatedAt: 0,
		bookCatalogStoredLocally: false,
		readerSettings: {},
		canvasBindings: {},
		books: {},
	};
}

export function cloneEpubLocalReaderData<T>(data: T): T {
	return JSON.parse(JSON.stringify(data)) as T;
}

export function isDestinationFileAlreadyExistsError(error: unknown): boolean {
	const message =
		typeof error === "object" && error && "message" in error
			? errorPlainText((error as { message?: unknown }).message)
			: errorPlainText(error);
	return /destination file already exists/i.test(message);
}
