import { fileURLToPath } from "node:url";
import { createDemo } from "../demo/generator.js";
import { startOffice } from "../server/office.js";

function num(args: string[], flag: string, fallback: number): number {
  const i = args.indexOf(flag);
  const n = i >= 0 ? Number(args[i + 1]) : fallback;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Synthetic office through the real reducer and renderer. Reads no logs and writes no files. */
export async function demo(args: string[]): Promise<void> {
  const agents = Math.floor(num(args, "--agents", 12));
  const interns = Math.floor(num(args, "--interns", 10));
  const idleAfterSec = num(args, "--idle-after", 15);
  const office = await startOffice({
    root: "demo",
    uiDir: fileURLToPath(new URL("./ui/", import.meta.url)),
    idleAfterSec,
    throttleMs: 100,
  });
  const gen = createDemo({ agents, interns, project: office.snapshot().project.key });
  const timer = setInterval(() => office.apply(gen.tick()), 500);
  console.log(`officebots demo (${agents} agents, ${interns} interns): ${office.url}`);
  console.log("synthetic data, no logs are read. Press Ctrl+C to stop");
  const stop = () => {
    clearInterval(timer);
    void office.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
