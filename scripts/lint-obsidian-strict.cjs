/**
 * 更严格的 Obsidian / TypeScript 风险审计。
 *
 * 这不是日常强制门槛，而是发布前补充视角：
 * 把当前主配置里关闭的一部分高价值规则临时打开为 warning，
 * 用来尽量提前发现官方机器人之外、但会影响审查体验的问题。
 *
 * 运行：
 *   npm run lint:obsidian:strict
 */

const { ESLint } = require("eslint");
const { OBSIDIAN_LINT_TARGETS } = require("./obsidian-lint-targets.cjs");

const STRICT_RULES = {
  "@typescript-eslint/no-unsafe-assignment": "warn",
  "@typescript-eslint/no-unsafe-return": "warn",
  "@typescript-eslint/no-unnecessary-type-assertion": "warn",
  "@typescript-eslint/no-unsafe-enum-comparison": "warn",
  "@typescript-eslint/await-thenable": "warn",
  "@typescript-eslint/no-deprecated": "warn",
};

async function main() {
  const verbose = process.argv.includes("--verbose");
  const eslint = new ESLint({
    overrideConfigFile: "eslint.obsidian.config.mjs",
    overrideConfig: [
      {
        files: ["src/**/*.ts"],
        rules: STRICT_RULES,
      },
    ],
    errorOnUnmatchedPattern: false,
  });

  const results = await eslint.lintFiles(OBSIDIAN_LINT_TARGETS);
  const warningMessages = [];
  const ruleCounts = new Map();
  const fileCounts = new Map();

  for (const result of results) {
    const relativePath = result.filePath.replace(/\\/g, "/");
    for (const message of result.messages) {
      if (message.severity !== 1) {
        continue;
      }

      warningMessages.push({
        file: relativePath,
        line: message.line || 0,
        column: message.column || 0,
        ruleId: message.ruleId || "(unknown)",
        message: message.message,
      });

      ruleCounts.set(message.ruleId || "(unknown)", (ruleCounts.get(message.ruleId || "(unknown)") || 0) + 1);
      fileCounts.set(relativePath, (fileCounts.get(relativePath) || 0) + 1);
    }
  }

  const summary = results.reduce(
    (accumulator, result) => {
      accumulator.errors += result.errorCount;
      accumulator.warnings += result.warningCount;
      return accumulator;
    },
    { errors: 0, warnings: 0 },
  );

  if (verbose) {
    const formatter = await eslint.loadFormatter("stylish");
    const output = formatter.format(results);
    if (output.trim()) {
      console.log(output.trim());
    }
  } else {
    const topRules = Array.from(ruleCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
    const topFiles = Array.from(fileCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);

    console.log("Strict audit by rule:");
    topRules.forEach(([ruleId, count]) => {
      console.log(`  - ${ruleId}: ${count}`);
    });

    console.log("\nStrict audit by file:");
    topFiles.forEach(([file, count]) => {
      console.log(`  - ${file}: ${count}`);
    });

    console.log("\nStrict audit sample findings:");
    warningMessages.slice(0, 20).forEach((item) => {
      console.log(`  - ${item.file}:${item.line}:${item.column} [${item.ruleId}] ${item.message}`);
    });
    if (warningMessages.length > 20) {
      console.log(`  - ... 另外还有 ${warningMessages.length - 20} 条`);
    }
  }

  console.log(`\nStrict audit summary: ${summary.errors} error(s), ${summary.warnings} warning(s).`);
  if (!verbose) {
    console.log('Use "npm run lint:obsidian:strict -- --verbose" to inspect every warning.');
  }

  process.exit(summary.errors > 0 || summary.warnings > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
