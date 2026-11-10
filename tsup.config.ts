import { cpSync } from "node:fs";
import { defineConfig } from "tsup";

// Two bundles: the Node CLI/server, and the browser UI (three.js is bundled in, so nothing loads from a CDN).
export default defineConfig([
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    target: "node22",
    platform: "node",
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: { app: "ui/src/main.ts" },
    outDir: "dist/ui",
    format: ["iife"],
    target: "es2022",
    platform: "browser",
    minify: true,
    outExtension: () => ({ js: ".js" }),
    noExternal: [/.*/],
    tsconfig: "ui/tsconfig.json",
    onSuccess: async () => {
      cpSync("ui/index.html", "dist/ui/index.html");
      cpSync("ui/style.css", "dist/ui/style.css");
    },
  },
]);
