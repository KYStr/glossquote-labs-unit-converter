import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PAGE_PATHS, PRODUCTION_SITE_URL, parseReleaseArgs, productionHtml, releasePolicy } from "../scripts/release.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("release mode requires the exact production origin and explicit flags", () => {
  assert.deepEqual(parseReleaseArgs([]), { production: false });
  assert.deepEqual(parseReleaseArgs(["--production", "--site-url", PRODUCTION_SITE_URL]), {
    production: true,
    siteUrl: PRODUCTION_SITE_URL,
  });
  assert.deepEqual(parseReleaseArgs(["--site-url", PRODUCTION_SITE_URL, "--cloudflare", "--production"]), {
    production: true,
    siteUrl: PRODUCTION_SITE_URL,
    cloudflare: true,
  });

  for (const args of [
    ["--production"],
    ["--site-url", PRODUCTION_SITE_URL],
    ["--production", "--unknown", PRODUCTION_SITE_URL],
    ["--production", "--production", "--site-url", PRODUCTION_SITE_URL],
    ["--production", "--cloudflare"],
    ["--cloudflare", "--site-url", PRODUCTION_SITE_URL],
    ["--production", "--cloudflare", "--site-url", "https://units.glossquote.com"],
  ]) assert.throws(() => parseReleaseArgs(args));

  for (const siteUrl of [
    undefined,
    "",
    "https://units.glossquote.com",
    "https://units.glossquote.com:443/",
    "https://units.glossquote.com/en/",
    "https://units.glossquote.com/index.html",
    "https://units.glossquote.com/?preview=1",
    "https://units.glossquote.com/#page",
    "https://units.glossquote.com/../",
    "https://units.glossquote.com/%2e%2e/",
    "https://user@units.glossquote.com/",
    "https://units.glossquote.com.evil.example/",
    "http://units.glossquote.com/",
    "//units.glossquote.com/",
  ]) assert.throws(() => releasePolicy(siteUrl));
});

test("production HTML gets exact bilingual SEO while preview sources remain noindex", async () => {
  const policy = releasePolicy(PRODUCTION_SITE_URL);
  assert.deepEqual(PAGE_PATHS, ["index.html", "en/index.html"]);
  assert.deepEqual(policy.urls, [
    "https://units.glossquote.com/index.html",
    "https://units.glossquote.com/en/index.html",
  ]);
  assert.equal(policy.files.get("robots.txt"), "User-agent: *\nAllow: /\nSitemap: https://units.glossquote.com/sitemap.xml\n");
  assert.deepEqual([...policy.files.keys()], ["robots.txt", "sitemap.xml"]);

  for (const [page, lang, self, zh, en, defaultUrl] of [
    ["index.html", "zh-Hant", policy.urls[0], policy.urls[0], policy.urls[1], policy.urls[0]],
    ["en/index.html", "en", policy.urls[1], policy.urls[0], policy.urls[1], policy.urls[0]],
  ]) {
    const source = await readFile(new URL(`../public/${page}`, import.meta.url), "utf8");
    const production = productionHtml(source, page, policy);
    assert.match(source, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(source, /<link rel="alternate" hreflang="x-default"/);
    assert.match(production, new RegExp(`<html lang="${lang}">`));
    assert.ok(production.includes(`<meta name="robots" content="index, follow">`));
    assert.ok(production.includes(`<link rel="canonical" href="${self}">`));
    assert.ok(production.includes(`<link rel="alternate" hreflang="zh-Hant" href="${zh}">`));
    assert.ok(production.includes(`<link rel="alternate" hreflang="en" href="${en}">`));
    assert.ok(production.includes(`<link rel="alternate" hreflang="x-default" href="${defaultUrl}">`));
    assert.doesNotMatch(production, /noindex/);
    const productionHead = production.match(/<head\b[^>]*>[\s\S]*?<\/head>/i)?.[0] ?? "";
    assert.doesNotMatch(productionHead, /hreflang="[^"]+" href="(?:\.\/|\.\.\/)/);

    const malformed = source.replace('hreflang="en" href=', 'hreflang="en" href="https://wrong.example/" data-original=');
    assert.throws(() => productionHtml(malformed, page, policy), /Unexpected preview SEO metadata/);
  }
});
