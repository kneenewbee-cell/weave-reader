import type { App } from "obsidian";
import type { AISelectedTextPanelHost } from "../services/ai/ai-host";
import type { EpubHostCapabilities } from "../services/epub";
import { getCompatibleAISelectedTextPanelHost } from "../utils/plugin-access";

export type EpubViewHost = {
	app: App;
} & EpubHostCapabilities &
	Partial<AISelectedTextPanelHost>;

export function isAISelectedTextPanelHost(
	host: EpubViewHost
): host is EpubViewHost & AISelectedTextPanelHost {
	return Boolean(
		host?.app &&
			(host as Partial<AISelectedTextPanelHost>).settings &&
			typeof (host as Partial<AISelectedTextPanelHost>).dataStorage?.getDecks === "function" &&
			typeof (host as Partial<AISelectedTextPanelHost>).dataStorage?.saveCard === "function"
	);
}

export function resolveAISelectedTextPanelHost(host: EpubViewHost): AISelectedTextPanelHost | null {
	if (isAISelectedTextPanelHost(host)) {
		return host;
	}

	const compatibleHost = getCompatibleAISelectedTextPanelHost(host?.app);
	if (!compatibleHost) {
		return null;
	}

	return compatibleHost as AISelectedTextPanelHost;
}
