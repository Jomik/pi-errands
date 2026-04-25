import type { Errand, Plan, Status } from "./types.js";
import { TERMINAL_STATUSES } from "./types.js";

/** Valid transitions from a given status. */
const TRANSITIONS: Record<Status, ReadonlySet<Status>> = {
  pending: new Set(["active", "done", "failed", "skipped"]),
  active: new Set(["done", "failed", "skipped"]),
  done: new Set(),
  failed: new Set(),
  skipped: new Set(),
};

/** Returns true if the transition is valid. */
export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].has(to);
}

/** Validates a transition, throwing on illegal moves. */
export function assertTransition(from: Status, to: Status, choreId: string): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition for chore ${choreId}: ${from} → ${to}`);
  }
}

/** Derive an errand's status from its chores. */
export function deriveErrandStatus(errand: Errand): Status {
  const statuses = errand.chores.map((c) => c.status);
  return deriveStatus(statuses);
}

/** Derive a plan's status from its errands. */
export function derivePlanStatus(plan: Plan): Status {
  const statuses = plan.errands.map((e) => deriveErrandStatus(e));
  return deriveStatus(statuses);
}

/** Derive a parent status from a list of child statuses. */
function deriveStatus(statuses: Status[]): Status {
  if (statuses.length === 0) return "pending";

  const allPending = statuses.every((s) => s === "pending");
  if (allPending) return "pending";

  const allTerminal = statuses.every((s) => TERMINAL_STATUSES.has(s));
  if (allTerminal) {
    const hasFailed = statuses.includes("failed");
    if (hasFailed) return "failed";
    const hasDone = statuses.includes("done");
    return hasDone ? "done" : "skipped";
  }

  // Mix of pending/active/terminal → active
  return "active";
}
