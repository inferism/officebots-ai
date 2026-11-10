import { withAccounts } from "../adapters/index.js";
import { loadPersonalConfig, setNickname } from "../core/config.js";
import { createAccountHasher, personalConfigPath } from "../core/identity.js";
import { createIngest } from "../watcher/ingest.js";
import { pickSources } from "./start.js";

type Seen = { tools: Set<string>; lastSeen: number; events: number };

/**
 * `officebots accounts` lists the hashed account ids seen in recent logs, so they can be given
 * nicknames without anyone seeing an email. `officebots accounts name <id> <nickname>` sets one.
 */
export async function accounts(args: string[], usage: () => never): Promise<void> {
  const personalPath = personalConfigPath();
  if (args[0] === "name") {
    if (args.length < 2 || args.length > 3) usage();
    const err = setNickname(personalPath, args[1]!, args[2] ?? "");
    if (err) {
      console.error(`officebots accounts: ${err}`);
      process.exit(2);
    }
    console.log(args[2] ? `${args[1]} is now called "${args[2]}"` : `removed the nickname of ${args[1]}`);
    return;
  }

  const di = args.indexOf("--days");
  const days = di >= 0 ? Number(args[di + 1]) : 7;
  if (!Number.isFinite(days) || days <= 0) usage();
  const rest = args.filter((a, i) => a !== "--days" && args[i - 1] !== "--days");

  const sources = withAccounts(pickSources(rest, personalPath, usage), { hash: createAccountHasher(personalPath), personalPath });
  const seen = new Map<string, Seen>();
  const ingest = createIngest({
    sources,
    project: () => "all", // every folder counts here
    hashAccount: createAccountHasher(personalPath),
    onEvents: (events) => {
      for (const e of events) {
        const key = e.account ?? "";
        const s = seen.get(key) ?? { tools: new Set<string>(), lastSeen: 0, events: 0 };
        s.tools.add(e.tool);
        s.lastSeen = Math.max(s.lastSeen, Date.parse(e.time));
        s.events++;
        seen.set(key, s);
      }
    },
    recentMs: days * 24 * 3600 * 1000,
    catchUpOld: false,
  });
  await ingest.start();
  ingest.close();

  const names = loadPersonalConfig(personalPath).accounts;
  console.log(`accounts seen in the last ${days} day${days === 1 ? "" : "s"} (ids are hashed; no emails are read or shown):`);
  const rows = [...seen].filter(([id]) => id !== "").sort((a, b) => b[1].lastSeen - a[1].lastSeen);
  for (const [id, s] of rows) {
    console.log(`  ${id}  ${(names[id] ? `"${names[id]}"` : "(no nickname)").padEnd(18)} ${[...s.tools].join(", ").padEnd(24)} last seen ${new Date(s.lastSeen).toISOString().slice(0, 16).replace("T", " ")}  ${s.events} events`);
  }
  if (rows.length === 0) console.log("  none");
  const unknown = seen.get("");
  if (unknown) console.log(`  (${unknown.events} events from ${[...unknown.tools].join(", ")} had no account, see docs/settings.md)`);
  console.log('\nname one with: officebots accounts name <id> <nickname>');
}
