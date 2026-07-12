import type { ReaderHighlight } from "./reader-engine-types";

export type EpubAnnotationUndoPatch =
	| {
			kind: "delete";
			bookId: string;
			highlight: ReaderHighlight;
	  }
	| {
			kind: "restore";
			bookId: string;
			highlight: ReaderHighlight;
	  }
	| {
			kind: "replace";
			bookId: string;
			before: ReaderHighlight;
			after: ReaderHighlight;
	  };

type EpubAnnotationUndoEntry =
	| {
			kind: "create";
			bookId: string;
			highlight: ReaderHighlight;
	  }
	| {
			kind: "delete";
			bookId: string;
			highlight: ReaderHighlight;
	  }
	| {
			kind: "update";
			bookId: string;
			before: ReaderHighlight;
			after: ReaderHighlight;
	  };

const DEFAULT_MAX_DEPTH = 50;

function cloneHighlight(highlight: ReaderHighlight): ReaderHighlight {
	const sourceLocators = Array.isArray(highlight.sourceLocators)
		? highlight.sourceLocators.map((locator) => ({ ...locator }))
		: undefined;
	return {
		...highlight,
		...(sourceLocators ? { sourceLocators } : {}),
	};
}

export class EpubAnnotationUndoStack {
	private readonly maxDepth: number;
	private entries: EpubAnnotationUndoEntry[] = [];

	constructor(maxDepth = DEFAULT_MAX_DEPTH) {
		this.maxDepth = Math.max(1, Math.floor(maxDepth));
	}

	canUndo(): boolean {
		return this.entries.length > 0;
	}

	clear(): void {
		this.entries = [];
	}

	pushCreate(bookId: string, highlight: ReaderHighlight): void {
		this.push({
			kind: "create",
			bookId,
			highlight: cloneHighlight(highlight),
		});
	}

	pushDelete(bookId: string, highlight: ReaderHighlight): void {
		this.push({
			kind: "delete",
			bookId,
			highlight: cloneHighlight(highlight),
		});
	}

	pushUpdate(bookId: string, before: ReaderHighlight, after: ReaderHighlight): void {
		this.push({
			kind: "update",
			bookId,
			before: cloneHighlight(before),
			after: cloneHighlight(after),
		});
	}

	undo(): EpubAnnotationUndoPatch | null {
		const entry = this.entries.pop();
		if (!entry) {
			return null;
		}
		if (entry.kind === "create") {
			return {
				kind: "delete",
				bookId: entry.bookId,
				highlight: cloneHighlight(entry.highlight),
			};
		}
		if (entry.kind === "delete") {
			return {
				kind: "restore",
				bookId: entry.bookId,
				highlight: cloneHighlight(entry.highlight),
			};
		}
		return {
			kind: "replace",
			bookId: entry.bookId,
			before: cloneHighlight(entry.after),
			after: cloneHighlight(entry.before),
		};
	}

	private push(entry: EpubAnnotationUndoEntry): void {
		this.entries.push(entry);
		if (this.entries.length > this.maxDepth) {
			this.entries.shift();
		}
	}
}
