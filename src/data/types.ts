export type { ApiResponse, Card, Deck, Rating } from "./epub-bridge-types";
export { Rating as CardRating } from "./epub-bridge-types";

export interface CardFsrsState {
	state?: number;
	due?: string;
}

export interface CardTestStats {
	accuracy?: number;
	totalAttempts?: number;
	incorrectAttempts?: number;
	isInErrorBook?: boolean;
}

/** Card fields used by bookshelf / notes search matching. */
export interface SearchableCard {
	tags?: string[];
	content?: string;
	priority?: number;
	sourceFile?: string;
	fsrs?: CardFsrsState;
	ir_state?: string;
	scheduleStatus?: string;
	stats?: { testStats?: CardTestStats };
	created?: string;
	modified?: string;
}

export function asSearchableCard(value: unknown): SearchableCard | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	return value;
}
