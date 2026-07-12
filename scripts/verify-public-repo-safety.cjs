const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

const FORBIDDEN_TRACKED_PATH_RULES = [
	{
		name: "development docs",
		patterns: [
			/^docs\/(?!user\/).+/,
			/^版本更新文档\//,
			/^开发规则\.zh-CN\.md$/,
			/^REFERENCE_COUNT_IMPLEMENTATION\.md$/,
			/^QUICK_START_REFERENCE_COUNT\.md$/,
			/^Weave EPUB Reader 插件完整介绍\.md$/,
			/^EPUB摘录笔记使用教程\.(md|html)$/,
		],
	},
	{
		name: "legacy weave styles outside the standalone EPUB surface",
		patterns: [/^src\/styles\/(?!epub\/|obsidian-confirm\.css$).+/],
	},
	{
		name: "legacy weave view styles",
		patterns: [/^src\/components\/views\/styles\/.+/],
	},
	{
		name: "design prototypes and promo assets",
		patterns: [
			/^app\.css$/,
			/^design-prototypes\//,
			/^scratch\//,
			/^output\//,
			/^promo-.*\.(html|css|js)$/,
			/^非常重要的文档(?:\s禁止删除)?\//,
		],
	},
	{
		name: "local tooling and debug artifacts",
		patterns: [
			/^\.cursor\//,
			/^AGENTS\.md$/,
			/^\.windsurf\//,
			/^\.playwright-cli\//,
			/^\.mcp\.json$/,
			/^\.vscode\//,
			/^\.desktop-hot-reload\//,
			/^\.mobile-hot-reload\//,
			/^dist\//,
			/^public\/(?!versions\.json$).+/,
		],
	},
	{
		name: "legacy or archive code",
		patterns: [/^legacy-weave-archive\//],
	},
	{
		name: "secret-like files",
		patterns: [
			/^\.env$/,
			/^\.env\.(?!example$).+/,
			/^backend\//,
			/^config\/private\.json$/,
			/^config\/secrets\.json$/,
			/^scripts\/generate-activation-codes\.cjs$/,
			/^scripts\/.*(?:private|secret).*\.js$/,
			/^scripts\/.*(?:private|secret).*\.cjs$/,
			/激活码/,
			/发卡/,
			/密钥管理/,
		],
	},
];

const TEXT_EXTENSIONS = new Set([
	".cjs",
	".css",
	".html",
	".js",
	".json",
	".md",
	".mjs",
	".ts",
	".tsx",
	".txt",
	".yml",
	".yaml",
]);

const FORBIDDEN_CONTENT_PATTERNS = [
	{
		name: "private key marker",
		pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
	},
	{
		name: "generic private key marker",
		pattern: /PRIVATE KEY-----/,
	},
	{
		name: "GitHub fine-grained token",
		pattern: /github_pat_[A-Za-z0-9_]{20,}/,
	},
	{
		name: "GitHub classic token",
		pattern: /ghp_[A-Za-z0-9]{20,}/,
	},
	{
		name: "AWS access key id",
		pattern: /AKIA[0-9A-Z]{16}/,
	},
	{
		name: "OpenAI-style secret key",
		pattern: /(?:api[_-]?key|token|secret)[^\\\r\n]{0,40}\bsk-[A-Za-z0-9][A-Za-z0-9_-]{16,}\b/i,
	},
	{
		name: "Google API key",
		pattern: /(?:api[_-]?key|token|secret)[^\\\r\n]{0,40}\bAIza[0-9A-Za-z\-_]{20,}\b/i,
	},
];

const CONTENT_SCAN_EXCLUDE_PATTERNS = [
	/^scripts\/verify-.*\.cjs$/,
];

function fail(message) {
	console.error(`[verify-public-repo] ${message}`);
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

function findForbiddenTrackedFiles(files) {
	const violations = [];

	for (const file of files) {
		for (const rule of FORBIDDEN_TRACKED_PATH_RULES) {
			if (rule.patterns.some((pattern) => pattern.test(file))) {
				violations.push(`${file} -> ${rule.name}`);
				break;
			}
		}
	}

	return violations;
}

function isTextFile(filePath) {
	return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function findForbiddenContent(files) {
	const violations = [];

	for (const relativePath of files) {
		if (CONTENT_SCAN_EXCLUDE_PATTERNS.some((pattern) => pattern.test(relativePath))) {
			continue;
		}

		if (!isTextFile(relativePath)) {
			continue;
		}

		const absolutePath = path.join(PROJECT_ROOT, relativePath);
		const content = fs.readFileSync(absolutePath, "utf8");

		for (const rule of FORBIDDEN_CONTENT_PATTERNS) {
			if (rule.pattern.test(content)) {
				violations.push(`${relativePath} -> ${rule.name}`);
			}
		}
	}

	return violations;
}

function main() {
	const trackedFiles = getTrackedFiles();
	const forbiddenTrackedFiles = findForbiddenTrackedFiles(trackedFiles);
	if (forbiddenTrackedFiles.length > 0) {
		fail(
			`forbidden tracked file(s) detected:\n${forbiddenTrackedFiles
				.map((item) => `- ${item}`)
				.join("\n")}`
		);
	}

	const forbiddenContent = findForbiddenContent(trackedFiles);
	if (forbiddenContent.length > 0) {
		fail(
			`forbidden content detected in tracked file(s):\n${forbiddenContent
				.map((item) => `- ${item}`)
				.join("\n")}`
		);
	}

	console.log("[verify-public-repo] tracked files are public-safe");
}

main();
