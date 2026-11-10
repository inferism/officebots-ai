import { existsSync, watch } from "node:fs";
import { basename, dirname } from "node:path";

/**
 * Calls onChange (debounced) when any of the given files is created, edited or removed. Watches the
 * folders that hold them, since editors often replace a file instead of writing into it.
 */
export function watchFiles(files: string[], onChange: () => void, debounceMs = 100): { close(): void } {
  let timer: NodeJS.Timeout | undefined;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };
  const byDir = new Map<string, Set<string>>();
  for (const f of files) {
    const dir = dirname(f);
    byDir.set(dir, (byDir.get(dir) ?? new Set()).add(basename(f)));
  }
  const watchers = [...byDir]
    .filter(([dir]) => existsSync(dir))
    .map(([dir, names]) => {
      const w = watch(dir, (_event, name) => {
        if (name && names.has(String(name))) fire();
      });
      w.on("error", () => {});
      return w;
    });
  return {
    close() {
      clearTimeout(timer);
      for (const w of watchers) w.close();
    },
  };
}
