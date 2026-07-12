const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const UNREACHABLE_LIST = path.join(__dirname, ".plugin-scope-unreachable.txt");

const EXTRA_FORBIDDEN_TRACKED = [
	"src/tests/editor-initialization-basic.test.ts",
	"src/tests/editor-initialization-race-condition.test.ts",
	"src/tests/learning-step-scheduling.test.ts",
	"src/tests/memory-leak-prevention.test.ts",
	"src/tests/obsidian-block-link-generator.test.ts",
	"src/tests/regex-security-validation.test.ts",
	"src/tests/resource-manager-basic.test.ts",
	"src/tests/yaml-utils.test.ts",
	"src/components/epub/useEpubCanvas.ts",
	"src/components/epub/useEpubExcerpt.ts",
	"src/components/epub/index.ts",
	"src/components/epub/reader-navigation-intent.ts",
	"src/components/settings/components/ActivationModal.svelte",
	"src/components/settings/components/ActivationModalObsidian.ts",
	"src/components/settings/components/CoffeeSupportModal.ts",
	"src/components/settings/components/CustomApiUrlModal.ts",
	"src/components/settings/components/ProductInfoSection.svelte",
	"src/components/settings/components/SettingsHelpModal.svelte",
	"src/components/settings/components/SettingsHelpTriggerButton.svelte",
	"src/components/settings/components/activation-modal.css",
	"src/components/settings/components/coffee-support-modal.css",
	"src/components/settings/constants/settings-constants.ts",
	"src/components/settings/types/settings-types.ts",
	"src/components/settings/utils/settings-utils.ts",
	"src/components/settings/utils/ai-config-verification.ts",
	"src/components/settings/utils/ai-config-verification.test.ts",
	"src/stores/EditorStore.ts",
	"src/stores/CardEditStore.ts",
	"src/stores/BackupReactiveStore.ts",
	"src/stores/mask-store.ts",
	"src/stores/unified-state-manager.ts",
	"src/stores/card-modal-store.ts",
	"src/stores/ir-calendar-timer-store.ts",
	"src/stores/study-mode-store.ts",
	"src/stores/ir-active-block-context-store.ts",
	"src/stores/ir-active-document-store.ts",
];

function fail(message) {
	console.error(`[verify-plugin-scope] ${message}`);
	process.exit(1);
}

function getTrackedFiles() {
	const output = execFileSync("git", ["ls-files"], {
		cwd: PROJECT_ROOT,
		encoding: "utf8",
	});
	return output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function main() {
	execFileSync("node", [path.join(__dirname, "find-unreachable-src.cjs"), "--write-list"], {
		cwd: PROJECT_ROOT,
		stdio: "inherit",
	});

	if (!fs.existsSync(UNREACHABLE_LIST)) {
		fail("unreachable list was not generated");
	}

	const unreachable = fs
		.readFileSync(UNREACHABLE_LIST, "utf8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	const tracked = new Set(getTrackedFiles());
	const violations = [];

	for (const relativePath of [...unreachable, ...EXTRA_FORBIDDEN_TRACKED]) {
		if (tracked.has(relativePath)) {
			violations.push(relativePath);
		}
	}

	if (violations.length > 0) {
		fail(
			`${violations.length} tracked file(s) are outside the EPUB reader plugin scope:\n${violations
				.slice(0, 40)
				.map((item) => `- ${item}`)
				.join("\n")}${violations.length > 40 ? `\n... and ${violations.length - 40} more` : ""}`
		);
	}

	console.log("[verify-plugin-scope] tracked sources are within EPUB reader scope");
}

main();
