const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { OBSIDIAN_LINT_TARGETS } = require("./obsidian-lint-targets.cjs");

const extraArgs = process.argv.slice(2);
const eslintPackagePath = require.resolve("eslint/package.json");
const eslintBinPath = path.join(path.dirname(eslintPackagePath), "bin", "eslint.js");
const result = spawnSync(
  process.execPath,
  [eslintBinPath, "-c", "eslint.obsidian.config.mjs", ...OBSIDIAN_LINT_TARGETS, "--max-warnings", "9999", ...extraArgs],
  {
    stdio: "inherit",
    shell: false,
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
