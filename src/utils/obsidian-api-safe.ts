import { logger } from "../utils/logger";
/**
 * Obsidian API 安全包装器
 * 解决 Svelte 5 与 Obsidian API 的兼容性问题
 */

import { Notice } from "obsidian";
import { readNoticeShownState } from "../types/obsidian-extensions";
import { untrack } from "svelte";

/**
 * 兼容性错误检测
 */
export function isObsidianCompatibilityError(error: Error): boolean {
	const message = error.message || "";
	const stack = error.stack || "";

	const patterns = [
		/isShown is not a function/,
		/hide is not a function/,
		/show is not a function/,
		/Cannot read properties of undefined \(reading 'isShown'\)/,
		/Cannot read properties of undefined \(reading 'hide'\)/,
		/Cannot read properties of undefined \(reading 'show'\)/,
	];

	return patterns.some((pattern) => pattern.test(message) || pattern.test(stack));
}

/**
 * 安全的 Notice 包装器
 */
export class SafeNotice {
	private notice: Notice | null = null;
	private isDestroyed = false;

	constructor(message: string, timeout?: number) {
		try {
			// 使用 untrack 避免响应式系统干扰
			this.notice = untrack(() => new Notice(message, timeout));
		} catch (error) {
			logger.warn("[SafeNotice] 创建 Notice 失败:", error);
			this.notice = null;
		}
	}

	/**
	 * 安全隐藏 Notice
	 */
	hide(): void {
		if (this.isDestroyed || !this.notice) {
			return;
		}

		try {
			// 检查 hide 方法是否存在且为函数
			if (this.notice && typeof this.notice.hide === "function") {
				untrack(() => {
					this.notice?.hide();
				});
			} else {
				const isShown = readNoticeShownState(this.notice);
				if (isShown === true) {
					this.hideViaDom();
				}
			}
		} catch (error) {
			if (isObsidianCompatibilityError(error as Error)) {
				logger.warn("[SafeNotice] 兼容性问题，尝试替代方案:", error);
				this.hideViaDom();
			} else {
				logger.error("[SafeNotice] 隐藏失败:", error);
			}
		}
	}

	/**
	 * 通过 DOM 操作隐藏 Notice
	 */
	private hideViaDom(): void {
		try {
			// 查找并隐藏相关的 Notice DOM 元素
			const noticeElements = activeDocument.querySelectorAll(".notice");
			noticeElements.forEach((_element) => {
				const htmlElement = _element as HTMLElement;
				if (htmlElement.style.display !== "none") {
					htmlElement.setCssProps({ display: "none" });
				}
			});
		} catch (domError) {
			logger.warn("[SafeNotice] DOM 操作失败:", domError);
		}
	}

	/**
	 * 检查 Notice 是否仍然显示
	 */
	isShown(): boolean {
		if (this.isDestroyed || !this.notice) {
			return false;
		}

		try {
			const isShown = readNoticeShownState(this.notice);
			if (isShown !== null) {
				return isShown;
			}

			// 如果无法确定，假设仍在显示
			return true;
		} catch (error) {
			logger.warn("[SafeNotice] 检查显示状态失败:", error);
			return false;
		}
	}

	/**
	 * 销毁 Notice
	 */
	destroy(): void {
		if (this.isDestroyed) {
			return;
		}

		this.hide();
		this.isDestroyed = true;
		this.notice = null;
	}
}

/**
 * 安全创建 Notice
 */
export function createSafeNotice(message: string, timeout?: number): SafeNotice {
	return new SafeNotice(message, timeout);
}

/**
 * 安全的设置页面打开
 */
interface ObsidianSettingsApi {
	open: () => void;
	openTabById?: (tabId: string) => void;
}

interface ObsidianAppWithSettings {
	setting?: ObsidianSettingsApi;
}

function resolveObsidianSettings(app: unknown): ObsidianSettingsApi | null {
	if (!app || typeof app !== "object" || !("setting" in app)) {
		return null;
	}
	const setting = (app as ObsidianAppWithSettings).setting;
	if (!setting || typeof setting.open !== "function") {
		return null;
	}
	return setting;
}

export function safeOpenSettings(app: unknown, tabId?: string): void {
	try {
		untrack(() => {
			const setting = resolveObsidianSettings(app);
			if (setting) {
				setting.open();

				if (tabId && typeof setting.openTabById === "function") {
					// 延迟打开特定标签，确保设置页面已加载
					window.setTimeout(() => {
						try {
							setting.openTabById(tabId);
						} catch (tabError) {
							logger.warn("[SafeSettings] 打开标签失败:", tabError);
						}
					}, 100);
				}
			} else {
				logger.warn("[SafeSettings] 设置 API 不可用");
			}
		});
	} catch (error) {
		logger.error("[SafeSettings] 打开设置失败:", error);
	}
}

/**
 * 安全的 DOM 操作包装器
 */
export function safeDomOperation<T>(operation: () => T, fallback?: T): T | undefined {
	try {
		return untrack(() => operation());
	} catch (error) {
		if (isObsidianCompatibilityError(error as Error)) {
			logger.warn("[SafeDOM] 兼容性问题，使用回退方案:", error);
			return fallback;
		} else {
			logger.error("[SafeDOM] DOM 操作失败:", error);
			throw error;
		}
	}
}

/**
 * 安全的事件处理器包装
 */
export function safeEventHandler<T extends Event>(handler: (event: T) => void): (event: T) => void {
	return (event: T) => {
		try {
			untrack(() => handler(event));
		} catch (error) {
			if (isObsidianCompatibilityError(error as Error)) {
				logger.warn("[SafeEvent] 兼容性问题，忽略错误:", error);
			} else {
				logger.error("[SafeEvent] 事件处理失败:", error);
				throw error;
			}
		}
	};
}

/**
 * 清理所有可能的兼容性问题
 */
export function cleanupCompatibilityIssues(): void {
	try {
		// 清理可能的错误标记
		const errorElements = activeDocument.querySelectorAll("[data-svelte-error]");
		errorElements.forEach((el) => el.removeAttribute("data-svelte-error"));

		// 清理可能的隐藏 Notice
		const hiddenNotices = activeDocument.querySelectorAll('.notice[style*="display: none"]');
		hiddenNotices.forEach((el) => el.remove());

		// 强制垃圾回收（如果可用）
		const windowWithGc = window as Window & { gc?: () => void };
		if (typeof windowWithGc.gc === "function") {
			windowWithGc.gc();
		}
	} catch (error) {
		logger.warn("[Cleanup] 清理过程中出现错误:", error);
	}
}
