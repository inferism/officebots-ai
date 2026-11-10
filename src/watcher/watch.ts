import { watch } from "node:fs";
import { join } from "node:path";

/**
 * Recursive OS-level watch (no polling). Calls onFile with the absolute path of a changed file after a
 * short per-file debounce. onError fires if the watcher itself fails, so the caller can run a reconcile scan.
 */
export function watchRoot(
  root: string,
  onFile: (path: string) => void,
  onError: (err: Error) => void,
  debounceMs = 30,
  filter: (path: string) => boolean = (p) => p.endsWith(".jsonl"),
): { close(): void } {
  const timers = new Map<string, NodeJS.Timeout>();
  const w = watch(root, { recursive: true }, (_event, name) => {
    if (!name) return;
    const path = join(root, String(name));
    if (!filter(path)) return;
    clearTimeout(timers.get(path));
    timers.set(
      path,
      setTimeout(() => {
        timers.delete(path);
        onFile(path);
      }, debounceMs),
    );
  });
  w.on("error", onError);
  return {
    close() {
      w.close();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}
