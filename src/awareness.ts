import { deriveErrandStatus, derivePlanStatus } from "./lifecycle.js";
import type { LoadError } from "./store.js";
import type { Plan, Status } from "./types.js";

export const AWARENESS_MAX_CHARS = 4096;

/** Append a load-error note to an awareness message.
 * Returns input unchanged when errors is empty.
 * Returns only the note when message is undefined.
 */
export function appendLoadErrorNote(message: string | undefined, errors: LoadError[]): string | undefined {
  if (errors.length === 0) return message;
  const capped = errors.slice(0, 3).map((e) => e.planId);
  const suffix = errors.length > 3 ? ", …" : "";
  const note = `_Note: ${errors.length} plan file(s) could not be loaded: ${capped.join(", ")}${suffix}_`;
  if (message === undefined) return note;
  return `${message}\n\n${note}`;
}
const TRUNCATION_SUFFIX = "\n\n…(truncated)";

/** Build the awareness message injected via before_agent_start. */
export function buildAwarenessMessage(tracked: string | null, plans: Plan[]): string | undefined {
  if (!tracked) return undefined;

  const plan = plans.find((p) => p.id === tracked);
  if (plan) {
    return renderPlanWithinBudget(plan);
  }

  for (const p of plans) {
    const errand = p.errands.find((e) => e.id === tracked);
    if (errand) {
      return hardTruncate(`## Tracked Errands\n\n${formatErrandAwareness(errand, p.name)}`);
    }
  }

  return undefined;
}

// ── plan rendering ──

interface PlanFormatOptions {
  /** Show chore detail for terminal (done/failed/skipped) errands. */
  terminalChores: boolean;
  /** Show chore detail for pending/active errands. */
  pendingChores: boolean;
  /** Collapse consecutive pending errands into a count line. */
  collapsePending: boolean;
}

function renderPlanWithinBudget(plan: Plan): string {
  const prefix = "## Tracked Errands\n\n";
  const ps = derivePlanStatus(plan);

  if (ps === "done" || ps === "failed" || ps === "skipped") {
    return hardTruncate(prefix + formatTerminalPlanSummary(plan, ps));
  }

  // Progressive reduction for active/pending plans.
  const levels: PlanFormatOptions[] = [
    { terminalChores: true, pendingChores: true, collapsePending: false },
    { terminalChores: false, pendingChores: true, collapsePending: false },
    { terminalChores: false, pendingChores: false, collapsePending: false },
    { terminalChores: false, pendingChores: false, collapsePending: true },
  ];

  for (const opts of levels) {
    const msg = prefix + formatPlanAwareness(plan, opts);
    if (msg.length <= AWARENESS_MAX_CHARS) return msg;
  }

  // Hard-truncate the most-collapsed version.
  return hardTruncate(prefix + formatPlanAwareness(plan, levels[levels.length - 1]));
}

function formatTerminalPlanSummary(plan: Plan, ps: Status): string {
  const errandStatuses = plan.errands.map((e) => deriveErrandStatus(e));
  const doneCount = errandStatuses.filter((s) => s === "done").length;
  const failedCount = errandStatuses.filter((s) => s === "failed").length;
  const skippedCount = errandStatuses.filter((s) => s === "skipped").length;
  const total = plan.errands.length;

  const lines = [
    `**${plan.name}** — ${ps.toUpperCase()} (completed)`,
    "",
    `Outcome: ${doneCount} done, ${failedCount} failed, ${skippedCount} skipped (out of ${total} errands)`,
    "",
  ];

  for (const errand of plan.errands) {
    const es = deriveErrandStatus(errand);
    if (es === "failed") {
      const firstFailed = errand.chores.find((c) => c.status === "failed");
      if (firstFailed) {
        lines.push(`- [FAILED] ${errand.text} (${errand.id}) — ${firstFailed.text} (${firstFailed.id})`);
      } else {
        lines.push(`- [FAILED] ${errand.text} (${errand.id})`);
      }
    } else {
      lines.push(`- [${statusLabel(es)}] ${errand.text} (${errand.id})`);
    }
  }

  return lines.join("\n");
}

function formatPlanAwareness(plan: Plan, opts: PlanFormatOptions): string {
  const ps = derivePlanStatus(plan);
  const lines = [`**${plan.name}** — ${ps}`];
  let pendingCount = 0;

  for (const errand of plan.errands) {
    const es = deriveErrandStatus(errand);
    const isTerminal = es === "done" || es === "failed" || es === "skipped";
    const isPending = es === "pending";

    if (opts.collapsePending && isPending) {
      pendingCount++;
      continue;
    }

    if (pendingCount > 0) {
      lines.push(`- [PENDING] (${pendingCount} more pending errands not shown)`);
      pendingCount = 0;
    }

    const showChores = isTerminal ? opts.terminalChores : opts.pendingChores;
    if (showChores) {
      const choreDetail = errand.chores.map((c) => `${statusLabel(c.status)} ${c.text} (${c.id})`).join("; ");
      lines.push(`- [${statusLabel(es)}] ${errand.text} (${errand.id}): ${choreDetail}`);
    } else {
      lines.push(`- [${statusLabel(es)}] ${errand.text} (${errand.id})`);
    }
  }

  if (pendingCount > 0) {
    lines.push(`- [PENDING] (${pendingCount} more pending errands not shown)`);
  }

  return lines.join("\n");
}

// ── errand rendering ──

function formatErrandAwareness(errand: Plan["errands"][number], planName: string): string {
  const es = deriveErrandStatus(errand);
  const lines = [`**${errand.text}** (plan: ${planName}) — ${es}`];
  for (const chore of errand.chores) {
    lines.push(`- [${statusLabel(chore.status)}] ${chore.text} (${chore.id})`);
  }
  return lines.join("\n");
}

// ── helpers ──

function statusLabel(status: Status): string {
  return status.toUpperCase();
}

function hardTruncate(msg: string): string {
  if (msg.length <= AWARENESS_MAX_CHARS) return msg;
  return msg.slice(0, AWARENESS_MAX_CHARS - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}
