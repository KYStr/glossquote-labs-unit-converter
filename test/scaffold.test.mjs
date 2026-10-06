import assert from "node:assert/strict";
import { after, test } from "node:test";
import { request as httpRequest } from "node:http";
import { mkdir, lstat, readFile, realpath, readdir, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildProject } from "../scripts/build.mjs";
import { runProjectCheck } from "../scripts/check.mjs";
import { createStaticServer } from "../scripts/serve.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TEMP_PARENT = resolve(PROJECT_ROOT, "test", ".tmp");
const EXPECTED_SCRIPTS = {
  dev: "node scripts/serve.mjs",
  test: "node --test",
  check: "node scripts/check.mjs",
  build: "node scripts/build.mjs",
};

function isWithin(rootPath, targetPath) {
  const difference = relative(rootPath, targetPath);
  return !isAbsolute(difference) && difference !== ".." && difference.split(sep)[0] !== "..";
}

async function createTempCase() {
  await mkdir(TEMP_PARENT, { recursive: true });
  assert.equal((await lstat(TEMP_PARENT)).isSymbolicLink(), false, "test temp root cannot be a junction");
  const canonicalParent = await realpath(TEMP_PARENT);
  assert.ok(isWithin(PROJECT_ROOT, canonicalParent), "test temp directory must stay inside this project");
  const casePath = resolve(canonicalParent, `case-${randomUUID()}`);
  assert.ok(isWithin(canonicalParent, casePath) && casePath !== canonicalParent);
  await mkdir(casePath);
  const canonicalCase = await realpath(casePath);
  assert.equal(canonicalCase, casePath);

  return {
    path: canonicalCase,
    async cleanup() {
      const currentPath = await realpath(casePath);
      assert.equal(currentPath, canonicalCase);
      assert.ok(isWithin(canonicalParent, currentPath) && currentPath !== canonicalParent);
      await rm(currentPath, { recursive: true, force: true });
    },
  };
}

after(async () => {
  try {
    const canonicalParent = await realpath(TEMP_PARENT);
    assert.ok(isWithin(PROJECT_ROOT, canonicalParent));
    await rmdir(canonicalParent);
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error;
  }
});

async function writeFixtureProject(projectRoot) {
  const directories = [
    "scripts",
    "public/styles",
    "public/js",
    "public/en",
    "test",
  ];
  for (const directory of directories) {
    await mkdir(resolve(projectRoot, directory), { recursive: true });
  }

  const packageData = {
    name: "fixture-unit-converter",
    private: true,
    type: "module",
    engines: { node: ">=24" },
    scripts: EXPECTED_SCRIPTS,
  };
  const files = new Map([
    ["package.json", JSON.stringify(packageData, null, 2)],
    ["scripts/serve.mjs", "export {};\n"],
    ["scripts/check.mjs", "export {};\n"],
    ["scripts/build.mjs", "export {};\n"],
    ["scripts/release.mjs", "export {};\n"],
    ["scripts/cloudflare.mjs", "export {};\n"],
    ["public/index.html", "<!doctype html><html><head><link rel=\"stylesheet\" href=\"./styles/app.css\"><script type=\"module\" src=\"./js/app.mjs\"></script></head><body><h1>Fixture</h1></body></html>\n"],
    ["public/en/index.html", "<!doctype html><html><head><link rel=\"stylesheet\" href=\"../styles/app.css\"><script type=\"module\" src=\"../js/app.mjs\"></script></head><body><h1>Fixture</h1></body></html>\n"],
    ["public/styles/tokens.css", ":root {}\n"],
    ["public/styles/app.css", "body { color: black; }\n"],
    ["public/js/app.mjs", "export {};\n"],
    ["test/scaffold.test.mjs", "import { test } from \"node:test\"; test(\"fixture\", () => {});\n"],
    ["wrangler.jsonc", "{}\n"],
  ]);

  for (const [name, contents] of files) {
    await writeFile(resolve(projectRoot, name), contents, "utf8");
  }
}

async function withServer(publicRoot, action) {
  const server = createStaticServer({ publicRoot });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    assert.equal(address.address, "127.0.0.1");
    await action(address.port);
  } finally {
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    });
  }
}

function request(port, requestPath, method = "GET") {
  return new Promise((resolveResponse, rejectResponse) => {
    const outgoing = httpRequest({
      host: "127.0.0.1",
      port,
      path: requestPath,
      method,
      agent: false,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolveResponse({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    outgoing.on("error", rejectResponse);
    outgoing.end();
  });
}

test("fixture cleanup containment rejects parent and other Windows drives", () => {
  assert.equal(isWithin(PROJECT_ROOT, resolve(PROJECT_ROOT, "..")), false);
  if (process.platform === "win32") {
    assert.equal(isWithin("C:\\fixture-root", "D:\\outside-root"), false);
  }
});

test("package contract, static page, and current project checks", async () => {
  const packageData = JSON.parse(await readFile(resolve(PROJECT_ROOT, "package.json"), "utf8"));
  assert.equal(packageData.private, true);
  assert.equal(packageData.type, "module");
  assert.equal(packageData.engines.node, ">=24");
  assert.deepEqual(packageData.scripts, EXPECTED_SCRIPTS);
  for (const dependencyField of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    assert.equal(Object.keys(packageData[dependencyField] ?? {}).length, 0);
  }

  const html = await readFile(resolve(PROJECT_ROOT, "public/index.html"), "utf8");
  assert.match(html, /<html lang="zh-Hant">/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /href="\.\/styles\/tokens\.css"/);
  assert.match(html, /href="\.\/styles\/app\.css"/);
  assert.match(html, /type="module" src="\.\/js\/app\.mjs"/);
  assert.match(html, /<title>[^<]*常用單位換算[^<]*GlossQuote-Labs[^<]*<\/title>/);
  await runProjectCheck(PROJECT_ROOT);
});

test("check ignores only the authorized test temp root", async () => {
  const fixture = await createTempCase();
  try {
    await writeFile(resolve(fixture.path, "broken-fixture.mjs"), "export const = 1;\n", "utf8");
    await runProjectCheck(PROJECT_ROOT);
  } finally {
    await fixture.cleanup();
  }
});

test("development server serves GET and HEAD and rejects unsupported or unknown paths", async () => {
  await withServer(resolve(PROJECT_ROOT, "public"), async (port) => {
    const getIndex = await request(port, "/index.html");
    assert.equal(getIndex.status, 200);
    assert.match(getIndex.headers["content-type"], /^text\/html; charset=utf-8$/);
    assert.equal(getIndex.headers["x-content-type-options"], "nosniff");
    assert.match(getIndex.headers["content-security-policy"], /connect-src 'none'/);
    assert.match(getIndex.body, /^<!doctype html>/i);
    assert.match(getIndex.body, /<title>[^<]*常用單位換算[^<]*GlossQuote-Labs[^<]*<\/title>/);

    const headIndex = await request(port, "/index.html", "HEAD");
    assert.equal(headIndex.status, 200);
    assert.equal(headIndex.body, "");
    assert.equal(headIndex.headers["content-length"], getIndex.headers["content-length"]);

    const post = await request(port, "/index.html", "POST");
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, "GET, HEAD");
    assert.equal(post.body, "Method not allowed.");

    assert.equal((await request(port, "/missing.html")).status, 404);
    assert.equal((await request(port, "/")).status, 404);
    assert.equal((await request(port, "/styles/app.css/extra")).status, 404);
  });
});

test("development server rejects malformed paths, traversal, and dotfiles", async () => {
  await withServer(resolve(PROJECT_ROOT, "public"), async (port) => {
    assert.equal((await request(port, "/../package.json")).status, 403);
    assert.equal((await request(port, "/%2e%2e/package.json")).status, 403);
    assert.equal((await request(port, "/..%2fpackage.json")).status, 403);
    assert.equal((await request(port, "/bad%ZZ.html")).status, 400);
    assert.equal((await request(port, "/index%00.html")).status, 400);
    assert.equal((await request(port, "/%5c..%5cpackage.json")).status, 400);
    assert.equal((await request(port, "/.hidden.html")).status, 403);
  });
});

test("development server refuses a junction that points outside public", async () => {
  const fixture = await createTempCase();
  try {
    const publicRoot = resolve(fixture.path, "public");
    const outside = resolve(fixture.path, "outside");
    await mkdir(publicRoot);
    await mkdir(outside);
    await writeFile(resolve(publicRoot, "index.html"), "<p>fixture</p>", "utf8");
    await writeFile(resolve(outside, "secret.html"), "fixture-secret", "utf8");
    const junction = resolve(publicRoot, "escape");
    await symlink(outside, junction, "junction");
    assert.equal((await lstat(junction)).isSymbolicLink(), true);

    await withServer(publicRoot, async (port) => {
      const response = await request(port, "/escape/secret.html");
      assert.equal(response.status, 403);
      assert.doesNotMatch(response.body, /fixture-secret/);
    });
  } finally {
    await fixture.cleanup();
  }
});

test("check rejects broken local imports and malformed JavaScript", async () => {
  const fixture = await createTempCase();
  try {
    await writeFixtureProject(fixture.path);
    await runProjectCheck(fixture.path);

    const brokenImport = ["im", "port \"./missing.mjs\";\n"].join("");
    await writeFile(resolve(fixture.path, "public/js/app.mjs"), brokenImport, "utf8");
    await assert.rejects(runProjectCheck(fixture.path), /local reference does not exist/);

    await writeFile(resolve(fixture.path, "public/js/app.mjs"), "export {};\n", "utf8");
    const compactImport = ["im", "port", "{value}", "from", " './missing.mjs';\n"].join("");
    await writeFile(resolve(fixture.path, "public/js/app.mjs"), compactImport, "utf8");
    await assert.rejects(runProjectCheck(fixture.path), /local reference does not exist/);

    const externalImport = ["im", "port", "{value}", "from", " 'https://example.invalid/unit.mjs';\n"].join("");
    await writeFile(resolve(fixture.path, "public/js/app.mjs"), externalImport, "utf8");
    await assert.rejects(runProjectCheck(fixture.path), /external module references/);

    const unquotedResource = [
      "<!doctype html><html><head><script src=",
      "https://example.invalid/a.mjs></script></head><body></body></html>",
    ].join("");
    await writeFile(resolve(fixture.path, "public/index.html"), unquotedResource, "utf8");
    await assert.rejects(runProjectCheck(fixture.path), /external or non-file reference/);

    await writeFixtureProject(fixture.path);
    await writeFile(resolve(fixture.path, "scripts/serve.mjs"), "export const = 1;\n", "utf8");
    await assert.rejects(runProjectCheck(fixture.path), /JavaScript syntax check failed/);
  } finally {
    await fixture.cleanup();
  }
});

test("check does not skip a dot directory inside public", async () => {
  const fixture = await createTempCase();
  try {
    await writeFixtureProject(fixture.path);
    await mkdir(resolve(fixture.path, "public/.tmp"));
    await writeFile(resolve(fixture.path, "public/.tmp/hidden.mjs"), "export {};\n", "utf8");
    await assert.rejects(runProjectCheck(fixture.path), /dotfiles are not allowed/);
  } finally {
    await fixture.cleanup();
  }
});

test("build copies only public files within dist", async () => {
  const fixture = await createTempCase();
  try {
    await writeFixtureProject(fixture.path);
    await mkdir(resolve(fixture.path, "docs"));
    await writeFile(resolve(fixture.path, "docs/notes.txt"), "private fixture", "utf8");
    const result = await buildProject({ projectPath: fixture.path, check: async () => ({ ok: true }) });
    const canonicalRoot = await realpath(fixture.path);
    const canonicalOutput = await realpath(result.outputPath);
    assert.ok(isWithin(canonicalRoot, canonicalOutput));
    assert.equal(relative(canonicalRoot, canonicalOutput), "dist");
    assert.equal(result.fileCount, 5);
    assert.match(await readFile(resolve(canonicalOutput, "index.html"), "utf8"), /Fixture/);
    assert.match(await readFile(resolve(canonicalOutput, "js/app.mjs"), "utf8"), /export/);
    await assert.rejects(readFile(resolve(canonicalOutput, "docs/notes.txt")));
    await assert.rejects(readFile(resolve(canonicalOutput, "test/scaffold.test.mjs")));
  } finally {
    await fixture.cleanup();
  }
});

test("build rejects a dist junction without changing its target", async () => {
  const fixture = await createTempCase();
  try {
    await writeFixtureProject(fixture.path);
    const outside = resolve(fixture.path, "outside");
    await mkdir(outside);
    const sentinelPath = resolve(outside, "keep.txt");
    await writeFile(sentinelPath, "fixture sentinel", "utf8");
    const distJunction = resolve(fixture.path, "dist");
    await symlink(outside, distJunction, "junction");
    assert.equal((await lstat(distJunction)).isSymbolicLink(), true);

    await assert.rejects(
      buildProject({ projectPath: fixture.path, check: async () => ({ ok: true }) }),
      /dist output cannot be a symbolic link/,
    );
    assert.equal(await readFile(sentinelPath, "utf8"), "fixture sentinel");
  } finally {
    await fixture.cleanup();
  }
});
