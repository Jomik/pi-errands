import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deletePlan, loadAllPlans, loadPlan, savePlan, withPlan } from "../src/store.js";
import type { Plan } from "../src/types.js";

let cwd: string;

function makePlan(id: string): Plan {
  return {
    id,
    name: `Plan ${id}`,
    errands: [
      {
        id: `e-${id}`,
        text: "test errand",
        chores: [{ id: `c-${id}`, text: "test chore", status: "pending" }],
      },
    ],
    createdAt: Date.now(),
  };
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "pi-errands-test-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("savePlan / loadPlan", () => {
  it("round-trips a plan", async () => {
    const plan = makePlan("p1");
    await savePlan(cwd, plan);
    const loaded = await loadPlan(cwd, "p1");
    expect(loaded).toEqual(plan);
  });

  it("returns undefined for missing plan", async () => {
    expect(await loadPlan(cwd, "nonexistent")).toBeUndefined();
  });
});

describe("loadAllPlans", () => {
  it("loads all plans", async () => {
    await savePlan(cwd, makePlan("a"));
    await savePlan(cwd, makePlan("b"));
    const result = await loadAllPlans(cwd);
    expect(result.errors).toHaveLength(0);
    expect(result.plans).toHaveLength(2);
    expect(result.plans.map((p) => p.id).sort()).toEqual(["a", "b"]);
  });

  it("returns empty arrays when directory does not exist", async () => {
    expect(await loadAllPlans(join(cwd, "nonexistent"))).toEqual({ plans: [], errors: [] });
  });

  it("surfaces per-plan errors without throwing", async () => {
    await savePlan(cwd, makePlan("good"));
    await writeFile(join(cwd, "corrupt.json"), "not valid json", "utf-8");
    const result = await loadAllPlans(cwd);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].id).toBe("good");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].planId).toBe("corrupt");
    expect(result.errors[0].reason).not.toBe("");
  });
});

describe("withPlan", () => {
  it("reads, mutates, and writes atomically", async () => {
    await savePlan(cwd, makePlan("p1"));
    const updated = await withPlan(cwd, "p1", (plan) => {
      plan.errands[0].chores[0].status = "done";
      return plan;
    });
    expect(updated.errands[0].chores[0].status).toBe("done");

    const reloaded = await loadPlan(cwd, "p1");
    expect(reloaded?.errands[0].chores[0].status).toBe("done");
  });

  it("throws for missing plan", async () => {
    await expect(withPlan(cwd, "nonexistent", (p) => p)).rejects.toThrow("Plan nonexistent not found");
  });

  it("handles concurrent writes without data loss", async () => {
    const plan = makePlan("p1");
    plan.errands = [
      { id: "e1", text: "first", chores: [{ id: "c1", text: "c1", status: "pending" }] },
      { id: "e2", text: "second", chores: [{ id: "c2", text: "c2", status: "pending" }] },
    ];
    await savePlan(cwd, plan);

    // Two concurrent writes to different chores in the same plan
    await Promise.all([
      withPlan(cwd, "p1", (p) => {
        p.errands[0].chores[0].status = "done";
        return p;
      }),
      withPlan(cwd, "p1", (p) => {
        p.errands[1].chores[0].status = "done";
        return p;
      }),
    ]);

    const final = await loadPlan(cwd, "p1");
    expect(final?.errands[0].chores[0].status).toBe("done");
    expect(final?.errands[1].chores[0].status).toBe("done");
  });

  it("cleans up lock file after operation", async () => {
    await savePlan(cwd, makePlan("p1"));
    await withPlan(cwd, "p1", (p) => p);

    const files = await readdir(cwd);
    expect(files.filter((f) => f.endsWith(".lock"))).toEqual([]);
  });
});

describe("deletePlan", () => {
  it("removes plan file", async () => {
    await savePlan(cwd, makePlan("p1"));
    await deletePlan(cwd, "p1");
    expect(await loadPlan(cwd, "p1")).toBeUndefined();
  });

  it("does not throw for missing plan", async () => {
    await expect(deletePlan(cwd, "nonexistent")).resolves.not.toThrow();
  });
});
