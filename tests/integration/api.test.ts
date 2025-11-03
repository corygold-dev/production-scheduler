import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/api/server";
import type { Input } from "../../src/types";

describe("API Integration Tests", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

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
    ],
    settings: {
      time_limit_seconds: 30,
    },
  };

  describe("POST /schedule", () => {
    it("returns a valid schedule for sample input", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/schedule",
        payload: sampleInput,
      });

      expect(response.statusCode).toBe(200);

      const result = response.json();
      expect(result.success).toBe(true);
      expect(result.version).toBe("1.0.0");
      expect(result.assignments).toBeDefined();
      expect(result.assignments.length).toBeGreaterThan(0);
      expect(result.kpis).toBeDefined();
      expect(result.kpis.total_jobs).toBe(2);
    });

    it("returns 400 for invalid input", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/schedule",
        payload: {
          horizon: {
            start: "invalid-date",
            end: "2025-11-03T16:00:00Z",
          },
        },
      });

      expect(response.statusCode).toBe(400);

      const result = response.json();
      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid input");
      expect(result.why).toBeDefined();
      expect(result.why.length).toBeGreaterThan(0);
    });

    it("returns infeasibility error when schedule is impossible", async () => {
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

      const response = await app.inject({
        method: "POST",
        url: "/schedule",
        payload: infeasibleInput,
      });

      expect(response.statusCode).toBe(200);

      const result = response.json();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.why).toBeDefined();
      expect(result.why.length).toBeGreaterThan(0);
    });

    it("returns correct content-type header", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/schedule",
        payload: sampleInput,
      });

      expect(response.headers["content-type"]).toContain("application/json");
    });

    it("handles empty products list", async () => {
      const emptyInput: Input = {
        ...sampleInput,
        products: [],
      };

      const response = await app.inject({
        method: "POST",
        url: "/schedule",
        payload: emptyInput,
      });

      expect(response.statusCode).toBe(200);

      const result = response.json();
      expect(result.success).toBe(true);
      expect(result.assignments.length).toBe(0);
      expect(result.kpis.total_jobs).toBe(0);
    });
  });

  describe("GET /health", () => {
    it("returns health status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);

      const result = response.json();
      expect(result.status).toBe("ok");
      expect(result.version).toBe("1.0.0");
    });
  });
});
