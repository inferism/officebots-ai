import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { extname, join, resolve, sep } from "node:path";

/** Host header must name this server, which blocks DNS-rebinding pages from reaching it. */
export function hostAllowed(req: IncomingMessage, port: number): boolean {
  const h = req.headers.host;
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

export function createHttpServer(opts: { uiDir: string; getPort: () => number; project: { key: string } }): Server {
  const root = resolve(opts.uiDir);
  return createServer(async (req, res) => {
    if (!hostAllowed(req, opts.getPort())) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (path === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, project: opts.project.key }));
      return;
    }
    if (path === "/") path = "/index.html";
    const file = resolve(join(root, path));
    const type = TYPES[extname(file)];
    if (!type || path.includes("\0") || !file.startsWith(root + sep)) {
      res.writeHead(404).end("not found");
      return;
    }
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src ws://127.0.0.1:* ws://localhost:*",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
}
