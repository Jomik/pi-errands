import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, deriveErrandStatus, derivePlanStatus } from "../src/lifecycle.js";
import type { Errand, Plan, Status } from "../src/types.js";

function errand(statuses: Status[]): Errand {
  return {
    id: "e1",
    text: "test",
    chores: statuses.map((s, i) => ({ id: `c${i}`, text: `chore ${i}`, status: s })),
  };
}

function plan(errandStatuses: Status[][]): Plan {
  return {
    id: "p1",
    name: "test",
    errands: errandStatuses.map((ss, i) => ({
      id: `e${i}`,
      text: `errand ${i}`,
      chores: ss.map((s, j) => ({ id: `c${i}-${j}`, text: `chore ${j}`, status: s })),
    })),
    createdAt: 0,
  };
}

describe("canTransition", () => {
  it("allows pending → active", () => expect(canTransition("pending", "active")).toBe(true));
  it("allows pending → done", () => expect(canTransition("pending", "done")).toBe(true));
  it("allows pending → failed", () => expect(canTransition("pending", "failed")).toBe(true));
  it("allows pending → skipped", () => expect(canTransition("pending", "skipped")).toBe(true));
  it("allows active → done", () => expect(canTransition("active", "done")).toBe(true));
  it("allows active → failed", () => expect(canTransition("active", "failed")).toBe(true));
  it("allows active → skipped", () => expect(canTransition("active", "skipped")).toBe(true));
  it("rejects done → active", () => expect(canTransition("done", "active")).toBe(false));
  it("rejects failed → done", () => expect(canTransition("failed", "done")).toBe(false));
  it("rejects skipped → pending", () => expect(canTransition("skipped", "pending")).toBe(false));
  it("rejects active → pending", () => expect(canTransition("active", "pending")).toBe(false));
});

describe("assertTransition", () => {
  it("throws on invalid transition", () => {
    expect(() => assertTransition("done", "active", "c1")).toThrow("Invalid transition for chore c1: done → active");
  });

  it("does not throw on valid transition", () => {
    expect(() => assertTransition("pending", "active", "c1")).not.toThrow();
  });
});

describe("deriveErrandStatus", () => {
  it("all pending → pending", () => expect(deriveErrandStatus(errand(["pending", "pending"]))).toBe("pending"));
  it("one active → active", () => expect(deriveErrandStatus(errand(["pending", "active"]))).toBe("active"));
  it("pending + terminal → active", () => expect(deriveErrandStatus(errand(["pending", "done"]))).toBe("active"));
  it("all done → done", () => expect(deriveErrandStatus(errand(["done", "done"]))).toBe("done"));
  it("done + skipped → done", () => expect(deriveErrandStatus(errand(["done", "skipped"]))).toBe("done"));
  it("done + failed → failed", () => expect(deriveErrandStatus(errand(["done", "failed"]))).toBe("failed"));
  it("all failed → failed", () => expect(deriveErrandStatus(errand(["failed", "failed"]))).toBe("failed"));
  it("all skipped → skipped", () => expect(deriveErrandStatus(errand(["skipped", "skipped"]))).toBe("skipped"));
  it("failed + skipped → failed", () => expect(deriveErrandStatus(errand(["failed", "skipped"]))).toBe("failed"));
  it("empty chores → pending", () => expect(deriveErrandStatus(errand([]))).toBe("pending"));
});

describe("derivePlanStatus", () => {
  it("all errands pending → pending", () => {
    expect(derivePlanStatus(plan([["pending"], ["pending"]]))).toBe("pending");
  });

  it("mixed errands → active", () => {
    expect(derivePlanStatus(plan([["done"], ["pending"]]))).toBe("active");
  });

  it("all errands done → done", () => {
    expect(derivePlanStatus(plan([["done"], ["done", "skipped"]]))).toBe("done");
  });

  it("one errand failed → failed", () => {
    expect(derivePlanStatus(plan([["done"], ["failed"]]))).toBe("failed");
  });

  it("all errands skipped → skipped", () => {
    expect(derivePlanStatus(plan([["skipped"], ["skipped"]]))).toBe("skipped");
  });

  it("mix of done and skipped errands → done", () => {
    expect(derivePlanStatus(plan([["done"], ["skipped"]]))).toBe("done");
  });

  it("empty plan → pending", () => {
    expect(derivePlanStatus(plan([]))).toBe("pending");
  });
});
