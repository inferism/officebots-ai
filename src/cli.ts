import { accounts } from "./cli/accounts.js";
import { demo } from "./cli/demo.js";
import { doctor } from "./cli/doctor.js";
import { ping } from "./cli/ping.js";
import { replay } from "./cli/replay.js";
import { start } from "./cli/start.js";

function usage(): never {
  console.error(
    [
      "usage:",
      "  officebots start [--claude-dir <dir>]... [--codex-dir <dir>]   open this project's office",
      "  officebots doctor [--claude-dir <dir>] [--codex-dir <dir>]  show watched roots and unknown record counts",
      "  officebots demo [--agents N] [--interns N] [--idle-after SEC]   synthetic office, reads no logs",
      "  officebots accounts [--days N]            list hashed account ids seen, with nicknames",
      "  officebots accounts name <id> <nickname>  give an account a nickname (empty nickname removes it)",
      "  officebots ping --tool <name> [--model <name>] [--tokens-in N] [--tokens-out N] [--event working|waiting|...]",
      "  officebots replay <session.jsonl> [--project <dir>]",
    ].join("\n"),
  );
  process.exit(2);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "replay") replay(rest, usage);
else if (cmd === "start") await start(rest, usage);
else if (cmd === "accounts") await accounts(rest, usage);
else if (cmd === "ping") await ping(rest);
else if (cmd === "demo") await demo(rest);
else if (cmd === "doctor") await doctor(rest);
else usage();
