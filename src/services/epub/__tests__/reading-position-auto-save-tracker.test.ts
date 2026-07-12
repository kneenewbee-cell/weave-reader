import { describe, expect, it } from "vitest";
import {
	advanceReadingPositionAutoSaveTracker,
	createReadingPositionAutoSaveTrackerState,
} from "../reading-position-auto-save-tracker";

describe("reading-position-auto-save-tracker", () => {
	it("persists after visiting the configured number of continuous pages", () => {
		let state = createReadingPositionAutoSaveTrackerState("book-1", 10);
		let persisted = false;

		for (const page of [11, 12, 13, 14, 15]) {
			const result = advanceReadingPositionAutoSaveTracker(state, {
				bookId: "book-1",
				currentPage: page,
				enabled: true,
				pages: 5,
			});
			state = result.nextState;
			persisted = result.shouldPersist;
		}

		expect(persisted).toBe(true);
		expect(state).toEqual(createReadingPositionAutoSaveTrackerState("book-1", 15));
	});

	it("does not treat a large jump as continuous reading", () => {
		const initialState = createReadingPositionAutoSaveTrackerState("book-1", 10);
		const result = advanceReadingPositionAutoSaveTracker(initialState, {
			bookId: "book-1",
			currentPage: 40,
			enabled: true,
			pages: 5,
		});

		expect(result.shouldPersist).toBe(false);
		expect(result.nextState).toEqual(createReadingPositionAutoSaveTrackerState("book-1", 40));
	});

	it("does not overcount repeated back-and-forth visits to the same pages", () => {
		let state = createReadingPositionAutoSaveTrackerState("book-1", 10);
		let persisted = false;

		for (const page of [11, 10, 11, 10, 11, 10]) {
			const result = advanceReadingPositionAutoSaveTracker(state, {
				bookId: "book-1",
				currentPage: page,
				enabled: true,
				pages: 5,
			});
			state = result.nextState;
			persisted = result.shouldPersist;
		}

		expect(persisted).toBe(false);
		expect(state.visitedPagesSinceSave).toEqual([10, 11]);
	});

	it("updates tracking without persisting when auto-save is disabled", () => {
		const initialState = createReadingPositionAutoSaveTrackerState("book-1", 10);
		const result = advanceReadingPositionAutoSaveTracker(initialState, {
			bookId: "book-1",
			currentPage: 11,
			enabled: false,
			pages: 5,
		});

		expect(result.shouldPersist).toBe(false);
		expect(result.nextState.lastObservedPage).toBe(11);
		expect(result.nextState.visitedPagesSinceSave).toEqual([10]);
	});
});
