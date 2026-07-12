import { describe, expect, it } from "vitest";
import {
	buildRemainingReadingEstimate,
	estimateConsumedBookWords,
	hasStableBookWpm,
	normalizeReadingPaceStats,
	PACE_DEFAULT_WPM_ZH,
	recordReadingInterval,
	resolveDefaultWpm,
	resolveEffectiveWpm,
} from "../reading-pace";

const SAMPLE_SECTIONS = [
	{ index: 0, wordCount: 1000, positionStart: 0, positionCount: 10 },
	{ index: 1, wordCount: 2000, positionStart: 10, positionCount: 20 },
	{ index: 2, wordCount: 500, positionStart: 30, positionCount: 5 },
];

describe("reading-pace", () => {
	it("uses language-aware default WPM", () => {
		expect(resolveDefaultWpm("zh-CN")).toBe(PACE_DEFAULT_WPM_ZH);
		expect(resolveDefaultWpm("en-US")).toBe(240);
		expect(resolveDefaultWpm()).toBe(260);
	});

	it("records interval samples and derives book WPM", () => {
		let stats = normalizeReadingPaceStats({});
		for (let index = 0; index < 16; index += 1) {
			stats = recordReadingInterval({
				stats,
				wordsRead: 260,
				activeMs: 60_000,
			});
		}
		expect(hasStableBookWpm(stats)).toBe(true);
		expect(stats.bookWpm).toBeGreaterThanOrEqual(240);
		expect(stats.paceSampleCount).toBe(16);
	});

	it("prefers stable book WPM over legacy average", () => {
		const stats = normalizeReadingPaceStats({
			totalReadTime: 120_000,
			bookWpm: 300,
			paceSampleCount: 20,
			paceSampleWords: 800,
			recentIntervalWpms: [280, 300, 310, 295, 305],
		});
		const wpm = resolveEffectiveWpm(stats, {
			language: "en-US",
			consumedBookWords: 500,
		});
		expect(wpm).toBe(300);
	});

	it("estimates consumed words by section position buckets", () => {
		const consumedAtStart = estimateConsumedBookWords(SAMPLE_SECTIONS, 1, 3500, 0);
		const consumedMid = estimateConsumedBookWords(SAMPLE_SECTIONS, 15, 3500, 0);
		const consumedLate = estimateConsumedBookWords(SAMPLE_SECTIONS, 32, 3500, 0);

		expect(consumedAtStart).toBeLessThan(consumedMid);
		expect(consumedMid).toBeLessThan(consumedLate);
		expect(consumedLate).toBe(3125);
	});

	it("builds remaining time from section-aware word counts", () => {
		const estimate = buildRemainingReadingEstimate({
			totalWordCount: 3500,
			sections: SAMPLE_SECTIONS,
			currentChapterIndex: 1,
			currentPage: 15,
			totalPositions: 35,
			percentFallback: 40,
			sectionProgression: 0.25,
			stats: normalizeReadingPaceStats({
				bookWpm: 300,
				paceSampleCount: 20,
				paceSampleWords: 1000,
			}),
			language: "zh-CN",
		});

		expect(estimate.wordsPerMinute).toBe(300);
		expect(estimate.bookMs).toBeGreaterThan(0);
		expect(estimate.chapterMs).toBeGreaterThan(0);
		expect(estimate.chapterMs || 0).toBeLessThan(estimate.bookMs || 0);
		expect(estimate.chapterProgressPercent).toBeGreaterThan(0);
		expect(estimate.chapterProgressPercent).toBeLessThan(100);
	});
});
