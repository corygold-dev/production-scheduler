import type {
  Input,
  ScheduleResult,
  NormalizedResource,
  NormalizedProduct,
  SchedulableOperation,
  InternalAssignment,
  ResourceState,
} from "../types/index.js";
import {
  parseIsoOffset,
  formatIsoOffset,
  parseCalendarWindows,
  combineOverlappingIntervals,
} from "../util/timeUtils.js";
import { SCHEDULER_VERSION } from "../constants.js";

function normalizeInput(input: Input) {
  const horizonStart = input.horizon.start;
  const horizonEnd = parseIsoOffset(input.horizon.end, horizonStart);

  const resources: Map<string, NormalizedResource> = new Map();
  for (const r of input.resources) {
    const raw = parseCalendarWindows(r.calendar, horizonStart);
    const merged = combineOverlappingIntervals(raw)
      .map((w) => ({
        start: Math.max(0, w.start),
        end: Math.min(horizonEnd, w.end),
      }))
      .filter((w) => w.end > w.start);

    resources.set(r.id, {
      id: r.id,
      capabilities: new Set(r.capabilities),
      calendar: merged,
    });
  }

  const products: NormalizedProduct[] = input.products.map((p) => ({
    id: p.id,
    family: p.family,
    due: parseIsoOffset(p.due, horizonStart),
    route: p.route,
  }));

  return {
    horizonStart,
    horizonEnd,
    resources,
    products,
    changeoverMatrix: input.changeover_matrix_minutes.values,
  };
}

function buildOperationsList(
  products: NormalizedProduct[]
): SchedulableOperation[] {
  const operations: SchedulableOperation[] = [];

  for (const product of products) {
    for (let stepIndex = 0; stepIndex < product.route.length; stepIndex++) {
      const op = product.route[stepIndex];
      operations.push({
        productId: product.id,
        productFamily: product.family,
        stepIndex,
        capability: op.capability,
        duration: op.duration_minutes,
        productDue: product.due,
        earliestStart: 0,
      });
    }
  }

  return operations;
}

function selectNextOperation(
  unscheduled: SchedulableOperation[],
  assignments: Map<string, InternalAssignment[]>,
  productsMap: Map<string, NormalizedProduct>
): SchedulableOperation | null {
  const ready = unscheduled.filter((op) => {
    if (op.stepIndex === 0) return true;

    const productAssignments = assignments.get(op.productId) || [];
    const priorStep = productAssignments.find(
      (a) => a.stepIndex === op.stepIndex - 1
    );
    return priorStep !== undefined;
  });

  if (ready.length === 0) return null;

  ready.sort((a, b) => {
    // Priority: EDD, then slack (least remaining time), then shortest duration
    if (a.productDue !== b.productDue) return a.productDue - b.productDue;

    const productA = productsMap.get(a.productId)!;
    const productB = productsMap.get(b.productId)!;

    const remainingA = productA.route
      .slice(a.stepIndex)
      .reduce((sum, op) => sum + op.duration_minutes, 0);
    const remainingB = productB.route
      .slice(b.stepIndex)
      .reduce((sum, op) => sum + op.duration_minutes, 0);

    const slackA = a.productDue - a.earliestStart - remainingA;
    const slackB = b.productDue - b.earliestStart - remainingB;

    if (slackA !== slackB) return slackA - slackB;
    return a.duration - b.duration;
  });

  return ready[0];
}

function getEligibleResources(
  operation: SchedulableOperation,
  resources: Map<string, NormalizedResource>
): NormalizedResource[] {
  const eligible: NormalizedResource[] = [];
  for (const resource of resources.values()) {
    if (resource.capabilities.has(operation.capability)) {
      eligible.push(resource);
    }
  }
  return eligible;
}

function getChangeoverTime(
  lastFamily: string | null,
  nextFamily: string,
  matrix: Record<string, number>
): number {
  if (!lastFamily) return 0;
  const key = `${lastFamily}->${nextFamily}`;
  return matrix[key] ?? 0;
}

function tryPlaceOperation(
  operation: SchedulableOperation,
  eligibleResources: NormalizedResource[],
  resourceStates: Map<string, ResourceState>,
  changeoverMatrix: Record<string, number>
): {
  placement: { resource: string; start: number; end: number } | null;
  bestNear: { resource: string; reason: string } | null;
} {
  let bestPlacement: { resource: string; start: number; end: number } | null =
    null;
  let bestProjectedTardiness = Infinity;
  let earliestEnd = Infinity;
  let bestNear: { resource: string; reason: string } | null = null;
  let largestGap = 0;

  for (const resource of eligibleResources) {
    const state = resourceStates.get(resource.id)!;
    const sorted = state.assignments;

    for (const window of resource.calendar) {
      if (window.end <= operation.earliestStart) continue;
      // Check each gap between scheduled jobs (including before first and after last)
      for (let i = 0; i <= sorted.length; i++) {
        const prevAssignment = sorted[i - 1];
        const nextAssignment = sorted[i];

        const gapStart = Math.max(
          operation.earliestStart,
          prevAssignment ? prevAssignment.end : window.start
        );
        const gapEnd = Math.min(
          window.end,
          nextAssignment ? nextAssignment.start : window.end
        );

        if (gapEnd <= gapStart) continue;

        const prevFamily = prevAssignment ? prevAssignment.productFamily : null;
        const changeoverTime = getChangeoverTime(
          prevFamily,
          operation.productFamily,
          changeoverMatrix
        );

        const start = gapStart + changeoverTime;
        const end = start + operation.duration;

        if (start >= gapStart && end <= gapEnd) {
          const projectedTardiness = Math.max(0, end - operation.productDue);

          if (
            projectedTardiness < bestProjectedTardiness ||
            (projectedTardiness === bestProjectedTardiness && end < earliestEnd)
          ) {
            bestProjectedTardiness = projectedTardiness;
            earliestEnd = end;
            bestPlacement = { resource: resource.id, start, end };
          }
        } else {
          const gap = gapEnd - gapStart;
          const needed = changeoverTime + operation.duration;
          if (gap > largestGap) {
            largestGap = gap;
            bestNear = {
              resource: resource.id,
              reason: `largest gap ${gap}min < needed ${needed}min (changeover ${changeoverTime}min)`,
            };
          }
        }
      }
    }
  }

  return { placement: bestPlacement, bestNear };
}

function updateResourceState(
  state: ResourceState,
  assignment: InternalAssignment
): void {
  state.assignments.push(assignment);
  state.assignments.sort((a, b) => a.start - b.start);
  state.lastFamily = assignment.productFamily;
}

function computeChangeoverMinutesPerResource(
  resourceMap: Map<string, InternalAssignment[]>,
  matrix: Record<string, number>
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [rid, list] of resourceMap.entries()) {
    const sorted = list.slice().sort((a, b) => a.start - b.start);
    let total = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].productFamily !== sorted[i].productFamily) {
        const key = `${sorted[i - 1].productFamily}->${
          sorted[i].productFamily
        }`;
        total += matrix[key] ?? 0;
      }
    }
    result[rid] = total;
  }
  return result;
}

function denormalizeResult(
  assignments: InternalAssignment[],
  horizonStart: string,
  products: NormalizedProduct[],
  resources: Map<string, NormalizedResource>,
  changeoverMatrix: Record<string, number>
): ScheduleResult {
  const sortedAssignments = assignments
    .slice()
    .sort((a, b) => a.start - b.start);

  const outputAssignments = sortedAssignments.map((a) => ({
    product: a.productId,
    operation: a.operationName,
    resource: a.resource,
    start: formatIsoOffset(a.start, horizonStart),
    end: formatIsoOffset(a.end, horizonStart),
  }));

  const productCompletions = new Map<string, number>();
  for (const a of assignments) {
    const current = productCompletions.get(a.productId) || 0;
    productCompletions.set(a.productId, Math.max(current, a.end));
  }

  let totalTardiness = 0;
  let onTimeJobs = 0;
  for (const product of products) {
    const completion = productCompletions.get(product.id) || 0;
    const tardiness = Math.max(0, completion - product.due);
    totalTardiness += tardiness;
    if (tardiness === 0) onTimeJobs++;
  }

  const resourceUtilization: Record<string, number> = {};
  const resourceMap = new Map<string, InternalAssignment[]>();
  for (const a of assignments) {
    if (!resourceMap.has(a.resource)) {
      resourceMap.set(a.resource, []);
    }
    resourceMap.get(a.resource)!.push(a);
  }

  const changeoverMinutesByRes = computeChangeoverMinutesPerResource(
    resourceMap,
    changeoverMatrix
  );

  for (const [resourceId, resource] of resources.entries()) {
    const availableMinutes = resource.calendar.reduce(
      (sum, window) => sum + (window.end - window.start),
      0
    );
    const resourceAssignments = resourceMap.get(resourceId) || [];
    const busyTime =
      resourceAssignments.reduce((sum, a) => sum + (a.end - a.start), 0) +
      (changeoverMinutesByRes[resourceId] ?? 0);
    resourceUtilization[resourceId] = Math.round(
      (busyTime / Math.max(availableMinutes, 1)) * 100
    );
  }

  let changeovers = 0;
  for (const [, list] of resourceMap.entries()) {
    const sorted = list.slice().sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].productFamily !== sorted[i].productFamily) {
        changeovers++;
      }
    }
  }

  const minStart = assignments.reduce((m, a) => Math.min(m, a.start), Infinity);
  const maxEnd = assignments.reduce((m, a) => Math.max(m, a.end), 0);
  const makespan =
    assignments.length > 0 ? maxEnd - (isFinite(minStart) ? minStart : 0) : 0;

  return {
    version: SCHEDULER_VERSION,
    success: true,
    assignments: outputAssignments,
    kpis: {
      tardiness_minutes: totalTardiness,
      changeovers,
      makespan_minutes: makespan,
      utilization: resourceUtilization,
      on_time_jobs: onTimeJobs,
      total_jobs: products.length,
    },
  };
}

export function schedule(input: Input): ScheduleResult {
  const normalized = normalizeInput(input);
  const operations = buildOperationsList(normalized.products);
  const productsMap = new Map(normalized.products.map((p) => [p.id, p]));

  if (normalized.products.length === 0) {
    return {
      version: SCHEDULER_VERSION,
      success: true,
      assignments: [],
      kpis: {
        tardiness_minutes: 0,
        changeovers: 0,
        makespan_minutes: 0,
        utilization: {},
        on_time_jobs: 0,
        total_jobs: 0,
      },
    };
  }

  const deadline =
    Date.now() + (input.settings?.time_limit_seconds ?? 30) * 1000;

  const resourceStates = new Map<string, ResourceState>();
  for (const id of normalized.resources.keys()) {
    resourceStates.set(id, { lastFamily: null, assignments: [] });
  }

  const assignments = new Map<string, InternalAssignment[]>();
  const allAssignments: InternalAssignment[] = [];
  const unscheduled = [...operations];

  let iteration = 0;
  const maxIterations = unscheduled.length * 5;

  while (unscheduled.length > 0) {
    if (Date.now() > deadline) {
      return {
        version: SCHEDULER_VERSION,
        success: false,
        error: "Time limit exceeded",
        why: ["settings.time_limit_seconds reached before completing schedule"],
      };
    }

    if (iteration++ > maxIterations) {
      return {
        version: SCHEDULER_VERSION,
        success: false,
        error: "Scheduler stuck in infinite loop",
        why: ["Maximum iterations exceeded"],
      };
    }

    const nextOp = selectNextOperation(unscheduled, assignments, productsMap);

    if (!nextOp) {
      return {
        version: SCHEDULER_VERSION,
        success: false,
        error: "No ready operations available",
        why: ["Precedence deadlock detected"],
      };
    }

    if (nextOp.stepIndex > 0) {
      const productAssignments = assignments.get(nextOp.productId) || [];
      const priorStep = productAssignments.find(
        (a) => a.stepIndex === nextOp.stepIndex - 1
      );
      if (priorStep) {
        nextOp.earliestStart = priorStep.end;
      }
    }

    const eligible = getEligibleResources(nextOp, normalized.resources);

    if (eligible.length === 0) {
      return {
        version: SCHEDULER_VERSION,
        success: false,
        error: "No eligible resources",
        why: [
          `Product ${nextOp.productId}, step ${nextOp.stepIndex} (${nextOp.capability}): No resource has required capability`,
        ],
      };
    }

    const { placement, bestNear } = tryPlaceOperation(
      nextOp,
      eligible,
      resourceStates,
      normalized.changeoverMatrix
    );

    if (!placement) {
      const reasons = [
        `Product ${nextOp.productId}, step ${nextOp.stepIndex} (${nextOp.capability}): No available time slot found on eligible resources`,
      ];
      if (bestNear) {
        reasons.push(`Closest: ${bestNear.resource} — ${bestNear.reason}`);
      }
      return {
        version: SCHEDULER_VERSION,
        success: false,
        error: "Cannot place operation",
        why: reasons,
      };
    }

    if (placement.end > normalized.horizonEnd) {
      return {
        version: SCHEDULER_VERSION,
        success: false,
        error: "Horizon exceeded",
        why: [
          `Product ${nextOp.productId}, step ${nextOp.stepIndex} (${nextOp.capability}): would end at ${placement.end} min, beyond horizon ${normalized.horizonEnd} min`,
        ],
      };
    }

    const assignment: InternalAssignment = {
      productId: nextOp.productId,
      productFamily: nextOp.productFamily,
      stepIndex: nextOp.stepIndex,
      operationName: nextOp.capability,
      resource: placement.resource,
      start: placement.start,
      end: placement.end,
    };

    if (!assignments.has(nextOp.productId)) {
      assignments.set(nextOp.productId, []);
    }
    assignments.get(nextOp.productId)!.push(assignment);
    allAssignments.push(assignment);

    const resourceState = resourceStates.get(placement.resource)!;
    updateResourceState(resourceState, assignment);

    const nextStep = unscheduled.find(
      (o) =>
        o.productId === nextOp.productId && o.stepIndex === nextOp.stepIndex + 1
    );
    if (nextStep) {
      nextStep.earliestStart = Math.max(nextStep.earliestStart, assignment.end);
    }

    const index = unscheduled.findIndex(
      (op) =>
        op.productId === nextOp.productId && op.stepIndex === nextOp.stepIndex
    );
    unscheduled.splice(index, 1);
  }

  for (const [rid, state] of resourceStates.entries()) {
    const assigned = state.assignments
      .slice()
      .sort((a, b) => a.start - b.start);
    for (let i = 1; i < assigned.length; i++) {
      if (assigned[i].start < assigned[i - 1].end) {
        return {
          version: SCHEDULER_VERSION,
          success: false,
          error: "Validation failed: overlap detected",
          why: [
            `Resource ${rid}: overlap between assignments at ${
              assigned[i - 1].start
            }-${assigned[i - 1].end} and ${assigned[i].start}-${
              assigned[i].end
            }`,
          ],
        };
      }
    }
  }

  return denormalizeResult(
    allAssignments,
    normalized.horizonStart,
    normalized.products,
    normalized.resources,
    normalized.changeoverMatrix
  );
}
