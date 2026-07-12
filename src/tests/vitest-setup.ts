import { logger } from '../utils/logger';
/**
 * Vitest测试环境配置
 *
 * 提供全局测试工具和DOM匹配器
 */

import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';

if (typeof Object.groupBy !== 'function') {
	Object.groupBy = <T>(
		items: Iterable<T>,
		keySelector: (item: T) => PropertyKey
	): Partial<Record<PropertyKey, T[]>> => {
		const result: Partial<Record<PropertyKey, T[]>> = {};
		for (const item of items) {
			const key = keySelector(item);
			const bucket = result[key] ?? [];
			bucket.push(item);
			result[key] = bucket;
		}
		return result;
	};
}

if (typeof Map.groupBy !== 'function') {
	Map.groupBy = <T, K>(
		items: Iterable<T>,
		keySelector: (item: T) => K
	): Map<K, T[]> => {
		const result = new Map<K, T[]>();
		for (const item of items) {
			const key = keySelector(item);
			const bucket = result.get(key) ?? [];
			bucket.push(item);
			result.set(key, bucket);
		}
		return result;
	};
}

afterEach(() => {
  vi.useRealTimers();
  const testWindow = window as TestWindow & {
    __weaveThemeManagerCleanup?: (() => void) | null;
  };
  testWindow.__weaveThemeManagerCleanup?.();
});

type TestWindow = Window &
  typeof globalThis & {
    app?: Record<string, unknown>;
    __weaveThemeManagerCleanup?: (() => void) | null;
  };

// 全局测试工具
Object.defineProperty(globalThis, 'vi', {
  configurable: true,
  value: vi,
  writable: true
});

function installObsidianPopoutGlobals(): void {
  if (typeof document !== "undefined" && !("activeDocument" in globalThis)) {
    Object.defineProperty(globalThis, "activeDocument", {
      configurable: true,
      get: () => document,
    });
  }
  if (typeof window !== "undefined" && !("activeWindow" in globalThis)) {
    Object.defineProperty(globalThis, "activeWindow", {
      configurable: true,
      get: () => window,
    });
    const testWindow = window as TestWindow & {
      activeDocument?: Document;
      activeWindow?: Window;
    };
    if (!testWindow.activeDocument) {
      Object.defineProperty(testWindow, "activeDocument", {
        configurable: true,
        get: () => document,
      });
    }
    if (!testWindow.activeWindow) {
      Object.defineProperty(testWindow, "activeWindow", {
        configurable: true,
        get: () => window,
      });
    }
  }

  if (typeof Node !== "undefined" && !("instanceOf" in Node.prototype)) {
    Object.defineProperty(Node.prototype, "instanceOf", {
      configurable: true,
      value<T>(this: Node, type: { new (): T }): this is T {
        return this instanceof type;
      },
    });
  }

  installObsidianCreateElHelpers();
}

type ObsidianDomOptions = {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  type?: string;
};

function applyObsidianDomOptions(element: HTMLElement, options?: ObsidianDomOptions | string): void {
  if (!options) {
    return;
  }
  if (typeof options === "string") {
    element.className = options;
    return;
  }
  if (options.cls) {
    element.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
  }
  if (options.text) {
    element.textContent = options.text;
  }
  if (options.type) {
    element.type = options.type;
  }
  if (options.attr) {
    for (const [name, value] of Object.entries(options.attr)) {
      if (value != null) {
        element.setAttribute(name, String(value));
      }
    }
  }
}

function installObsidianCreateElHelpers(): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const testWindow = window as Window & {
    createEl?: <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: ObsidianDomOptions | string
    ) => HTMLElementTagNameMap[K];
    createDiv?: (options?: ObsidianDomOptions | string) => HTMLDivElement;
    createSpan?: (options?: ObsidianDomOptions | string) => HTMLSpanElement;
  };

  if (typeof testWindow.createEl !== "function") {
    testWindow.createEl = ((tag, options) => {
      const element = document.createElement(tag);
      applyObsidianDomOptions(element, options);
      return element;
    }) as typeof testWindow.createEl;
    testWindow.createDiv = (options) => testWindow.createEl!("div", options);
    testWindow.createSpan = (options) => testWindow.createEl!("span", options);
  }

  if (typeof Document !== "undefined" && !("win" in Document.prototype)) {
    Object.defineProperty(Document.prototype, "win", {
      configurable: true,
      get(this: Document): Window {
        return (this.defaultView as Window | null) ?? window;
      },
    });
  }
}

installObsidianPopoutGlobals();

// Mock Obsidian全局对象（如果需要）
if (typeof window !== 'undefined') {
  // 确保测试环境中有基本的window对象
  const testWindow = window as TestWindow;
  testWindow.app ??= {};

  if (typeof testWindow.matchMedia !== 'function') {
    Object.defineProperty(testWindow, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      })),
    });
  }
}

logger.debug('✓ Vitest测试环境已初始化');
