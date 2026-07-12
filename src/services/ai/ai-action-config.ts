import type { AIAction } from "../../types/ai-types";
import type { AIConfigHost } from "./ai-host";

function hasPersistableActionIdentity(action: AIAction, expectedType: string): boolean {
	return (
		action.type === expectedType &&
		typeof action.id === "string" &&
		action.id.trim().length > 0
	);
}

function isActionContentReadyForMenu(action: AIAction, expectedType: string): boolean {
	if (action.type !== expectedType) {
		return false;
	}

	const userPrompt = (action.userPromptTemplate || action.userPrompt || "").trim();

	if (!action.name.trim() || !action.systemPrompt.trim() || !userPrompt) {
		return false;
	}

	if (action.enabled === false) {
		return false;
	}

	if (expectedType === "split" && !action.splitConfig) {
		return false;
	}

	return true;
}

function normalizePersistedCustomAction(
	action: unknown,
	expectedType: "format" | "split"
): AIAction | null {
	if (!action || typeof action !== "object") {
		return null;
	}

	const candidate = action as Partial<AIAction>;
	const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
	if (!id) {
		return null;
	}

	return {
		...candidate,
		id,
		type: expectedType,
		category: "custom",
	} as AIAction;
}

export function normalizePersistedCustomActions(
	actions: unknown,
	expectedType: "format" | "split"
): AIAction[] {
	if (!Array.isArray(actions)) {
		return [];
	}

	return actions
		.map((action) => normalizePersistedCustomAction(action, expectedType))
		.filter((action): action is AIAction => Boolean(action));
}

export function getVisibleCustomSplitActions(actions: unknown): AIAction[] {
	return normalizePersistedCustomActions(actions, "split").filter(
		(action) =>
			hasPersistableActionIdentity(action, "split") &&
			isActionContentReadyForMenu(action, "split")
	);
}

export function getVisibleSplitActionsFromHost(
	host: Pick<AIConfigHost, "settings"> | null | undefined
): AIAction[] {
	return getVisibleCustomSplitActions(host?.settings?.aiConfig?.customSplitActions);
}

export function findVisibleSplitActionById(
	host: Pick<AIConfigHost, "settings"> | null | undefined,
	actionId: string
): AIAction | null {
	const normalizedId = String(actionId || "").trim();
	if (!normalizedId) {
		return null;
	}

	return (
		getVisibleSplitActionsFromHost(host).find((action) => action.id === normalizedId) || null
	);
}

export {
	hasPersistableActionIdentity,
	isActionContentReadyForMenu,
};
