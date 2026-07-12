/**
 * Community bot rejects eslint-disable for certain rules entirely.
 */
const fs = require("node:fs");
const path = require("node:path");
const { OBSIDIAN_LINT_TARGETS } = require("./obsidian-lint-targets.cjs");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const FORBIDDEN_DISABLE_RULES = [
	"@typescript-eslint/no-deprecated",
	"no-restricted-globals",
	"obsidianmd/no-static-styles-assignment",
];

const DISABLE_PATTERN =
	/eslint-disable(?:-next-line|-line)?\s+([^\n*]+)/g;

function listSourceFiles(target) {
	const absolute = path.join(PROJECT_ROOT, target);
	if (!fs.existsSync(absolute)) {
		return [];
	}
	const stat = fs.statSync(absolute);
	if (stat.isFile() && absolute.endsWith(".ts")) {
		return [absolute];
	}
	if (!stat.isDirectory()) {
		return [];
	}
	const files = [];
	for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
		const entryPath = path.join(absolute, entry.name);
		if (entry.isDirectory()) {
			files.push(...listSourceFiles(path.relative(PROJECT_ROOT, entryPath)));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".ts")) {
			files.push(entryPath);
		}
	}
	return files;
}

function collectTargets() {
	const files = new Set();
	for (const target of OBSIDIAN_LINT_TARGETS) {
		if (!target.endsWith(".ts") && !target.includes("/")) {
			continue;
		}
		for (const file of listSourceFiles(target)) {
			files.add(file);
		}
	}
	return [...files];
}

function main() {
	const violations = [];
	for (const filePath of collectTargets()) {
		const content = fs.readFileSync(filePath, "utf8");
		const lines = content.split(/\r?\n/);
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			if (!line.includes("eslint-disable")) {
				continue;
			}
			let match = DISABLE_PATTERN.exec(line);
			DISABLE_PATTERN.lastIndex = 0;
			while (match) {
				const disabledRules = match[1]
					.split(",")
					.map((token) => token.trim().replace(/\s+--.*$/, ""))
					.filter(Boolean);
				for (const rule of disabledRules) {
					if (
						FORBIDDEN_DISABLE_RULES.some(
							(forbidden) => rule === forbidden || rule.startsWith(`${forbidden}/`)
						)
					) {
						violations.push({
							file: path.relative(PROJECT_ROOT, filePath).replace(/\\/g, "/"),
							line: index + 1,
							rule,
						});
					}
				}
				match = DISABLE_PATTERN.exec(line);
			}
		}
	}

	if (violations.length === 0) {
		console.log("[check-forbidden-eslint-disables] OK");
		return;
	}

	console.error("[check-forbidden-eslint-disables] Disallowed eslint-disable directives:");
	for (const violation of violations) {
		console.error(`  ${violation.file}:${violation.line} (${violation.rule})`);
	}
	process.exit(1);
}

main();
