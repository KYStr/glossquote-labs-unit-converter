export const PAGE_PATHS = Object.freeze(["index.html", "en/index.html"]);
export const PRODUCTION_SITE_URL = "https://units.glossquote.com/";

export const ALLOWED_SITE_ANCHOR_URLS = Object.freeze([
  "https://glossquote.com/index.html",
  "https://glossquote.com/en/index.html",
  "https://units.glossquote.com/index.html",
  "https://units.glossquote.com/en/index.html",
  "https://date.glossquote.com/index.html",
  "https://date.glossquote.com/en/index.html",
]);

const PREVIEW_ALTERNATES = Object.freeze({
  "index.html": Object.freeze([
    '<link rel="alternate" hreflang="zh-Hant" href="./index.html">',
    '<link rel="alternate" hreflang="en" href="./en/index.html">',
    '<link rel="alternate" hreflang="x-default" href="./index.html">',
  ]),
  "en/index.html": Object.freeze([
    '<link rel="alternate" hreflang="zh-Hant" href="../index.html">',
    '<link rel="alternate" hreflang="en" href="./index.html">',
    '<link rel="alternate" hreflang="x-default" href="../index.html">',
  ]),
});

export function releasePolicy(siteUrl) {
  if (siteUrl !== PRODUCTION_SITE_URL) {
    throw new Error(`Production requires the exact site URL ${PRODUCTION_SITE_URL}`);
  }

  const urls = PAGE_PATHS.map((path) => new URL(path, PRODUCTION_SITE_URL).href);
  const links = (page) => {
    const pageIndex = PAGE_PATHS.indexOf(page);
    if (pageIndex === -1) throw new Error("Unknown language page.");
    return [
      `<link rel="canonical" href="${urls[pageIndex]}">`,
      `<link rel="alternate" hreflang="zh-Hant" href="${urls[0]}">`,
      `<link rel="alternate" hreflang="en" href="${urls[1]}">`,
      `<link rel="alternate" hreflang="x-default" href="${urls[0]}">`,
    ];
  };

  const files = new Map([
    ["robots.txt", `User-agent: *\nAllow: /\nSitemap: ${PRODUCTION_SITE_URL}sitemap.xml\n`],
    ["sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map((entry) => `  <url><loc>${entry}</loc></url>`).join("\n") + "\n</urlset>\n"],
  ]);
  return { base: PRODUCTION_SITE_URL, urls, links, files };
}

export function parseReleaseArgs(args) {
  if (!Array.isArray(args)) throw new Error("Release arguments must be a list.");
  if (args.length === 0) return { production: false };

  let production = false;
  let cloudflare = false;
  let siteUrl;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--production") {
      if (production) throw new Error("Duplicate --production flag.");
      production = true;
    } else if (argument === "--cloudflare") {
      if (cloudflare) throw new Error("Duplicate --cloudflare flag.");
      cloudflare = true;
    } else if (argument === "--site-url") {
      if (siteUrl !== undefined || index + 1 >= args.length) {
        throw new Error("--site-url requires one URL value.");
      }
      siteUrl = args[index + 1];
      index += 1;
    } else {
      throw new Error("Unknown release argument.");
    }
  }

  if (!production || siteUrl === undefined) {
    throw new Error("Production requires --production and --site-url; Cloudflare also requires both.");
  }
  releasePolicy(siteUrl);
  return cloudflare ? { production, siteUrl, cloudflare } : { production, siteUrl };
}

function activeMarkup(html) {
  const blank = (text) => " ".repeat(text.length);
  const uncommented = html.replace(/<!--[\s\S]*?(?:-->|$)/g, blank);
  const head = uncommented.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i)?.[0] ?? "";
  if (/<(?:template|noscript|textarea|xmp|iframe|noembed|noframes|plaintext)\b/i.test(head)) {
    throw new Error("Unsupported parsing context in release head.");
  }
  return uncommented.replace(/<(script|style|title|textarea|template|noscript|xmp|iframe|noembed|noframes|plaintext)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, blank);
}

function seoTags(html) {
  return [...activeMarkup(html).matchAll(/<(?:meta|link)\b[^>]*>/gi)].filter(([tag]) =>
    /\b(?:rel|name)\s*=\s*["']?(?:canonical|alternate|robots)\b/i.test(tag));
}

function assertHead(html, tags) {
  const active = activeMarkup(html);
  const heads = [...active.matchAll(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi)];
  if (heads.length !== 1 || tags.some((tag) => tag.index <= heads[0].index ||
      tag.index >= heads[0].index + heads[0][0].length)) {
    throw new Error("SEO metadata must occur once in the document head.");
  }
}

function assertExactTags(tags, expected, message) {
  if (tags.length !== expected.length || expected.some((tag) =>
    tags.filter(([actual]) => actual === tag).length !== 1)) {
    throw new Error(message);
  }
}

function applyEdits(source, edits) {
  const ordered = [...edits].sort((left, right) => left.start - right.start);
  let output = "";
  let cursor = 0;
  for (const edit of ordered) {
    if (edit.start < cursor) throw new Error("Overlapping SEO transformations are not allowed.");
    output += source.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  return output + source.slice(cursor);
}

export function productionHtml(html, page, policy) {
  if (!PAGE_PATHS.includes(page)) throw new Error("Unknown language page.");
  const tags = seoTags(html);
  assertHead(html, tags);
  const robotTag = '<meta name="robots" content="noindex, nofollow">';
  const alternates = PREVIEW_ALTERNATES[page];
  assertExactTags(tags, [robotTag, ...alternates], "Unexpected preview SEO metadata; production transformation refused.");

  const generatedLinks = policy.links(page);
  const expectedTags = [
    '<meta name="robots" content="index, follow">',
    ...generatedLinks,
  ];
  const edits = tags.map((entry) => ({
    start: entry.index,
    end: entry.index + entry[0].length,
    replacement: entry[0] === robotTag
      ? `${expectedTags[0]}\n  ${generatedLinks.join("\n  ")}`
      : "",
  }));
  const output = applyEdits(html, edits);
  assertProductionHtml(output, page, policy);
  return output;
}

export function assertProductionHtml(html, page, policy) {
  if (!PAGE_PATHS.includes(page)) throw new Error("Unexpected production HTML page.");
  const tags = seoTags(html);
  assertHead(html, tags);
  assertExactTags(tags, [
    '<meta name="robots" content="index, follow">',
    ...policy.links(page),
  ], "Production SEO metadata differs from the exact language URL policy.");
}
