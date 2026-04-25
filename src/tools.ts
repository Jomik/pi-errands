import { randomUUID } from "node:crypto";
import { assertTransition, deriveErrandStatus, derivePlanStatus } from "./lifecycle.js";
import { loadPlan } from "./store.js";
import type { Chore, Errand, Plan, Status } from "./types.js";

// ── plan_errands ──

export interface PlanErrandsInput {
  name: string;
  errands: { text: string; chores: { text: string }[] }[];
}

export interface PlanErrandsResult {
  plan: Plan;
  status: Status;
}

export function executePlanErrands(input: PlanErrandsInput): Plan {
  const plan: Plan = {
    id: randomUUID(),
    name: input.name,
    errands: input.errands.map((e) => ({
      id: randomUUID(),
      text: e.text,
      chores: e.chores.map((c) => ({
        id: randomUUID(),
        text: c.text,
        status: "pending" as const,
      })),
    })),
    createdAt: Date.now(),
  };
  return plan;
}

// ── mark_chores ──

export interface MarkChoresInput {
  updates: { id: string; status: "active" | "done" | "failed" | "skipped" }[];
}

export interface MarkChoresResult {
  updated: { id: string; status: Status; errandId: string; errandStatus: Status }[];
  planStatus: Status;
}

/** Build a chore-id → plan-id index across all provided plans. */
export function buildChoreIndex(plans: Plan[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const plan of plans) {
    for (const errand of plan.errands) {
      for (const chore of errand.chores) {
        index.set(chore.id, plan.id);
      }
    }
  }
  return index;
}

/** Apply chore updates to a plan. Returns the update details. */
export function applyChoreUpdates(
  plan: Plan,
  updates: MarkChoresInput["updates"],
): { plan: Plan; results: MarkChoresResult["updated"] } {
  const results: MarkChoresResult["updated"] = [];

  for (const update of updates) {
    let found = false;
    for (const errand of plan.errands) {
      for (const chore of errand.chores) {
        if (chore.id === update.id) {
          assertTransition(chore.status, update.status, chore.id);
          chore.status = update.status;
          results.push({
            id: chore.id,
            status: chore.status,
            errandId: errand.id,
            errandStatus: deriveErrandStatus(errand),
          });
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) {
      throw new Error(`Chore ${update.id} not found in plan ${plan.id}`);
    }
  }

  return { plan, results };
}

// ── add_chores ──

export interface AddChoresInput {
  errand_id: string;
  chores: { text: string }[];
}

export interface AddChoresResult {
  added: Chore[];
  errandStatus: Status;
  planStatus: Status;
}

/** Build an errand-id → plan-id index across all provided plans. */
export function buildErrandIndex(plans: Plan[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const plan of plans) {
    for (const errand of plan.errands) {
      index.set(errand.id, plan.id);
    }
  }
  return index;
}

/** Append chores to an errand. Returns the new chores and updated statuses. */
export function appendChores(
  plan: Plan,
  errandId: string,
  chores: { text: string }[],
): { plan: Plan; added: Chore[]; errandStatus: Status } {
  const errand = plan.errands.find((e) => e.id === errandId);
  if (!errand) {
    throw new Error(`Errand ${errandId} not found in plan ${plan.id}`);
  }

  const added: Chore[] = chores.map((c) => ({
    id: randomUUID(),
    text: c.text,
    status: "pending" as const,
  }));

  errand.chores.push(...added);

  return { plan, added, errandStatus: deriveErrandStatus(errand) };
}

// ── add_errands ──

export interface AddErrandsInput {
  plan_id: string;
  errands: { text: string; chores: { text: string }[] }[];
}

export interface AddErrandsResult {
  added: Errand[];
  planStatus: Status;
}

/** Append errands (each with its own chores) to a plan. */
export function appendErrands(
  plan: Plan,
  errands: { text: string; chores: { text: string }[] }[],
): { plan: Plan; added: Errand[] } {
  const added: Errand[] = errands.map((e) => ({
    id: randomUUID(),
    text: e.text,
    chores: e.chores.map((c) => ({
      id: randomUUID(),
      text: c.text,
      status: "pending" as const,
    })),
  }));

  plan.errands.push(...added);

  return { plan, added };
}

// ── track_errands ──

export interface TrackErrandsInput {
  id: string;
  untrack?: boolean;
}

export interface TrackedItemState {
  type: "plan" | "errand";
  plan: Plan;
  errand?: Errand;
  planStatus: Status;
  errandStatus?: Status;
}

/** Resolve a tracked ID to its current state. */
export async function resolveTrackedItem(
  dir: string,
  id: string,
  plans?: Plan[],
): Promise<TrackedItemState | undefined> {
  if (plans) {
    return resolveFromPlans(plans, id);
  }
  // Try as plan first
  const plan = await loadPlan(dir, id);
  if (plan) {
    return { type: "plan", plan, planStatus: derivePlanStatus(plan) };
  }
  // Not a plan ID — we'd need to search all plans for errand
  return undefined;
}

function resolveFromPlans(plans: Plan[], id: string): TrackedItemState | undefined {
  // Try as plan
  const plan = plans.find((p) => p.id === id);
  if (plan) {
    return { type: "plan", plan, planStatus: derivePlanStatus(plan) };
  }
  // Try as errand
  for (const p of plans) {
    const errand = p.errands.find((e) => e.id === id);
    if (errand) {
      return {
        type: "errand",
        plan: p,
        errand,
        planStatus: derivePlanStatus(p),
        errandStatus: deriveErrandStatus(errand),
      };
    }
  }
  return undefined;
}
