---
name: officebots
description: "Create or open a live office for this project that shows which AI agents (Claude Code, Codex, other tools) are working on it, with their model, role, account and token use. Use when the user runs /officebots, or asks to see, open or start the agent office."
---

# officebots

A live isometric office for the current project. Each AI agent working here (tool + model + account + role) gets a character at a desk with a status light and a token count. Everything is read from local logs on this machine; nothing is sent anywhere.

## What to do

1. Run this in the project folder (the folder the user is working in):

   ```bash
   officebots open
   ```

   It creates `.officebots/` in the project if it is missing, starts this project's office in the background if it is not already running, and opens it in the browser. It prints the office URL.

2. Tell the user the URL it printed and that the office is open. Tell them they can also double-click `.officebots/office.html` in the project, or bookmark the address, to get back to it later. Mention that Claude Code sessions in this project will start the office automatically from now on (if `officebots setup` has been run), and that other tools can report in with `officebots ping --tool <name>`.

## Other commands

- `officebots status` says whether this project's office is running and where.
- `officebots stop` stops it.
- `officebots open --no-open` starts it without opening a browser.

## If it does not work

- **`officebots: command not found`**: the package is not installed. Tell the user to run `npm install -g officebots`, then `officebots setup`. Do not try to install it yourself.
- **Any other error**: show the user the message as it is. `officebots open` prints where the office's log is if it fails to start (it is kept outside the project, in `~/.config/officebots/logs/`).

## Rules

- Do not read the agents' session logs or any other private files to answer questions about the office. The office exists so nobody has to.
- Do not edit `.officebots/office.json` unless the user asks. It holds role names and colors; see the project's `docs/settings.md` for the format.
