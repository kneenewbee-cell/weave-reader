const path = require("node:path");
const { spawnSync } = require("node:child_process");

const extraArgs = process.argv.slice(2);
const eslintPackagePath = require.resolve("eslint/package.json");
const eslintBinPath = path.join(path.dirname(eslintPackagePath), "bin", "eslint.js");

const disableCheck = spawnSync(process.execPath, ["scripts/check-forbidden-eslint-disables.cjs"], {
	stdio: "inherit",
	shell: false,
});
if (disableCheck.status !== 0) {
	process.exit(disableCheck.status ?? 1);
}

const result = spawnSync(
	process.execPath,
	[
		eslintBinPath,
		"-c",
		"eslint.obsidian.community.config.mjs",
		"src/**/*.ts",
		"--max-warnings",
		"0",
		...extraArgs,
	],
	{
		stdio: "inherit",
		shell: false,
	}
);

if (result.error) {
	throw result.error;
}

process.exit(result.status ?? 1);
