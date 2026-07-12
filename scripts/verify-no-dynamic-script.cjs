const fs = require("fs");
const path = require("path");

const target = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist", "main.js"));

if (!fs.existsSync(target)) {
	console.error(`[verify-no-dynamic-script] missing file: ${target}`);
	process.exit(1);
}

const source = fs.readFileSync(target, "utf8");
const pattern = /createElement\(\s*["']script["']\s*\)/gi;
const matches = [...source.matchAll(pattern)];

if (matches.length > 0) {
	console.error(
		`[verify-no-dynamic-script] found ${matches.length} dynamic <script> injection(s) in ${path.basename(target)}`,
	);
	for (const match of matches.slice(0, 8)) {
		const index = match.index ?? 0;
		const snippet = source.slice(Math.max(0, index - 40), index + 70).replace(/\s+/g, " ");
		console.error(`  - ${snippet}`);
	}
	process.exit(1);
}

console.log(`[verify-no-dynamic-script] ${path.basename(target)} is clean`);
