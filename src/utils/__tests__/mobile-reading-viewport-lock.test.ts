import { resolveReadingViewportLockTarget } from '../mobile-reading-viewport-lock';

describe('resolveReadingViewportLockTarget', () => {
	it('prefers the epub leaf view-content over inner shell', () => {
		const leaf = document.createElement('div');
		leaf.className = 'workspace-leaf-content';
		leaf.setAttribute('data-type', 'weave-epub-reader');

		const viewContent = document.createElement('div');
		viewContent.className = 'view-content';
		const shell = document.createElement('div');
		shell.className = 'weave-epub-view-shell';
		const root = document.createElement('div');
		root.className = 'epub-reader-root';

		leaf.appendChild(viewContent);
		viewContent.appendChild(shell);
		shell.appendChild(root);
		document.body.appendChild(leaf);

		expect(resolveReadingViewportLockTarget(root)).toBe(viewContent);

		leaf.remove();
	});
});
