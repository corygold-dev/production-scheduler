import { z } from "zod";

export const horizonSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
});

export const resourceSchema = z.object({
  id: z.string().min(1),
  capabilities: z.array(z.string().min(1)).min(1),
  calendar: z
    .array(z.tuple([z.string().datetime(), z.string().datetime()]))
    .min(1),
});

export const operationSchema = z.object({
  capability: z.string().min(1),
  duration_minutes: z.number().positive(),
});

export const productSchema = z.object({
  id: z.string().min(1),
  family: z.string().min(1),
  due: z.string().datetime(),
  route: z.array(operationSchema).min(1),
});

export const changeoverMatrixSchema = z.object({
  values: z.record(z.string(), z.number().min(0)),
});

export const settingsSchema = z.object({
  time_limit_seconds: z.number().positive(),
});

export const inputSchema = z.object({
  horizon: horizonSchema,
  resources: z.array(resourceSchema).min(1),
  changeover_matrix_minutes: changeoverMatrixSchema,
  products: z.array(productSchema),
  settings: settingsSchema,
});

export const assignmentSchema = z.object({
  product: z.string(),
  op: z.string(),
  resource: z.string(),
  start: z.string().datetime(),
  end: z.string().datetime(),
});

export const kpisSchema = z.object({
  tardiness_minutes: z.number().min(0),
  changeovers: z.number().int().min(0),
  makespan_minutes: z.number().min(0),
  utilization: z.record(z.string(), z.number().min(0).max(100)),
  on_time_jobs: z.number().int().min(0),
  total_jobs: z.number().int().min(0),
});

export const successOutputSchema = z.object({
  version: z.string(),
  success: z.literal(true),
  assignments: z.array(assignmentSchema),
  kpis: kpisSchema,
});

export const failureOutputSchema = z.object({
  version: z.string(),
  success: z.literal(false),
  error: z.string(),
  why: z.array(z.string()),
});

export const scheduleResultSchema = z.discriminatedUnion("success", [
  successOutputSchema,
  failureOutputSchema,
]);

export type Input = z.infer<typeof inputSchema>;
export type ScheduleResult = z.infer<typeof scheduleResultSchema>;

export const InputSchema = inputSchema;
export const ScheduleResultSchema = scheduleResultSchema;
