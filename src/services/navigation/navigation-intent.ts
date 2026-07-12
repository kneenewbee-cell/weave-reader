import type { FlashStyle } from "../epub/reader-engine-types";

export type NavigationTargetKind = "book" | "markdown" | "canvas" | "card" | "json";

/** In-reader locate only (CFI/href); not a cross-view NavigationIntent. */
export interface BookLocateIntent {
	cfi?: string;
	href?: string;
	text?: string;
	flashStyle?: FlashStyle;
	flashColor?: string;
	showLocateOverlay?: boolean;
}

export interface PendingLocateState {
	cfi?: string;
	href?: string;
	text?: string;
	flashStyle?: FlashStyle;
	flashColor?: string;
	showLocateOverlay?: boolean;
}

export interface NavigationIntentLocate extends PendingLocateState {
	candidates?: string[];
}

export interface NavigationIntentContext {
	sourceMarkdownPath?: string;
	sourceId?: string;
	epubFilePath?: string;
	nodeId?: string;
}

export interface NavigationIntentPolicy {
	reuseLeaf?: boolean;
	openInNewTab?: boolean;
	focus?: boolean;
	/** Bookshelf / command open: reuse preferred center leaf instead of source-navigation tab rules. */
	preferredLeaf?: boolean;
}

export interface NavigationIntent {
	kind: NavigationTargetKind;
	/** Vault path, or card UUID when kind is `card`. */
	resourcePath: string;
	locate?: NavigationIntentLocate;
	context?: NavigationIntentContext;
	policy?: NavigationIntentPolicy;
}

export interface NavigationResult {
	success: boolean;
	leaf?: import("obsidian").WorkspaceLeaf | null;
	error?: string;
}

export function pendingLocateFromLegacyState(state: {
	pendingLocate?: PendingLocateState;
	pendingCfi?: string;
	pendingText?: string;
}): PendingLocateState | null {
	if (state.pendingLocate) {
		const { cfi, href, text, flashStyle, flashColor, showLocateOverlay } = state.pendingLocate;
		if (cfi || href || text) {
			return { cfi, href, text, flashStyle, flashColor, showLocateOverlay };
		}
	}
	const cfi = String(state.pendingCfi || "").trim();
	if (!cfi) {
		return null;
	}
	return {
		cfi,
		text: state.pendingText || "",
	};
}

export function hasBookLocateTarget(
	locate?: Pick<BookLocateIntent, "cfi" | "href"> | null
): boolean {
	if (!locate) {
		return false;
	}
	return Boolean(String(locate.cfi || "").trim() || String(locate.href || "").trim());
}

export function bookLocateFromPending(pending: PendingLocateState | null): BookLocateIntent | null {
	if (!pending) {
		return null;
	}
	if (!hasBookLocateTarget(pending)) {
		return null;
	}
	return {
		cfi: pending.cfi,
		href: pending.href,
		text: pending.text,
		flashStyle: pending.flashStyle,
		flashColor: pending.flashColor,
		showLocateOverlay: pending.showLocateOverlay,
	};
}
