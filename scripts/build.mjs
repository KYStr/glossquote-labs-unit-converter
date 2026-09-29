import { copyFile, lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runProjectCheck } from "./check.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ALLOWED_EXTENSIONS = new Set([".html", ".css", ".js", ".mjs"]);

function isPathInside(rootPath, candidatePath) {
  const difference = relative(rootPath, candidatePath);
  return difference === "" || (
    difference !== ".." &&
    !isAbsolute(difference) &&
    difference.split(sep)[0] !== ".."
  );
}

async function readPathInfo(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("A build path could not be inspected.");
  }
}

async function collectPublicFiles(projectRoot) {
  const publicRoot = resolve(projectRoot, "public");
  const rootInfo = await readPathInfo(publicRoot);
  if (!rootInfo || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("The public source must be a regular directory.");
  }

  const canonicalPublic = await realpath(publicRoot);
  if (!isPathInside(projectRoot, canonicalPublic) || canonicalPublic === projectRoot) {
    throw new Error("The public source resolves outside the project.");
  }

  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const sourcePath = resolve(directory, entry.name);
      const info = await readPathInfo(sourcePath);
      if (!info) throw new Error("A public source path disappeared during build.");
      if (info.isSymbolicLink()) {
        throw new Error("Symbolic links are not allowed in public build sources.");
      }
      if (entry.name[0] === ".") {
        throw new Error("Dotfiles are not allowed in public build sources.");
      }
      if (info.isDirectory()) {
        await visit(sourcePath);
        continue;
      }
      if (!info.isFile() || !ALLOWED_EXTENSIONS.has(extname(sourcePath).toLowerCase())) {
        throw new Error("A public source file has an unsupported type.");
      }

      const canonicalSource = await realpath(sourcePath);
      if (!isPathInside(canonicalPublic, canonicalSource)) {
        throw new Error("A public source resolves outside public.");
      }
      files.push({ sourcePath: canonicalSource, relativePath: relative(publicRoot, sourcePath) });
    }
  }

  await visit(publicRoot);
  if (!files.some(({ relativePath }) => relativePath === "index.html")) {
    throw new Error("The public build must contain index.html.");
  }
  return { publicRoot: canonicalPublic, files };
}

async function validateDistTarget(projectRoot, distPath) {
  const expectedDist = resolve(projectRoot, "dist");
  const targetDifference = relative(projectRoot, distPath);
  if (resolve(distPath) !== expectedDist || targetDifference !== "dist") {
    throw new Error("The build output must be the project dist directory.");
  }

  const info = await readPathInfo(distPath);
  if (!info) return;
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("The dist output cannot be a symbolic link or a non-directory.");
  }
  const canonicalDist = await realpath(distPath);
  if (!isPathInside(projectRoot, canonicalDist) || canonicalDist === projectRoot) {
    throw new Error("The dist output resolves outside the project.");
  }
}

export async function buildProject({ projectPath = PROJECT_ROOT, check = runProjectCheck } = {}) {
  await check(projectPath);

  let projectRoot;
  try {
    projectRoot = await realpath(resolve(projectPath));
  } catch {
    throw new Error("Project root is not available.");
  }

  const { files } = await collectPublicFiles(projectRoot);
  const distPath = resolve(projectRoot, "dist");
  await validateDistTarget(projectRoot, distPath);

  await rm(distPath, { recursive: true, force: true });
  await mkdir(distPath);

  for (const { sourcePath, relativePath } of files) {
    const targetPath = resolve(distPath, relativePath);
    if (!isPathInside(distPath, targetPath) || targetPath === distPath) {
      throw new Error("A build output path escapes dist.");
    }
    const sourceInfo = await readPathInfo(sourcePath);
    if (!sourceInfo || !sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
      throw new Error("A public source changed during build.");
    }
    const canonicalSource = await realpath(sourcePath);
    if (!isPathInside(resolve(projectRoot, "public"), canonicalSource)) {
      throw new Error("A public source resolves outside public.");
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(canonicalSource, targetPath);
  }

  return { outputPath: distPath, fileCount: files.length };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildProject();
    process.stdout.write(`Built ${result.fileCount} static files into dist.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Build failed."}\n`);
    process.exitCode = 1;
  }
}
