const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const EPUB_PATH = path.join(PROJECT_ROOT, "node_modules/foliate-js/epub.js");

function fail(message) {
	console.error(`[ci-build] ${message}`);
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

	console.log("[ci-build] foliate groupBy polyfills present");
}

function main() {
	console.log(`[ci-build] node ${process.version}`);
	verifyFoliatePatch();
	execSync("npm run build", {
		cwd: PROJECT_ROOT,
		stdio: "inherit",
		env: process.env,
	});
}

main();
