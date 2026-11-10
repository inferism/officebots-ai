// Commands are loaded on demand, so a quick command (like the session hook) does not pay for the rest.
const USAGE = [
  "usage:",
  "  officebots open [--no-open]                open this project's office (creates .officebots/, starts it if needed)",
  "  officebots start [--since <hours>] [--claude-dir <dir>]... [--codex-dir <dir>]   run this project's office in the foreground",
  "  officebots export [--out <file>] [--since <hours>] [--no-open]   write a standalone HTML file of the office (a snapshot)",
  "  officebots status | stop                   check on, or stop, this project's office",
  "  officebots setup [--dry-run] [--yes]       install the /officebots skill and the SessionStart hook",
  "  officebots uninstall [--dry-run] [--yes]   undo setup",
  "  officebots ping --tool <name> [--model <name>] [--tokens-in N] [--tokens-out N] [--event working|waiting|...]",
  "  officebots accounts [--days N]             list hashed account ids seen, with nicknames",
  "  officebots accounts name <id> <nickname>   give an account a nickname (empty nickname removes it)",
  "  officebots doctor [--claude-dir <dir>] [--codex-dir <dir>]   watched roots and unknown record counts",
  "  officebots demo [--agents N] [--interns N] [--idle-after SEC]   synthetic office, reads no logs",
  "  officebots replay <session.jsonl> [--project <dir>]",
].join("\n");

function usage(): never {
  console.error(USAGE);
  process.exit(2);
}

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case "hook": {
    if (rest[0] !== "claude-session-start") usage();
    const { main } = await import("./hooks/claude-session-start.js");
    await main(process.argv[1]!);
    break;
  }
  case "open":
    await (await import("./cli/open.js")).open(rest);
    break;
  case "status":
    await (await import("./cli/open.js")).status();
    break;
  case "stop":
    await (await import("./cli/open.js")).stop();
    break;
  case "start":
    await (await import("./cli/start.js")).start(rest, usage);
    break;
  case "export":
    await (await import("./cli/export.js")).exportHtml(rest, usage);
    break;
  case "setup":
    await (await import("./cli/setup.js")).setup(rest);
    break;
  case "uninstall":
    await (await import("./cli/setup.js")).uninstall(rest);
    break;
  case "ping":
    await (await import("./cli/ping.js")).ping(rest);
    break;
  case "accounts":
    await (await import("./cli/accounts.js")).accounts(rest, usage);
    break;
  case "doctor":
    await (await import("./cli/doctor.js")).doctor(rest);
    break;
  case "demo":
    await (await import("./cli/demo.js")).demo(rest);
    break;
  case "replay":
    (await import("./cli/replay.js")).replay(rest, usage);
    break;
  default:
    usage();
}
