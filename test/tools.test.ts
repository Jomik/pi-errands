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
import { PLAN_SCHEMA_VERSION } from "../src/types.js";

function makePlan(overrides?: Partial<Plan>): Plan {
  return {
    id: "p_test",
    version: PLAN_SCHEMA_VERSION,
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

  it("sets version: PLAN_SCHEMA_VERSION", () => {
    const plan = executePlanErrands({ name: "x", errands: [] });
    expect(plan.version).toBe(PLAN_SCHEMA_VERSION);
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
  it("valid forward transition succeeds", () => {
    const plan = makePlan();
    const { results } = applyChoreUpdates(plan, [{ id: "c_test", status: "active" }]);
    expect(results[0].status).toBe("active");
    expect(plan.errands[0].chores[0].status).toBe("active");
  });

  it("invalid transition (terminal → anything) throws and does not proceed", () => {
    const plan = makePlan({
      errands: [{ id: "e_test", text: "e", chores: [{ id: "c_done", text: "c", status: "done" }] }],
    });
    expect(() => applyChoreUpdates(plan, [{ id: "c_done", status: "active" }])).toThrow();
    // chore remains done — not mutated to active
    expect(plan.errands[0].chores[0].status).toBe("done");
  });

  it("unknown chore id throws", () => {
    const plan = makePlan();
    expect(() => applyChoreUpdates(plan, [{ id: "c_nope", status: "done" }])).toThrow("c_nope");
  });

  it("mixed valid+invalid: valid applied before invalid throws", () => {
    const plan = makePlan({
      errands: [
        {
          id: "e_test",
          text: "e",
          chores: [
            { id: "c_1", text: "c1", status: "pending" },
            { id: "c_done", text: "c2", status: "done" },
          ],
        },
      ],
    });
    expect(() =>
      applyChoreUpdates(plan, [
        { id: "c_1", status: "active" },
        { id: "c_done", status: "active" },
      ]),
    ).toThrow();
    // c_1 was mutated before the throw
    expect(plan.errands[0].chores[0].status).toBe("active");
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
