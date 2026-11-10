import { unwatchFile, watchFile } from "node:fs";

/**
 * Calls onChange (debounced) when any of the given files is created, edited or removed.
 *
 * This polls the files' modified time and size instead of using OS change events. On Windows an
 * OS-level watch on a folder keeps a handle open that stops the folder (here, .officebots) from being
 * deleted or renamed while the office runs. Polling holds no handles, and two files twice a second is cheap.
 */
export function watchFiles(files: string[], onChange: () => void, intervalMs = 500): { close(): void } {
  let timer: NodeJS.Timeout | undefined;
  const listener = (curr: { mtimeMs: number; size: number }, prev: { mtimeMs: number; size: number }) => {
    if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, 100);
  };
  for (const f of files) watchFile(f, { interval: intervalMs, persistent: false }, listener);
  return {
    close() {
      clearTimeout(timer);
      for (const f of files) unwatchFile(f, listener);
    },
  };
}
