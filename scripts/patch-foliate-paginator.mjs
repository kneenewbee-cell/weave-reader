import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const foliateRoot = path.resolve(__dirname, "../node_modules/foliate-js");
const paginatorPath = path.join(foliateRoot, "paginator.js");
const fixedLayoutPath = path.join(foliateRoot, "fixed-layout.js");
const epubPath = path.join(foliateRoot, "epub.js");
const GROUPBY_POLYFILL_MARKER = "weave-epub-reader Object.groupBy polyfill";
const SCROLLED_RENDER_GUARD_MARKER = "weave-epub-reader scrolled render guards";

const SCROLLED_RENDER_GUARD_PATCHES = [
	{
		oldText: `const setStylesImportant = (el, styles) => {
    const { style } = el
    for (const [k, v] of Object.entries(styles)) style.setProperty(k, v, 'important')
}`,
		newText: `// ${SCROLLED_RENDER_GUARD_MARKER}
const setStylesImportant = (el, styles) => {
    if (!el?.style) return
    const { style } = el
    for (const [k, v] of Object.entries(styles)) style.setProperty(k, v, 'important')
}`,
	},
	{
		oldText: `    render(layout) {
        if (!layout || !this.document) return
        this.#column = layout.flow !== 'scrolled'`,
		newText: `    render(layout) {
        const doc = this.document
        if (!layout || !doc?.documentElement || !doc.body) return
        this.#column = layout.flow !== 'scrolled'`,
	},
	{
		oldText: `    scrolled({ margin, gap, columnWidth }) {
        const vertical = this.#vertical
        const doc = this.document
        setStylesImportant(doc.documentElement, {`,
		newText: `    scrolled({ margin, gap, columnWidth }) {
        const vertical = this.#vertical
        const doc = this.document
        if (!doc?.documentElement || !doc.body) return
        setStylesImportant(doc.documentElement, {`,
	},
	{
		oldText: `    columnize({ width, height, margin, gap, columnWidth }) {
        const vertical = this.#vertical
        this.#size = vertical ? height : width

        const doc = this.document
        setStylesImportant(doc.documentElement, {`,
		newText: `    columnize({ width, height, margin, gap, columnWidth }) {
        const vertical = this.#vertical
        this.#size = vertical ? height : width

        const doc = this.document
        if (!doc?.documentElement || !doc.body) return
        setStylesImportant(doc.documentElement, {`,
	},
	{
		oldText: `    setImageSize() {
        const { width, height, margin } = this.#layout
        const vertical = this.#vertical
        const doc = this.document
        for (const el of doc.body.querySelectorAll('img, svg, video')) {`,
		newText: `    setImageSize() {
        const { width, height, margin } = this.#layout
        const vertical = this.#vertical
        const doc = this.document
        if (!doc?.body) return
        for (const el of doc.body.querySelectorAll('img, svg, video')) {`,
	},
	{
		oldText: `    expand() {
        const { documentElement } = this.document
        if (this.#column) {`,
		newText: `    expand() {
        const doc = this.document
        if (!doc?.documentElement) return
        const { documentElement } = doc
        if (this.#column) {`,
	},
	{
		oldText: `    render() {
        if (!this.#view) return
        this.#view.render(this.#beforeRender({
            vertical: this.#vertical,
            rtl: this.#rtl,
        }))
        this.#scrollToAnchor(this.#anchor)
    }`,
		newText: `    render() {
        if (!this.#view) return
        const { width, height } = this.#container.getBoundingClientRect()
        if (width <= 0 || height <= 0) return
        this.#view.render(this.#beforeRender({
            vertical: this.#vertical,
            rtl: this.#rtl,
        }))
        this.#scrollToAnchor(this.#anchor)
    }`,
	},
];

const OLD_SET_SELECTION = `const setSelectionTo = (target, collapse) => {
    let range
    if (target.startContainer) range = target.cloneRange()
    else if (target.nodeType) {
        range = document.createRange()
        range.selectNode(target)
    }
    if (range) {
        const sel = range.startContainer.ownerDocument.defaultView.getSelection()
        sel.removeAllRanges()
        if (collapse === -1) range.collapse(true)
        else if (collapse === 1) range.collapse()
        sel.addRange(range)
    }
}`;

const NEW_SET_SELECTION = `const isLiveSelectionTarget = (target, doc) => {
    if (!doc || target == null) return false
    if (typeof target === 'number') return true
    const node = target.startContainer ?? target
    if (!node) return false
    return doc.contains(node)
}

const setSelectionTo = (target, collapse) => {
    let range
    if (target?.startContainer) range = target.cloneRange()
    else if (target?.nodeType) {
        range = document.createRange()
        range.selectNode(target)
    }
    if (!range) return
    const view = range.startContainer?.ownerDocument?.defaultView
    const selection = view?.getSelection?.()
    if (!selection) return
    selection.removeAllRanges()
    if (collapse === -1) range.collapse(true)
    else if (collapse === 1) range.collapse()
    selection.addRange(range)
}`;

const OLD_RELOCATE = `        this.addEventListener('relocate', ({ detail }) => {
            if (detail.reason === 'selection') setSelectionTo(this.#anchor, 0)
            else if (detail.reason === 'navigation') {
                if (this.#anchor === 1) setSelectionTo(detail.range, 1)
                else if (typeof this.#anchor === 'number')
                    setSelectionTo(detail.range, -1)
                else setSelectionTo(this.#anchor, -1)
            }
        })`;

const NEW_RELOCATE = `        this.addEventListener('relocate', ({ detail }) => {
            const liveDoc = this.#view?.document
            if (detail.reason === 'selection') {
                if (isLiveSelectionTarget(this.#anchor, liveDoc)) setSelectionTo(this.#anchor, 0)
            } else if (detail.reason === 'navigation') {
                if (this.#anchor === 1) setSelectionTo(detail.range, 1)
                else if (typeof this.#anchor === 'number') setSelectionTo(detail.range, -1)
                else if (isLiveSelectionTarget(this.#anchor, liveDoc)) setSelectionTo(this.#anchor, -1)
                else if (detail.range) setSelectionTo(detail.range, -1)
            }
        })`;

const SANDBOX_PATCHES = [
	{
		file: paginatorPath,
		oldText: `        // \`allow-scripts\` is needed for events because of WebKit bug
        // https://bugs.webkit.org/show_bug.cgi?id=218086
        this.#iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')`,
		newText: `        // Weave omits iframe sandbox: EPUB markup is sanitized before load.`,
	},
	{
		file: fixedLayoutPath,
		oldText: `        // \`allow-scripts\` is needed for events because of WebKit bug
        // https://bugs.webkit.org/show_bug.cgi?id=218086
        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')`,
		newText: `        // Weave omits iframe sandbox: EPUB markup is sanitized before load.`,
	},
];

function patchFile(filePath, oldText, newText, label) {
	if (!fs.existsSync(filePath)) {
		console.warn(`[patch-foliate-paginator] Skipped missing file: ${filePath}`);
		return false;
	}

	let source = fs.readFileSync(filePath, "utf8");
	if (source.includes(newText)) {
		return false;
	}
	if (!source.includes(oldText)) {
		console.error(`[patch-foliate-paginator] Unexpected ${label} contents; patch not applied`);
		process.exit(1);
	}

	fs.writeFileSync(filePath, source.replace(oldText, newText), "utf8");
	console.log(`[patch-foliate-paginator] Patched ${label}`);
	return true;
}

const MAP_GROUPBY_POLYFILL = `if (typeof Map.groupBy !== "function") {
\tMap.groupBy = (items, keySelector) => {
\t\tconst result = new Map();
\t\tfor (const item of items) {
\t\t\tconst key = keySelector(item);
\t\t\tconst bucket = result.get(key) ?? [];
\t\t\tbucket.push(item);
\t\t\tresult.set(key, bucket);
\t\t}
\t\treturn result;
\t};
}`;

const OBJECT_GROUPBY_POLYFILL = `if (typeof Object.groupBy !== "function") {
\tObject.groupBy = (items, keySelector) => {
\t\tconst result = {};
\t\tfor (const item of items) {
\t\t\tconst key = keySelector(item);
\t\t\t(result[key] ??= []).push(item);
\t\t}
\t\treturn result;
\t};
}`;

function patchScrolledRenderGuards() {
	if (!fs.existsSync(paginatorPath)) {
		return false;
	}

	let source = fs.readFileSync(paginatorPath, "utf8");
	if (source.includes(SCROLLED_RENDER_GUARD_MARKER)) {
		return false;
	}

	let changed = false;
	for (const patch of SCROLLED_RENDER_GUARD_PATCHES) {
		if (!source.includes(patch.oldText)) {
			console.error(
				"[patch-foliate-paginator] Unexpected foliate-js/paginator.js contents; scrolled render guard patch not applied"
			);
			process.exit(1);
		}
		source = source.replace(patch.oldText, patch.newText);
		changed = true;
	}

	if (!changed) {
		return false;
	}

	fs.writeFileSync(paginatorPath, source, "utf8");
	console.log(
		`[patch-foliate-paginator] Patched foliate-js/paginator.js ${SCROLLED_RENDER_GUARD_MARKER}`
	);
	return true;
}

function patchEpubGroupByPolyfill() {
	if (!fs.existsSync(epubPath)) {
		console.warn(`[patch-foliate-paginator] Skipped: ${epubPath} not found`);
		return false;
	}

	let source = fs.readFileSync(epubPath, "utf8");
	let changed = false;

	if (!source.includes(GROUPBY_POLYFILL_MARKER)) {
		const prefix = `// ${GROUPBY_POLYFILL_MARKER}
${OBJECT_GROUPBY_POLYFILL}
${MAP_GROUPBY_POLYFILL}

`;
		source = prefix + source;
		changed = true;
	} else if (!source.includes("typeof Map.groupBy")) {
		source = source.replace(
			/(if \(typeof Object\.groupBy[\s\S]*?\n\})\n/,
			`$1\n${MAP_GROUPBY_POLYFILL}\n`
		);
		changed = true;
	}

	if (!changed) {
		return false;
	}

	fs.writeFileSync(epubPath, source, "utf8");
	console.log("[patch-foliate-paginator] Patched foliate-js/epub.js groupBy polyfills");
	return true;
}

if (!fs.existsSync(paginatorPath)) {
	console.warn(`[patch-foliate-paginator] Skipped: ${paginatorPath} not found`);
	process.exit(0);
}

let changed = false;

if (patchEpubGroupByPolyfill()) {
	changed = true;
}

if (patchScrolledRenderGuards()) {
	changed = true;
}

if (!fs.readFileSync(paginatorPath, "utf8").includes("isLiveSelectionTarget")) {
	if (!fs.readFileSync(paginatorPath, "utf8").includes(OLD_SET_SELECTION)) {
		console.error("[patch-foliate-paginator] Unexpected foliate-js/paginator.js contents; patch not applied");
		process.exit(1);
	}
	let source = fs.readFileSync(paginatorPath, "utf8");
	source = source.replace(OLD_SET_SELECTION, NEW_SET_SELECTION).replace(OLD_RELOCATE, NEW_RELOCATE);
	fs.writeFileSync(paginatorPath, source, "utf8");
	console.log("[patch-foliate-paginator] Patched foliate-js/paginator.js selection guards");
	changed = true;
}

for (const patch of SANDBOX_PATCHES) {
	if (patchFile(patch.file, patch.oldText, patch.newText, path.basename(patch.file))) {
		changed = true;
	}
}

if (!changed) {
	console.log("[patch-foliate-paginator] Already patched");
}
