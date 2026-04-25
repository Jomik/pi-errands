import { describe, expect, it } from "vitest";
import type { LoadError } from "../src/store.js";
import type { Plan } from "../src/types.js";
import { updateWidget } from "../src/widget.js";

interface FakeUI {
  setWidget(id: string, lines: string[] | undefined): void;
  calls: { id: string; lines: string[] | undefined }[];
}

function makeUI(): FakeUI {
  const calls: { id: string; lines: string[] | undefined }[] = [];
  return {
    calls,
    setWidget(id, lines) {
      calls.push({ id, lines });
    },
  };
}

function makePlan(overrides?: Partial<Plan>): Plan {
  return {
    id: "p_1",
    name: "My Plan",
    errands: [],
    createdAt: 0,
    ...overrides,
  };
}

describe("updateWidget", () => {
  it("tracked === null → setWidget(id, undefined)", () => {
    const ui = makeUI();
    updateWidget(ui as never, null, [], []);
    expect(ui.calls).toHaveLength(1);
    expect(ui.calls[0].id).toBe("errands");
    expect(ui.calls[0].lines).toBeUndefined();
  });

  it("tracked id not in plans → setWidget(id, undefined)", () => {
    const ui = makeUI();
    updateWidget(ui as never, "p_nope", [makePlan()], []);
    expect(ui.calls[0].lines).toBeUndefined();
  });

  it("tracked plan with active errand: plan name in first line, chores expanded", () => {
    const ui = makeUI();
    const plan = makePlan({
      errands: [
        {
          id: "e_1",
          text: "Active Errand",
          chores: [
            { id: "c_1", text: "Chore A", status: "active" },
            { id: "c_2", text: "Chore B", status: "pending" },
          ],
        },
      ],
    });
    updateWidget(ui as never, "p_1", [plan], []);
    const lines = ui.calls[0].lines as string[];
    expect(lines[0]).toContain("My Plan");
    const joined = lines.join("\n");
    expect(joined).toContain("Active Errand");
    expect(joined).toContain("Chore A");
    expect(joined).toContain("Chore B");
  });

  it("tracked plan with non-active errand: summary [done/total] shown", () => {
    const ui = makeUI();
    const plan = makePlan({
      errands: [
        {
          id: "e_1",
          text: "Done Errand",
          chores: [{ id: "c_1", text: "c", status: "done" }],
        },
      ],
    });
    updateWidget(ui as never, "p_1", [plan], []);
    const joined = (ui.calls[0].lines as string[]).join("\n");
    expect(joined).toContain("Done Errand");
    expect(joined).toContain("1/1");
  });

  it("tracked plan with failed/skipped chores: summary includes N failed / M skipped", () => {
    const ui = makeUI();
    const plan = makePlan({
      errands: [
        {
          id: "e_1",
          text: "Mixed Errand",
          chores: [
            { id: "c_1", text: "c1", status: "failed" },
            { id: "c_2", text: "c2", status: "skipped" },
            { id: "c_3", text: "c3", status: "done" },
          ],
        },
      ],
    });
    updateWidget(ui as never, "p_1", [plan], []);
    const joined = (ui.calls[0].lines as string[]).join("\n");
    expect(joined).toContain("1 failed");
    expect(joined).toContain("1 skipped");
  });

  it("tracked errand: errand text in first line, all chores listed with status icons", () => {
    const ui = makeUI();
    const plan = makePlan({
      errands: [
        {
          id: "e_1",
          text: "My Errand",
          chores: [
            { id: "c_1", text: "Chore A", status: "done" },
            { id: "c_2", text: "Chore B", status: "pending" },
          ],
        },
      ],
    });
    updateWidget(ui as never, "e_1", [plan], []);
    const lines = ui.calls[0].lines as string[];
    expect(lines[0]).toContain("My Errand");
    const joined = lines.join("\n");
    expect(joined).toContain("Chore A");
    expect(joined).toContain("Chore B");
    expect(joined).toContain("●"); // done icon
    expect(joined).toContain("○"); // pending icon
  });

  it("errors non-empty + tracked null → widget shows unreadable count, no clear", () => {
    const ui = makeUI();
    const errors: LoadError[] = [
      { planId: "p_bad1", reason: "parse error" },
      { planId: "p_bad2", reason: "version mismatch" },
    ];
    updateWidget(ui as never, null, [], errors);
    expect(ui.calls).toHaveLength(1);
    expect(ui.calls[0].lines).toEqual(["unreadable: 2 plan(s)"]);
  });

  it("errors non-empty + valid tracked plan → plan content plus unreadable trailing line", () => {
    const ui = makeUI();
    const plan = makePlan({
      errands: [{ id: "e_1", text: "An Errand", chores: [{ id: "c_1", text: "c", status: "done" }] }],
    });
    const errors: LoadError[] = [{ planId: "p_bad", reason: "parse error" }];
    updateWidget(ui as never, "p_1", [plan], errors);
    const lines = ui.calls[0].lines as string[];
    expect(lines[lines.length - 1]).toBe("unreadable: 1 plan(s)");
    expect(lines.length).toBeGreaterThan(1);
  });
});
