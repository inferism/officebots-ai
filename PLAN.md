# officebots-ai: implementation plan

A live isometric office that shows which AI agents are working on a project. Each agent (tool + model + account + role) gets a character at a desk with a label, a status light and a token count. The room updates as agents join, work and fall asleep. All data comes from local logs, and nothing leaves the machine.

This document is the plan only. No application code exists yet. `docs/mockup/office-mockup.html` is the look-and-feel reference, not the architecture.

---

## 1. Real log formats (inspected on a dev machine, Nov 2026)

These notes come from reading actual files, with a script that printed only key paths and types and never printed message text. Versions seen were Claude Code `2.1.317` to `2.1.321` and Codex CLI `0.167.0-alpha`. Both formats are undocumented and change between minor versions (see risk #1).

### 1.1 Claude Code: `~/.claude/projects/<encoded-cwd>/`

**Layout**
```
~/.claude/projects/
  <encoded-cwd>/                       # cwd with ':' '\' '/' '.' replaced by '-'  (lossy!)
    <sessionId>.jsonl                  # main session, append-only JSONL
    <sessionId>/
      subagents/
        agent-<agentId>.jsonl          # one file per spawned subagent
        agent-<agentId>.meta.json      # small JSON: agentType, toolUseId, spawnDepth, finished, ...
        agent-<agentId>.prefix.json
      tool-results/                    # large tool outputs (ignore)
```
The Claude desktop app also writes here (`entrypoint: "claude-desktop"`), including throwaway scratch-workspace folders. Those never match a real project root, so the cwd filter removes them.

**Record types (`type`)**: `user`, `assistant`, `attachment`, `queue-operation`, `last-prompt`, `file-history-snapshot`, `api-request-shape`, `api-request-blob`, `api-request`, `atis-latch`, and others. Unknown types must be ignored.

| Need | Field | Notes |
|---|---|---|
| Model | `assistant.message.model` (e.g. `claude-sonnet-5-5`) | Also `requestedModel` and `advisorModel` on the same record. Can change mid-session (`/model`). |
| Tokens | `assistant.message.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens_details.thinking_tokens}` | **Repeated on every content block of one API response.** In one session there were 73 assistant records but only 43 unique `message.id` values. Dedupe by `message.id` (or `requestId`), otherwise counts are about 1.7x too high. |
| Working vs waiting | `assistant.message.stop_reason`: `tool_use` (still working) or `end_turn` (turn finished, waiting for user) | Plus file-change timing for sleeping. |
| Subagents | `isSidechain: true` and `agentId` on records inside `subagents/agent-*.jsonl`; `.meta.json` gives `agentType` (e.g. `general-purpose`, `Explore`), `toolUseId` (links to the parent's `Agent` tool call), `spawnDepth`, `finished` | The subagent's own `message.model` can differ from the parent (seen: Opus subagent under a Sonnet parent). |
| Working directory | `cwd` on most records; `gitBranch`; `relocatedCwd` occasionally | cwd **can change within a session** (2 distinct values seen in one file). |
| Session / time | `sessionId`, `timestamp` (ISO), `uuid`/`parentUuid`, `version`, `entrypoint` | |
| Account | **Missing from the session logs.** | `~/.claude.json` → `oauthAccount.accountUuid` gives the *currently* logged-in account only. Some `attachment` records carry an `organizationUuid` (org, not user). `CLAUDE_CONFIG_DIR` gives separate config roots per account, which is the common multi-account setup. |

**Privacy hazard found:** an `attachment` record (`attachment.context.userEmail`) contains the user's email. Raw lines also hold full prompts, tool inputs and outputs. Adapters must extract allowlisted fields only and never keep or forward a raw line (see §3.4).

### 1.2 Codex: `~/.codex/sessions/YYYY/MM/DD/`

**Layout**
```
~/.codex/sessions/2026/11/10/rollout-<ISO-time>-<threadId>.jsonl       # live / recent
~/.codex/sessions/2026/11/02/rollout-<ISO-time>-<threadId>.jsonl.zst   # older: zstd-compressed
~/.codex/session_index.jsonl                                           # {id, thread_name, updated_at}
```
- Files are **not grouped by project**. The project is known only from `session_meta.payload.cwd` (first line), so every new rollout file's head must be read.
- Rollouts are later **compressed in place to `.jsonl.zst`**. The watcher must treat the rename as the same thread (key by threadId, not path) and must not count it twice. Node ≥ 22.15 can read zstd natively (`zlib.zstdDecompressSync`), so no dependency is needed.
- Every line is `{timestamp, ordinal, type, payload, metadata}`.

| Need | Field | Notes |
|---|---|---|
| Model | `turn_context.payload.model` (e.g. `gpt-6.1-sol`), also `session_meta.payload.collaboration_mode.settings.model` | Per turn, so it can change mid-thread. `model_provider` (e.g. `openai`), `effort`. |
| Tokens | `event_msg` with `payload.type == "token_count"` → `payload.info.total_token_usage` (**cumulative**) and `last_token_usage` (per call): `{input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens, total_tokens}` | Also a newer `token_usage_record` type with `usage`, `turn_token_usage`, `thread_token_usage` and `thread_id`. Use cumulative totals and diff them into deltas so replays are idempotent. |
| Working vs waiting | `event_msg/task_started`, `task_complete`, `turn_aborted` | Clean start and stop signals, better than Claude Code's. |
| Subagents | A **separate rollout file** per spawned thread. `session_meta.payload.source.subagent.thread_spawn = {parent_thread_id, depth, agent_path, agent_nickname, agent_role}`, plus `forked_from_id` | Forked threads **inherit parent history** (`metadata.inherited_user_message`, `subagent_history_start_ordinal`). Ignore token records before that ordinal or tokens are double-counted. |
| Working directory | `session_meta.payload.cwd`, `turn_context.payload.cwd`, `git.{branch, repository_url}` | |
| Account | `session_meta.payload.creator_account_id` and `creator_user_id` | **Present per session.** Must be hashed before use and never displayed raw. |
| Client | `originator` (e.g. `Codex Desktop`), `source` (`vscode`, `cli`, or subagent object), `cli_version` | |

Codex also has a `hooks` section and `notify` in `~/.codex/config.toml`. These are a possible hook-based auto-start (optional in v1.0).

### 1.3 Gaps summary

| | Claude Code | Codex |
|---|---|---|
| Model | ✅ per response | ✅ per turn |
| Tokens | ✅ per response, needs dedupe | ✅ cumulative, needs delta + inherited-history skip |
| Subagents | ✅ separate files + meta | ✅ separate threads + parent id |
| Working dir | ✅ per record (can change) | ✅ per session/turn |
| Account | ❌ **not in logs**, needs a hook or config-dir mapping | ✅ `creator_account_id` |
| Explicit idle/end | ⚠️ only `stop_reason`, no session-end record | ✅ task_complete/aborted |
| Stability | ⚠️ many record types, changes often | ⚠️ alpha CLI, compression migration |

---

## 2. Tech stack and why

| Decision | Choice | Why |
|---|---|---|
| Language | **TypeScript on Node ≥ 22.15** (develop on Node 24 LTS) | Users of both Claude Code and Codex have Node; native recursive `fs.watch`; native zstd; one language for office server, CLI and UI. |
| Runtime deps | `ws` (WebSocket server), `three`. Nothing else at runtime. | Small surface for a tool that reads private logs. HTTP, file watching and zstd come from Node stdlib. |
| Build / test | `tsup` (CLI + office server), `vite` (UI), `vitest` (tests) | Fast, standard, dev-only. |
| File watching | `fs.watch(root, {recursive: true})` + byte-offset tailing + debounce | Satisfies "OS events, not polling". Works on Windows/macOS and Linux (Node ≥ 20). One slow reconcile scan runs only at startup and on watcher error. |
| Transport | **One office server per project**, on `127.0.0.1` and a free port picked at start: static UI + `POST /events` + WebSocket `/ws` | Each project gets its own office. The port and process id are recorded in `.officebots/.state/run.json` inside the project, so the hook, `ping` and `/officebots` can find a running office. Bound to loopback only. |
| Rendering | **Three.js, `OrthographicCamera` at isometric angles, flat-shaded box geometry (voxel look)** | See below. |
| Packaging | **Single npm package `officebots`** (CLI + office server + prebuilt UI) **plus a skill installed by `officebots setup`** | See §6. No monorepo in v1. |

**Canvas 2D vs Three.js.** The mockup's canvas approach works for 6 fixed desks, but it hand-sorts draw order (`items.sort(d)`). That ordering breaks as soon as objects overlap across tiles, which is exactly what a growing grid, interns around desks, a lounge and fade-outs produce. Three.js with an orthographic camera gives:
- a depth buffer, so the sorting bugs go away;
- zoom-to-fit via `camera.zoom`, which is the "camera zooms out" requirement;
- raycast picking for hover/click instead of distance checks;
- `InstancedMesh` for dozens of interns at almost no cost.

Cost: about 150 KB gzipped, which is bundled locally with no CDN, so it stays network-free. Labels are HTML overlays positioned from projected 3D points, which keeps text crisp and makes it easy to cap how many are visible. The mockup's palette, proportions (desk 2×1, character about 1.8 tall) and label style carry over directly.

---

## 3. Common event schema

### 3.1 Shape (v1)

```ts
type OfficeEvent = {
  v: 1;
  id: string;            // stable dedupe key, e.g. "claude-code:<session>:<message.id>"
  time: string;          // ISO-8601 from the log, not wall clock
  source: "adapter" | "cli" | "http" | "hook" | "manual";
  tool: string;          // free string: "claude-code", "codex", "gemini-cli", anything
  model: string;         // free string, never parsed into an enum
  account: string | null;// opaque "acct_<8 hex>" = sha256(salt + raw id). Never the raw id or an email.
  session: string;       // opaque session/thread id
  agent: {
    kind: "main" | "subagent";
    id?: string;         // subagent id
    type?: string;       // subagent type hint, e.g. "Explore", "general-purpose", codex agent_role
    parentSession?: string;
  };
  project: string;       // project key = sha256(git common dir or root path), first 12 hex
  event: "session_start" | "working" | "waiting" | "tokens" | "session_end" | "ping";
  tokens?: {             // DELTA since previous event for this session+model
    input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number;
  };
};
```

Rules:
- **No content fields exist in the type**, so prompt text has nowhere to go. A runtime validator drops unknown keys before an event reaches the server state, and a unit test asserts this.
- **Role is not in the event.** Roles are resolved in the server from tool, model, account alias and agent type plus config. Changing the config re-labels characters without re-reading logs.
- **Character identity = `tool | model | account | role`.** A session that switches model moves its activity to the other character, which is correct for "who worked on this". Subagent events attach as interns to the parent's character (found via `parentSession`).

### 3.2 Examples

Claude Code main session response (deduped by `message.id`):
```json
{"v":1,"id":"claude-code:sess-0001:msg_test_01","time":"2026-11-10T11:02:14.120Z","source":"adapter",
 "tool":"claude-code","model":"claude-sonnet-5-5","account":"acct_3f9a1c07","session":"sess-0001",
 "agent":{"kind":"main"},"project":"9b1e44d0c2aa","event":"working",
 "tokens":{"input":4,"output":853,"cacheRead":45928,"cacheWrite":27686,"reasoning":303}}
```

Claude Code subagent:
```json
{"v":1,"id":"claude-code:sess-0001:agent-0001:msg_test_02","time":"…","source":"adapter",
 "tool":"claude-code","model":"claude-opus-5-5","account":"acct_3f9a1c07","session":"sess-0001",
 "agent":{"kind":"subagent","id":"agent-0001","type":"general-purpose","parentSession":"sess-0001"},
 "project":"9b1e44d0c2aa","event":"working","tokens":{"input":2,"output":147,"cacheRead":0,"cacheWrite":59358,"reasoning":0}}
```

Codex turn finished:
```json
{"v":1,"id":"codex:thread-0001:task_complete:7","time":"…","source":"adapter","tool":"codex",
 "model":"gpt-6.1-sol","account":"acct_77b2e011","session":"thread-0001","agent":{"kind":"main"},
 "project":"9b1e44d0c2aa","event":"waiting"}
```

Fallback ping (tool with no adapter):
```bash
officebots ping --tool gemini-cli --model gemini-pro --tokens-out 1200
```
```json
{"v":1,"id":"cli:<uuid>","time":"…","source":"cli","tool":"gemini-cli","model":"gemini-pro",
 "account":null,"session":"cli:gemini-cli","agent":{"kind":"main"},"project":"9b1e44d0c2aa",
 "event":"ping","tokens":{"input":0,"output":1200,"cacheRead":0,"cacheWrite":0,"reasoning":0}}
```

### 3.3 Server room state (sent to the UI)

The server reduces events into a small snapshot and pushes it at most 4×/s over WebSocket. v1 sends full snapshots, not diffs; the snapshot is tiny.

```ts
type Room = { project: {key, name}; characters: Character[]; totals: Tokens };
type Character = {
  key: string;                 // hash of tool|model|account|role
  tool: string; model: string; role: string;
  accountAlias: string | null; // from config; "account 2" style fallback, never raw
  color: string; accent: string;
  status: "working" | "waiting" | "sleeping";
  lastActive: string; tokens: Tokens;   // tokens.headline = output + fresh input (input + cache writes), cache reads excluded
  interns: { active: number; total: number; byType: Record<string, number> };
};
```
States: `working` (event in last ~20 s or `stop_reason: tool_use` / task running), `waiting` (turn ended, session open), `sleeping` (no event for `idleAfterSec`, default 90; head down on the desk with a "zZ" bubble). The next event wakes the character up at the same desk.

**Live only.** The office shows agents that are active now, plus agents seen earlier in this office run, who are asleep. On start, sessions whose log files changed in the last 14 days are loaded as sleeping so the room isn't empty (`officebots start --since <hours>` changes the window). There's no all-time history.

### 3.4 Privacy rules (enforced in code, tested)

1. Adapters use **field allowlists**: each parser reads only the fields named in §1. Raw lines are parsed, picked from and dropped. They are never stored, logged or included in error messages. Parse errors log `file#line` and the error type only.
2. Account ids are salted-hashed (random per-install salt in the user config dir) before they leave the adapter.
3. Absolute paths never go over the wire. The UI gets the project key and the folder's base name.
4. The server binds `127.0.0.1` only, rejects WebSocket/POST requests whose `Origin` is not its own page, and requires `Content-Type: application/json` on `POST /events`. This blocks drive-by posts from web pages.
5. No outbound network calls anywhere, and the visualization never calls an LLM. A test fails if `http.request`, `fetch` or `net.connect` to a non-loopback address is reachable from `src/` (simple import/grep lint).

---

## 4. Repo folder structure

```
officebots-ai/
├─ package.json              # name "officebots", bin: { officebots: dist/cli.js }, engines node>=22.15
├─ tsconfig.json  vite.config.ts  vitest.config.ts
├─ PLAN.md  README.md  LICENSE
│
│  # What /officebots creates inside a USER's project (not this repo):
│  #   .officebots/
│  #   ├─ office.json        role names and colors; marks "this project has an office"; safe to commit
│  #   ├─ .gitignore         ignores .state/
│  #   └─ .state/run.json    port + process id of the running office (local only, never committed)
├─ docs/
│  ├─ log-formats.md         # §1 kept current, with the CLI versions each note was verified against
│  └─ mockup/office-mockup.html
├─ src/
│  ├─ cli/                   # index.ts + commands: start, stop, status, ping, setup, uninstall, accounts, doctor, replay, demo
│  ├─ core/
│  │  ├─ schema.ts           # OfficeEvent type + runtime validator (drops unknown keys)
│  │  ├─ identity.ts         # character key, account hashing, salt
│  │  ├─ roles.ts            # default roles + config overrides
│  │  ├─ colors.ts           # model/provider palette + hash fallback
│  │  ├─ project.ts          # cwd → project key (git common dir, cached)
│  │  └─ config.ts           # load/validate ~/.config/officebots/config.json + .officebots/office.json
│  ├─ adapters/
│  │  ├─ types.ts            # Adapter interface: roots(), match(path), parse(lines, ctx) → OfficeEvent[]
│  │  ├─ claude-code/        # parse.ts (pure), files.ts (layout), account.ts
│  │  └─ codex/              # parse.ts (pure), files.ts (zst + rename), account.ts
│  ├─ watcher/
│  │  ├─ watch.ts            # recursive fs.watch per root, debounce, error → reconcile
│  │  └─ tail.ts             # byte-offset reader, partial-line buffer, truncation/rotation handling
│  ├─ server/
│  │  ├─ http.ts             # static UI, POST /events, /health
│  │  ├─ ws.ts
│  │  ├─ room.ts             # pure reducer: events → Room
│  │  └─ office.ts           # one office per project: free port, run file, single instance per project
│  └─ hooks/
│     └─ claude-session-start.ts   # fast: if this project has an office, record session→account and start the office if it isn't running
├─ ui/
│  ├─ index.html
│  └─ src/
│     ├─ main.ts  socket.ts  sidebar.ts
│     └─ scene/  room.ts  layout.ts  desk.ts  character.ts  interns.ts  lounge.ts  labels.ts  camera.ts  palette.ts
├─ skill/
│  └─ officebots/SKILL.md    # copied to ~/.claude/skills/officebots by `officebots setup`
├─ test/
│  ├─ fixtures/
│  │  ├─ claude-code/        # tiny hand-written JSONL: dup blocks, subagent, model switch, cwd change, unknown types, torn last line
│  │  └─ codex/              # live .jsonl, same thread as .jsonl.zst, forked subagent with inherited history
│  ├─ adapters/*.test.ts  watcher/*.test.ts  server/*.test.ts  privacy.test.ts
│  └─ helpers/fake-writer.ts # appends fixture lines to a temp dir to exercise the watcher
└─ scripts/
   └─ check-fixtures.mjs     # fails CI if fixtures contain emails, home paths, real-looking UUIDs from ~/.claude.json, API key patterns
```

Fixtures are **written by hand** from the field tables in §1, with fake ids (`sess-0001`, `msg_test_01`) and placeholder text (`"<redacted>"`). Real logs are never copied in. `check-fixtures.mjs` also runs in CI.

---

## 5. Milestones

Each phase ends with a commit and push and has a "done" check you can run yourself.

### v0.1: Skeleton, schema, fixtures
- package.json, TS, vitest, CI (lint + test + check-fixtures).
- `core/schema.ts` with validator; hand-written Claude Code fixtures.
- **Done when:** `npm test` passes; adding a line with `someone@example.com` to a fixture makes `npm run check:fixtures` fail.

### v0.2: Claude Code adapter (pure)
- `parse()` for main and subagent files; dedupe by `message.id`; model switch; `working`/`waiting` from `stop_reason`; project matching from `cwd`.
- `officebots replay <file>` prints common events as JSONL.
- **Done when:** `officebots replay test/fixtures/claude-code/session-basic.jsonl` prints the expected events, and the fixture's token total equals the hand-computed number in the test (proves dedupe). `privacy.test.ts` proves no event contains a key outside the schema.

### v0.3: Watcher + office server + plain list UI (no 3D yet)
- Recursive watch of `~/.claude/projects`, tailing by offset, project filter, `room.ts` reducer, WebSocket, a plain HTML list like the mockup sidebar.
- `officebots start` (foreground, run inside a project) starts that project's office on a free port and prints its URL.
- **Done when:** with `officebots start` running in this repo, starting a Claude Code session *in this folder* adds a row within ~2 s, tokens rise while it works, the row goes `waiting` after the turn and `sleeping` after 90 s. A session in a different folder does **not** appear; a session in a git worktree or subfolder of this repo **does**. Running `officebots start` in a second project gives a second office on a different port. `officebots doctor` lists watched roots and counts of unknown record types.

### v0.4: The office (Three.js)
- Port the mockup look to an orthographic Three.js scene: floor grid, walls, desks, voxel characters, HTML labels (role, model, account tag, status dot), hover tooltip with token breakdown.
- Sleeping: head down on the desk, monitor dimmed, a floating "zZ". Waking is instant on the next event.
- Layout: desks on a grid of `ceil(sqrt(n))` columns, camera zoom-to-fit with eased transitions. Interns: up to 6 tiny instanced figures around the parent's desk plus a `×N` badge. Above `maxDesks` (default 12), the longest-sleeping characters move to sofas in a lounge corner; beyond the lounge cap they fade out and are listed in the sidebar. They return to a desk on the next event.
- `officebots demo --agents 40 --interns 30` runs a synthetic event generator through the real reducer and renderer. It reads no logs.
- **Done when:** `officebots demo --agents 40` holds ≥ 50 fps on a laptop, the room grows and zooms out smoothly, characters fall asleep, move to the lounge and come back, and an unknown model string such as `foo-model-9` renders with the default color and the role "Agent".

### v0.5: Codex adapter (the "can it detect another AI" test)
- Scan the head of each rollout for `session_meta.cwd`; live `.jsonl` tailing; `.jsonl.zst` read once with rename handled by threadId; cumulative → delta tokens; skip inherited history in forked subagents; `task_*` events for status; `creator_account_id` hashed.
- Hand-written Codex fixtures (live file, same thread compressed, forked subagent).
- **Done when:** fixture tests cover the live → `.zst` rename (no double count) and a forked subagent (inherited tokens excluded). With the office open for this repo, a Claude Code session and a Codex session working here at the same time show as **two different characters** (different tool, model and color), each with its own token count.

### v0.6: Fallback inputs
- `officebots ping` and `POST /events` (same validator). `ping` finds the project's office through the run file.
- **Done when:** `officebots ping --tool gemini-cli --model gemini-pro` creates a character, and a matching `curl -X POST` does too. A POST with an `Origin: https://evil.example` header is rejected.

### v0.7: Settings: role names, account nicknames, colors
- Two settings files (explained in §8):
  - **Office folder** `.officebots/` in the project, created by `/officebots` as a hidden folder, like `.vscode/` or `.github/`. `office.json` in it marks "this project has an office" and holds role names and colors; it's safe to commit and share. Runtime files go in `.officebots/.state/`, which the folder's own `.gitignore` excludes.
  - **Personal file** `~/.config/officebots/config.json`. It holds account nicknames ("work", "personal") and the hashing salt. Never inside the project.
- `officebots accounts` lists the hashed account ids seen, with tool and last-seen time, so you can nickname them without ever seeing emails.
- Claude Code account resolution, in order: (1) session→account record written by the SessionStart hook; (2) `CLAUDE_CONFIG_DIR` root → account captured when that root was first seen; (3) currently logged-in account; (4) `null`.
- Account accent: a colored cap/badge on the character plus an `@nickname` tag in the label.
- **Done when:** two Claude Code sessions on two accounts (two config dirs) using the same model show as **two** characters with different `@nickname` tags and accent colors. Editing role names in `.officebots/office.json` re-labels them live without a restart.

### v1.0: The skill, auto-start and packaging
- `/officebots` skill (the main way in): run inside a project, it creates `.officebots/` if missing, starts that project's office if it isn't running, and opens its URL.
- `officebots setup`: installs the skill to `~/.claude/skills/officebots/`, and **prints a unified diff** of the proposed `~/.claude/settings.json` change (a `SessionStart` hook running `officebots hook claude-session-start`). It writes a timestamped backup, asks `y/N`, and only then writes. `--dry-run` never writes. `officebots uninstall` removes exactly what setup added and restores from backup if the file is otherwise unchanged.
- The hook does nothing in projects without `.officebots/office.json`. In projects with one, it starts the office if needed. It finishes in < 150 ms, never fails the session (catches everything, exits 0), and spawns the office detached.
- Optional: the same diff/backup/approve flow for a Codex hook in `config.toml`.
- Publish to npm.
- **Done when:** on a clean machine, `npm i -g officebots && officebots setup` (answer y) shows the diff and creates the backup. Running `/officebots` in a project opens its office. After that, just opening Claude Code in that project starts the office; opening it in a project without an office starts nothing. `officebots uninstall` leaves `settings.json` byte-identical to the backup.

### v1.1+: The rest
- More adapters as their log formats are verified on a real machine (Gemini CLI, Cursor, others), each starting from a `docs/log-formats.md` entry.
- Claude Code plugin marketplace packaging (`.claude-plugin/plugin.json` + `hooks/hooks.json` + `skills/`), so the hook registers through the plugin install prompt instead of editing settings.
- Persisted tail offsets, so startup is instant on projects with large logs.
- Smarter default role names (for example from what the agent is doing or how the user named the subagent). v1 ships simple defaults that each project can rename in `.officebots/office.json`.

### Later (out of scope for v1): team / other-machine sync
The design leaves room for it without changes to adapters:
- Sync would forward **`Room` snapshots or a reduced event stream** with `tool, model, role, accountAlias, status, tokens` only. The schema already has no content fields, and `account` is already a salted hash.
- It would be a separate opt-in `sync` module that subscribes to the reducer like the WebSocket does. It would be off by default and require an explicit endpoint in config. That is the only place outbound network would be allowed, and the network lint (§3.4) would allowlist that one module.

### What I'd cut to ship v1 sooner
- **Manual-entry form** in the UI: `ping` and HTTP cover it.
- **Plugin marketplace packaging**: `setup` + skill copy is enough for v1.
- **All-time history**: the office is live only (decided).
- **Diff-based WebSocket protocol, offset persistence, lounge walking animations** (fade/teleport is fine).
- **Codex hook**: the Codex adapter reads logs without a hook; the hook only matters for auto-start.

---

## 6. Distribution options

| Option | Pros | Cons |
|---|---|---|
| **A. npm package `officebots` (global or `npx`)** | One artifact for any tool (Claude Code, Codex, ping users). Easy updates. Matches the runtime that Claude Code and Codex users already have. | No `/officebots` command on its own. |
| B. Claude Code plugin (marketplace repo with `.claude-plugin/`, `skills/`, `hooks/hooks.json`, like `ponytail`) | Install gives `/officebots` and the SessionStart hook through Claude's own consent prompt, without hand-editing settings. | Claude-only. The plugin still needs the office code, which means either bundling built JS into the plugin (two release channels) or calling a globally installed CLI. A native Claude Code install doesn't guarantee Node on PATH. |
| C. Skill only (`~/.claude/skills/officebots/SKILL.md`, the `graphify` convention: a package manager installs the engine and `graphify install` copies the skill) | Simplest skill story. | The skill alone can't watch anything; it needs the engine anyway. |

**Recommendation: A + C for v1, B in v1.1+.** Ship the npm package as the engine. `officebots setup` copies `skill/officebots/SKILL.md` into `~/.claude/skills/officebots/`, following graphify's "engine via package manager, skill copied by an install command" pattern, and offers the hook with diff/backup/approval. Once that is stable, add a plugin manifest to the same repo (ponytail-style multi-manifest layout) so Claude Code users can install via `/plugin` too. The plugin's hook and skill would call the same `officebots` binary.

The skill frontmatter follows the observed convention:
```yaml
---
name: officebots
description: "Create or open a live office for this project that shows which AI agents (Claude Code, Codex, …) are working on it …"
---
```

---

## 7. Riskiest assumptions (ranked) and how to test each early

1. **Claude Code's log format stays parseable.** It's undocumented, and two minor versions on one machine already differed. *Test:* do v0.2 first. Parsers tolerate unknown types and missing fields, and `doctor` counts unrecognised record types. Keep one fixture per verified CLI version. Recheck after every Claude Code update during development.
2. **We can tell a second AI tool apart in the same room.** This is the core promise. *Test:* v0.5 is moved early on purpose: Claude Code and Codex working in this repo at the same time must give two characters.
3. **We can attribute a Claude Code session to an account.** Logs don't contain one. *Test (spike, before v0.7, about half a day):* log in two accounts via two `CLAUDE_CONFIG_DIR`s, confirm each gets its own `projects/` root, and confirm a SessionStart hook receives the session id and can read the active account. If neither holds, fall back to "account per config root" and ask users to nickname roots.
4. **Recursive `fs.watch` is reliable enough without polling** (Windows, macOS, Linux, WSL, files held open by the writer, bursts of appends). *Test:* in v0.3, a stress test where `fake-writer` appends 10k lines in bursts across 50 files, on Windows and one Unix. Assert zero missed or duplicated events and handle torn last lines. If a platform drops events, add a reconcile scan on watcher error only.
5. **"Project = git repo" matches what users mean.** cwd changes mid-session, subfolders, git worktrees, the desktop app's scratch dirs. *Test:* fixtures for each case. Projects are keyed by `git rev-parse --git-common-dir`, so worktrees and subfolders count as the same project (decided); folders without git fall back to the folder holding `.officebots/`.
6. **Codex compression/rename and forked-history semantics are as observed.** *Test:* the v0.5 fixtures. Before coding, watch one live thread on this machine until it compresses and confirm the threadId matches.
7. **The SessionStart hook can be fast and harmless on Windows** (detached spawn, no console window flash, never blocks startup). *Test:* a spike hook that spawns a detached `node` on Windows and macOS. Measure with 20 rapid session starts.
8. **Three.js plus HTML labels stays smooth with 40+ characters.** *Test:* `officebots demo --agents 80` in v0.4. If labels cost too much, render labels only for working/hovered characters.

---

## 8. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Token number above each head | **Output + fresh input** (cache reads excluded). Full breakdown in the hover tooltip. |
| 2 | Live or history | **Live.** Agents not being used fall **asleep** at their desk; long sleepers move to the lounge or fade. No all-time history. |
| 3 | One server or one per project | **One office per project**, created with `/officebots` in that project. Each runs on its own free port. |
| 4 | Worktrees and subfolders | **Same project** as the main checkout. |
| 5 | Where settings live | **A project folder plus one personal file.** `/officebots` creates `.officebots/` in the project (a hidden folder named after the tool, so it won't clash with other tools and is clearly safe to delete). Its `office.json` holds role names and colors and is fine to commit, so a team sees the same labels; runtime files stay in its git-ignored `.state/`. Account nicknames ("work", "personal") are personal, so they live in your user folder (`~/.config/officebots/config.json`) and never end up in a public repo. |
| 6 | Default role names | Defaults below, changeable in `.officebots/office.json`: Claude Code main → **Lead**, `Explore` subagent → **Explorer**, `Plan` → **Planner**, other subagents → **Assistant**, Codex main → **Coder**, anything unknown → **Agent**. |
| 7 | npm package name | **`officebots`** if it's free on npm at publish time (checked in v1.0, since checking needs the network). Otherwise `@inferism/officebots`. This is only the name in `npm i -g …`; the command stays `officebots` either way. |
| 8 | Mockup file | Committed at `docs/mockup/office-mockup.html`. |
| 9 | Codex timing | **Before v1.0** (v0.5), right after the office renders, to prove a second AI is detected. |

No open questions are blocking v0.1.
