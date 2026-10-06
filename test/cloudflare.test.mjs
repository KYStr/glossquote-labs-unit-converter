import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject } from "../scripts/build.mjs";
import { checkReleaseOutput } from "../scripts/check.mjs";
import { CLOUDFLARE_SITE_URL } from "../scripts/cloudflare.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEMP = resolve(ROOT, "test/.tmp");
const HEADERS = [
  "/*",
  "  Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: no-referrer",
  "",
  "/js/*.mjs",
  "  Content-Type: text/javascript; charset=utf-8",
  "",
].join("\n");
const REDIRECTS = "/ /index.html 301\n/en /en/index.html 301\n/en/ /en/index.html 301\n";

function contained(root, path) {
  const part = relative(root, path);
  return part !== "" && !isAbsolute(part) && part.split(sep)[0] !== "..";
}

async function withPublicFixture(action) {
  await mkdir(TEMP, { recursive: true });
  assert.equal((await lstat(TEMP)).isSymbolicLink(), false);
  const canonicalRoot = await realpath(ROOT);
  const canonicalTemp = await realpath(TEMP);
  assert.ok(contained(canonicalRoot, canonicalTemp));
  const path = await mkdtemp(resolve(canonicalTemp, "cloudflare-"));
  try {
    await cp(resolve(ROOT, "public"), resolve(path, "public"), { recursive: true });
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

const build = (path, options = {}) => buildProject({
  projectPath: path,
  check: async () => ({ ok: true }),
  ...options,
});

test("Cloudflare production builds 13 exact static files and preview stays at 9", async () => {
  assert.equal(CLOUDFLARE_SITE_URL, "https://units.glossquote.com/");
  await withPublicFixture(async (path) => {
    const production = await build(path, { production: true, cloudflare: true, siteUrl: CLOUDFLARE_SITE_URL });
    assert.equal(production.fileCount, 13);
    assert.equal((await checkReleaseOutput(production.outputPath, { siteUrl: CLOUDFLARE_SITE_URL, cloudflare: true })).checkedFiles, 13);
    assert.equal(await readFile(resolve(production.outputPath, "_headers"), "utf8"), HEADERS);
    assert.equal(await readFile(resolve(production.outputPath, "_redirects"), "utf8"), REDIRECTS);
    assert.equal(await readFile(resolve(production.outputPath, "robots.txt"), "utf8"),
      "User-agent: *\nAllow: /\nSitemap: https://units.glossquote.com/sitemap.xml\n");
    const sitemap = await readFile(resolve(production.outputPath, "sitemap.xml"), "utf8");
    assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]), [
      "https://units.glossquote.com/index.html",
      "https://units.glossquote.com/en/index.html",
    ]);
    for (const page of ["index.html", "en/index.html"]) {
      assert.match(await readFile(resolve(production.outputPath, page), "utf8"), /<meta name="robots" content="index, follow">/);
      assert.match(await readFile(resolve(path, "public", page), "utf8"), /<meta name="robots" content="noindex, nofollow">/);
    }

    const preview = await build(path);
    assert.equal(preview.fileCount, 9);
    for (const generated of ["robots.txt", "sitemap.xml", "_headers", "_redirects"]) {
      await assert.rejects(readFile(resolve(preview.outputPath, generated)), { code: "ENOENT" });
    }
    assert.match(await readFile(resolve(preview.outputPath, "index.html"), "utf8"), /noindex, nofollow/);
  });
});

test("Cloudflare release checker rejects changed or extra hosting policy files", async () => {
  await withPublicFixture(async (path) => {
    const { outputPath } = await build(path, { production: true, cloudflare: true, siteUrl: CLOUDFLARE_SITE_URL });
    const headersPath = resolve(outputPath, "_headers");
    const redirectsPath = resolve(outputPath, "_redirects");
    await writeFile(headersPath, HEADERS.replace("Referrer-Policy: no-referrer", "Referrer-Policy: unsafe-url"));
    await assert.rejects(checkReleaseOutput(outputPath, { siteUrl: CLOUDFLARE_SITE_URL, cloudflare: true }), /generated Cloudflare content differs/);
    await writeFile(headersPath, HEADERS);

    await writeFile(redirectsPath, REDIRECTS.replace("/en/ /en/index.html 301", "/en/ /index.html 301"));
    await assert.rejects(checkReleaseOutput(outputPath, { siteUrl: CLOUDFLARE_SITE_URL, cloudflare: true }), /generated Cloudflare content differs/);
    await writeFile(redirectsPath, REDIRECTS);

    await writeFile(resolve(outputPath, "unexpected.bin"), "unexpected");
    await assert.rejects(checkReleaseOutput(outputPath, { siteUrl: CLOUDFLARE_SITE_URL, cloudflare: true }), /unsupported release file extension/);
    await rm(resolve(outputPath, "unexpected.bin"));
  });
});

test("Wrangler selects static assets with observability and runtime endpoints disabled", async () => {
  const config = JSON.parse(await readFile(resolve(ROOT, "wrangler.jsonc"), "utf8"));
  assert.deepEqual(Object.keys(config).sort(), [
    "assets", "build", "compatibility_date", "dependencies_instrumentation", "name", "observability",
    "preview_urls", "route", "send_metrics", "workers_dev",
  ].sort());
  assert.equal(config.name, "glossquote-unit-converter");
  assert.equal(config.compatibility_date, "2026-10-06");
  assert.deepEqual(config.assets, { directory: "./dist", html_handling: "none", not_found_handling: "none" });
  assert.deepEqual(config.route, { pattern: "units.glossquote.com", custom_domain: true });
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.send_metrics, false);
  assert.deepEqual(config.dependencies_instrumentation, { enabled: false });
  assert.equal(config.build.command, "node scripts/build.mjs --production --cloudflare --site-url https://units.glossquote.com/");
  assert.equal(config.build.cwd, ".");
  assert.equal(config.observability.enabled, false);
  assert.equal(config.observability.logs.enabled, false);
  assert.equal(config.observability.logs.invocation_logs, false);
  assert.equal(config.observability.traces.enabled, false);
  assert.equal(Object.hasOwn(config, "main"), false);
  assert.equal(Object.hasOwn(config.assets, "binding"), false);
});
