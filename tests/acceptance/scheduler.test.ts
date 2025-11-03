import { describe, it, expect } from "vitest";
import { schedule } from "../../src/core/scheduler";
import type { Input } from "../../src/types";
import { parseISO } from "date-fns";

const sampleInput: Input = {
  horizon: {
    start: "2025-11-03T08:00:00Z",
    end: "2025-11-03T16:00:00Z",
  },
  resources: [
    {
      id: "Fill-1",
      capabilities: ["fill"],
      calendar: [
        ["2025-11-03T08:00:00Z", "2025-11-03T12:00:00Z"],
        ["2025-11-03T12:30:00Z", "2025-11-03T16:00:00Z"],
      ],
    },
    {
      id: "Fill-2",
      capabilities: ["fill"],
      calendar: [["2025-11-03T08:00:00Z", "2025-11-03T16:00:00Z"]],
    },
    {
      id: "Label-1",
      capabilities: ["label"],
      calendar: [["2025-11-03T08:00:00Z", "2025-11-03T16:00:00Z"]],
    },
    {
      id: "Pack-1",
      capabilities: ["pack"],
      calendar: [["2025-11-03T08:00:00Z", "2025-11-03T16:00:00Z"]],
    },
  ],
  changeover_matrix_minutes: {
    values: {
      "standard->standard": 0,
      "standard->premium": 20,
      "premium->standard": 20,
      "premium->premium": 0,
    },
  },
  products: [
    {
      id: "P-100",
      family: "standard",
      due: "2025-11-03T12:30:00Z",
      route: [
        { capability: "fill", duration_minutes: 30 },
        { capability: "label", duration_minutes: 20 },
        { capability: "pack", duration_minutes: 15 },
      ],
    },
    {
      id: "P-101",
      family: "premium",
      due: "2025-11-03T15:00:00Z",
      route: [
        { capability: "fill", duration_minutes: 35 },
        { capability: "label", duration_minutes: 25 },
        { capability: "pack", duration_minutes: 15 },
      ],
    },
    {
      id: "P-102",
      family: "standard",
      due: "2025-11-03T13:30:00Z",
      route: [
        { capability: "fill", duration_minutes: 25 },
        { capability: "label", duration_minutes: 20 },
      ],
    },
    {
      id: "P-103",
      family: "premium",
      due: "2025-11-03T14:00:00Z",
      route: [
        { capability: "fill", duration_minutes: 30 },
        { capability: "label", duration_minutes: 20 },
        { capability: "pack", duration_minutes: 15 },
      ],
    },
  ],
  settings: {
    time_limit_seconds: 30,
  },
};

describe("Scheduler Acceptance Tests", () => {
  describe("Happy Path", () => {
    it("produces a valid schedule for sample input", () => {
      const result = schedule(sampleInput);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.assignments.length).toBeGreaterThan(0);
      expect(result.kpis).toBeDefined();
      expect(result.kpis.total_jobs).toBe(4);
      expect(result.version).toBe("1.0.0");
    });

    it("schedules all operations for all products", () => {
      const result = schedule(sampleInput);

      expect(result.success).toBe(true);
      if (!result.success) return;

      const expectedOps = sampleInput.products.reduce(
        (sum, p) => sum + p.route.length,
        0
      );
      expect(result.assignments.length).toBe(expectedOps);

      for (const product of sampleInput.products) {
        const productAssignments = result.assignments.filter(
          (a) => a.product === product.id
        );
        expect(productAssignments.length).toBe(product.route.length);
      }
    });
  });

  describe("Constraint Validation", () => {
    it("produces no overlapping assignments on any resource", () => {
      const result = schedule(sampleInput);

      expect(result.success).toBe(true);
      if (!result.success) return;

      const byResource = new Map<
        string,
        Array<{ start: Date; end: Date; product: string; operation: string }>
      >();

      for (const assignment of result.assignments) {
        if (!byResource.has(assignment.resource)) {
          byResource.set(assignment.resource, []);
        }
        byResource.get(assignment.resource)!.push({
          start: parseISO(assignment.start),
          end: parseISO(assignment.end),
          product: assignment.product,
          operation: assignment.operation,
        });
      }

      for (const [resourceId, assignments] of byResource.entries()) {
        const sorted = assignments
          .slice()
          .sort((a, b) => a.start.getTime() - b.start.getTime());

        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1];
          const curr = sorted[i];

          expect(curr.start.getTime()).toBeGreaterThanOrEqual(
            prev.end.getTime()
          );

          if (curr.start.getTime() < prev.end.getTime()) {
            throw new Error(
              `Overlap detected on ${resourceId}: ${prev.product}.${
                prev.operation
              } (${prev.start.toISOString()}-${prev.end.toISOString()}) overlaps with ${
                curr.product
              }.${
                curr.operation
              } (${curr.start.toISOString()}-${curr.end.toISOString()})`
            );
          }
        }
      }
    });

    it("respects precedence constraints for all products", () => {
      const result = schedule(sampleInput);

      expect(result.success).toBe(true);
      if (!result.success) return;

      for (const product of sampleInput.products) {
        const productAssignments = result.assignments
          .filter((a) => a.product === product.id)
          .sort((a, b) => {
            const aStep = product.route.findIndex(
              (op) => op.capability === a.operation
            );
            const bStep = product.route.findIndex(
              (op) => op.capability === b.operation
            );
            return aStep - bStep;
          });

        for (let i = 1; i < productAssignments.length; i++) {
          const prev = productAssignments[i - 1];
          const curr = productAssignments[i];

          const prevEnd = parseISO(prev.end);
          const currStart = parseISO(curr.start);

          expect(currStart.getTime()).toBeGreaterThanOrEqual(prevEnd.getTime());

          if (currStart.getTime() < prevEnd.getTime()) {
            throw new Error(
              `Precedence violation for ${product.id}: step ${i - 1} (${
                prev.operation
              }) ends at ${prev.end}, but step ${i} (${
                curr.operation
              }) starts at ${curr.start}`
            );
          }
        }
      }
    });

    it("keeps all assignments within the horizon", () => {
      const result = schedule(sampleInput);

      expect(result.success).toBe(true);
      if (!result.success) return;

      const horizonStart = parseISO(sampleInput.horizon.start);
      const horizonEnd = parseISO(sampleInput.horizon.end);

      for (const assignment of result.assignments) {
        const start = parseISO(assignment.start);
        const end = parseISO(assignment.end);

        expect(start.getTime()).toBeGreaterThanOrEqual(horizonStart.getTime());
        expect(end.getTime()).toBeLessThanOrEqual(horizonEnd.getTime());
      }
    });

    it("only assigns operations to resources with required capabilities", () => {
      const result = schedule(sampleInput);

      expect(result.success).toBe(true);
      if (!result.success) return;

      const capabilityMap = new Map<string, Set<string>>();
      for (const resource of sampleInput.resources) {
        capabilityMap.set(resource.id, new Set(resource.capabilities));
      }

      for (const assignment of result.assignments) {
        const product = sampleInput.products.find(
          (p) => p.id === assignment.product
        )!;
        const operation = product.route.find(
          (op) => op.capability === assignment.operation
        )!;

        const resourceCapabilities = capabilityMap.get(assignment.resource)!;
        expect(resourceCapabilities.has(operation.capability)).toBe(true);
      }
    });

    it("assignments fit within resource calendar windows", () => {
      const result = schedule(sampleInput);

      expect(result.success).toBe(true);
      if (!result.success) return;

      const calendarMap = new Map<string, Array<{ start: Date; end: Date }>>();
      for (const resource of sampleInput.resources) {
        calendarMap.set(
          resource.id,
          resource.calendar.map(([s, e]) => ({
            start: parseISO(s),
            end: parseISO(e),
          }))
        );
      }

      for (const assignment of result.assignments) {
        const windows = calendarMap.get(assignment.resource)!;
        const start = parseISO(assignment.start);
        const end = parseISO(assignment.end);

        const fitsInSomeWindow = windows.some(
          (w) =>
            start.getTime() >= w.start.getTime() &&
            end.getTime() <= w.end.getTime()
        );

        expect(fitsInSomeWindow).toBe(true);

        if (!fitsInSomeWindow) {
          throw new Error(
            `Assignment ${assignment.product}.${assignment.operation} on ${assignment.resource} (${assignment.start} - ${assignment.end}) does not fit in any calendar window`
          );
        }
      }
    });
  });

  describe("KPIs", () => {
    it("reports correct tardiness", () => {
      const result = schedule(sampleInput);

      expect(result.success).toBe(true);
      if (!result.success) return;

      const productCompletions = new Map<string, Date>();
      for (const assignment of result.assignments) {
        const end = parseISO(assignment.end);
        const current = productCompletions.get(assignment.product);
        if (!current || end.getTime() > current.getTime()) {
          productCompletions.set(assignment.product, end);
        }
      }

      let expectedTardiness = 0;
      for (const product of sampleInput.products) {
        const completion = productCompletions.get(product.id)!;
        const due = parseISO(product.due);
        const tardiness = Math.max(
          0,
          Math.round((completion.getTime() - due.getTime()) / 60000)
        );
        expectedTardiness += tardiness;
      }

      expect(result.kpis.tardiness_minutes).toBe(expectedTardiness);
    });

    it("reports makespan correctly", () => {
      const result = schedule(sampleInput);

      expect(result.success).toBe(true);
      if (!result.success) return;

      if (result.assignments.length === 0) {
        expect(result.kpis.makespan_minutes).toBe(0);
        return;
      }

      const starts = result.assignments.map((a) => parseISO(a.start).getTime());
      const ends = result.assignments.map((a) => parseISO(a.end).getTime());

      const minStart = Math.min(...starts);
      const maxEnd = Math.max(...ends);
      const expectedMakespan = Math.round((maxEnd - minStart) / 60000);

      expect(result.kpis.makespan_minutes).toBe(expectedMakespan);
    });

    it("counts on-time jobs correctly", () => {
      const result = schedule(sampleInput);

      expect(result.success).toBe(true);
      if (!result.success) return;

      const productCompletions = new Map<string, Date>();
      for (const assignment of result.assignments) {
        const end = parseISO(assignment.end);
        const current = productCompletions.get(assignment.product);
        if (!current || end.getTime() > current.getTime()) {
          productCompletions.set(assignment.product, end);
        }
      }

      let expectedOnTime = 0;
      for (const product of sampleInput.products) {
        const completion = productCompletions.get(product.id)!;
        const due = parseISO(product.due);
        if (completion.getTime() <= due.getTime()) {
          expectedOnTime++;
        }
      }

      expect(result.kpis.on_time_jobs).toBe(expectedOnTime);
      expect(result.kpis.total_jobs).toBe(sampleInput.products.length);
    });
  });

  describe("Infeasibility Cases", () => {
    it("returns error when Label-1 calendar is too short", () => {
      const infeasibleInput: Input = {
        ...sampleInput,
        resources: sampleInput.resources.map((r) =>
          r.id === "Label-1"
            ? {
                ...r,
                calendar: [["2025-11-03T08:00:00Z", "2025-11-03T08:30:00Z"]],
              }
            : r
        ),
      };

      const result = schedule(infeasibleInput);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error).toBeDefined();
      expect(result.why).toBeDefined();
      expect(result.why.length).toBeGreaterThan(0);
    });

    it("returns error when no resources have required capability", () => {
      const infeasibleInput: Input = {
        ...sampleInput,
        resources: sampleInput.resources.filter((r) => r.id !== "Pack-1"),
        products: [
          {
            id: "P-999",
            family: "standard",
            due: "2025-11-03T10:00:00Z",
            route: [{ capability: "pack", duration_minutes: 30 }],
          },
        ],
      };

      const result = schedule(infeasibleInput);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error).toBe("No eligible resources");
      expect(result.why[0]).toContain("No resource has required capability");
    });

    it("returns error when operation would exceed horizon", () => {
      const infeasibleInput: Input = {
        ...sampleInput,
        products: [
          {
            id: "P-LONG",
            family: "standard",
            due: "2025-11-03T20:00:00Z",
            route: [{ capability: "fill", duration_minutes: 600 }],
          },
        ],
      };

      const result = schedule(infeasibleInput);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error).toBeDefined();
      expect(result.why.length).toBeGreaterThan(0);
    });

    it("handles empty products list", () => {
      const emptyInput: Input = {
        ...sampleInput,
        products: [],
      };

      const result = schedule(emptyInput);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.assignments.length).toBe(0);
      expect(result.kpis.total_jobs).toBe(0);
      expect(result.kpis.tardiness_minutes).toBe(0);
      expect(result.kpis.changeovers).toBe(0);
      expect(result.kpis.makespan_minutes).toBe(0);
    });
  });

  describe("Changeover Handling", () => {
    it("accounts for changeover time when switching families", () => {
      const changoverInput: Input = {
        horizon: {
          start: "2025-11-03T08:00:00Z",
          end: "2025-11-03T16:00:00Z",
        },
        resources: [
          {
            id: "Machine-1",
            capabilities: ["work"],
            calendar: [["2025-11-03T08:00:00Z", "2025-11-03T16:00:00Z"]],
          },
        ],
        changeover_matrix_minutes: {
          values: {
            "A->A": 0,
            "A->B": 30,
            "B->A": 30,
            "B->B": 0,
          },
        },
        products: [
          {
            id: "Job-A",
            family: "A",
            due: "2025-11-03T10:00:00Z",
            route: [{ capability: "work", duration_minutes: 60 }],
          },
          {
            id: "Job-B",
            family: "B",
            due: "2025-11-03T12:00:00Z",
            route: [{ capability: "work", duration_minutes: 60 }],
          },
        ],
        settings: {
          time_limit_seconds: 30,
        },
      };

      const result = schedule(changoverInput);

      expect(result.success).toBe(true);
      if (!result.success) return;

      const assignments = result.assignments.sort((a, b) =>
        parseISO(a.start).getTime() < parseISO(b.start).getTime() ? -1 : 1
      );

      expect(assignments.length).toBe(2);

      const first = assignments[0];
      const second = assignments[1];

      const firstEnd = parseISO(first.end);
      const secondStart = parseISO(second.start);

      const gap = (secondStart.getTime() - firstEnd.getTime()) / 60000;

      expect(gap).toBeGreaterThanOrEqual(30);
    });

    it("counts changeovers in KPI", () => {
      const result = schedule(sampleInput);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.kpis.changeovers).toBeGreaterThanOrEqual(0);
      expect(typeof result.kpis.changeovers).toBe("number");
    });
  });
});
