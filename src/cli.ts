import { doctor } from "./cli/doctor.js";
import { replay } from "./cli/replay.js";
import { start } from "./cli/start.js";

function usage(): never {
  console.error(
    [
      "usage:",
      "  officebots start [--claude-dir <dir>]   open this project's office",
      "  officebots doctor [--claude-dir <dir>]  show watched roots and unknown record counts",
      "  officebots replay <session.jsonl> [--project <dir>]",
    ].join("\n"),
  );
  process.exit(2);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "replay") replay(rest, usage);
else if (cmd === "start") await start(rest, usage);
else if (cmd === "doctor") await doctor(rest);
else usage();
