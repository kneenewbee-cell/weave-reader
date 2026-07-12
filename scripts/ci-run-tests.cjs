const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const EPUB_PATH = path.join(PROJECT_ROOT, "node_modules/foliate-js/epub.js");

function fail(message) {
	console.error(`[ci-test] ${message}`);
	process.exit(1);
}

function verifyFoliatePatch() {
	if (!fs.existsSync(EPUB_PATH)) {
		fail("foliate-js/epub.js not found after install");
	}

	const source = fs.readFileSync(EPUB_PATH, "utf8");
	if (!source.includes("typeof Object.groupBy") || !source.includes("typeof Map.groupBy")) {
		fail("foliate-js/epub.js is missing Object.groupBy/Map.groupBy polyfills");
	}

	console.log("[ci-test] foliate groupBy polyfills present");
}

function main() {
	console.log(`[ci-test] node ${process.version}`);
	console.log(
		`[ci-test] groupBy Object=${typeof Object.groupBy} Map=${typeof Map.groupBy}`
	);

	verifyFoliatePatch();

	execSync("npx vitest run --reporter=verbose", {
		cwd: PROJECT_ROOT,
		stdio: "inherit",
		env: process.env,
	});
}

main();
