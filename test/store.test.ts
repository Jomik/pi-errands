import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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
    const plans = await loadAllPlans(cwd);
    expect(plans).toHaveLength(2);
    expect(plans.map((p) => p.id).sort()).toEqual(["a", "b"]);
  });

  it("returns empty array when directory does not exist", async () => {
    expect(await loadAllPlans(cwd)).toEqual([]);
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
    const [r1, r2] = await Promise.all([
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

    const dir = join(cwd, ".pi", "errands");
    const files = await readdir(dir);
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
