const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const nodeModulesDir = path.join(projectRoot, "node_modules");
const srcDir = path.join(projectRoot, "src");
const args = new Set(process.argv.slice(2));
const scopePrefixes = process.argv
	.slice(2)
	.filter((arg) => arg.startsWith("--scope="))
	.flatMap((arg) => arg.slice("--scope=".length).split(","))
	.map((value) => value.trim().replace(/\\/g, "/").replace(/^\.\//, ""))
	.filter(Boolean);
const shouldProcessSrcJsResidue = args.has("--src-js-residue");
const shouldApplySrcJsResidueRemoval = args.has("--apply");
const shouldFailOnSrcJsResidue = args.has("--fail-on-find");
const shouldCleanViteCache = !shouldProcessSrcJsResidue || args.has("--vite-cache");

function removeDirectory(targetPath) {
	if (!fs.existsSync(targetPath)) {
		return false;
	}

	fs.rmSync(targetPath, { recursive: true, force: true });
	return true;
}

function removeFile(targetPath) {
	if (!fs.existsSync(targetPath)) {
		return false;
	}

	fs.rmSync(targetPath, { force: true });
	return true;
}

function findViteCacheDirs() {
	if (!fs.existsSync(nodeModulesDir)) {
		return [];
	}

	return fs
		.readdirSync(nodeModulesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name.startsWith(".vite"))
		.map((entry) => path.join(nodeModulesDir, entry.name))
		.sort();
}

function walkFiles(rootDir) {
	if (!fs.existsSync(rootDir)) {
		return [];
	}

	const discovered = [];
	const stack = [rootDir];

	while (stack.length > 0) {
		const currentDir = stack.pop();
		if (!currentDir) {
			continue;
		}

		const entries = fs.readdirSync(currentDir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
				continue;
			}
			if (entry.isFile()) {
				discovered.push(fullPath);
			}
		}
	}

	return discovered.sort();
}

function toProjectRelativePath(targetPath) {
	return path.relative(projectRoot, targetPath).replace(/\\/g, "/");
}

function hasTypedSourcePeerForJs(jsFilePath) {
	const basePath = jsFilePath.slice(0, -3);
	return fs.existsSync(`${basePath}.ts`) || fs.existsSync(`${basePath}.svelte`);
}

function isRemovableSrcJsResidue(targetPath) {
	const relativePath = toProjectRelativePath(targetPath);
	if (!relativePath.startsWith("src/")) {
		return false;
	}
	if (
		scopePrefixes.length > 0 &&
		!scopePrefixes.some((scopePrefix) => relativePath === scopePrefix || relativePath.startsWith(`${scopePrefix}/`))
	) {
		return false;
	}

	if (targetPath.endsWith(".js")) {
		return hasTypedSourcePeerForJs(targetPath);
	}

	if (targetPath.endsWith(".js.map")) {
		const jsFilePath = targetPath.slice(0, -4);
		return hasTypedSourcePeerForJs(jsFilePath);
	}

	return false;
}

function findSrcJsResidueFiles() {
	return walkFiles(srcDir).filter(isRemovableSrcJsResidue);
}

const removedCacheDirs = [];


if (shouldCleanViteCache) {
	for (const cacheDir of findViteCacheDirs()) {
		if (removeDirectory(cacheDir)) {
			removedCacheDirs.push(toProjectRelativePath(cacheDir));
		}
	}
}

const srcJsResidueCandidates = shouldProcessSrcJsResidue ? findSrcJsResidueFiles() : [];
const removedSrcJsResidueFiles = [];

if (shouldProcessSrcJsResidue && shouldApplySrcJsResidueRemoval) {
	for (const residuePath of srcJsResidueCandidates) {
		if (removeFile(residuePath)) {
			removedSrcJsResidueFiles.push(toProjectRelativePath(residuePath));
		}
	}
}

if (shouldCleanViteCache && removedCacheDirs.length === 0) {
	console.log("No Vite cache directories found.");
	} else if (shouldCleanViteCache) {
	console.log("Removed Vite cache directories:");
	for (const cacheDir of removedCacheDirs) {
		console.log(`- ${cacheDir}`);
	}
}

if (!shouldProcessSrcJsResidue) {
	process.exit(0);
}

if (srcJsResidueCandidates.length === 0) {
	console.log("No src JS residue files found.");
	process.exit(0);
}

if (!shouldApplySrcJsResidueRemoval) {
	console.log(`Found ${srcJsResidueCandidates.length} src JS residue files.`);
	console.log("Src JS residue candidates (dry run):");
	for (const residuePath of srcJsResidueCandidates) {
		console.log(`- ${toProjectRelativePath(residuePath)}`);
	}
	process.exit(shouldFailOnSrcJsResidue ? 1 : 0);
}

console.log(`Removed ${removedSrcJsResidueFiles.length} src JS residue files.`);
console.log("Removed src JS residue files:");
for (const residuePath of removedSrcJsResidueFiles) {
	console.log(`- ${residuePath}`);
}
