import { describe, expect, it } from 'vitest';
import {
	CANVAS_TEXT_NODE_MAX_HEIGHT,
	CANVAS_TEXT_NODE_MAX_WIDTH,
	CANVAS_TEXT_NODE_MIN_HEIGHT,
	CANVAS_TEXT_NODE_MIN_WIDTH,
	estimateCanvasTextNodeSize,
	measureCanvasTextVisualLength,
	stripCanvasMarkdownLinePrefix,
} from '../canvas-text-node-size';

describe('canvas-text-node-size', () => {
	it('strips canvas quote prefixes before measuring', () => {
		expect(stripCanvasMarkdownLinePrefix('> [!EPUB] [[Book.epub#cfi|Quote]]')).toBe(
			'[!EPUB] [[Book.epub#cfi|Quote]]'
		);
	});

	it('weights cjk characters more heavily than latin text', () => {
		expect(measureCanvasTextVisualLength('abc')).toBe(3);
		expect(measureCanvasTextVisualLength('中文')).toBe(4);
	});

	it('returns default size for empty content', () => {
		expect(estimateCanvasTextNodeSize('')).toEqual({ width: 300, height: 120 });
	});

	it('grows height for multi-line excerpt content', () => {
		const short = estimateCanvasTextNodeSize('> [!EPUB] [[Book.epub#cfi|Short]]\n> One line');
		const long = estimateCanvasTextNodeSize(
			'> [!EPUB] [[Book.epub#cfi|Long]]\n> Line one\n> Line two\n> Line three'
		);
		expect(short.height).toBeGreaterThanOrEqual(CANVAS_TEXT_NODE_MIN_HEIGHT);
		expect(long.height).toBeGreaterThan(short.height);
	});

	it('widens nodes for long single-line titles within max width', () => {
		const size = estimateCanvasTextNodeSize(
			'> [!EPUB] [[Book.epub#cfi|This is a much longer callout title that should widen the card]]\n> Body'
		);
		expect(size.width).toBeGreaterThan(CANVAS_TEXT_NODE_MIN_WIDTH);
		expect(size.width).toBeLessThanOrEqual(CANVAS_TEXT_NODE_MAX_WIDTH);
	});

	it('caps extremely long excerpts at max height', () => {
		const body = Array.from({ length: 80 }, (_item, index) => `> Paragraph ${index}`).join('\n');
		const size = estimateCanvasTextNodeSize(`> [!EPUB] [[Book.epub#cfi|Huge]]\n${body}`);
		expect(size.height).toBe(CANVAS_TEXT_NODE_MAX_HEIGHT);
	});
});
