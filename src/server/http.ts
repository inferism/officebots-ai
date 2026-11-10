import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { type OfficeEvent, validateEvent } from "../core/schema.js";

/** Host header must name this server, which blocks DNS-rebinding pages from reaching it. */
export function hostAllowed(req: IncomingMessage, port: number): boolean {
  const h = req.headers.host;
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

/** A browser always sends Origin on cross-site requests, so anything but our own page is refused. */
export function originAllowed(origin: string, port: number): boolean {
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

const MAX_BODY = 16 * 1024;
const MAX_BATCH = 100;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

export function createHttpServer(opts: {
  uiDir: string;
  getPort: () => number;
  project: { key: string };
  /** Receives validated events from POST /events. */
  onEvents?: (events: OfficeEvent[]) => void;
}): Server {
  const root = resolve(opts.uiDir);
  return createServer(async (req, res) => {
    if (!hostAllowed(req, opts.getPort())) {
      res.writeHead(403).end("forbidden");
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (path === "/events") {
      handleEvents(req, res, opts);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
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

function reply(res: ServerResponse, status: number, error?: string): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(error ? { error } : { ok: true }));
}

/**
 * POST /events. Same validator as the log adapters. Guards against drive-by posts from web pages:
 * foreign Origin refused, JSON content type required (which forces a CORS preflight we never answer),
 * small body, and the event must belong to this office's project.
 */
function handleEvents(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { getPort: () => number; project: { key: string }; onEvents?: (events: OfficeEvent[]) => void },
): void {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" }).end();
    return;
  }
  const origin = req.headers.origin;
  const site = req.headers["sec-fetch-site"];
  if ((origin !== undefined && !originAllowed(origin, opts.getPort())) || (site !== undefined && site !== "same-origin" && site !== "none")) {
    reply(res, 403, "forbidden_origin");
    return;
  }
  if ((req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase() !== "application/json") {
    reply(res, 415, "content_type_must_be_json");
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let tooBig = false;
  req.on("data", (c: Buffer) => {
    size += c.length;
    if (size > MAX_BODY) tooBig = true;
    else chunks.push(c);
  });
  req.on("end", () => {
    if (tooBig) return reply(res, 413, "too_large");
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return reply(res, 400, "invalid_json");
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    if (list.length === 0 || list.length > MAX_BATCH) return reply(res, 400, "invalid_event");
    const events: OfficeEvent[] = [];
    for (const item of list) {
      // convenience for curl users: an omitted project means "this office's project"
      const withProject = typeof item === "object" && item !== null && !Array.isArray(item) && (item as Record<string, unknown>).project === undefined
        ? { ...item, project: opts.project.key }
        : item;
      const ev = validateEvent(withProject);
      if (!ev) return reply(res, 400, "invalid_event");
      if (ev.project !== opts.project.key) return reply(res, 409, "wrong_project");
      events.push(ev);
    }
    opts.onEvents?.(events);
    reply(res, 202);
  });
  req.on("error", () => reply(res, 400, "invalid_request"));
}
