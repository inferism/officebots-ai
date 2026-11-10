# Settings

officebots reads two small JSON files. Both are checked strictly: anything unknown or malformed is ignored (and reported on the terminal), and a broken file never stops the office. Edits are picked up live, with no restart.

## Project: `.officebots/office.json`

Lives in the project, safe to commit, so a team sees the same labels. Role names and colors only.

```json
{
  "roles": { "Lead": "Architect", "Coder": "Reviewer" },
  "rules": [
    { "tool": "codex", "model": "gpt-6*", "account": "work", "name": "Reviewer", "color": "#10a37f" }
  ]
}
```

**`roles`** renames the built-in roles. The defaults are: Claude Code main = `Lead`, `Explore` subagent = `Explorer`, `Plan` subagent = `Planner`, other subagents = `Assistant`, Codex main = `Coder`, anything else = `Agent`.

**`rules`** are checked in order. A rule matches when every match field it has agrees:

| match field | matches |
|---|---|
| `tool` | the tool name, e.g. `claude-code`, `codex`, or whatever `officebots ping --tool` sent |
| `model` | the model string; a trailing `*` matches any ending (`gpt-6*`) |
| `role` | the built-in role name (before renaming) |
| `account` | the account's **nickname** (see below) |

A matching rule can set `name` (the label) and/or `color` (`#rrggbb`). For each of the two, the first matching rule that sets it wins, so list specific rules before general ones.

Models the tool does not know get the default grey and the role `Agent` until you add a rule.

## Personal: `~/.config/officebots/config.json`

Yours alone, never inside a project. It holds the hashing salt (created on first use, file mode 600), account nicknames, and which Claude Code folder belongs to which account.

```json
{
  "accounts": { "acct_3f9a1c07": "work", "acct_77b2e011": "personal" },
  "claudeConfigDirs": ["/home/me/.claude-work"]
}
```

Account ids are `acct_` plus 8 hex characters: a salted hash. Raw account ids and emails are never stored, shown or sent anywhere. To see which ids exist and give them nicknames:

```
officebots accounts                          # ids seen in the last 7 days, with tool and last-seen time
officebots accounts name acct_3f9a1c07 work  # set a nickname (an empty nickname removes it)
```

A nickname shows as `@work` in the label and the sidebar, and the character wears a cap in that account's accent color. Without a nickname, accounts are told apart as `@account 1`, `@account 2` (only shown when there is more than one).

## How Claude Code sessions get an account

Claude Code's session logs do not record the account, so it is worked out from outside:

1. **A session record** (`.officebots/.state/sessions.json`, a map of session id to `acct_...`). It is read if present; the SessionStart hook that writes it is planned for v1.0.
2. **The account logged in when that config folder was first seen.** Read from `oauthAccount.accountUuid` in `.claude.json` (only that field), hashed, and remembered per folder. Logging in as someone else later does not relabel old sessions.
3. Otherwise the session has no account and shows no tag.

For two accounts, give each its own `CLAUDE_CONFIG_DIR`, log in to each once, and list the folders in `claudeConfigDirs` (or pass `--claude-dir <dir>/projects`, repeatable, to `officebots start`). Each folder is its own account.

Codex records an account id per session, so it needs no setup.
