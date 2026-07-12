const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function runNpm(args) {
	const printable = `npm ${args.join(" ")}`;
	console.log(`[ci-install] > ${printable}`);
	execSync(printable, {
		cwd: PROJECT_ROOT,
		stdio: "inherit",
		env: process.env,
	});
}

function logEnvironment() {
	console.log(`[ci-install] node ${process.version}`);
	try {
		const npmVersion = execSync("npm --version", {
			cwd: PROJECT_ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
		console.log(`[ci-install] npm ${npmVersion}`);
	} catch (error) {
		console.warn("[ci-install] unable to read npm version", error.message);
	}

	for (const fileName of ["package.json", "package-lock.json", ".npmrc"]) {
		const filePath = path.join(PROJECT_ROOT, fileName);
		console.log(
			`[ci-install] ${fileName}: ${fs.existsSync(filePath) ? "present" : "missing"}`
		);
	}
}

function removeNodeModules() {
	const nodeModulesPath = path.join(PROJECT_ROOT, "node_modules");
	if (!fs.existsSync(nodeModulesPath)) {
		return;
	}
	fs.rmSync(nodeModulesPath, { recursive: true, force: true });
}

function installWithCi() {
	runNpm(["ci", "--no-audit", "--no-fund"]);
}

function installWithNpmInstall() {
	removeNodeModules();
	runNpm(["install", "--no-audit", "--no-fund"]);
}

function main() {
	logEnvironment();

	try {
		installWithCi();
		console.log("[ci-install] npm ci succeeded");
		return;
	} catch {
		console.error("[ci-install] npm ci failed; retrying with npm install");
	}

	try {
		installWithNpmInstall();
		console.log("[ci-install] npm install succeeded");
	} catch {
		console.error("[ci-install] dependency install failed after npm ci and npm install");
		process.exit(1);
	}
}

main();
