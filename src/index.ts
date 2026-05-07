import { type FSWatcher, watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendLoadErrorNote, buildAwarenessMessage } from "./awareness.js";
import { deriveErrandStatus, derivePlanStatus } from "./lifecycle.js";
import { deletePlan, loadAllPlans, savePlan, withPlan } from "./store.js";
import {
  type AddChoresResult,
  type AddErrandsResult,
  appendChores,
  appendErrands,
  applyChoreUpdates,
  buildChoreIndex,
  buildErrandIndex,
  type ChoreUpdateResult,
  executePlanErrands,
  type MarkChoresResult,
  type PlanErrandsResult,
  resolveTrackedItem,
  type TrackedItemState,
} from "./tools.js";
import type { Status, TrackingEntry } from "./types.js";
import { updateWidget } from "./widget.js";

const TRACKING_CUSTOM_TYPE = "errands-tracking";

export default function (pi: ExtensionAPI) {
  /** The single item this session is tracking (plan or errand ID). */
  let tracked: string | null = null;

  // ── State reconstruction ──

  function reconstructState(ctx: ExtensionContext) {
    tracked = null;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === TRACKING_CUSTOM_TYPE) {
        tracked = (entry.data as TrackingEntry).id;
      }
    }
  }

  /** Active filesystem watcher on the errands dir, if any. */
  let watcher: FSWatcher | undefined;
  /** Debounce timer for watcher-triggered refreshes. */
  let watchTimer: NodeJS.Timeout | undefined;

  async function startWatcher(ctx: ExtensionContext) {
    stopWatcher();
    if (!ctx.hasUI) return;
    const dir = getErrandsDir(ctx);
    try {
      await mkdir(dir, { recursive: true });
      watcher = watch(dir, { persistent: false }, () => {
        if (!tracked) return;
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          watchTimer = undefined;
          refreshWidget(ctx).catch(() => {});
        }, 100);
      });
      watcher.on("error", () => {
        // Silently ignore watcher errors; turn_start will still refresh.
      });
    } catch {
      // If we can't watch, fall back to turn_start refresh.
    }
  }

  function stopWatcher() {
    if (watchTimer) {
      clearTimeout(watchTimer);
      watchTimer = undefined;
    }
    if (watcher) {
      watcher.close();
      watcher = undefined;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    reconstructState(ctx);
    await refreshWidget(ctx);
    await startWatcher(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopWatcher();
  });

  pi.on("session_tree", async (_event, ctx) => {
    reconstructState(ctx);
    await refreshWidget(ctx);
  });

  // Re-read plan state from disk on every turn so changes made by other
  // sessions (e.g. sub-agents) are reflected in this session's widget.
  pi.on("turn_start", async (_event, ctx) => {
    await refreshWidget(ctx);
  });

  // Also refresh after any tool finishes — covers updates that happen
  // mid-turn (e.g. when a sub-agent tool returns).
  pi.on("tool_execution_end", async (_event, ctx) => {
    await refreshWidget(ctx);
  });

  // ── Agent awareness ──

  pi.on("before_agent_start", async (_event, ctx) => {
    try {
      const { plans, errors } = await loadAllPlans(getErrandsDir(ctx));
      const content = appendLoadErrorNote(buildAwarenessMessage(tracked, plans), errors);
      if (!content) return;
      return {
        message: {
          customType: "errands-awareness",
          content,
          display: false,
        },
      };
    } catch (err: unknown) {
      return {
        message: {
          customType: "errands-awareness",
          content: `errands awareness error: ${(err as Error).message}`,
          display: false,
        },
      };
    }
  });

  function getErrandsDir(ctx: ExtensionContext): string {
    return join(ctx.sessionManager.getSessionDir(), "errands");
  }

  async function refreshWidget(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    try {
      const { plans, errors } = await loadAllPlans(getErrandsDir(ctx));
      updateWidget(ctx.ui, tracked, plans, errors);
    } catch (err: unknown) {
      ctx.ui.setWidget("errands", [`errands: refresh failed (${(err as Error).message})`]);
    }
  }

  // ── Tools ──

  pi.registerTool({
    name: "plan_errands",
    label: "Plan Errands",
    description: "Create a new plan with errands and chores.",
    promptSnippet: "Create a plan with errands and chores for tracking work",
    promptGuidelines: [
      "Use plan_errands to break down multi-step work before starting. The plan is auto-tracked in the current session.",
      "When delegating: pass the errand ID (e.g. e_abc12345) to the sub-agent in its task prompt. Do not mark chores yourself for delegated errands — the sub-agent handles that.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "Short name for the plan" }),
      errands: Type.Array(
        Type.Object({
          text: Type.String({ description: "What needs to be done" }),
          chores: Type.Array(Type.Object({ text: Type.String({ description: "Chore description" }) }), {
            minItems: 1,
          }),
        }),
        { minItems: 1 },
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const plan = executePlanErrands(params);
      await savePlan(getErrandsDir(ctx), plan);

      // Auto-track the new plan
      tracked = plan.id;
      pi.appendEntry(TRACKING_CUSTOM_TYPE, { id: plan.id } satisfies TrackingEntry);
      await refreshWidget(ctx);

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
    description:
      "Update the status of one or more chores. Transitions are forward-only: pending → active → done/failed/skipped.",
    promptSnippet: "Update chore statuses (active, done, failed, skipped)",
    promptGuidelines: [
      "Set a chore active when starting it, then done/failed/skipped when finished.",
      "As a sub-agent: after calling track_errands, work through your chores sequentially — mark active, do the work, mark done/failed/skipped. Report all chore completions before finishing.",
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
      const dir = getErrandsDir(ctx);
      const { plans } = await loadAllPlans(dir);
      const choreIndex = buildChoreIndex(plans);

      const allResults: ChoreUpdateResult[] = [];
      let lastPlanStatus = "pending" as string;

      // Separate updates into known-plan and unknown
      const planIds = new Set<string>();
      for (const update of params.updates) {
        const planId = choreIndex.get(update.id);
        if (!planId) {
          allResults.push({ id: update.id, ok: false, error: "chore not found in any plan" });
        } else {
          planIds.add(planId);
        }
      }

      for (const planId of planIds) {
        const updatesForPlan = params.updates.filter((u) => choreIndex.get(u.id) === planId);
        const updated = await withPlan(dir, planId, (plan) => {
          const { plan: updatedPlan, results } = applyChoreUpdates(plan, updatesForPlan);
          allResults.push(...results);
          lastPlanStatus = derivePlanStatus(updatedPlan);
          return updatedPlan;
        });
        lastPlanStatus = derivePlanStatus(updated);
      }

      await refreshWidget(ctx);
      const result: MarkChoresResult = { results: allResults, planStatus: lastPlanStatus as Status };
      return {
        content: [{ type: "text", text: formatMarkResult(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "add_chores",
    label: "Add Chores",
    description: "Add new chores to an existing errand. New chores start pending.",
    promptSnippet: "Add new chores to an existing errand",
    promptGuidelines: ["Use when finer breakdown of an existing errand is discovered mid-execution."],
    parameters: Type.Object({
      errand_id: Type.String({ description: "The errand to add chores to" }),
      chores: Type.Array(Type.Object({ text: Type.String({ description: "Chore description" }) }), {
        minItems: 1,
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const dir = getErrandsDir(ctx);
      const { plans } = await loadAllPlans(dir);
      const errandIndex = buildErrandIndex(plans);
      const planId = errandIndex.get(params.errand_id);
      if (!planId) {
        return {
          content: [{ type: "text", text: `Errand ${params.errand_id} not found in any plan.` }],
          details: { error: "errand_not_found", errandId: params.errand_id },
        };
      }

      let result!: AddChoresResult;
      try {
        await withPlan(dir, planId, (plan) => {
          const { plan: updated, added, errandStatus } = appendChores(plan, params.errand_id, params.chores);
          result = { added, errandStatus, planStatus: derivePlanStatus(updated) };
          return updated;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to add chores to errand ${params.errand_id}: ${message}` }],
          details: { error: "append_failed", errandId: params.errand_id, message },
        };
      }

      await refreshWidget(ctx);

      return {
        content: [{ type: "text", text: formatAddResult(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "add_errands",
    label: "Add Errands",
    description: "Add new errands (each with their own chores) to an existing plan. New items start pending.",
    promptSnippet: "Add new errands to an existing plan",
    promptGuidelines: [
      "Use when new work is discovered that is a peer scope to existing errands. Prefer add_chores for sub-tasks of an existing errand.",
    ],
    parameters: Type.Object({
      plan_id: Type.String({ description: "The plan to add errands to" }),
      errands: Type.Array(
        Type.Object({
          text: Type.String({ description: "What needs to be done" }),
          chores: Type.Array(Type.Object({ text: Type.String({ description: "Chore description" }) }), {
            minItems: 1,
          }),
        }),
        { minItems: 1 },
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const dir = getErrandsDir(ctx);
      let result!: AddErrandsResult;
      const updated = await withPlan(dir, params.plan_id, (plan) => {
        const { plan: updatedPlan, added } = appendErrands(plan, params.errands);
        result = { added, planStatus: derivePlanStatus(updatedPlan) };
        return updatedPlan;
      });
      result.planStatus = derivePlanStatus(updated);

      await refreshWidget(ctx);

      return {
        content: [{ type: "text", text: formatAddErrandsResult(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "track_errands",
    label: "Track Errands",
    description: "Track or untrack a plan or errand. One item tracked at a time.",
    promptSnippet: "Track a plan or errand, or untrack the current item",
    promptGuidelines: [
      "If you were given an errand ID in your task, call track_errands with that ID immediately before starting work. This loads your assigned chores into context.",
      "Use track_errands to follow a plan or errand created by another session, or untrack to stop.",
    ],
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: "Plan or errand ID to track" })),
      untrack: Type.Optional(Type.Boolean({ description: "If true, stop tracking the current item" })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const dir = getErrandsDir(ctx);
      if (params.untrack) {
        tracked = null;
        pi.appendEntry(TRACKING_CUSTOM_TYPE, { id: null } satisfies TrackingEntry);
        const { plans, errors } = await loadAllPlans(dir);
        updateWidget(ctx.ui, tracked, plans, errors);
        return {
          content: [{ type: "text", text: "Untracked current item." }],
          details: { untracked: true },
        };
      }

      if (!params.id) {
        throw new Error("Either id or untrack must be provided.");
      }

      tracked = params.id;
      pi.appendEntry(TRACKING_CUSTOM_TYPE, { id: tracked } satisfies TrackingEntry);

      const { plans, errors } = await loadAllPlans(dir);
      updateWidget(ctx.ui, tracked, plans, errors);
      const state = await resolveTrackedItem(dir, params.id, plans);

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
      const dir = getErrandsDir(ctx);
      const { plans: allPlans, errors } = await loadAllPlans(dir);

      if (args?.trim() === "clear") {
        let cleared = 0;
        for (const plan of allPlans) {
          const status = derivePlanStatus(plan);
          if (status === "done" || status === "failed" || status === "skipped") {
            await deletePlan(dir, plan.id);
            if (tracked === plan.id) tracked = null;
            for (const errand of plan.errands) {
              if (tracked === errand.id) tracked = null;
            }
            cleared++;
          }
        }
        ctx.ui.notify(cleared > 0 ? `Cleared ${cleared} completed plan(s).` : "No completed plans to clear.", "info");
        await refreshWidget(ctx);
        return;
      }

      if (allPlans.length === 0) {
        ctx.ui.notify("No plans.", "info");
        return;
      }

      const lines: string[] = [];
      for (const plan of allPlans) {
        const status = derivePlanStatus(plan);
        const isTracked = tracked === plan.id;
        lines.push(`${statusIcon(status)} ${plan.name} [${status}]${isTracked ? " (tracked)" : ""}`);
        for (const errand of plan.errands) {
          const es = deriveErrandStatus(errand);
          lines.push(`  ${statusIcon(es)} ${errand.text}`);
        }
      }
      if (errors.length > 0) {
        const listed = errors
          .slice(0, 3)
          .map((e) => e.planId)
          .join(", ");
        const more = errors.length > 3 ? ", ..." : "";
        lines.push("");
        lines.push(`Unreadable plan files: ${listed}${more}`);
        lines.push(`Reason for ${errors[0].planId}: ${errors[0].reason}`);
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
  const successes = result.results.filter((r): r is Extract<typeof r, { ok: true }> => r.ok);
  const failures = result.results.filter((r): r is Extract<typeof r, { ok: false }> => !r.ok);
  const lines: string[] = [];
  if (successes.length > 0) {
    lines.push(`Updated ${successes.length} chore(s).`);
    for (const r of successes) lines.push(`  ${r.id} \u2192 ${r.status}`);
  }
  if (failures.length > 0) {
    lines.push(`Failed ${failures.length} update(s):`);
    for (const r of failures) lines.push(`  ${r.id}: ${r.error}`);
  }
  lines.push(`Plan status: ${result.planStatus}`);
  return lines.join("\n");
}

function formatAddResult(result: AddChoresResult): string {
  const lines = result.added.map((c) => `  Added: ${c.text} (${c.id})`);
  lines.unshift(`Added ${result.added.length} chore(s).`);
  lines.push(`Errand status: ${result.errandStatus}, Plan status: ${result.planStatus}`);
  return lines.join("\n");
}

function formatAddErrandsResult(result: AddErrandsResult): string {
  const lines = [`Added ${result.added.length} errand(s).`];
  for (const errand of result.added) {
    lines.push(`  Errand: ${errand.text} (${errand.id})`);
    for (const chore of errand.chores) {
      lines.push(`    Chore: ${chore.text} (${chore.id})`);
    }
  }
  lines.push(`Plan status: ${result.planStatus}`);
  return lines.join("\n");
}

function formatTrackedState(state: TrackedItemState): string {
  if (state.type === "plan") {
    const lines = [`Plan "${state.plan.name}" [${state.planStatus}]`];
    for (const errand of state.plan.errands) {
      const es = deriveErrandStatus(errand);
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
