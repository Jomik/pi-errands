import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { deriveErrandStatus, derivePlanStatus } from "./lifecycle.js";
import type { Plan, Status } from "./types.js";

const WIDGET_ID = "errands";

/** Format and display the widget for the tracked item. */
export function updateWidget(ui: ExtensionContext["ui"], tracked: string | null, plans: Plan[]): void {
  if (!tracked) {
    ui.setWidget(WIDGET_ID, undefined);
    return;
  }

  const lines: string[] = [];

  // Check if it's a plan
  const plan = plans.find((p) => p.id === tracked);
  if (plan) {
    const ps = derivePlanStatus(plan);
    lines.push(`${icon(ps)} ${plan.name}`);
    for (const errand of plan.errands) {
      const es = deriveErrandStatus(errand);
      const choreSummary = summarizeChores(errand.chores);
      lines.push(`  ${icon(es)} ${errand.text} ${choreSummary}`);
    }
  } else {
    // Check if it's an errand
    for (const p of plans) {
      const errand = p.errands.find((e) => e.id === tracked);
      if (errand) {
        const es = deriveErrandStatus(errand);
        const choreSummary = summarizeChores(errand.chores);
        lines.push(`${icon(es)} ${errand.text} ${choreSummary}`);
        break;
      }
    }
  }

  if (lines.length === 0) {
    ui.setWidget(WIDGET_ID, undefined);
    return;
  }

  ui.setWidget(WIDGET_ID, lines);
}

function summarizeChores(chores: { status: Status }[]): string {
  const done = chores.filter((c) => c.status === "done").length;
  const total = chores.length;
  return `[${done}/${total}]`;
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
