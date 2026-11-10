import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { hostAllowed, originAllowed } from "./http.js";

/**
 * Read-only broadcast channel at /ws. Browsers always send Origin, so a page from any other origin is
 * rejected. Clients with no Origin (non-browser tools) are local processes and may connect.
 */
export function attachWs(server: Server, getPort: () => number, onConnect: (send: (msg: string) => void) => void) {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 1024,
    verifyClient: ({ origin, req }, done) => {
      const port = getPort();
      const ok = hostAllowed(req, port) && (origin === undefined || originAllowed(origin, port));
      done(ok, 403, "forbidden");
    },
  });
  wss.on("connection", (ws) => {
    ws.on("error", () => ws.terminate());
    onConnect((m) => ws.send(m));
  });
  return {
    broadcast(msg: string) {
      for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
    },
    close() {
      for (const c of wss.clients) c.terminate();
      wss.close();
    },
  };
}
