# officebots

A live isometric office that shows which AI agents are working on your project.

Each agent (tool + model + account + role) gets a character at a desk with a label, a status light and a token count. The room updates as agents join, work and fall asleep. Claude Code and Codex are read from their local logs; any other tool can report in with one command.

**Everything stays on your machine.** officebots reads local log files, hashes account ids, keeps no prompts or file contents, binds only to `127.0.0.1`, and makes no outbound network calls. See [docs/settings.md](docs/settings.md) for what it reads and how to configure it.

## Install

Needs Node 22.15 or newer.

```bash
npm install -g officebots
officebots setup
```

`officebots setup` installs the `/officebots` skill for Claude Code and registers a SessionStart hook. It shows you exactly what it will change in `~/.claude/settings.json`, writes a timestamped backup, and only writes after you answer `y`. Use `--dry-run` to look without writing, and `officebots uninstall` to undo it.

## Use

In a project, from Claude Code, run `/officebots`. Or from a terminal:

```bash
officebots open
```

This creates a small `.officebots/` folder in the project, starts that project's office in the background, and opens it in your browser. After that, opening Claude Code in the project starts the office by itself. In projects without `.officebots/office.json` the hook does nothing.

The office shows sessions from the last 14 days (as sleeping characters) plus anything happening now; `officebots start --since <hours>` changes that window. Each project gets its own office on its own local port. Sessions in subfolders and git worktrees of the project count as the same project.

| command | what it does |
|---|---|
| `officebots open` | open this project's office (create and start it if needed) |
| `officebots status` / `stop` | check on, or stop, this project's office |
| `officebots ping --tool gemini-cli --model gemini-pro` | show a tool that has no adapter yet |
| `officebots accounts` | list hashed account ids seen, to give them nicknames |
| `officebots doctor` | show watched folders and unknown log record types |
| `officebots demo --agents 40` | a synthetic office, reads no logs |

Other tools can also report in over HTTP (`POST /events`, JSON only, from this machine only); the port is in `.officebots/.state/run.json`.

## Other tools

`officebots ping --tool <name> [--model <name>] [--tokens-out N]` creates a character for any tool. Adapters for more tools can be added once their log formats are checked on a real machine; see `docs/` for the notes on the formats read so far.

## Development

```bash
npm ci
npm test            # unit and integration tests
npm run typecheck
npm run check:fixtures   # fails if test fixtures contain emails, home paths, keys or real-looking ids
npm run build
```

Test fixtures are written by hand with fake ids; real logs are never copied into the repo. The design and the decisions behind it are in [PLAN.md](PLAN.md).

## License

MIT
