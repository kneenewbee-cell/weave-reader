const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const REQUIRED_DIST_FILES = ["main.js", "manifest.json", "styles.css", "versions.json"];
const GITHUB_RELEASE_FILES = ["main.js", "manifest.json", "styles.css"];
const TEXT_RELEASE_FILES = ["main.js", "manifest.json", "styles.css", "versions.json"];
const ALLOWED_DIST_FILES = new Set(REQUIRED_DIST_FILES);
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
		name: "GitHub personal access token",
		pattern: /github_pat_[A-Za-z0-9_]{20,}/,
	},
	{
		name: "GitHub token",
		pattern: /ghp_[A-Za-z0-9]{20,}/,
	},
	{
		name: "AWS access key id",
		pattern: /AKIA[0-9A-Z]{16}/,
	},
];

function fail(message) {
	console.error(`[verify-release] ${message}`);
	process.exit(1);
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listFilesRecursively(rootDir, currentDir = rootDir) {
	const entries = fs.readdirSync(currentDir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const absolutePath = path.join(currentDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listFilesRecursively(rootDir, absolutePath));
			continue;
		}

		files.push(path.relative(rootDir, absolutePath).replace(/\\/g, "/"));
	}

	return files.sort();
}

function verifyRootVersionConsistency() {
	const packageJson = readJson(path.join(PROJECT_ROOT, "package.json"));
	const manifestJson = readJson(path.join(PROJECT_ROOT, "manifest.json"));
	const versionsJson = readJson(path.join(PROJECT_ROOT, "versions.json"));

	if (packageJson.version !== manifestJson.version) {
		fail(
			`package.json version (${packageJson.version}) does not match manifest.json (${manifestJson.version})`
		);
	}

	if (!Object.prototype.hasOwnProperty.call(versionsJson, manifestJson.version)) {
		fail(`versions.json is missing version ${manifestJson.version}`);
	}

	return manifestJson.version;
}

function verifyDistFileSet() {
	if (!fs.existsSync(DIST_DIR)) {
		fail(`dist directory not found: ${DIST_DIR}`);
	}

	const distFiles = listFilesRecursively(DIST_DIR);
	const missingFiles = REQUIRED_DIST_FILES.filter(
		(fileName) => !distFiles.includes(fileName)
	);
	if (missingFiles.length > 0) {
		fail(`missing required dist file(s): ${missingFiles.join(", ")}`);
	}

	const sourcemapFiles = distFiles.filter((fileName) => fileName.endsWith(".map"));
	if (sourcemapFiles.length > 0) {
		fail(`release build must not contain sourcemap file(s): ${sourcemapFiles.join(", ")}`);
	}

	const unexpectedFiles = distFiles.filter((fileName) => !ALLOWED_DIST_FILES.has(fileName));
	if (unexpectedFiles.length > 0) {
		fail(`unexpected dist file(s): ${unexpectedFiles.join(", ")}`);
	}
}

function verifyDistManifestVersion(expectedVersion) {
	const distManifest = readJson(path.join(DIST_DIR, "manifest.json"));
	if (distManifest.version !== expectedVersion) {
		fail(
			`dist/manifest.json version (${distManifest.version}) does not match root manifest (${expectedVersion})`
		);
	}
}

function verifySensitiveContent() {
	for (const fileName of TEXT_RELEASE_FILES) {
		const filePath = path.join(DIST_DIR, fileName);
		const content = fs.readFileSync(filePath, "utf8");
		for (const rule of FORBIDDEN_CONTENT_PATTERNS) {
			if (rule.pattern.test(content)) {
				fail(`${fileName} contains forbidden ${rule.name}`);
			}
		}
	}
}

function verifyNoDynamicScriptInjection() {
	const mainJsPath = path.join(DIST_DIR, "main.js");
	const source = fs.readFileSync(mainJsPath, "utf8");
	const pattern = /createElement\(\s*["']script["']\s*\)/gi;
	if (pattern.test(source)) {
		fail(
			"dist/main.js contains dynamic <script> element creation (ObsidianReviewBot code obfuscation error)"
		);
	}
}

function verifyNoRuntimeNodeStreamRequires() {
	const mainJsPath = path.join(DIST_DIR, "main.js");
	const source = fs.readFileSync(mainJsPath, "utf8");
	const forbiddenRequires = ['require("stream")', 'require("events")'];
	const found = forbiddenRequires.filter((needle) => source.includes(needle));
	if (found.length > 0) {
		fail(
			`dist/main.js must bundle Node shims instead of runtime ${found.join(", ")} (breaks Obsidian mobile)`
		);
	}
}

function verifyGithubReleaseFileSet() {
	const missingFiles = GITHUB_RELEASE_FILES.filter(
		(fileName) => !fs.existsSync(path.join(DIST_DIR, fileName))
	);
	if (missingFiles.length > 0) {
		fail(`missing GitHub release file(s): ${missingFiles.join(", ")}`);
	}
}

function main() {
	const expectedVersion = verifyRootVersionConsistency();
	verifyDistFileSet();
	verifyGithubReleaseFileSet();
	verifyDistManifestVersion(expectedVersion);
	verifySensitiveContent();
	verifyNoDynamicScriptInjection();
	verifyNoRuntimeNodeStreamRequires();
	console.log("[verify-release] release assets verified");
}

main();
