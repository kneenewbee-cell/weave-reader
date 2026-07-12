import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mountSpy,
	unmountSpy,
	resolveRecentEpubPathMock,
	noticeSpy,
} = vi.hoisted(() => ({
	mountSpy: vi.fn(() => ({})),
	unmountSpy: vi.fn(),
	resolveRecentEpubPathMock: vi.fn<[], Promise<string | null>>(),
	noticeSpy: vi.fn(),
}));

function enhanceDiv<T extends HTMLDivElement>(div: T) {
	const el = div as T & {
		empty: () => void;
		addClass: (...classes: string[]) => void;
		createDiv: (options?: string | { cls?: string | string[]; text?: string | DocumentFragment }) => HTMLDivElement;
	};
	el.empty = () => {
		el.innerHTML = '';
	};
	el.addClass = (...classes: string[]) => {
		el.classList.add(...classes);
	};
	el.createDiv = (options) => {
		const child = enhanceDiv(document.createElement('div'));
		if (typeof options === 'string') {
			child.className = options;
		} else if (options) {
			if (options.cls) {
				child.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
			}
			if (options.text) {
				if (typeof options.text === 'string') {
					child.textContent = options.text;
				} else {
					child.appendChild(options.text);
				}
			}
		}
		el.appendChild(child);
		return child;
	};
	return el;
}

vi.mock('svelte', () => ({
	mount: mountSpy,
	unmount: unmountSpy,
	untrack: <T>(fn: () => T) => fn(),
}));

vi.mock('../components/epub/BookshelfView.svelte', () => ({
	default: {},
}));

vi.mock('../utils/epub-leaf-utils', () => ({
	resolveRecentEpubPath: resolveRecentEpubPathMock,
}));

vi.mock('../services/epub', () => ({
	EPUB_RUNTIME: {
		viewTypes: {
			bookshelfSidebar: 'weave-epub-bookshelf-sidebar',
		},
	},
}));

vi.mock('../utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	},
}));

vi.mock('../utils/view-location-utils', () => ({
	getViewSurfaceTokens: () => ({
		context: 'center',
		surfaceBackground: 'var(--background-primary)',
		elevatedBackground: 'var(--background-secondary)',
	}),
}));

vi.mock('./EpubSidebarView', () => ({
	VIEW_TYPE_EPUB_SIDEBAR: 'weave-epub-sidebar',
}));

vi.mock('obsidian', () => {
	class ItemView {
		public leaf: unknown;
		public app: any;
		public contentEl = enhanceDiv(document.createElement('div'));

		constructor(leaf: any) {
			this.leaf = leaf;
			this.app = leaf.app;
		}
	}

	class Notice {
		constructor(message: string) {
			noticeSpy(message);
		}
	}

	return {
		ItemView,
		Notice,
		WorkspaceLeaf: class {},
	};
});

import { EpubBookshelfSidebarView } from './EpubBookshelfSidebarView';
import { currentLanguage, i18n, initI18n } from '../utils/i18n';

describe('EpubBookshelfSidebarView', () => {
	beforeEach(() => {
		initI18n();
		currentLanguage.set('zh-CN');
	});

	afterEach(() => {
		mountSpy.mockClear();
		unmountSpy.mockClear();
		resolveRecentEpubPathMock.mockReset();
		noticeSpy.mockClear();
	});

	it('keeps close and back actions semantically separated', async () => {
		resolveRecentEpubPathMock.mockResolvedValue('Books/recent.epub');
		const revealLeaf = vi.fn();
		const setViewState = vi.fn(async () => undefined);
		const leaf = {
			app: {
				workspace: {
					on: vi.fn(() => ({ id: 'layout-change-ref' })),
					offref: vi.fn(),
					revealLeaf,
				},
			},
			setViewState,
		};
		const plugin = {
			app: leaf.app,
			openEpubReader: vi.fn(async () => undefined),
		};
		const view = new EpubBookshelfSidebarView(leaf as any, plugin as any);

		await view.onOpen();

		expect(mountSpy).toHaveBeenCalledTimes(1);
		const mountCall = mountSpy.mock.calls[0] as unknown as [unknown, {
			props: {
				onClose?: () => Promise<void> | void;
				onBack?: () => Promise<void> | void;
			};
		}];
		const props = mountCall[1].props;

		await props.onClose?.();
		expect(setViewState).toHaveBeenCalledWith({
			type: 'weave-epub-sidebar',
			active: true,
		});
		expect(plugin.openEpubReader).not.toHaveBeenCalled();

		setViewState.mockClear();
		revealLeaf.mockClear();

		await props.onBack?.();
		expect(setViewState).toHaveBeenCalledWith({
			type: 'weave-epub-sidebar',
			active: true,
		});
		expect(plugin.openEpubReader).toHaveBeenCalledWith('Books/recent.epub');
		expect(setViewState.mock.invocationCallOrder[0]).toBeLessThan(
			plugin.openEpubReader.mock.invocationCallOrder[0]
		);
	});

	it('shows a notice when there is no recent book to return to', async () => {
		resolveRecentEpubPathMock.mockResolvedValue(null);
		const leaf = {
			app: {
				workspace: {
					on: vi.fn(() => ({ id: 'layout-change-ref' })),
					offref: vi.fn(),
					revealLeaf: vi.fn(),
				},
			},
			setViewState: vi.fn(async () => undefined),
		};
		const plugin = {
			app: leaf.app,
			openEpubReader: vi.fn(async () => undefined),
		};
		const view = new EpubBookshelfSidebarView(leaf as any, plugin as any);

		await view.onOpen();
		const mountCall = mountSpy.mock.calls[0] as unknown as [unknown, {
			props: {
				onBack?: () => Promise<void> | void;
			};
		}];

		await mountCall[1].props.onBack?.();
		expect(plugin.openEpubReader).not.toHaveBeenCalled();
		expect(noticeSpy).toHaveBeenCalledWith(i18n.t('views.epubView.notice.noRecentBook'));
	});
});
