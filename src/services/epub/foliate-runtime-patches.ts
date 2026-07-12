import { Platform } from "obsidian";
import {
	isBlobResourceUrl,
	readBlobUrlAsText,
	readResourceUrlAsText,
} from "../../utils/blob-url-text";
import { domInstanceOf } from "../../utils/dom-instance-of";
import { inlineFoliateBlobMarkup } from "./foliate-blob-markup-normalizer";

function readTextFromResourceUrl(resourceUrl: string): Promise<string> {
	if (isBlobResourceUrl(resourceUrl)) {
		return readBlobUrlAsText(resourceUrl);
	}
	return readResourceUrlAsText(resourceUrl);
}

export function normalizeDesktopFoliateSandboxValue(
	attributeName: string,
	value: string,
	stack?: string | null,
	iframeElement?: Element | null
): string | null {
	if (Platform.isMobile || attributeName.toLowerCase() !== "sandbox") {
		return null;
	}
	const normalizedValue = String(value || "").trim();
	if (!normalizedValue || !/allow-scripts/i.test(normalizedValue)) {
		return null;
	}
	const normalizedStack = String(stack || "").toLowerCase();
	const iframePart = String(iframeElement?.getAttribute("part") || "").toLowerCase();
	const shadowRoot = iframeElement?.getRootNode();
	const shadowHostTagName = String(
		domInstanceOf(shadowRoot, ShadowRoot) ? shadowRoot.host?.tagName : ""
	).toLowerCase();
	const isFoliateDesktopFrame =
		normalizedStack.includes("node_modules/foliate-js/paginator.js") ||
		normalizedStack.includes("node_modules/foliate-js/fixed-layout.js") ||
		iframePart.split(/\s+/).includes("filter") ||
		shadowHostTagName === "foliate-view";
	if (!isFoliateDesktopFrame) {
		return null;
	}
	const seenTokens = new Set<string>();
	const filteredTokens = normalizedValue
		.split(/\s+/)
		.filter(Boolean)
		.filter((token) => {
			const normalizedToken = token.toLowerCase();
			if (normalizedToken === "allow-scripts" || seenTokens.has(normalizedToken)) {
				return false;
			}
			seenTokens.add(normalizedToken);
			return true;
		});
	return filteredTokens.join(" ");
}

let desktopFoliateIframeSandboxPatchInstalled = false;
let foliateBlobIframePatchInstalled = false;
let foliateBlobIframeLoadTokens = new WeakMap<HTMLIFrameElement, number>();

export function installDesktopFoliateIframeSandboxPatch(): void {
	if (desktopFoliateIframeSandboxPatchInstalled || typeof HTMLIFrameElement === "undefined") {
		return;
	}
	const setAttributeDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "setAttribute");
	const originalSetAttribute = setAttributeDescriptor?.value as
		| ((this: Element, qualifiedName: string, value: string) => void)
		| undefined;
	if (!originalSetAttribute) {
		desktopFoliateIframeSandboxPatchInstalled = true;
		return;
	}
	HTMLIFrameElement.prototype.setAttribute = function patchedSetAttribute(
		name: string,
		value: string
	): void {
		const patchedValue = normalizeDesktopFoliateSandboxValue(
			name,
			String(value || ""),
			new Error().stack,
			this
		);
		Reflect.apply(originalSetAttribute, this, [name, patchedValue ?? value]);
	};
	desktopFoliateIframeSandboxPatchInstalled = true;
}

export function installFoliateBlobIframePatch(onLoadError: (error: unknown) => void): void {
	if (foliateBlobIframePatchInstalled || typeof HTMLIFrameElement === "undefined") {
		return;
	}
	const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
	if (!srcDescriptor?.set) {
		foliateBlobIframePatchInstalled = true;
		return;
	}
	const getIframeSrc = (iframe: HTMLIFrameElement): string => {
		if (!srcDescriptor.get) {
			return iframe.getAttribute("src") || "";
		}
		return (srcDescriptor.get as (this: HTMLIFrameElement) => string).call(iframe);
	};
	const setIframeSrc = (iframe: HTMLIFrameElement, value: string): void => {
		if (!srcDescriptor.set) {
			return;
		}
		(srcDescriptor.set as (this: HTMLIFrameElement, value: string) => void).call(iframe, value);
	};
	Object.defineProperty(HTMLIFrameElement.prototype, "src", {
		configurable: true,
		enumerable: srcDescriptor?.enumerable ?? true,
		get(this: HTMLIFrameElement): string {
			return getIframeSrc(this);
		},
		set(this: HTMLIFrameElement, value: string): void {
			const normalizedValue = String(value || "");
			if (!normalizedValue.startsWith("blob:")) {
				setIframeSrc(this, normalizedValue);
				return;
			}
			const loadToken = (foliateBlobIframeLoadTokens.get(this) || 0) + 1;
			foliateBlobIframeLoadTokens.set(this, loadToken);
			void readTextFromResourceUrl(normalizedValue)
				.then(async (html) => {
					if (foliateBlobIframeLoadTokens.get(this) !== loadToken) {
						return;
					}
					let normalizedHtml = html;
					try {
						normalizedHtml = await inlineFoliateBlobMarkup(html);
					} catch {
						// Keep raw markup if normalization fails; load error handler covers hard failures.
					}
					if (foliateBlobIframeLoadTokens.get(this) !== loadToken) {
						return;
					}
					this.srcdoc = normalizedHtml;
				})
				.catch((error) => {
					try {
						setIframeSrc(this, normalizedValue);
					} catch {
						// Keep the original load error as the primary signal.
					}
					onLoadError(error);
				});
		},
	});
	foliateBlobIframePatchInstalled = true;
}

/** @deprecated Use installFoliateBlobIframePatch */
export const installMobileBlobIframePatch = installFoliateBlobIframePatch;

export function resetFoliateBlobIframePatchStateForTests(): void {
	foliateBlobIframePatchInstalled = false;
	foliateBlobIframeLoadTokens = new WeakMap<HTMLIFrameElement, number>();
}

/** @deprecated Use resetFoliateBlobIframePatchStateForTests */
export const resetMobileBlobIframePatchStateForTests = resetFoliateBlobIframePatchStateForTests;
