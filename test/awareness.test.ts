import { describe, expect, it } from "vitest";
import { AWARENESS_MAX_CHARS, appendLoadErrorNote, buildAwarenessMessage } from "../src/awareness.js";
import type { LoadError } from "../src/store.js";
import type { Plan } from "../src/types.js";

function makePlan(overrides?: Partial<Plan>): Plan {
  return {
    id: "p_1",
    name: "My Plan",
    errands: [
      {
        id: "e_1",
        text: "First Errand",
        chores: [
          { id: "c_1", text: "Chore One", status: "pending" },
          { id: "c_2", text: "Chore Two", status: "pending" },
        ],
      },
    ],
    createdAt: 0,
    ...overrides,
  };
}

describe("buildAwarenessMessage", () => {
  it("returns undefined when tracked is null", () => {
    expect(buildAwarenessMessage(null, [])).toBeUndefined();
  });

  it("returns undefined when tracked id matches nothing", () => {
    expect(buildAwarenessMessage("p_nope", [makePlan()])).toBeUndefined();
  });

  it("tracked plan, active: includes plan name, errand text, chore detail and IDs", () => {
    const plan = makePlan();
    const msg = buildAwarenessMessage("p_1", [plan]);
    expect(msg).toBeDefined();
    expect(msg).toContain("My Plan");
    expect(msg).toContain("First Errand");
    expect(msg).toContain("Chore One");
    expect(msg).toContain("c_1");
    expect(msg).toContain("e_1");
  });

  it("tracked errand: includes errand text, parent plan name, every chore with id", () => {
    const plan = makePlan();
    const msg = buildAwarenessMessage("e_1", [plan]);
    expect(msg).toBeDefined();
    expect(msg).toContain("First Errand");
    expect(msg).toContain("My Plan");
    expect(msg).toContain("c_1");
    expect(msg).toContain("c_2");
  });

  it("tracked plan, all errands done: lists each errand at done, no per-chore detail", () => {
    const plan = makePlan({
      errands: [
        { id: "e_1", text: "Errand A", chores: [{ id: "c_1", text: "c", status: "done" }] },
        { id: "e_2", text: "Errand B", chores: [{ id: "c_2", text: "c", status: "done" }] },
      ],
    });
    const msg = buildAwarenessMessage("p_1", [plan]);
    expect(msg).toContain("[done]");
    expect(msg).toContain("Errand A");
    expect(msg).toContain("Errand B");
    // terminal summary does not show chore IDs for done errands
    expect(msg).not.toContain("c_1");
    expect(msg).not.toContain("c_2");
  });

  it("tracked plan, mixed terminal with failures: lists failed errands with first failed chore reason", () => {
    const plan = makePlan({
      errands: [
        {
          id: "e_1",
          text: "Failed Errand",
          chores: [{ id: "c_bad", text: "Bad Chore", status: "failed" }],
        },
        {
          id: "e_2",
          text: "Done Errand",
          chores: [{ id: "c_ok", text: "ok", status: "done" }],
        },
      ],
    });
    const msg = buildAwarenessMessage("p_1", [plan]);
    expect(msg).toContain("[failed]");
    expect(msg).toContain("Failed Errand");
    expect(msg).toContain("Bad Chore");
    expect(msg).toContain("c_bad");
  });

  it("length cap: large active plan is within AWARENESS_MAX_CHARS and mentions plan name", () => {
    const errands = Array.from({ length: 30 }, (_, i) => ({
      id: `e_${i}`,
      text: `Errand ${"x".repeat(50)} ${i}`,
      chores: Array.from({ length: 30 }, (_, j) => ({
        id: `c_${i}_${j}`,
        text: `Chore ${"y".repeat(50)} ${i}-${j}`,
        status: "pending" as const,
      })),
    }));
    const plan: Plan = {
      id: "p_big",
      name: "Big Plan",
      errands,
      createdAt: 0,
    };
    const msg = buildAwarenessMessage("p_big", [plan]);
    expect(msg).toBeDefined();
    expect((msg as string).length).toBeLessThanOrEqual(AWARENESS_MAX_CHARS);
    expect(msg).toContain("Big Plan");
  });

  it("even larger terminal plan ends with …(truncated)", () => {
    // All done — goes through formatTerminalPlanSummary which can only hard-truncate
    const errands = Array.from({ length: 200 }, (_, i) => ({
      id: `e_${i}`,
      text: `Errand ${"x".repeat(200)} ${i}`,
      chores: Array.from({ length: 5 }, (_, j) => ({
        id: `c_${i}_${j}`,
        text: `Chore ${"y".repeat(200)} ${i}-${j}`,
        status: "done" as const,
      })),
    }));
    const plan: Plan = {
      id: "p_huge",
      name: "Huge Plan",
      errands,
      createdAt: 0,
    };
    const msg = buildAwarenessMessage("p_huge", [plan]);
    expect(msg).toBeDefined();
    expect((msg as string).length).toBeLessThanOrEqual(AWARENESS_MAX_CHARS);
    expect(msg).toContain("…(truncated)");
  });

  it("tracked plan, all errands skipped: lists each errand at skipped", () => {
    const plan = makePlan({
      errands: [
        { id: "e_1", text: "Skip One", chores: [{ id: "c_1", text: "c", status: "skipped" }] },
        { id: "e_2", text: "Skip Two", chores: [{ id: "c_2", text: "c", status: "skipped" }] },
      ],
    });
    const msg = buildAwarenessMessage("p_1", [plan]);
    expect(msg).toContain("[skipped]");
    expect(msg).toContain("Skip One");
    expect(msg).toContain("Skip Two");
  });
});

// TODO: the before_agent_start hook in src/index.ts calls appendLoadErrorNote(buildAwarenessMessage(...), errors)
// and injects the result as an awareness message. Testing the footer-appending via that hook requires an
// integration harness; unit coverage lives in the appendLoadErrorNote tests below.

describe("appendLoadErrorNote", () => {
  it("errors empty → returns input unchanged", () => {
    expect(appendLoadErrorNote("hello", [])).toBe("hello");
    expect(appendLoadErrorNote(undefined, [])).toBeUndefined();
  });

  it("errors non-empty + message non-empty → appends note, caps IDs at 3 with ellipsis if more", () => {
    const errors: LoadError[] = [
      { planId: "p_1", reason: "bad" },
      { planId: "p_2", reason: "bad" },
      { planId: "p_3", reason: "bad" },
      { planId: "p_4", reason: "bad" },
    ];
    const result = appendLoadErrorNote("base message", errors);
    expect(result).toContain("base message");
    expect(result).toContain("4 plan file(s) could not be loaded");
    expect(result).toContain("p_1");
    expect(result).toContain("p_3");
    expect(result).not.toContain("p_4");
    expect(result).toContain("…");
  });

  it("errors non-empty + message undefined → returns only the note", () => {
    const errors: LoadError[] = [{ planId: "p_bad", reason: "parse error" }];
    const result = appendLoadErrorNote(undefined, errors);
    expect(result).toBeDefined();
    expect(result).toContain("1 plan file(s) could not be loaded");
    expect(result).toContain("p_bad");
    expect(result).not.toContain("undefined");
  });
});
