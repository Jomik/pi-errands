# pi-errands

Task-tracking extension for [pi](https://github.com/earendil-works/pi-coding-agent). Keeps agents on track, keeps users informed, and lets sub-agents report progress.

## Installation

```bash
pi install npm:pi-errands
```

Or try it without installing:

```bash
pi -e npm:pi-errands
```

## Why

When working on complex multi-step tasks, agents lose track of what has been done and what remains. pi-errands gives the LLM tools to create plans, break them into errands and chores, track progress, and report to the user via a live widget — so neither the agent nor the user is ever left wondering where things stand.

## How it works

The LLM creates **plans** containing **errands** with **chores**. Progress is tracked via status updates on individual chores, which roll up to errands and plans. A live widget shows current state in the terminal as work proceeds.

### Concepts

| Concept | Description |
|---------|-------------|
| Plan | A collection of errands created in one `plan_errands` call |
| Errand | A discrete unit of work with one or more chores |
| Chore | A sub-task within an errand with a status |
| Status | `pending` → `active` → `done`/`failed`/`skipped` (forward-only) |

### Tools

| Tool | What it does |
|------|-------------|
| `plan_errands` | Create a new plan with errands and chores. Auto-tracked. |
| `mark_chores` | Update chore statuses. Batch operation, per-update error reporting. |
| `add_chores` | Add new chores to an existing errand. |
| `add_errands` | Add new errands to an existing plan. |
| `track_errands` | Track/untrack a plan or errand. One item at a time. |

### Commands

| Command | Description |
|---------|-------------|
| `/errands` | List all plans with status summary |
| `/errands clear` | Delete completed plans from storage |

### Sub-agent flow

1. Parent calls `plan_errands` — plan auto-tracked
2. Parent delegates errand to sub-agent, passing errand ID
3. Sub-agent calls `track_errands` with errand ID
4. Sub-agent works through chores via `mark_chores`
5. Parent sees updates via the tracked plan widget

## Design

See [DESIGN.md](./DESIGN.md) for the full specification.
