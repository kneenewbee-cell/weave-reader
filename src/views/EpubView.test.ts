import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREMIUM_FEATURES } from '../services/premium/PremiumFeatureGuard';

const { mountSpy, unmountSpy } = vi.hoisted(() => ({
	mountSpy: vi.fn(() => ({})),
	unmountSpy: vi.fn(),
}));

function enhanceDiv<T extends HTMLDivElement>(div: T) {
	const el = div as T & {
		empty: () => void;
		addClass: (...classes: string[]) => void;
		toggleClass: (name: string, force?: boolean) => void;
		createDiv: (options?: string | { cls?: string | string[]; text?: string | DocumentFragment }) => HTMLDivElement;
	};
	el.empty = () => {
		el.innerHTML = '';
	};
	el.addClass = (...classes: string[]) => {
		el.classList.add(...classes);
	};
	el.toggleClass = (name: string, force?: boolean) => {
		el.classList.toggle(name, force);
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

vi.mock('../components/epub/EpubReaderApp.svelte', () => ({
	default: {},
}));

vi.mock('../services/epub/epub-error', () => ({
	reportEpubError: () => ({ userMessage: 'EPUB 打开失败' }),
}));

vi.mock('../utils/epub-leaf-utils', () => ({
	resolveRecentEpubPath: vi.fn(),
}));

vi.mock('../utils/i18n', () => ({
	i18n: {
		t: (key: string) => key,
	},
}));

vi.mock('../utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	},
}));

vi.mock('./EpubSidebarView', () => ({
	VIEW_TYPE_EPUB_SIDEBAR: 'weave-epub-sidebar',
}));

vi.mock('obsidian', () => {
	class Scope {
		private handlers = new Set<object>();

		register(): object {
			const handler = {};
			this.handlers.add(handler);
			return handler;
		}

		unregister(handler: object): void {
			this.handlers.delete(handler);
		}

		getHandlerCount(): number {
			return this.handlers.size;
		}
	}

	class ItemView {
		public leaf: unknown;
		public contentEl = enhanceDiv(document.createElement('div'));
		public scope: InstanceType<typeof Scope> | null = null;

		constructor(leaf: unknown) {
			this.leaf = leaf;
		}

		addAction(): HTMLButtonElement {
			const button = document.createElement('button');
			(button as HTMLButtonElement & { toggleClass: (name: string, force?: boolean) => void }).toggleClass =
				(name: string, force?: boolean) => {
					button.classList.toggle(name, force);
				};
			return button;
		}

		async setState(): Promise<void> {}

		async onClose(): Promise<void> {}
	}

	return {
		Scope,
		ItemView,
		MarkdownView: class {},
		Menu: class {},
		Notice: class {},
		Platform: { isMobile: true },
		TFile: class {},
		WorkspaceLeaf: class {},
		normalizePath: (value: string) => String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, ''),
		setIcon: vi.fn(),
	};
});

import { EpubView } from './EpubView';

describe('EpubView', () => {
	afterEach(() => {
		mountSpy.mockClear();
		unmountSpy.mockClear();
	});

	it('passes initial pending CFI to EpubReaderApp props without replaying navigateToCfi in onActionsReady', () => {
		const view = new EpubView({} as any, { app: {} } as any);
		(view as any).isOpen = true;
		(view as any).filePath = 'Books/demo.epub';
		(view as any).pendingCfi = 'epubcfi(/6/2!/4/2,/1:0,/1:9)';
		(view as any).pendingText = 'demo excerpt';

		const pendingNavigation = (view as any).consumePendingNavigation();
		const props = (view as any).buildReaderAppProps(
			pendingNavigation.pendingLocate,
			pendingNavigation.pendingCfi,
			pendingNavigation.pendingText
		) as {
			pendingLocate?: { cfi?: string; text?: string };
			pendingCfi?: string;
			pendingText?: string;
			onActionsReady?: (actions: { navigateToCfi?: (cfi: string, linkTextHint?: string) => void }) => void;
		};

		expect(props.pendingLocate?.cfi).toBe('epubcfi(/6/2!/4/2,/1:0,/1:9)');
		expect(props.pendingCfi).toBe('epubcfi(/6/2!/4/2,/1:0,/1:9)');
		expect(props.pendingText).toBe('demo excerpt');
		expect((view as any).pendingCfi).toBe('');
		expect((view as any).pendingText).toBe('');

		const navigateToCfi = vi.fn();
		props.onActionsReady?.({ navigateToCfi });
		expect(navigateToCfi).not.toHaveBeenCalled();
	});

	it('forwards pending locate metadata to an already mounted reader', () => {
		const view = new EpubView({} as any, { app: {} } as any);
		(view as any).pendingLocate = {
			cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:9)',
			text: 'demo excerpt',
			flashStyle: 'highlight',
			flashColor: 'yellow',
			showLocateOverlay: true,
		};
		const navigateToBookLocate = vi.fn();
		const navigateToCfi = vi.fn();
		(view as any).actionHandlers = {
			navigateToBookLocate,
			navigateToCfi,
		};

		(view as any).flushPendingLocateToReader();

		expect(navigateToBookLocate).toHaveBeenCalledWith({
			cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:9)',
			text: 'demo excerpt',
			flashStyle: 'highlight',
			flashColor: 'yellow',
			showLocateOverlay: true,
		});
		expect(navigateToCfi).not.toHaveBeenCalled();
		expect((view as any).pendingLocate).toBeNull();
	});

	it('shows canvas direction button via class toggle instead of inline display:none', () => {
		const view = new EpubView({} as any, { app: {} } as any);
		(view as any).actionHandlers = {
			canUseCanvasExcerpts: () => true,
		};
		(view as any).toolbarHandlersReady = true;
		(view as any).canvasModeActive = true;
		const button = document.createElement('button') as HTMLButtonElement & {
			toggleClass: (name: string, force?: boolean) => void;
		};
		button.toggleClass = (name: string, force?: boolean) => {
			button.classList.toggle(name, force);
		};
		(view as any).canvasDirBtn = button;
		(view as any).updateDirectionBtn();
		expect(button.style.display).toBe('');
		expect(button.classList.contains('epub-view-action-hidden')).toBe(false);
	});

	it('keeps canvas preview actions visible when canvas excerpt capability is unavailable', () => {
		const view = new EpubView({} as any, { app: {} } as any);
		const applyActionButtonState = vi.spyOn(view as any, 'applyActionButtonState');

		(view as any).actionHandlers = {
			canUseCanvasExcerpts: () => false,
		};
		(view as any).canvasModeActive = true;
		(view as any).updateCanvasBtn();

		expect(applyActionButtonState).toHaveBeenCalledWith((view as any).canvasBtn, expect.objectContaining({
			visible: true,
		}));
		expect(applyActionButtonState).toHaveBeenCalledWith((view as any).inlineCanvasBtn, expect.objectContaining({
			visible: true,
		}));
	});

	it('shows paragraph mode preview action without a locked suffix when capability is unavailable', () => {
		const view = new EpubView({} as any, { app: {} } as any);
		const applyActionButtonState = vi.spyOn(view as any, 'applyActionButtonState');

		(view as any).actionHandlers = {
			canUseParagraphMode: () => false,
			isPremiumFeaturePreviewEnabled: () => true,
		};
		(view as any).paragraphModeEnabled = true;
		(view as any).updateParagraphModeBtn();

		expect(applyActionButtonState).toHaveBeenCalledWith(
			(view as any).paragraphModeBtn,
			expect.objectContaining({
				active: false,
				visible: true,
				label: 'views.epubView.label.paragraphModeOn',
			})
		);
		expect(applyActionButtonState).toHaveBeenCalledWith(
			(view as any).inlineParagraphModeBtn,
			expect.objectContaining({
				active: false,
				visible: true,
				label: 'views.epubView.label.paragraphModeOn',
			})
		);
	});

	it('registers reader page shortcuts on a view scope and unregisters them on dispose', () => {
		const parentScope = {};
		const app = { scope: parentScope };
		const view = new EpubView({ app } as any, { app } as any);
		(view as any).app = app;

		(view as any).registerReaderKeyboardShortcuts();

		expect((view as any).scope).toBeTruthy();
		expect((view as any).readerKeymapHandlers).toHaveLength(2);
		expect((view as any).scope.getHandlerCount()).toBe(2);

		(view as any).disposeReaderKeymapScope();

		expect((view as any).scope).toBeNull();
		expect((view as any).readerKeymapHandlers).toHaveLength(0);
	});

	it('redirects stale PDF state from the EPUB reader to the PDF reader view', async () => {
		const setViewState = vi.fn(async () => undefined);
		const app = { scope: {} };
		const leaf = { app, setViewState };
		const view = new EpubView(leaf as any, { app } as any);
		(view as any).isOpen = true;
		const mountComponent = vi.spyOn(view as any, 'mountComponent');

		await view.setState(
			{
				filePath: 'Books/demo.pdf',
				annotationId: 'pdf-anno-1',
				pageNumber: 2,
			},
			null
		);

		expect(setViewState).toHaveBeenCalledWith({
			type: 'weave-pdf-reader',
			active: true,
			state: {
				filePath: 'Books/demo.pdf',
				file: 'Books/demo.pdf',
				annotationId: 'pdf-anno-1',
				pageNumber: 2,
			},
		});
		expect(mountComponent).not.toHaveBeenCalled();
	});

	it('re-registers reader shortcuts without leaking handlers from the previous scope', () => {
		const parentScope = {};
		const app = { scope: parentScope };
		const view = new EpubView({ app } as any, { app } as any);
		(view as any).app = app;

		(view as any).registerReaderKeyboardShortcuts();
		const firstScope = (view as any).scope;

		(view as any).registerReaderKeyboardShortcuts();

		expect(firstScope.getHandlerCount()).toBe(0);
		expect((view as any).readerKeymapHandlers).toHaveLength(2);
		expect((view as any).scope.getHandlerCount()).toBe(2);
	});

	it('opens the paragraph mode premium preview instead of toggling when the capability is unavailable', () => {
		const view = new EpubView({} as any, { app: {} } as any);
		const toggleParagraphMode = vi.fn();
		const showPremiumFeaturePreview = vi.fn();

		(view as any).actionHandlers = {
			canUseParagraphMode: () => false,
			isPremiumFeaturePreviewEnabled: () => true,
			toggleParagraphMode,
			showPremiumFeaturePreview,
		};

		(view as any).toggleParagraphMode();

		expect(showPremiumFeaturePreview).toHaveBeenCalledWith(PREMIUM_FEATURES.EPUB_PARAGRAPH_MODE);
		expect(toggleParagraphMode).not.toHaveBeenCalled();
		expect((view as any).paragraphModeEnabled).toBe(false);
	});

	it('adds annotation and AI reading notes to the notes pane menu', () => {
		const view = new EpubView({} as any, { app: {} } as any);
		const openAnnotationNote = vi.fn();
		const openAiReadingNote = vi.fn();
		const openAiReadingDualWindow = vi.fn();
		const items: Array<{
			title?: string;
			icon?: string;
			click?: () => void;
			subItems?: unknown[];
			setTitle: (title: string) => unknown;
			setIcon: (icon: string) => unknown;
			setChecked: (checked: boolean) => unknown;
			onClick: (callback: () => void) => unknown;
			setSubmenu?: () => unknown;
		}> = [];
		const createMenu = () => ({
			addSeparator: vi.fn(),
			addItem: vi.fn((callback: (item: any) => void) => {
				const item = {
					setTitle(title: string) {
						this.title = title;
						return this;
					},
					setIcon(icon: string) {
						this.icon = icon;
						return this;
					},
					setChecked() {
						return this;
					},
					onClick(click: () => void) {
						this.click = click;
						return this;
					},
					setSubmenu() {
						const subItems: unknown[] = [];
						this.subItems = subItems;
						return {
							addItem: (subCallback: (subItem: any) => void) => {
								const subItem = {
									setTitle(title: string) {
										this.title = title;
										return this;
									},
									setIcon(icon: string) {
										this.icon = icon;
										return this;
									},
									setChecked() {
										return this;
									},
									onClick(click: () => void) {
										this.click = click;
										return this;
									},
								};
								subItems.push(subItem);
								subCallback(subItem);
							},
						};
					},
				};
				items.push(item);
				callback(item);
			}),
		});
		const menu = createMenu();
		(view as any).actionHandlers = {
			openAnnotationNote,
			openAiReadingNote,
			openAiReadingDualWindow,
		};

		(view as any).appendNotesPaneMenu(menu);

		const notesMenuItem = items.find((item) => item.icon === 'notebook-tabs');
		expect(notesMenuItem?.icon).toBe('notebook-tabs');
		expect(menu.addSeparator).toHaveBeenCalled();
		const subItems = (notesMenuItem?.subItems || []) as Array<{
			title?: string;
			icon?: string;
			click?: () => void;
		}>;
		expect(subItems.map((item) => item.title)).toEqual([
			'\u6253\u5f00\u6807\u6ce8\u7b14\u8bb0',
			'\u6253\u5f00 AI \u9605\u8bfb\u7b14\u8bb0',
		]);
		expect(subItems.map((item) => item.icon)).toEqual([
			'notebook-pen',
			'sparkles',
		]);
		subItems[0]?.click?.();
		subItems[1]?.click?.();
		expect(openAnnotationNote).toHaveBeenCalledOnce();
		expect(openAiReadingNote).toHaveBeenCalledOnce();
		expect(openAiReadingDualWindow).not.toHaveBeenCalled();
	});

	it('adds AI reading dual window to the dual-window pane menu', () => {
		const view = new EpubView({} as any, { app: {} } as any);
		const openAnnotationDualWindow = vi.fn();
		const openAiReadingDualWindow = vi.fn();
		const openAnnotationCompareDualWindow = vi.fn();
		const items: Array<{
			title?: string;
			icon?: string;
			click?: () => void;
			subItems?: unknown[];
			setTitle: (title: string) => unknown;
			setIcon: (icon: string) => unknown;
			onClick: (callback: () => void) => unknown;
			setSubmenu?: () => unknown;
		}> = [];
		const menu = {
			addItem: vi.fn((callback: (item: any) => void) => {
				const item = {
					setTitle(title: string) {
						this.title = title;
						return this;
					},
					setIcon(icon: string) {
						this.icon = icon;
						return this;
					},
					onClick(click: () => void) {
						this.click = click;
						return this;
					},
					setSubmenu() {
						const subItems: unknown[] = [];
						this.subItems = subItems;
						return {
							addItem: (subCallback: (subItem: any) => void) => {
								const subItem = {
									setTitle(title: string) {
										this.title = title;
										return this;
									},
									setIcon(icon: string) {
										this.icon = icon;
										return this;
									},
									onClick(click: () => void) {
										this.click = click;
										return this;
									},
									setDisabled(disabled: boolean) {
										this.disabled = disabled;
										return this;
									},
								};
								subItems.push(subItem);
								subCallback(subItem);
							},
						};
					},
				};
				items.push(item);
				callback(item);
			}),
		};
		(view as any).filePath = 'Books/demo.epub';
		(view as any).actionHandlers = {
			openAnnotationDualWindow,
			openAiReadingDualWindow,
			openAnnotationCompareDualWindow,
		};

		(view as any).appendDualWindowPaneMenu(menu);

		const dualWindowMenuItem = items.find((item) => item.icon === 'columns-2');
		const subItems = (dualWindowMenuItem?.subItems || []) as Array<{
			title?: string;
			icon?: string;
			click?: () => void;
		}>;
		expect(subItems.map((item) => item.title)).toEqual([
			'\u539f\u4e66\u4e0e\u6807\u6ce8\u7b14\u8bb0',
			'\u539f\u4e66\u4e0e AI \u9605\u8bfb\u7b14\u8bb0',
			'\u4e24\u79cd\u6807\u6ce8\u5bf9\u6bd4',
			'\u539f\u4e66\u4e0e\u7ffb\u8bd1\uff08\u6682\u672a\u5f00\u653e\uff09',
		]);
		expect(subItems.map((item) => item.icon)).toEqual([
			'notebook-pen',
			'book-open-check',
			'git-compare',
			'languages',
		]);
		subItems[0]?.click?.();
		subItems[1]?.click?.();
		subItems[2]?.click?.();
		expect(openAnnotationDualWindow).toHaveBeenCalledOnce();
		expect(openAiReadingDualWindow).toHaveBeenCalledOnce();
		expect(openAnnotationCompareDualWindow).toHaveBeenCalledOnce();
	});
});
