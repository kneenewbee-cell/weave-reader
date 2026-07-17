import type { ReaderFrame, ReaderHighlightSegment } from "./reader-engine-types";

const SEGMENT_BLOCK_TAGS = new Set([
	"ADDRESS",
	"ARTICLE",
	"ASIDE",
	"BLOCKQUOTE",
	"DD",
	"DIV",
	"DL",
	"DT",
	"FIGCAPTION",
	"FIGURE",
	"FOOTER",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"HEADER",
	"LI",
	"MAIN",
	"NAV",
	"OL",
	"P",
	"PRE",
	"SECTION",
	"TD",
	"TH",
	"TR",
	"UL",
]);

type TextPiece = {
	node: Text;
	start: number;
	end: number;
	block: Element;
};

function isTextNode(node: Node | null | undefined): node is Text {
	return Boolean(node && node.nodeType === Node.TEXT_NODE);
}

function getNearestSegmentBlock(node: Node, root: Element): Element {
	let current: Node | null = isTextNode(node) ? node.parentElement : node;
	while (current && current !== root) {
		if (current instanceof Element && SEGMENT_BLOCK_TAGS.has(current.tagName.toUpperCase())) {
			return current;
		}
		current = current.parentNode;
	}
	return root;
}

function getTextPieceForRangeNode(range: Range, node: Text, root: Element): TextPiece | null {
	if (!range.intersectsNode(node)) {
		return null;
	}
	const text = node.textContent || "";
	let start = 0;
	let end = text.length;
	if (range.startContainer === node) {
		start = Math.max(0, Math.min(text.length, range.startOffset));
	}
	if (range.endContainer === node) {
		end = Math.max(0, Math.min(text.length, range.endOffset));
	}
	if (end <= start || !text.slice(start, end).trim()) {
		return null;
	}
	return {
		node,
		start,
		end,
		block: getNearestSegmentBlock(node, root),
	};
}

function collectTextPieces(range: Range, root: Element): TextPiece[] {
	const pieces: TextPiece[] = [];
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		const node = walker.currentNode as Text;
		const piece = getTextPieceForRangeNode(range, node, root);
		if (piece) {
			pieces.push(piece);
		}
	}
	return pieces;
}

function groupPiecesByBlock(pieces: TextPiece[]): TextPiece[][] {
	const groups: TextPiece[][] = [];
	let currentBlock: Element | null = null;
	for (const piece of pieces) {
		if (piece.block !== currentBlock) {
			groups.push([]);
			currentBlock = piece.block;
		}
		groups[groups.length - 1]?.push(piece);
	}
	return groups.filter((group) => group.length > 0);
}

function createRangeForPieces(doc: Document, pieces: TextPiece[]): Range | null {
	const first = pieces[0];
	const last = pieces[pieces.length - 1];
	if (!first || !last) {
		return null;
	}
	const range = doc.createRange();
	range.setStart(first.node, first.start);
	range.setEnd(last.node, last.end);
	return range;
}

export function resolveSelectionSegments(
	selection: Selection,
	frame: ReaderFrame
): ReaderHighlightSegment[] {
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
		return [];
	}
	const doc = frame.frameDocument;
	const root = doc.body || doc.documentElement;
	if (!root) {
		return [];
	}
	const segments: ReaderHighlightSegment[] = [];
	for (let index = 0; index < selection.rangeCount; index += 1) {
		const range = selection.getRangeAt(index);
		const pieces = collectTextPieces(range, root);
		for (const group of groupPiecesByBlock(pieces)) {
			const segmentRange = createRangeForPieces(doc, group);
			const text = segmentRange?.toString().trim() || "";
			if (!segmentRange || !text) {
				continue;
			}
			const cfiRange = frame.cfiFromRange(segmentRange);
			if (!cfiRange) {
				continue;
			}
			segments.push({ cfiRange, text });
		}
	}
	return segments;
}

export function shouldStoreSelectionSegments(
	segments: ReaderHighlightSegment[],
	selectionText: string
): boolean {
	if (segments.length <= 1) {
		return false;
	}
	const compactSegments = segments.map((segment) => segment.text).join("").replace(/\s+/g, "");
	const compactSelection = String(selectionText || "").replace(/\s+/g, "");
	return Boolean(compactSegments && compactSelection && compactSelection.includes(compactSegments));
}
