import {
	computeKeyboardAnchoredFixedRect,
	detectKeyboardVisible,
	getVisualViewportLayout,
	MOBILE_KEYBOARD_THRESHOLD,
} from '../mobile-floating-viewport';

describe('mobile-floating-viewport', () => {
	it('detects keyboard visibility from layout vs visual viewport height', () => {
		expect(detectKeyboardVisible(700, 820)).toBe(false);
		expect(detectKeyboardVisible(420, 900, MOBILE_KEYBOARD_THRESHOLD)).toBe(true);
	});

	it('anchors fixed popover to the bottom of the visual viewport', () => {
		Object.defineProperty(window, 'innerHeight', {
			configurable: true,
			value: 900,
		});
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: {
				height: 420,
				width: 390,
				offsetTop: 24,
				offsetLeft: 0,
				addEventListener: () => {},
				removeEventListener: () => {},
			},
		});

		const layout = getVisualViewportLayout();
		expect(layout.keyboardVisible).toBe(true);

		const rect = computeKeyboardAnchoredFixedRect(180, 12, layout);
		expect(rect).toEqual({
			top: 252,
			left: 12,
			width: 366,
		});
	});
});
