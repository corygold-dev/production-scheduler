/**
 * Type Definitions for Production Scheduler
 *
 * NAMING CONVENTION:
 * - snake_case: Types that map to JSON (Input/Output, matches API contract)
 * - camelCase: Internal-only types (never serialized, idiomatic TypeScript)
 *
 * TIME/DURATION UNITS:
 * - All durations are in MINUTES
 * - External timestamps use ISO 8601 strings (e.g., "2025-11-03T08:00:00")
 * - Internal timestamps use minutes from horizon start (normalized at input)
 */

// Base Types

export interface Interval {
  start: number;
  end: number;
}

// Input Types (JSON - snake_case)

export interface Horizon {
  start: string;
  end: string;
}

export interface Resource {
  id: string;
  capabilities: string[];
  calendar: [string, string][];
}

export interface Operation {
  capability: string;
  duration_minutes: number;
}

export interface Product {
  id: string;
  family: string;
  due: string;
  route: Operation[];
}

export interface ChangeoverMatrix {
  values: Record<string, number>;
}

export interface Settings {
  time_limit_seconds: number;
}

export interface Input {
  horizon: Horizon;
  resources: Resource[];
  changeover_matrix_minutes: ChangeoverMatrix;
  products: Product[];
  settings: Settings;
}

// Output Types (JSON - snake_case)

export interface Assignment {
  product: string;
  operation: string;
  resource: string;
  start: string;
  end: string;
}

export interface KPIs {
  tardiness_minutes: number;
  changeovers: number;
  makespan_minutes: number;
  utilization: Record<string, number>;
  on_time_jobs: number;
  total_jobs: number;
}

export interface SuccessOutput {
  version: string;
  success: true;
  assignments: Assignment[];
  kpis: KPIs;
}

export interface FailureOutput {
  version: string;
  success: false;
  error: string;
  why: string[];
}

export type ScheduleResult = SuccessOutput | FailureOutput;

// Internal Types (camelCase)

export interface NormalizedInterval {
  start: number;
  end: number;
}

export interface NormalizedResource {
  id: string;
  capabilities: Set<string>;
  calendar: NormalizedInterval[];
}

export interface NormalizedProduct {
  id: string;
  family: string;
  due: number;
  route: Operation[];
}

export interface SchedulableOperation {
  productId: string;
  productFamily: string;
  stepIndex: number;
  capability: string;
  duration: number;
  productDue: number;
  earliestStart: number;
}

export interface InternalAssignment {
  productId: string;
  productFamily: string;
  stepIndex: number;
  operationName: string;
  resource: string;
  start: number;
  end: number;
}

export interface ResourceState {
  lastFamily: string | null;
  assignments: InternalAssignment[];
}

export interface InfeasibilityReason {
  type:
    | "no_eligible_resource"
    | "calendar_conflict"
    | "horizon_exceeded"
    | "precedence_violated";
  product: string;
  operation: string;
  details: string;
}
