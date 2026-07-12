import type { ReaderFootnotePreviewInfo, ReaderFrame } from "./reader-engine-types";
import type {
	FoliateResolvedTarget,
	FoliateVaultPublicationParser,
} from "./FoliateVaultPublicationParser";
import { createDivInDocument } from "../../utils/obsidian-document-dom";
import { domInstanceOf } from "../../utils/dom-instance-of";
import { logger } from "../../utils/logger";

function logFootnoteDiag(message: string, ...args: unknown[]): void {
	logger.debugWithTag("FootnoteDiag", message, ...args);
}

const EPUB_OPS_NAMESPACE = "http://www.idpf.org/2007/ops";
const FOOTNOTE_BACKREF_SELECTOR =
	"a.footnote-backref, a[href*='#fnref'], a[href*='#ref'], [role='doc-backlink']";
const FOOTNOTE_CONTAINER_TAGS = new Set([
	"li",
	"aside",
	"section",
	"article",
	"dd",
	"dt",
	"blockquote",
	"p",
	"div",
	"span",
]);
const FOOTNOTE_SEMANTIC_ROLE_VALUES = new Set([
	"doc-footnote",
	"doc-endnote",
	"doc-footnotes",
	"doc-endnotes",
]);
const FOOTNOTE_SEMANTIC_TYPE_VALUES = new Set([
	"footnote",
	"footnotes",
	"endnote",
	"endnotes",
	"rearnote",
	"rearnotes",
]);
const FOOTNOTE_KEYWORD_PATTERN =
	/(?:footnote|footnotes|endnote|endnotes|rearnote|rearnotes|backnote|backnotes|notes?)/i;

type FootnotePreviewParser = Pick<
	FoliateVaultPublicationParser,
	| "resolveHrefAgainst"
	| "resolveNavigationTarget"
	| "findFragmentTargetAcrossSections"
	| "getSectionHrefByIndex"
	| "findFragmentTargetInDocument"
	| "getRawDocumentByHref"
>;

export type FootnotePreviewVisibleFrame = {
	index: number;
	href: string;
	frameDocument: Document;
	frameElement: HTMLElement | null;
	frame: ReaderFrame;
};

type FootnotePreviewResolverDeps = {
	parser: FootnotePreviewParser;
	getCurrentChapterHref: () => string;
	getSectionHrefForDocument: (doc: Document) => string;
	getVisibleFrames: () => FootnotePreviewVisibleFrame[];
	createViewportRectFromElement: (
		doc: Document,
		element: Element
	) => ReaderFootnotePreviewInfo["rect"] | null;
	candidateTimeoutMs: number;
};

type FootnotePreviewControllerDeps = {
	buildPendingPreviewInfo: (
		doc: Document,
		anchor: HTMLAnchorElement,
		rectOverride?: ReaderFootnotePreviewInfo["rect"]
	) => ReaderFootnotePreviewInfo | null;
	buildStatusPreviewInfo: (
		doc: Document,
		anchor: HTMLAnchorElement,
		text: string,
		rectOverride?: ReaderFootnotePreviewInfo["rect"]
	) => ReaderFootnotePreviewInfo | null;
	resolvePreviewInfo: (
		doc: Document,
		anchor: HTMLAnchorElement,
		rectOverride?: ReaderFootnotePreviewInfo["rect"]
	) => Promise<ReaderFootnotePreviewInfo | null>;
	notifyPreview: (info: ReaderFootnotePreviewInfo | null) => void;
	resolveTimeoutMs: number;
};

type FootnotePreviewEmitOptions = {
	pinned?: boolean;
	suppressRelocateMs?: number;
	rectOverride?: ReaderFootnotePreviewInfo["rect"];
};

type ScoredPreviewCandidate = {
	element: Element;
	text: string;
	score: number;
};

export class FootnotePreviewResolver {
	private readonly parser: FootnotePreviewParser;

	constructor(private readonly deps: FootnotePreviewResolverDeps) {
		this.parser = deps.parser;
	}

	isFootnoteReference(anchor: HTMLAnchorElement): boolean {
		const href = String(anchor.getAttribute("href") || "").trim();
		if (!href.includes("#")) {
			return false;
		}
		const rel = String(anchor.getAttribute("rel") || "").toLowerCase();
		const ariaDescribedBy = String(anchor.getAttribute("aria-describedby") || "").toLowerCase();
		const ariaLabel = String(anchor.getAttribute("aria-label") || "").toLowerCase();
		const title = String(anchor.getAttribute("title") || "").toLowerCase();
		const labelText = String(anchor.textContent || "")
			.replace(/\s+/g, " ")
			.trim()
			.toLowerCase();
		const hrefPath = this.extractHrefPath(href, this.deps.getCurrentChapterHref()).toLowerCase();
		const fragment = this.extractHrefFragment(href).toLowerCase();
		const signals = [
			anchor.getAttribute("role") || "",
			anchor.getAttribute("epub:type") || "",
			anchor.getAttribute("type") || "",
			anchor.className || "",
			rel,
			ariaDescribedBy,
			ariaLabel,
			title,
		]
			.join(" ")
			.toLowerCase();
		if (
			signals.includes("noteref") ||
			signals.includes("footnote") ||
			signals.includes("endnote")
		) {
			return true;
		}
		if (/(?:^|[\\/_-])(footnote|endnote|notes?)(?:[\\/_.-]|$)/i.test(hrefPath)) {
			return true;
		}
		if (/(?:^|[-_:.])(fn|footnote|endnote|note|zhu|zhushi|zhushi)\d*/i.test(fragment)) {
			return true;
		}
		if (/^(?:\[?\d+\]?|[*†‡§])$/.test(labelText) && /#(?:[a-z_-]*\d+)?$/i.test(href)) {
			return true;
		}
		return false;
	}

	buildPendingPreviewInfo(
		doc: Document,
		anchor: HTMLAnchorElement,
		rectOverride?: ReaderFootnotePreviewInfo["rect"]
	): ReaderFootnotePreviewInfo | null {
		const href = String(anchor.getAttribute("href") || "").trim();
		if (!href) {
			return null;
		}
		const rect = rectOverride || this.deps.createViewportRectFromElement(doc, anchor);
		if (!rect) {
			return null;
		}
		return {
			href,
			label:
				String(anchor.textContent || "")
					.replace(/\s+/g, " ")
					.trim() || "脚注",
			text: "脚注内容加载中…",
			rect,
		};
	}

	buildStatusPreviewInfo(
		doc: Document,
		anchor: HTMLAnchorElement,
		text: string,
		rectOverride?: ReaderFootnotePreviewInfo["rect"]
	): ReaderFootnotePreviewInfo | null {
		const pendingInfo = this.buildPendingPreviewInfo(doc, anchor, rectOverride);
		return pendingInfo ? { ...pendingInfo, text } : null;
	}

	async buildPreviewInfo(
		doc: Document,
		anchor: HTMLAnchorElement,
		rectOverride?: ReaderFootnotePreviewInfo["rect"]
	): Promise<ReaderFootnotePreviewInfo | null> {
		const href = String(anchor.getAttribute("href") || "").trim();
		const label =
			String(anchor.textContent || "")
				.replace(/\s+/g, " ")
				.trim() || "脚注";
		if (!href) {
			logger.debugWithTag(
				"FoliateReaderService",
				"Skipped footnote preview because anchor href is empty"
			);
			return null;
		}
		const rect = rectOverride || this.deps.createViewportRectFromElement(doc, anchor);
		if (!rect) {
			logger.debugWithTag(
				"FoliateReaderService",
				"Skipped footnote preview because anchor rect was empty",
				{
					href,
				}
			);
			return null;
		}
		const resolvedHrefCandidates = this.buildFootnoteHrefCandidates(doc, href);
		const directTarget = await this.findFootnoteTargetFromCandidates(doc, resolvedHrefCandidates);
		if (directTarget) {
			logFootnoteDiag(
				`Direct footnote target resolution succeeded href=${href} tagName=${directTarget.tagName} candidatesCount=${String(resolvedHrefCandidates.length)}`
			);
			const directPreview = this.buildPreviewInfoFromTarget({
				href,
				label,
				rect,
				target: directTarget,
				rangeText: "",
			});
			if (directPreview) {
				return directPreview;
			}
		}
		const {
			href: resolvedHref,
			target: resolvedTarget,
			candidates: navigationCandidates,
		} = await this.resolveFootnoteNavigationTarget(doc, href);
		logFootnoteDiag(
			`resolveFootnoteNavigationTarget result href=${href} resolvedHref=${resolvedHref} hasTarget=${String(Boolean(resolvedTarget))} hasDoc=${String(Boolean(resolvedTarget?.doc))} hasRange=${String(Boolean(resolvedTarget?.range))} candidatesCount=${String(navigationCandidates.length)}`
		);
		const rangeText = this.extractNormalizedFootnoteTextFromRange(resolvedTarget?.range || null);
		const hasMeaningfulRangeText = this.isMeaningfulFootnotePreviewText(rangeText, label);
		logFootnoteDiag(
			`Range extraction rangeTextLen=${String(rangeText.length)} hasMeaningful=${String(hasMeaningfulRangeText)}`
		);
		const footnoteTarget =
			this.resolveFootnoteTargetElementFromResolvedTarget(resolvedTarget, resolvedHref) ||
			directTarget ||
			(await this.findFootnoteTargetFromCandidates(doc, [resolvedHref, ...navigationCandidates]));
		logFootnoteDiag(
			`Footnote target resolution hasTarget=${String(Boolean(footnoteTarget))} tagName=${footnoteTarget?.tagName || "none"}`
		);
		if (!footnoteTarget) {
			logger.debugWithTag(
				"FoliateReaderService",
				"Skipped footnote preview because no target element was found",
				{
					href,
					resolvedHref,
				}
			);
			return {
				href,
				label,
				text: hasMeaningfulRangeText
					? this.truncateFootnotePreviewText(this.stripLeadingFootnoteLabel(rangeText, label))
					: "未找到脚注内容",
				rect,
			};
		}
		const previewFromTarget = this.buildPreviewInfoFromTarget({
			href,
			label,
			rect,
			target: footnoteTarget,
			rangeText,
		});
		if (previewFromTarget) {
			return previewFromTarget;
		}
		if (hasMeaningfulRangeText) {
			return {
				href,
				label,
				text: this.truncateFootnotePreviewText(this.stripLeadingFootnoteLabel(rangeText, label)),
				rect,
			};
		}
		return {
			href,
			label,
			text: "脚注内容暂时无法解析",
			rect,
		};
	}

	private buildPreviewInfoFromTarget(options: {
		href: string;
		label: string;
		rect: ReaderFootnotePreviewInfo["rect"];
		target: Element;
		rangeText: string;
	}): ReaderFootnotePreviewInfo | null {
		const { href, label, rect, target, rangeText } = options;
		const hasMeaningfulRangeText = this.isMeaningfulFootnotePreviewText(rangeText, label);
		const previewElement = this.resolveFootnotePreviewContentElement(target, label);
		if (!previewElement) {
			logger.debugWithTag(
				"FoliateReaderService",
				"Skipped footnote preview because target did not resolve to a readable container",
				{
					href,
					tagName: target.tagName,
				}
			);
			if (hasMeaningfulRangeText) {
				return {
					href,
					label,
					text: this.truncateFootnotePreviewText(this.stripLeadingFootnoteLabel(rangeText, label)),
					rect,
				};
			}
			return null;
		}
		const normalizedText = this.getNormalizedFootnoteElementText(previewElement);
		if (!normalizedText) {
			logger.debugWithTag(
				"FoliateReaderService",
				"Skipped footnote preview because normalized footnote text was empty",
				{
					href,
					tagName: previewElement.tagName,
				}
			);
			if (hasMeaningfulRangeText) {
				return {
					href,
					label,
					text: this.truncateFootnotePreviewText(this.stripLeadingFootnoteLabel(rangeText, label)),
					rect,
				};
			}
			return null;
		}
		const cleanedText = this.stripLeadingFootnoteLabel(normalizedText, label);
		return {
			href,
			label,
			text: this.truncateFootnotePreviewText(cleanedText),
			rect,
		};
	}

	private getSectionHrefForDocument(doc: Document): string {
		return this.deps.getSectionHrefForDocument(doc) || this.deps.getCurrentChapterHref() || "";
	}

	private resolveHrefAgainstDocument(doc: Document, href: string): string {
		const normalizedHref = String(href || "").trim();
		if (!normalizedHref) {
			return "";
		}
		const baseHref = this.getSectionHrefForDocument(doc) || this.deps.getCurrentChapterHref() || normalizedHref;
		return this.parser.resolveHrefAgainst(baseHref, normalizedHref);
	}

	private buildFootnoteHrefCandidates(doc: Document, href: string): string[] {
		const rawHref = String(href || "").trim();
		if (!rawHref) {
			return [];
		}
		const candidates = new Set<string>();
		const push = (value: string | null | undefined) => {
			const normalizedValue = String(value || "").trim();
			if (!normalizedValue) {
				return;
			}
			candidates.add(normalizedValue);
		};

		push(rawHref);
		push(this.resolveHrefAgainstDocument(doc, rawHref));

		const currentSectionHref = this.getSectionHrefForDocument(doc);
		const rawPath = this.extractHrefPath(rawHref, currentSectionHref);
		const fragment = this.extractHrefFragment(rawHref);
		const rawFileName = rawPath.split("/").pop() || rawPath;
		const visibleFrames = this.deps.getVisibleFrames();
		for (const frame of visibleFrames) {
			if (!rawFileName) {
				continue;
			}
			const frameHref = String(frame.href || "").trim();
			if (!frameHref) {
				continue;
			}
			const frameFileName = frameHref.split("/").pop() || frameHref;
			if (frameFileName === rawFileName || frameHref.endsWith(`/${rawFileName}`)) {
				push(fragment ? `${frameHref}#${fragment}` : frameHref);
			}
		}

		if (rawFileName) {
			for (let index = 0; index < 2000; index += 1) {
				const sectionHref = this.parser.getSectionHrefByIndex(index);
				if (!sectionHref) {
					if (index > visibleFrames.length + 64) {
						break;
					}
					continue;
				}
				const sectionFileName = sectionHref.split("/").pop() || sectionHref;
				if (sectionFileName === rawFileName || sectionHref.endsWith(`/${rawFileName}`)) {
					push(fragment ? `${sectionHref}#${fragment}` : sectionHref);
				}
			}
		}

		return Array.from(candidates);
	}

	private async resolveFootnoteNavigationTarget(
		doc: Document,
		href: string
	): Promise<{ href: string; target: FoliateResolvedTarget | null; candidates: string[] }> {
		const candidates = this.buildFootnoteHrefCandidates(doc, href);
		for (const candidate of candidates) {
			try {
				const target = await this.withTimeout(
					this.parser.resolveNavigationTarget(candidate),
					this.deps.candidateTimeoutMs,
					`Footnote navigation resolve timed out for ${candidate}`
				);
				if (target?.doc || target?.range || target?.href) {
					logFootnoteDiag(
						`resolveNavigationTarget succeeded candidate=${candidate} hasDoc=${String(Boolean(target.doc))} hasRange=${String(Boolean(target.range))}`
					);
					return { href: candidate, target, candidates };
				}
			} catch (error) {
				logFootnoteDiag(`Failed to resolve footnote navigation candidate href=${candidate}`, error);
			}
		}
		const fragment = this.extractHrefFragment(href);
		if (fragment) {
			try {
				logFootnoteDiag(
					`Attempting cross-section fragment search fragment=${fragment} candidatesCount=${String(candidates.length)}`
				);
				const crossSectionResult = await this.withTimeout(
					this.parser.findFragmentTargetAcrossSections(fragment, candidates),
					this.deps.candidateTimeoutMs * 2,
					`Cross-section fragment search timed out for ${fragment}`
				);
				if (crossSectionResult?.element && crossSectionResult.doc) {
					logFootnoteDiag(
						`Cross-section fragment search succeeded fragment=${fragment} index=${String(crossSectionResult.index)} tagName=${crossSectionResult.element.tagName}`
					);
					const range = this.createRangeForFootnoteElement(
						crossSectionResult.doc,
						crossSectionResult.element
					);
					return {
						href: crossSectionResult.href,
						target: {
							cfi: null,
							index: crossSectionResult.index,
							href: crossSectionResult.href,
							doc: crossSectionResult.doc,
							range,
						},
						candidates,
					};
				}
			} catch (error) {
				logFootnoteDiag(`Cross-section fragment search failed fragment=${fragment}`, error);
			}
		}
		return {
			href: candidates[0] || href,
			target: null,
			candidates,
		};
	}

	private resolveFootnoteTargetElementFromResolvedTarget(
		resolvedTarget: FoliateResolvedTarget | null,
		href: string
	): Element | null {
		const resolvedDoc = resolvedTarget?.doc;
		if (!resolvedDoc) {
			return null;
		}
		const fragment = this.extractHrefFragment(href) || this.extractHrefFragment(resolvedTarget.href || "");
		if (fragment) {
			const fragmentMatch = this.findFootnoteTargetInDocument(resolvedDoc, fragment);
			if (fragmentMatch) {
				return fragmentMatch;
			}
		}
		const rangeElement = this.getElementFromRange(resolvedTarget.range);
		if (!rangeElement) {
			return null;
		}
		const tagName = rangeElement.tagName.toLowerCase();
		if (tagName === "body" || tagName === "html") {
			return null;
		}
		return rangeElement;
	}

	private getElementFromRange(range: Range | null): Element | null {
		if (!range) {
			return null;
		}
		const container = range.commonAncestorContainer;
		if (!container) {
			return null;
		}
		if (domInstanceOf(container, Element)) {
			return container;
		}
		return container.parentElement ?? null;
	}

	private extractNormalizedFootnoteTextFromRange(range: Range | null): string {
		if (!range) {
			return "";
		}
		try {
			const fragment = range.cloneContents();
			const ownerDocument = range.commonAncestorContainer.ownerDocument || activeDocument;
			const container = createDivInDocument(ownerDocument);
			container.appendChild(fragment);
			container.querySelectorAll(FOOTNOTE_BACKREF_SELECTOR).forEach((element) => element.remove());
			return this.normalizeFootnotePreviewText(container.textContent);
		} catch {
			return this.normalizeFootnotePreviewText(range.toString());
		}
	}

	private normalizeFootnotePreviewText(text: string | null | undefined): string {
		return String(text || "")
			.replace(/\s+/g, " ")
			.trim();
	}

	private createRangeForFootnoteElement(doc: Document, element: Element): Range | null {
		if (!doc || !element) {
			return null;
		}
		try {
			const range = doc.createRange();
			range.selectNodeContents(element);
			return range;
		} catch {
			return null;
		}
	}

	private normalizeComparableFootnoteLabel(text: string | null | undefined): string {
		return String(text || "")
			.replace(/\s+/g, "")
			.replace(/^[[(（【〔「『]+/, "")
			.replace(/[\])）】〕」』.,;:、，。]+$/g, "")
			.toLowerCase();
	}

	private isMeaningfulFootnotePreviewText(text: string, label?: string): boolean {
		const normalizedText = this.normalizeFootnotePreviewText(text);
		if (!normalizedText) {
			return false;
		}
		const comparableText = this.normalizeComparableFootnoteLabel(normalizedText);
		const comparableLabel = this.normalizeComparableFootnoteLabel(label);
		if (comparableText && comparableLabel && comparableText === comparableLabel) {
			return false;
		}
		return !/^[[(（【〔「『\])）】〕」』*†‡§#\d\s.,;:!?、，。．·‧…-]+$/.test(normalizedText);
	}

	private truncateFootnotePreviewText(text: string): string {
		return text.length > 220 ? `${text.slice(0, 220).trimEnd()}…` : text;
	}

	private stripLeadingFootnoteLabel(text: string, label?: string): string {
		const normalizedText = this.normalizeFootnotePreviewText(text);
		const comparableLabel = this.normalizeComparableFootnoteLabel(label);
		if (!normalizedText || !comparableLabel) {
			return normalizedText;
		}
		const escapedLabel = this.escapeRegExp(comparableLabel);
		const prefixPattern = new RegExp(
			`^[\\s[(（【〔「『<]*${escapedLabel}[\\s\\])）】〕」』>.:：;；、，。．·‧…-]*`,
			"i"
		);
		let cleanedText = normalizedText;
		for (let iteration = 0; iteration < 2; iteration += 1) {
			const next = cleanedText.replace(prefixPattern, "").trim();
			if (!next || next === cleanedText) {
				break;
			}
			cleanedText = next;
		}
		return cleanedText;
	}

	private escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	private getNormalizedFootnoteElementText(element: Element): string {
		const clone = element.cloneNode(true);
		if (!domInstanceOf(clone, Element)) {
			return this.normalizeFootnotePreviewText(element.textContent);
		}
		clone.querySelectorAll(FOOTNOTE_BACKREF_SELECTOR).forEach((entry) => entry.remove());
		return this.normalizeFootnotePreviewText(clone.textContent);
	}

	private resolveFootnotePreviewContentElement(target: Element, label?: string): Element | null {
		let bestCandidate: ScoredPreviewCandidate | null = null;
		for (const candidate of this.collectFootnoteContentCandidates(target)) {
			const scored = this.scoreFootnoteContentCandidate(candidate, target, label);
			if (!scored) {
				continue;
			}
			if (!bestCandidate || scored.score > bestCandidate.score) {
				bestCandidate = scored;
			}
		}
		return bestCandidate?.element || null;
	}

	private collectFootnoteContentCandidates(target: Element): Element[] {
		const candidates: Element[] = [];
		const visited = new Set<Element>();
		const enqueue = (candidate: Element | null | undefined) => {
			if (!candidate || visited.has(candidate)) {
				return;
			}
			visited.add(candidate);
			candidates.push(candidate);
		};

		enqueue(target);
		enqueue(this.findClosestFootnoteContainer(target));

		let current: Element | null = target;
		for (let depth = 0; current && depth < 4; depth += 1) {
			enqueue(current.parentElement);
			enqueue(this.findClosestFootnoteContainer(current.parentElement));
			enqueue(current.nextElementSibling);
			enqueue(current.previousElementSibling);
			enqueue(current.parentElement?.nextElementSibling);
			enqueue(current.parentElement?.previousElementSibling);
			current = current.parentElement;
		}

		for (const descendant of this.collectDescendantFootnoteContainers(target, 24)) {
			enqueue(descendant);
		}

		return candidates;
	}

	private scoreFootnoteContentCandidate(
		candidate: Element,
		target: Element,
		label?: string
	): ScoredPreviewCandidate | null {
		const text = this.getNormalizedFootnoteElementText(candidate);
		if (!this.isMeaningfulFootnotePreviewText(text, label)) {
			return null;
		}
		const tagName = candidate.tagName.toLowerCase();
		const looksLikeAnchorOnly =
			tagName === "a" && candidate.children.length === 0 && text.length <= 8;
		if (looksLikeAnchorOnly) {
			return null;
		}
		let score = 0;
		if (candidate === target) {
			score += 32;
		}
		if (candidate.contains(target)) {
			score += 24;
		}
		if (this.isSemanticFootnoteElement(candidate)) {
			score += 36;
		}
		if (candidate.querySelector(FOOTNOTE_BACKREF_SELECTOR)) {
			score += 10;
		}
		score += this.scoreTagName(tagName);
		score += this.scoreTextLength(text.length);
		score -= this.computeDomDistance(target, candidate) * 4;
		const comparableText = this.normalizeComparableFootnoteLabel(text);
		const comparableLabel = this.normalizeComparableFootnoteLabel(label);
		if (comparableText && comparableLabel && comparableText.startsWith(comparableLabel)) {
			score += 6;
		}
		if (candidate.querySelector("p, li, dd, blockquote")) {
			score += 6;
		}
		return {
			element: candidate,
			text,
			score,
		};
	}

	private scoreTagName(tagName: string): number {
		switch (tagName) {
			case "li":
				return 34;
			case "p":
				return 26;
			case "dd":
				return 22;
			case "blockquote":
				return 18;
			case "aside":
			case "article":
				return 16;
			case "section":
				return 12;
			case "div":
				return 8;
			case "span":
				return -4;
			default:
				return 0;
		}
	}

	private scoreTextLength(length: number): number {
		if (length >= 8 && length <= 320) {
			return 22;
		}
		if (length <= 520) {
			return 10;
		}
		if (length <= 900) {
			return -4;
		}
		return -Math.min(36, Math.floor((length - 900) / 80) + 8);
	}

	private computeDomDistance(target: Element, candidate: Element): number {
		let distance = 0;
		let current: Element | null = target;
		while (current) {
			if (current === candidate) {
				return distance;
			}
			current = current.parentElement;
			distance += 1;
		}
		current = candidate;
		while (current) {
			if (current === target) {
				return distance;
			}
			current = current.parentElement;
			distance += 1;
		}
		return distance + 4;
	}

	private collectDescendantFootnoteContainers(root: Element, limit: number): Element[] {
		const results: Element[] = [];
		for (const descendant of Array.from(root.getElementsByTagName("*"))) {
			if (!this.isFootnoteContainerCandidate(descendant)) {
				continue;
			}
			results.push(descendant);
			if (results.length >= limit) {
				break;
			}
		}
		return results;
	}

	private findClosestFootnoteContainer(element: Element | null | undefined): Element | null {
		let current = element || null;
		while (current) {
			if (this.isFootnoteContainerCandidate(current)) {
				return current;
			}
			current = current.parentElement;
		}
		return null;
	}

	private isFootnoteContainerCandidate(element: Element): boolean {
		return this.isSemanticFootnoteElement(element) || FOOTNOTE_CONTAINER_TAGS.has(element.tagName.toLowerCase());
	}

	private isSemanticFootnoteElement(element: Element): boolean {
		const role = String(element.getAttribute("role") || "")
			.trim()
			.toLowerCase();
		if (FOOTNOTE_SEMANTIC_ROLE_VALUES.has(role)) {
			return true;
		}
		const semanticType = this.getSemanticAttributeValue(element, "type");
		const semanticTokens = semanticType
			.split(/\s+/)
			.map((token) => token.trim().toLowerCase())
			.filter(Boolean);
		if (semanticTokens.some((token) => FOOTNOTE_SEMANTIC_TYPE_VALUES.has(token))) {
			return true;
		}
		const className = String(element.getAttribute("class") || "").trim();
		const id = String(element.getAttribute("id") || element.getAttribute("xml:id") || "").trim();
		return FOOTNOTE_KEYWORD_PATTERN.test(className) || FOOTNOTE_KEYWORD_PATTERN.test(id);
	}

	private getSemanticAttributeValue(element: Element, localName: string): string {
		return String(
			element.getAttribute(`epub:${localName}`) ||
				element.getAttribute(localName) ||
				element.getAttributeNS(EPUB_OPS_NAMESPACE, localName) ||
				""
		)
			.trim()
			.toLowerCase();
	}

	private async findFootnoteTargetFromCandidates(
		doc: Document,
		candidates: string[]
	): Promise<Element | null> {
		const uniqueCandidates = Array.from(
			new Set(
				candidates
					.map((candidate) => String(candidate || "").trim())
					.filter((candidate) => candidate.length > 0)
			)
		);
		for (const candidate of uniqueCandidates) {
			try {
				const target = await this.withTimeout(
					this.findFootnoteTarget(doc, candidate),
					this.deps.candidateTimeoutMs,
					`Footnote target lookup timed out for ${candidate}`
				);
				if (target) {
					return target;
				}
			} catch (error) {
				logFootnoteDiag(`Failed fallback footnote target lookup href=${candidate}`, error);
			}
		}
		const fallbackFragment = this.extractHrefFragment(uniqueCandidates[0] || "");
		if (!fallbackFragment) {
			return null;
		}
		try {
			const fallback = await this.withTimeout(
				this.parser.findFragmentTargetAcrossSections(fallbackFragment, uniqueCandidates),
				this.deps.candidateTimeoutMs * 2,
				`Footnote whole-book fragment lookup timed out for ${fallbackFragment}`
			);
			if (fallback?.element) {
				logger.debugWithTag(
					"FoliateReaderService",
					"Recovered footnote target from parser whole-book fragment fallback",
					{
						fragment: fallbackFragment,
						href: fallback.href,
						index: fallback.index,
						tagName: fallback.element.tagName,
					}
				);
				return fallback.element;
			}
		} catch (error) {
			logFootnoteDiag(`Failed whole-book footnote fragment lookup fragment=${fallbackFragment}`, error);
		}
		return null;
	}

	private async findFootnoteTarget(doc: Document, href: string): Promise<Element | null> {
		const fragment = this.extractHrefFragment(href);
		if (!fragment) {
			return null;
		}
		const visibleFrames = this.deps.getVisibleFrames();
		const currentSectionHref = this.getSectionHrefForDocument(doc);
		const preferredPath = this.extractHrefPath(href, currentSectionHref);
		const candidateFrames = preferredPath
			? visibleFrames.filter(
					(frame) => frame.href.endsWith(preferredPath) || preferredPath.endsWith(frame.href)
			  )
			: [];
		const documents = [
			doc,
			...candidateFrames.map((frame) => frame.frameDocument),
			...visibleFrames.map((frame) => frame.frameDocument).filter((frameDoc) => frameDoc !== doc),
		];
		for (const frameDoc of documents) {
			const element = this.findFootnoteTargetInDocument(frameDoc, fragment);
			if (element) {
				logger.debugWithTag("FoliateReaderService", "Matched footnote target in visible document", {
					href,
					fragment,
					tagName: element.tagName,
				});
				return element;
			}
		}
		if (preferredPath) {
			const externalDoc = await this.parser.getRawDocumentByHref(preferredPath);
			if (externalDoc) {
				const element = this.findFootnoteTargetInDocument(externalDoc, fragment);
				if (element) {
					logger.debugWithTag(
						"FoliateReaderService",
						"Matched footnote target in external document",
						{
							href,
							fragment,
							preferredPath,
							tagName: element.tagName,
						}
					);
					return element;
				}
			}
		}
		logger.debugWithTag(
			"FoliateReaderService",
			"Failed to resolve footnote target from any document",
			{
				href,
				fragment,
				preferredPath,
			}
		);
		return null;
	}

	private extractHrefPath(href: string, baseHref = this.deps.getCurrentChapterHref()): string {
		const hashIndex = href.indexOf("#");
		if (hashIndex <= 0) {
			return "";
		}
		const rawPath = href.slice(0, hashIndex).split(/[?#]/)[0].trim();
		if (!rawPath) {
			return "";
		}
		return this.parser.resolveHrefAgainst(baseHref || rawPath, rawPath);
	}

	private extractHrefFragment(href: string): string {
		const hashIndex = href.indexOf("#");
		if (hashIndex < 0 || hashIndex === href.length - 1) {
			return "";
		}
		const fragment = href.slice(hashIndex + 1).trim();
		if (!fragment) {
			return "";
		}
		try {
			return decodeURIComponent(fragment);
		} catch {
			return fragment;
		}
	}

	private findFootnoteTargetInDocument(doc: Document, fragment: string): Element | null {
		return this.parser.findFragmentTargetInDocument(doc, fragment);
	}

	private withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutLabel: string): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			let settled = false;
			const timeoutHandle = window.setTimeout(() => {
				if (settled) {
					return;
				}
				settled = true;
				reject(new Error(timeoutLabel));
			}, timeoutMs);
			void promise
				.then((value) => {
					if (settled) {
						return;
					}
					settled = true;
					window.clearTimeout(timeoutHandle);
					resolve(value);
				})
				.catch((error) => {
					if (settled) {
						return;
					}
					settled = true;
					window.clearTimeout(timeoutHandle);
					reject(error instanceof Error ? error : new Error(String(error)));
				});
		});
	}
}

export class FootnotePreviewController {
	private requestToken = 0;
	private pinned = false;
	private relocateSuppressUntil = 0;
	private lastPinnedActivationSignature = "";
	private lastPinnedActivationAt = 0;

	constructor(private readonly deps: FootnotePreviewControllerDeps) {}

	isPinned(): boolean {
		return this.pinned;
	}

	setPinnedState(pinned: boolean): void {
		this.pinned = pinned;
		if (!pinned) {
			this.relocateSuppressUntil = 0;
			this.lastPinnedActivationSignature = "";
			this.lastPinnedActivationAt = 0;
		}
	}

	shouldPreserveOnRelocate(now = Date.now()): boolean {
		return this.pinned && now < this.relocateSuppressUntil;
	}

	emitForAnchor(
		doc: Document,
		anchor: HTMLAnchorElement,
		options?: FootnotePreviewEmitOptions
	): void {
		if (this.shouldSkipDuplicatePinnedActivation(anchor, options)) {
			this.applyPinnedState(options);
			return;
		}
		const requestToken = ++this.requestToken;
		this.applyPinnedState(options);
		if (options?.pinned) {
			this.rememberPinnedActivation(anchor);
		}
		const pendingInfo = this.deps.buildPendingPreviewInfo(doc, anchor, options?.rectOverride);
		if (pendingInfo) {
			this.notifyPreviewIfCurrent(requestToken, pendingInfo);
		}
		const timeoutInfo = this.deps.buildStatusPreviewInfo(
			doc,
			anchor,
			"脚注内容暂时无法显示",
			options?.rectOverride
		);
		let timeoutTriggered = false;
		const timeoutHandle = window.setTimeout(() => {
			timeoutTriggered = true;
			const href = anchor.getAttribute("href") || "";
			logFootnoteDiag(
				`Preview payload timed out href=${href} timeoutMs=${String(this.deps.resolveTimeoutMs)}`
			);
			if (timeoutInfo) {
				this.notifyPreviewIfCurrent(requestToken, timeoutInfo);
			}
		}, this.deps.resolveTimeoutMs);
		void this.deps
			.resolvePreviewInfo(doc, anchor, options?.rectOverride)
			.then((info) => {
				window.clearTimeout(timeoutHandle);
				const href = anchor.getAttribute("href") || "";
				logFootnoteDiag(
					`Preview payload resolved href=${href} hasInfo=${String(Boolean(info))} textLength=${String(
						info?.text.length || 0
					)}`
				);
				if (timeoutTriggered && !info) {
					return;
				}
				this.notifyPreviewIfCurrent(requestToken, info || timeoutInfo || null);
			})
			.catch((error) => {
				window.clearTimeout(timeoutHandle);
				const href = anchor.getAttribute("href") || "";
				logFootnoteDiag(`Preview payload failed href=${href}`, error);
				if (!timeoutTriggered) {
					this.notifyPreviewIfCurrent(requestToken, timeoutInfo || null);
				}
			});
	}

	dismiss(options?: { unpin?: boolean }): void {
		this.requestToken += 1;
		if (options?.unpin) {
			this.pinned = false;
			this.relocateSuppressUntil = 0;
			this.lastPinnedActivationSignature = "";
			this.lastPinnedActivationAt = 0;
		}
		this.deps.notifyPreview(null);
	}

	private applyPinnedState(options?: FootnotePreviewEmitOptions): void {
		if (!options?.pinned) {
			return;
		}
		this.pinned = true;
		const suppressRelocateMs = Math.max(0, options.suppressRelocateMs || 0);
		if (suppressRelocateMs > 0) {
			this.relocateSuppressUntil = Math.max(this.relocateSuppressUntil, Date.now() + suppressRelocateMs);
		}
	}

	private shouldSkipDuplicatePinnedActivation(
		anchor: HTMLAnchorElement,
		options?: FootnotePreviewEmitOptions
	): boolean {
		if (!options?.pinned) {
			return false;
		}
		const signature = this.buildActivationSignature(anchor);
		if (!signature) {
			return false;
		}
		return (
			signature === this.lastPinnedActivationSignature &&
			Date.now() - this.lastPinnedActivationAt <= 120
		);
	}

	private rememberPinnedActivation(anchor: HTMLAnchorElement): void {
		this.lastPinnedActivationSignature = this.buildActivationSignature(anchor);
		this.lastPinnedActivationAt = Date.now();
	}

	private buildActivationSignature(anchor: HTMLAnchorElement): string {
		const href = String(anchor.getAttribute("href") || "").trim();
		const label = String(anchor.textContent || "")
			.replace(/\s+/g, " ")
			.trim();
		return `${href}::${label}`;
	}

	private notifyPreviewIfCurrent(
		requestToken: number,
		info: ReaderFootnotePreviewInfo | null
	): void {
		if (requestToken !== this.requestToken) {
			return;
		}
		this.deps.notifyPreview(info);
	}
}
