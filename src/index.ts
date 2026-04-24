import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { derivePlanStatus } from "./lifecycle.js";
import { loadAllPlans, savePlan, withPlan } from "./store.js";
import {
  type AddChoresResult,
  appendChores,
  applyChoreUpdates,
  buildChoreIndex,
  buildErrandIndex,
  executePlanErrands,
  type MarkChoresResult,
  type PlanErrandsResult,
  resolveTrackedItem,
  type TrackedItemState,
} from "./tools.js";
import type { Status, TrackingEntry } from "./types.js";

const TRACKING_CUSTOM_TYPE = "errands-tracking";

export default function (pi: ExtensionAPI) {
  /** IDs this session is tracking (plan or errand IDs). */
  const tracked = new Set<string>();

  // ── State reconstruction ──

  function reconstructTracking(ctx: ExtensionContext) {
    tracked.clear();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === TRACKING_CUSTOM_TYPE) {
        const data = entry.data as TrackingEntry;
        if (data.untrack) {
          tracked.delete(data.id);
        } else {
          tracked.add(data.id);
        }
      }
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    reconstructTracking(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    reconstructTracking(ctx);
  });

  // ── Tools ──

  pi.registerTool({
    name: "plan_errands",
    label: "Plan Errands",
    description:
      "Create a new plan with errands and chores. Returns the plan with IDs assigned to every errand and chore.",
    promptSnippet: "Create a plan with errands and chores for tracking work",
    promptGuidelines: [
      "Use plan_errands to break down work into a plan of errands with chores before starting multi-step tasks.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "Short name for the plan" }),
      errands: Type.Array(
        Type.Object({
          text: Type.String({ description: "What needs to be done" }),
          chores: Type.Array(Type.Object({ text: Type.String({ description: "Sub-task description" }) }), {
            minItems: 1,
          }),
        }),
        { minItems: 1 },
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const plan = executePlanErrands(params);
      await savePlan(ctx.cwd, plan);

      // Auto-track
      tracked.add(plan.id);
      pi.appendEntry(TRACKING_CUSTOM_TYPE, { id: plan.id } satisfies TrackingEntry);

      const result: PlanErrandsResult = { plan, status: "pending" };
      return {
        content: [{ type: "text", text: formatPlanSummary(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "mark_chores",
    label: "Mark Chores",
    description: "Set the status of one or more chores. Status transitions are forward-only.",
    promptSnippet: "Update chore statuses (active, done, failed, skipped)",
    promptGuidelines: [
      "Use mark_chores to report progress on chores. Mark chores active when starting, done/failed/skipped when finished.",
    ],
    parameters: Type.Object({
      updates: Type.Array(
        Type.Object({
          id: Type.String({ description: "Chore ID" }),
          status: Type.Union([
            Type.Literal("active"),
            Type.Literal("done"),
            Type.Literal("failed"),
            Type.Literal("skipped"),
          ]),
        }),
        { minItems: 1 },
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Group updates by plan
      const allPlans = await loadAllPlans(ctx.cwd);
      const choreIndex = buildChoreIndex(allPlans);

      const planIds = new Set<string>();
      for (const update of params.updates) {
        const planId = choreIndex.get(update.id);
        if (!planId) throw new Error(`Chore ${update.id} not found in any plan`);
        planIds.add(planId);
      }

      const allResults: MarkChoresResult["updated"] = [];
      let lastPlanStatus = "pending" as string;

      for (const planId of planIds) {
        const updatesForPlan = params.updates.filter((u) => choreIndex.get(u.id) === planId);
        const updated = await withPlan(ctx.cwd, planId, (plan) => {
          const { plan: updatedPlan, results } = applyChoreUpdates(plan, updatesForPlan);
          allResults.push(...results);
          lastPlanStatus = derivePlanStatus(updatedPlan);
          return updatedPlan;
        });
        lastPlanStatus = derivePlanStatus(updated);
      }

      const result: MarkChoresResult = { updated: allResults, planStatus: lastPlanStatus as Status };
      return {
        content: [{ type: "text", text: formatMarkResult(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "add_chores",
    label: "Add Chores",
    description: "Add chores to an existing errand. New chores start as pending.",
    promptSnippet: "Add new chores to an existing errand",
    promptGuidelines: ["Use add_chores when additional sub-tasks are discovered for an existing errand."],
    parameters: Type.Object({
      errand_id: Type.String({ description: "The errand to add chores to" }),
      chores: Type.Array(Type.Object({ text: Type.String({ description: "Sub-task description" }) }), {
        minItems: 1,
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const allPlans = await loadAllPlans(ctx.cwd);
      const errandIndex = buildErrandIndex(allPlans);
      const planId = errandIndex.get(params.errand_id);
      if (!planId) throw new Error(`Errand ${params.errand_id} not found in any plan`);

      let result!: AddChoresResult;
      await withPlan(ctx.cwd, planId, (plan) => {
        const { plan: updated, added, errandStatus } = appendChores(plan, params.errand_id, params.chores);
        result = { added, errandStatus, planStatus: derivePlanStatus(updated) };
        return updated;
      });

      return {
        content: [{ type: "text", text: formatAddResult(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "track_errands",
    label: "Track Errands",
    description:
      "Track or untrack a plan or errand. Tracked items are visible in the widget and surfaced to the agent automatically.",
    promptSnippet: "Track or untrack a plan or errand for visibility",
    promptGuidelines: [
      "Use track_errands to follow a plan or errand created by another session, or to stop tracking one.",
    ],
    parameters: Type.Object({
      id: Type.String({ description: "Plan or errand ID" }),
      untrack: Type.Optional(Type.Boolean({ description: "If true, stop tracking" })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.untrack) {
        tracked.delete(params.id);
      } else {
        tracked.add(params.id);
      }
      pi.appendEntry(TRACKING_CUSTOM_TYPE, { id: params.id, untrack: params.untrack } satisfies TrackingEntry);

      const allPlans = await loadAllPlans(ctx.cwd);
      const state = await resolveTrackedItem(ctx.cwd, params.id, allPlans);

      if (params.untrack) {
        return {
          content: [{ type: "text", text: `Untracked ${params.id}.` }],
          details: { untracked: params.id },
        };
      }

      if (!state) {
        return {
          content: [{ type: "text", text: `Tracking ${params.id}, but it was not found in any plan.` }],
          details: { notFound: params.id },
        };
      }

      return {
        content: [{ type: "text", text: formatTrackedState(state) }],
        details: state,
      };
    },
  });

  // ── Commands ──

  pi.registerCommand("errands", {
    description: "List all plans, or 'clear' to remove completed ones",
    handler: async (args, ctx) => {
      const allPlans = await loadAllPlans(ctx.cwd);

      if (args?.trim() === "clear") {
        let cleared = 0;
        for (const plan of allPlans) {
          const status = derivePlanStatus(plan);
          if (status === "done" || status === "failed") {
            const { deletePlan } = await import("./store.js");
            await deletePlan(ctx.cwd, plan.id);
            tracked.delete(plan.id);
            cleared++;
          }
        }
        ctx.ui.notify(cleared > 0 ? `Cleared ${cleared} completed plan(s).` : "No completed plans to clear.", "info");
        return;
      }

      if (allPlans.length === 0) {
        ctx.ui.notify("No plans.", "info");
        return;
      }

      const lines: string[] = [];
      for (const plan of allPlans) {
        const status = derivePlanStatus(plan);
        const isTracked = tracked.has(plan.id);
        lines.push(`${statusIcon(status)} ${plan.name} [${status}]${isTracked ? " (tracked)" : ""}`);
        for (const errand of plan.errands) {
          const es = errand.chores.every((c) => c.status === "pending")
            ? "pending"
            : errand.chores.some((c) => c.status === "active")
              ? "active"
              : errand.chores.every((c) => ["done", "failed", "skipped"].includes(c.status))
                ? errand.chores.some((c) => c.status === "failed")
                  ? "failed"
                  : "done"
                : "active";
          lines.push(`  ${statusIcon(es)} ${errand.text}`);
        }
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}

// ── Formatting helpers ──

function statusIcon(status: string): string {
  switch (status) {
    case "pending":
      return "○";
    case "active":
      return "◐";
    case "done":
      return "●";
    case "failed":
      return "✗";
    case "skipped":
      return "⊘";
    default:
      return "?";
  }
}

function formatPlanSummary(result: PlanErrandsResult): string {
  const { plan } = result;
  const lines = [`Plan "${plan.name}" created (${plan.id}).`];
  for (const errand of plan.errands) {
    lines.push(`  Errand: ${errand.text} (${errand.id})`);
    for (const chore of errand.chores) {
      lines.push(`    Chore: ${chore.text} (${chore.id})`);
    }
  }
  return lines.join("\n");
}

function formatMarkResult(result: MarkChoresResult): string {
  const lines = result.updated.map((u) => `Chore ${u.id} → ${u.status} (errand ${u.errandId}: ${u.errandStatus})`);
  lines.push(`Plan status: ${result.planStatus}`);
  return lines.join("\n");
}

function formatAddResult(result: AddChoresResult): string {
  const lines = result.added.map((c) => `  Added: ${c.text} (${c.id})`);
  lines.unshift(`Added ${result.added.length} chore(s).`);
  lines.push(`Errand status: ${result.errandStatus}, Plan status: ${result.planStatus}`);
  return lines.join("\n");
}

function formatTrackedState(state: TrackedItemState): string {
  if (state.type === "plan") {
    const lines = [`Plan "${state.plan.name}" [${state.planStatus}]`];
    for (const errand of state.plan.errands) {
      const es = errand.chores.every((c) => c.status === "pending")
        ? "pending"
        : errand.chores.some((c) => c.status === "active")
          ? "active"
          : "done";
      lines.push(`  ${statusIcon(es)} ${errand.text} (${errand.id})`);
      for (const chore of errand.chores) {
        lines.push(`    ${statusIcon(chore.status)} ${chore.text} (${chore.id})`);
      }
    }
    return lines.join("\n");
  }

  const errand = state.errand;
  if (!errand) return `Unknown item ${state.plan.id}`;
  const lines = [`Errand "${errand.text}" [${state.errandStatus}] (plan: ${state.plan.name})`];
  for (const chore of errand.chores) {
    lines.push(`  ${statusIcon(chore.status)} ${chore.text} (${chore.id})`);
  }
  return lines.join("\n");
}
