import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { savePlan } from "../src/store.js";
import {
  appendChores,
  appendErrands,
  applyChoreUpdates,
  buildChoreIndex,
  buildErrandIndex,
  executePlanErrands,
  resolveTrackedItem,
} from "../src/tools.js";
import type { Plan } from "../src/types.js";

function makePlan(overrides?: Partial<Plan>): Plan {
  return {
    id: "p_test",
    name: "Test Plan",
    errands: [
      {
        id: "e_test",
        text: "test errand",
        chores: [{ id: "c_test", text: "test chore", status: "pending" }],
      },
    ],
    createdAt: 0,
    ...overrides,
  };
}

describe("executePlanErrands", () => {
  it("assigns prefixed IDs (p_, e_, c_)", () => {
    const plan = executePlanErrands({
      name: "My Plan",
      errands: [{ text: "e1", chores: [{ text: "c1" }] }],
    });
    expect(plan.id).toMatch(/^p_/);
    expect(plan.errands[0].id).toMatch(/^e_/);
    expect(plan.errands[0].chores[0].id).toMatch(/^c_/);
  });

  it("sets createdAt to approximately now", () => {
    const before = Date.now();
    const plan = executePlanErrands({ name: "x", errands: [] });
    expect(plan.createdAt).toBeGreaterThanOrEqual(before);
    expect(plan.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it("all chores start pending", () => {
    const plan = executePlanErrands({
      name: "x",
      errands: [{ text: "e", chores: [{ text: "c1" }, { text: "c2" }] }],
    });
    for (const chore of plan.errands[0].chores) {
      expect(chore.status).toBe("pending");
    }
  });
});

describe("buildChoreIndex", () => {
  it("maps chore id to plan id", () => {
    const plan = makePlan();
    const idx = buildChoreIndex([plan]);
    expect(idx.get("c_test")).toBe("p_test");
  });

  it("empty plans → empty map", () => {
    expect(buildChoreIndex([])).toEqual(new Map());
  });

  it("multiple plans", () => {
    const p1 = makePlan({
      id: "p_1",
      errands: [{ id: "e_1", text: "e", chores: [{ id: "c_1", text: "c", status: "pending" }] }],
    });
    const p2 = makePlan({
      id: "p_2",
      errands: [{ id: "e_2", text: "e", chores: [{ id: "c_2", text: "c", status: "pending" }] }],
    });
    const idx = buildChoreIndex([p1, p2]);
    expect(idx.get("c_1")).toBe("p_1");
    expect(idx.get("c_2")).toBe("p_2");
  });
});

describe("buildErrandIndex", () => {
  it("maps errand id to plan id", () => {
    const plan = makePlan();
    const idx = buildErrandIndex([plan]);
    expect(idx.get("e_test")).toBe("p_test");
  });

  it("empty plans → empty map", () => {
    expect(buildErrandIndex([])).toEqual(new Map());
  });

  it("multiple plans", () => {
    const p1 = makePlan({ id: "p_1", errands: [{ id: "e_1", text: "e", chores: [] }] });
    const p2 = makePlan({ id: "p_2", errands: [{ id: "e_2", text: "e", chores: [] }] });
    const idx = buildErrandIndex([p1, p2]);
    expect(idx.get("e_1")).toBe("p_1");
    expect(idx.get("e_2")).toBe("p_2");
  });
});

describe("applyChoreUpdates", () => {
  it("all-valid batch: all ok:true, plan reflects new statuses", () => {
    const plan = makePlan({
      errands: [
        {
          id: "e_test",
          text: "e",
          chores: [
            { id: "c_1", text: "c1", status: "pending" },
            { id: "c_2", text: "c2", status: "active" },
          ],
        },
      ],
    });
    const { results } = applyChoreUpdates(plan, [
      { id: "c_1", status: "active" },
      { id: "c_2", status: "done" },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ id: "c_1", ok: true, status: "active" });
    expect(results[1]).toEqual({ id: "c_2", ok: true, status: "done" });
    expect(plan.errands[0].chores[0].status).toBe("active");
    expect(plan.errands[0].chores[1].status).toBe("done");
  });

  it("mixed batch: valid applied, unknown id and invalid transition return ok:false", () => {
    const plan = makePlan({
      errands: [
        {
          id: "e_test",
          text: "e",
          chores: [
            { id: "c_valid", text: "c1", status: "pending" },
            { id: "c_done", text: "c2", status: "done" },
          ],
        },
      ],
    });
    const { results } = applyChoreUpdates(plan, [
      { id: "c_valid", status: "active" },
      { id: "c_nope", status: "done" },
      { id: "c_done", status: "active" },
    ]);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ id: "c_valid", ok: true, status: "active" });
    expect(results[1]).toEqual({ id: "c_nope", ok: false, error: "chore not found" });
    expect(results[2].ok).toBe(false);
    // valid update IS applied
    expect(plan.errands[0].chores[0].status).toBe("active");
    // invalid transition leaves chore unchanged
    expect(plan.errands[0].chores[1].status).toBe("done");
  });

  it("empty batch: results empty, plan unchanged", () => {
    const plan = makePlan();
    const { results } = applyChoreUpdates(plan, []);
    expect(results).toEqual([]);
    expect(plan.errands[0].chores[0].status).toBe("pending");
  });

  it("invalid transition error message contains both from and to status names", () => {
    const plan = makePlan({
      errands: [{ id: "e_test", text: "e", chores: [{ id: "c_done", text: "c", status: "done" }] }],
    });
    const { results } = applyChoreUpdates(plan, [{ id: "c_done", status: "active" }]);
    expect(results[0].ok).toBe(false);
    if (!results[0].ok) {
      expect(results[0].error).toContain("done");
      expect(results[0].error).toContain("active");
    }
  });

  it("unknown chore id returns ok:false with 'chore not found'", () => {
    const plan = makePlan();
    const { results } = applyChoreUpdates(plan, [{ id: "c_nope", status: "done" }]);
    expect(results[0]).toEqual({ id: "c_nope", ok: false, error: "chore not found" });
  });
});

describe("appendChores", () => {
  it("appends to errand with pending status", () => {
    const plan = makePlan();
    const { added } = appendChores(plan, "e_test", [{ text: "new chore" }]);
    expect(added).toHaveLength(1);
    expect(added[0].status).toBe("pending");
    expect(added[0].id).toMatch(/^c_/);
    expect(plan.errands[0].chores).toHaveLength(2);
  });

  it("reverts a fully-terminal errand to active by adding a pending chore", () => {
    const plan = makePlan({
      errands: [{ id: "e_test", text: "e", chores: [{ id: "c_1", text: "c", status: "done" }] }],
    });
    const { errandStatus } = appendChores(plan, "e_test", [{ text: "extra" }]);
    expect(errandStatus).toBe("active");
  });

  it("throws for unknown errand id", () => {
    const plan = makePlan();
    expect(() => appendChores(plan, "e_nope", [{ text: "c" }])).toThrow("e_nope");
  });
});

describe("appendErrands", () => {
  it("appends errands with new IDs and pending chores", () => {
    const plan = makePlan({ errands: [] });
    const { added } = appendErrands(plan, [{ text: "new errand", chores: [{ text: "c1" }] }]);
    expect(added).toHaveLength(1);
    expect(added[0].id).toMatch(/^e_/);
    expect(added[0].chores[0].id).toMatch(/^c_/);
    expect(added[0].chores[0].status).toBe("pending");
    expect(plan.errands).toHaveLength(1);
  });

  it("returns all added errands", () => {
    const plan = makePlan({ errands: [] });
    const { added } = appendErrands(plan, [
      { text: "a", chores: [{ text: "c" }] },
      { text: "b", chores: [] },
    ]);
    expect(added).toHaveLength(2);
    expect(added[0].text).toBe("a");
    expect(added[1].text).toBe("b");
  });
});

describe("resolveTrackedItem — with plans arg", () => {
  it("resolves a plan id", async () => {
    const plan = makePlan();
    const result = await resolveTrackedItem("unused", "p_test", [plan]);
    expect(result?.type).toBe("plan");
    expect(result?.plan.id).toBe("p_test");
  });

  it("resolves an errand id with type 'errand' and parent plan", async () => {
    const plan = makePlan();
    const result = await resolveTrackedItem("unused", "e_test", [plan]);
    expect(result?.type).toBe("errand");
    expect(result?.errand?.id).toBe("e_test");
    expect(result?.plan.id).toBe("p_test");
  });

  it("returns undefined for unknown id", async () => {
    const plan = makePlan();
    expect(await resolveTrackedItem("unused", "p_nope", [plan])).toBeUndefined();
  });
});

describe("resolveTrackedItem — from disk", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pi-errands-resolve-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("resolves plan id from disk", async () => {
    const plan = makePlan();
    await savePlan(dir, plan);
    const result = await resolveTrackedItem(dir, "p_test");
    expect(result?.type).toBe("plan");
    expect(result?.plan.id).toBe("p_test");
  });

  it("resolves errand id from disk (regression)", async () => {
    const plan = makePlan();
    await savePlan(dir, plan);
    const result = await resolveTrackedItem(dir, "e_test");
    expect(result?.type).toBe("errand");
    expect(result?.errand?.id).toBe("e_test");
  });

  it("returns undefined for unknown id from disk", async () => {
    const plan = makePlan();
    await savePlan(dir, plan);
    expect(await resolveTrackedItem(dir, "e_nope")).toBeUndefined();
  });
});
