import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { deriveErrandStatus, derivePlanStatus } from "./lifecycle.js";
import type { LoadError } from "./store.js";
import type { Chore, Errand, Plan, Status } from "./types.js";

const WIDGET_ID = "errands";

/** Format and display the widget for the tracked item. */
/** Format and display the widget for the tracked item. */
export function updateWidget(
  ui: ExtensionContext["ui"],
  tracked: string | null,
  plans: Plan[],
  errors: LoadError[],
): void {
  if (!tracked) {
    if (errors.length > 0) {
      ui.setWidget(WIDGET_ID, [`unreadable: ${errors.length} plan(s)`]);
    } else {
      ui.setWidget(WIDGET_ID, undefined);
    }
    return;
  }

  const lines: string[] = [];

  // Check if it's a plan
  const plan = plans.find((p) => p.id === tracked);
  if (plan) {
    const ps = derivePlanStatus(plan);
    if (ps === "done" || ps === "failed" || ps === "skipped") {
      renderTerminalPlanSummary(lines, plan);
    } else {
      lines.push(`${icon(ps)} ${plan.name}`);
      for (const errand of plan.errands) {
        const es = deriveErrandStatus(errand);
        // Expand chores for active errands; collapse others to a summary.
        if (es === "active") {
          lines.push(`  ${icon(es)} ${errand.text}`);
          for (const chore of errand.chores) {
            lines.push(`    ${icon(chore.status)} ${chore.text}`);
          }
        } else {
          lines.push(`  ${icon(es)} ${errand.text} ${summarizeChores(errand.chores)}`);
        }
      }
    }
  } else {
    // Check if it's an errand
    for (const p of plans) {
      const errand = p.errands.find((e) => e.id === tracked);
      if (errand) {
        renderErrand(lines, errand);
        break;
      }
    }
  }

  if (errors.length > 0) {
    lines.push(`unreadable: ${errors.length} plan(s)`);
  }

  if (lines.length === 0) {
    ui.setWidget(WIDGET_ID, undefined);
    return;
  }
  ui.setWidget(WIDGET_ID, lines);
}
function renderTerminalPlanSummary(lines: string[], plan: Plan): void {
  const ps = derivePlanStatus(plan);
  const errandStatuses = plan.errands.map((e) => deriveErrandStatus(e));
  const doneCount = errandStatuses.filter((s) => s === "done").length;
  const failedCount = errandStatuses.filter((s) => s === "failed").length;
  const skippedCount = errandStatuses.filter((s) => s === "skipped").length;

  lines.push(`${icon(ps)} ${plan.name} (completed)`);
  lines.push(`  Outcome: ${doneCount} done, ${failedCount} failed, ${skippedCount} skipped`);

  for (const errand of plan.errands) {
    const es = deriveErrandStatus(errand);
    if (es === "failed") {
      const firstFailed = errand.chores.find((c) => c.status === "failed");
      if (firstFailed) {
        lines.push(`  ${icon(es)} ${errand.text} — ${firstFailed.text}`);
      } else {
        lines.push(`  ${icon(es)} ${errand.text}`);
      }
    } else {
      lines.push(`  ${icon(es)} ${errand.text}`);
    }
  }
}

function renderErrand(lines: string[], errand: Errand): void {
  const es = deriveErrandStatus(errand);
  lines.push(`${icon(es)} ${errand.text}`);
  for (const chore of errand.chores) {
    lines.push(`  ${icon(chore.status)} ${chore.text}`);
  }
}
function summarizeChores(chores: Chore[]): string {
  const total = chores.length;
  const done = chores.filter((c) => c.status === "done").length;
  const failed = chores.filter((c) => c.status === "failed").length;
  const skipped = chores.filter((c) => c.status === "skipped").length;
  const parts: string[] = [`${done}/${total}`];
  if (failed) parts.push(`${failed} failed`);
  if (skipped) parts.push(`${skipped} skipped`);
  return `[${parts.join(", ")}]`;
}

function icon(status: Status): string {
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
  }
}
