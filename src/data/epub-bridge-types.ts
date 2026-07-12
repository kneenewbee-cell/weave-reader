/**
 * Minimal card/deck shapes shared with the main Weave plugin bridge.
 * Kept intentionally small for the standalone EPUB reader.
 */

export interface Card {
	uuid: string;
	content: string;
	deckId?: string;
	sourceFile?: string;
	customFields?: Record<string, unknown>;
	persistenceSourcePath?: string;
	[key: string]: unknown;
}

export interface Deck {
	id: string;
	name: string;
	purpose?: string;
	[key: string]: unknown;
}

export interface ApiResponse<T> {
	success: boolean;
	data?: T;
	error?: string;
	message?: string;
}

export enum Rating {
	Again = 1,
	Hard = 2,
	Good = 3,
	Easy = 4,
}
