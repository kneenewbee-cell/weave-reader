import { describe, expect, it } from "vitest";

type TextQuoteParserHarness = {
	buildTextQuoteNeedles: (highlight: string) => string[];
	normalizeTextForQuoteSearch: (value: string) => string;
	findRangeByTextQuote: (
		root: Element | null,
		text: { highlight?: string }
	) => Range | null;
};

async function createParserHarness(html: string): Promise<TextQuoteParserHarness> {
	const { FoliateVaultPublicationParser } = await import("../FoliateVaultPublicationParser");
	const parser = new FoliateVaultPublicationParser({} as any);
	const container = document.createElement("div");
	container.innerHTML = html;
	const root = container.querySelector("p");
	return {
		buildTextQuoteNeedles: (highlight: string) =>
			(parser as any).buildTextQuoteNeedles(highlight),
		normalizeTextForQuoteSearch: (value: string) =>
			(parser as any).normalizeTextForQuoteSearch(value),
		findRangeByTextQuote: (node: Element | null, text: { highlight?: string }) =>
			(parser as any).findRangeByTextQuote(node, text),
		root,
	} as TextQuoteParserHarness & { root: HTMLElement };
}

describe("FoliateVaultPublicationParser text quote matching", () => {
	it("matches MOBI excerpt quotes with curly quotation marks", async () => {
		const harness = await createParserHarness(
			"<p>“别生气，”乔布斯向他保证，“我要带走的都是些级别很低的员工。</p>"
		);
		const range = harness.findRangeByTextQuote((harness as any).root, {
			highlight: '"别生气，"乔布斯向他保证，',
		});
		expect(range).not.toBeNull();
		expect(range?.toString()).toContain("别生气");
	});

	it("normalizes punctuation and spacing for fuzzy quote lookup", async () => {
		const harness = await createParserHarness(
			"<p>布斯的疯狂是以一种有教养的方式体现的。他开始了伴随他一生的强制性饮食计划。</p>"
		);
		const needles = harness.buildTextQuoteNeedles(
			"布斯的疯狂是以一种有教养的方式体现的。他开始了伴随他一生的强制性饮食计划——仅仅食用水果和蔬菜——所以他又瘦又结实，就像惠比特犬一样。"
		);
		expect(needles.some((needle) => needle.includes("布斯的疯狂"))).toBe(true);
		const range = harness.findRangeByTextQuote((harness as any).root, {
			highlight:
				"布斯的疯狂是以一种有教养的方式体现的。他开始了伴随他一生的强制性饮食计划",
		});
		expect(range).not.toBeNull();
		expect(harness.normalizeTextForQuoteSearch("“别生气，”")).toBe("别生气，");
	});
});
