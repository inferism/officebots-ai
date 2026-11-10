import { createServer, type IncomingMessage, type Server } from "node:http";

/** Host header must name this server, which blocks DNS-rebinding pages from reaching it. */
export function hostAllowed(req: IncomingMessage, port: number): boolean {
  const h = req.headers.host;
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

export function createHttpServer(opts: { uiHtml: string; getPort: () => number; project: { key: string } }): Server {
  return createServer((req, res) => {
    if (!hostAllowed(req, opts.getPort())) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const url = (req.url ?? "/").split("?")[0];
    if (url === "/") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src ws://127.0.0.1:* ws://localhost:*",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : opts.uiHtml);
    } else if (url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, project: opts.project.key }));
    } else {
      res.writeHead(404).end("not found");
    }
  });
}
