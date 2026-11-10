// The only outbound connections in src/, and they only ever go to 127.0.0.1: a health check and
// event delivery to an office running on this machine.
import { readFileSync } from "node:fs";
import { get, request } from "node:http";
import { join } from "node:path";

export function probeOffice(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = get({ host: "127.0.0.1", port, path: "/health", timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

/** POST one event to the office on this machine. Resolves with the HTTP status, or 0 if unreachable. */
export function postEvent(port: number, event: unknown, timeoutMs = 2000): Promise<number> {
  return new Promise((resolve) => {
    const body = JSON.stringify(event);
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: "/events",
        method: "POST",
        timeout: timeoutMs,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(0));
    req.end(body);
  });
}

function pidAlive(pid: unknown): boolean {
  if (typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Port of this project's running office, found through .officebots/.state/run.json, or null. */
export async function findOfficePort(root: string, timeoutMs = 500): Promise<number | null> {
  try {
    const run = JSON.parse(readFileSync(join(root, ".officebots", ".state", "run.json"), "utf8"));
    if (typeof run.port === "number" && pidAlive(run.pid) && (await probeOffice(run.port, timeoutMs))) return run.port;
  } catch {
    // no run file, or unreadable
  }
  return null;
}
