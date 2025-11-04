import { describe, it, expect } from "vitest";
import {
  parseIsoOffset,
  formatIsoOffset,
  combineOverlappingIntervals,
  findEarliestAvailableSlot,
  doIntervalsOverlap,
  parseCalendarWindows,
  minutesBetween,
} from "../../src/util/timeUtils.js";

describe("Time conversion", () => {
  const horizonStart = "2025-11-03T08:00:00Z";

  it("converts ISO to minutes offset", () => {
    expect(parseIsoOffset("2025-11-03T08:00:00Z", horizonStart)).toBe(0);
    expect(parseIsoOffset("2025-11-03T08:30:00Z", horizonStart)).toBe(30);
    expect(parseIsoOffset("2025-11-03T10:00:00Z", horizonStart)).toBe(120);
  });

  it("converts minutes offset back to ISO", () => {
    expect(formatIsoOffset(0, horizonStart)).toBe("2025-11-03T08:00:00.000Z");
    expect(formatIsoOffset(30, horizonStart)).toBe("2025-11-03T08:30:00.000Z");
    expect(formatIsoOffset(120, horizonStart)).toBe("2025-11-03T10:00:00.000Z");
  });

  it("conversions are reversible", () => {
    const testCases = [0, 30, 120, 480];
    testCases.forEach((minutes) => {
      const iso = formatIsoOffset(minutes, horizonStart);
      const back = parseIsoOffset(iso, horizonStart);
      expect(back).toBe(minutes);
    });
  });

  it("parses calendar windows and sorts them", () => {
    const calendar: [string, string][] = [
      ["2025-11-03T12:30:00Z", "2025-11-03T16:00:00Z"],
      ["2025-11-03T08:00:00Z", "2025-11-03T12:00:00Z"],
    ];
    const parsed = parseCalendarWindows(calendar, horizonStart);
    expect(parsed).toEqual([
      { start: 0, end: 240 },
      { start: 270, end: 480 },
    ]);
  });

  it("calculates minutesBetween correctly", () => {
    expect(minutesBetween("2025-11-03T08:00:00Z", "2025-11-03T09:00:00Z")).toBe(
      60
    );
    expect(minutesBetween("2025-11-03T08:00:00Z", "2025-11-03T08:30:00Z")).toBe(
      30
    );
    expect(minutesBetween("2025-11-03T09:00:00Z", "2025-11-03T08:00:00Z")).toBe(
      60
    );
  });
});

describe("Interval operations", () => {
  it("detects overlapping intervals", () => {
    expect(
      doIntervalsOverlap({ start: 0, end: 10 }, { start: 5, end: 15 })
    ).toBe(true);
    expect(
      doIntervalsOverlap({ start: 0, end: 10 }, { start: 10, end: 20 })
    ).toBe(false);
    expect(
      doIntervalsOverlap({ start: 10, end: 20 }, { start: 0, end: 10 })
    ).toBe(false);
  });

  it("combines overlapping intervals", () => {
    const intervals = [
      { start: 0, end: 30 },
      { start: 20, end: 50 },
      { start: 100, end: 120 },
    ];
    const combined = combineOverlappingIntervals(intervals);
    expect(combined).toEqual([
      { start: 0, end: 50 },
      { start: 100, end: 120 },
    ]);
  });

  it("combines adjacent intervals", () => {
    const intervals = [
      { start: 0, end: 10 },
      { start: 10, end: 20 },
    ];
    const combined = combineOverlappingIntervals(intervals);
    expect(combined).toEqual([{ start: 0, end: 20 }]);
  });

  it("handles empty intervals", () => {
    expect(combineOverlappingIntervals([])).toEqual([]);
  });

  it("handles single interval", () => {
    const intervals = [{ start: 0, end: 10 }];
    expect(combineOverlappingIntervals(intervals)).toEqual(intervals);
  });

  it("combines three touching intervals into one", () => {
    const intervals = [
      { start: 0, end: 10 },
      { start: 10, end: 20 },
      { start: 20, end: 30 },
    ];
    expect(combineOverlappingIntervals(intervals)).toEqual([
      { start: 0, end: 30 },
    ]);
  });
});

describe("findEarliestAvailableSlot", () => {
  it("finds slot at start when nothing occupied", () => {
    const calendar = [{ start: 0, end: 60 }];
    const occupied = [];
    const slot = findEarliestAvailableSlot(calendar, occupied, 10, 0);
    expect(slot).toBe(0);
  });

  it("finds slot before first occupied block", () => {
    const calendar = [{ start: 0, end: 60 }];
    const occupied = [{ start: 10, end: 20 }];
    const slot = findEarliestAvailableSlot(calendar, occupied, 5, 0);
    expect(slot).toBe(0);
  });

  it("finds gap between occupied blocks", () => {
    const calendar = [{ start: 0, end: 60 }];
    const occupied = [
      { start: 0, end: 20 },
      { start: 25, end: 50 },
    ];
    const slot = findEarliestAvailableSlot(calendar, occupied, 5, 20);
    expect(slot).toBe(20);
  });

  it("finds slot at end of window", () => {
    const calendar = [{ start: 0, end: 60 }];
    const occupied = [{ start: 0, end: 40 }];
    const slot = findEarliestAvailableSlot(calendar, occupied, 10, 0);
    expect(slot).toBe(40);
  });

  it("returns null when no slot available", () => {
    const calendar = [{ start: 0, end: 60 }];
    const occupied = [{ start: 0, end: 60 }];
    const slot = findEarliestAvailableSlot(calendar, occupied, 10, 0);
    expect(slot).toBeNull();
  });

  it("respects earliestStart constraint", () => {
    const calendar = [{ start: 0, end: 60 }];
    const occupied = [];
    const slot = findEarliestAvailableSlot(calendar, occupied, 10, 30);
    expect(slot).toBe(30);
  });

  it("skips windows that end before earliestStart", () => {
    const calendar = [
      { start: 0, end: 20 },
      { start: 30, end: 60 },
    ];
    const occupied = [];
    const slot = findEarliestAvailableSlot(calendar, occupied, 10, 25);
    expect(slot).toBe(30);
  });

  it("handles multiple calendar windows", () => {
    const calendar = [
      { start: 0, end: 100 },
      { start: 200, end: 300 },
    ];
    const occupied = [{ start: 0, end: 100 }];
    const slot = findEarliestAvailableSlot(calendar, occupied, 10, 0);
    expect(slot).toBe(200);
  });

  it("returns null when duration too large for any gap", () => {
    const calendar = [{ start: 0, end: 60 }];
    const occupied = [
      { start: 10, end: 20 },
      { start: 30, end: 40 },
    ];
    const slot = findEarliestAvailableSlot(calendar, occupied, 50, 0);
    expect(slot).toBeNull();
  });
});

describe("Integration checks", () => {
  it("ensures parsed calendar aligns with findEarliestAvailableSlot", () => {
    const horizonStart = "2025-11-03T08:00:00Z";
    const calendar: [string, string][] = [
      ["2025-11-03T08:00:00Z", "2025-11-03T09:00:00Z"],
      ["2025-11-03T09:30:00Z", "2025-11-03T10:00:00Z"],
    ];
    const parsed = parseCalendarWindows(calendar, horizonStart);
    const slot = findEarliestAvailableSlot(parsed, [], 15, 60);
    expect(slot).toBe(90);
  });

  it("returns same slot with or without occupied merge optimization", () => {
    const calendar = [{ start: 0, end: 100 }];
    const slot = findEarliestAvailableSlot(calendar, [], 20, 0);
    expect(slot).toBe(0);
  });
});
