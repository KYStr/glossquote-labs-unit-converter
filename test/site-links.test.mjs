import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject } from "../scripts/build.mjs";
import { checkReleaseOutput, runProjectCheck } from "../scripts/check.mjs";
import { CLOUDFLARE_SITE_URL } from "../scripts/cloudflare.mjs";
import { ALLOWED_SITE_ANCHOR_URLS } from "../scripts/release.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEMP = resolve(ROOT, "test/.tmp");
const BAD_ANCHOR_URLS = [
  "https://evil.example/glossquote.com/index.html",
  "https://glossquote.com.evil.example/index.html",
  "https://glossquote.com/en/index.html?source=test",
  "https://glossquote.com/index.html#tool",
  "https://glossquote.com/other/index.html",
  "https://units.glossquote.com/../index.html",
  "http://date.glossquote.com/index.html",
  "//glossquote.com/index.html",
  "javascript:alert(1)",
];

function contained(root, path) {
  const part = relative(root, path);
  return part !== "" && !isAbsolute(part) && part.split(sep)[0] !== "..";
}

async function withProjectFixture(action) {
  await mkdir(TEMP, { recursive: true });
  assert.equal((await lstat(TEMP)).isSymbolicLink(), false);
  const canonicalRoot = await realpath(ROOT);
  const canonicalTemp = await realpath(TEMP);
  assert.ok(contained(canonicalRoot, canonicalTemp));
  const path = await mkdtemp(resolve(canonicalTemp, "site-links-"));
  try {
    await cp(resolve(ROOT, "public"), resolve(path, "public"), { recursive: true });
    await cp(resolve(ROOT, "scripts"), resolve(path, "scripts"), { recursive: true });
    await mkdir(resolve(path, "test"));
    await cp(resolve(ROOT, "test/scaffold.test.mjs"), resolve(path, "test/scaffold.test.mjs"));
    await cp(resolve(ROOT, "package.json"), resolve(path, "package.json"));
    await cp(resolve(ROOT, "wrangler.jsonc"), resolve(path, "wrangler.jsonc"));
    await action(path);
  } finally {
    const actual = await realpath(path);
    assert.ok(contained(canonicalTemp, actual));
    assert.equal((await lstat(path)).isSymbolicLink(), false);
    await rm(actual, { recursive: true });
    try { await rmdir(TEMP); } catch (error) {
      if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error;
    }
  }
}

function anchor(url, extra = "") {
  return `<a href="${url}"${extra}>Link</a>`;
}

function appendBeforeBodyEnd(html, markup) {
  return html.replace("</body>", `${markup}\n</body>`);
}

function countOccurrences(source, expression) {
  return [...source.matchAll(expression)].length;
}

test("source checker permits only the six exact site anchor URLs", async () => {
  await withProjectFixture(async (path) => {
    const pagePath = resolve(path, "public/index.html");
    const original = await readFile(pagePath, "utf8");
    const withApprovedLinks = appendBeforeBodyEnd(original, ALLOWED_SITE_ANCHOR_URLS.map((url) => anchor(url)).join("\n"));
    await writeFile(pagePath, withApprovedLinks, "utf8");
    await runProjectCheck(path);

    const hostileMarkup = [
      ...BAD_ANCHOR_URLS.map((url) => anchor(url)),
      anchor(ALLOWED_SITE_ANCHOR_URLS[0], ' ping="https://glossquote.com/index.html"'),
      '<script src="https://glossquote.com/app.mjs"></script>',
      '<link rel="stylesheet" href="https://units.glossquote.com/app.css">',
      '<img src="https://glossquote.com/index.html" alt="remote">',
      '<form action="https://glossquote.com/en/index.html"></form>',
      '<button formaction="https://date.glossquote.com/en/index.html">Remote form action</button>',
    ].join("\n");
    await writeFile(pagePath, appendBeforeBodyEnd(withApprovedLinks, hostileMarkup), "utf8");
    await writeFile(resolve(path, "public/styles/app.css"), "body { background-image: url(https://glossquote.com/index.html); }\n", "utf8");
    await assert.rejects(runProjectCheck(path), (error) => {
      assert.equal(countOccurrences(error.message, /anchor URL is not an approved site link/g), BAD_ANCHOR_URLS.length);
      assert.match(error.message, /anchor ping is not allowed/);
      assert.ok(countOccurrences(error.message, /external or non-file reference is not allowed/g) >= 6);
      return true;
    });
  });
});

test("production checker applies the same anchor rule and blocks external assets and pings", async () => {
  await withProjectFixture(async (path) => {
    const { outputPath } = await buildProject({
      projectPath: path,
      check: async () => ({ ok: true }),
      production: true,
      cloudflare: true,
      siteUrl: CLOUDFLARE_SITE_URL,
    });
    const pagePath = resolve(outputPath, "index.html");
    const original = await readFile(pagePath, "utf8");
    await writeFile(pagePath, appendBeforeBodyEnd(original, ALLOWED_SITE_ANCHOR_URLS.map((url) => anchor(url)).join("\n")), "utf8");
    await checkReleaseOutput(outputPath, { siteUrl: CLOUDFLARE_SITE_URL, cloudflare: true });

    const hostileMarkup = [
      ...BAD_ANCHOR_URLS.map((url) => anchor(url)),
      anchor(ALLOWED_SITE_ANCHOR_URLS[0], ' ping="https://glossquote.com/index.html"'),
      '<script src="https://glossquote.com/app.mjs"></script>',
      '<link rel="stylesheet" href="https://units.glossquote.com/app.css">',
      '<img src="https://glossquote.com/index.html" alt="remote">',
      '<form action="https://glossquote.com/en/index.html"></form>',
      '<button formaction="https://date.glossquote.com/en/index.html">Remote form action</button>',
    ].join("\n");
    await writeFile(pagePath, appendBeforeBodyEnd(original, hostileMarkup), "utf8");
    await writeFile(resolve(outputPath, "styles/app.css"), "body { background-image: url(https://glossquote.com/index.html); }\n", "utf8");
    await assert.rejects(checkReleaseOutput(outputPath, { siteUrl: CLOUDFLARE_SITE_URL, cloudflare: true }), (error) => {
      assert.equal(countOccurrences(error.message, /anchor URL is not an approved site link/g), BAD_ANCHOR_URLS.length);
      assert.match(error.message, /anchor ping is not allowed/);
      assert.ok(countOccurrences(error.message, /external or non-file reference is not allowed/g) >= 6);
      return true;
    });
  });
});
