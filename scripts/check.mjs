import { spawnSync } from "node:child_process";
import { lstat, readFile, realpath, readdir } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflarePolicy } from "./cloudflare.mjs";
import { ALLOWED_SITE_ANCHOR_URLS, PAGE_PATHS, assertProductionHtml, parseReleaseArgs, releasePolicy } from "./release.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REQUIRED_PATHS = Object.freeze([
  "package.json",
  "scripts/serve.mjs",
  "scripts/check.mjs",
  "scripts/build.mjs",
  "scripts/release.mjs",
  "scripts/cloudflare.mjs",
  "public/index.html",
  "public/en/index.html",
  "public/styles/tokens.css",
  "public/styles/app.css",
  "public/js/app.mjs",
  "test/scaffold.test.mjs",
  "wrangler.jsonc",
]);
const CONTROLLED_DIRS = Object.freeze(["scripts", "public", "test"]);
const SCANNED_EXTENSIONS = new Set([".html", ".css", ".js", ".mjs"]);
const PUBLIC_EXTENSIONS = new Set([".html", ".css", ".js", ".mjs"]);
const CODE_EXTENSIONS = new Set([".js", ".mjs"]);
const ALLOWED_SITE_ANCHOR_URL_SET = new Set(ALLOWED_SITE_ANCHOR_URLS);
const EXPECTED_SCRIPTS = Object.freeze({
  dev: "node scripts/serve.mjs",
  test: "node --test",
  check: "node scripts/check.mjs",
  build: "node scripts/build.mjs",
});

const forbiddenTokens = [
  ["inner", "HTML"],
  ["outer", "HTML"],
  ["insertAdjacent", "HTML"],
  ["local", "Storage"],
  ["session", "Storage"],
  ["indexed", "DB"],
  ["document.", "cookie"],
  ["document.", "write"],
  ["ev", "al"],
  ["new", "Function"],
  ["fe", "tch"],
  ["XML", "Http", "Request"],
  ["Web", "Socket"],
  ["Event", "Source"],
  ["send", "Beacon"],
].map((parts) => parts.join(""));

function isPathInside(rootPath, candidatePath) {
  const difference = relative(rootPath, candidatePath);
  return difference === "" || (
    difference !== ".." &&
    !isAbsolute(difference) &&
    difference.split(sep)[0] !== ".."
  );
}

function displayPath(rootPath, filePath) {
  return relative(rootPath, filePath).replace(/[\r\n\t]/g, "?");
}

function stripComments(source, language) {
  if (language === "html") {
    return source.replace(/<!--[\s\S]*?-->/g, "");
  }
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return language === "js"
    ? withoutBlocks.replace(/(^|[ \t])\/\/[^\r\n]*/gm, "$1")
    : withoutBlocks;
}

async function assertRegularPath(path, rootPath, failures) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      failures.push(`${displayPath(rootPath, path)}: symbolic links are not allowed in managed paths`);
      return false;
    }
    return true;
  } catch {
    failures.push(`${displayPath(rootPath, path)}: required path is missing or unreadable`);
    return false;
  }
}

async function collectManagedFiles(projectRoot, failures) {
  const files = [];

  async function visit(directory, scope) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      failures.push(`${displayPath(projectRoot, directory)}: managed directory is unreadable`);
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (scope === "test" && directory === resolve(projectRoot, "test") && entry.name === ".tmp") {
        continue;
      }
      const itemPath = resolve(directory, entry.name);
      let info;
      try {
        info = await lstat(itemPath);
      } catch {
        failures.push(`${displayPath(projectRoot, itemPath)}: managed path is unreadable`);
        continue;
      }

      if (info.isSymbolicLink()) {
        failures.push(`${displayPath(projectRoot, itemPath)}: symbolic links are not allowed in managed paths`);
        continue;
      }
      if (entry.name[0] === ".") {
        failures.push(`${displayPath(projectRoot, itemPath)}: dotfiles are not allowed in managed paths`);
        continue;
      }
      if (info.isDirectory()) {
        await visit(itemPath, scope);
        continue;
      }
      if (!info.isFile()) {
        failures.push(`${displayPath(projectRoot, itemPath)}: unsupported managed path`);
        continue;
      }

      const extension = extname(itemPath).toLowerCase();
      if (scope === "public" && !PUBLIC_EXTENSIONS.has(extension)) {
        failures.push(`${displayPath(projectRoot, itemPath)}: unsupported public file extension`);
      } else if (SCANNED_EXTENSIONS.has(extension)) {
        files.push({ path: itemPath, scope, extension });
      }
    }
  }

  for (const name of CONTROLLED_DIRS) {
    const directory = resolve(projectRoot, name);
    if (await assertRegularPath(directory, projectRoot, failures)) {
      let info;
      try {
        info = await lstat(directory);
      } catch {
        continue;
      }
      if (!info.isDirectory()) {
        failures.push(`${name}: managed path must be a directory`);
        continue;
      }
      await visit(directory, name);
    }
  }

  return files;
}

function packageFailures(packageData) {
  const failures = [];
  if (!packageData || packageData.private !== true) {
    failures.push("package.json: private must be true");
  }
  if (packageData?.type !== "module") {
    failures.push("package.json: type must be module");
  }
  if (packageData?.engines?.node !== ">=24") {
    failures.push("package.json: engines.node must be >=24");
  }
  for (const [name, command] of Object.entries(EXPECTED_SCRIPTS)) {
    if (packageData?.scripts?.[name] !== command) {
      failures.push(`package.json: script ${name} does not match the T00 command`);
    }
  }
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    if (packageData?.[field] && Object.keys(packageData[field]).length > 0) {
      failures.push(`package.json: ${field} must remain empty for T00`);
    }
  }
  return failures;
}

async function resolveLocalReference(value, sourcePath, allowedRoot, failures, projectRoot, allowedExtensions = PUBLIC_EXTENSIONS) {
  const reference = value.trim();
  if (reference === "" || reference[0] === "#") {
    if (reference[0] === "#") return;
    failures.push(`${displayPath(projectRoot, sourcePath)}: empty local reference`);
    return;
  }
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) {
    failures.push(`${displayPath(projectRoot, sourcePath)}: external or non-file reference is not allowed`);
    return;
  }
  if (reference.includes("?") || reference.includes("#")) {
    failures.push(`${displayPath(projectRoot, sourcePath)}: query and fragment references are not allowed`);
    return;
  }

  let decoded;
  try {
    decoded = decodeURIComponent(reference);
  } catch {
    failures.push(`${displayPath(projectRoot, sourcePath)}: malformed local reference`);
    return;
  }
  if (decoded.includes("\\") || decoded.includes("\0")) {
    failures.push(`${displayPath(projectRoot, sourcePath)}: invalid local reference`);
    return;
  }

  const targetPath = decoded[0] === "/"
    ? resolve(allowedRoot, decoded.slice(1))
    : resolve(dirname(sourcePath), decoded);
  if (!isPathInside(allowedRoot, targetPath) || targetPath === allowedRoot) {
    failures.push(`${displayPath(projectRoot, sourcePath)}: local reference escapes its allowed root`);
    return;
  }
  if (!allowedExtensions.has(extname(targetPath).toLowerCase())) {
    failures.push(`${displayPath(projectRoot, sourcePath)}: local reference has an unapproved extension`);
    return;
  }

  try {
    const sourceInfo = await lstat(targetPath);
    if (sourceInfo.isSymbolicLink()) {
      failures.push(`${displayPath(projectRoot, sourcePath)}: local reference uses a symbolic link`);
      return;
    }
    if (!sourceInfo.isFile()) {
      failures.push(`${displayPath(projectRoot, sourcePath)}: local reference is not a file`);
      return;
    }
    const canonicalPublic = await realpath(allowedRoot);
    const canonicalTarget = await realpath(targetPath);
    if (!isPathInside(canonicalPublic, canonicalTarget)) {
      failures.push(`${displayPath(projectRoot, sourcePath)}: local reference escapes public`);
    }
  } catch {
    failures.push(`${displayPath(projectRoot, sourcePath)}: local reference does not exist`);
  }
}

async function resolveAnchorReference(value, sourcePath, publicRoot, failures, projectRoot) {
  const reference = value.trim();
  if (ALLOWED_SITE_ANCHOR_URL_SET.has(reference)) return;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) {
    failures.push(`${displayPath(projectRoot, sourcePath)}: anchor URL is not an approved site link`);
    return;
  }
  await resolveLocalReference(reference, sourcePath, publicRoot, failures, projectRoot);
}

async function checkHtml(source, filePath, publicRoot, projectRoot, failures, metadataLinks = []) {
  const html = stripComments(source, "html");
  if (/<base\b/i.test(html) || /<style\b/i.test(html) || /\sstyle\s*=/i.test(html) || /\son[a-z]+\s*=/i.test(html)) {
    failures.push(`${displayPath(projectRoot, filePath)}: inline execution or style markup is not allowed`);
  }

  const tags = html.matchAll(/<([a-z][a-z\d:-]*)\b([^>]*)>/gi);
  for (const [wholeTag, tagName, attributes] of tags) {
    if (metadataLinks.includes(wholeTag)) continue;
    const normalizedTag = tagName.toLowerCase();
    const isScript = normalizedTag === "script";
    const hasSource = /\bsrc\s*=/i.test(attributes);
    if (isScript && !hasSource) {
      failures.push(`${displayPath(projectRoot, filePath)}: inline scripts are not allowed`);
    }
    if (/(?:^|\s)ping(?:\s|=|$)/i.test(attributes)) {
      failures.push(`${displayPath(projectRoot, filePath)}: anchor ping is not allowed`);
    }

    const references = attributes.matchAll(/\b(src|href|poster|action|formaction|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi);
    for (const [, attributeName, doubleQuoted, singleQuoted, unquoted] of references) {
      const attributeValue = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
      if (attributeName.toLowerCase() === "srcset") {
        for (const candidate of attributeValue.split(",")) {
          await resolveLocalReference(candidate.trim().split(/\s+/)[0], filePath, publicRoot, failures, projectRoot);
        }
      } else if (attributeName.toLowerCase() === "href" && normalizedTag === "a") {
        await resolveAnchorReference(attributeValue, filePath, publicRoot, failures, projectRoot);
      } else {
        await resolveLocalReference(attributeValue, filePath, publicRoot, failures, projectRoot);
      }
    }
  }
}

async function checkCss(source, filePath, publicRoot, projectRoot, failures) {
  const css = stripComments(source, "css");
  const references = [];
  for (const match of css.matchAll(/\burl\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi)) {
    references.push(match[2] ?? match[3] ?? "");
  }
  for (const match of css.matchAll(/@import\s+(?:url\(\s*)?(?:(["'])(.*?)\1|([^;)\s]+))\s*\)?\s*;/gi)) {
    references.push(match[2] ?? match[3] ?? "");
  }
  for (const reference of references) {
    await resolveLocalReference(reference, filePath, publicRoot, failures, projectRoot);
  }
}

async function checkModuleReferences(source, filePath, scope, publicRoot, projectRoot, failures) {
  const code = stripComments(source, "js");
  const specifiers = [];
  const staticImports = /\b(?:import|export)(?:\s+|(?=[{'*]))(?:[^'";]*?\bfrom\s*)?(["'])([^"']+)\1/g;
  for (const match of code.matchAll(staticImports)) {
    specifiers.push(match[2]);
  }
  const literalDynamicImports = [...code.matchAll(/\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g)];
  const allDynamicImports = [...code.matchAll(/\bimport\s*\(/g)];
  if (literalDynamicImports.length !== allDynamicImports.length) {
    failures.push(`${displayPath(projectRoot, filePath)}: dynamic imports must use a fixed local path`);
  }
  specifiers.push(...literalDynamicImports.map((match) => match[2]));

  for (const specifier of specifiers) {
    if (scope !== "public" && specifier.startsWith("node:")) {
      continue;
    }
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(specifier)) {
      failures.push(`${displayPath(projectRoot, filePath)}: external module references are not allowed`);
      continue;
    }
    if (specifier.includes("?") || specifier.includes("#") || specifier.includes("\\")) {
      failures.push(`${displayPath(projectRoot, filePath)}: module reference is not a fixed local path`);
      continue;
    }
    if (specifier[0] !== "." && specifier[0] !== "/") {
      failures.push(`${displayPath(projectRoot, filePath)}: bare module imports are not allowed`);
      continue;
    }
    const allowedRoot = scope === "public" ? publicRoot : projectRoot;
    const allowedExtensions = scope === "public" ? PUBLIC_EXTENSIONS : CODE_EXTENSIONS;
    await resolveLocalReference(specifier, filePath, allowedRoot, failures, projectRoot, allowedExtensions);
  }
}

function checkForbiddenApis(source, filePath, projectRoot, failures) {
  const codeWithoutComments = stripComments(source, "js").replace(/\s+/g, "");
  if (forbiddenTokens.some((token) => codeWithoutComments.includes(token))) {
    failures.push(`${displayPath(projectRoot, filePath)}: a prohibited browser API keyword was found`);
  }
}

export async function runProjectCheck(projectPath = PROJECT_ROOT) {
  const failures = [];
  let projectRoot;
  try {
    projectRoot = await realpath(resolve(projectPath));
  } catch {
    throw new Error("Project root is not available.");
  }

  for (const relativePath of REQUIRED_PATHS) {
    const absolutePath = resolve(projectRoot, relativePath);
    if (!isPathInside(projectRoot, absolutePath)) {
      failures.push(`${relativePath}: required path is invalid`);
      continue;
    }
    if (await assertRegularPath(absolutePath, projectRoot, failures)) {
      let info;
      try {
        info = await lstat(absolutePath);
        if (!info.isFile()) failures.push(`${relativePath}: required path must be a file`);
      } catch {
        failures.push(`${relativePath}: required path is unreadable`);
      }
    }
  }

  let packageData;
  try {
    packageData = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
    failures.push(...packageFailures(packageData));
  } catch {
    failures.push("package.json: invalid JSON");
  }

  const files = await collectManagedFiles(projectRoot, failures);
  const publicRoot = resolve(projectRoot, "public");
  try {
    await realpath(publicRoot);
  } catch {
    failures.push("public: directory is not available");
  }

  for (const file of files) {
    let source;
    try {
      source = await readFile(file.path, "utf8");
    } catch {
      failures.push(`${displayPath(projectRoot, file.path)}: file is unreadable`);
      continue;
    }

    if (file.extension === ".mjs" || file.extension === ".js") {
      const checked = spawnSync(process.execPath, ["--check", file.path], {
        cwd: projectRoot,
        shell: false,
        encoding: "utf8",
        windowsHide: true,
      });
      if (checked.error || checked.status !== 0) {
        failures.push(`${displayPath(projectRoot, file.path)}: JavaScript syntax check failed`);
      }
      checkForbiddenApis(source, file.path, projectRoot, failures);
      await checkModuleReferences(source, file.path, file.scope, publicRoot, projectRoot, failures);
    } else if (file.extension === ".html") {
      await checkHtml(source, file.path, publicRoot, projectRoot, failures);
    } else if (file.extension === ".css") {
      await checkCss(source, file.path, publicRoot, projectRoot, failures);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Project check failed:\n- ${failures.join("\n- ")}`);
  }

  return { ok: true, checkedFiles: files.length };
}

export async function checkReleaseOutput(outputPath, { siteUrl, cloudflare = false } = {}) {
  if (typeof cloudflare !== "boolean") throw new Error("Cloudflare check mode must be boolean.");
  const policy = releasePolicy(siteUrl);
  const hostingPolicy = cloudflare ? cloudflarePolicy(siteUrl) : null;
  const root = resolve(outputPath);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Release root must be a regular directory.");
  const canonicalRoot = await realpath(root);
  const failures = [];
  const files = [];

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink() || entry.name.startsWith(".") || !isPathInside(canonicalRoot, await realpath(path))) {
        throw new Error("Release paths must remain regular, visible, and inside the output root.");
      }
      if (info.isDirectory()) await visit(path);
      else if (info.isFile()) files.push(path);
      else throw new Error("Unsupported release path.");
    }
  }

  await visit(canonicalRoot);
  const names = files.map((path) => relative(canonicalRoot, path).split(sep).join("/"));
  for (const required of [...PAGE_PATHS, ...policy.files.keys(), ...(hostingPolicy?.files.keys() ?? [])]) {
    if (!names.includes(required)) failures.push(`Missing release file: ${required}`);
  }

  for (const path of files) {
    const name = relative(canonicalRoot, path).split(sep).join("/");
    const extension = extname(path).toLowerCase();
    const source = await readFile(path, "utf8");
    if (hostingPolicy?.files.has(name)) {
      if (source !== hostingPolicy.files.get(name)) failures.push(`${name}: generated Cloudflare content differs from policy`);
    } else if (policy.files.has(name)) {
      if (source !== policy.files.get(name)) failures.push(`${name}: generated SEO content differs from policy`);
    } else if (!PUBLIC_EXTENSIONS.has(extension)) {
      failures.push(`${name}: unsupported release file extension`);
    } else if (extension === ".html") {
      if (PAGE_PATHS.includes(name)) {
        try { assertProductionHtml(source, name, policy); }
        catch (error) { failures.push(`${name}: ${error.message}`); }
      }
      await checkHtml(source, path, canonicalRoot, canonicalRoot, failures, PAGE_PATHS.includes(name) ? policy.links(name) : []);
    } else if (extension === ".css") {
      await checkCss(source, path, canonicalRoot, canonicalRoot, failures);
    } else {
      const checked = spawnSync(process.execPath, ["--check", path], {
        shell: false,
        encoding: "utf8",
        windowsHide: true,
      });
      if (checked.error || checked.status !== 0) failures.push(`${name}: JavaScript syntax check failed`);
      checkForbiddenApis(source, path, canonicalRoot, failures);
      await checkModuleReferences(source, path, "public", canonicalRoot, canonicalRoot, failures);
    }
  }

  if (failures.length > 0) throw new Error(`Release check failed:\n- ${failures.join("\n- ")}`);
  return { ok: true, checkedFiles: files.length };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const options = parseReleaseArgs(process.argv.slice(2));
    const result = options.production
      ? await checkReleaseOutput(resolve(PROJECT_ROOT, "dist"), options)
      : await runProjectCheck();
    process.stdout.write(`Static checks passed for ${result.checkedFiles} ${options.production ? "release" : "managed source"} files. Keyword scans are not a security certification.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Project check failed."}\n`);
    process.exitCode = 1;
  }
}
