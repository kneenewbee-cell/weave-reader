import { normalizePath, type App, type WorkspaceLeaf } from "obsidian";
import { findOpenEpubLeaf, getAllOpenEpubLeaves, getOpenEpubFilePath } from "../../utils/epub-leaf-utils";
import { getLeafViewFile } from "../../utils/obsidian-workspace-utils";
import { epubVaultPathsReferToSameBook } from "./epub-vault-path";
import {
	isEpubGeneratedAnnotationNotePath,
	resolveEpubPortableBookDataLocation,
} from "./epub-portable-data-location";
import { readEpubSemanticJson } from "./semantic/semantic-store";
import {
	dispatchEpubDualWindowSessionEvent,
	normalizeEpubAnnotationCompareContext,
	type EpubAnnotationCompareContext,
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

export type EpubDualWindowSideKind = "markdown" | "epub" | "translation";

export interface EpubOpenDualWindowSession {
	mode: EpubDualWindowMode;
	bookId: string;
	filePath: string;
	sessionId?: string;
	notePath?: string;
	sideKind: EpubDualWindowSideKind;
	mainLeaf: WorkspaceLeaf | null;
	sideLeaf: WorkspaceLeaf | null;
	complete: boolean;
}

export type EpubDualWindowOpenGuardAction =
	| "open"
	| "reveal-existing"
	| "replace-existing"
	| "change-annotation-compare-versions"
	| "blocked-side-pane";

export interface EpubDualWindowSessionLookupInput {
	bookId?: unknown;
	filePath?: unknown;
	mode?: EpubDualWindowMode;
}

export interface EpubDualWindowOpenGuardInput extends EpubDualWindowSessionLookupInput {
	requestedMode: EpubDualWindowMode;
	currentAnnotationCompare?: unknown;
}

export interface EpubDualWindowOpenGuardResult {
	action: EpubDualWindowOpenGuardAction;
	existingSession?: EpubOpenDualWindowSession;
}

export interface EpubDualWindowHousekeepingResult {
	removedNoteSessions: number;
	clearedAnnotationComparePanes: number;
}

const sessionsByApp = new WeakMap<App, Map<string, EpubDualWindowSession>>();
const incompleteCompareFirstSeenByApp = new WeakMap<App, Map<string, number>>();
const incompleteCompareCleanupTimersByApp = new WeakMap<App, Set<string>>();
const DUAL_WINDOW_NOTE_VIEW_CLASS = "weave-epub-annotation-note-dual-window-view";
const ANNOTATION_COMPARE_STALE_GRACE_MS = 1500;

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

function getIncompleteCompareFirstSeenMap(app: App): Map<string, number> {
	let map = incompleteCompareFirstSeenByApp.get(app);
	if (!map) {
		map = new Map();
		incompleteCompareFirstSeenByApp.set(app, map);
	}
	return map;
}

function getIncompleteCompareCleanupTimers(app: App): Set<string> {
	let timers = incompleteCompareCleanupTimersByApp.get(app);
	if (!timers) {
		timers = new Set();
		incompleteCompareCleanupTimersByApp.set(app, timers);
	}
	return timers;
}

function scheduleIncompleteAnnotationCompareCleanup(app: App, sessionId: string): void {
	const cleanSessionId = String(sessionId || "").trim();
	if (!cleanSessionId || typeof globalThis.setTimeout !== "function") {
		return;
	}
	const timers = getIncompleteCompareCleanupTimers(app);
	if (timers.has(cleanSessionId)) {
		return;
	}
	timers.add(cleanSessionId);
	const timeout = globalThis.setTimeout(() => {
		timers.delete(cleanSessionId);
		void cleanupStaleEpubDualWindowSessions(app);
	}, ANNOTATION_COMPARE_STALE_GRACE_MS + 100);
	if (typeof (timeout as { unref?: () => void }).unref === "function") {
		(timeout as { unref: () => void }).unref();
	}
}

function cleanBookId(value: unknown): string {
	return String(value || "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function extractGeneratedAnnotationNoteBookId(notePath: unknown): string {
	const normalizedPath = cleanPath(notePath);
	const match = normalizedPath.match(/^weave\/epub-data\/books\/([^/]+)\/annotations\.md$/i);
	return match?.[1] || "";
}

function collectBookMetadataFilePathCandidates(metadata: unknown): string[] {
	if (!isRecord(metadata)) {
		return [];
	}
	const candidates = [
		metadata.filePath,
		...(Array.isArray(metadata.knownPaths) ? metadata.knownPaths : []),
	]
		.map((value) => cleanPath(value))
		.filter(Boolean);
	return Array.from(new Set(candidates));
}

function sessionMatchesLookup(
	session: { bookId?: string; filePath?: string; mode?: EpubDualWindowMode },
	input: EpubDualWindowSessionLookupInput
): boolean {
	if (input.mode && session.mode !== input.mode) {
		return false;
	}
	const lookupBookId = cleanBookId(input.bookId);
	const lookupFilePath = cleanPath(input.filePath);
	if (!lookupBookId && !lookupFilePath) {
		return true;
	}
	if (lookupBookId && cleanBookId(session.bookId) === lookupBookId) {
		return true;
	}
	return Boolean(
		lookupFilePath &&
		session.filePath &&
		pathsReferToSameDualWindowBook(session.filePath, lookupFilePath)
	);
}

function readAnnotationCompareContextFromLeaf(
	leaf: WorkspaceLeaf | null | undefined
): EpubAnnotationCompareContext | null {
	try {
		const state = leaf?.getViewState?.()?.state as Record<string, unknown> | undefined;
		return normalizeEpubAnnotationCompareContext(state?.annotationCompare);
	} catch {
		return null;
	}
}

async function clearAnnotationCompareStateFromLeaf(leaf: WorkspaceLeaf | null | undefined): Promise<boolean> {
	if (!leaf) {
		return false;
	}
	try {
		const viewState = leaf.getViewState?.();
		if (!viewState?.state || !normalizeEpubAnnotationCompareContext(viewState.state.annotationCompare)) {
			return false;
		}
		const nextState = { ...(viewState.state as Record<string, unknown>) };
		delete nextState.annotationCompare;
		await leaf.setViewState({
			...viewState,
			state: nextState,
		});
		return true;
	} catch {
		return false;
	}
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

export function unregisterEpubDualWindowSession(app: App, filePath: string): boolean {
	const map = getSessionMap(app);
	const removedSessions: EpubDualWindowSession[] = [];
	const exactKey = sessionKey(filePath);
	const exact = map.get(exactKey);
	if (exact) {
		map.delete(exactKey);
		removedSessions.push(exact);
	}
	for (const [key, session] of map.entries()) {
		if (pathsReferToSameDualWindowBook(session.filePath, filePath)) {
			map.delete(key);
			removedSessions.push(session);
		}
	}
	for (const session of removedSessions) {
		dispatchEpubDualWindowSessionEvent(window, toEventDetail(session, false));
	}
	return removedSessions.length > 0;
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

export async function cleanupStaleEpubDualWindowSessions(
	app: App
): Promise<EpubDualWindowHousekeepingResult> {
	let removedNoteSessions = 0;
	let clearedAnnotationComparePanes = 0;

	for (const session of Array.from(getSessionMap(app).values())) {
		if (session.mode !== "book-annotation-note") {
			continue;
		}
		const mainLeaf = findOpenEpubLeaf(app, session.filePath);
		const sideLeaf = findMarkdownLeafByPath(app, session.notePath);
		if (!mainLeaf || !sideLeaf || mainLeaf === sideLeaf) {
			if (unregisterEpubDualWindowSession(app, session.filePath)) {
				removedNoteSessions += 1;
			}
		}
	}

	const compareEntriesBySession = new Map<
		string,
		Array<{ leaf: WorkspaceLeaf; context: EpubAnnotationCompareContext }>
	>();
	for (const leaf of getAllOpenEpubLeaves(app)) {
		const context = readAnnotationCompareContextFromLeaf(leaf);
		if (!context) {
			continue;
		}
		const entries = compareEntriesBySession.get(context.sessionId) || [];
		entries.push({ leaf, context });
		compareEntriesBySession.set(context.sessionId, entries);
	}
	const incompleteCompareFirstSeen = getIncompleteCompareFirstSeenMap(app);
	const now = Date.now();
	for (const [sessionId, entries] of compareEntriesBySession.entries()) {
		const editable = entries.find((entry) => entry.context.paneRole === "editable") || null;
		const readonly = entries.find((entry) => entry.context.paneRole === "readonly") || null;
		if (editable?.leaf && readonly?.leaf && editable.leaf !== readonly.leaf) {
			incompleteCompareFirstSeen.delete(sessionId);
			continue;
		}
		const firstSeenAt = incompleteCompareFirstSeen.get(sessionId);
		if (firstSeenAt === undefined) {
			incompleteCompareFirstSeen.set(sessionId, now);
			scheduleIncompleteAnnotationCompareCleanup(app, sessionId);
			continue;
		}
		if (now - firstSeenAt < ANNOTATION_COMPARE_STALE_GRACE_MS) {
			scheduleIncompleteAnnotationCompareCleanup(app, sessionId);
			continue;
		}
		for (const entry of entries) {
			if (await clearAnnotationCompareStateFromLeaf(entry.leaf)) {
				clearedAnnotationComparePanes += 1;
			}
		}
		incompleteCompareFirstSeen.delete(sessionId);
	}
	for (const sessionId of Array.from(incompleteCompareFirstSeen.keys())) {
		if (!compareEntriesBySession.has(sessionId)) {
			incompleteCompareFirstSeen.delete(sessionId);
		}
	}

	return { removedNoteSessions, clearedAnnotationComparePanes };
}

export async function restoreEpubDualWindowSessionsFromWorkspace(app: App): Promise<number> {
	await cleanupStaleEpubDualWindowSessions(app);
	let restoredCount = 0;
	for (const noteLeaf of app.workspace.getLeavesOfType("markdown")) {
		const notePath = getLeafViewFile(noteLeaf)?.path || "";
		if (!isEpubGeneratedAnnotationNotePath(notePath)) {
			continue;
		}
		const bookId = extractGeneratedAnnotationNoteBookId(notePath);
		if (!bookId) {
			continue;
		}
		const metadata = await readEpubSemanticJson(
			app,
			resolveEpubPortableBookDataLocation(bookId).bookMetadataPath
		);
		const filePathCandidates = collectBookMetadataFilePathCandidates(metadata);
		const epubLeaf = filePathCandidates
			.map((candidate) => findOpenEpubLeaf(app, candidate))
			.find((leaf): leaf is WorkspaceLeaf => Boolean(leaf));
		if (!epubLeaf || epubLeaf === noteLeaf) {
			continue;
		}
		const filePath = getOpenEpubFilePath(epubLeaf) || filePathCandidates[0] || "";
		if (!filePath) {
			continue;
		}
		const existingSession = getEpubDualWindowSession(app, filePath);
		if (
			existingSession?.mode === "book-annotation-note" &&
			cleanPath(existingSession.notePath) === cleanPath(notePath)
		) {
			markEpubDualWindowPaneRoles(epubLeaf, noteLeaf);
			continue;
		}
		registerEpubDualWindowSession(app, {
			mode: "book-annotation-note",
			bookId,
			filePath,
			notePath,
		});
		markEpubDualWindowPaneRoles(epubLeaf, noteLeaf);
		restoredCount += 1;
	}
	return restoredCount;
}

export function listOpenEpubDualWindowSessions(
	app: App,
	input: EpubDualWindowSessionLookupInput = {}
): EpubOpenDualWindowSession[] {
	const sessions: EpubOpenDualWindowSession[] = [];
	const seenNoteKeys = new Set<string>();

	for (const session of getSessionMap(app).values()) {
		if (!sessionMatchesLookup(session, input)) {
			continue;
		}
		const key = sessionKey(session.filePath);
		if (seenNoteKeys.has(key)) {
			continue;
		}
		seenNoteKeys.add(key);
		const mainLeaf = findOpenEpubLeaf(app, session.filePath);
		const sideLeaf = findMarkdownLeafByPath(app, session.notePath);
		if (!mainLeaf || !sideLeaf || mainLeaf === sideLeaf) {
			unregisterEpubDualWindowSession(app, session.filePath);
			continue;
		}
		sessions.push({
			mode: session.mode,
			bookId: session.bookId,
			filePath: session.filePath,
			notePath: session.notePath,
			sideKind: "markdown",
			mainLeaf,
			sideLeaf,
			complete: true,
		});
	}

	const compareEntriesBySession = new Map<
		string,
		Array<{ leaf: WorkspaceLeaf; context: EpubAnnotationCompareContext }>
	>();
	for (const leaf of getAllOpenEpubLeaves(app)) {
		const context = readAnnotationCompareContextFromLeaf(leaf);
		if (!context || !sessionMatchesLookup(context, input)) {
			continue;
		}
		const entries = compareEntriesBySession.get(context.sessionId) || [];
		entries.push({ leaf, context });
		compareEntriesBySession.set(context.sessionId, entries);
	}

	for (const [sessionId, entries] of compareEntriesBySession.entries()) {
		const editable = entries.find((entry) => entry.context.paneRole === "editable") || null;
		const readonly = entries.find((entry) => entry.context.paneRole === "readonly") || null;
		const source = editable?.context || readonly?.context || entries[0]?.context;
		if (!source) {
			continue;
		}
		sessions.push({
			mode: "annotation-compare",
			sessionId,
			bookId: source.bookId,
			filePath: source.filePath,
			sideKind: "epub",
			mainLeaf: editable?.leaf || null,
			sideLeaf: readonly?.leaf || null,
			complete: Boolean(editable?.leaf && readonly?.leaf && editable.leaf !== readonly.leaf),
		});
	}

	return sessions;
}

export function resolveEpubDualWindowOpenGuard(
	app: App,
	input: EpubDualWindowOpenGuardInput
): EpubDualWindowOpenGuardResult {
	const currentAnnotationCompare = normalizeEpubAnnotationCompareContext(input.currentAnnotationCompare);
	if (currentAnnotationCompare?.paneRole === "readonly") {
		return { action: "blocked-side-pane" };
	}

	const existingSession = listOpenEpubDualWindowSessions(app, input)
		.filter((session) => session.complete)
		.sort((left, right) => Number(right.complete) - Number(left.complete))[0];
	if (!existingSession) {
		return { action: "open" };
	}
	if (existingSession.mode === input.requestedMode) {
		return {
			action: input.requestedMode === "annotation-compare"
				? "change-annotation-compare-versions"
				: "reveal-existing",
			existingSession,
		};
	}
	return { action: "replace-existing", existingSession };
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
