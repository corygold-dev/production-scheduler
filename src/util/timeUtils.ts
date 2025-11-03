import { parseISO, addMinutes } from "date-fns";
import type { NormalizedInterval, InternalAssignment } from "../types/index.js";

export function parseIsoOffset(
  isoString: string,
  horizonStart: string
): number {
  const startTime = parseISO(horizonStart);
  const targetTime = parseISO(isoString);
  return Math.floor((targetTime.getTime() - startTime.getTime()) / 60000);
}

export function formatIsoOffset(minutes: number, horizonStart: string): string {
  const startTime = parseISO(horizonStart);
  return addMinutes(startTime, minutes).toISOString();
}

export function minutesBetween(isoA: string, isoB: string): number {
  return Math.abs(
    (parseISO(isoB).getTime() - parseISO(isoA).getTime()) / 60000
  );
}

export function parseCalendarWindows(
  calendar: [string, string][],
  horizonStart: string
): NormalizedInterval[] {
  const parsed = calendar.map(([s, e]) => ({
    start: parseIsoOffset(s, horizonStart),
    end: parseIsoOffset(e, horizonStart),
  }));
  return parsed.sort((a, b) => a.start - b.start);
}

export function doIntervalsOverlap(
  a: NormalizedInterval,
  b: NormalizedInterval
): boolean {
  return a.start < b.end && b.start < a.end;
}

export function combineOverlappingIntervals(
  intervals: NormalizedInterval[]
): NormalizedInterval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const combined: NormalizedInterval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = combined[combined.length - 1];

    if (current.start <= last.end) {
      combined[combined.length - 1] = {
        start: last.start,
        end: Math.max(last.end, current.end),
      };
    } else {
      combined.push(current);
    }
  }

  return combined;
}

export function canFitInWindow(
  window: NormalizedInterval,
  duration: number,
  earliestStart: number
): number | null {
  const actualStart = Math.max(window.start, earliestStart);
  if (actualStart + duration <= window.end) {
    return actualStart;
  }
  return null;
}

export function findEarliestAvailableSlot(
  calendar: NormalizedInterval[],
  occupied: NormalizedInterval[],
  duration: number,
  earliestStart: number
): number | null {
  const merged = combineOverlappingIntervals(occupied);

  for (const window of calendar) {
    if (window.end <= earliestStart) continue;

    let currentTime = Math.max(window.start, earliestStart);

    for (const occ of merged) {
      if (occ.end <= currentTime) continue;

      if (
        currentTime + duration <= occ.start &&
        currentTime + duration <= window.end
      ) {
        return currentTime;
      }

      currentTime = Math.max(currentTime, occ.end);
      if (currentTime >= window.end) break;
    }

    // Remaining window has enough space
    if (currentTime + duration <= window.end) return currentTime;
  }

  return null;
}

export function getOccupiedIntervals(
  assignments: InternalAssignment[]
): NormalizedInterval[] {
  return assignments.map((a) => ({
    start: a.start,
    end: a.end,
  }));
}

export function isWithinCalendarWindow(
  start: number,
  end: number,
  calendar: NormalizedInterval[]
): boolean {
  return calendar.some((window) => start >= window.start && end <= window.end);
}
