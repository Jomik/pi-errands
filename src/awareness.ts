import { deriveErrandStatus, derivePlanStatus } from "./lifecycle.js";
import type { Plan, Status } from "./types.js";

/** Build the awareness message injected via before_agent_start. */
export function buildAwarenessMessage(tracked: string | null, plans: Plan[]): string | undefined {
  if (!tracked) return undefined;

  const plan = plans.find((p) => p.id === tracked);
  if (plan) {
    return `## Tracked Errands\n\n${formatPlanAwareness(plan)}`;
  }

  for (const p of plans) {
    const errand = p.errands.find((e) => e.id === tracked);
    if (errand) {
      return `## Tracked Errands\n\n${formatErrandAwareness(errand, p.name)}`;
    }
  }

  return undefined;
}

function formatPlanAwareness(plan: Plan): string {
  const ps = derivePlanStatus(plan);
  const lines = [`**${plan.name}** — ${ps}`];
  for (const errand of plan.errands) {
    const es = deriveErrandStatus(errand);
    const choreDetail = errand.chores.map((c) => `${statusLabel(c.status)} ${c.text} (${c.id})`).join("; ");
    lines.push(`- [${statusLabel(es)}] ${errand.text} (${errand.id}): ${choreDetail}`);
  }
  return lines.join("\n");
}

function formatErrandAwareness(errand: Plan["errands"][number], planName: string): string {
  const es = deriveErrandStatus(errand);
  const lines = [`**${errand.text}** (plan: ${planName}) — ${es}`];
  for (const chore of errand.chores) {
    lines.push(`- [${statusLabel(chore.status)}] ${chore.text} (${chore.id})`);
  }
  return lines.join("\n");
}

function statusLabel(status: Status): string {
  return status.toUpperCase();
}
