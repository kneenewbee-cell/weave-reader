/**
 * Create elements in arbitrary Document trees (Obsidian UI vs EPUB/XML iframe).
 * Prefer doc.win.create* when Obsidian patches the document; fall back for raw iframe docs.
 */

export function createDivInDocument(doc: Document): HTMLDivElement {
	if (typeof doc.win?.createDiv === "function") {
		return doc.win.createDiv();
	}
	return doc.createElement("div");
}

export function createSpanInOwnerDocument(ownerDocument: Document): HTMLSpanElement {
	if (typeof ownerDocument.win?.createSpan === "function") {
		return ownerDocument.win.createSpan();
	}
	return ownerDocument.createElement("span");
}
