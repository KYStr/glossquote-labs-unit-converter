import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ALLOWED_SITE_ANCHOR_URLS } from "../scripts/release.mjs";

const pages = [
  { file: "index.html", lang: "zh-Hant", other: "./en/index.html", title: /常用單位換算/, words: ["長度", "面積", "質量", "容量", "溫度", "溫差", "64", "12", "1e-12", "1e12"] },
  { file: "en/index.html", lang: "en", other: "../index.html", title: /Unit Converter/i, words: ["length", "area", "mass", "volume", "temperature", "difference", "64", "12", "1e-12", "1e12"] },
];
const requiredIds = [
  "converter-form", "converter-controls", "category-select", "number-input", "source-unit",
  "target-unit", "swap-units", "clear-input", "conversion-result", "precision-note",
  "formula-text", "number-error", "unit-error", "conversion-status", "unsupported-note",
  "category-help", "number-help", "source-help", "target-help", "swap-help", "page-title",
  "result-title", "usage-title",
];

// This reader checks our static authored markup, not arbitrary third-party HTML.
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

for (const page of pages) {
  test(`${page.lang} page provides complete static search content and shared form hooks`, async () => {
    const html = await readFile(new URL(`../public/${page.file}`, import.meta.url), "utf8");
    assert.equal(attributes(html.match(/<html\b[^>]*>/)[0]).lang, page.lang);
    const titles = [...html.matchAll(/<title>([^<]+)<\/title>/g)];
    assert.equal(titles.length, 1);
    assert.match(titles[0][1], page.title);
    assert.match(titles[0][1], /GlossQuote-Labs/);
    const metas = [...html.matchAll(/<meta\b[^>]*>/g)].map(([tag]) => attributes(tag));
    const descriptions = metas.filter((meta) => meta.name === "description");
    assert.equal(descriptions.length, 1);
    assert.ok(descriptions[0].content.length >= 45);
    assert.equal(metas.find((meta) => meta.name === "robots")?.content.replace(/\s/g, ""), "noindex,nofollow");
    assert.ok(metas.find((meta) => meta["http-equiv"] === "Content-Security-Policy")?.content.includes("connect-src 'none'"));
    assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
    const body = html.split(/<body\b[^>]*>/)[1].split("</body>")[0];
    const text = body.replace(/<[^>]*>/g, " ").toLowerCase();
    for (const word of page.words) assert.ok(text.includes(word.toLowerCase()), `Missing static explanation: ${word}`);
    const orderedSteps = body.match(/<ol\b[^>]*>([\s\S]*?)<\/ol>/)?.[1] ?? "";
    assert.equal([...orderedSteps.matchAll(/<li\b/g)].length, 4, "Static instructions need four steps");
    assert.ok([...body.matchAll(/<(?:summary|h3|dt)\b/g)].length >= 4, "Static FAQ needs four questions");
    for (const symbol of ["mm", "cm", "m", "km", "in", "ft", "cm²", "m²", "km²", "ha", "mg", "g", "kg", "lb", "mL", "L", "m³", "°C", "°F", "K"]) {
      assert.ok(body.includes(`(${symbol})`), `Missing supported unit: ${symbol}`);
    }
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, "IDs must be unique");
    for (const id of requiredIds) assert.ok(ids.includes(id), `Missing shared hook: ${id}`);
    for (const [, references] of html.matchAll(/(?:aria-labelledby|aria-describedby|for)="([^"]+)"/g)) {
      for (const id of references.split(/\s+/)) assert.ok(ids.includes(id), `Broken label reference: ${id}`);
    }
    assert.match(html, /<fieldset\b[^>]*\bid="converter-controls"[^>]*\bdisabled/);
    assert.match(html, /<output\b[^>]*\baria-live="off"/);
    assert.doesNotMatch(html, /<link\b[^>]*\brel="canonical"/);
    const headAlternates = [...html.matchAll(/<link\b[^>]*\brel="alternate"[^>]*>/g)].map(([tag]) => attributes(tag));
    assert.deepEqual(headAlternates.map((link) => [link.hreflang, link.href]).sort(([a], [b]) => a.localeCompare(b)),
      page.lang === "zh-Hant"
        ? [["en", "./en/index.html"], ["x-default", "./index.html"], ["zh-Hant", "./index.html"]]
        : [["en", "./index.html"], ["x-default", "../index.html"], ["zh-Hant", "../index.html"]]);
    assert.match(html, /前往其他頁面會清除目前輸入|Going to another page clears the current input/);
    assert.match(html, /Leaving this page clears the current input|離開本頁會清除目前輸入/);
    if (page.lang === "en") assert.doesNotMatch(body.replaceAll("繁體中文", ""), /[\u3400-\u9fff]/);
  });

  test(`${page.lang} page has explicit language navigation and valid local assets`, async () => {
    const pageUrl = new URL(`../public/${page.file}`, import.meta.url);
    const html = await readFile(pageUrl, "utf8");
    const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({ ...attributes(match[1]), text: match[2].replace(/<[^>]*>/g, "").trim() }));
    const languages = links.filter((link) => link.hreflang);
    assert.equal(languages.length, 2);
    assert.deepEqual(languages.map((link) => link.hreflang).sort(), ["en", "zh-Hant"]);
    const current = languages.filter((link) => link["aria-current"]);
    assert.equal(current.length, 1);
    assert.equal(current[0].hreflang, page.lang);
    assert.equal(new URL(current[0].href, pageUrl).href, pageUrl.href);
    const other = languages.find((link) => link.hreflang !== page.lang);
    assert.equal(other.href, page.other);
    for (const link of languages) {
      assert.equal(link.lang, link.hreflang);
      assert.equal(link.text, link.lang === "en" ? "English" : "繁體中文");
    }
    const externalAnchors = links.filter((link) => link.href.startsWith("https://"));
    assert.deepEqual(externalAnchors.map((link) => link.href).sort(), page.lang === "zh-Hant"
      ? ["https://glossquote.com/index.html", "https://glossquote.com/index.html", "https://date.glossquote.com/index.html"].sort()
      : ["https://glossquote.com/en/index.html", "https://glossquote.com/en/index.html", "https://date.glossquote.com/en/index.html"].sort());
    assert.ok(externalAnchors.every((link) => ALLOWED_SITE_ANCHOR_URLS.includes(link.href)));
    const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
    for (const [, href] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
      if (ALLOWED_SITE_ANCHOR_URLS.includes(href)) continue;
      if (href.startsWith("#")) continue;
      assert.ok(href.startsWith("./") || href.startsWith("../"), `Expected relative local link: ${href}`);
      assert.doesNotMatch(href, /[?#]/);
      const target = new URL(href, pageUrl);
      assert.ok(fileURLToPath(target).startsWith(publicRoot));
      assert.ok((await stat(target)).isFile());
    }
  });
}

test("language pages carry different titles and descriptions", async () => {
  const sources = await Promise.all(pages.map((page) => readFile(new URL(`../public/${page.file}`, import.meta.url), "utf8")));
  assert.notEqual(sources[0].match(/<title>([^<]+)<\/title>/)[1], sources[1].match(/<title>([^<]+)<\/title>/)[1]);
  const descriptions = sources.map((html) => [...html.matchAll(/<meta\b[^>]*>/g)].map(([tag]) => attributes(tag)).find((meta) => meta.name === "description").content);
  assert.notEqual(descriptions[0], descriptions[1]);
});
