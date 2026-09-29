import { createServer } from "node:http";
import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_PUBLIC_ROOT = resolve(PROJECT_ROOT, "public");
const HOST = "127.0.0.1";
const PORT = 4173;

export const STATIC_MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
]);

const SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
});

function isPathInside(rootPath, candidatePath) {
  const difference = relative(rootPath, candidatePath);
  return difference === "" || (
    difference !== ".." &&
    !isAbsolute(difference) &&
    difference.split(sep)[0] !== ".."
  );
}

function sendText(response, statusCode, text, extraHeaders = {}, method = "GET") {
  const body = Buffer.from(text, "utf8");
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": body.byteLength,
    ...extraHeaders,
  });
  response.end(method === "HEAD" ? undefined : body);
}

async function resolveRequestFile(publicRootPath, requestTarget) {
  if (typeof requestTarget !== "string" || requestTarget.length === 0 || requestTarget[0] !== "/") {
    return { statusCode: 400 };
  }
  if (requestTarget[1] === "/" || requestTarget.includes("\\") || requestTarget.includes("\0")) {
    return { statusCode: 400 };
  }

  const queryPosition = requestTarget.indexOf("?");
  const rawPath = queryPosition === -1 ? requestTarget : requestTarget.slice(0, queryPosition);
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return { statusCode: 400 };
  }

  if (decodedPath.includes("\\") || decodedPath.includes("\0") || decodedPath[0] !== "/") {
    return { statusCode: 400 };
  }
  if (decodedPath === "/") {
    return { statusCode: 404 };
  }

  const segments = decodedPath.slice(1).split("/");
  if (segments.length === 0 || segments.some((segment) => (
    segment === "" || segment === "." || segment === ".." || segment[0] === "." || segment.includes(":")
  ))) {
    return { statusCode: 403 };
  }

  const extension = extname(segments.at(-1)).toLowerCase();
  if (!STATIC_MIME_TYPES.has(extension)) {
    return { statusCode: 404 };
  }

  const absoluteTarget = resolve(publicRootPath, ...segments);
  if (!isPathInside(publicRootPath, absoluteTarget) || absoluteTarget === publicRootPath) {
    return { statusCode: 403 };
  }

  let currentPath = publicRootPath;
  try {
    const rootInfo = await lstat(publicRootPath);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      return { statusCode: 403 };
    }

    for (const segment of segments) {
      currentPath = resolve(currentPath, segment);
      const info = await lstat(currentPath);
      if (info.isSymbolicLink()) {
        return { statusCode: 403 };
      }
    }

    const canonicalRoot = await realpath(publicRootPath);
    const canonicalTarget = await realpath(absoluteTarget);
    if (!isPathInside(canonicalRoot, canonicalTarget) || canonicalTarget === canonicalRoot) {
      return { statusCode: 403 };
    }

    const info = await lstat(canonicalTarget);
    if (!info.isFile()) {
      return { statusCode: 404 };
    }

    return { filePath: canonicalTarget, extension };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return { statusCode: 404 };
    }
    return { statusCode: 404 };
  }
}

export function createStaticServer({ publicRoot = DEFAULT_PUBLIC_ROOT } = {}) {
  const publicRootPath = resolve(publicRoot);

  return createServer(async (request, response) => {
    const method = request.method ?? "";
    if (method !== "GET" && method !== "HEAD") {
      sendText(response, 405, "Method not allowed.", { Allow: "GET, HEAD" }, method);
      return;
    }

    const resolved = await resolveRequestFile(publicRootPath, request.url);
    if (resolved.statusCode) {
      const messages = new Map([
        [400, "Bad request."],
        [403, "Forbidden."],
        [404, "Not found."],
      ]);
      sendText(response, resolved.statusCode, messages.get(resolved.statusCode) ?? "Not found.", {}, method);
      return;
    }

    try {
      const body = await readFile(resolved.filePath);
      response.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": STATIC_MIME_TYPES.get(resolved.extension),
        "Content-Length": body.byteLength,
      });
      response.end(method === "HEAD" ? undefined : body);
    } catch {
      sendText(response, 404, "Not found.", {}, method);
    }
  });
}

export function startDevelopmentServer() {
  const server = createStaticServer();
  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE") {
      process.stderr.write("Could not start local preview at 127.0.0.1:4173; the port may be in use.\n");
    } else {
      process.stderr.write("Could not start the local preview server.\n");
    }
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    process.stdout.write(`Local preview available at http://${HOST}:${PORT}/index.html\n`);
  });
  return server;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  startDevelopmentServer();
}
