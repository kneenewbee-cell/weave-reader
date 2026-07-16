import { normalizePath, type App, type WorkspaceLeaf } from "obsidian";
import { findOpenEpubLeaf } from "../../utils/epub-leaf-utils";
import { getLeafViewFile } from "../../utils/obsidian-workspace-utils";
import { epubVaultPathsReferToSameBook } from "./epub-vault-path";
import {
	dispatchEpubDualWindowSessionEvent,
	type EpubDualWindowMode,
	type EpubDualWindowSessionDetail,
} from "./epub-dual-window";

export interface EpubDualWindowSession {
	mode: EpubDualWindowMode;
	bookId: string;
	filePath: string;
	notePath: string;
}

export interface EpubDualWindowPanes {
	session: EpubDualWindowSession;
	epubLeaf: WorkspaceLeaf;
	noteLeaf: WorkspaceLeaf;
}

export interface EpubDualWindowRect {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface EpubDualWindowPosition {
	left: number;
	top: number;
}

const sessionsByApp = new WeakMap<App, Map<string, EpubDualWindowSession>>();
const DUAL_WINDOW_NOTE_VIEW_CLASS = "weave-epub-annotation-note-dual-window-view";

function cleanPath(value: unknown): string {
	return normalizePath(String(value || "").trim());
}

function sessionKey(filePath: string): string {
	return cleanPath(filePath).toLowerCase();
}

function pathsReferToSameDualWindowBook(left: string, right: string): boolean {
	const leftPath = cleanPath(left);
	const rightPath = cleanPath(right);
	return Boolean(
		leftPath &&
			rightPath &&
			(leftPath.toLowerCase() === rightPath.toLowerCase() ||
				epubVaultPathsReferToSameBook(leftPath, rightPath))
	);
}

function getSessionMap(app: App): Map<string, EpubDualWindowSession> {
	let map = sessionsByApp.get(app);
	if (!map) {
		map = new Map();
		sessionsByApp.set(app, map);
	}
	return map;
}

function findMarkdownLeafByPath(app: App, notePath: string): WorkspaceLeaf | null {
	const targetPath = cleanPath(notePath);
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const file = getLeafViewFile(leaf);
		if (file && cleanPath(file.path) === targetPath) {
			return leaf;
		}
	}
	return null;
}

function toEventDetail(session: EpubDualWindowSession, active: boolean): EpubDualWindowSessionDetail {
	return {
		mode: session.mode,
		bookId: session.bookId,
		filePath: session.filePath,
		notePath: session.notePath,
		active,
	};
}

export function registerEpubDualWindowSession(app: App, session: EpubDualWindowSession): void {
	const normalizedSession = {
		...session,
		filePath: cleanPath(session.filePath),
		notePath: cleanPath(session.notePath),
	};
	getSessionMap(app).set(sessionKey(normalizedSession.filePath), normalizedSession);
	dispatchEpubDualWindowSessionEvent(window, toEventDetail(normalizedSession, true));
}

export function getEpubDualWindowSession(app: App, filePath: string): EpubDualWindowSession | null {
	const map = getSessionMap(app);
	const exact = map.get(sessionKey(filePath));
	if (exact) {
		return exact;
	}
	for (const session of map.values()) {
		if (pathsReferToSameDualWindowBook(session.filePath, filePath)) {
			return session;
		}
	}
	return null;
}

export function hasEpubDualWindowSession(app: App, filePath: string): boolean {
	return Boolean(getEpubDualWindowSession(app, filePath));
}

function isHtmlElement(value: unknown): value is HTMLElement {
	return Boolean(value && typeof value === "object" && (value as HTMLElement).nodeType === 1);
}

export function getEpubDualWindowLeafContainerEls(leaf: WorkspaceLeaf | null): HTMLElement[] {
	const view = leaf?.view as { containerEl?: HTMLElement; contentEl?: HTMLElement } | null;
	const candidates = [
		(leaf as { containerEl?: HTMLElement } | null)?.containerEl,
		view?.containerEl,
		view?.contentEl,
	];
	const elements: HTMLElement[] = [];
	for (const candidate of candidates) {
		if (isHtmlElement(candidate) && !elements.includes(candidate)) {
			elements.push(candidate);
		}
	}
	return elements;
}

export function getEpubDualWindowLeafContainerEl(leaf: WorkspaceLeaf | null): HTMLElement | null {
	return getEpubDualWindowLeafContainerEls(leaf)[0] || null;
}

export function markEpubDualWindowNoteLeaf(leaf: WorkspaceLeaf | null, active: boolean): void {
	for (const containerEl of getEpubDualWindowLeafContainerEls(leaf)) {
		containerEl.classList.toggle(DUAL_WINDOW_NOTE_VIEW_CLASS, active);
	}
}

export function markEpubDualWindowPaneRoles(epubLeaf: WorkspaceLeaf | null, noteLeaf: WorkspaceLeaf | null): void {
	markEpubDualWindowNoteLeaf(epubLeaf, false);
	markEpubDualWindowNoteLeaf(noteLeaf, true);
}

export function resolveEpubDualWindowPanes(app: App, filePath: string): EpubDualWindowPanes | null {
	const session = getEpubDualWindowSession(app, filePath);
	if (!session) {
		return null;
	}
	const epubLeaf = findOpenEpubLeaf(app, session.filePath);
	const noteLeaf = findMarkdownLeafByPath(app, session.notePath);
	if (!epubLeaf || !noteLeaf || epubLeaf === noteLeaf) {
		return null;
	}
	return { session, epubLeaf, noteLeaf };
}

export function resolveEpubDualWindowBoundaryPosition(
	epubRect: EpubDualWindowRect,
	noteRect: EpubDualWindowRect
): EpubDualWindowPosition {
	const epubCenterX = (epubRect.left + epubRect.right) / 2;
	const noteCenterX = (noteRect.left + noteRect.right) / 2;
	const left =
		epubCenterX <= noteCenterX
			? (epubRect.right + noteRect.left) / 2
			: (noteRect.right + epubRect.left) / 2;
	const overlapTop = Math.max(epubRect.top, noteRect.top);
	const overlapBottom = Math.min(epubRect.bottom, noteRect.bottom);
	const top =
		overlapBottom > overlapTop
			? (overlapTop + overlapBottom) / 2
			: (epubRect.top + epubRect.bottom + noteRect.top + noteRect.bottom) / 4;
	return {
		left: Math.round(left),
		top: Math.round(top),
	};
}

export async function swapEpubDualWindowPanes(
	app: App,
	filePath: string
): Promise<boolean> {
	const session = getEpubDualWindowSession(app, filePath);
	if (!session) {
		return false;
	}
	const epubLeaf = findOpenEpubLeaf(app, session.filePath);
	const noteLeaf = findMarkdownLeafByPath(app, session.notePath);
	if (!epubLeaf || !noteLeaf || epubLeaf === noteLeaf) {
		return false;
	}
	const epubState = epubLeaf.getViewState();
	const noteState = noteLeaf.getViewState();
	await epubLeaf.setViewState(noteState);
	await noteLeaf.setViewState(epubState);
	markEpubDualWindowPaneRoles(noteLeaf, epubLeaf);
	void app.workspace.revealLeaf(noteLeaf);
	dispatchEpubDualWindowSessionEvent(window, toEventDetail(session, true));
	return true;
}
