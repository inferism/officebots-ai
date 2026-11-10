// The only outbound connection in src/: a loopback health check against an office we may have started.
import { get } from "node:http";

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
