# pi-errands — Design Specification

A minimal task-tracking extension for [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent). Keeps agents on track, keeps users informed, and lets sub-agents report progress.

## Concepts

**Errand** — a discrete unit of work. Has a short description and one or more chores. An errand's status is derived from its chores.

**Chore** — a sub-task within an errand. Has a short description and a status. Chores do not nest further.

**Plan** — a collection of errands created in a single `plan_errands` call. A session may create multiple plans over its lifetime.

**Status** — every chore has exactly one: `pending`, `active`, `done`, `failed`, or `skipped`. Errand and plan statuses are derived from their children.

**Session** — a single pi agent conversation. Each session has its own identity and tracks its own set of plans and errands independently.

## Lifecycle

Valid chore status transitions (forward-only):

| From | To |
|------|----|
| `pending` | `active`, `done`, `failed`, `skipped` |
| `active` | `done`, `failed`, `skipped` |
| `done`, `failed`, `skipped` | _(terminal — no further transitions)_ |

Errand status is derived from its chores:
- All chores `pending` → errand is `pending`
- At least one chore `active` → errand is `active`
- No chore `active`, but mix of `pending` and terminal → errand is `active`
- All chores `done` → errand is `done`
- All chores terminal, at least one `failed`, none `pending` or `active` → errand is `failed`
- All chores terminal, none `failed` (mix of `done` and `skipped`) → errand is `done`

Plan status is derived the same way from its errands.

## Tools

Separate tools for each operation. This keeps each tool's purpose and parameters clear for the LLM, and allows fine-grained control over which tools are available in a given context.

### `plan_errands`

Create a new plan. Returns the plan with IDs assigned to every errand and chore, so they can be referenced by other tools.

Parameters:
- `name` — short name for the plan
- `errands` — list of errands, each with:
  - `text` — what needs to be done
  - `chores` — list of `{ text }` sub-tasks (at least one required)

Behavior:
- All items start as `pending`.
- The plan is automatically tracked in the creating session (see `track_errands`).

### `mark_chores`

Set the status of one or more chores.

Parameters:
- `updates` — list of updates, each with:
  - `id` — chore ID
  - `status` — new status (`active`, `done`, `failed`, or `skipped`)

Behavior:
- Status transitions must follow the lifecycle (forward-only).
- Errand and plan statuses update automatically based on their chores.

### `add_chores`

Add chores to an existing errand.

Parameters:
- `errand_id` — the errand to add chores to
- `chores` — list of `{ text }` to append

Behavior:
- New chores start as `pending`.
- Returns IDs for the new chores.
- Adding chores to an errand whose chores are all terminal causes the errand (and potentially its plan) to revert to a non-terminal derived status. This is permitted — it represents discovering additional work.

### `track_errands`

Track or untrack a plan or errand. Tracked items are visible in the widget and surfaced to the agent automatically. Untracking removes them from the agent's awareness without modifying the underlying data.

Parameters:
- `id` — plan or errand ID
- `untrack` (optional) — if true, stop tracking

Behavior:
- Tracking is per-session. Each session independently decides what it follows.
- Tracking a plan tracks all its errands, including any errands added later.
- Tracking an errand tracks just that errand and its chores.
- Tracking an already-tracked item is idempotent and returns the current state.
- Returns the current state of the tracked item.

## Plan Completion

A plan is complete when every errand in it has reached a terminal status (all chores `done`, `failed`, or `skipped`). Completed plans:

- Remain visible and readable via `track_errands`.
- Are visually distinguished in the widget from active plans.
- Remain visible to the agent, with an outcome summary (which errands succeeded, which failed). This ensures the parent agent learns of completion even when a sub-agent finished the last errand.
- Are eligible for cleanup via `/errands`. Once cleaned up, they are removed from the widget, agent awareness, and storage.

## Data Availability

Errand and chore data must be available to multiple agents working in the same project concurrently, and must survive individual agent turns.

## Widget & Agent Awareness

The widget and agent awareness are driven by tracking:

- The widget shows tracked plans and errands with their current status.
- The agent is kept aware of tracked items automatically, so it stays on track without extra tool calls.
- Changes made by other agents (e.g., a sub-agent completing an errand) are reflected in tracked state, ensuring the parent agent learns of completion without explicit polling.

## Commands

- `/errands` — list all plans with status summary.
- `/errands clear` — delete completed plans from storage, widget, and agent awareness.

## Sub-Agent Flow

No special sub-agent protocol. The extension's tools are available to any session where the extension is loaded, including sub-agents. The flow is:

1. Parent calls `plan_errands` — plan is created and automatically tracked.
2. Parent sends a sub-agent on an errand, passing the errand ID in the prompt.
3. Sub-agent calls `track_errands` with the errand ID — now aware of its errand and chores.
4. Sub-agent works through chores, calling `mark_chores` to report progress.
5. Sub-agent optionally calls `add_chores` to break down work further.
6. Sub-agent marks remaining chores `done`, `failed`, or `skipped` — errand status updates automatically.
7. Parent sees the updated state because it is tracking the plan.
